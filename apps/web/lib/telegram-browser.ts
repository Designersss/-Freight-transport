import type { TelegramBrowserCommand } from "@freight/auth/contracts";
import type { Locale } from "@freight/i18n";
import { z } from "zod";

export const telegramWaitSchema = z.strictObject({
  requestId: z.uuid(),
  url: z
    .string()
    .max(512)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.origin === "https://t.me" &&
          !url.username &&
          !url.password &&
          !url.hash &&
          /^\/[A-Za-z][A-Za-z0-9_]{1,28}[Bb][Oo][Tt]$/.test(url.pathname) &&
          [...url.searchParams.keys()].length === 1 &&
          /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get("start") ?? "")
        );
      } catch {
        return false;
      }
    }),
  displayCode: z.string().regex(/^[0-9]{6}$/),
  expiresAt: z.iso.datetime(),
});

export type TelegramWait = z.infer<typeof telegramWaitSchema>;
export const waitStorageKey = "movaro.telegram.wait";

export const telegramStatusResponse = z.object({
  status: z
    .enum([
      "pending",
      "claimed",
      "approved",
      "rejected",
      "cancelled",
      "consumed",
      "expired",
    ])
    .nullable(),
});
export const telegramFinishResponse = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("logged-in") }),
  z.strictObject({ outcome: z.literal("linked") }),
  z.strictObject({ outcome: z.literal("registration"), draftId: z.uuid() }),
]);
export type TelegramFinish = z.infer<typeof telegramFinishResponse>;

export const telegramDraftSchema = z.strictObject({
  id: z.uuid(),
  channel: z.enum(["web", "bot"]),
  locale: z.enum(["ru", "en"]),
  revision: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  role: z.enum(["COMPANY_OWNER", "DISPATCHER", "DRIVER"]).nullable(),
  birthDate: z.string().nullable(),
  companyName: z.string().nullable(),
  username: z.string().nullable(),
});

export const telegramDraftResponse = z.strictObject({
  draft: telegramDraftSchema.nullable(),
});

export const telegramDraftStateResponse = telegramDraftResponse.extend({
  completed: z.boolean(),
});

export async function telegramBrowserRequest<T>(
  command: TelegramBrowserCommand,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/auth/telegram-bot/browser", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
      : AbortSignal.timeout(25000),
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error("Telegram request failed");
  return schema.parse(await response.json());
}

export function readTelegramWait(): TelegramWait | null {
  try {
    const raw = sessionStorage.getItem(waitStorageKey);
    if (!raw) return null;
    const parsed = telegramWaitSchema.safeParse(JSON.parse(raw));
    if (parsed.success && Date.parse(parsed.data.expiresAt) > Date.now())
      return parsed.data;
    sessionStorage.removeItem(waitStorageKey);
  } catch {
    // Storage may be unavailable in the browser's privacy mode.
  }
  return null;
}

export function forgetTelegramWait(): void {
  try {
    sessionStorage.removeItem(waitStorageKey);
  } catch {
    // No browser capability is stored here.
  }
}

export function parseTelegramReturn(hash: string) {
  if (!hash.startsWith("#") || hash.length > 200) return null;
  const params = new URLSearchParams(hash.slice(1));
  if (
    [...params.keys()].length !== 2 ||
    params.getAll("requestId").length !== 1 ||
    params.getAll("proof").length !== 1
  )
    return null;
  const parsed = z
    .strictObject({
      requestId: z.uuid(),
      proof: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    })
    .safeParse({
      requestId: params.get("requestId"),
      proof: params.get("proof"),
    });
  return parsed.success ? parsed.data : null;
}

export type TelegramIntent = "login" | "register" | "link";

export type TelegramStartResult =
  | { kind: "bot"; wait: TelegramWait }
  | { kind: "error"; status: number; code?: string };

const telegramStartError = z.object({ code: z.string() });

export async function startTelegramAuth(
  intent: TelegramIntent,
  locale: Locale,
  signal: AbortSignal,
): Promise<TelegramStartResult> {
  const response = await fetch("/api/auth/telegram-bot/browser", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal,
    body: JSON.stringify({ action: "start", intent, locale }),
  });
  if (!response.ok) {
    const parsed = telegramStartError.safeParse(
      await response.json().catch(() => null),
    );
    return {
      kind: "error",
      status: response.status,
      ...(parsed.success ? { code: parsed.data.code } : {}),
    };
  }
  return {
    kind: "bot",
    wait: telegramWaitSchema.parse(await response.json()),
  };
}
