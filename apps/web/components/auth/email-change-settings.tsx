"use client";

import { emailChangeInput, emailChangeResponse } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Separator,
} from "@freight/ui";
import { useRouter } from "@freight/ui/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const errorResponse = z.object({ code: z.string() });

export function EmailChangeSettings({
  locale,
  currentEmail,
}: {
  locale: Locale;
  currentEmail: string;
}) {
  const t = messages[locale].auth;
  const router = useRouter();
  const operation = useRef<AbortController | null>(null);
  const [failure, setFailure] = useState("");
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<{ newEmail: string }>({
    defaultValues: { newEmail: "" },
  });
  useEffect(() => () => operation.current?.abort(), []);

  async function submit(values: { newEmail: string }) {
    if (operation.current) return;
    setFailure("");
    setSent(false);
    const parsed = emailChangeInput.safeParse({
      newEmail: values.newEmail.trim(),
      locale,
    });
    if (!parsed.success) {
      setError("newEmail", { message: t.invalidEmail }, { shouldFocus: true });
      return;
    }
    if (parsed.data.newEmail === currentEmail.toLowerCase()) {
      setError(
        "newEmail",
        { message: t.emailChangeSame },
        { shouldFocus: true },
      );
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    try {
      const response = await fetch("/api/auth/email/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        body: JSON.stringify(parsed.data),
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        router.replace("/login", { locale });
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        const error = errorResponse.safeParse(body);
        setFailure(
          response.status === 429
            ? t.limited
            : error.success && error.data.code === "SESSION_NOT_FRESH"
              ? t.emailChangeFresh
              : response.status === 403
                ? t.profileDenied
                : response.status >= 500
                  ? t.unavailable
                  : t.error,
        );
        return;
      }
      if (emailChangeResponse.parse(body).stage !== "old-sent")
        throw new Error("Unexpected email change stage");
      reset({ newEmail: "" });
      setSent(true);
    } catch {
      if (!controller.signal.aborted) setFailure(t.unavailable);
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }

  return (
    <section
      aria-labelledby="email-change-title"
      className="flex flex-col gap-3"
    >
      <Separator />
      <h2 id="email-change-title" className="font-semibold">
        {t.emailChangeTitle}
      </h2>
      <p className="text-muted-foreground">{t.emailChangeDescription}</p>
      <form
        noValidate
        onSubmit={handleSubmit(submit)}
        className="flex flex-col gap-3"
      >
        <Field data-invalid={Boolean(errors.newEmail)}>
          <FieldLabel htmlFor="settings-new-email">
            {t.emailChangeNew}
          </FieldLabel>
          <Input
            id="settings-new-email"
            type="email"
            autoComplete="email"
            maxLength={254}
            aria-invalid={Boolean(errors.newEmail)}
            aria-describedby={
              errors.newEmail ? "settings-new-email-error" : undefined
            }
            disabled={isSubmitting}
            {...register("newEmail")}
          />
          {errors.newEmail && (
            <FieldError id="settings-new-email-error">
              {errors.newEmail.message}
            </FieldError>
          )}
        </Field>
        {failure && (
          <Alert variant="destructive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
        {sent && <p role="status">{t.emailChangeOldSent}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t.submitting : t.emailChangeAction}
        </Button>
      </form>
    </section>
  );
}
