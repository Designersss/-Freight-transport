import { parseEnvironment } from "@freight/config/environment";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test"]),
  TELEGRAM_BOT_TOKEN: z.string().regex(/^[0-9]{1,20}:[A-Za-z0-9_-]{20,128}$/),
  AUTH_TELEGRAM_BOT_INTERNAL_SECRET: z.string().regex(/^[0-9a-f]{64}$/),
  TELEGRAM_BOT_API_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      value === url.origin
    );
  }),
  AUTH_WEB_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && value === url.origin;
  }),
});

export type BotConfig = z.infer<typeof schema>;

export function parseBotConfig(env: Record<string, unknown>): BotConfig {
  return parseEnvironment(schema, env, "Telegram bot");
}
