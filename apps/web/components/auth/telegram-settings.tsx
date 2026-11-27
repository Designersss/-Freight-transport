"use client";

import { publicTelegramSettings } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  Separator,
  Skeleton,
} from "@freight/ui";
import { useRouter } from "@freight/ui/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { startTelegramOAuth } from "../../lib/telegram-oauth";

type Settings = z.infer<typeof publicTelegramSettings>;
const endpoint = "/api/auth/telegram/settings";
const successResponse = z.object({ success: z.literal(true) });
const errorResponse = z.object({ code: z.string() });

export function TelegramSettings({
  locale,
  callbackError,
  onUnlinked,
}: {
  locale: Locale;
  callbackError: boolean;
  onUnlinked: () => void;
}) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [data, setData] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [failure, setFailure] = useState(
    callbackError ? t.telegramLinkFailed : "",
  );
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const handleFailure = useCallback(
    (status: number, code: string | undefined, fallback: string) => {
      if (status === 401) {
        router.replace("/login", { locale });
        return;
      }
      if (code === "SESSION_NOT_FRESH") {
        setData((current) =>
          current ? { ...current, requiresFreshSession: true } : current,
        );
        setFailure(t.telegramFreshRequired);
        return;
      }
      setFailure(
        code === "LAST_AUTH_METHOD"
          ? t.telegramOnlyMethod
          : status === 429
            ? t.limited
            : status === 403
              ? t.profileDenied
              : fallback,
      );
    },
    [locale, router, t],
  );

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setData(null);
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal });
        if (signal.aborted) return;
        if (!response.ok) {
          handleFailure(
            response.status,
            undefined,
            t.telegramSettingsUnavailable,
          );
          return;
        }
        const result = publicTelegramSettings.parse(await response.json());
        if (!signal.aborted) setData(result);
      } catch {
        if (!signal.aborted) setFailure(t.telegramSettingsUnavailable);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [handleFailure, t.telegramSettingsUnavailable],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      request.current?.abort();
      request.current = null;
    };
  }, [load]);

  async function act(action: "link" | "unlink" | "refresh") {
    if (request.current) return;
    if (
      action !== "refresh" &&
      (!data ||
        data.requiresFreshSession ||
        (action === "link" ? !data.canLink : !data.canUnlink))
    )
      return;
    if (action === "unlink" && !confirm) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailure("");
    setNotice("");
    let redirecting = false;
    try {
      if (action === "refresh") {
        await load(controller.signal);
      } else if (action === "link") {
        const result = await startTelegramOAuth(
          "link",
          locale,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (result.kind === "error") {
          handleFailure(result.status, result.code, t.telegramLinkFailed);
          return;
        }
        window.location.assign(result.url);
        redirecting = true;
      } else {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          body: JSON.stringify({ action: "unlink" }),
        });
        if (controller.signal.aborted) return;
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) {
          const parsed = errorResponse.safeParse(body);
          handleFailure(
            response.status,
            parsed.success ? parsed.data.code : undefined,
            t.telegramDisconnectFailed,
          );
          return;
        }
        successResponse.parse(body);
        onUnlinked();
        setNotice(t.telegramDisconnected);
        await load(controller.signal);
      }
    } catch {
      if (!controller.signal.aborted)
        setFailure(
          action === "link" ? t.telegramLinkFailed : t.telegramDisconnectFailed,
        );
    } finally {
      if (!controller.signal.aborted && !redirecting) {
        setBusy(false);
        setConfirm(false);
        request.current = null;
      }
    }
  }

  // With no enabled provider or existing connection there is nothing to manage.
  if (data && !data.linked && !data.canLink && !failure && !notice) return null;
  return (
    <section
      aria-labelledby="telegram-settings-title"
      className="flex flex-col gap-3"
    >
      <Separator />
      <h2 id="telegram-settings-title" className="font-semibold">
        {t.telegramSettingsTitle}
      </h2>
      {loading && <Skeleton className="h-16 w-full" />}
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      {notice && <p role="status">{notice}</p>}
      {data && (
        <>
          <p className="text-muted-foreground">
            {data.linked ? t.telegramLinked : t.telegramNotLinked}
          </p>
          {data.linked && !data.canUnlink && (
            <p className="text-muted-foreground">{t.telegramOnlyMethod}</p>
          )}
          {data.requiresFreshSession && !failure && (
            <p className="text-muted-foreground">{t.telegramFreshRequired}</p>
          )}
          {data.canLink && (
            <Button
              variant="outline"
              disabled={busy || data.requiresFreshSession}
              onClick={() => void act("link")}
            >
              {busy ? t.submitting : t.telegramConnect}
            </Button>
          )}
          {data.canUnlink && (
            <Button
              ref={trigger}
              variant="outline"
              disabled={busy || data.requiresFreshSession}
              aria-expanded={confirm}
              onClick={() => setConfirm((value) => !value)}
            >
              {t.telegramDisconnect}
            </Button>
          )}
        </>
      )}
      {confirm && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p role="status">{t.telegramConfirmDisconnect}</p>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void act("unlink")}
          >
            {busy ? t.submitting : t.confirmAction}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setConfirm(false);
              trigger.current?.focus();
            }}
          >
            {t.cancelAction}
          </Button>
        </div>
      )}
      {!loading && (
        <Button
          variant="outline"
          disabled={busy || confirm}
          onClick={() => void act("refresh")}
        >
          {t.telegramRefresh}
        </Button>
      )}
    </section>
  );
}
