"use client";

import { adminLoginInput } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  Field,
  FieldError,
  FieldLabel,
  Input,
} from "@freight/ui";
import { useRouter } from "@freight/ui/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

type Values = { email: string; password: string };
const success = z.object({ success: z.literal(true) });

export function AdminLogin({
  locale,
  initialFailure,
}: {
  locale: Locale;
  initialFailure: string;
}) {
  const t = messages[locale];
  const router = useRouter();
  const [failure, setFailure] = useState(initialFailure);
  const inFlight = useRef(false);
  const {
    register,
    handleSubmit,
    setError,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ defaultValues: { email: "", password: "" } });

  async function submit(values: Values) {
    if (inFlight.current) return;
    setFailure("");
    const parsed = adminLoginInput.safeParse({
      ...values,
      email: values.email.trim(),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "email" || field === "password")
          setError(field, {
            message:
              field === "email" ? t.auth.invalidEmail : t.auth.invalidPassword,
          });
      }
      return;
    }
    inFlight.current = true;
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        redirect: "error",
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        resetField("password");
        setFailure(
          response.status === 429
            ? t.auth.limited
            : response.status >= 500
              ? t.auth.unavailable
              : t.admin.loginFailed,
        );
        return;
      }
      success.parse(await response.json());
      resetField("password");
      router.replace("/", { locale });
      router.refresh();
    } catch {
      setFailure(t.auth.unavailable);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex min-h-[calc(100dvh-60px)] w-full max-w-[440px] items-center px-4 py-10 sm:px-6"
    >
      <Card className="w-full gap-6 rounded-2xl py-7 shadow-sm">
        <CardHeader className="gap-2 px-6 sm:px-8">
          <h1 className="text-[23px] font-bold leading-tight tracking-tight">
            {t.admin.loginTitle}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t.admin.loginDescription}
          </p>
        </CardHeader>
        <CardContent className="px-6 sm:px-8">
          <form
            noValidate
            onSubmit={handleSubmit(submit)}
            className="flex flex-col gap-4"
          >
            {(["email", "password"] as const).map((field) => (
              <Field key={field} data-invalid={Boolean(errors[field])}>
                <FieldLabel htmlFor={field}>{t.auth[field]}</FieldLabel>
                <Input
                  id={field}
                  type={field}
                  autoComplete={
                    field === "email" ? "username" : "current-password"
                  }
                  maxLength={field === "email" ? 254 : 128}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(errors[field])}
                  aria-describedby={
                    errors[field] ? `${field}-error` : undefined
                  }
                  {...register(field)}
                />
                <FieldError id={`${field}-error`}>
                  {errors[field]?.message}
                </FieldError>
              </Field>
            ))}
            {failure && (
              <Alert variant="destructive">
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? t.auth.submitting : t.auth.loginAction}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
