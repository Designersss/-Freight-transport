import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type TelegramBotIntent = "login" | "register" | "link";
type Locale = "ru" | "en";
type StartInput =
  | { intent: "login" | "register"; locale: Locale }
  | {
      intent: "link";
      locale: Locale;
      // Supplied only by the API after verifying a fresh credential session.
      link: { userId: string; sessionId: string; revision: number };
    };

type RequestStatus =
  | "pending"
  | "claimed"
  | "approved"
  | "rejected"
  | "cancelled"
  | "consumed"
  | "expired";

function capabilityHash(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value))
    return null;
  return createHash("sha256").update(value).digest("hex");
}

export function createTelegramBrowserCapability(): string {
  return randomBytes(32).toString("base64url");
}

// Internal operation only. The HTTP boundary must validate Origin, rate limits
// and the link session. One row per browser makes replacement atomic.
export async function startTelegramBotRequest(
  pool: Pool,
  browserCapability: string,
  input: StartInput,
) {
  const browserHash = capabilityHash(browserCapability);
  if (!browserHash) throw new Error("Invalid browser capability");
  const deepLink = randomBytes(32).toString("base64url");
  const deepLinkHash = createHash("sha256").update(deepLink).digest("hex");
  const id = randomUUID();
  const displayCode = randomInt(1_000_000).toString().padStart(6, "0");
  const link = input.intent === "link" ? input.link : null;
  const result = await pool.query<{ expires_at: Date }>(
    `INSERT INTO telegram_bot_requests (
       id, browser_hash, deep_link_hash, intent, locale, display_code,
       created_at, expires_at, link_user_id, link_session_id, link_revision
     )
     SELECT $1, $2, $3, $4, $5, $6, issued_at, issued_at + interval '5 minutes',
       $7, $8, $9 FROM (SELECT clock_timestamp() AS issued_at) AS issued
     ON CONFLICT (browser_hash) DO UPDATE SET
       id = EXCLUDED.id, deep_link_hash = EXCLUDED.deep_link_hash,
       intent = EXCLUDED.intent, locale = EXCLUDED.locale,
       display_code = EXCLUDED.display_code, status = 'pending',
       created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at,
       link_user_id = EXCLUDED.link_user_id,
       link_session_id = EXCLUDED.link_session_id,
       link_revision = EXCLUDED.link_revision, telegram_user_id = NULL,
       first_name = NULL, last_name = NULL, phone_number = NULL
     RETURNING expires_at`,
    [
      id,
      browserHash,
      deepLinkHash,
      input.intent,
      input.locale,
      displayCode,
      link?.userId ?? null,
      link?.sessionId ?? null,
      link?.revision ?? null,
    ],
  );
  const expiresAt = result.rows[0]?.expires_at;
  if (!expiresAt) throw new Error("Telegram request was not created");
  return { id, deepLink, displayCode, expiresAt };
}

export async function readTelegramBotRequest(
  pool: Pool,
  browserCapability: unknown,
  requestId: string,
): Promise<RequestStatus | null> {
  const browserHash = capabilityHash(browserCapability);
  if (!browserHash) return null;
  const result = await pool.query<{ status: RequestStatus }>(
    `SELECT CASE
       WHEN status IN ('pending', 'claimed', 'approved')
         AND expires_at <= clock_timestamp() THEN 'expired'
       ELSE status END AS status
     FROM telegram_bot_requests WHERE browser_hash = $1 AND id::text = $2`,
    [browserHash, requestId],
  );
  return result.rows[0]?.status ?? null;
}

export async function cancelTelegramBotRequest(
  pool: Pool,
  browserCapability: unknown,
  requestId: string,
): Promise<boolean> {
  const browserHash = capabilityHash(browserCapability);
  if (!browserHash) return false;
  const result = await pool.query(
    `UPDATE telegram_bot_requests SET status = 'cancelled',
       telegram_user_id = NULL, first_name = NULL, last_name = NULL,
       phone_number = NULL
     WHERE browser_hash = $1 AND id::text = $2
       AND status IN ('pending', 'claimed', 'approved')
       AND expires_at > clock_timestamp()`,
    [browserHash, requestId],
  );
  return result.rowCount === 1;
}
