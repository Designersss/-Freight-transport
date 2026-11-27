"use client";

import { publicProfile } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@freight/ui";
import { useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  emptyProfile,
  type Profile,
  ProfileFields,
  type ProfileValues,
  roles,
  validateProfile,
} from "./profile-fields";

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
  const form = useForm<ProfileValues>({ defaultValues: emptyProfile });
  const {
    control,
    handleSubmit,
    setValue,
    clearErrors,
    formState: { errors, isSubmitting },
  } = form;
  const role = useWatch({ control, name: "role" });

  async function submit(values: ProfileValues) {
    if (inFlight.current) return;
    setFailure("");
    const profile = validateProfile(values, locale, form);
    if (!profile) return;
    inFlight.current = true;
    try {
      let response = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
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
        <ProfileFields form={form} locale={locale} disabled={isSubmitting} />
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
