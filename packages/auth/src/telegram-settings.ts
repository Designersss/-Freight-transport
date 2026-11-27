import type { Pool } from "pg";
import { eligibleAccount } from "./active-account.js";
import type { TelegramSessionIdentity } from "./telegram-registration.js";

export const TELEGRAM_SETTINGS_FRESH_SECONDS = 10 * 60;

interface SettingsRow {
  linked: boolean;
  credential: boolean;
  fresh: boolean;
  revision: number;
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
  (s."telegramAccountId" IS NULL AND s."createdAt" > clock_timestamp() - $3 * interval '1 second') AS fresh,
  u."telegramLinkRevision" AS revision
  ${eligibleAccount}`;

function settingsValues(identity: TelegramSessionIdentity) {
  return [identity.userId, identity.sessionId, TELEGRAM_SETTINGS_FRESH_SECONDS];
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
