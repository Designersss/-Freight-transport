import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  completeTelegramRegistration,
  readTelegramAccess,
} from "../../packages/auth/dist/telegram-registration.js";

test("Telegram-only onboarding requires a live owned identity and is atomic", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  async function createIdentity({ linked = true, email, verified = false } = {}) {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const subject = randomUUID();
    const internal = `${createHash("sha256").update(subject).digest("hex")}@telegram.invalid`;
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, $4)',
      [userId, "Telegram", email ?? internal, verified],
    );
    if (linked) {
      await pool.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId") VALUES ($1, $2, $3, $4)',
        [randomUUID(), userId, "telegram", subject],
      );
    }
    await pool.query(
      `INSERT INTO "session" (id, "userId", token, "expiresAt")
       VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')`,
      [sessionId, userId, randomUUID()],
    );
    return { userId, sessionId };
  }
  const input = {
    username: `tg_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    profile: {
      firstName: "Telegram",
      lastName: "Driver",
      role: "DRIVER",
      birthDate: "1996-02-29",
    },
  };
  try {
    const owner = await createIdentity();
    const other = await createIdentity();
    const missing = await createIdentity({ linked: false });
    const emailAccount = await createIdentity({
      email: `${randomUUID()}@example.test`,
      verified: true,
    });
    const unverifiedEmail = await createIdentity({
      email: `${randomUUID()}@example.test`,
    });
    const wrongIdentity = { ...owner, sessionId: other.sessionId };
    for (const invalid of [
      missing,
      emailAccount,
      unverifiedEmail,
      wrongIdentity,
    ]) {
      assert.equal(await readTelegramAccess(pool, invalid), "denied");
      assert.equal(
        await completeTelegramRegistration(pool, invalid, input),
        "denied",
      );
    }
    assert.equal(await readTelegramAccess(pool, owner), "onboarding");
    assert.equal(
      await completeTelegramRegistration(pool, owner, {
        ...input,
        profile: { ...input.profile, role: "PLATFORM_ADMIN" },
      }),
      "invalid",
    );
    assert.equal(
      await completeTelegramRegistration(pool, owner, {
        ...input,
        photoKey: "not-allowed",
      }),
      "invalid",
    );
    const competing = await Promise.all([
      completeTelegramRegistration(pool, owner, input),
      completeTelegramRegistration(pool, owner, input),
    ]);
    assert.deepEqual(competing.sort(), ["already-complete", "created"]);
    assert.equal(await readTelegramAccess(pool, owner), "active");
    assert.equal(
      await completeTelegramRegistration(pool, other, input),
      "username-taken",
    );
    assert.equal(await readTelegramAccess(pool, other), "onboarding");
    const rows = await pool.query(
      `SELECT u.name, u.username, u."emailVerified", p.role,
         p.photo_key, to_char(p.birth_date, 'YYYY-MM-DD') AS birth
       FROM "user" u LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [owner.userId],
    );
    assert.deepEqual(rows.rows[0], {
      name: "Telegram Driver",
      username: input.username,
      emailVerified: false,
      role: "DRIVER",
      photo_key: null,
      birth: "1996-02-29",
    });
    await pool.query(
      "UPDATE user_profiles SET status = 'DEACTIVATED' WHERE user_id = $1",
      [owner.userId],
    );
    assert.equal(await readTelegramAccess(pool, owner), "denied");
    await pool.query(
      'UPDATE "session" SET "expiresAt" = clock_timestamp() WHERE id = $1',
      [other.sessionId],
    );
    assert.equal(await readTelegramAccess(pool, other), "denied");
    await pool.query('DELETE FROM "session" WHERE id = $1', [owner.sessionId]);
    assert.equal(await readTelegramAccess(pool, owner), "denied");
  } finally {
    await pool.end();
  }
});
