"use client";

import { profileSettingsInput, publicProfile } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  formatDateInput,
  parseDateInput,
  Separator,
} from "@freight/ui";
import { useRouter } from "@freight/ui/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  PersonalFields,
  type Profile,
  type ProfileValues,
} from "./profile-fields";

function formValues(profile: Profile, locale: Locale): ProfileValues {
  return {
    ...profile,
    companyName: profile.companyName ?? "",
    birthDate: formatDateInput(profile.birthDate, locale),
  };
}

export function ProfileSettings({
  locale,
  profile,
  onSaved,
}: {
  locale: Locale;
  profile: Profile;
  onSaved: (profile: Profile) => void;
}) {
  const t = messages[locale].auth;
  const router = useRouter();
  const operation = useRef<AbortController | null>(null);
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const form = useForm<ProfileValues>({
    defaultValues: formValues(profile, locale),
  });
  const {
    handleSubmit,
    setError,
    clearErrors,
    reset,
    formState: { isDirty, isSubmitting },
  } = form;

  useEffect(() => () => operation.current?.abort(), []);

  async function submit(values: ProfileValues) {
    if (operation.current) return;
    clearErrors();
    setFailure("");
    setSaved(false);
    const parsed = profileSettingsInput.safeParse({
      firstName: values.firstName,
      lastName: values.lastName,
      birthDate: parseDateInput(values.birthDate, locale) ?? "",
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === "firstName" || key === "lastName")
          setError(key, { message: t.invalidName }, { shouldFocus: true });
        else if (key === "birthDate")
          setError(key, { message: t.invalidBirthDate }, { shouldFocus: true });
      }
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    try {
      const response = await fetch("/api/auth/profile/settings", {
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
      const updated = publicProfile.parse(await response.json());
      if (controller.signal.aborted) return;
      onSaved(updated);
      reset(formValues(updated, locale));
      setSaved(true);
    } catch {
      if (!controller.signal.aborted) setFailure(t.unavailable);
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }

  return (
    <section
      aria-labelledby="personal-settings-title"
      className="flex flex-col gap-3"
    >
      <Separator />
      <h2 id="personal-settings-title" className="font-semibold">
        {t.personalTitle}
      </h2>
      <form
        noValidate
        onSubmit={handleSubmit(submit)}
        className="flex flex-col gap-3"
      >
        <PersonalFields form={form} locale={locale} disabled={isSubmitting} />
        {failure && (
          <Alert variant="destructive">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        )}
        {saved && <p role="status">{t.personalSaved}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!isDirty || isSubmitting}>
            {isSubmitting ? t.submitting : t.personalSave}
          </Button>
          <Button
            variant="outline"
            disabled={!isDirty || isSubmitting}
            onClick={() => {
              reset(formValues(profile, locale));
              setFailure("");
              setSaved(false);
            }}
          >
            {t.cancelAction}
          </Button>
        </div>
      </form>
    </section>
  );
}
