"use client";

import {
  emailChangeResponse,
  emailChangeTokenInput,
} from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import { Alert, AlertDescription, Button, Skeleton } from "@freight/ui";
import { Link } from "@freight/ui/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthPanel } from "./auth-panel";

type State = "loading" | "ready" | "invalid" | "new-sent" | "completed";

export function EmailChangeConfirmation({ locale }: { locale: Locale }) {
  const t = messages[locale].auth;
  const token = useRef("");
  const initialized = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    // Capture once, including under React Strict Mode effect replay.
    // The secret stays in memory and is never part of a navigation URL.
    if (!initialized.current) {
      initialized.current = true;
      const parsed = emailChangeTokenInput.safeParse({
        token: new URLSearchParams(window.location.hash.slice(1)).get("token"),
      });
      window.history.replaceState(
        window.history.state,
        "",
        window.location.pathname,
      );
      if (parsed.success) {
        token.current = parsed.data.token;
        setState("ready");
      } else {
        setState("invalid");
      }
    }
    return () => operation.current?.abort();
  }, []);

  async function confirm() {
    if (operation.current || state !== "ready" || !token.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setFailure("");
    try {
      const response = await fetch("/api/auth/email/change/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
        body: JSON.stringify({ token: token.current }),
      });
      if (controller.signal.aborted) return;
      if (response.status === 400 || response.status === 403) {
        token.current = "";
        setState("invalid");
        return;
      }
      if (!response.ok) {
        setFailure(response.status === 429 ? t.limited : t.emailChangeRetry);
        return;
      }
      const result = emailChangeResponse.parse(await response.json());
      if (controller.signal.aborted) return;
      if (result.stage === "old-sent")
        throw new Error("Unexpected email change stage");
      token.current = "";
      setState(result.stage);
    } catch {
      if (!controller.signal.aborted) setFailure(t.emailChangeRetry);
    } finally {
      if (operation.current === controller) operation.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <AuthPanel
      title={t.emailChangeConfirmTitle}
      description={t.emailChangeConfirmDescription}
    >
      <div className="flex flex-col gap-4">
        {state === "loading" && <Skeleton className="h-10 w-full" />}
        {state === "ready" && (
          <>
            {failure && (
              <Alert variant="destructive">
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
            <Button size="lg" disabled={busy} onClick={() => void confirm()}>
              {busy ? t.submitting : t.emailChangeConfirmAction}
            </Button>
            {failure && (
              <Link className="text-primary hover:underline" href="/account">
                {t.emailChangeRestart}
              </Link>
            )}
          </>
        )}
        {state === "invalid" && (
          <>
            <Alert variant="destructive">
              <AlertDescription>{t.emailChangeInvalid}</AlertDescription>
            </Alert>
            <Link className="text-primary hover:underline" href="/account">
              {t.emailChangeRestart}
            </Link>
          </>
        )}
        {state === "new-sent" && (
          <>
            <p role="status">{t.emailChangeNext}</p>
            <Link className="text-primary hover:underline" href="/account">
              {t.emailChangeBackAccount}
            </Link>
          </>
        )}
        {state === "completed" && (
          <>
            <p role="status">{t.emailChangeDone}</p>
            <Button asChild size="lg">
              <Link href="/login">{t.backLogin}</Link>
            </Button>
          </>
        )}
      </div>
    </AuthPanel>
  );
}
