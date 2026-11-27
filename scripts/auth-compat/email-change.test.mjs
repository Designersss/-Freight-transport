import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  beginEmailChange,
  confirmEmailChange,
} from "../../packages/auth/dist/email-change.js";

test("email change requires both inboxes, is one-time and preserves identity", async () => {
  const url = new URL(process.env.AUTH_COMPAT_DATABASE_URL);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: url.href });
  const userId = randomUUID();
  const sessionId = randomUUID();
  const email = `${userId}@example.test`;
  const newEmail = `${randomUUID()}@example.test`;
  const accountId = randomUUID();
  const identity = { userId, sessionId };
  const input = { newEmail, locale: "en" };
  try {
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", username) VALUES ($1, $2, $3, true, $4)',
      [
        userId,
        "Email Driver",
        email,
        `em_${userId.replaceAll("-", "").slice(0, 20)}`,
      ],
    );
    await pool.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date)
       VALUES ($1, 'Email', 'Driver', 'DRIVER', '1998-05-15')`,
      [userId],
    );
    await pool.query(
      'INSERT INTO "account" (id, "userId", "providerId", "accountId", password) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), userId, "credential", userId, "synthetic-hash"],
    );
    await pool.query(
      `INSERT INTO "session" (id, "userId", token, "expiresAt")
       VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')`,
      [sessionId, userId, randomUUID()],
    );
    await pool.query(
      'INSERT INTO "account" (id, "userId", "providerId", "accountId", "linkSessionId", "linkRevision") VALUES ($1, $2, $3, $4, $5, 0)',
      [accountId, userId, "telegram", randomUUID(), sessionId],
    );
    assert.deepEqual(
      await beginEmailChange(
        pool,
        { ...identity, sessionId: randomUUID() },
        input,
      ),
      { kind: "denied" },
    );
    assert.deepEqual(
      await beginEmailChange(pool, identity, {
        ...input,
        newEmail: "internal@telegram.invalid",
      }),
      { kind: "invalid" },
    );
    const superseded = await beginEmailChange(pool, identity, input);
    assert.equal(superseded.kind, "deliver");
    const old = await beginEmailChange(pool, identity, input);
    assert.equal(old.kind, "deliver");
    assert.equal(old.email, email);
    assert.equal(old.stage, "old");
    assert.deepEqual(
      await confirmEmailChange(pool, { token: superseded.token }),
      { kind: "invalid" },
    );
    const state = await pool.query(
      "SELECT token_hash FROM pending_email_change WHERE user_id = $1",
      [userId],
    );
    assert.notEqual(state.rows[0].token_hash, old.token);
    const outcomes = await Promise.all([
      confirmEmailChange(pool, { token: old.token }),
      confirmEmailChange(pool, { token: old.token }),
    ]);
    assert.deepEqual(
      outcomes.map((item) => item.kind).sort(),
      ["deliver", "invalid"],
    );
    const next = outcomes.find((item) => item.kind === "deliver");
    assert.equal(next.email, newEmail);
    assert.equal(next.stage, "new");
    const before = await pool.query('SELECT email FROM "user" WHERE id = $1', [
      userId,
    ]);
    assert.equal(before.rows[0].email, email);
    await pool.query(
      `INSERT INTO "verification" (id, identifier, value, "expiresAt")
       VALUES ($1, $2, $3, clock_timestamp() + interval '15 minutes')`,
      [randomUUID(), `reset-password:${randomUUID()}`, userId],
    );
    const completed = await Promise.all([
      confirmEmailChange(pool, { token: next.token }),
      confirmEmailChange(pool, { token: next.token }),
    ]);
    assert.equal(
      completed.filter((item) => item.kind === "completed").length,
      1,
    );
    assert.ok(
      completed.some((item) => ["invalid", "denied"].includes(item.kind)),
    );
    const after = await pool.query(
      `SELECT u.email, u."emailVerified", p.role, a.id AS telegram
       FROM "user" u JOIN user_profiles p ON p.user_id = u.id
       JOIN "account" a ON a."userId" = u.id AND a."providerId" = 'telegram'
       WHERE u.id = $1`,
      [userId],
    );
    assert.deepEqual(after.rows[0], {
      email: newEmail,
      emailVerified: true,
      role: "DRIVER",
      telegram: accountId,
    });
    assert.equal(
      (
        await pool.query('SELECT id FROM "session" WHERE "userId" = $1', [
          userId,
        ])
      ).rowCount,
      0,
    );
    assert.equal(
      (
        await pool.query('SELECT id FROM "verification" WHERE value = $1', [
          userId,
        ])
      ).rowCount,
      0,
    );
    assert.deepEqual(
      await confirmEmailChange(pool, { token: next.token }),
      { kind: "invalid" },
    );
  } finally {
    await pool.end();
  }
});
