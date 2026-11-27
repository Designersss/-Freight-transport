"use client";

import { type Locale, messages } from "@freight/i18n";
import { Alert, AlertDescription, Button, FieldSeparator } from "@freight/ui";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { startTelegramOAuth } from "../../lib/telegram-oauth";

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
  const [enabled, setEnabled] = useState(false);
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
        if (!response.ok) return;
        const status = statusResponse.parse(await response.json());
        if (!controller.signal.aborted) setEnabled(status.enabled);
      } catch {
        // Email authentication remains available if capability lookup fails.
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
    if (request.current || disabled) return;
    const controller = new AbortController();
    request.current = controller;
    setFailure("");
    setPending(true);
    onPendingChange(true);
    let redirecting = false;
    try {
      const result = await startTelegramOAuth(
        intent,
        locale,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (result.kind === "error") {
        setFailure(result.status === 429 ? t.limited : t.telegramError);
        return;
      }
      window.location.assign(result.url);
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

  if (!enabled) return null;
  return (
    <div className="mt-4 flex flex-col gap-3">
      <FieldSeparator>{t.telegramOr}</FieldSeparator>
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        disabled={disabled || pending}
        onClick={() => void start()}
      >
        {pending
          ? t.submitting
          : intent === "login"
            ? t.telegramLogin
            : t.telegramRegister}
      </Button>
    </div>
  );
}
