import { randomBytes } from "node:crypto";
import {
  birthDateInput,
  profileSettingsInput,
  usernameInput,
} from "@freight/auth/contracts";
import { z } from "zod";
import type { BotConfig } from "./config.js";
import type { BotInternalApi } from "./internal-api.js";
import { messages, roleLabel } from "./messages.js";
import {
  accountStateResult,
  type Claim,
  claimResult,
  completionResult,
  type Draft,
  draftIdResult,
  draftResult,
  type Locale,
  proofResult,
  type Role,
  usernameResult,
} from "./results.js";
import {
  privateCallback,
  privateMessage,
  type TelegramTransport,
  type TelegramUpdate,
} from "./telegram.js";

type Actor = { chatType: "private"; chatId: string; userId: string };
type Field =
  | "firstName"
  | "lastName"
  | "birthDate"
  | "companyName"
  | "username";
type Choice = { label: string; run: () => Promise<void> };
type PrivateMessage = NonNullable<ReturnType<typeof privateMessage>>;
type Prompt =
  | { kind: "buttons"; messageId: number; choices: Map<string, Choice> }
  | { kind: "text"; messageId: number; run: (text: string) => Promise<void> }
  | {
      kind: "contact";
      since: number;
      run: (message: PrivateMessage) => Promise<void>;
    };
type LivePrompt = Prompt & { expiresAt: number };

const roles: Role[] = ["COMPANY_OWNER", "DISPATCHER", "DRIVER"];
const ttl = 5 * 60_000;
const maxPrompts = 1000;

