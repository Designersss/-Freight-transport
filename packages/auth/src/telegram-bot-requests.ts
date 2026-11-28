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

// The authenticated bot adapter derives these fields from Telegram updates,
// never from callback payloads or browser input.
export interface TelegramBotActor {
  chatType: string;
  chatId: string;
  userId: string;
}

function privateActor(actor: TelegramBotActor): boolean {
  return (
    actor.chatType === "private" &&
    /^[1-9][0-9]{0,15}$/.test(actor.userId) &&
    actor.chatId === actor.userId
  );
}

function telegramName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 128 ? name : null;
}

function telegramPhone(value: unknown): string | null {
  if (typeof value !== "string" || !/^[+]?[1-9][0-9]{1,14}$/.test(value))
    return null;
  return value.startsWith("+") ? value : `+${value}`;
}

interface ClaimedRequest {
  id: string;
  intent: TelegramBotIntent;
  locale: Locale;
  display_code: string;
  expires_at: Date;
  needs_contact: boolean;
}

// Reopening the link in the same private chat is safe. Another Telegram
// identity cannot replace the original claimant or overwrite its profile.
export async function claimTelegramBotRequest(
  pool: Pool,
  deepLink: unknown,
  actor: TelegramBotActor,
  names: { firstName?: unknown; lastName?: unknown },
) {
  const hash = capabilityHash(deepLink);
  if (!hash || !privateActor(actor)) return null;
  const result = await pool.query<ClaimedRequest>(
    `UPDATE telegram_bot_requests SET
       first_name = CASE WHEN status = 'pending' AND intent = 'register'
         THEN $3 ELSE first_name END,
       last_name = CASE WHEN status = 'pending' AND intent = 'register'
         THEN $4 ELSE last_name END,
       telegram_user_id = $2, status = 'claimed'
     WHERE deep_link_hash = $1 AND expires_at > clock_timestamp()
       AND (status = 'pending'
         OR (status = 'claimed' AND telegram_user_id = $2))
     RETURNING id, intent, locale, display_code, expires_at,
       (intent = 'register' AND phone_number IS NULL) AS needs_contact`,
    [
      hash,
      actor.userId,
      telegramName(names.firstName),
      telegramName(names.lastName),
    ],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        intent: row.intent,
        locale: row.locale,
        displayCode: row.display_code,
        expiresAt: row.expires_at,
        needsContact: row.needs_contact,
      }
    : null;
}

export interface TelegramBotContact {
  userId?: string;
  phoneNumber: unknown;
  forwarded: boolean;
}

// Only the bot adapter can associate a contact with a live registration
// prompt. Reject forwarded, foreign, missing or malformed contacts here too.
export async function saveTelegramBotContact(
  pool: Pool,
  requestId: string,
  actor: TelegramBotActor,
  contact: TelegramBotContact,
): Promise<boolean> {
  const phone = telegramPhone(contact.phoneNumber);
  if (
    !privateActor(actor) ||
    contact.forwarded !== false ||
    contact.userId !== actor.userId ||
    !phone
  )
    return false;
  const result = await pool.query(
    `UPDATE telegram_bot_requests SET phone_number = $3
     WHERE id::text = $1 AND telegram_user_id = $2
       AND status = 'claimed' AND intent = 'register'
       AND expires_at > clock_timestamp()
       AND (phone_number IS NULL OR phone_number = $3)`,
    [requestId, actor.userId, phone],
  );
  return result.rowCount === 1;
}

// A decision is not session issuance. The browser still has to finish with
// its independent capability and the server must revalidate account access.
export async function decideTelegramBotRequest(
  pool: Pool,
  requestId: string,
  actor: TelegramBotActor,
  decision: "approve" | "reject",
): Promise<boolean> {
  if (!privateActor(actor) || (decision !== "approve" && decision !== "reject"))
    return false;
  const result = await pool.query(
    `UPDATE telegram_bot_requests SET
       status = CASE WHEN $3 = 'approve' THEN 'approved' ELSE 'rejected' END,
       telegram_user_id = CASE WHEN $3 = 'approve' THEN telegram_user_id ELSE NULL END,
       first_name = CASE WHEN $3 = 'approve' THEN first_name ELSE NULL END,
       last_name = CASE WHEN $3 = 'approve' THEN last_name ELSE NULL END,
       phone_number = CASE WHEN $3 = 'approve' THEN phone_number ELSE NULL END
     WHERE id::text = $1 AND telegram_user_id = $2 AND status = 'claimed'
       AND expires_at > clock_timestamp()
       AND ($3 = 'reject' OR intent <> 'register' OR phone_number IS NOT NULL)`,
    [requestId, actor.userId, decision],
  );
  return result.rowCount === 1;
}

// Bounded, concurrent-safe cleanup. A replaced or locked request cannot be
// deleted accidentally. The worker must schedule this before public activation.
export async function deleteExpiredTelegramBotRequests(
  pool: Pool,
): Promise<number> {
  const result = await pool.query(
    `WITH expired AS (
       SELECT id FROM telegram_bot_requests
       WHERE expires_at <= clock_timestamp()
       ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED
     )
     DELETE FROM telegram_bot_requests r USING expired e
     WHERE r.id = e.id AND r.expires_at <= clock_timestamp()`,
  );
  return result.rowCount ?? 0;
}
