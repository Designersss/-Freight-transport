import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { eligibleAccount } from "./active-account.js";
import { emailChangeInput, emailChangeTokenInput } from "./contracts.js";
import type { TelegramSessionIdentity } from "./telegram-registration.js";

export const EMAIL_CHANGE_TTL_SECONDS = 15 * 60;

type Locale = "ru" | "en";
type Stage = "old" | "new";
export type EmailChangeDelivery = {
  kind: "deliver";
  stage: Stage;
  email: string;
  locale: Locale;
  token: string;
};
type Failure = { kind: "denied" | "invalid" | "conflict" };
type Result = EmailChangeDelivery | Failure | { kind: "completed" };

interface Pending {
  user_id: string;
  session_id: string;
  old_email: string;
  new_email: string;
  stage: Stage;
  locale: Locale;
  token_hash: string;
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function issueToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: digest(token) };
}

async function transaction(
  pool: Pool,
  work: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && "code" in error && error.code === "23505")
      return { kind: "conflict" };
    throw error;
  } finally {
    client.release();
  }
}

async function lockOwner(
  client: PoolClient,
  identity: TelegramSessionIdentity,
  fresh: boolean,
) {
  // Lock the owner before the profile/session to serialize starts and confirms.
  await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
    identity.userId,
  ]);
  const result = await client.query<{ email: string }>(
    `SELECT u.email ${eligibleAccount}
      AND u."emailVerified" AND u.email NOT LIKE '%.invalid'
      AND s."telegramAccountId" IS NULL
      AND (NOT $3::boolean OR s."createdAt" > clock_timestamp() - interval '10 minutes')
      AND EXISTS (
        SELECT 1 FROM "account" a WHERE a."userId" = u.id
          AND a."providerId" = 'credential' AND a.password IS NOT NULL AND a.password <> ''
      )
      FOR UPDATE OF u, p, s`,
    [identity.userId, identity.sessionId, fresh],
  );
  return result.rows[0]?.email ?? null;
}

// Internal use only: the caller must derive identity from a verified cookie.
// Returned tokens are mail-delivery material, never a public response.
export async function beginEmailChange(
  pool: Pool,
  identity: TelegramSessionIdentity,
  input: unknown,
): Promise<Result> {
  const parsed = emailChangeInput.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  const { newEmail, locale } = parsed.data;
  return transaction(pool, async (client) => {
    const oldEmail = await lockOwner(client, identity, true);
    if (!oldEmail) return { kind: "denied" };
    if (oldEmail === newEmail) return { kind: "invalid" };
    // Do not disclose whether the destination already belongs to a user.
    // The unique constraint is checked only after both inboxes are proven.

    const { token, hash } = issueToken();
    await client.query(
      `INSERT INTO pending_email_change
         (user_id, session_id, old_email, new_email, token_hash, stage, locale, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'old', $6, clock_timestamp() + $7 * interval '1 second')
       ON CONFLICT (user_id) DO UPDATE SET
         session_id = EXCLUDED.session_id, old_email = EXCLUDED.old_email,
         new_email = EXCLUDED.new_email, token_hash = EXCLUDED.token_hash,
         stage = EXCLUDED.stage, locale = EXCLUDED.locale, expires_at = EXCLUDED.expires_at`,
      [
        identity.userId,
        identity.sessionId,
        oldEmail,
        newEmail,
        hash,
        locale,
        EMAIL_CHANGE_TTL_SECONDS,
      ],
    );
    return { kind: "deliver", stage: "old", email: oldEmail, locale, token };
  });
}

// The link may be opened in a different browser. Its original initiating
// email session must still be live; confirming never creates a session.
export async function confirmEmailChange(
  pool: Pool,
  input: unknown,
): Promise<Result> {
  const parsed = emailChangeTokenInput.safeParse(input);
  if (!parsed.success) return { kind: "invalid" };
  const hash = digest(parsed.data.token);
  return transaction(pool, async (client) => {
    const candidate = await client.query<Pending>(
      "SELECT * FROM pending_email_change WHERE token_hash = $1",
      [hash],
    );
    const first = candidate.rows[0];
    if (!first) return { kind: "invalid" };
    const identity = { userId: first.user_id, sessionId: first.session_id };
    const currentEmail = await lockOwner(client, identity, false);
    if (!currentEmail) return { kind: "denied" };
    const result = await client.query<Pending>(
      `SELECT * FROM pending_email_change
       WHERE user_id = $1 AND token_hash = $2 AND expires_at > clock_timestamp()
       FOR UPDATE`,
      [identity.userId, hash],
    );
    const pending = result.rows[0];
    if (!pending || pending.old_email !== currentEmail)
      return { kind: "invalid" };

    if (pending.stage === "old") {
      const { token, hash: nextHash } = issueToken();
      await client.query(
        `UPDATE pending_email_change
         SET token_hash = $2, stage = 'new', expires_at = clock_timestamp() + $3 * interval '1 second'
         WHERE user_id = $1`,
        [identity.userId, nextHash, EMAIL_CHANGE_TTL_SECONDS],
      );
      return {
        kind: "deliver",
        stage: "new",
        email: pending.new_email,
        locale: pending.locale,
        token,
      };
    }

    // The unique email constraint arbitrates concurrent claims by other users.
    await client.query(
      `UPDATE "user" SET email = $2, "emailVerified" = true,
         "credentialRevision" = "credentialRevision" + 1,
         "updatedAt" = clock_timestamp() WHERE id = $1`,
      [identity.userId, pending.new_email],
    );
    // Invalidate reset links issued to the old inbox and all existing sessions.
    await client.query(
      `DELETE FROM "verification"
       WHERE value = $1 AND identifier LIKE 'reset-password:%'`,
      [identity.userId],
    );
    await client.query('DELETE FROM "session" WHERE "userId" = $1', [
      identity.userId,
    ]);
    // The pending record is removed by the session FK cascade.
    return { kind: "completed" };
  });
}

// A delivery failure invalidates only its own outstanding token, never a
// concurrently superseding request. No retry can reuse a consumed link.
export async function discardEmailChangeDelivery(pool: Pool, token: string) {
  await pool.query("DELETE FROM pending_email_change WHERE token_hash = $1", [
    digest(token),
  ]);
}
