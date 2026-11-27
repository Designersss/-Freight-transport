"use client";

import {
  publicActiveSessions,
  type sessionAction,
} from "@freight/auth/contracts";
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

type Sessions = z.infer<typeof publicActiveSessions>;
type Action = z.infer<typeof sessionAction>;

const endpoint = "/api/auth/sessions";
const successResponse = z.object({ success: z.literal(true) });

export function SessionSettings({ locale }: { locale: Locale }) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [data, setData] = useState<Sessions | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<Action | null>(null);
  const operation = useRef(false);

  const handleFailure = useCallback(
    (status: number) => {
      if (status === 401) {
        router.replace("/login", { locale });
        return;
      }
      setFailure(
        status === 403
          ? t.profileDenied
          : status === 429
            ? t.limited
            : status === 404 || status === 409
              ? t.sessionMissing
              : t.unavailable,
      );
    },
    [locale, router, t],
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setFailure("");
      setData(null);
      try {
        const response = await fetch(endpoint, {
          cache: "no-store",
          ...(signal ? { signal } : {}),
        });
        if (signal?.aborted) return;
        if (!response.ok) {
          handleFailure(response.status);
          return;
        }
        const result = publicActiveSessions.parse(await response.json());
        if (!signal?.aborted) setData(result);
      } catch {
        if (!signal?.aborted) setFailure(t.unavailable);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [handleFailure, t.unavailable],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function revoke() {
    if (!confirmation || operation.current) return;
    operation.current = true;
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(confirmation),
      });
      if (!response.ok) {
        handleFailure(response.status);
        return;
      }
      if (!successResponse.safeParse(await response.json()).success) {
        setFailure(t.unavailable);
        return;
      }
      setNotice(t.sessionsEnded);
      await load();
    } catch {
      setFailure(t.unavailable);
    } finally {
      setConfirmation(null);
      setBusy(false);
      operation.current = false;
    }
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const formatDate = (value: string) => formatter.format(new Date(value));
  const hasOthers = data?.sessions.some((session) => !session.current);

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="session-settings-title"
    >
      <Separator />
      <h2 id="session-settings-title" className="font-semibold">
        {t.sessionsTitle}
      </h2>
      {loading && <Skeleton className="h-24 w-full" />}
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      {notice && <p role="status">{notice}</p>}
      {data && (
        <>
          <ul className="flex flex-col gap-2">
            {data.sessions.map((session) => (
              <li
                key={session.id}
                className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3"
              >
                {session.current && (
                  <p className="font-semibold text-primary">
                    {t.currentSession}
                  </p>
                )}
                <p className="break-all">
                  {session.userAgent || t.unknownDevice}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.sessionCreated} {formatDate(session.createdAt)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.sessionExpires} {formatDate(session.expiresAt)}
                </p>
                {!session.current && (
                  <Button
                    variant="outline"
                    disabled={busy || Boolean(confirmation)}
                    onClick={() =>
                      setConfirmation({ action: "revoke", id: session.id })
                    }
                  >
                    {t.endSession}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {data.hasMore && <p>{t.sessionsLimit}</p>}
          {hasOthers && (
            <Button
              variant="outline"
              disabled={busy || Boolean(confirmation)}
              onClick={() => setConfirmation({ action: "revokeOthers" })}
            >
              {t.endOtherSessions}
            </Button>
          )}
        </>
      )}
      {confirmation && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p role="status">
            {confirmation.action === "revoke"
              ? t.confirmEndSession
              : t.confirmEndOthers}
          </p>
          <Button variant="destructive" disabled={busy} onClick={revoke}>
            {busy ? t.submitting : t.confirmAction}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmation(null)}
          >
            {t.cancelAction}
          </Button>
        </div>
      )}
      {!loading && (
        <Button
          variant="outline"
          disabled={busy || Boolean(confirmation)}
          onClick={() => {
            setNotice("");
            void load();
          }}
        >
          {t.refreshSessions}
        </Button>
      )}
    </section>
  );
}
