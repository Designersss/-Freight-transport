import type { Pool } from "pg";
import { z } from "zod";
import { reserveTelegramActorRequest } from "./mail-rate-limit.js";
import {
  changeTelegramBotIntent,
  claimTelegramBotRequest,
  prepareTelegramBotApproval,
  privateTelegramActor,
  readTelegramBotAccountState,
  rejectTelegramBotRequest,
  saveTelegramBotContact,
} from "./telegram-bot-requests.js";
import {
  beginBotOnlyRegistrationDraft,
  beginTelegramRegistrationDraft,
  beginTelegramRegistrationInBot,
  cancelTelegramRegistrationDraft,
  completeTelegramRegistrationDraft,
  findTelegramRegistrationDraft,
  readTelegramRegistrationDraft,
  resumeTelegramRegistrationInBrowser,
  telegramDraftMutationInput,
  updateTelegramRegistrationDraft,
} from "./telegram-registration-draft.js";
import { suggestUsername } from "./username.js";

const telegramId = z.string().regex(/^[1-9][0-9]{0,15}$/);
const actor = z
  .strictObject({
    chatType: z.literal("private"),
    chatId: telegramId,
    userId: telegramId,
  })
  .refine(privateTelegramActor);
const contact = z.strictObject({
  userId: telegramId,
  phoneNumber: z.string().regex(/^[+]?[1-9][0-9]{1,14}$/),
  forwarded: z.literal(false),
});
const names = z.strictObject({
  firstName: z.string().max(128).optional(),
  lastName: z.string().max(128).optional(),
});
const request = { actor, requestId: z.uuid() };
const draft = { actor, draftId: z.uuid() };
const revision = z.number().int().min(0).max(2_147_483_646);

export const telegramBotCommandInput = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("claim"),
    actor,
    deepLink: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    names,
  }),
  z.strictObject({ action: z.literal("account-state"), actor }),
  z.strictObject({
    action: z.literal("change-intent"),
    ...request,
    intent: z.enum(["login", "register"]),
    names,
  }),
  z.strictObject({ action: z.literal("contact"), ...request, contact }),
  z.strictObject({ action: z.literal("approve"), ...request }),
  z.strictObject({ action: z.literal("reject"), ...request }),
  z.strictObject({ action: z.literal("draft-begin-chat"), ...request }),
  z.strictObject({
    action: z.literal("draft-begin"),
    ...request,
    channel: z.enum(["web", "bot"]),
  }),
  z.strictObject({
    action: z.literal("draft-begin-bot"),
    actor,
    contact,
    names,
    locale: z.enum(["ru", "en"]),
  }),
  z.strictObject({
    action: z.literal("draft-resume-browser"),
    ...draft,
    requestId: z.uuid(),
    revision,
  }),
  z.strictObject({ action: z.literal("draft-find"), actor }),
  z.strictObject({ action: z.literal("draft-suggest-username"), ...draft }),
  z.strictObject({ action: z.literal("draft-read"), ...draft }),
  z.strictObject({
    action: z.literal("draft-update"),
    ...draft,
    mutation: telegramDraftMutationInput,
  }),
  z.strictObject({ action: z.literal("draft-complete"), ...draft, revision }),
  z.strictObject({ action: z.literal("draft-cancel"), ...draft, revision }),
]);

export type TelegramBotCommand = z.infer<typeof telegramBotCommandInput>;

// Only the authenticated internal transport may invoke these commands.
// Actor and contact evidence must come from genuine Telegram updates;
// the bot must match contacts and callbacks to a live private prompt.
async function execute(pool: Pool, command: TelegramBotCommand): Promise<unknown> {
  const access = { channel: "bot" as const, actor: command.actor };
  switch (command.action) {
    case "account-state":
      return readTelegramBotAccountState(pool, command.actor);
    case "claim": {
      const claimed = await claimTelegramBotRequest(
        pool,
        command.deepLink,
        command.actor,
        command.names,
      );
      return claimed
        ? {
            ...claimed,
            accountState: await readTelegramBotAccountState(pool, command.actor),
          }
        : null;
    }
    case "change-intent": {
      const claimed = await changeTelegramBotIntent(
        pool,
        command.requestId,
        command.actor,
        command.intent,
        command.names,
      );
      return claimed
        ? {
            ...claimed,
            accountState: await readTelegramBotAccountState(pool, command.actor),
          }
        : null;
    }
    case "contact":
      return saveTelegramBotContact(
        pool,
        command.requestId,
        command.actor,
        command.contact,
      );
    case "approve":
      return prepareTelegramBotApproval(pool, command.requestId, command.actor);
    case "reject":
      return rejectTelegramBotRequest(pool, command.requestId, command.actor);
    case "draft-begin-chat":
      return beginTelegramRegistrationInBot(pool, command.requestId, command.actor);
    case "draft-begin":
      return beginTelegramRegistrationDraft(
        pool,
        command.requestId,
        command.actor,
        command.channel,
      );
    case "draft-begin-bot":
      return beginBotOnlyRegistrationDraft(
        pool,
        command.actor,
        command.contact,
        command.names,
        command.locale,
      );
    case "draft-resume-browser":
      return resumeTelegramRegistrationInBrowser(
        pool,
        command.draftId,
        command.requestId,
        command.actor,
        command.revision,
      );
    case "draft-find":
      return findTelegramRegistrationDraft(pool, access);
    case "draft-suggest-username": {
      const current = await readTelegramRegistrationDraft(
        pool,
        command.draftId,
        access,
      );
      if (
        !current ||
        current.channel !== "bot" ||
        !current.firstName ||
        !current.lastName
      )
        return null;
      return suggestUsername(pool, current.firstName, current.lastName);
    }
    case "draft-read":
      return readTelegramRegistrationDraft(pool, command.draftId, access);
    case "draft-update":
      return updateTelegramRegistrationDraft(
        pool,
        command.draftId,
        access,
        command.mutation,
      );
    case "draft-complete":
      return completeTelegramRegistrationDraft(
        pool,
        command.draftId,
        access,
        command.revision,
      );
    case "draft-cancel":
      return cancelTelegramRegistrationDraft(
        pool,
        command.draftId,
        access,
        command.revision,
      );
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function handleTelegramBotCommand(
  pool: Pool,
  payload: unknown,
  rateLimitSecret: string,
): Promise<Response> {
  const parsed = telegramBotCommandInput.safeParse(payload);
  if (!parsed.success) return json({ code: "INVALID_REQUEST" }, 400);
  try {
    const retry = await reserveTelegramActorRequest(
      pool,
      rateLimitSecret,
      parsed.data.actor.userId,
    );
    if (retry !== null) {
      const response = json({ code: "RATE_LIMITED" }, 429);
      response.headers.set("retry-after", String(retry));
      return response;
    }
    return json({ result: await execute(pool, parsed.data) }, 200);
  } catch {
    // No DB error details, proof values, request bodies or personal data.
    return json({ code: "AUTH_REQUEST_FAILED" }, 503);
  }
}
