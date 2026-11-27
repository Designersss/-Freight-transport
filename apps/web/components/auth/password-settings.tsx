"use client";

import {
  authBodies,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Separator,
} from "@freight/ui";
import { useRouter } from "@freight/ui/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

type Values = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const emptyValues: Values = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};
const successResponse = z.object({ success: z.literal(true) });
const errorResponse = z.object({ code: z.string() });

export function PasswordSettings({ locale }: { locale: Locale }) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const {
    register,
    handleSubmit,
    reset,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ defaultValues: emptyValues });
  const fields = [
    { name: "currentPassword", label: t.currentPassword },
    { name: "newPassword", label: t.newPassword },
    { name: "confirmPassword", label: t.confirmPassword },
  ] as const;

  async function submit(values: Values) {
    if (inFlight.current) return;
    clearErrors();
    setFailure("");
    setSaved(false);
    const parsed = authBodies["/change-password"].safeParse({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const name = issue.path[0];
        if (name === "currentPassword" || name === "newPassword")
          setError(name, { message: t.invalidPassword }, { shouldFocus: true });
      }
      return;
    }
    if (values.confirmPassword !== values.newPassword) {
      setError(
        "confirmPassword",
        { message: t.passwordsMismatch },
        { shouldFocus: true },
      );
      return;
    }

    inFlight.current = true;
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        body: JSON.stringify(parsed.data),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401) {
        router.replace("/login", { locale });
        return;
      }
      if (!response.ok) {
        const error = errorResponse.safeParse(data);
        setFailure(
          error.success && error.data.code === "INVALID_CURRENT_PASSWORD"
            ? t.invalidCurrentPassword
            : response.status === 429
              ? t.limited
              : response.status === 403
                ? t.profileDenied
                : response.status >= 500
                  ? t.unavailable
                  : t.error,
        );
        return;
      }
      if (!successResponse.safeParse(data).success) {
        setFailure(t.error);
        return;
      }
      setSaved(true);
    } catch {
      setFailure(t.unavailable);
    } finally {
      reset(emptyValues);
      inFlight.current = false;
    }
  }

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="password-settings-title"
    >
      <Separator />
      <h2 id="password-settings-title" className="font-semibold">
        {t.changePasswordTitle}
      </h2>
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={handleSubmit(submit)}
      >
        <FieldGroup className="gap-3">
          {fields.map(({ name, label }) => (
            <Field key={name} data-invalid={Boolean(errors[name])}>
              <FieldLabel htmlFor={name}>{label}</FieldLabel>
              <Input
                id={name}
                type="password"
                autoComplete={
                  name === "currentPassword"
                    ? "current-password"
                    : "new-password"
                }
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors[name])}
                aria-describedby={errors[name] ? `${name}-error` : undefined}
                {...register(name)}
              />
              <FieldError id={`${name}-error`}>
                {errors[name]?.message}
              </FieldError>
              {name === "newPassword" && (
                <FieldDescription>{t.passwordHint}</FieldDescription>
              )}
            </Field>
          ))}
        </FieldGroup>
        <p className="text-sm text-muted-foreground">{t.changePasswordHint}</p>
        {failure && (
          <Alert variant="destructive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
        {saved && <p role="status">{t.changePasswordDone}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t.submitting : t.changePasswordAction}
        </Button>
      </form>
    </section>
  );
}
