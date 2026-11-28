import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { telegramBotCapabilityHash } from "./telegram-bot-requests.js";
import type { TelegramSessionIdentity } from "./telegram-registration.js";

export type TelegramBotLinkResult = "linked" | "denied";

// Keep Bot API IDs in a distinct accountId namespace. Do not treat an
// old OIDC subject as a numeric Telegram identity. Activation must first
// verify that no existing OIDC account occupies this namespace.
export function telegramBotAccountId(userId: string): string {
  if (!/^[1-9][0-9]{0,15}$/.test(userId))
    throw new Error("Invalid Telegram user ID");
  return `bot:${userId}`;
}

function bindingConflict(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  if (!("constraint" in error)) return false;
  return (
    (error.code === "23505" &&
      (error.constraint === "account_providerId_accountId_uidx" ||
        error.constraint === "account_telegram_user_uidx")) ||
    (error.code === "23514" &&
      error.constraint === "account_telegram_link_guard")
  );
}

// Internal use only: identity must come from the verified public Better Auth
// cookie, not request payloads. The HTTP boundary still checks Origin and
// browser capability. No new session is created for account linking.
export async function finishTelegramBotLink(
  pool: Pool,
  browserCapability: unknown,
  requestId: string,
  identity: TelegramSessionIdentity,
): Promise<TelegramBotLinkResult> {
  const hash = telegramBotCapabilityHash(browserCapability);
  if (!hash) return "denied";
  const client = await pool.connect();
  let releaseWithError = true;
  try {
    await client.query("BEGIN");
    // Match the existing owner-first lock order used by credential rotation
    // and account deactivation. The binding trigger rechecks the live session.
    const owner = await client.query(
      'SELECT id FROM "user" WHERE id = $1 FOR UPDATE',
      [identity.userId],
    );
    if (!owner.rowCount) {
      await client.query("ROLLBACK");
      releaseWithError = false;
      return "denied";
    }
    const approved = await client.query<{
      telegram_user_id: string;
      link_revision: number;
    }>(
      `SELECT telegram_user_id, link_revision FROM telegram_bot_requests
       WHERE browser_hash = $1 AND id::text = $2
         AND intent = 'link' AND status = 'approved'
         AND expires_at > clock_timestamp()
         AND link_user_id = $3 AND link_session_id = $4
       FOR UPDATE`,
      [hash, requestId, identity.userId, identity.sessionId],
    );
    const request = approved.rows[0];
    if (!request) {
      await client.query("ROLLBACK");
      releaseWithError = false;
      return "denied";
    }
    const eligible = await client.query(
      `SELECT u.id FROM "user" u
       JOIN user_profiles p ON p.user_id = u.id
       JOIN "session" s ON s."userId" = u.id
       JOIN "account" c ON c."userId" = u.id AND c."providerId" = 'credential'
       WHERE u.id = $1 AND s.id = $2
         AND u."telegramLinkRevision" = $3
         AND u."emailVerified" AND u.email NOT LIKE '%.invalid'
         AND u.username IS NOT NULL
         AND p.status = 'ACTIVE' AND p.role <> 'PLATFORM_ADMIN'
         AND s."expiresAt" > clock_timestamp()
         AND s."createdAt" > clock_timestamp() - interval '10 minutes'
         AND NOT s."adminSession" AND s."telegramAccountId" IS NULL
         AND c.password IS NOT NULL AND c.password <> ''
         AND NOT EXISTS (
           SELECT 1 FROM "account" a
           WHERE a."userId" = u.id AND a."providerId" = 'telegram'
         )
       FOR UPDATE OF p, s, c`,
      [identity.userId, identity.sessionId, request.link_revision],
    );
    if (!eligible.rowCount) {
      await client.query("ROLLBACK");
      releaseWithError = false;
      return "denied";
    }
    await client.query(
      `INSERT INTO "account" (
         id, "userId", "providerId", "accountId", "linkSessionId", "linkRevision"
       ) VALUES ($1, $2, 'telegram', $3, $4, $5)`,
      [
        randomUUID(),
        identity.userId,
        telegramBotAccountId(request.telegram_user_id),
        identity.sessionId,
        request.link_revision,
      ],
    );
    const consumed = await client.query(
      `UPDATE telegram_bot_requests SET status = 'consumed',
         telegram_user_id = NULL, first_name = NULL, last_name = NULL,
         phone_number = NULL
       WHERE browser_hash = $1 AND id::text = $2
         AND status = 'approved' AND expires_at > clock_timestamp()`,
      [hash, requestId],
    );
    if (consumed.rowCount !== 1) {
      await client.query("ROLLBACK");
      releaseWithError = false;
      return "denied";
    }
    await client.query("COMMIT");
    releaseWithError = false;
    return "linked";
  } catch (error) {
    await client.query("ROLLBACK");
    releaseWithError = false;
    if (bindingConflict(error)) return "denied";
    throw error;
  } finally {
    client.release(releaseWithError);
  }
}
