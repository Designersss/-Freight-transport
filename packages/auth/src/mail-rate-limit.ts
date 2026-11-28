import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import { rateLimitClient } from "./proxy-ip.js";

type MailAction = "verification" | "password-reset" | "email-change";

interface Bucket {
  key: string;
  seconds: number;
  max: number;
  aligned?: true;
}

// Provisional preview budgets; the sum of action ceilings equals the
// existing overall cap. Global windows share UTC boundaries, so one
// purpose cannot spend another purpose's allocation in the same window.
const mailBudgets = {
  verification: { minute: 30, day: 500 },
  "password-reset": { minute: 20, day: 400 },
  "email-change": { minute: 10, day: 100 },
} satisfies Record<MailAction, { minute: number; day: number }>;

// Count valid requests regardless of account existence or SMTP outcome.
// Per-source admission and per-recipient limits are charged atomically with
// global budgets; rejected requests leave all bucket counts unchanged.
export function reserveMailRequest(
  pool: Pool,
  secret: string,
  action: MailAction,
  email: string,
  ip: string | null = null,
): Promise<number | null> {
  const digest = createHmac("sha256", secret)
    .update(email.trim().toLowerCase())
    .digest("hex");
  const prefix = `recipient:${action}:${digest}`;
  const budget = mailBudgets[action];
  const buckets: Bucket[] = [
    { key: "mail:global:minute", seconds: 60, max: 60, aligned: true },
    { key: "mail:global:day", seconds: 86400, max: 1000, aligned: true },
    {
      key: `mail:action:${action}:minute`,
      seconds: 60,
      max: budget.minute,
      aligned: true,
    },
    {
      key: `mail:action:${action}:day`,
      seconds: 86400,
      max: budget.day,
      aligned: true,
    },
  ];
  // Email change already requires a verified session or a live secret
  // token and has its own user/IP admission controls.
  if (action !== "email-change") {
    const source = createHmac("sha256", secret)
      .update(rateLimitClient(ip))
      .digest("hex");
    buckets.push(
      { key: `mail:public:ip:${source}:minute`, seconds: 60, max: 10 },
      { key: `mail:public:ip:${source}:hour`, seconds: 3600, max: 60 },
    );
  }
  buckets.push(
    { key: `${prefix}:minute`, seconds: 60, max: 1 },
    { key: `${prefix}:hour`, seconds: 3600, max: 5 },
  );
  return reserveBuckets(pool, buckets, "mail");
}

// Charge structurally valid proof attempts before any proof lookup or
// password hashing. Keep confirmation admission separate from SMTP quotas.
export function reserveRegistrationRequest(
  pool: Pool,
  secret: string,
  action: "read" | "complete",
  ip: string | null,
): Promise<number | null> {
  const digest = createHmac("sha256", secret)
    .update(rateLimitClient(ip))
    .digest("hex");
  return reserveBuckets(
    pool,
    [
      {
        key: `registration:${action}:global`,
        seconds: 60,
        max: action === "read" ? 600 : 120,
      },
      {
        key: `registration:${action}:ip:${digest}`,
        seconds: 60,
        max: action === "read" ? 60 : 10,
      },
    ],
    "registration",
  );
}

// Public username checks never consume the email delivery budget.
export function reserveUsernameRequest(
  pool: Pool,
  secret: string,
  ip: string,
): Promise<number | null> {
  const digest = createHmac("sha256", secret)
    .update(rateLimitClient(ip))
    .digest("hex");
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

// Separate browser/IP and global admission budgets for the bot Web flow.
export function reserveTelegramBrowserRequest(
  pool: Pool,
  secret: string,
  action: "start" | "poll" | "write",
  ip: string | null,
): Promise<number | null> {
  const digest = createHmac("sha256", secret)
    .update(rateLimitClient(ip))
    .digest("hex");
  const max = action === "start" ? 5 : action === "poll" ? 60 : 30;
  return reserveBuckets(
    pool,
    [
      { key: `telegram:browser:${action}:global`, seconds: 60, max: max * 20 },
      { key: `telegram:browser:${action}:ip:${digest}`, seconds: 60, max },
    ],
    "telegram",
  );
}

// The authenticated bot supplies the actor from a genuine private update.
export function reserveTelegramActorRequest(
  pool: Pool,
  secret: string,
  actorId: string,
): Promise<number | null> {
  const digest = createHmac("sha256", secret).update(actorId).digest("hex");
  return reserveBuckets(
    pool,
    [
      { key: "telegram:actor:global", seconds: 60, max: 1200 },
      { key: `telegram:actor:${digest}`, seconds: 60, max: 60 },
    ],
    "telegram",
  );
}

export function reserveEmailChangeRequest(
  pool: Pool,
  secret: string,
  action: "start" | "confirm",
  identity: string,
): Promise<number | null> {
  const digest = createHmac("sha256", secret)
    .update(action === "confirm" ? rateLimitClient(identity) : identity)
    .digest("hex");
  return reserveBuckets(
    pool,
    [
      { key: `email-change:${action}:global`, seconds: 60, max: 120 },
      {
        key: `email-change:${action}:subject:${digest}`,
        seconds: 60,
        max: action === "start" ? 1 : 10,
      },
    ],
    "email-change",
  );
}

async function reserveBuckets(
  pool: Pool,
  buckets: Bucket[],
  scope:
    | "mail"
    | "username"
    | "photo"
    | "telegram"
    | "email-change"
    | "registration",
): Promise<number | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const bucket of buckets) {
      const result = await client.query(
        `INSERT INTO auth_mail_rate_limits (key, count, expires_at)
         VALUES ($1, 1,
           CASE WHEN $4::boolean THEN
             date_bin($2 * interval '1 second', now(), TIMESTAMPTZ '2000-01-01 00:00:00+00')
               + $2 * interval '1 second'
           ELSE now() + $2 * interval '1 second' END)
         ON CONFLICT (key) DO UPDATE SET
           count = CASE WHEN auth_mail_rate_limits.expires_at <= now() THEN 1 ELSE auth_mail_rate_limits.count + 1 END,
           expires_at = CASE WHEN auth_mail_rate_limits.expires_at <= now() THEN EXCLUDED.expires_at ELSE auth_mail_rate_limits.expires_at END
         WHERE auth_mail_rate_limits.expires_at <= now() OR auth_mail_rate_limits.count < $3
         RETURNING key`,
        [bucket.key, bucket.seconds, bucket.max, bucket.aligned === true],
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
      "DELETE FROM auth_mail_rate_limits WHERE expires_at <= now() AND CASE WHEN key LIKE 'username:%' THEN 'username' WHEN key LIKE 'photo:%' THEN 'photo' WHEN key LIKE 'telegram:%' THEN 'telegram' WHEN key LIKE 'email-change:%' THEN 'email-change' WHEN key LIKE 'registration:%' THEN 'registration' ELSE 'mail' END = $1",
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
