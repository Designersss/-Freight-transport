"use client";

import { type Locale, messages } from "@freight/i18n";
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  Separator,
  Skeleton,
} from "@freight/ui";
import { useRouter } from "@freight/ui/navigation";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

const endpoint = "/api/auth/profile/photo";
const maxPhotoBytes = 2 * 1024 * 1024;
const successResponse = z.object({ success: z.literal(true) });

export function ProfilePhotoSettings({
  locale,
  firstName,
  lastName,
}: {
  locale: Locale;
  firstName: string;
  lastName: string;
}) {
  const t = messages[locale].auth;
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const preview = useRef<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");

  const replacePreview = useCallback((blob: Blob | null) => {
    const next = blob ? URL.createObjectURL(blob) : null;
    if (preview.current) URL.revokeObjectURL(preview.current);
    preview.current = next;
    setPhoto(next);
  }, []);

  const handleFailure = useCallback(
    (status: number) => {
      if (status === 401 || status === 403) {
        replacePreview(null);
        setReady(false);
        if (status === 401) {
          router.replace("/login", { locale });
          return;
        }
      }
      setFailure(
        status === 403
          ? t.profileDenied
          : status === 429
            ? t.limited
            : status === 400 || status === 413 || status === 415
              ? t.photoInvalid
              : t.photoUnavailable,
      );
    },
    [locale, replacePreview, router, t],
  );

  const load = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setReady(false);
      setFailure("");
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal });
        if (signal.aborted) return;
        if (response.status === 404) {
          replacePreview(null);
          setReady(true);
          return;
        }
        if (!response.ok) {
          handleFailure(response.status);
          return;
        }
        const blob = await response.blob();
        if (signal.aborted) return;
        if (
          blob.type !== "image/jpeg" ||
          blob.size === 0 ||
          blob.size > maxPhotoBytes
        )
          throw new Error("Invalid photo response");
        replacePreview(blob);
        setReady(true);
      } catch {
        if (!signal.aborted) setFailure(t.photoUnavailable);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [handleFailure, replacePreview, t.photoUnavailable],
  );

  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    void load(controller.signal).finally(() => {
      if (operation.current === controller) operation.current = null;
    });
    return () => {
      operation.current?.abort();
      operation.current = null;
      if (preview.current) URL.revokeObjectURL(preview.current);
      preview.current = null;
    };
  }, [load]);

  async function refresh() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setNotice("");
    try {
      await load(controller.signal);
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }

  async function mutate(file?: File) {
    if (operation.current || !ready) return;
    setFailure("");
    setNotice("");
    if (
      file &&
      (file.size === 0 ||
        file.size > maxPhotoBytes ||
        !["image/jpeg", "image/png"].includes(file.type))
    ) {
      setFailure(t.photoInvalid);
      return;
    }
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: file ? "POST" : "DELETE",
        cache: "no-store",
        signal: controller.signal,
        ...(file ? { headers: { "content-type": file.type }, body: file } : {}),
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        handleFailure(response.status);
        if (response.status >= 500 || response.status === 409) setReady(false);
        return;
      }
      if (!successResponse.safeParse(await response.json()).success)
        throw new Error("Invalid photo response");
      if (controller.signal.aborted) return;
      replacePreview(null);
      setNotice(file ? t.photoSaved : t.photoRemoved);
      await load(controller.signal);
    } catch {
      if (!controller.signal.aborted) {
        setFailure(t.photoUnavailable);
        setReady(false);
      }
    } finally {
      if (!controller.signal.aborted) {
        setConfirmation(false);
        setBusy(false);
      }
      if (operation.current === controller) operation.current = null;
    }
  }

  const initials = [firstName, lastName]
    .map((name) => Array.from(name.trim())[0] ?? "")
    .join("")
    .toLocaleUpperCase(locale);

  return (
    <section
      aria-labelledby="profile-photo-title"
      className="flex flex-col gap-3"
    >
      <Separator />
      <h2 id="profile-photo-title" className="font-semibold">
        {t.photoTitle}
      </h2>
      <div className="flex items-center gap-3">
        {loading ? (
          <Skeleton className="size-16 shrink-0 rounded-full" />
        ) : photo ? (
          <Image
            unoptimized
            src={photo}
            alt={t.photoAlt}
            width={64}
            height={64}
            className="size-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground"
            aria-label={t.photoEmpty}
            role="img"
          >
            {initials}
          </div>
        )}
        <p id="profile-photo-hint" className="text-sm text-muted-foreground">
          {t.photoHint}
        </p>
      </div>
      {failure && (
        <Alert variant="destructive">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      )}
      {notice && <p role="status">{notice}</p>}
      <Input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png"
        aria-label={t.photoChoose}
        hidden
        className="hidden"
        disabled={!ready || busy || confirmation}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void mutate(file);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={!ready || busy || confirmation}
          aria-describedby="profile-photo-hint"
          onClick={() => fileInput.current?.click()}
        >
          {busy ? t.submitting : photo ? t.photoReplace : t.photoChoose}
        </Button>
        {ready && photo && (
          <Button
            variant="ghost"
            disabled={busy || confirmation}
            onClick={() => setConfirmation(true)}
          >
            {t.photoRemove}
          </Button>
        )}
        {!loading && !ready && (
          <Button variant="outline" disabled={busy} onClick={refresh}>
            {t.retry}
          </Button>
        )}
      </div>
      {confirmation && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p role="status">{t.photoConfirmRemove}</p>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void mutate()}
          >
            {busy ? t.submitting : t.confirmAction}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmation(false)}
          >
            {t.cancelAction}
          </Button>
        </div>
      )}
    </section>
  );
}
