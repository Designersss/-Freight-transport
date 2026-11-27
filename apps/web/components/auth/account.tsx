"use client";

import { publicProfile, publicSession } from "@freight/auth/contracts";
import { type Locale, messages } from "@freight/i18n";
import { Button, Skeleton } from "@freight/ui";
import { Link, useRouter } from "@freight/ui/navigation";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { cabinetPaths } from "../../lib/cabinet-paths";
import { AuthPanel } from "./auth-panel";
import { DeactivationSettings } from "./deactivation-settings";
import { EmailChangeSettings } from "./email-change-settings";
import { PasswordSettings } from "./password-settings";
import { ProfileForm } from "./profile-form";
import { ProfilePhotoSettings } from "./profile-photo-settings";
import { ProfileSettings } from "./profile-settings";
import { SessionSettings } from "./session-settings";
import { SignupWizard } from "./signup-wizard";
import { TelegramSettings } from "./telegram-settings";
import { UsernameSettings } from "./username-settings";

export function Account({
  locale,
  telegramLinkError = false,
  enterCabinet = false,
}: {
  locale: Locale;
  telegramLinkError?: boolean;
  enterCabinet?: boolean;
}) {
  const t = messages[locale].auth;
  const router = useRouter();
  const [session, setSession] = useState<z.infer<typeof publicSession> | null>(
    null,
  );
  const [profile, setProfile] = useState<z.infer<typeof publicProfile> | null>(
    null,
  );
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [deactivated, setDeactivated] = useState(false);
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
          router.replace("/login", { locale });
          return;
        }
        const current = publicSession.parse(data);
        if (current.user.email !== null && !current.user.emailVerified) {
          router.replace("/email-confirmation", { locale });
          return;
        }
        setSession(current);
        const result = await fetch("/api/auth/profile", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (result.status === 401) {
          setSession(null);
          router.replace("/login", { locale });
          return;
        }
        if (!result.ok) throw new Error("Profile unavailable");
        const saved: unknown = await result.json();
        if (controller.signal.aborted) return;
        const stored = saved === null ? null : publicProfile.parse(saved);
        if (enterCabinet && stored) {
          router.replace(cabinetPaths[stored.role], { locale });
          return;
        }
        setProfile(stored);
        setProfileLoaded(true);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [enterCabinet, locale, router]);
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
      setProfile(null);
      setProfileLoaded(false);
      router.replace("/login", { locale });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const needsProfile = session && profileLoaded && !profile;
  const telegramOnly = session?.user.email === null;
  if (needsProfile && telegramOnly) {
    return (
      <SignupWizard
        locale={locale}
        telegram
        enterCabinet={enterCabinet}
        onLogout={logout}
        logoutBusy={busy}
        logoutError={error}
      />
    );
  }
  return (
    <AuthPanel
      title={needsProfile ? t.profileTitle : t.accountTitle}
      description={needsProfile ? t.profileDescription : ""}
    >
      {loading && <Skeleton className="h-20 w-full" />}
      {deactivated && <p role="status">{t.deactivationDone}</p>}
      {error && (
        <p role="alert" className="mb-4 text-destructive">
          {t.unavailable}
        </p>
      )}
      {session ? (
        <div className="flex flex-col gap-4">
          {needsProfile && (
            <ProfileForm
              locale={locale}
              onComplete={(completed) => {
                if (enterCabinet)
                  router.replace(cabinetPaths[completed.role], { locale });
                else setProfile(completed);
              }}
              onExpired={() => {
                setSession(null);
                router.replace("/login", { locale });
              }}
            />
          )}
          {profileLoaded && profile && (
            <div className="break-all rounded-lg border border-border p-3">
              <p className="font-semibold">
                {profile.firstName} {profile.lastName}
              </p>
              <p className="text-muted-foreground">
                {session.user.email ?? t.telegramIdentity}
              </p>
              <p className="mt-2 text-sm">{t.roles[profile.role]}</p>
              <Button asChild variant="outline" className="mt-3 w-full">
                <Link href={cabinetPaths[profile.role]} prefetch={false}>
                  {t.cabinetOpen}
                </Link>
              </Button>
            </div>
          )}
          {profileLoaded && profile && (
            <ProfilePhotoSettings
              key={session.user.id}
              locale={locale}
              firstName={profile.firstName}
              lastName={profile.lastName}
            />
          )}
          {profileLoaded && profile && (
            <ProfileSettings
              key={`${session.user.id}:${locale}`}
              locale={locale}
              profile={profile}
              onSaved={setProfile}
            />
          )}
          {profileLoaded && profile && <UsernameSettings locale={locale} />}
          {profileLoaded && profile && (
            <>
              {session.user.email !== null && (
                <EmailChangeSettings
                  key={session.user.email}
                  locale={locale}
                  currentEmail={session.user.email}
                />
              )}
              {!telegramOnly && (
                <PasswordSettings
                  locale={locale}
                  onChanged={() => setSessionRevision((value) => value + 1)}
                />
              )}
              <TelegramSettings
                locale={locale}
                callbackError={telegramLinkError}
              />
              <SessionSettings key={sessionRevision} locale={locale} />
              <DeactivationSettings
                locale={locale}
                onEnded={(success) => {
                  setSession(null);
                  setProfile(null);
                  setProfileLoaded(false);
                  setDeactivated(success);
                  if (!success) router.replace("/login", { locale });
                }}
              />
            </>
          )}
          <Button disabled={busy || loading} onClick={logout} variant="outline">
            {t.logout}
          </Button>
        </div>
      ) : (
        !loading && (
          <Link className="text-primary hover:underline" href="/login">
            {t.backLogin}
          </Link>
        )
      )}
    </AuthPanel>
  );
}
