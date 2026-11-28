"use client";

import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  ChoiceOption,
  FieldSeparator,
} from "@freight/ui";
import { useRouter } from "@freight/ui/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { waitStorageKey } from "../../lib/telegram-browser";
import { startTelegramAuth } from "../../lib/telegram-oauth";

const statusResponse = z.object({ enabled: z.boolean() });

export function TelegramButton({
  locale,
  intent,
  disabled,
  onPendingChange,
}: {
  locale: Locale;
  intent: "login" | "register";
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [capability, setCapability] = useState<
    "loading" | "enabled" | "unavailable"
  >("loading");
  const statusId = useId();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState("");
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/auth/telegram/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        const enabled =
          response.ok && statusResponse.parse(await response.json()).enabled;
        if (!controller.signal.aborted)
          setCapability(enabled ? "enabled" : "unavailable");
      } catch {
        if (!controller.signal.aborted) setCapability("unavailable");
      }
    }
    void load();
    return () => {
      controller.abort();
      request.current?.abort();
      request.current = null;
    };
  }, []);

  async function start() {
    if (request.current || disabled || capability !== "enabled") return;
    const controller = new AbortController();
    request.current = controller;
    setFailure("");
    setPending(true);
    onPendingChange(true);
    let redirecting = false;
    try {
      const result = await startTelegramAuth(intent, locale, controller.signal);
      if (controller.signal.aborted) return;
      if (result.kind === "error") {
        setFailure(result.status === 429 ? t.limited : t.telegramError);
        return;
      }
      if (result.kind === "bot") {
        sessionStorage.setItem(waitStorageKey, JSON.stringify(result.wait));
        router.push("/telegram/wait", { locale });
      } else window.location.assign(result.url);
      redirecting = true;
    } catch {
      if (!controller.signal.aborted) setFailure(t.telegramError);
    } finally {
      if (!controller.signal.aborted && !redirecting) {
        setPending(false);
        onPendingChange(false);
        request.current = null;
      }
    }
  }

  const unavailable = capability !== "enabled";
  const status =
    capability === "loading" ? t.telegramChecking : t.telegramUnavailable;
  const error = failure && (
    <Alert variant="destructive">
      <AlertDescription>{failure}</AlertDescription>
    </Alert>
  );

  if (intent === "register") {
    return (
      <>
        <ChoiceOption
          choice="telegram"
          title={t.telegramRegister}
          description={
            unavailable
              ? status
              : pending
                ? t.submitting
                : t.registrationTelegramMethod
          }
          disabled={disabled || pending || unavailable}
          onSelect={() => void start()}
        />
        {error}
      </>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <FieldSeparator>{t.telegramOr}</FieldSeparator>
      {error}
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        disabled={disabled || pending || unavailable}
        aria-describedby={unavailable ? statusId : undefined}
        onClick={() => void start()}
      >
        {pending ? t.submitting : t.telegramLogin}
      </Button>
      {unavailable && (
        <p id={statusId} className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  );
}
