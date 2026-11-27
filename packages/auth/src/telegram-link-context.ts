import { AsyncLocalStorage } from "node:async_hooks";
import {
  APIError,
  addOAuthServerContext,
  createAuthMiddleware,
  getOAuthState,
} from "better-auth/api";
import type { Pool } from "pg";
import type { TelegramSessionIdentity } from "./telegram-registration.js";
import { readTelegramSettings } from "./telegram-settings.js";

// Only the MOVARO HTTP adapter supplies this context after reading a signed
// Better Auth cookie. No incoming header or body can supply these values.
export type TelegramLinkIdentity = TelegramSessionIdentity & {
  revision?: number;
};

export const telegramLinkContext =
  new AsyncLocalStorage<TelegramLinkIdentity | null>();

// Populated only by validateUserInfo after the OIDC assertion is verified.
export const telegramLoginContext = new AsyncLocalStorage<{
  providerEmail?: string;
}>();

export const prepareTelegramLink = createAuthMiddleware(async (ctx) => {
  if (ctx.path === "/unlink-account")
    throw new APIError("FORBIDDEN", { code: "AUTH_REQUEST_FAILED" });
  if (ctx.path !== "/link-social") return;
  const identity = telegramLinkContext.getStore();
  if (
    !identity ||
    identity.revision === undefined ||
    ctx.body?.provider !== "telegram"
  )
    throw new APIError("FORBIDDEN", { code: "AUTH_REQUEST_FAILED" });
  await addOAuthServerContext({
    movaroTelegramLinkSessionId: identity.sessionId,
    movaroTelegramLinkRevision: identity.revision,
  });
});

export async function validateTelegramLink(
  pool: Pool,
  userId: string | undefined,
): Promise<boolean> {
  const identity = telegramLinkContext.getStore();
  const state = await getOAuthState();
  if (
    !identity ||
    identity.userId !== userId ||
    !state ||
    state.link?.userId !== userId ||
    state.serverContext?.movaroTelegramLinkSessionId !== identity.sessionId
  )
    return false;
  const current = await readTelegramSettings(pool, identity);
  return Boolean(
    current?.credential &&
      current.fresh &&
      !current.linked &&
      current.revision === state.serverContext?.movaroTelegramLinkRevision,
  );
}

// The trigger consumes this proof at INSERT, under database row locks.
export async function telegramLinkProof(userId: string) {
  const identity = telegramLinkContext.getStore();
  const state = await getOAuthState();
  const revision = state?.serverContext?.movaroTelegramLinkRevision;
  if (
    !identity ||
    identity.userId !== userId ||
    !state ||
    state.link?.userId !== userId ||
    state.serverContext?.movaroTelegramLinkSessionId !== identity.sessionId ||
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 0
  )
    return null;
  return { linkSessionId: identity.sessionId, linkRevision: revision };
}

export async function findTelegramLoginAccount(
  pool: Pool,
  userId: string,
  providerEmail: string,
): Promise<string | null> {
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM "account"
     WHERE "userId" = $1 AND "providerId" = 'telegram'
       AND encode(sha256(convert_to("accountId", 'UTF8')), 'hex') || '@telegram.invalid' = $2`,
    [userId, providerEmail],
  );
  return result.rows[0]?.id ?? null;
}
