import type { Locale } from "@freight/i18n";
import { z } from "zod";

export type TelegramIntent = "login" | "register" | "link";

const startResponse = z.object({ url: z.string().max(8192) });
const errorResponse = z.object({ code: z.string() });

export type TelegramStartResult =
  | { kind: "redirect"; url: string }
  | { kind: "error"; status: number; code?: string };

export async function startTelegramOAuth(
  intent: TelegramIntent,
  locale: Locale,
  signal: AbortSignal,
): Promise<TelegramStartResult> {
  const response = await fetch("/api/auth/telegram/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal,
    body: JSON.stringify({ intent, locale }),
  });
  if (!response.ok) {
    const parsed = errorResponse.safeParse(
      await response.json().catch(() => null),
    );
    return {
      kind: "error",
      status: response.status,
      ...(parsed.success ? { code: parsed.data.code } : {}),
    };
  }
  const result = startResponse.parse(await response.json());
  const target = new URL(result.url);
  if (
    target.origin !== "https://oauth.telegram.org" ||
    target.pathname !== "/auth" ||
    target.username ||
    target.password ||
    target.hash ||
    target.searchParams.get("redirect_uri") !==
      new URL("/api/auth/telegram/callback", window.location.origin).href
  )
    throw new Error("Invalid authorization destination");
  return { kind: "redirect", url: target.href };
}
