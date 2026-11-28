import { z } from "zod";

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const user = z.object({
  id,
  is_bot: z.boolean(),
  first_name: z.string().max(128),
  last_name: z.string().max(128).optional(),
  language_code: z.string().max(32).optional(),
});
const chat = z.object({ id: z.number().int(), type: z.string() });
const message = z.object({
  message_id: id,
  date: z.number().int().nonnegative(),
  chat,
  from: user.optional(),
  text: z.string().max(4096).optional(),
  contact: z
    .object({
      user_id: id.optional(),
      phone_number: z.string().max(64),
    })
    .optional(),
  forward_origin: z.unknown().optional(),
  sender_chat: z.unknown().optional(),
  via_bot: z.unknown().optional(),
  reply_to_message: z.object({ message_id: id }).optional(),
});
const callback = z.object({
  id: z.string().min(1).max(128),
  from: user,
  message: message.optional(),
  data: z.string().max(64).optional(),
});
const update = z.object({
  update_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  message: z.unknown().optional(),
  callback_query: z.unknown().optional(),
});
export type TelegramUpdate = z.infer<typeof update>;
export type TelegramMessage = z.infer<typeof message>;

export function privateMessage(raw: unknown) {
  const parsed = message.safeParse(raw);
  if (!parsed.success) return null;
  const m = parsed.data;
  if (
    !m.from ||
    m.from.is_bot ||
    m.chat.type !== "private" ||
    m.chat.id !== m.from.id ||
    m.forward_origin !== undefined ||
    m.sender_chat !== undefined ||
    m.via_bot !== undefined
  ) {
    return null;
  }
  return { message: m, user: m.from, actor: actorFor(m.from.id) };
}

export function privateCallback(raw: unknown) {
  const parsed = callback.safeParse(raw);
  if (!parsed.success) return null;
  const c = parsed.data;
  if (
    c.from.is_bot ||
    !c.message ||
    c.message.date === 0 ||
    c.message.chat.type !== "private" ||
    c.message.chat.id !== c.from.id ||
    !c.data
  ) {
    return null;
  }
  return { callback: c, actor: actorFor(c.from.id), message: c.message };
}

function actorFor(userId: number) {
  return {
    chatType: "private" as const,
    chatId: String(userId),
    userId: String(userId),
  };
}

type InlineButton =
  | { text: string; callback_data: string }
  | { text: string; url: string };
export type ReplyMarkup =
  | { inline_keyboard: InlineButton[][] }
  | {
      keyboard: { text: string; request_contact: true }[][];
      resize_keyboard: true;
      one_time_keyboard: true;
    }
  | { remove_keyboard: true }
  | { force_reply: true; selective: false };

export interface TelegramTransport {
  getUpdates(
    offset: number | undefined,
    signal: AbortSignal,
  ): Promise<TelegramUpdate[]>;
  sendMessage(chatId: string, text: string, markup?: ReplyMarkup): Promise<number>;
  answerCallback(id: string): Promise<void>;
}

export function createTelegramTransport(
  token: string,
  request: typeof fetch = fetch,
): TelegramTransport {
  async function call<T>(
    method: "getUpdates" | "sendMessage" | "answerCallbackQuery",
    body: unknown,
    result: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T> {
    try {
      const response = await request(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          redirect: "error",
          signal,
        },
      );
      if (!response.ok) throw new Error("Telegram rejected request");
      const parsed = z.object({ ok: z.literal(true), result }).safeParse(
        await response.json(),
      );
      if (!parsed.success) throw new Error("Invalid Telegram response");
      return parsed.data.result;
    } catch {
      throw new Error("Telegram transport unavailable");
    }
  }

  return {
    getUpdates(offset, signal) {
      return call(
        "getUpdates",
        {
          offset,
          timeout: 25,
          limit: 50,
          allowed_updates: ["message", "callback_query"],
        },
        z.array(update),
        AbortSignal.any([signal, AbortSignal.timeout(35000)]),
      );
    },
    async sendMessage(chatId, text, markup) {
      const sent = await call(
        "sendMessage",
        {
          chat_id: chatId,
          text,
          reply_markup: markup,
          link_preview_options: { is_disabled: true },
        },
        z.object({ message_id: id }),
        AbortSignal.timeout(10000),
      );
      return sent.message_id;
    },
    async answerCallback(id) {
      await call(
        "answerCallbackQuery",
        { callback_query_id: id },
        z.literal(true),
        AbortSignal.timeout(5000),
      );
    },
  };
}
