import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { readTelegramSettings } from "../../packages/auth/dist/telegram-settings.js";

test("Telegram binding is permanent and requires a live initiating session", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });

  async function createIdentity(credential, linked = true) {
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
    if (linked) {
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
    }
    return { userId, sessionId, otherSessionId };
  }

  try {
    const owner = await createIdentity(true, false);
    const telegramOnly = await createIdentity(false);
    assert.deepEqual(await readTelegramSettings(pool, owner), {
      linked: false,
      credential: true,
      fresh: true,
      revision: 0,
    });
    assert.equal(
      (await readTelegramSettings(pool, telegramOnly))?.linked,
      true,
    );
    assert.equal(
      await readTelegramSettings(pool, {
        ...owner,
        sessionId: telegramOnly.sessionId,
      }),
      null,
    );
    const rejectedBinding = (error) =>
      error.code === "23514" &&
      error.constraint === "account_telegram_link_guard";
    const insertLink = (identity, sessionId, revision) =>
      pool.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId", "linkSessionId", "linkRevision") VALUES ($1, $2, $3, $4, $5, $6)',
        [
          randomUUID(),
          identity.userId,
          "telegram",
          randomUUID(),
          sessionId,
          revision,
        ],
      );
    await assert.rejects(
      insertLink(owner, telegramOnly.sessionId, 0),
      rejectedBinding,
    );
    await assert.rejects(insertLink(owner, null, 0), rejectedBinding);
    await pool.query(
      `UPDATE "session" SET "createdAt" = clock_timestamp() - interval '11 minutes' WHERE id = $1`,
      [owner.sessionId],
    );
    assert.equal((await readTelegramSettings(pool, owner))?.fresh, false);
    await assert.rejects(insertLink(owner, owner.sessionId, 0), rejectedBinding);
    await pool.query(
      'UPDATE "session" SET "createdAt" = clock_timestamp() WHERE id = $1',
      [owner.sessionId],
    );
    const writes = await Promise.allSettled([
      insertLink(owner, owner.sessionId, 0),
      insertLink(owner, owner.sessionId, 0),
    ]);
    assert.equal(writes.filter((row) => row.status === "fulfilled").length, 1);
    const rejected = writes.find((row) => row.status === "rejected");
    assert.ok(rejectedBinding(rejected.reason));
    assert.deepEqual(await readTelegramSettings(pool, owner), {
      linked: true,
      credential: true,
      fresh: true,
      revision: 1,
    });
    const permanent = (error) =>
      error.code === "23514" &&
      error.constraint === "account_telegram_permanent";
    for (const identity of [owner, telegramOnly]) {
      await assert.rejects(
        pool.query(
          'DELETE FROM "account" WHERE "userId" = $1 AND "providerId" = $2',
          [identity.userId, "telegram"],
        ),
        permanent,
      );
      await assert.rejects(
        pool.query(
          'UPDATE "account" SET "accountId" = $2 WHERE "userId" = $1 AND "providerId" = $3',
          [identity.userId, randomUUID(), "telegram"],
        ),
        permanent,
      );
    }
    await assert.rejects(
      pool.query(
        'UPDATE "account" SET "userId" = $2 WHERE "userId" = $1 AND "providerId" = $3',
        [owner.userId, telegramOnly.userId, "telegram"],
      ),
      permanent,
    );
    const revoked = await createIdentity(true, false);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
        revoked.userId,
      ]);
      const pending = assert.rejects(
        insertLink(revoked, revoked.sessionId, 0),
        rejectedBinding,
      );
      await client.query('DELETE FROM "session" WHERE id = $1', [
        revoked.sessionId,
      ]);
      await client.query("COMMIT");
      await pending;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    assert.equal(await readTelegramSettings(pool, revoked), null);
  } finally {
    await pool.end();
  }
});
