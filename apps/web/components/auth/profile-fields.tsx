"use client";

import { profileInput, type publicProfile } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  DatePicker,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  parseDateInput,
} from "@freight/ui";
import { Controller, type UseFormReturn, useWatch } from "react-hook-form";
import type { z } from "zod";

export type Profile = z.infer<typeof publicProfile>;
export type ProfileValues = {
  firstName: string;
  lastName: string;
  role: Profile["role"] | "";
  birthDate: string;
  companyName: string;
};

export const roles = ["COMPANY_OWNER", "DISPATCHER", "DRIVER"] as const;
export const emptyProfile: ProfileValues = {
  firstName: "",
  lastName: "",
  role: "",
  birthDate: "",
  companyName: "",
};

export function validateProfile(
  values: ProfileValues,
  locale: Locale,
  form: UseFormReturn<ProfileValues>,
) {
  const t = messages[locale].auth;
  const { setError, clearErrors } = form;
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
        form.setError("root", { message: t.error });
      }
    }
    return null;
  }
  return parsed.data;
}

export function ProfileFields({
  form,
  locale,
  disabled,
}: {
  form: UseFormReturn<ProfileValues>;
  locale: Locale;
  disabled: boolean;
}) {
  const t = messages[locale].auth;
  const {
    control,
    register,
    formState: { errors },
  } = form;
  const role = useWatch({ control, name: "role" });
  return (
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
            disabled={disabled}
            {...register(name)}
          />
          <FieldError id={`${name}-error`}>
            {errors[name]?.message}
          </FieldError>
        </Field>
      ))}
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
              disabled={disabled}
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
            disabled={disabled}
            {...register("companyName")}
          />
          <FieldError id="company-name-error">
            {errors.companyName?.message}
          </FieldError>
        </Field>
      )}
    </FieldGroup>
  );
}
