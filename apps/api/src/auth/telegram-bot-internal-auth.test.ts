import { describe, expect, it } from "vitest";
import {
  authorizeTelegramBotInternalRequest,
  parseTelegramBotInternalSecret,
} from "./telegram-bot-internal-auth.js";

const secret = "a".repeat(64);
const headers = ["Authorization", `Bearer ${secret}`];

describe("Telegram bot internal authentication", () => {
  it("is disabled without a dedicated secret", () => {
    expect(parseTelegramBotInternalSecret({})).toBeUndefined();
    expect(
      authorizeTelegramBotInternalRequest(undefined, "127.0.0.1", headers),
    ).toBe(false);
  });

  it("accepts a distinct 256-bit hex secret", () => {
    expect(
      parseTelegramBotInternalSecret({
        AUTH_TELEGRAM_BOT_INTERNAL_SECRET: secret,
      }),
    ).toBe(secret);
  });

  it.each(["", "short", "A".repeat(64), null, 3])(
    "rejects an invalid secret: %s",
    (value) => {
      expect(() =>
        parseTelegramBotInternalSecret({
          AUTH_TELEGRAM_BOT_INTERNAL_SECRET: value,
        }),
      ).toThrow("Invalid Telegram bot internal authentication secret");
    },
  );

  it.each([
    "AUTH_SECRET",
    "AUTH_ADMIN_SECRET",
    "AUTH_PROXY_SECRET",
    "AUTH_TELEGRAM_CLIENT_SECRET",
    "TELEGRAM_BOT_TOKEN",
  ])("rejects secret reuse from %s", (key) => {
    expect(() =>
      parseTelegramBotInternalSecret({
        AUTH_TELEGRAM_BOT_INTERNAL_SECRET: secret,
        [key]: secret,
      }),
    ).toThrow("Invalid Telegram bot internal authentication secret");
  });

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])(
    "accepts a direct authenticated local peer: %s",
    (peer) => {
      expect(
        authorizeTelegramBotInternalRequest(secret, peer, headers),
      ).toBe(true);
    },
  );

  it.each(["192.0.2.1", "127.0.0.2", "::ffff:192.0.2.1", undefined])(
    "rejects a non-local or unknown peer: %s",
    (peer) => {
      expect(
        authorizeTelegramBotInternalRequest(secret, peer, headers),
      ).toBe(false);
    },
  );

  it.each([
    { raw: [] },
    { raw: ["Authorization", `Bearer ${"b".repeat(64)}`] },
    { raw: [...headers, "authorization", headers[1] as string] },
    { raw: ["Authorization"] },
    { raw: ["Authorization", `Bearer ${secret},Bearer ${secret}`] },
  ])("rejects missing, invalid or ambiguous credentials", ({ raw }) => {
    expect(
      authorizeTelegramBotInternalRequest(secret, "127.0.0.1", raw),
    ).toBe(false);
  });

  it.each([
    "Origin",
    "Cookie",
    "Forwarded",
    "X-Forwarded-For",
    "X-Movaro-Proxy-Secret",
    "Sec-Fetch-Site",
  ])("rejects browser or forwarding headers: %s", (name) => {
    expect(
      authorizeTelegramBotInternalRequest(secret, "127.0.0.1", [
        ...headers,
        name,
        "anything",
      ]),
    ).toBe(false);
  });
});
