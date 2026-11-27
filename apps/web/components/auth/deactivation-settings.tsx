"use client";

import { deactivateAccountInput } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import { Alert, AlertDescription, Button, Separator } from "@freight/ui";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

const successResponse = z.object({ success: z.literal(true) });
const errorResponse = z.object({ code: z.string() });

export function DeactivationSettings({
  locale,
  onEnded,
}: {
  locale: Locale;
  onEnded: (success: boolean) => void;
}) {
  const t = messages[locale].auth;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);

  async function submit() {
    if (!confirming || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setFailure("");
    try {
      const response = await fetch("/api/auth/account/deactivate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        body: JSON.stringify(deactivateAccountInput.parse({ confirm: true })),
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        onEnded(false);
        return;
      }
      const raw: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!response.ok) {
        const error = errorResponse.safeParse(raw);
        setFailure(
          response.status === 429
            ? t.limited
            : error.success && error.data.code === "SESSION_NOT_FRESH"
              ? t.deactivationFresh
              : t.deactivationFailed,
        );
        return;
      }
      successResponse.parse(raw);
      onEnded(true);
    } catch {
      if (!controller.signal.aborted) setFailure(t.deactivationFailed);
    } finally {
      if (operation.current === controller) operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="deactivation-title"
      className="flex flex-col gap-3"
    >
      <Separator />
      <h2 id="deactivation-title" className="font-semibold">
        {t.deactivationTitle}
      </h2>
      <p className="text-muted-foreground">{t.deactivationDescription}</p>
      <Button
        ref={trigger}
        variant="outline"
        aria-expanded={confirming}
        aria-controls="deactivation-confirmation"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        {t.deactivationAction}
      </Button>
      <div id="deactivation-confirmation" hidden={!confirming}>
        {confirming && (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <p>{t.deactivationWarning}</p>
            {failure && (
              <Alert variant="destructive">
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
            <Button
              ref={cancel}
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setFailure("");
                trigger.current?.focus();
              }}
            >
              {t.cancelAction}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? t.submitting : t.deactivationConfirm}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
