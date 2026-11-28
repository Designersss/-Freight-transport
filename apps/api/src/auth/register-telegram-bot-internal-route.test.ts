import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  registerTelegramBotInternalRoute,
  TELEGRAM_BOT_INTERNAL_PATH,
} from "./register-telegram-bot-internal-route.js";

const secret = "a".repeat(64);
const headers = {
  authorization: `Bearer ${secret}`,
  "content-type": "application/json",
};

async function fixture() {
  const app = Fastify({ logger: false, trustProxy: false });
  const handleTelegramBotCommand = vi.fn(async (_payload: unknown) =>
    Response.json({ result: true }),
  );
  registerTelegramBotInternalRoute(app, { handleTelegramBotCommand }, secret);
  await app.ready();
  return { app, handleTelegramBotCommand };
}

describe("Telegram bot internal transport", () => {
  it("accepts a direct authenticated local JSON request", async () => {
    const { app, handleTelegramBotCommand } = await fixture();
    try {
      const response = await app.inject({
        method: "POST",
        url: TELEGRAM_BOT_INTERNAL_PATH,
        remoteAddress: "127.0.0.1",
        headers,
        payload: { action: "draft-find" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(response.json()).toEqual({ result: true });
      expect(handleTelegramBotCommand).toHaveBeenCalledExactlyOnceWith({
        action: "draft-find",
      });
    } finally {
      await app.close();
    }
  });

  it.each([
    { authorization: "" },
    { authorization: `Bearer ${"b".repeat(64)}` },
    { origin: "https://movaro.test" },
    { cookie: "session=example" },
    { "x-forwarded-for": "127.0.0.1" },
    { "sec-fetch-site": "same-origin" },
  ])("rejects untrusted headers: %j", async (extra) => {
    const { app, handleTelegramBotCommand } = await fixture();
    try {
      const response = await app.inject({
        method: "POST",
        url: TELEGRAM_BOT_INTERNAL_PATH,
        remoteAddress: "127.0.0.1",
        headers: { ...headers, ...extra },
        payload: {},
      });
      expect(response.statusCode).toBe(403);
      expect(handleTelegramBotCommand).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("rejects a non-loopback peer even with the correct secret", async () => {
    const { app, handleTelegramBotCommand } = await fixture();
    try {
      const response = await app.inject({
        method: "POST",
        url: TELEGRAM_BOT_INTERNAL_PATH,
        remoteAddress: "192.0.2.1",
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(403);
      expect(handleTelegramBotCommand).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("rejects query parameters, malformed JSON and oversized bodies", async () => {
    const { app, handleTelegramBotCommand } = await fixture();
    try {
      for (const [url, payload, status] of [
        [`${TELEGRAM_BOT_INTERNAL_PATH}?proof=test`, "{}", 400],
        [TELEGRAM_BOT_INTERNAL_PATH, "{", 400],
        [TELEGRAM_BOT_INTERNAL_PATH, JSON.stringify("x".repeat(8192)), 413],
      ] as const) {
        const response = await app.inject({
          method: "POST",
          url,
          remoteAddress: "127.0.0.1",
          headers,
          payload,
        });
        expect(response.statusCode).toBe(status);
        expect(response.json()).toEqual({ code: "INVALID_REQUEST" });
      }
      expect(handleTelegramBotCommand).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("does not expose internal exceptions", async () => {
    const { app, handleTelegramBotCommand } = await fixture();
    try {
      handleTelegramBotCommand.mockRejectedValueOnce(
        new Error("sensitive database detail"),
      );
      const response = await app.inject({
        method: "POST",
        url: TELEGRAM_BOT_INTERNAL_PATH,
        remoteAddress: "127.0.0.1",
        headers,
        payload: {},
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ code: "AUTH_REQUEST_FAILED" });
    } finally {
      await app.close();
    }
  });
});
