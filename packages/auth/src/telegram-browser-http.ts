import type { Pool } from "pg";
import { z } from "zod";
import { AUTH_BASE_PATH, type EmailAuth } from "./auth.js";
import type { AuthConfig } from "./config.js";
import { telegramStartInput } from "./contracts.js";
import { reserveTelegramBrowserRequest } from "./mail-rate-limit.js";
import { finishTelegramBotLink } from "./telegram-bot-link.js";
import { TELEGRAM_BOT_BROWSER_COOKIE } from "./telegram-bot-login.js";
import {
  cancelTelegramBotRequest,
  confirmTelegramBotApproval,
  createTelegramBrowserCapability,
  readTelegramBotRequest,
  startTelegramBotRequest,
  telegramBotCapabilityHash,
} from "./telegram-bot-requests.js";
import {
  beginTelegramRegistrationDraft,
  cancelTelegramRegistrationDraft,
  completeTelegramRegistrationDraft,
  findTelegramRegistrationDraft,
  readTelegramRegistrationCompletion,
  readTelegramRegistrationDraft,
  resumeTelegramRegistrationInBrowser,
  telegramDraftMutationInput,
  updateTelegramRegistrationDraft,
} from "./telegram-registration-draft.js";
import { readTelegramSettings } from "./telegram-settings.js";
import { suggestUsername } from "./username.js";
import { readAuthSession } from "./verified-session.js";

const requestId = z.uuid();
const draftId = z.uuid();
const revision = z.number().int().min(0).max(2_147_483_646);
const capability = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const telegramBrowserCommandInput = z.discriminatedUnion("action", [
  telegramStartInput.extend({ action: z.literal("start") }),
  z.strictObject({ action: z.literal("status"), requestId }),
  z.strictObject({ action: z.literal("cancel"), requestId }),
  z.strictObject({ action: z.literal("confirm"), requestId, proof: capability }),
  z.strictObject({ action: z.literal("finish"), requestId }),
  z.strictObject({ action: z.literal("draft-find") }),
  z.strictObject({ action: z.literal("draft-state"), draftId }),
  z.strictObject({
    action: z.literal("draft-update"),
    draftId,
    mutation: telegramDraftMutationInput,
  }),
  z.strictObject({ action: z.literal("draft-suggest-username"), draftId }),
  z.strictObject({ action: z.literal("draft-complete"), draftId, revision }),
  z.strictObject({ action: z.literal("draft-cancel"), draftId, revision }),
  z.strictObject({ action: z.literal("draft-completion"), draftId }),
]);

export type TelegramBrowserCommand = z.infer<typeof telegramBrowserCommandInput>;

