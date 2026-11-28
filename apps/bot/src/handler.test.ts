import type { TelegramBotCommand } from "@freight/auth/telegram-bot-internal";
import { describe, expect, it, vi } from "vitest";
import type { BotConfig } from "./config.js";
import { createBotHandler } from "./handler.js";
import type { BotInternalApi } from "./internal-api.js";
import type { ReplyMarkup, TelegramTransport } from "./telegram.js";

const config: BotConfig = {
  NODE_ENV: "test",
  TELEGRAM_BOT_TOKEN: "123456:synthetic-token-for-tests",
  AUTH_TELEGRAM_BOT_INTERNAL_SECRET: "a".repeat(64),
  TELEGRAM_BOT_API_ORIGIN: "http://127.0.0.1:4000",
  AUTH_WEB_ORIGIN: "https://movaro.test",
};
const requestId = "1b7a89d1-1b4a-4a76-8a5a-548744bcac44";
const deepLink = "a".repeat(43);
const proof = "b".repeat(43);
const actor = { chatType: "private", chatId: "123456", userId: "123456" };
const user = {
  id: 123456,
  is_bot: false,
  first_name: "Synthetic",
  language_code: "en",
};
const message = () => ({
  message_id: 1,
  date: Math.floor(Date.now() / 1000),
  chat: { id: user.id, type: "private" },
  from: user,
});

function fixture() {
  const commands: TelegramBotCommand[] = [];
  const api: BotInternalApi = {
    async send(command, schema) {
      commands.push(command);
      const result =
        command.action === "claim"
          ? {
              id: requestId,
              intent: "login",
              locale: "en",
              displayCode: "123456",
              expiresAt: new Date(Date.now() + 300000).toISOString(),
              needsContact: false,
              accountState: "active",
            }
          : command.action === "approve"
            ? proof
            : null;
      return schema.parse(result);
    },
  };
  let messageId = 100;
  const sent: { id: number; markup: ReplyMarkup | undefined }[] = [];
  const telegram: TelegramTransport = {
    getUpdates: vi.fn(async () => []),
    sendMessage: vi.fn(
      async (_chatId: string, _text: string, markup?: ReplyMarkup) => {
        const id = ++messageId;
        sent.push({ id, markup });
        return id;
      },
    ),
    answerCallback: vi.fn(async () => undefined),
  };
  return {
    commands,
    sent,
    telegram,
    handle: createBotHandler(config, api, telegram),
  };
}

describe("Telegram private chat handler", () => {
  it("binds approval to the live actor and message, and returns a fragment", async () => {
    const { handle, commands, sent } = fixture();
    await handle({
      update_id: 1,
      message: { ...message(), text: `/start ${deepLink}` },
    });
    expect(commands[0]).toMatchObject({ action: "claim", actor, deepLink });
    const prompt = sent[0];
    const markup = prompt?.markup;
    if (!prompt || !markup || !("inline_keyboard" in markup))
      throw new Error("Expected approval prompt");
    const button = markup.inline_keyboard[0]?.[0];
    if (!button || !("callback_data" in button))
      throw new Error("Expected approval callback");
    const click = {
      id: "callback",
      from: user,
      message: { ...message(), message_id: prompt.id },
      data: button.callback_data,
    };
    await handle({
      update_id: 2,
      callback_query: { ...click, from: { ...user, id: 654321 } },
    });
    await handle({
      update_id: 3,
      callback_query: {
        ...click,
        message: { ...click.message, message_id: 999 },
      },
    });
    expect(commands).toHaveLength(1);
    await handle({ update_id: 4, callback_query: click });
    await handle({ update_id: 5, callback_query: click });
    expect(commands).toHaveLength(2);
    expect(commands[1]).toEqual({ action: "approve", actor, requestId });
    const returned = sent[1]?.markup;
    if (!returned || !("inline_keyboard" in returned))
      throw new Error("Expected return button");
    const link = returned.inline_keyboard[0]?.[0];
    if (!link || !("url" in link)) throw new Error("Expected return URL");
    const url = new URL(link.url);
    expect(url.origin).toBe(config.AUTH_WEB_ORIGIN);
    expect(url.pathname).toBe("/en/telegram/return");
    expect(url.search).toBe("");
    expect(new URLSearchParams(url.hash.slice(1)).get("proof")).toBe(proof);
  });

  it("ignores groups, forwarded updates, stale messages and foreign senders", async () => {
    const { handle, commands } = fixture();
    const start = { ...message(), text: `/start ${deepLink}` };
    for (const [index, invalid] of [
      { ...start, chat: { id: user.id, type: "group" } },
      { ...start, forward_origin: { type: "user" } },
      { ...start, from: { ...user, id: 654321 } },
      { ...start, date: start.date - 600 },
    ].entries()) {
      await handle({ update_id: index + 1, message: invalid });
    }
    expect(commands).toHaveLength(0);
  });

  it("does not accept an approval callback after a process restart", async () => {
    const { handle, commands } = fixture();
    await handle({
      update_id: 1,
      callback_query: {
        id: "callback",
        from: user,
        message: message(),
        data: "old-callback",
      },
    });
    expect(commands).toHaveLength(0);
  });
});
