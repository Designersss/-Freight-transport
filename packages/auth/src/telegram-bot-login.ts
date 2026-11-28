import { AsyncLocalStorage } from "node:async_hooks";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { Pool } from "pg";
import { z } from "zod";
import { telegramBotCapabilityHash } from "./telegram-bot-requests.js";

interface BotLoginProof {
  userId: string;
  telegramAccountId: string;
  telegramBotRequestId: string;
  telegramBotBrowserHash: string;
}

export const telegramBotLoginContext = new AsyncLocalStorage<BotLoginProof>();

export const TELEGRAM_BOT_BROWSER_COOKIE = "__Host-movaro-telegram-browser";

async function readLoginProof(
  pool: Pool,
  browserCapability: unknown,
  requestId: string,
): Promise<BotLoginProof | null> {
  const hash = telegramBotCapabilityHash(browserCapability);
  if (!hash) return null;
  const result = await pool.query<{ user_id: string; account_id: string }>(
    `SELECT a."userId" AS user_id, a.id AS account_id
     FROM telegram_bot_requests r
     JOIN "account" a ON a."providerId" = 'telegram'
       AND a."accountId" = 'bot:' || r.telegram_user_id
     JOIN "user" u ON u.id = a."userId"
     JOIN user_profiles p ON p.user_id = u.id
     WHERE r.browser_hash = $1 AND r.id::text = $2
       AND r.intent = 'login' AND r.status = 'approved'
       AND r.expires_at > clock_timestamp()
       AND p.status = 'ACTIVE' AND p.role <> 'PLATFORM_ADMIN'
       AND u.username IS NOT NULL`,
    [hash, requestId],
  );
  const row = result.rows[0];
  return row
    ? {
        userId: row.user_id,
        telegramAccountId: row.account_id,
        telegramBotRequestId: requestId,
        telegramBotBrowserHash: hash,
      }
    : null;
}

function isRejectedProof(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "23514" &&
    "constraint" in error &&
    (error.constraint === "session_telegram_bot_guard" ||
      error.constraint === "session_active_account_guard")
  );
}

// Not mounted by createEmailAuth yet. The future HTTP adapter must allow
// only this explicit path, enforce limits and issue the host-only cookie.
export function createTelegramBotLoginPlugin(
  pool: Pool,
  webOrigin: string,
): BetterAuthPlugin {
  return {
    id: "movaro-telegram-bot-login",
    endpoints: {
      finishTelegramBotLogin: createAuthEndpoint(
        "/telegram-bot/finish-login",
        { method: "POST", body: z.object({ requestId: z.uuid() }) },
        async (ctx) => {
          if (ctx.headers?.get("origin") !== webOrigin)
            throw new APIError("FORBIDDEN", { code: "AUTH_REQUEST_FAILED" });
          const existing = await getSessionFromCtx(ctx, {
            disableCookieCache: true,
            disableRefresh: true,
          });
          if (existing)
            throw new APIError("FORBIDDEN", { code: "AUTH_REQUEST_FAILED" });
          const proof = await readLoginProof(
            pool,
            ctx.getCookie(TELEGRAM_BOT_BROWSER_COOKIE),
            ctx.body.requestId,
          );
          if (!proof)
            throw new APIError("FORBIDDEN", { code: "AUTH_REQUEST_FAILED" });
          const adapter = ctx.context.internalAdapter;
          const user = await adapter.findUserById(proof.userId);
          if (!user)
            throw new APIError("FORBIDDEN", { code: "AUTH_REQUEST_FAILED" });
          const session = await telegramBotLoginContext
            .run(proof, () => adapter.createSession(user.id))
            .catch((error: unknown) => {
              if (isRejectedProof(error))
                throw new APIError("FORBIDDEN", {
                  code: "AUTH_REQUEST_FAILED",
                });
              throw error;
            });
          if (!session)
            throw new APIError("FORBIDDEN", { code: "AUTH_REQUEST_FAILED" });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ success: true });
        },
      ),
    },
  };
}
