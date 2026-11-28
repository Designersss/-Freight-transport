import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { finishTelegramBotLink } from "../../packages/auth/dist/telegram-bot-link.js";
import {
  cancelTelegramBotRequest,
  claimTelegramBotRequest,
  createTelegramBrowserCapability,
  decideTelegramBotRequest,
  readTelegramBotRequest,
  startTelegramBotRequest,
} from "../../packages/auth/dist/telegram-bot-requests.js";
import { readTelegramSettings } from "../../packages/auth/dist/telegram-settings.js";

test("Bot binding consumes its grant atomically without creating a session", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });

  async function seed() {
    const userId = randomUUID();
    const sessionId = randomUUID();
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", username) VALUES ($1, $2, $3, true, $4)',
      [
        userId,
        "Synthetic Driver",
        `${userId}@example.test`,
        `tg_${userId.replaceAll("-", "").slice(0, 20)}`,
      ],
    );
    await pool.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date)
       VALUES ($1, 'Synthetic', 'Driver', 'DRIVER', '1990-01-01')`,
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
    return { userId, sessionId };
  }

  const telegramId = String(randomBytes(6).readUIntBE(0, 6) + 1);
  const actor = {
    chatType: "private",
    chatId: telegramId,
    userId: telegramId,
  };

  async function approve(identity, browser, revision = 0) {
    const request = await startTelegramBotRequest(pool, browser, {
      intent: "link",
      locale: "en",
      link: { ...identity, revision },
    });
    assert.ok(
      await claimTelegramBotRequest(pool, request.deepLink, actor, {}),
    );
    assert.equal(
      await decideTelegramBotRequest(pool, request.id, actor, "approve"),
      true,
    );
    return request;
  }

  async function count(identity) {
    const result = await pool.query(
      `SELECT count(*)::int AS count FROM "session" WHERE "userId" = $1`,
      [identity.userId],
    );
    return result.rows[0].count;
  }

  try {
    const owner = await seed();
    const other = await seed();
    const browser = createTelegramBrowserCapability();
    const request = await approve(owner, browser);
    assert.equal(
      await finishTelegramBotLink(pool, browser, request.id, other),
      "denied",
    );
    assert.equal(
      await finishTelegramBotLink(pool, browser, request.id, {
        ...owner,
        sessionId: other.sessionId,
      }),
      "denied",
    );
    assert.equal(
      await finishTelegramBotLink(pool, request.deepLink, request.id, owner),
      "denied",
    );
    assert.equal(
      await readTelegramBotRequest(pool, browser, request.id),
      "approved",
    );
    const race = await Promise.all([
      finishTelegramBotLink(pool, browser, request.id, owner),
      finishTelegramBotLink(pool, browser, request.id, owner),
    ]);
    assert.deepEqual(race.sort(), ["denied", "linked"]);
    assert.equal(
      await readTelegramBotRequest(pool, browser, request.id),
      "consumed",
    );
    assert.deepEqual(await readTelegramSettings(pool, owner), {
      linked: true,
      credential: true,
      fresh: true,
      revision: 1,
    });
    const accounts = await pool.query(
      `SELECT "accountId", "linkSessionId", "linkRevision" FROM "account"
       WHERE "userId" = $1 AND "providerId" = 'telegram'`,
      [owner.userId],
    );
    assert.deepEqual(accounts.rows, [
      {
        accountId: `bot:${telegramId}`,
        linkSessionId: null,
        linkRevision: null,
      },
    ]);
    assert.equal(await count(owner), 1);

    // Unique account conflict must not consume the grant or increment revision.
    const otherBrowser = createTelegramBrowserCapability();
    const duplicate = await approve(other, otherBrowser);
    assert.equal(
      await finishTelegramBotLink(pool, otherBrowser, duplicate.id, other),
      "denied",
    );
    assert.equal(
      await readTelegramBotRequest(pool, otherBrowser, duplicate.id),
      "approved",
    );
    assert.equal((await readTelegramSettings(pool, other))?.revision, 0);
    assert.equal((await readTelegramSettings(pool, other))?.linked, false);
    assert.equal(await count(other), 1);

    const revoked = await seed();
    const revokedBrowser = createTelegramBrowserCapability();
    const revokedRequest = await approve(revoked, revokedBrowser);
    await pool.query('DELETE FROM "session" WHERE id = $1', [
      revoked.sessionId,
    ]);
    assert.equal(
      await finishTelegramBotLink(
        pool,
        revokedBrowser,
        revokedRequest.id,
        revoked,
      ),
      "denied",
    );
    assert.equal(await count(revoked), 0);
    const stale = await seed();
    const staleBrowser = createTelegramBrowserCapability();
    const staleRequest = await approve(stale, staleBrowser);
    await pool.query(
      `UPDATE "session" SET "createdAt" = clock_timestamp() - interval '11 minutes' WHERE id = $1`,
      [stale.sessionId],
    );
    assert.equal(
      await finishTelegramBotLink(pool, staleBrowser, staleRequest.id, stale),
      "denied",
    );
    const cancelled = await seed();
    const cancelledBrowser = createTelegramBrowserCapability();
    const cancelledRequest = await approve(cancelled, cancelledBrowser);
    assert.equal(
      await cancelTelegramBotRequest(
        pool,
        cancelledBrowser,
        cancelledRequest.id,
      ),
      true,
    );
    assert.equal(
      await finishTelegramBotLink(
        pool,
        cancelledBrowser,
        cancelledRequest.id,
        cancelled,
      ),
      "denied",
    );
  } finally {
    await pool.end();
  }
});
