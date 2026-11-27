import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import {
  createAuthHttpRuntime,
  parseAuthConfig,
} from "../../packages/auth/dist/runtime.js";

test("deactivation revokes sessions and preserves the user's identity", async () => {
  const database = new URL(process.env.AUTH_COMPAT_DATABASE_URL);
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: database.href });
  const api = "http://127.0.0.1:4000";
  const web = "http://127.0.0.1:3000";
  const runtime = createAuthHttpRuntime(
    parseAuthConfig({
      NODE_ENV: "test",
      AUTH_BASE_URL: api,
      AUTH_WEB_ORIGIN: web,
      AUTH_SECRET: randomBytes(32).toString("hex"),
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: process.env.AUTH_COMPAT_SMTP_PORT,
      SMTP_SECURITY: "local",
      SMTP_FROM: "auth@movaro.test",
    }),
    database.href,
  );
  const id = randomUUID();
  const email = `${id}@example.test`;
  const password = "deactivation-test-password";
  const username = `da_${id.replaceAll("-", "").slice(0, 20)}`;
  const telegramId = randomUUID();
  const path = "/account/deactivate";
  const call = (path, body, cookie, origin = web) =>
    runtime.handle(
      new Request(`${api}/api/v1/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-movaro-client-ip": "192.0.2.240",
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  try {
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", username) VALUES ($1, $2, $3, true, $4)',
      [id, "Test Driver", email, username],
    );
    await pool.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date)
       VALUES ($1, 'Test', 'Driver', 'DRIVER', '1998-05-15')`,
      [id],
    );
    await pool.query(
      'INSERT INTO "account" (id, "userId", "providerId", "accountId", password) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), id, "credential", id, await hashPassword(password)],
    );
    const login = await call("/sign-in/email", { email, password });
    assert.equal(login.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const sessions = await pool.query(
      'SELECT id FROM "session" WHERE "userId" = $1',
      [id],
    );
    const sessionId = sessions.rows[0].id;
    await pool.query(
      'INSERT INTO "account" (id, "userId", "providerId", "accountId", "linkSessionId", "linkRevision") VALUES ($1, $2, $3, $4, $5, 0)',
      [telegramId, id, "telegram", randomUUID(), sessionId],
    );
    const second = await call("/sign-in/email", { email, password });
    assert.equal(second.status, 200);
    const otherCookie = second.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    await pool.query(
      `INSERT INTO "verification" (id, identifier, value, "resetEmail", "expiresAt")
       VALUES ($1, $2, $3, $4, clock_timestamp() + interval '15 minutes')`,
      [randomUUID(), `reset-password:${randomUUID()}`, id, email],
    );
    await pool.query(
      `INSERT INTO pending_email_change
         (user_id, session_id, old_email, new_email, token_hash, stage, locale, expires_at)
       VALUES ($1, $2, $3, $4, $5, 'old', 'en', clock_timestamp() + interval '15 minutes')`,
      [
        id,
        sessionId,
        email,
        `${randomUUID()}@example.test`,
        randomBytes(32).toString("hex"),
      ],
    );
    assert.equal((await call(path, { confirm: true })).status, 401);
    assert.equal((await call(path, undefined, cookie)).status, 405);
    assert.equal(
      (await call(path, { confirm: true }, cookie, "https://example.invalid"))
        .status,
      403,
    );
    assert.equal(
      (await call(path, { confirm: true, userId: randomUUID() }, cookie))
        .status,
      400,
    );
    await pool.query(
      `UPDATE "session" SET "createdAt" = clock_timestamp() - interval '11 minutes' WHERE id = $1`,
      [sessionId],
    );
    const stale = await call(path, { confirm: true }, cookie);
    assert.equal(stale.status, 403);
    assert.equal((await stale.json()).code, "SESSION_NOT_FRESH");
    await pool.query(
      'UPDATE "session" SET "createdAt" = clock_timestamp() WHERE id = $1',
      [sessionId],
    );
    const outcomes = await Promise.all([
      call(path, { confirm: true }, cookie),
      call(path, { confirm: true }, otherCookie),
    ]);
    assert.equal(outcomes.filter((result) => result.status === 200).length, 1);
    assert.ok(
      outcomes.every((result) => [200, 401, 403].includes(result.status)),
    );
    const profile = await pool.query(
      `SELECT u.email, u.username, p.status, p.role, a.id AS telegram
       FROM "user" u JOIN user_profiles p ON p.user_id = u.id
       JOIN "account" a ON a."userId" = u.id AND a."providerId" = 'telegram'
       WHERE u.id = $1`,
      [id],
    );
    assert.deepEqual(profile.rows[0], {
      email,
      username,
      status: "DEACTIVATED",
      role: "DRIVER",
      telegram: telegramId,
    });
    const retained = await pool.query(
      'SELECT password FROM "account" WHERE "userId" = $1 AND "providerId" = $2',
      [id, "credential"],
    );
    assert.ok(retained.rows[0].password);
    for (const query of [
      'SELECT id FROM "session" WHERE "userId" = $1',
      'SELECT id FROM "verification" WHERE value = $1',
      "SELECT user_id FROM pending_email_change WHERE user_id = $1",
    ]) {
      assert.equal((await pool.query(query, [id])).rowCount, 0);
    }
    for (const oldCookie of [cookie, otherCookie]) {
      assert.equal(
        (await call("/cabinet/driver", undefined, oldCookie)).status,
        401,
      );
    }
    assert.notEqual(
      (await call("/sign-in/email", { email, password })).status,
      200,
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO "session" (id, "userId", token, "expiresAt")
         VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')`,
        [randomUUID(), id, randomUUID()],
      ),
      (error) =>
        error.code === "23514" &&
        error.constraint === "session_active_account_guard",
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO "verification" (id, identifier, value, "resetEmail", "expiresAt")
         VALUES ($1, $2, $3, $4, clock_timestamp() + interval '15 minutes')`,
        [randomUUID(), `reset-password:${randomUUID()}`, id, email],
      ),
      (error) =>
        error.code === "23514" &&
        error.constraint === "verification_reset_email_guard",
    );
    const reset = await call("/request-password-reset", {
      email,
      locale: "en",
    });
    assert.equal(reset.status, 200);
    assert.deepEqual(await reset.json(), { success: true });
    assert.equal(
      (await pool.query('SELECT id FROM "verification" WHERE value = $1', [id]))
        .rowCount,
      0,
    );
  } finally {
    await runtime.close();
    await pool.end();
  }
});
