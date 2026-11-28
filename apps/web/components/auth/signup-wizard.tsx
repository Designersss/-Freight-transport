"use client";

import {
  authBodies,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  registrationEmailAddress,
  registrationEmailComplete,
  registrationEmailRead,
  registrationEmailStart,
  usernameInput,
} from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  ChoiceOption,
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
type Step =
  | "method"
  | "email"
  | "confirmation"
  | "credentials"
  | "role"
  | "profile"
  | "username";
type Availability = {
  username: string;
  status: "available" | "taken" | "error";
};

const emailSteps: Step[] = ["credentials", "role", "profile", "username"];
const registrationOrder: Step[] = [
  "method",
  "email",
  "confirmation",
  ...emailSteps,
];
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
}: {
  locale: Locale;
}) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [step, setStep] = useState<Step>("method");
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [telegramPending, setTelegramPending] = useState(false);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [linkReady, setLinkReady] = useState(false);
  const proof = useRef("");
  const initialized = useRef(false);
  const confirmed = useRef(false);
  const steps = emailSteps;
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
    confirmationBusy;
  const status =
    canonical && availability?.username === canonical
      ? availability.status
      : canonical
        ? "checking"
        : "invalid";
  const stepIndex = steps.indexOf(step) + 1;
  const title = {
    method: t.signupTitle,
    email: t.registrationEmailTitle,
    confirmation: t.verificationTitle,
    credentials: t.registrationPasswordTitle,
    role: t.roleTitle,
    profile: t.signupProfileTitle,
    username: t.usernameTitle,
  }[step];
  const description = {
    method: t.registrationMethodDescription,
    email: t.signupDescription,
    confirmation: linkReady
      ? t.registrationLinkDescription
      : t.registrationEmailSent,
    credentials: t.registrationPasswordDescription,
    role: t.roleDescription,
    profile: t.signupProfileDescription,
    username: t.usernameDescription,
  }[step];

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const hash = window.location.hash;
    if (!hash) return;
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname,
    );
    const parsed = registrationEmailRead.safeParse({
      token: /^#token=[A-Za-z0-9_-]{43}$/.test(hash) ? hash.slice(7) : null,
    });
    if (parsed.success) {
      proof.current = parsed.data.token;
      setLinkReady(true);
      setStep("confirmation");
    } else {
      setFailure(t.invalidLink);
    }
  }, [t.invalidLink]);

  useEffect(() => {
    // A mail link can navigate the already open signup page by fragment only.
    // Reload for a new proof so an earlier password/profile cannot carry over.
    function reopenProof() {
      if (window.location.hash.startsWith("#token=")) window.location.reload();
    }
    window.addEventListener("hashchange", reopenProof);
    return () => window.removeEventListener("hashchange", reopenProof);
  }, []);

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
    setDirection(
      registrationOrder.indexOf(next) < registrationOrder.indexOf(step)
        ? "backward"
        : "forward",
    );
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

  async function advanceEmail(values: Credentials) {
    if (inFlight.current || telegramPending) return;
    setFailure("");
    credentials.clearErrors();
    const parsed = registrationEmailStart.safeParse({
      email: values.email,
      locale,
    });
    if (!parsed.success) {
      credentials.setError(
        "email",
        { message: t.invalidEmail },
        { shouldFocus: true },
      );
      return;
    }
    inFlight.current = true;
    try {
      const response = await post("registration/email/start", parsed.data);
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !successResponse.safeParse(data).success) {
        setFailure(response.status === 429 ? t.limited : t.unavailable);
        return;
      }
      proof.current = "";
      confirmed.current = false;
      setLinkReady(false);
      credentials.setValue("email", parsed.data.email);
      go("confirmation");
    } catch {
      setFailure(t.unavailable);
    } finally {
      inFlight.current = false;
    }
  }

  async function confirmEmail() {
    if (inFlight.current || !proof.current || !linkReady) return;
    inFlight.current = true;
    setConfirmationBusy(true);
    setFailure("");
    try {
      const response = await post("registration/email/read", {
        token: proof.current,
      });
      if (response.status === 400 || response.status === 409) {
        proof.current = "";
        setLinkReady(false);
        go("email");
        setFailure(
          response.status === 409 ? t.registrationExisting : t.invalidLink,
        );
        return;
      }
      if (!response.ok) {
        setFailure(response.status === 429 ? t.limited : t.unavailable);
        return;
      }
      const result = registrationEmailAddress.parse(await response.json());
      credentials.setValue("email", result.email);
      confirmed.current = true;
      go("credentials");
    } catch {
      setFailure(t.unavailable);
    } finally {
      inFlight.current = false;
      setConfirmationBusy(false);
    }
  }

  function advanceCredentials(values: Credentials) {
    if (confirmed.current && validateCredentials(values)) go("role");
  }

  function restartEmail() {
    proof.current = "";
    confirmed.current = false;
    setLinkReady(false);
    credentials.reset({ email: credentials.getValues("email"), password: "" });
    profile.reset(emptyProfile);
    names.reset({ username: "" });
    manuallyEdited.current = false;
    setAvailability(null);
    go("email");
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
    const account = validateCredentials(credentials.getValues());
    if (!account) {
      go("credentials");
      return;
    }
    const payload = registrationEmailComplete.safeParse({
      token: confirmed.current ? proof.current : "",
      password: account.password,
      registration,
    });
    if (!payload.success) {
      setFailure(t.error);
      return;
    }
    inFlight.current = true;
    try {
      const response = await post(
        "registration/email/complete",
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
        if (response.status === 400 || response.status === 409) {
          restartEmail();
          setFailure(
            response.status === 409 ? t.registrationExisting : t.invalidLink,
          );
          return;
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
      credentials.resetField("password");
      proof.current = "";
      confirmed.current = false;
      router.replace(
        { pathname: "/login", query: { verified: "done" } },
        { locale },
      );
    } catch {
      setFailure(t.unavailable);
    } finally {
      inFlight.current = false;
    }
  }

  function back() {
    if (step === "username") go("profile");
    else if (step === "profile") go("role");
    else if (step === "role") go("credentials");
    else if (step === "confirmation" || step === "credentials") restartEmail();
    else if (step === "email") go("method");
  }

  return (
    <AuthPanel title={title} description={description} headingRef={heading}>
      {stepIndex > 0 && (
        <div className="mb-5 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground" role="status">
            {t.signupStep} {stepIndex} {t.signupOf} {steps.length}
          </p>
          <div
            className="h-1 overflow-hidden rounded-full bg-muted"
            aria-hidden="true"
          >
            <div
              className="movaro-signup-progress h-full rounded-full bg-primary"
              style={{ width: `${(stepIndex / steps.length) * 100}%` }}
            />
          </div>
        </div>
      )}
      <div key={step} className="movaro-signup-step" data-direction={direction}>
        {step === "method" && (
          <div className="flex flex-col gap-3">
            <ChoiceOption
              choice="email"
              title={t.email}
              description={t.registrationEmailMethod}
              disabled={busy}
              onSelect={() => go("email")}
            />
            <TelegramButton
              locale={locale}
              intent="register"
              disabled={credentials.formState.isSubmitting}
              onPendingChange={setTelegramPending}
            />
          </div>
        )}
        {step === "email" && (
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={credentials.handleSubmit(advanceEmail)}
          >
            <Field data-invalid={Boolean(credentials.formState.errors.email)}>
              <FieldLabel htmlFor="email">{t.email}</FieldLabel>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                disabled={busy}
                aria-invalid={Boolean(credentials.formState.errors.email)}
                aria-describedby="email-error"
                {...credentials.register("email")}
              />
              <FieldError id="email-error">
                {credentials.formState.errors.email?.message}
              </FieldError>
            </Field>
            <Button type="submit" size="lg" disabled={busy}>
              {busy ? t.submitting : t.continue}
            </Button>
          </form>
        )}
        {step === "confirmation" && (
          <div className="flex flex-col gap-4">
            {linkReady ? (
              <Button
                size="lg"
                disabled={busy}
                onClick={() => void confirmEmail()}
              >
                {busy ? t.submitting : t.registrationConfirmAction}
              </Button>
            ) : (
              <>
                <p role="status" className="break-all text-sm">
                  {credentials.getValues("email")}
                </p>
                <Button
                  size="lg"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void credentials.handleSubmit(advanceEmail)()}
                >
                  {busy ? t.submitting : t.resend}
                </Button>
              </>
            )}
          </div>
        )}
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
                      readOnly={field === "email"}
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
              {busy ? t.submitting : t.signupAction}
            </Button>
          </form>
        )}
      </div>
      {failure && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      {step !== "method" && (
        <Button
          className="mt-3 w-full"
          variant="ghost"
          disabled={busy}
          onClick={back}
        >
          {t.back}
        </Button>
      )}
        <div className="mt-5 text-center">
          <Link
            className="font-semibold text-primary hover:underline"
            href="/login"
          >
            {t.backLogin}
          </Link>
        </div>
    </AuthPanel>
  );
}
