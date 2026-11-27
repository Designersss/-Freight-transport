import type { Pool } from "pg";
import { eligibleAccount } from "./active-account.js";
import type { TelegramSessionIdentity } from "./telegram-registration.js";

export const TELEGRAM_SETTINGS_FRESH_SECONDS = 10 * 60;

interface SettingsRow {
  linked: boolean;
  credential: boolean;
  fresh: boolean;
}

const settingsQuery = `SELECT
  EXISTS (
    SELECT 1 FROM "account" a
    WHERE a."userId" = u.id AND a."providerId" = 'telegram'
  ) AS linked,
  (u."emailVerified" AND u.email NOT LIKE '%.invalid' AND EXISTS (
    SELECT 1 FROM "account" a
    WHERE a."userId" = u.id AND a."providerId" = 'credential'
      AND a.password IS NOT NULL AND a.password <> ''
  )) AS credential,
  s."createdAt" > clock_timestamp() - $3 * interval '1 second' AS fresh
  ${eligibleAccount}`;

function settingsValues(identity: TelegramSessionIdentity) {
  return [
    identity.userId,
    identity.sessionId,
    TELEGRAM_SETTINGS_FRESH_SECONDS,
  ];
}

export async function readTelegramSettings(
  pool: Pool,
  identity: TelegramSessionIdentity,
) {
  const result = await pool.query<SettingsRow>(
    settingsQuery,
    settingsValues(identity),
  );
  return result.rows[0] ?? null;
}

export type UnlinkTelegramResult =
  | "unlinked"
  | "denied"
  | "last-method"
  | "session-not-fresh";

// The current session remains valid. Other sessions are removed because the
// session schema does not record which authentication method issued them.
export async function unlinkTelegram(
  pool: Pool,
  identity: TelegramSessionIdentity,
): Promise<UnlinkTelegramResult> {
  const client = await pool.connect();
  const ids = [identity.userId, identity.sessionId];
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT u.id ${eligibleAccount} FOR UPDATE OF u, p, s`,
      ids,
    );
    if (!locked.rowCount) {
      await client.query("ROLLBACK");
      return "denied";
    }
    await client.query(
      `SELECT id FROM "account"
       WHERE "userId" = $1 AND "providerId" IN ('telegram', 'credential')
       ORDER BY id FOR UPDATE`,
      [identity.userId],
    );
    const result = await client.query<SettingsRow>(
      settingsQuery,
      settingsValues(identity),
    );
    const settings = result.rows[0];
    if (!settings || !settings.credential || !settings.fresh) {
      await client.query("ROLLBACK");
      return !settings
        ? "denied"
        : !settings.credential
          ? "last-method"
          : "session-not-fresh";
    }
    const removed = await client.query(
      `DELETE FROM "account" WHERE "userId" = $1 AND "providerId" = 'telegram'`,
      [identity.userId],
    );
    if (removed.rowCount) {
      await client.query(
        'DELETE FROM "session" WHERE "userId" = $1 AND id <> $2',
        ids,
      );
    }
    await client.query("COMMIT");
    return "unlinked";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
