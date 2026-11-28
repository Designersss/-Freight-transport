"use client";

import { usernameInput } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  Field,
  FieldError,
  FieldLabel,
  formatDateInput,
  Input,
  RoleOption,
} from "@freight/ui";
import { Link } from "@freight/ui/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  telegramBrowserRequest,
  telegramDraftResponse,
  type telegramDraftSchema,
} from "../../lib/telegram-browser";
import { AuthPanel } from "./auth-panel";
import {
  ProfileFields,
  type ProfileValues,
  roles,
  validateProfile,
} from "./profile-fields";

type Draft = z.infer<typeof telegramDraftSchema>;
type Step = "role" | "profile" | "username";

const completionResponse = z.strictObject({
  outcome: z.enum(["created", "invalid", "denied", "username-taken", "identity-taken"]),
});

function initialStep(draft: Draft): Step {
  if (!draft.role) return "role";
  if (
    !draft.firstName ||
    !draft.lastName ||
    !draft.birthDate ||
    (draft.role === "COMPANY_OWNER" && !draft.companyName)
  )
    return "profile";
  return "username";
}

export function TelegramRegistration({ locale }: { locale: Locale }) {
  const t = messages[locale].auth;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftFailure, setDraftFailure] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error" | "created">("loading");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await telegramBrowserRequest(
        { action: "draft-find" },
        telegramDraftResponse,
        signal,
      );
      if (!signal?.aborted) {
        setDraft(result.draft);
        setDraftFailure("");
        setState("ready");
      }
    } catch {
      if (!signal?.aborted) setState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (state === "ready" && draft)
    return (
      <TelegramDraftForm
        key={`${draft.id}:${draft.revision}`}
        locale={locale}
        draft={draft}
        initialFailure={draftFailure}
        onChanged={(next, failure = "") => {
          setDraft(next);
          setDraftFailure(failure);
        }}
        onRefresh={() => void load()}
        onCreated={() => {
          setDraft(null);
          setState("created");
        }}
      />
    );

  return (
    <AuthPanel title={t.telegramBotDraft} description={t.signupProfileDescription}>
      <div className="flex flex-col gap-3">
        {state === "loading" ? (
          <p role="status">{t.submitting}</p>
        ) : (
          <>
            <Alert variant={state === "created" ? "default" : "destructive"}>
              <AlertDescription>
                {state === "created" ? t.telegramBotRegistered : t.telegramBotReturnError}
              </AlertDescription>
            </Alert>
            {state === "error" && (
              <Button variant="outline" onClick={() => void load()}>
                {t.retry}
              </Button>
            )}
            <Button asChild size="lg">
              <Link href="/login">{t.telegramLogin}</Link>
            </Button>
          </>
        )}
      </div>
    </AuthPanel>
  );
}

