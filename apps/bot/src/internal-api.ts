import type { TelegramBotCommand } from "@freight/auth/telegram-bot-internal";
import { z } from "zod";
import type { BotConfig } from "./config.js";

export interface BotInternalApi {
  send<T>(command: TelegramBotCommand, result: z.ZodType<T>): Promise<T>;
}

export function createBotInternalApi(
  config: BotConfig,
  request: typeof fetch = fetch,
): BotInternalApi {
  const endpoint = new URL(
    "/internal/telegram-bot",
    config.TELEGRAM_BOT_API_ORIGIN,
  );
  return {
    async send(command, result) {
      try {
        const response = await request(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.AUTH_TELEGRAM_BOT_INTERNAL_SECRET}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(command),
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("Internal request rejected");
        const parsed = z.strictObject({ result }).safeParse(await response.json());
        if (!parsed.success) throw new Error("Invalid internal response");
        return parsed.data.result;
      } catch {
        // Never expose request bodies, service secrets or upstream URLs.
        throw new Error("Telegram internal API unavailable");
      }
    },
  };
}
