import type { Pool } from "pg";
import { eligibleAccount } from "./active-account.js";

type Result = "deactivated" | "denied" | "session-not-fresh";

export async function deactivateAccount(
  pool: Pool,
  identity: { userId: string; sessionId: string },
  allowTelegram: boolean,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Match the owner-first lock order used by email change and link creation.
    await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
      identity.userId,
    ]);
    const result = await client.query<{ fresh: boolean }>(
      `SELECT s."createdAt" > clock_timestamp() - interval '10 minutes' AS fresh
       ${eligibleAccount}
       AND u.username IS NOT NULL AND NOT s."adminSession"
       AND ($3::boolean OR u."emailVerified")
       FOR UPDATE OF p, s`,
      [identity.userId, identity.sessionId, allowTelegram],
    );
    const owner = result.rows[0];
    if (!owner?.fresh) {
      await client.query("ROLLBACK");
      return owner ? "session-not-fresh" : "denied";
    }

    // RD-04 has no business operation tables. Before introducing them, their
    // eligibility checks must join this transaction under the same owner lock.
    await client.query(
      `UPDATE user_profiles SET status = 'DEACTIVATED', updated_at = clock_timestamp()
       WHERE user_id = $1`,
      [identity.userId],
    );
    await client.query(
      `DELETE FROM "verification"
       WHERE value = $1 AND identifier LIKE 'reset-password:%'`,
      [identity.userId],
    );
    // Pending email changes cascade with the originating session.
    await client.query('DELETE FROM "session" WHERE "userId" = $1', [
      identity.userId,
    ]);
    await client.query("COMMIT");
    return "deactivated";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