function TelegramDraftForm({
  locale,
  draft,
  initialFailure,
  onChanged,
  onRefresh,
  onCreated,
}: {
  locale: Locale;
  draft: Draft;
  initialFailure: string;
  onChanged: (draft: Draft | null, failure?: string) => void;
  onRefresh: () => void;
  onCreated: () => void;
}) {
  const t = messages[locale].auth;
  const [step, setStep] = useState<Step>(() => initialStep(draft));
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(initialFailure);
  const heading = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const profile = useForm<ProfileValues>({
    defaultValues: {
      role: draft.role ?? "",
      firstName: draft.firstName ?? "",
      lastName: draft.lastName ?? "",
      birthDate: draft.birthDate ? formatDateInput(draft.birthDate, locale) : "",
      companyName: draft.companyName ?? "",
    },
  });
  const names = useForm<{ username: string }>({
    defaultValues: { username: draft.username ?? "" },
  });
  const manuallyEdited = useRef(false);

  const title =
    step === "role"
      ? t.roleTitle
      : step === "profile"
        ? t.signupProfileTitle
        : t.usernameTitle;
  const description =
    step === "role"
      ? t.roleDescription
      : step === "profile"
        ? t.signupProfileDescription
        : t.usernameDescription;
  const stepIndex = step === "role" ? 1 : step === "profile" ? 2 : 3;

  useEffect(() => {
    heading.current?.focus();
  }, [title]);

  useEffect(() => {
    if (step !== "username" || draft.channel !== "web" || draft.username) return;
    const controller = new AbortController();
    void telegramBrowserRequest(
      { action: "draft-suggest-username", draftId: draft.id },
      z.strictObject({ username: usernameInput.nullable() }),
      controller.signal,
    )
      .then(({ username }) => {
        if (!controller.signal.aborted && username && !manuallyEdited.current)
          names.setValue("username", username);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [step, draft.channel, draft.id, draft.username, names]);

  async function act(run: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure("");
    try {
      await run();
    } catch {
      setFailure(t.error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function update(
    mutation: Extract<
      Parameters<typeof telegramBrowserRequest>[0],
      { action: "draft-update" }
    >["mutation"],
  ) {
    const result = await telegramBrowserRequest(
      { action: "draft-update", draftId: draft.id, mutation },
      telegramDraftResponse,
    );
    if (!result.draft) {
      setFailure(t.telegramBotReturnError);
      return null;
    }
    return result.draft;
  }

  async function saveRole(role: (typeof roles)[number]) {
    const next = await update({ action: "edit", revision: draft.revision, role });
    if (next) onChanged(next);
  }

  async function saveProfile(values: ProfileValues) {
    const valid = validateProfile(values, locale, profile);
    if (!valid) return;
    const next = await update({
      action: "edit",
      revision: draft.revision,
      ...valid,
    });
    if (next) onChanged(next);
  }

  async function complete(values: { username: string }) {
    const parsed = usernameInput.safeParse(values.username);
    if (!parsed.success) {
      names.setError("username", { message: t.usernameInvalid }, { shouldFocus: true });
      return;
    }
    const next = await update({
      action: "edit",
      revision: draft.revision,
      username: parsed.data,
    });
    if (!next) return;
    const result = await telegramBrowserRequest(
      {
        action: "draft-complete",
        draftId: draft.id,
        revision: next.revision,
      },
      completionResponse,
    );
    if (result.outcome === "created") {
      onCreated();
    } else {
      onChanged(
        next,
        result.outcome === "username-taken"
          ? t.usernameTaken
          : result.outcome === "identity-taken"
            ? t.telegramError
            : t.error,
      );
    }
  }

  async function switchChannel(channel: "web" | "bot") {
    const next = await update({ action: "switch", revision: draft.revision, channel });
    if (next) onChanged(next);
  }

  async function cancel() {
    const result = await telegramBrowserRequest(
      { action: "draft-cancel", draftId: draft.id, revision: draft.revision },
      z.strictObject({ success: z.boolean() }),
    );
    if (result.success) onChanged(null);
    else setFailure(t.telegramBotReturnError);
  }

  if (draft.channel === "bot")
    return (
      <AuthPanel title={t.telegramBotDraft} description={t.telegramBotChatActive}>
        <div className="flex flex-col gap-3">
          <Button size="lg" disabled={busy} onClick={() => void act(() => switchChannel("web"))}>
            {t.telegramBotSwitchWeb}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onRefresh}>
            {t.telegramRefresh}
          </Button>
          {failure && (
            <Alert variant="destructive"><AlertDescription>{failure}</AlertDescription></Alert>
          )}
        </div>
      </AuthPanel>
    );

  return (
    <AuthPanel title={title} description={description} headingRef={heading}>
      <div className="mb-5 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground" role="status">
          {t.signupStep} {stepIndex} {t.signupOf} 3
        </p>
        <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div
            className="movaro-signup-progress h-full rounded-full bg-primary"
            style={{ width: `${(stepIndex / 3) * 100}%` }}
          />
        </div>
      </div>
      <div key={step} className="movaro-signup-step">
        {step === "role" && (
          <div className="flex flex-col gap-3">
            {roles.map((role) => (
              <RoleOption
                key={role}
                role={role}
                title={t.roles[role]}
                description={t.roleDescriptions[role]}
                disabled={busy}
                onSelect={() => void act(() => saveRole(role))}
              />
            ))}
          </div>
        )}
        {step === "profile" && (
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={profile.handleSubmit((values) => act(() => saveProfile(values)))}
          >
            <ProfileFields form={profile} locale={locale} disabled={busy} />
            <Button type="submit" size="lg" disabled={busy}>{t.continue}</Button>
          </form>
        )}
        {step === "username" && (
          <form
            noValidate
            className="flex flex-col gap-5"
            onSubmit={names.handleSubmit((values) => act(() => complete(values)))}
          >
            <Field data-invalid={Boolean(names.formState.errors.username)}>
              <FieldLabel htmlFor="username">{t.username}</FieldLabel>
              <Input
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={32}
                required
                disabled={busy}
                aria-invalid={Boolean(names.formState.errors.username)}
                aria-describedby="username-hint username-error"
                {...names.register("username", {
                  onChange: () => {
                    manuallyEdited.current = true;
                    names.clearErrors("username");
                  },
                })}
              />
              <p id="username-hint" className="text-xs text-muted-foreground">{t.usernameHint}</p>
              <FieldError id="username-error">{names.formState.errors.username?.message}</FieldError>
            </Field>
            <Button type="submit" size="lg" disabled={busy}>{busy ? t.submitting : t.signupAction}</Button>
          </form>
        )}
      </div>
      {failure && (
        <Alert variant="destructive" className="mt-4"><AlertDescription>{failure}</AlertDescription></Alert>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {step !== "role" && (
          <Button variant="ghost" disabled={busy} onClick={() => setStep(step === "username" ? "profile" : "role")}>
            {t.back}
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => void act(() => switchChannel("bot"))}>
          {t.telegramBotSwitchChat}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onRefresh}>{t.telegramRefresh}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => void act(cancel)}>{t.telegramBotCancel}</Button>
      </div>
    </AuthPanel>
  );
}
