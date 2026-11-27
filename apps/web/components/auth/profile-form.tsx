"use client";

import { profileInput, publicProfile } from "@freight/auth/contracts";
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
  FieldLegend,
  FieldSet,
  Input,
} from "@freight/ui";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";

type Profile = z.infer<typeof publicProfile>;
type Values = {
  firstName: string;
  lastName: string;
  role: Profile["role"] | "";
  driverAge: string;
};

const roles = ["COMPANY_OWNER", "DISPATCHER", "DRIVER"] as const;

export function ProfileForm({
  locale,
  onComplete,
  onExpired,
}: {
  locale: Locale;
  onComplete: (profile: Profile) => void;
  onExpired: () => void;
}) {
  const t = messages[locale].auth;
  const [failure, setFailure] = useState("");
  const inFlight = useRef(false);
  const {
    control,
    register,
    handleSubmit,
    setError,
    setValue,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    defaultValues: { firstName: "", lastName: "", role: "", driverAge: "" },
  });
  const role = useWatch({ control, name: "role" });

  async function submit(values: Values) {
    if (inFlight.current) return;
    setFailure("");
    clearErrors();
    const parsed = profileInput.safeParse({
      firstName: values.firstName,
      lastName: values.lastName,
      role: values.role,
      ...(values.role === "DRIVER" && values.driverAge.trim()
        ? { driverAge: Number(values.driverAge) }
        : {}),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "firstName" || key === "lastName") {
          setError(key, { message: t.invalidName }, { shouldFocus: true });
        } else if (key === "driverAge") {
          setError(key, { message: t.invalidAge }, { shouldFocus: true });
        } else if (key === "role") {
          setError(key, { message: t.invalidRole });
        } else {
          setFailure(t.error);
        }
      }
      return;
    }
    inFlight.current = true;
    try {
      let response = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
        redirect: "error",
      });
      // Another tab may already have completed onboarding. Read the stored role.
      if (response.status === 409)
        response = await fetch("/api/auth/profile", { cache: "no-store" });
      if (response.status === 401) {
        onExpired();
        return;
      }
      if (!response.ok) {
        setFailure(
          response.status === 403
            ? t.profileDenied
            : response.status === 429
              ? t.limited
              : response.status >= 500
                ? t.unavailable
                : t.error,
        );
        return;
      }
      onComplete(publicProfile.parse(await response.json()));
    } catch {
      setFailure(t.unavailable);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <form
      noValidate
      onSubmit={handleSubmit(submit)}
      className="flex flex-col gap-5"
    >
      <FieldGroup className="gap-4">
        {(["firstName", "lastName"] as const).map((name) => (
          <Field key={name} data-invalid={Boolean(errors[name])}>
            <FieldLabel htmlFor={name}>{t[name]}</FieldLabel>
            <Input
              id={name}
              autoComplete={name === "firstName" ? "given-name" : "family-name"}
              maxLength={200}
              required
              aria-invalid={Boolean(errors[name])}
              aria-describedby={errors[name] ? `${name}-error` : undefined}
              disabled={isSubmitting}
              {...register(name)}
            />
            <FieldError id={`${name}-error`}>{errors[name]?.message}</FieldError>
          </Field>
        ))}
        <FieldSet
          className="gap-2"
          aria-describedby={errors.role ? "role-hint role-error" : "role-hint"}
        >
          <FieldLegend variant="label">{t.role}</FieldLegend>
          {roles.map((value) => (
            <Button
              key={value}
              variant={role === value ? "default" : "outline"}
              aria-pressed={role === value}
              className="w-full justify-between whitespace-normal"
              disabled={isSubmitting}
              onClick={() => {
                setValue("role", value);
                clearErrors("role");
              }}
            >
              {t.roles[value]}
              {role === value && <span aria-hidden="true">✓</span>}
            </Button>
          ))}
          <FieldDescription id="role-hint">{t.roleHint}</FieldDescription>
          <FieldError id="role-error">{errors.role?.message}</FieldError>
        </FieldSet>
        {role === "DRIVER" && (
          <Field data-invalid={Boolean(errors.driverAge)}>
            <FieldLabel htmlFor="driverAge">{t.driverAge}</FieldLabel>
            <Input
              id="driverAge"
              type="number"
              inputMode="numeric"
              min={1}
              max={2147483647}
              step={1}
              aria-invalid={Boolean(errors.driverAge)}
              aria-describedby={errors.driverAge ? "age-error" : undefined}
              disabled={isSubmitting}
              {...register("driverAge")}
            />
            <FieldError id="age-error">{errors.driverAge?.message}</FieldError>
          </Field>
        )}
      </FieldGroup>
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? t.submitting : t.completeProfile}
      </Button>
    </form>
  );
}
