"use client";

import { type Locale, messages } from "@freight/i18n";
import { Alert, AlertDescription, Button } from "@freight/ui";
import { Link, useRouter } from "@freight/ui/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  forgetTelegramWait,
  parseTelegramReturn,
  readTelegramWait,
  rememberTelegramDraftId,
  type TelegramWait,
  telegramBrowserRequest,
  telegramFinishResponse,
  telegramStatusResponse,
} from "../../lib/telegram-browser";
import { AuthPanel } from "./auth-panel";

type Destination = "/cabinet" | "/account" | "/telegram/registration";
const success = z.strictObject({ success: z.literal(true) });

async function finish(requestId: string): Promise<Destination> {
  const result = await telegramBrowserRequest(
    { action: "finish", requestId },
    telegramFinishResponse,
  );
  if (result.outcome === "registration") {
    rememberTelegramDraftId(result.draftId);
    return "/telegram/registration";
  }
  return result.outcome === "linked" ? "/account" : "/cabinet";
}

// Another tab may already have consumed the same approval. Only actual
// server state, not the mere "consumed" status, allows navigation.
async function recover(requestId: string): Promise<Destination | null> {
  const state = await telegramBrowserRequest(
    { action: "status", requestId },
    telegramStatusResponse,
  ).catch(() => null);
  if (state?.status !== "consumed") return null;
  // Only consumed registration requests have an idempotent finish result.
  // Login and link cannot issue a second session or binding through this call.
  const destination = await finish(requestId).catch(() => null);
  if (destination) return destination;
  const session = await fetch("/api/auth/get-session", {
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(10000),
  });
  if (!session.ok) return null;
  const parsed = z
    .object({ user: z.object({ id: z.string() }) })
    .safeParse(await session.json());
  return parsed.success ? "/cabinet" : null;
}

export function TelegramReturn({ locale }: { locale: Locale }) {
  const t = messages[locale].auth;
  const router = useRouter();
  const work = useRef<Promise<Destination | null> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    if (!work.current) {
      const proof = parseTelegramReturn(window.location.hash);
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname,
      );
      work.current = (async () => {
        if (!proof) return null;
        try {
          await telegramBrowserRequest({ action: "confirm", ...proof }, success);
        } catch (error) {
          const { status } = await telegramBrowserRequest(
            { action: "status", requestId: proof.requestId },
            telegramStatusResponse,
          );
          if (status !== "approved" && status !== "consumed") throw error;
        }
        try {
          return await finish(proof.requestId);
        } catch {
          return recover(proof.requestId);
        }
      })().catch(() => null);
    }
    void work.current.then((destination) => {
      if (!active) return;
      if (destination) {
        forgetTelegramWait();
        router.replace(destination, { locale });
      } else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [locale, router]);

  return (
    <AuthPanel title={t.telegramBotTitle} description={t.telegramBotReturn}>
      {failed ? (
        <div className="flex flex-col gap-3">
          <Alert variant="destructive">
            <AlertDescription>{t.telegramBotReturnError}</AlertDescription>
          </Alert>
          <Button asChild size="lg">
            <Link href="/login">{t.telegramBotRestart}</Link>
          </Button>
        </div>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {t.submitting}
        </p>
      )}
    </AuthPanel>
  );
}

export function TelegramWaitScreen({ locale }: { locale: Locale }) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [wait, setWait] = useState<TelegramWait | null>(null);
  const [state, setState] = useState<
    "loading" | "waiting" | "expired" | "consumed" | "error"
  >("loading");
  const [cancelling, setCancelling] = useState(false);
  const polling = useRef<AbortController | null>(null);

  useEffect(() => {
    const current = readTelegramWait();
    setWait(current);
    setState(current ? "waiting" : "expired");
  }, []);

  useEffect(() => {
    if (!wait || state !== "waiting" || cancelling) return;
    const controller = new AbortController();
    polling.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function stop(next: "expired" | "consumed" | "error") {
      if (controller.signal.aborted) return;
      forgetTelegramWait();
      setState(next);
    }
    async function check() {
      if (!wait || controller.signal.aborted) return;
      try {
        const { status } = await telegramBrowserRequest(
          { action: "status", requestId: wait.requestId },
          telegramStatusResponse,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (status === "approved" || status === "consumed") {
          const destination =
            status === "approved"
              ? await finish(wait.requestId).catch(() =>
                  recover(wait.requestId),
                )
              : await recover(wait.requestId);
          if (controller.signal.aborted) return;
          if (destination) {
            forgetTelegramWait();
            router.replace(destination, { locale });
          } else stop(status === "consumed" ? "consumed" : "error");
          return;
        }
        if (status !== "pending" && status !== "claimed") {
          stop("expired");
          return;
        }
        if (Date.parse(wait.expiresAt) <= Date.now()) {
          stop("expired");
          return;
        }
        timer = setTimeout(() => void check(), 2500);
      } catch {
        if (controller.signal.aborted) return;
        if (Date.parse(wait.expiresAt) <= Date.now()) stop("expired");
        else timer = setTimeout(() => void check(), 5000);
      }
    }
    void check();
    return () => {
      controller.abort();
      clearTimeout(timer);
      if (polling.current === controller) polling.current = null;
    };
  }, [wait, state, cancelling, locale, router]);

  async function cancel() {
    if (!wait || cancelling) return;
    polling.current?.abort();
    setCancelling(true);
    try {
      const result = await telegramBrowserRequest(
        { action: "cancel", requestId: wait.requestId },
        z.strictObject({ success: z.boolean() }),
      );
      if (result.success) {
        forgetTelegramWait();
        setState("expired");
      }
    } catch {
      // Resume polling after an uncertain cancellation.
    } finally {
      setCancelling(false);
    }
  }

  return (
    <AuthPanel title={t.telegramBotTitle} description={t.telegramBotWait}>
      <div className="flex flex-col gap-4">
        {state === "waiting" && wait ? (
          <>
            <p className="text-center text-2xl font-semibold tabular-nums tracking-widest">
              {wait.displayCode}
            </p>
            <p role="status" className="text-sm text-muted-foreground">
              {t.telegramBotWaiting}
            </p>
            <Button asChild size="lg">
              <a href={wait.url} target="_blank" rel="noopener noreferrer">
                {t.telegramBotOpen}
              </a>
            </Button>
            <Button
              variant="outline"
              disabled={cancelling}
              onClick={() => void cancel()}
            >
              {cancelling ? t.submitting : t.telegramBotCancel}
            </Button>
          </>
        ) : state === "loading" ? (
          <p role="status">{t.submitting}</p>
        ) : (
          <>
            <Alert variant={state === "consumed" ? "default" : "destructive"}>
              <AlertDescription>
                {state === "expired"
                  ? t.telegramBotExpired
                  : state === "consumed"
                    ? t.telegramBotConsumed
                    : t.telegramBotReturnError}
              </AlertDescription>
            </Alert>
            <Button asChild>
              <Link href="/login">{t.telegramBotRestart}</Link>
            </Button>
          </>
        )}
      </div>
    </AuthPanel>
  );
}
