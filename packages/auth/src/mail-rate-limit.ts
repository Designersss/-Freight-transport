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
export function reserveMailRequest(
  pool: Pool,
  secret: string,
  action: MailAction,
  email: string,
): Promise<number | null> {
  const digest = createHmac("sha256", secret)
    .update(email.trim().toLowerCase())
    .digest("hex");
  const prefix = `recipient:${action}:${digest}`;
  const buckets: Bucket[] = [
    { key: "global:minute", seconds: 60, max: 60 },
    { key: "global:day", seconds: 86400, max: 1000 },
    { key: `${prefix}:minute`, seconds: 60, max: 1 },
    { key: `${prefix}:hour`, seconds: 3600, max: 5 },
  ];
  return reserveBuckets(pool, buckets, "mail");
}

// Public username checks never consume the email delivery budget.
export function reserveUsernameRequest(
  pool: Pool,
  secret: string,
  ip: string,
): Promise<number | null> {
  const digest = createHmac("sha256", secret).update(ip).digest("hex");
  return reserveBuckets(
    pool,
    [
      { key: "username:global:minute", seconds: 60, max: 600 },
      { key: `username:ip:${digest}`, seconds: 60, max: 60 },
    ],
    "username",
  );
}

export function reservePhotoRequest(
  pool: Pool,
  secret: string,
  userId: string,
  action: "read" | "write",
): Promise<number | null> {
  const digest = createHmac("sha256", secret).update(userId).digest("hex");
  return reserveBuckets(
    pool,
    [
      {
        key: `photo:${action}:global`,
        seconds: 60,
        max: action === "read" ? 600 : 60,
      },
      {
        key: `photo:${action}:user:${digest}`,
        seconds: 60,
        max: action === "read" ? 60 : 10,
      },
    ],
    "photo",
  );
}

export function reserveTelegramRequest(
  pool: Pool,
  action: "start" | "callback",
): Promise<number | null> {
  return reserveBuckets(
    pool,
    [
      {
        key: `telegram:${action}:global`,
        seconds: 60,
        max: action === "start" ? 120 : 240,
      },
    ],
    "telegram",
  );
}

async function reserveBuckets(
  pool: Pool,
  buckets: Bucket[],
  scope: "mail" | "username" | "photo" | "telegram",
): Promise<number | null> {
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
    await client.query(
      "DELETE FROM auth_mail_rate_limits WHERE expires_at <= now() AND CASE WHEN key LIKE 'username:%' THEN 'username' WHEN key LIKE 'photo:%' THEN 'photo' WHEN key LIKE 'telegram:%' THEN 'telegram' ELSE 'mail' END = $1",
      [scope],
    );
    await client.query("COMMIT");
    return null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
