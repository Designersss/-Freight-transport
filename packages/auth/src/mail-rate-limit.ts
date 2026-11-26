import { createHmac } from "node:crypto";
import type { Pool } from "pg";

type MailAction = "verification" | "password-reset";

interface Bucket {
  key: string;
  seconds: number;
  max: number;
}

// Count valid requests, not account existence or SMTP outcomes. Separate
// recipient buckets for verification and reset; one shared global budget.
// All reservations commit atomically before any email or reset token creation.
export async function reserveMailRequest(
  pool: Pool,
  secret: string,
  action: MailAction,
  email: string,
): Promise<number | null> {
  const digest = createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
  const prefix = `recipient:${action}:${digest}`;
  const buckets: Bucket[] = [
    { key: "global:minute", seconds: 60, max: 60 },
    { key: "global:day", seconds: 86400, max: 1000 },
    { key: `${prefix}:minute`, seconds: 60, max: 1 },
    { key: `${prefix}:hour`, seconds: 3600, max: 5 },
  ];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const bucket of buckets) {
      const result = await client.query(
        `INSERT INTO auth_mail_rate_limits (key, count, expires_at)
         VALUES ($1, 1, now() + $2 * interval '1 second')
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN auth_mail_rate_limits.expires_at <= now() THEN 1 ELSE auth_mail_rate_limits.count + 1 END,
           expires_at = CASE WHEN auth_mail_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE auth_mail_rate_limits.expires_at END
         WHERE auth_mail_rate_limits.expires_at <= now() OR auth_mail_rate_limits.count < $3
         RETURNING key`,
        [bucket.key, bucket.seconds, bucket.max],
      );
      if (!result.rowCount) {
        const retry = await client.query<{ seconds: number }>(
          "SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - now()))))::integer AS seconds FROM auth_mail_rate_limits WHERE key = $1",
          [bucket.key],
        );
        await client.query("ROLLBACK");
        return retry.rows[0]?.seconds ?? bucket.seconds;
      }
    }
    // Global buckets serialize admitted requests, and expired state is bounded.
    await client.query("DELETE FROM auth_mail_rate_limits WHERE expires_at <= now()");
    await client.query("COMMIT");
    return null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
