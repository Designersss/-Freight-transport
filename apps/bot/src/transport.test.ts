import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { type BotConfig, parseBotConfig } from "./config.js";
import { createBotInternalApi } from "./internal-api.js";
import { pollTelegram } from "./polling.js";
import type { TelegramTransport } from "./telegram.js";

const env = {
  NODE_ENV: "test",
  TELEGRAM_BOT_TOKEN: "123456:synthetic-token-for-tests",
  AUTH_TELEGRAM_BOT_INTERNAL_SECRET: "a".repeat(64),
  TELEGRAM_BOT_API_ORIGIN: "http://127.0.0.1:4000",
  AUTH_WEB_ORIGIN: "https://movaro.test",
} satisfies BotConfig;

describe("bot config", () => {
  it("only accepts a loopback API and an HTTPS Web origin", () => {
    expect(parseBotConfig(env)).toEqual(env);
    for (const override of [
      { TELEGRAM_BOT_API_ORIGIN: "https://attacker.example" },
      { TELEGRAM_BOT_API_ORIGIN: "http://127.0.0.1:4000/path" },
      { TELEGRAM_BOT_API_ORIGIN: "http://127.0.0.1:4000@attacker.example" },
      { AUTH_WEB_ORIGIN: "http://movaro.test" },
      { AUTH_TELEGRAM_BOT_INTERNAL_SECRET: "invalid" },
      { NODE_ENV: "production" },
    ]) {
      expect(() => parseBotConfig({ ...env, ...override })).toThrow();
    }
  });
});

describe("internal bot client", () => {
  const command = {
    action: "draft-find",
    actor: { chatType: "private", chatId: "123456", userId: "123456" },
  } as const;

  it("sends a secret only to the loopback transport", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ result: null }),
    );
    const api = createBotInternalApi(env, fetcher);
    expect(await api.send(command, z.null())).toBeNull();
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe("http://127.0.0.1:4000/internal/telegram-bot");
    expect(options?.redirect).toBe("error");
    expect(options?.headers).toEqual({
      authorization: `Bearer ${env.AUTH_TELEGRAM_BOT_INTERNAL_SECRET}`,
      "content-type": "application/json",
    });
    expect(JSON.parse(String(options?.body))).toEqual(command);
  });

  it("sanitizes transport errors and rejects unexpected responses", async () => {
    for (const fetcher of [
      vi.fn<typeof fetch>(async () => {
        throw new Error(env.AUTH_TELEGRAM_BOT_INTERNAL_SECRET);
      }),
      vi.fn<typeof fetch>(async () => Response.json({ result: "invalid" })),
    ]) {
      await expect(
        createBotInternalApi(env, fetcher).send(command, z.null()),
      ).rejects.toThrow("Telegram internal API unavailable");
    }
  });
});

describe("long polling", () => {
  it("serializes updates, skips duplicates and advances after an uncertain mutation", async () => {
    const shutdown = new AbortController();
    const seen: number[] = [];
    const offsets: (number | undefined)[] = [];
    const report = vi.fn();
    const telegram: TelegramTransport = {
      async getUpdates(offset) {
        offsets.push(offset);
        if (offset === undefined) {
          return [
            { update_id: 3 },
            { update_id: 1 },
            { update_id: 1 },
            { update_id: 2 },
          ];
        }
        shutdown.abort();
        return [];
      },
      sendMessage: vi.fn(async () => 1),
      answerCallback: vi.fn(async () => undefined),
    };
    await pollTelegram(
      telegram,
      async ({ update_id }) => {
        seen.push(update_id);
        if (update_id === 2) throw new Error("uncertain mutation");
      },
      shutdown.signal,
      report,
    );
    expect(seen).toEqual([1, 2, 3]);
    expect(offsets).toEqual([undefined, 4]);
    expect(report).toHaveBeenCalledExactlyOnceWith("update-failed");
  });
});
