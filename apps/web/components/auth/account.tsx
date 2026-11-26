"use client";

import { publicSession } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import { Button, Skeleton } from "@freight/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { AuthPanel } from "./auth-panel";

export function Account({ locale }: { locale: Locale }) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [session, setSession] = useState<z.infer<typeof publicSession> | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/auth/get-session", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unavailable");
        const data: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (data === null) {
          router.replace(`/${locale}/login`);
          return;
        }
        setSession(publicSession.parse(data));
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [locale, router]);
  async function logout() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Logout failed");
      setSession(null);
      router.replace(`/${locale}/login`);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthPanel
      title={t.accountTitle}
      description={session ? t.accountDescription : ""}
    >
      {loading && <Skeleton className="h-20 w-full" />}
      {error && (
        <p role="alert" className="mb-4 text-destructive">
          {t.unavailable}
        </p>
      )}
      {session ? (
        <div className="flex flex-col gap-4">
          <div className="break-all rounded-lg border border-border p-3">
            <p className="font-semibold">{session.user.name}</p>
            <p className="text-muted-foreground">{session.user.email}</p>
          </div>
          <Button disabled={busy} onClick={logout} variant="outline">
            {t.logout}
          </Button>
        </div>
      ) : (
        !loading && (
          <Link
            className="text-primary hover:underline"
            href={`/${locale}/login`}
          >
            {t.backLogin}
          </Link>
        )
      )}
    </AuthPanel>
  );
}
