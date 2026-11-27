import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  readTelegramSettings,
  unlinkTelegram,
} from "../../packages/auth/dist/telegram-settings.js";

test("Telegram unlink keeps a credential, checks freshness and revokes other sessions", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });

  async function createIdentity(credential) {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const otherSessionId = randomUUID();
    const subject = randomUUID();
    const syntheticEmail = `${createHash("sha256").update(subject).digest("hex")}@telegram.invalid`;
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", username) VALUES ($1, $2, $3, $4, $5)',
      [
        userId,
        "Test Driver",
        credential ? `${userId}@example.test` : syntheticEmail,
        credential,
        `tg_${userId.replaceAll("-", "").slice(0, 20)}`,
      ],
    );
    await pool.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date)
       VALUES ($1, 'Test', 'Driver', 'DRIVER', '1998-05-15')`,
      [userId],
    );
    if (credential) {
      await pool.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId", password) VALUES ($1, $2, $3, $4, $5)',
        [randomUUID(), userId, "credential", userId, "synthetic-hash"],
      );
    }
    for (const id of [sessionId, otherSessionId]) {
      await pool.query(
        `INSERT INTO "session" (id, "userId", token, "expiresAt")
         VALUES ($1, $2, $3, clock_timestamp() + interval '1 hour')`,
        [id, userId, randomUUID()],
      );
    }
    await pool.query(
      'INSERT INTO "account" (id, "userId", "providerId", "accountId", "linkSessionId", "linkRevision") VALUES ($1, $2, $3, $4, $5, $6)',
      [
        randomUUID(),
        userId,
        "telegram",
        subject,
        credential ? sessionId : null,
        credential ? 0 : null,
      ],
    );
    return { userId, sessionId, otherSessionId };
  }

  try {
    const owner = await createIdentity(true);
    const telegramOnly = await createIdentity(false);
    assert.deepEqual(await readTelegramSettings(pool, owner), {
      linked: true,
      credential: true,
      fresh: true,
      revision: 1,
    });
    assert.equal(await unlinkTelegram(pool, telegramOnly), "last-method");
    assert.equal(
      (await readTelegramSettings(pool, telegramOnly))?.linked,
      true,
    );
    const foreignSession = { ...owner, sessionId: telegramOnly.sessionId };
    assert.equal(await unlinkTelegram(pool, foreignSession), "denied");
    await pool.query(
      `UPDATE "session" SET "createdAt" = clock_timestamp() - interval '11 minutes' WHERE id = $1`,
      [owner.sessionId],
    );
    assert.equal(await unlinkTelegram(pool, owner), "session-not-fresh");
    assert.equal((await readTelegramSettings(pool, owner))?.linked, true);
    await pool.query(
      'UPDATE "session" SET "createdAt" = clock_timestamp() WHERE id = $1',
      [owner.sessionId],
    );
    await pool.query(
      "UPDATE user_profiles SET status = 'DEACTIVATED' WHERE user_id = $1",
      [owner.userId],
    );
    assert.equal(await unlinkTelegram(pool, owner), "denied");
    await pool.query(
      "UPDATE user_profiles SET status = 'ACTIVE' WHERE user_id = $1",
      [owner.userId],
    );
    assert.deepEqual(
      await Promise.all([
        unlinkTelegram(pool, owner),
        unlinkTelegram(pool, owner),
      ]),
      ["unlinked", "unlinked"],
    );
    assert.deepEqual(await readTelegramSettings(pool, owner), {
      linked: false,
      credential: true,
      fresh: true,
      revision: 3,
    });
    const accounts = await pool.query(
      'SELECT "providerId" FROM "account" WHERE "userId" = $1',
      [owner.userId],
    );
    assert.deepEqual(accounts.rows, [{ providerId: "credential" }]);
    const sessions = await pool.query(
      'SELECT id FROM "session" WHERE "userId" = $1',
      [owner.userId],
    );
    assert.deepEqual(sessions.rows, [{ id: owner.sessionId }]);
    assert.equal(
      (await readTelegramSettings(pool, telegramOnly))?.linked,
      true,
    );
    const candidate = randomUUID();
    const insertLink = (sessionId, revision, accountId = randomUUID()) =>
      pool.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId", "linkSessionId", "linkRevision") VALUES ($1, $2, $3, $4, $5, $6)',
        [accountId, owner.userId, "telegram", candidate, sessionId, revision],
      );
    const rejectedBinding = (error) =>
      error.code === "23514" &&
      error.constraint === "account_telegram_link_guard";
    await assert.rejects(insertLink(owner.sessionId, 1), rejectedBinding);
    await assert.rejects(
      insertLink(telegramOnly.sessionId, 3),
      rejectedBinding,
    );
    await assert.rejects(insertLink(null, 3), rejectedBinding);

    // Independent connections race with the same revision; only one wins.
    const writes = await Promise.allSettled([
      insertLink(owner.sessionId, 3),
      insertLink(owner.sessionId, 3),
    ]);
    assert.equal(writes.filter((row) => row.status === "fulfilled").length, 1);
    const rejected = writes.find((row) => row.status === "rejected");
    assert.ok(rejectedBinding(rejected.reason));
    const afterLink = await readTelegramSettings(pool, owner);
    assert.equal(afterLink.revision, 4);
    assert.equal(afterLink.linked, true);
    assert.equal(await unlinkTelegram(pool, owner), "unlinked");
    await assert.rejects(insertLink(owner.sessionId, 3), rejectedBinding);

    // Revoke the initiating session while holding the same user row lock
    // required by the INSERT trigger; the pending write must fail closed.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
        owner.userId,
      ]);
      const pending = assert.rejects(
        insertLink(owner.sessionId, 5),
        rejectedBinding,
      );
      await client.query('DELETE FROM "session" WHERE id = $1', [
        owner.sessionId,
      ]);
      await client.query("COMMIT");
      await pending;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    assert.equal(await unlinkTelegram(pool, owner), "denied");
  } finally {
    await pool.end();
  }
});
