"use client";

import {
  publicUsernameSettings,
  usernameChangeInput,
} from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Separator,
  Skeleton,
} from "@freight/ui";
import { useRouter } from "@freight/ui/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

type Settings = z.infer<typeof publicUsernameSettings>;
type Values = { username: string };

const endpoint = "/api/auth/username/settings";
const errorResponse = z.object({ code: z.string() });

export function UsernameSettings({ locale }: { locale: Locale }) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(() => new AbortController());
  const [failure, setFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const {
    register,
    handleSubmit,
    reset,
    clearErrors,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({ defaultValues: { username: "" } });

  useEffect(() => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    request.signal.addEventListener("abort", cancel, { once: true });
    async function load() {
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          signal: controller.signal,
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
                : t.unavailable,
          );
          return;
        }
        const data = publicUsernameSettings.parse(await response.json());
        if (controller.signal.aborted) return;
        setSettings(data);
        reset({ username: data.username ?? "" });
      } catch {
        if (!controller.signal.aborted) setFailure(t.unavailable);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      request.signal.removeEventListener("abort", cancel);
      controller.abort();
    };
  }, [locale, request, reset, router, t]);

  function refresh() {
    setSettings(null);
    setFailure("");
    setSaved(false);
    setLoading(true);
    request.abort();
    setRequest(new AbortController());
  }

  async function submit(values: Values) {
    if (inFlight.current || !settings || settings.nextChangeAt !== null) return;
    clearErrors();
    setFailure("");
    setSaved(false);
    const parsed = usernameChangeInput.safeParse(values);
    if (!parsed.success) {
      setError(
        "username",
        { message: t.usernameInvalid },
        { shouldFocus: true },
      );
      return;
    }
    if (parsed.data.username === settings.username) {
      reset({ username: parsed.data.username });
      return;
    }

    inFlight.current = true;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(parsed.data),
      });
      if (response.status === 401) {
        router.replace("/login", { locale });
        return;
      }
      const raw: unknown = await response.json().catch(() => null);
      const error = errorResponse.safeParse(raw);
      if (response.status === 409 && error.success) {
        if (error.data.code === "USERNAME_TAKEN") {
          setError(
            "username",
            { message: t.usernameTaken },
            { shouldFocus: true },
          );
          return;
        }
        if (error.data.code === "USERNAME_CHANGE_COOLDOWN") {
          refresh();
          return;
        }
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
      const updated = publicUsernameSettings.parse(raw);
      setSettings(updated);
      reset({ username: updated.username ?? "" });
      setSaved(true);
    } catch {
      setFailure(t.unavailable);
    } finally {
      inFlight.current = false;
    }
  }

  const nextChangeAt = settings?.nextChangeAt;
  const locked = Boolean(nextChangeAt);
  const nextChangeLabel = nextChangeAt
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(nextChangeAt))
    : null;

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="username-settings-title"
    >
      <Separator />
      <h2 id="username-settings-title" className="font-semibold">
        {t.usernameSettingsTitle}
      </h2>
      {loading && <Skeleton className="h-24 w-full" />}
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      {!loading && !settings && (
        <Button variant="outline" onClick={refresh}>
          {t.retry}
        </Button>
      )}
      {settings && (
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={handleSubmit(submit)}
        >
          <Field data-invalid={Boolean(errors.username)}>
            <FieldLabel htmlFor="settings-username">{t.username}</FieldLabel>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
              >
                @
              </span>
              <Input
                id="settings-username"
                className="pl-8"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={32}
                readOnly={locked}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.username)}
                aria-describedby={
                  errors.username
                    ? "settings-username-error settings-username-hint"
                    : "settings-username-hint"
                }
                {...register("username")}
              />
            </div>
            <FieldError id="settings-username-error">
              {errors.username?.message}
            </FieldError>
            <FieldDescription id="settings-username-hint">
              {t.usernameWeekly}
            </FieldDescription>
            {!locked && <FieldDescription>{t.usernameHint}</FieldDescription>}
          </Field>
          {saved && <p role="status">{t.usernameSaved}</p>}
          {locked ? (
            <>
              <p role="status" className="text-sm text-muted-foreground">
                {t.usernameNextChange} {nextChangeLabel}
              </p>
              <Button variant="outline" onClick={refresh}>
                {t.refreshAvailability}
              </Button>
            </>
          ) : (
            <Button type="submit" disabled={!isDirty || isSubmitting}>
              {isSubmitting ? t.submitting : t.saveUsername}
            </Button>
          )}
        </form>
      )}
    </section>
  );
}
