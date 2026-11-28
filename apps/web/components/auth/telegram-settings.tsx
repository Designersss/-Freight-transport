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
import type { z } from "zod";
import { startTelegramAuth, waitStorageKey } from "../../lib/telegram-browser";

type Settings = z.infer<typeof publicTelegramSettings>;
const endpoint = "/api/auth/telegram/settings";

export function TelegramSettings({
  locale,
  callbackError,
}: {
  locale: Locale;
  callbackError: boolean;
}) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [data, setData] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(
    callbackError ? t.telegramLinkFailed : "",
  );
  const request = useRef<AbortController | null>(null);

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
        status === 429
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

  async function act(action: "link" | "refresh") {
    if (request.current) return;
    if (action === "link" && (!data?.canLink || data.requiresFreshSession))
      return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailure("");
    let redirecting = false;
    try {
      if (action === "refresh") {
        await load(controller.signal);
      } else {
        const result = await startTelegramAuth(
          "link",
          locale,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (result.kind === "error") {
          handleFailure(result.status, result.code, t.telegramLinkFailed);
          return;
        }
        sessionStorage.setItem(waitStorageKey, JSON.stringify(result.wait));
        router.push("/telegram/wait", { locale });
        redirecting = true;
      }
    } catch {
      if (!controller.signal.aborted)
        setFailure(
          action === "link"
            ? t.telegramLinkFailed
            : t.telegramSettingsUnavailable,
        );
    } finally {
      if (!controller.signal.aborted && !redirecting) {
        setBusy(false);
        request.current = null;
      }
    }
  }

  // With no enabled provider or existing connection there is nothing to manage.
  if (data && !data.linked && !data.canLink && !failure) return null;
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
      {data && (
        <>
          <p className="text-muted-foreground">
            {data.linked ? t.telegramLinked : t.telegramNotLinked}
          </p>
          {data.linked && (
            <p className="text-muted-foreground">{t.telegramPermanent}</p>
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
        </>
      )}
      {!loading && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void act("refresh")}
        >
          {t.telegramRefresh}
        </Button>
      )}
    </section>
  );
}
