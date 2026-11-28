"use client";

import { type Locale, messages } from "@freight/i18n";
import { Alert, AlertDescription, Button } from "@freight/ui";
import { useRouter } from "@freight/ui/navigation";
import { useRef, useState } from "react";

export function AdminLogout({ locale }: { locale: Locale }) {
  const t = messages[locale];
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");

  async function logout() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure("");
    try {
      const result = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        redirect: "error",
        cache: "no-store",
      });
      if (!result.ok && result.status !== 401) {
        setFailure(
          result.status === 429 ? t.auth.limited : t.admin.logoutFailed,
        );
        return;
      }
      router.replace("/login", { locale });
      router.refresh();
    } catch {
      setFailure(t.admin.logoutFailed);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button variant="outline" disabled={busy} onClick={() => void logout()}>
          {busy ? t.auth.submitting : t.auth.logout}
        </Button>
      </div>
    </div>
  );
}
