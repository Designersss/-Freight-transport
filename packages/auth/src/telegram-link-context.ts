import { AsyncLocalStorage } from "node:async_hooks";
import {
  addOAuthServerContext,
  APIError,
  createAuthMiddleware,
  getOAuthState,
} from "better-auth/api";
import type { Pool } from "pg";
import type { TelegramSessionIdentity } from "./telegram-registration.js";
import { readTelegramSettings } from "./telegram-settings.js";

// Only the MOVARO HTTP adapter supplies this context after reading a signed
// Better Auth cookie. No incoming header or body can supply these values.
export const telegramLinkContext =
  new AsyncLocalStorage<TelegramSessionIdentity | null>();

export const prepareTelegramLink = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/link-social") return;
  const identity = telegramLinkContext.getStore();
  if (!identity || ctx.body?.provider !== "telegram")
    throw new APIError("FORBIDDEN", { code: "AUTH_REQUEST_FAILED" });
  await addOAuthServerContext({
    movaroTelegramLinkSessionId: identity.sessionId,
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
    state?.link?.userId !== userId ||
    state.serverContext?.movaroTelegramLinkSessionId !== identity.sessionId
  )
    return false;
  const current = await readTelegramSettings(pool, identity);
  return Boolean(current?.credential && current.fresh && !current.linked);
}
