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
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
} from "@freight/ui";
import { Link, useRouter } from "@freight/ui/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { AuthPanel } from "./auth-panel";

export type AuthMode = "login" | "forgot" | "reset" | "verification";
type Values = {
  email: string;
  password: string;
  newPassword: string;
};
const endpoints = {
  login: "/sign-in/email",
  forgot: "/request-password-reset",
  reset: "/reset-password",
  verification: "/send-verification-email",
} as const;

export function AuthForm({
  mode,
  locale,
  token = "",
  invalid = false,
  completed = false,
}: {
  mode: AuthMode;
  locale: Locale;
  token?: string;
  invalid?: boolean;
  completed?: boolean;
}) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const [failure, setFailure] = useState("");
  const {
    register,
    handleSubmit,
    setError,
    resetField,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    defaultValues: { email: "", password: "", newPassword: "" },
  });
  const title = {
    login: t.loginTitle,
    forgot: t.forgotTitle,
    reset: t.resetTitle,
    verification: t.verificationTitle,
  }[mode];
  const description = {
    login: t.loginDescription,
    forgot: t.forgotDescription,
    reset: t.resetDescription,
    verification: t.verificationDescription,
  }[mode];
  const action = {
    login: t.loginAction,
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
  if (mode !== "reset")
    fields.push({
      name: "email",
      label: t.email,
      type: "email",
      autoComplete: "email",
    });
  if (mode === "login")
    fields.push({
      name: "password",
      label: t.password,
      type: "password",
      autoComplete: "current-password",
    });
  if (mode === "reset")
    fields.push({
      name: "newPassword",
      label: t.newPassword,
      type: "password",
      autoComplete: "new-password",
    });

  async function submit(values: Values) {
    if (inFlight.current) return;
    setFailure("");
    setNotice("");
    const payload = {
      login: { email: values.email, password: values.password },
      forgot: { email: values.email, locale },
      reset: { token, newPassword: values.newPassword },
      verification: { email: values.email, locale },
    }[mode];
    const parsed = authBodies[endpoints[mode]].safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "email" || key === "password" || key === "newPassword") {
          setError(
            key,
            {
              message: key === "email" ? t.invalidEmail : t.invalidPassword,
            },
            { shouldFocus: true },
          );
        } else setFailure(t.invalidLink);
      }
      return;
    }
    inFlight.current = true;
    try {
      const result = await fetch(`/api/auth${endpoints[mode]}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
        credentials: "same-origin",
        redirect: "error",
      });
      const data: unknown = await result.json().catch(() => null);
      const code =
        data && typeof data === "object" && "code" in data
          ? data.code
          : undefined;
      if (!result.ok) {
        if (mode === "login" && code === "EMAIL_NOT_VERIFIED") {
          router.replace("/email-confirmation", { locale });
          return;
        }
        setFailure(
          result.status === 429
            ? t.limited
            : code === "INVALID_CREDENTIALS"
              ? t.invalidCredentials
              : result.status >= 500
                ? t.unavailable
                : t.error,
        );
        return;
      }
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
        router.replace("/account", { locale });
        return;
      }
      if (mode === "reset") {
        router.replace(
          { pathname: "/login", query: { reset: "done" } },
          { locale },
        );
        return;
      }
      setNotice(mode === "forgot" ? t.resetSent : t.sent);
    } catch {
      setFailure(t.unavailable);
    } finally {
      if (mode === "login") resetField("password");
      if (mode === "reset") resetField("newPassword");
      inFlight.current = false;
    }
  }

  return (
    <AuthPanel title={title} description={description}>
      {completed && mode === "login" && (
        <p role="status" className="mb-4 text-primary">
          {t.verifiedDone}
        </p>
      )}
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
                  maxLength={
                    field.type === "password" ? PASSWORD_MAX_LENGTH : 254
                  }
                  minLength={
                    field.type === "password" ? PASSWORD_MIN_LENGTH : undefined
                  }
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
                {mode === "reset" && field.type === "password" && (
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
              href="/forgot-password"
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
          <p>
            {t.noAccount}{" "}
            <Link
              className="font-semibold text-primary hover:underline"
              href="/signup"
            >
              {t.signup}
            </Link>
          </p>
        ) : (
          <Link
            className="font-semibold text-primary hover:underline"
            href="/login"
          >
            {t.backLogin}
          </Link>
        )}
        {unavailable && (
          <Link
            className="text-primary hover:underline"
            href="/forgot-password"
          >
            {t.forgotTitle}
          </Link>
        )}
      </div>
    </AuthPanel>
  );
}
