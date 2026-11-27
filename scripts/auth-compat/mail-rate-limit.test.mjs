import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { reserveMailRequest } from "../../packages/auth/dist/mail-rate-limit.js";

test("mail quotas isolate actions and roll back denied requests", async () => {
  const url = new URL(process.env.AUTH_COMPAT_DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/freight_auth_compat");
  const owner = new pg.Pool({ connectionString: url.href });
  // Each test owns a randomly named schema copied from the migrated table.
  // Never alter shared fixture counts or remove the real auth schema.
  const schema = `mail_test_${randomBytes(12).toString("hex")}`;
  const pool = new pg.Pool({
    connectionString: url.href,
    options: `-c search_path=${schema}`,
    max: 5,
  });
  const secret = randomBytes(32).toString("hex");
  let created = false;
  const reserve = (action, email, ip = "192.0.2.10") =>
    reserveMailRequest(pool, secret, action, email, ip);
  const count = async (key) => {
    const result = await pool.query(
      "SELECT count FROM auth_mail_rate_limits WHERE key = $1",
      [key],
    );
    return result.rows[0]?.count ?? 0;
  };
  const seed = (key, value) =>
    pool.query(
      `INSERT INTO auth_mail_rate_limits (key, count, expires_at)
       VALUES ($1, $2, now() + interval '5 minutes')
       ON CONFLICT (key) DO UPDATE SET count = EXCLUDED.count,
         expires_at = EXCLUDED.expires_at`,
      [key, value],
    );
  try {
    await owner.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await owner.query(
      `CREATE TABLE "${schema}".auth_mail_rate_limits
       (LIKE public.auth_mail_rate_limits INCLUDING ALL)`,
    );
    // Avoid minute-boundary timing in the concurrency assertions.
    for (const key of [
      "mail:global:minute",
      "mail:global:day",
      "mail:action:verification:minute",
      "mail:action:verification:day",
    ])
      await seed(key, 1);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        reserve("verification", `synthetic-${index}@example.test`),
      ),
    );
    assert.equal(results.filter((value) => value === null).length, 10);
    assert.ok(results.filter((value) => value !== null).every((n) => n > 0));
    assert.equal(await count("mail:global:minute"), 11);
    assert.equal(await count("mail:action:verification:minute"), 11);
    const mapped = await reserve(
      "password-reset",
      "other@example.test",
      "::ffff:192.0.2.10",
    );
    assert.ok(mapped !== null && mapped > 0);
    assert.equal(await count("mail:global:minute"), 11);
    assert.equal(
      await reserve("verification", "independent@example.test", "192.0.2.11"),
      null,
    );

    // Exhaust verification without exhausting recovery or email change.
    await seed("mail:action:verification:minute", 30);
    await seed("mail:global:minute", 30);
    const verificationLimited = await reserve(
      "verification",
      "denied@example.test",
      "192.0.2.12",
    );
    assert.ok(verificationLimited !== null && verificationLimited > 0);
    assert.equal(await count("mail:global:minute"), 30);
    assert.equal(
      await reserve("password-reset", "recover@example.test", "192.0.2.12"),
      null,
    );
    assert.equal(await reserve("email-change", "change@example.test"), null);
    assert.equal(await count("mail:global:minute"), 32);

    // Per-recipient limits remain independent of source IP.
    const recipientLimited = await reserve(
      "password-reset",
      "recover@example.test",
      "192.0.2.13",
    );
    assert.ok(recipientLimited !== null && recipientLimited > 0);
    assert.equal(await count("mail:global:minute"), 32);

    // A daily exhaustion must also roll back the minute reservation.
    await seed("mail:action:password-reset:day", 400);
    const before = await count("mail:action:password-reset:minute");
    const dailyLimited = await reserve(
      "password-reset",
      "daily@example.test",
      "192.0.2.13",
    );
    assert.ok(dailyLimited !== null && dailyLimited > 0);
    assert.equal(await count("mail:global:minute"), 32);
    assert.equal(await count("mail:action:password-reset:minute"), before);

    // The global ceiling is still independently enforced.
    await seed("mail:global:minute", 60);
    const globalLimited = await reserve("email-change", "blocked@example.test");
    assert.ok(globalLimited !== null && globalLimited > 0);
    assert.equal(await count("mail:action:email-change:minute"), 1);
    // New action-day windows are aligned to UTC day boundaries.
    const aligned = await pool.query(
      `SELECT EXTRACT(EPOCH FROM expires_at)::bigint % 86400 = 0 AS aligned
       FROM auth_mail_rate_limits WHERE key = $1`,
      ["mail:action:email-change:day"],
    );
    assert.equal(aligned.rows[0]?.aligned, true);
  } finally {
    await pool.end();
    try {
      if (created) await owner.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await owner.end();
    }
  }
});