export function createBotHandler(
  config: BotConfig,
  api: BotInternalApi,
  telegram: TelegramTransport,
) {
  const prompts = new Map<string, LivePrompt>();
  const say = (actor: Actor, text: string) =>
    telegram.sendMessage(actor.chatId, text);
  const remember = (actor: Actor, prompt: Prompt) => {
    const now = Date.now();
    for (const [key, value] of prompts) {
      if (value.expiresAt <= now) prompts.delete(key);
    }
    prompts.delete(actor.userId);
    if (prompts.size >= maxPrompts) {
      const oldest = prompts.keys().next().value;
      if (oldest !== undefined) prompts.delete(oldest);
    }
    prompts.set(actor.userId, { ...prompt, expiresAt: now + ttl });
  };

  async function buttons(actor: Actor, text: string, choices: Choice[]) {
    const entries = choices.map((choice) => ({
      choice,
      key: randomBytes(18).toString("base64url"),
    }));
    const messageId = await telegram.sendMessage(actor.chatId, text, {
      inline_keyboard: entries.map(({ key, choice }) => [
        { text: choice.label, callback_data: key },
      ]),
    });
    remember(actor, {
      kind: "buttons",
      messageId,
      choices: new Map(entries.map(({ key, choice }) => [key, choice])),
    });
  }

  async function askText(
    actor: Actor,
    text: string,
    run: (text: string) => Promise<void>,
  ) {
    const messageId = await telegram.sendMessage(actor.chatId, text, {
      force_reply: true,
      selective: false,
    });
    remember(actor, { kind: "text", messageId, run });
  }

  async function askContact(
    actor: Actor,
    locale: Locale,
    run: (message: PrivateMessage) => Promise<void>,
  ) {
    const m = messages[locale];
    const since = Math.floor(Date.now() / 1000);
    await telegram.sendMessage(actor.chatId, m.share, {
      keyboard: [[{ text: m.contact, request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    });
    remember(actor, { kind: "contact", since, run });
  }

  const find = (actor: Actor) =>
    api.send({ action: "draft-find", actor }, draftResult);
  const read = (actor: Actor, draftId: string) =>
    api.send({ action: "draft-read", actor, draftId }, draftResult);

  async function resume(actor: Actor, locale: Locale) {
    const draft = await find(actor);
    if (draft) await showDraft(actor, draft);
    else await welcome(actor, locale);
  }

  async function edit(actor: Actor, draft: Draft, field: Field, value: string) {
    const updated = await api.send(
      {
        action: "draft-update",
        actor,
        draftId: draft.id,
        mutation: { action: "edit", revision: draft.revision, [field]: value },
      },
      draftResult,
    );
    if (updated) await showDraft(actor, updated);
    else {
      await say(actor, messages[draft.locale].invalid);
      await resume(actor, draft.locale);
    }
  }

  async function fieldPrompt(actor: Actor, draft: Draft, field: Field) {
    await askText(actor, messages[draft.locale][field], async (value) => {
      const schema =
        field === "birthDate"
          ? birthDateInput
          : field === "username"
            ? usernameInput
            : profileSettingsInput.shape.firstName;
      const parsed = schema.safeParse(value.trim());
      if (!parsed.success) {
        await say(actor, messages[draft.locale].invalid);
        await fieldPrompt(actor, draft, field);
        return;
      }
      await edit(actor, draft, field, parsed.data);
    });
  }

  async function rolePrompt(actor: Actor, draft: Draft) {
    await buttons(
      actor,
      messages[draft.locale].role,
      roles.map((role) => ({
        label: roleLabel(draft.locale, role),
        run: async () => {
          const updated = await api.send(
            {
              action: "draft-update",
              actor,
              draftId: draft.id,
              mutation: { action: "edit", revision: draft.revision, role },
            },
            draftResult,
          );
          if (updated) await showDraft(actor, updated);
          else await resume(actor, draft.locale);
        },
      })),
    );
  }

  async function complete(actor: Actor, draft: Draft) {
    const m = messages[draft.locale];
    const result = await api.send(
      {
        action: "draft-complete",
        actor,
        draftId: draft.id,
        revision: draft.revision,
      },
      completionResult,
    );
    if (result === "created") {
      await telegram.sendMessage(actor.chatId, m.created, {
        inline_keyboard: [[{ text: m.website, url: config.AUTH_WEB_ORIGIN }]],
      });
    } else if (result === "username-taken") {
      await say(actor, m.usernameTaken);
      const current = await read(actor, draft.id);
      if (current) await fieldPrompt(actor, current, "username");
    } else {
      await say(actor, m.conflict);
      await resume(actor, draft.locale);
    }
  }

  async function cancel(actor: Actor, draft: Draft) {
    const cancelled = await api.send(
      {
        action: "draft-cancel",
        actor,
        draftId: draft.id,
        revision: draft.revision,
      },
      z.boolean(),
    );
    await say(
      actor,
      messages[draft.locale][cancelled ? "cancelled" : "unavailable"],
    );
  }

  async function showDraft(actor: Actor, draft: Draft): Promise<void> {
    const m = messages[draft.locale];
    if (draft.channel === "web") {
      await buttons(actor, m.webActive, [
        {
          label: m.switch,
          run: async () => {
            const updated = await api.send(
              {
                action: "draft-update",
                actor,
                draftId: draft.id,
                mutation: {
                  action: "switch",
                  revision: draft.revision,
                  channel: "bot",
                },
              },
              draftResult,
            );
            if (updated) await showDraft(actor, updated);
            else await resume(actor, draft.locale);
          },
        },
      ]);
      return;
    }
    if (!draft.firstName) return fieldPrompt(actor, draft, "firstName");
    if (!draft.lastName) return fieldPrompt(actor, draft, "lastName");
    if (!draft.role) return rolePrompt(actor, draft);
    if (!draft.birthDate) return fieldPrompt(actor, draft, "birthDate");
    if (draft.role === "COMPANY_OWNER" && !draft.companyName)
      return fieldPrompt(actor, draft, "companyName");
    if (!draft.username) {
      const username = await api.send(
        { action: "draft-suggest-username", actor, draftId: draft.id },
        usernameResult,
      );
      if (username) {
        const updated = await api.send(
          {
            action: "draft-update",
            actor,
            draftId: draft.id,
            mutation: {
              action: "edit",
              revision: draft.revision,
              username,
            },
          },
          draftResult,
        );
        if (updated) return showDraft(actor, updated);
      }
      return fieldPrompt(actor, draft, "username");
    }
    const fields: { field: Field; label: string }[] = [
      { field: "firstName", label: m.editFirstName },
      { field: "lastName", label: m.editLastName },
      { field: "birthDate", label: m.editBirthDate },
      ...(draft.role === "COMPANY_OWNER"
        ? [{ field: "companyName" as const, label: m.editCompanyName }]
        : []),
      { field: "username", label: m.editUsername },
    ];
    const summary = [
      m.summary,
      ...fields.map(({ field, label }) => `${label}: ${draft[field] ?? ""}`),
      `${m.editRole}: ${roleLabel(draft.locale, draft.role)}`,
    ].join("\n");
    await buttons(actor, summary, [
      { label: m.complete, run: () => complete(actor, draft) },
      ...fields.map(({ field, label }) => ({
        label,
        run: () => fieldPrompt(actor, draft, field),
      })),
      { label: m.editRole, run: () => rolePrompt(actor, draft) },
      { label: m.cancel, run: () => cancel(actor, draft) },
    ]);
  }

  function contactFrom(message: PrivateMessage) {
    const contact = message.message.contact;
    if (!contact || contact.user_id !== message.user.id) return null;
    return {
      userId: message.actor.userId,
      phoneNumber: contact.phone_number,
      forwarded: false as const,
    };
  }

  function namesFrom(message: PrivateMessage) {
    return {
      firstName: message.user.first_name,
      ...(message.user.last_name ? { lastName: message.user.last_name } : {}),
    };
  }

  async function register(actor: Actor, locale: Locale) {
    const state = await api.send({ action: "account-state", actor }, accountStateResult);
    if (state !== "unregistered") {
      await accountNotice(actor, locale, state);
      return;
    }
    const existing = await find(actor);
    if (existing) return showDraft(actor, existing);
    await askContact(actor, locale, async (message) => {
      const contact = contactFrom(message);
      if (!contact) {
        await say(actor, messages[locale].invalidContact);
        return register(actor, locale);
      }
      const id = await api.send(
        {
          action: "draft-begin-bot",
          actor,
          contact,
          names: namesFrom(message),
          locale,
        },
        draftIdResult,
      );
      await telegram.sendMessage(actor.chatId, messages[locale].startAgain, {
        remove_keyboard: true,
      });
      const draft = id ? await read(actor, id) : await find(actor);
      if (draft) await showDraft(actor, draft);
      else await say(actor, messages[locale].unavailable);
    });
  }

  async function accountNotice(
    actor: Actor,
    locale: Locale,
    state: "active" | "unavailable",
  ) {
    const m = messages[locale];
    await telegram.sendMessage(
      actor.chatId,
      state === "active" ? m.alreadyRegistered : m.accountUnavailable,
      {
        inline_keyboard: [[{
          text: m.website,
          url: new URL(`/${locale}/login`, config.AUTH_WEB_ORIGIN).href,
        }]],
      },
    );
  }

  async function welcome(actor: Actor, locale: Locale) {
    const m = messages[locale];
    const state = await api.send({ action: "account-state", actor }, accountStateResult);
    if (state !== "unregistered") return accountNotice(actor, locale, state);
    await buttons(actor, m.welcome, [
      { label: m.register, run: () => register(actor, locale) },
    ]);
    await telegram.sendMessage(actor.chatId, m.website, {
      inline_keyboard: [[{ text: m.website, url: config.AUTH_WEB_ORIGIN }]],
    });
  }

  async function approve(actor: Actor, claim: Claim) {
    const m = messages[claim.locale];
    const proof = await api.send(
      { action: "approve", actor, requestId: claim.id },
      proofResult,
    );
    if (!proof) {
      await say(actor, m.unavailable);
      return;
    }
    // Fragment keeps the independent return capability out of HTTP requests.
    // The Web return handler must POST it with the original host-only cookie.
    const url = new URL(
      `/${claim.locale}/telegram/return`,
      config.AUTH_WEB_ORIGIN,
    );
    url.hash = new URLSearchParams({ requestId: claim.id, proof }).toString();
    await telegram.sendMessage(actor.chatId, m.return, {
      inline_keyboard: [[{ text: m.website, url: url.href }]],
    });
  }

  async function choices(actor: Actor, claim: Claim) {
    const m = messages[claim.locale];
    const intent =
      claim.intent === "register" ? m.registration : m[claim.intent];
    const actions: Choice[] = [
      { label: m.approve, run: () => approve(actor, claim) },
      {
        label: m.reject,
        run: async () => {
          const rejected = await api.send(
            { action: "reject", actor, requestId: claim.id },
            z.boolean(),
          );
          await say(actor, rejected ? m.rejected : m.unavailable);
        },
      },
    ];
    if (claim.intent === "register") {
      actions.splice(1, 0, {
        label: m.chat,
        run: async () => {
          const id = await api.send(
            { action: "draft-begin-chat", actor, requestId: claim.id },
            draftIdResult,
          );
          const draft = id ? await read(actor, id) : await find(actor);
          if (draft) await showDraft(actor, draft);
          else await say(actor, m.unavailable);
        },
      });
    }
    await buttons(
      actor,
      `${intent}: ${claim.displayCode}\n${m.verify}`,
      actions,
    );
  }

  async function claimRequest(
    message: PrivateMessage,
    deepLink: string,
    locale: Locale,
  ) {
    const { actor } = message;
    const claim = await api.send(
      { action: "claim", actor, deepLink, names: namesFrom(message) },
      claimResult,
    );
    if (!claim) {
      await say(actor, messages[locale].unavailable);
      return;
    }
    return routeClaim(message, claim, locale, deepLink);
  }

  async function routeClaim(
    message: PrivateMessage,
    claim: Claim,
    locale: Locale,
    deepLink: string,
  ): Promise<void> {
    const { actor } = message;
    const m = messages[claim.locale];
    if (claim.accountState === "unavailable" ||
        (claim.intent === "link" && claim.accountState !== "unregistered")) {
      await api.send({ action: "reject", actor, requestId: claim.id }, z.boolean());
      await say(actor, m.accountUnavailable);
      return;
    }
    const nextIntent =
      claim.intent === "login" && claim.accountState === "unregistered"
        ? "register"
        : claim.intent === "register" && claim.accountState === "active"
          ? "login"
          : null;
    if (nextIntent) {
      await buttons(actor, nextIntent === "register" ? m.accountMissing : m.accountExists, [
        {
          label: nextIntent === "register" ? m.register : m.signIn,
          run: async () => {
            const changed = await api.send({
              action: "change-intent",
              actor,
              requestId: claim.id,
              intent: nextIntent,
              names: namesFrom(message),
            }, claimResult);
            if (changed) await routeClaim(message, changed, locale, deepLink);
            else await say(actor, m.unavailable);
          },
        },
        {
          label: m.reject,
          run: async () => {
            const rejected = await api.send(
              { action: "reject", actor, requestId: claim.id },
              z.boolean(),
            );
            await say(actor, rejected ? m.rejected : m.unavailable);
          },
        },
      ]);
      return;
    }
    if (!claim.needsContact) return choices(actor, claim);
    await askContact(actor, claim.locale, async (incoming) => {
      const contact = contactFrom(incoming);
      if (!contact) {
        await say(actor, messages[claim.locale].invalidContact);
        return claimRequest(message, deepLink, locale);
      }
      const saved = await api.send(
        { action: "contact", actor, requestId: claim.id, contact },
        z.boolean(),
      );
      await telegram.sendMessage(
        actor.chatId,
        messages[claim.locale].startAgain,
        {
          remove_keyboard: true,
        },
      );
      if (saved) await choices(actor, claim);
      else await say(actor, messages[claim.locale].unavailable);
    });
  }

  return async (update: TelegramUpdate): Promise<void> => {
    const clicked = privateCallback(update.callback_query);
    if (clicked) {
      await telegram.answerCallback(clicked.callback.id).catch(() => undefined);
      const { actor, message, callback } = clicked;
      const prompt = prompts.get(actor.userId);
      if (
        !prompt ||
        prompt.expiresAt <= Date.now() ||
        prompt.kind !== "buttons" ||
        prompt.messageId !== message.message_id
      )
        return;
      const choice = prompt.choices.get(callback.data ?? "");
      if (!choice) return;
      prompts.delete(actor.userId);
      await choice.run();
      return;
    }
    const incoming = privateMessage(update.message);
    if (!incoming) return;
    const { actor, user, message } = incoming;
    if (message.date * 1000 < Date.now() - ttl) return;
    const locale: Locale = user.language_code?.startsWith("ru") ? "ru" : "en";
    const text = message.text;
    const start = /^\/start(?: ([A-Za-z0-9_-]{43}))?$/.exec(text ?? "");
    if (start || text === "/register" || text === "/cancel") {
      prompts.delete(actor.userId);
      if (text === "/cancel") {
        const draft = await find(actor);
        if (draft?.channel === "bot") await cancel(actor, draft);
        else await say(actor, messages[locale].unavailable);
      } else if (text === "/register") await register(actor, locale);
      else if (start?.[1]) await claimRequest(incoming, start[1], locale);
      else await resume(actor, locale);
      return;
    }
    const prompt = prompts.get(actor.userId);
    if (!prompt || prompt.expiresAt <= Date.now()) return;
    if (
      prompt.kind === "contact" &&
      message.contact &&
      message.date >= prompt.since
    ) {
      prompts.delete(actor.userId);
      await prompt.run(incoming);
    } else if (
      prompt.kind === "text" &&
      text &&
      !text.startsWith("/") &&
      message.reply_to_message?.message_id === prompt.messageId
    ) {
      prompts.delete(actor.userId);
      await prompt.run(text);
    }
  };
}
