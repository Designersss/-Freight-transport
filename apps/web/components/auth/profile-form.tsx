"use client";

import { profileInput, publicProfile } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  DatePicker,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  parseDateInput,
} from "@freight/ui";
import { useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";

type Profile = z.infer<typeof publicProfile>;
type Values = {
  firstName: string;
  lastName: string;
  role: Profile["role"] | "";
  birthDate: string;
  companyName: string;
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
    defaultValues: {
      firstName: "",
      lastName: "",
      role: "",
      birthDate: "",
      companyName: "",
    },
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
      birthDate: parseDateInput(values.birthDate, locale) ?? "",
      ...(values.role === "COMPANY_OWNER"
        ? { companyName: values.companyName }
        : {}),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "firstName" || key === "lastName") {
          setError(key, { message: t.invalidName }, { shouldFocus: true });
        } else if (key === "birthDate") {
          setError(key, { message: t.invalidBirthDate }, { shouldFocus: true });
        } else if (key === "companyName") {
          setError(key, { message: t.invalidName }, { shouldFocus: true });
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
            <FieldError id={`${name}-error`}>
              {errors[name]?.message}
            </FieldError>
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
        <Field data-invalid={Boolean(errors.birthDate)}>
          <FieldLabel htmlFor="birthDate">{t.birthDate}</FieldLabel>
          <Controller
            control={control}
            name="birthDate"
            render={({ field }) => (
              <DatePicker
                {...field}
                id="birthDate"
                locale={locale}
                autoComplete="bday"
                min="0001-01-01"
                max={new Date().toISOString().slice(0, 10)}
                required
                aria-invalid={Boolean(errors.birthDate)}
                aria-describedby={
                  errors.birthDate ? "birth-date-error" : undefined
                }
                disabled={isSubmitting}
              />
            )}
          />
          <FieldError id="birth-date-error">
            {errors.birthDate?.message}
          </FieldError>
        </Field>
        {role === "COMPANY_OWNER" && (
          <Field data-invalid={Boolean(errors.companyName)}>
            <FieldLabel htmlFor="companyName">{t.companyName}</FieldLabel>
            <Input
              id="companyName"
              autoComplete="organization"
              maxLength={200}
              required
              aria-invalid={Boolean(errors.companyName)}
              aria-describedby={
                errors.companyName ? "company-name-error" : undefined
              }
              disabled={isSubmitting}
              {...register("companyName")}
            />
            <FieldError id="company-name-error">
              {errors.companyName?.message}
            </FieldError>
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