// Only a single, well-formed host cookie may serve as a browser proof.
// No query parameter, Authorization header or JSON body can substitute.
export function readTelegramBrowserCookie(headers: Headers): string | null {
  const values = (headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${TELEGRAM_BOT_BROWSER_COOKIE}=`));
  if (values.length !== 1) return null;
  const value = values[0]?.slice(TELEGRAM_BOT_BROWSER_COOKIE.length + 1);
  const parsed = capability.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function setBrowserCookie(headers: Headers, value: string): void {
  headers.append(
    "set-cookie",
    `${TELEGRAM_BOT_BROWSER_COOKIE}=${value}; Path=/; Max-Age=7200; Secure; HttpOnly; SameSite=Lax`,
  );
}

async function approvedBrowserGrant(
  pool: Pool,
  browser: string,
  id: string,
) {
  const hash = telegramBotCapabilityHash(browser);
  if (!hash) return null;
  const result = await pool.query<{
    intent: "login" | "register" | "link";
    telegram_user_id: string;
  }>(
    `SELECT intent, telegram_user_id FROM telegram_bot_requests
     WHERE browser_hash = $1 AND id::text = $2 AND status = 'approved'
       AND expires_at > clock_timestamp()`,
    [hash, id],
  );
  return result.rows[0] ?? null;
}

export async function handleTelegramBrowser(
  request: Request,
  config: AuthConfig,
  auth: EmailAuth,
  pool: Pool,
): Promise<Response> {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers });
  const fail = (status: number, code = "AUTH_REQUEST_FAILED") =>
    json({ code }, status);
  const bot = config.AUTH_TELEGRAM_BOT_USERNAME;
  if (!bot) return fail(404, "NOT_FOUND");
  if (request.method !== "POST") return fail(405, "METHOD_NOT_ALLOWED");
  if (request.headers.get("origin") !== config.AUTH_WEB_ORIGIN)
    return fail(403, "INVALID_ORIGIN");
  if (
    new URL(request.url).search ||
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return fail(400, "INVALID_REQUEST");
  const parsed = telegramBrowserCommandInput.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return fail(400, "INVALID_REQUEST");
  const command = parsed.data;

  try {
    const budget = await reserveTelegramBrowserRequest(
      pool,
      config.AUTH_SECRET,
      command.action === "start"
        ? "start"
        : ["status", "draft-find", "draft-state", "draft-completion"].includes(command.action)
          ? "poll"
          : "write",
      request.headers.get("x-movaro-client-ip"),
    );
    if (budget !== null) {
      headers.set("retry-after", String(budget));
      return fail(429, "RATE_LIMITED");
    }
    const browser = readTelegramBrowserCookie(request.headers);
    if (command.action === "start") {
      const current = await readAuthSession(request, config, auth, headers);
      if (current instanceof Response && current.status !== 401) return current;
      const value = browser ?? createTelegramBrowserCapability();
      const { intent, locale } = command;
      if (intent === "link") {
        if (current instanceof Response) return fail(401, "AUTH_REQUIRED");
        const identity = {
          userId: current.user.id,
          sessionId: current.session.id,
        };
        const settings = await readTelegramSettings(pool, identity);
        if (!settings?.credential || settings.linked) return fail(403);
        if (!settings.fresh) return fail(403, "SESSION_NOT_FRESH");
        const started = await startTelegramBotRequest(pool, value, {
          intent,
          locale,
          link: { ...identity, revision: settings.revision },
        });
        setBrowserCookie(headers, value);
        return json({
          requestId: started.id,
          url: `https://t.me/${bot}?start=${started.deepLink}`,
          displayCode: started.displayCode,
          expiresAt: started.expiresAt,
        });
      }
      if (!(current instanceof Response)) return fail(409);
      const started = await startTelegramBotRequest(pool, value, {
        intent,
        locale,
      });
      setBrowserCookie(headers, value);
      return json({
        requestId: started.id,
        url: `https://t.me/${bot}?start=${started.deepLink}`,
        displayCode: started.displayCode,
        expiresAt: started.expiresAt,
      });
    }
    if (!browser) return fail(403);
    const access = { channel: "web" as const, browserCapability: browser };
    if (command.action.startsWith("draft-")) {
      const current = await readAuthSession(request, config, auth, headers);
      if (!(current instanceof Response)) return fail(409);
      if (current.status !== 401) return current;
    }
    switch (command.action) {
      case "status":
        return json({
          status: await readTelegramBotRequest(pool, browser, command.requestId),
        });
      case "cancel":
        return json({
          success: await cancelTelegramBotRequest(pool, browser, command.requestId),
        });
      case "confirm":
        return (await confirmTelegramBotApproval(
          pool,
          browser,
          command.requestId,
          command.proof,
        ))
          ? json({ success: true })
          : fail(403);
      case "finish": {
        const grant = await approvedBrowserGrant(pool, browser, command.requestId);
        if (!grant) return fail(403);
        if (grant.intent === "login") {
          const forwarded = new Headers(request.headers);
          forwarded.delete("content-length");
          const response = await auth.handler(
            new Request(
              new URL(`${AUTH_BASE_PATH}/telegram-bot/finish-login`, config.AUTH_BASE_URL),
              {
                method: "POST",
                headers: forwarded,
                body: JSON.stringify({ requestId: command.requestId }),
              },
            ),
          );
          for (const cookie of response.headers.getSetCookie())
            headers.append("set-cookie", cookie);
          if (!response.ok) {
            const retry = response.headers.get("retry-after");
            if (retry) headers.set("retry-after", retry);
            return fail(response.status === 429 ? 429 : 403);
          }
          return json({ outcome: "logged-in" });
        }
        const current = await readAuthSession(request, config, auth, headers);
        if (grant.intent === "link") {
          if (current instanceof Response) return current;
          const linked = await finishTelegramBotLink(
            pool,
            browser,
            command.requestId,
            { userId: current.user.id, sessionId: current.session.id },
          );
          return linked === "linked" ? json({ outcome: "linked" }) : fail(403);
        }
        if (!(current instanceof Response)) return fail(409);
        if (current.status !== 401) return current;
        // The Telegram actor comes exclusively from the approved, browser-
        // bound grant. The caller cannot select a Telegram identity.
        const actor = {
          chatType: "private" as const,
          chatId: grant.telegram_user_id,
          userId: grant.telegram_user_id,
        };
        const existing = await findTelegramRegistrationDraft(pool, {
          channel: "bot",
          actor,
        });
        const id = existing
          ? await resumeTelegramRegistrationInBrowser(
              pool,
              existing.id,
              command.requestId,
              actor,
              existing.revision,
            )
          : await beginTelegramRegistrationDraft(
              pool,
              command.requestId,
              actor,
              "web",
            );
        return id ? json({ outcome: "registration", draftId: id }) : fail(409);
      }
      case "draft-find":
        return json({ draft: await findTelegramRegistrationDraft(pool, access) });
      case "draft-state": {
        const draft = await readTelegramRegistrationDraft(pool, command.draftId, access);
        const completed = !draft && await readTelegramRegistrationCompletion(pool, command.draftId, browser);
        return json({ draft, completed });
      }
      case "draft-update":
        return json({
          draft: await updateTelegramRegistrationDraft(
            pool,
            command.draftId,
            access,
            command.mutation,
          ),
        });
      case "draft-suggest-username": {
        const draft = await findTelegramRegistrationDraft(pool, access);
        if (
          draft?.id !== command.draftId ||
          draft.channel !== "web" ||
          !draft.firstName ||
          !draft.lastName
        )
          return fail(403);
        return json({
          username: await suggestUsername(pool, draft.firstName, draft.lastName),
        });
      }
      case "draft-complete":
        return json({
          outcome: await completeTelegramRegistrationDraft(
            pool,
            command.draftId,
            access,
            command.revision,
          ),
        });
      case "draft-cancel":
        return json({
          success: await cancelTelegramRegistrationDraft(
            pool,
            command.draftId,
            access,
            command.revision,
          ),
        });
      case "draft-completion":
        return json({
          completed: await readTelegramRegistrationCompletion(
            pool,
            command.draftId,
            browser,
          ),
        });
    }
  } catch {
    return fail(503);
  }
}
