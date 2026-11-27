import type { Pool } from "pg";
import { telegramAccountCondition } from "./active-account.js";
import { registrationInput } from "./contracts.js";

// Only an account established by the verified Telegram callback qualifies.
// The internal email is an identity namespace, never evidence of email ownership.
const telegramIdentity = `FROM "user" u
  JOIN "account" a ON a."userId" = u.id AND a."providerId" = 'telegram'
  JOIN "session" s ON s."userId" = u.id`;

const telegramConditions = `WHERE u.id = $1 AND s.id = $2
    AND s."expiresAt" > clock_timestamp()
    AND ${telegramAccountCondition}`;

const telegramSession = `${telegramIdentity} ${telegramConditions}`;

export interface TelegramSessionIdentity {
  userId: string;
  sessionId: string;
}

export type TelegramAccess = "onboarding" | "active" | "denied";

const accessColumns = `CASE
  WHEN p.user_id IS NULL AND u.username IS NULL THEN 'onboarding'
  WHEN p.status = 'ACTIVE' AND p.role <> 'PLATFORM_ADMIN'
    AND u.username IS NOT NULL THEN 'active'
  ELSE 'denied' END AS access`;

const accessQuery = `SELECT ${accessColumns}
  ${telegramIdentity}
  LEFT JOIN user_profiles p ON p.user_id = u.id
  ${telegramConditions}`;

// Call only after validating the signed Better Auth session cookie.
// The session ID is internal and must not be accepted from a client payload.
export async function readTelegramAccess(
  pool: Pool,
  identity: TelegramSessionIdentity,
): Promise<TelegramAccess> {
  const result = await pool.query<{ access: TelegramAccess }>(accessQuery, [
    identity.userId,
    identity.sessionId,
  ]);
  return result.rows[0]?.access ?? "denied";
}

export type TelegramRegistrationResult =
  | "created"
  | "already-complete"
  | "username-taken"
  | "invalid"
  | "denied";

// This is an internal registration operation, not a public HTTP handler.
export async function completeTelegramRegistration(
  pool: Pool,
  identity: TelegramSessionIdentity,
  payload: unknown,
): Promise<TelegramRegistrationResult> {
  const parsed = registrationInput.safeParse(payload);
  if (!parsed.success) return "invalid";
  const { profile, username } = parsed.data;
  const client = await pool.connect();
  const ids = [identity.userId, identity.sessionId];
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT u.id ${telegramSession} FOR UPDATE OF u, a, s`,
      ids,
    );
    const access = locked.rowCount
      ? (await client.query<{ access: TelegramAccess }>(accessQuery, ids))
          .rows[0]?.access
      : "denied";
    if (access !== "onboarding") {
      await client.query("ROLLBACK");
      return access === "active" ? "already-complete" : "denied";
    }
    await client.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date, company_name)
       VALUES ($1, $2, $3, $4, $5::date, $6)`,
      [
        identity.userId,
        profile.firstName,
        profile.lastName,
        profile.role,
        profile.birthDate,
        profile.companyName ?? null,
      ],
    );
    await client.query(
      'UPDATE "user" SET username = $2, name = $3, "updatedAt" = clock_timestamp() WHERE id = $1',
      [identity.userId, username, `${profile.firstName} ${profile.lastName}`],
    );
    await client.query("COMMIT");
    return "created";
  } catch (error) {
    await client.query("ROLLBACK");
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "23505" &&
      "constraint" in error &&
      error.constraint === "user_username_uidx"
    )
      return "username-taken";
    throw error;
  } finally {
    client.release();
  }
}
