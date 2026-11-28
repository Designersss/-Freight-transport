import type { Locale } from "@freight/i18n";
import { z } from "zod";
import { type TelegramWait, telegramWaitSchema } from "./telegram-browser";

export type TelegramIntent = "login" | "register" | "link";

const startResponse = z.object({ url: z.string().max(8192) });
const errorResponse = z.object({ code: z.string() });

export type TelegramStartResult =
  | { kind: "redirect"; url: string }
  | { kind: "bot"; wait: TelegramWait }
  | { kind: "error"; status: number; code?: string };

export async function startTelegramAuth(
  intent: TelegramIntent,
  locale: Locale,
  signal: AbortSignal,
): Promise<TelegramStartResult> {
  const status = await fetch("/api/auth/telegram/status", {
    cache: "no-store",
    signal,
  });
  if (!status.ok) return { kind: "error", status: status.status };
  const mode = z
    .object({ enabled: z.boolean(), mode: z.literal("bot").optional() })
    .parse(await status.json());
  if (!mode.enabled) return { kind: "error", status: 503 };
  const bot = mode.mode === "bot";
  const response = await fetch(
    bot ? "/api/auth/telegram-bot/browser" : "/api/auth/telegram/start",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
      body: JSON.stringify({
        intent,
        locale,
        ...(bot ? { action: "start" } : {}),
      }),
    },
  );
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
  if (bot)
    return {
      kind: "bot",
      wait: telegramWaitSchema.parse(await response.json()),
    };
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
