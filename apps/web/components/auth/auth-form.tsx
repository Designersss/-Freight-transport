"use client";

import { authBodies } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
} from "@freight/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { AuthPanel } from "./auth-panel";

export type AuthMode = "login" | "signup" | "forgot" | "reset" | "verification";
type Values = {
  name: string;
  email: string;
  password: string;
  newPassword: string;
};
const endpoints = {
  login: "/sign-in/email",
  signup: "/sign-up/email",
  forgot: "/request-password-reset",
  reset: "/reset-password",
  verification: "/send-verification-email",
} as const;

export function AuthForm({
  mode,
  locale,
  token = "",
  invalid = false,
}: {
  mode: AuthMode;
  locale: Locale;
  token?: string;
  invalid?: boolean;
}) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    defaultValues: { name: "", email: "", password: "", newPassword: "" },
  });
  const title = {
    login: t.loginTitle,
    signup: t.signupTitle,
    forgot: t.forgotTitle,
    reset: t.resetTitle,
    verification: t.verificationTitle,
  }[mode];
  const description = {
    login: t.loginDescription,
    signup: t.signupDescription,
    forgot: t.forgotDescription,
    reset: t.resetDescription,
    verification: t.verificationDescription,
  }[mode];
  const action = {
    login: t.loginAction,
    signup: t.signupAction,
    forgot: t.send,
    reset: t.resetAction,
    verification: t.resend,
  }[mode];
  const unavailable = mode === "reset" && (!token || invalid);
  const fields: Array<{
    name: keyof Values;
    label: string;
    type: string;
    autoComplete: string;
  }> = [];
  if (mode === "signup")
    fields.push({
      name: "name",
      label: t.name,
      type: "text",
      autoComplete: "name",
    });
  if (mode !== "reset")
    fields.push({
      name: "email",
      label: t.email,
      type: "email",
      autoComplete: "email",
    });
  if (mode === "login" || mode === "signup")
    fields.push({
      name: "password",
      label: t.password,
      type: "password",
      autoComplete: mode === "login" ? "current-password" : "new-password",
    });
  if (mode === "reset")
    fields.push({
      name: "newPassword",
      label: t.newPassword,
      type: "password",
      autoComplete: "new-password",
    });

  async function submit(values: Values) {
    setFailure("");
    setNotice("");
    const payload = {
      login: { email: values.email, password: values.password },
      signup: {
        name: values.name,
        email: values.email,
        password: values.password,
        locale,
      },
      forgot: { email: values.email, locale },
      reset: { token, newPassword: values.newPassword },
      verification: { email: values.email, locale },
    }[mode];
    const parsed = authBodies[endpoints[mode]].safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (
          key === "email" ||
          key === "name" ||
          key === "password" ||
          key === "newPassword"
        ) {
          setError(
            key,
            {
              message:
                key === "email"
                  ? t.invalidEmail
                  : key === "name"
                    ? t.invalidName
                    : t.invalidPassword,
            },
            { shouldFocus: true },
          );
        } else setFailure(t.invalidLink);
      }
      return;
    }
    try {
      const result = await fetch(`/api/auth${endpoints[mode]}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
        credentials: "same-origin",
        redirect: "error",
      });
      if (!result.ok) {
        setFailure(
          result.status === 429
            ? t.limited
            : result.status >= 500
              ? t.unavailable
              : t.error,
        );
        return;
      }
      const data: unknown = await result.json();
      if (
        !data ||
        typeof data !== "object" ||
        !("success" in data) ||
        data.success !== true
      ) {
        setFailure(t.error);
        return;
      }
      if (mode === "login") {
        router.replace(`/${locale}/account`);
        return;
      }
      if (mode === "signup") {
        router.replace(`/${locale}/email-confirmation`);
        return;
      }
      if (mode === "reset") {
        router.replace(`/${locale}/login?reset=done`);
        return;
      }
      setNotice(mode === "forgot" ? t.resetSent : t.sent);
    } catch {
      setFailure(t.unavailable);
    }
  }

  return (
    <AuthPanel title={title} description={description}>
      {unavailable ? (
        <p role="alert" className="text-destructive">
          {t.invalidLink}
        </p>
      ) : (
        <form
          noValidate
          onSubmit={handleSubmit(submit)}
          className="flex flex-col gap-5"
        >
          {invalid && mode === "verification" && (
            <p role="alert" className="text-destructive">
              {t.verificationError}
            </p>
          )}
          <FieldGroup className="gap-4">
            {fields.map((field) => (
              <Field
                key={field.name}
                data-invalid={Boolean(errors[field.name])}
              >
                <FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
                <Input
                  id={field.name}
                  type={field.type}
                  autoComplete={field.autoComplete}
                  aria-invalid={Boolean(errors[field.name])}
                  aria-describedby={
                    errors[field.name] ? `${field.name}-error` : undefined
                  }
                  disabled={isSubmitting}
                  {...register(field.name)}
                />
                <FieldError id={`${field.name}-error`}>
                  {errors[field.name]?.message}
                </FieldError>
                {(mode === "signup" || mode === "reset") &&
                  field.type === "password" && (
                    <p className="text-xs text-muted-foreground">
                      {t.passwordHint}
                    </p>
                  )}
              </Field>
            ))}
          </FieldGroup>
          {mode === "login" && (
            <Link
              className="self-end text-primary hover:underline"
              href={`/${locale}/forgot-password`}
            >
              {t.forgot}
            </Link>
          )}
          {failure && (
            <Alert variant="destructive">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-lg border border-border bg-muted p-3"
            >
              {notice}
            </p>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? t.submitting : action}
          </Button>
        </form>
      )}
      <div className="mt-5 flex flex-col gap-2 text-center text-muted-foreground">
        {mode === "login" ? (
          <>
            <p>
              {t.noAccount}{" "}
              <Link
                className="font-semibold text-primary hover:underline"
                href={`/${locale}/signup`}
              >
                {t.signup}
              </Link>
            </p>
            <Link
              className="text-primary hover:underline"
              href={`/${locale}/email-confirmation`}
            >
              {t.verificationTitle}
            </Link>
          </>
        ) : (
          <Link
            className="font-semibold text-primary hover:underline"
            href={`/${locale}/login`}
          >
            {t.backLogin}
          </Link>
        )}
        {unavailable && (
          <Link
            className="text-primary hover:underline"
            href={`/${locale}/forgot-password`}
          >
            {t.forgotTitle}
          </Link>
        )}
      </div>
    </AuthPanel>
  );
}
