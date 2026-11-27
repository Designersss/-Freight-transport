"use client";

import {
  authBodies,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  registrationInput,
  usernameInput,
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
  RoleOption,
} from "@freight/ui";
import { Link, useRouter } from "@freight/ui/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { AuthPanel } from "./auth-panel";
import {
  emptyProfile,
  ProfileFields,
  type ProfileValues,
  roles,
  validateProfile,
} from "./profile-fields";

import { TelegramButton } from "./telegram-button";

type Credentials = { email: string; password: string };
type UsernameValues = { username: string };
type Step = "credentials" | "role" | "profile" | "username";
type Availability = {
  username: string;
  status: "available" | "taken" | "error";
};

const emailSteps: Step[] = ["credentials", "role", "profile", "username"];
const telegramSteps: Step[] = ["role", "profile", "username"];
const suggestionResponse = z.object({ username: usernameInput });
const availabilityResponse = z.object({ available: z.boolean() });
const successResponse = z.object({ success: z.literal(true) });
const errorResponse = z.object({ code: z.string() });

function post(path: string, data: unknown, signal?: AbortSignal) {
  return fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
    body: JSON.stringify(data),
    ...(signal ? { signal } : {}),
  });
}

export function SignupWizard({
  locale,
  telegram = false,
  onLogout,
  logoutBusy = false,
  logoutError = false,
}: {
  locale: Locale;
  telegram?: boolean;
  onLogout?: () => void;
  logoutBusy?: boolean;
  logoutError?: boolean;
}) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [step, setStep] = useState<Step>(telegram ? "role" : "credentials");
  const [telegramPending, setTelegramPending] = useState(false);
  const steps = telegram ? telegramSteps : emailSteps;
  const [failure, setFailure] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const manuallyEdited = useRef(false);
  const credentials = useForm<Credentials>({
    defaultValues: { email: "", password: "" },
    shouldUnregister: false,
  });
  const profile = useForm<ProfileValues>({
    defaultValues: emptyProfile,
    shouldUnregister: false,
  });
  const names = useForm<UsernameValues>({
    defaultValues: { username: "" },
    shouldUnregister: false,
  });
  const username = useWatch({ control: names.control, name: "username" });
  const parsedUsername = usernameInput.safeParse(username);
  const canonical = parsedUsername.success ? parsedUsername.data : null;
  const usernameError = names.formState.errors.username?.message;
  const busy =
    credentials.formState.isSubmitting ||
    profile.formState.isSubmitting ||
    names.formState.isSubmitting ||
    telegramPending ||
    logoutBusy;
  const status =
    canonical && availability?.username === canonical
      ? availability.status
      : canonical
        ? "checking"
        : "invalid";
  const stepIndex = steps.indexOf(step) + 1;
  const title = {
    credentials: t.signupTitle,
    role: t.roleTitle,
    profile: t.signupProfileTitle,
    username: t.usernameTitle,
  }[step];
  const description = {
    credentials: t.signupDescription,
    role: t.roleDescription,
    profile: t.signupProfileDescription,
    username: t.usernameDescription,
  }[step];

  useEffect(() => {
    const element = heading.current;
    if (element?.textContent === title) element.focus();
  }, [title]);

  useEffect(() => {
    if (step !== "username" || !canonical || busy || usernameError) return;
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const response = await post(
          "username",
          { action: "check", username: canonical },
          controller.signal,
        );
        if (!response.ok) throw new Error("Availability unavailable");
        const result = availabilityResponse.parse(await response.json());
        if (!controller.signal.aborted)
          setAvailability({
            username: canonical,
            status: result.available ? "available" : "taken",
          });
      } catch {
        if (!controller.signal.aborted)
          setAvailability({ username: canonical, status: "error" });
      }
    }, 350);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [step, canonical, busy, usernameError]);

  function go(next: Step) {
    setFailure("");
    setStep(next);
  }

  function validateCredentials(values: Credentials) {
    credentials.clearErrors();
    const parsed = authBodies["/sign-in/email"].safeParse(values);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "email" || field === "password")
        credentials.setError(
          field,
          { message: field === "email" ? t.invalidEmail : t.invalidPassword },
          { shouldFocus: true },
        );
    }
    return null;
  }

  function advanceCredentials(values: Credentials) {
    if (!telegramPending && validateCredentials(values)) go("role");
  }

  async function advanceProfile(values: ProfileValues) {
    if (inFlight.current) return;
    setFailure("");
    const parsed = validateProfile(values, locale, profile);
    if (!parsed) return;
    if (manuallyEdited.current) {
      go("username");
      return;
    }
    inFlight.current = true;
    try {
      const response = await post("username", {
        action: "suggest",
        firstName: parsed.firstName,
        lastName: parsed.lastName,
      });
      if (!response.ok) {
        setFailure(response.status === 429 ? t.limited : t.usernameUnavailable);
        return;
      }
      const result = suggestionResponse.parse(await response.json());
      names.setValue("username", result.username);
      names.clearErrors();
      setAvailability({ username: result.username, status: "available" });
      go("username");
    } catch {
      setFailure(t.usernameUnavailable);
    } finally {
      inFlight.current = false;
    }
  }

  async function submit(values: UsernameValues) {
    if (inFlight.current) return;
    setFailure("");
    names.clearErrors();
    const name = usernameInput.safeParse(values.username);
    if (!name.success) {
      names.setError(
        "username",
        { message: t.usernameInvalid },
        { shouldFocus: true },
      );
      return;
    }
    const details = validateProfile(profile.getValues(), locale, profile);
    if (!details) {
      go("profile");
      return;
    }
    const registration = { profile: details, username: name.data };
    const account = telegram
      ? null
      : validateCredentials(credentials.getValues());
    if (!telegram && !account) {
      go("credentials");
      return;
    }
    const payload = telegram
      ? registrationInput.safeParse(registration)
      : authBodies["/sign-up/email"].safeParse({
          ...account,
          locale,
          registration,
        });
    if (!payload.success) {
      setFailure(t.error);
      return;
    }
    inFlight.current = true;
    try {
      const response = await post(
        telegram ? "telegram/registration" : "sign-up/email",
        payload.data,
      );
      const data: unknown = await response.json().catch(() => null);
      const error = errorResponse.safeParse(data);
      if (
        response.status === 409 &&
        error.success &&
        error.data.code === "USERNAME_TAKEN"
      ) {
        setAvailability({ username: name.data, status: "taken" });
        names.setError(
          "username",
          { message: t.usernameTaken },
          { shouldFocus: true },
        );
        return;
      }
      if (!response.ok || !successResponse.safeParse(data).success) {
        if (telegram && response.status === 401) {
          router.replace("/login", { locale });
          return;
        }
        if (!telegram) {
          credentials.resetField("password");
          setStep("credentials");
        }
        setFailure(
          response.status === 429
            ? t.limited
            : response.status >= 500
              ? t.unavailable
              : t.error,
        );
        return;
      }
      if (telegram) {
        window.location.reload();
        return;
      }
      credentials.resetField("password");
      router.replace("/email-confirmation", { locale });
    } catch {
      if (!telegram) {
        credentials.resetField("password");
        setStep("credentials");
      }
      setFailure(t.unavailable);
    } finally {
      inFlight.current = false;
    }
  }

  function back() {
    if (step === "username") go("profile");
    else if (step === "profile") go("role");
    else if (step === "role" && !telegram) go("credentials");
  }

  return (
    <AuthPanel title={title} description={description} headingRef={heading}>
      <div className="mb-5 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground" role="status">
          {t.signupStep} {stepIndex} {t.signupOf} {steps.length}
        </p>
        <div
          className={telegram ? "grid grid-cols-3 gap-1" : "grid grid-cols-4 gap-1"}
          aria-hidden="true"
        >
          {steps.map((value, index) => (
            <span
              key={value}
              className={
                index < stepIndex
                  ? "h-1 rounded-full bg-primary"
                  : "h-1 rounded-full bg-muted"
              }
            />
          ))}
        </div>
      </div>
      <div key={step} className="movaro-signup-step">
        {step === "credentials" && (
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={credentials.handleSubmit(advanceCredentials)}
          >
            <FieldGroup>
              {(["email", "password"] as const).map((field) => {
                const error = credentials.formState.errors[field];
                return (
                  <Field key={field} data-invalid={Boolean(error)}>
                    <FieldLabel htmlFor={field}>{t[field]}</FieldLabel>
                    <Input
                      id={field}
                      type={field === "email" ? "email" : "password"}
                      autoComplete={
                        field === "email" ? "email" : "new-password"
                      }
                      maxLength={field === "email" ? 254 : PASSWORD_MAX_LENGTH}
                      minLength={
                        field === "password" ? PASSWORD_MIN_LENGTH : undefined
                      }
                      required
                      aria-invalid={Boolean(error)}
                      aria-describedby={
                        error
                          ? `${field}-error`
                          : field === "password"
                            ? "password-hint"
                            : undefined
                      }
                      disabled={busy}
                      {...credentials.register(field)}
                    />
                    <FieldError id={`${field}-error`}>
                      {error?.message}
                    </FieldError>
                    {field === "password" && (
                      <p
                        id="password-hint"
                        className="text-xs text-muted-foreground"
                      >
                        {t.passwordHint}
                      </p>
                    )}
                  </Field>
                );
              })}
            </FieldGroup>
            <Button type="submit" size="lg" disabled={busy}>
              {t.continue}
            </Button>
          </form>
        )}
        {step === "role" && (
          <div className="flex flex-col gap-3">
            {roles.map((role) => (
              <RoleOption
                key={role}
                role={role}
                title={t.roles[role]}
                description={t.roleDescriptions[role]}
                disabled={busy}
                onSelect={() => {
                  profile.setValue("role", role);
                  profile.clearErrors("role");
                  go("profile");
                }}
              />
            ))}
          </div>
        )}
        {step === "profile" && (
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={profile.handleSubmit(advanceProfile)}
          >
            <ProfileFields form={profile} locale={locale} disabled={busy} />
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? t.submitting : t.continue}
            </Button>
          </form>
        )}
        {step === "username" && (
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={names.handleSubmit(submit)}
          >
            <Field data-invalid={Boolean(usernameError)}>
              <FieldLabel htmlFor="username">{t.username}</FieldLabel>
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                >
                  @
                </span>
                <Input
                  id="username"
                  className="pl-8"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={32}
                  required
                  disabled={busy}
                  aria-invalid={Boolean(usernameError)}
                  aria-describedby="username-hint username-status username-error"
                  {...names.register("username", {
                    onChange: () => {
                      manuallyEdited.current = true;
                      names.clearErrors("username");
                    },
                  })}
                />
              </div>
              <p id="username-hint" className="text-xs text-muted-foreground">
                {t.usernameHint}
              </p>
              <p id="username-status" role="status" className="text-xs">
                {!usernameError &&
                  (status === "checking"
                    ? t.usernameChecking
                    : status === "available"
                      ? t.usernameAvailable
                      : status === "taken"
                        ? t.usernameTaken
                        : status === "error"
                          ? t.usernameUnavailable
                          : "")}
              </p>
              <FieldError id="username-error">{usernameError}</FieldError>
            </Field>
            <Button type="submit" size="lg" disabled={busy}>
              {busy
                ? t.submitting
                : telegram
                  ? t.completeProfile
                  : t.signupAction}
            </Button>
          </form>
        )}
      </div>
      {failure && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      {!telegram && step === "credentials" && (
        <TelegramButton
          locale={locale}
          intent="register"
          disabled={credentials.formState.isSubmitting}
          onPendingChange={setTelegramPending}
        />
      )}
      {stepIndex > 1 && (
        <Button
          className="mt-3 w-full"
          variant="ghost"
          disabled={busy}
          onClick={back}
        >
          {t.back}
        </Button>
      )}
      {telegram ? (
        <div className="mt-5 flex flex-col gap-2">
          {logoutError && (
            <Alert variant="destructive">
              <AlertDescription>{t.unavailable}</AlertDescription>
            </Alert>
          )}
          <Button variant="outline" disabled={busy} onClick={onLogout}>
            {t.logout}
          </Button>
        </div>
      ) : (
        <div className="mt-5 text-center">
          <Link
            className="font-semibold text-primary hover:underline"
            href="/login"
          >
            {t.backLogin}
          </Link>
        </div>
      )}
    </AuthPanel>
  );
}
