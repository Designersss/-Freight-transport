import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  cancelTelegramBotRequest,
  createTelegramBrowserCapability,
  readTelegramBotRequest,
  startTelegramBotRequest,
} from "../../packages/auth/dist/telegram-bot-requests.js";

test("Telegram requests are browser-bound, expiring and atomically replaced", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const browser = createTelegramBrowserCapability();
  const other = createTelegramBrowserCapability();
  const input = { intent: "register", locale: "ru" };
  try {
    const first = await startTelegramBotRequest(pool, browser, input);
    assert.match(first.deepLink, /^[A-Za-z0-9_-]{43}$/);
    assert.match(first.displayCode, /^[0-9]{6}$/);
    assert.notEqual(first.deepLink, browser);
    assert.equal(
      await readTelegramBotRequest(pool, browser, first.id),
      "pending",
    );
    assert.equal(await readTelegramBotRequest(pool, other, first.id), null);
    assert.equal(
      await readTelegramBotRequest(pool, first.deepLink, first.id),
      null,
    );
    assert.equal(await cancelTelegramBotRequest(pool, other, first.id), false);
    const stored = await pool.query(
      `SELECT browser_hash, deep_link_hash,
         extract(epoch FROM expires_at - created_at)::int AS ttl
       FROM telegram_bot_requests WHERE id = $1`,
      [first.id],
    );
    const hash = (value) => createHash("sha256").update(value).digest("hex");
    assert.deepEqual(stored.rows, [
      {
        browser_hash: hash(browser),
        deep_link_hash: hash(first.deepLink),
        ttl: 300,
      },
    ]);
    await assert.rejects(
      pool.query(
        "UPDATE telegram_bot_requests SET status = 'approved' WHERE id = $1",
        [first.id],
      ),
      { code: "23514" },
    );
    await pool.query(
      `UPDATE telegram_bot_requests SET status = 'claimed',
         telegram_user_id = '123456789', first_name = 'Synthetic'
       WHERE id = $1`,
      [first.id],
    );
    await assert.rejects(
      pool.query(
        "UPDATE telegram_bot_requests SET status = 'approved' WHERE id = $1",
        [first.id],
      ),
      { code: "23514" },
    );
    assert.equal(await cancelTelegramBotRequest(pool, browser, first.id), true);
    assert.equal(await cancelTelegramBotRequest(pool, browser, first.id), false);
    const cancelled = await pool.query(
      "SELECT telegram_user_id, first_name, last_name, phone_number FROM telegram_bot_requests WHERE id = $1",
      [first.id],
    );
    assert.deepEqual(cancelled.rows, [
      {
        telegram_user_id: null,
        first_name: null,
        last_name: null,
        phone_number: null,
      },
    ]);
    const results = await Promise.all([
      startTelegramBotRequest(pool, browser, input),
      startTelegramBotRequest(pool, browser, input),
    ]);
    const states = await Promise.all(
      results.map((request) =>
        readTelegramBotRequest(pool, browser, request.id),
      ),
    );
    assert.equal(states.filter((state) => state === "pending").length, 1);
    assert.equal(states.filter((state) => state === null).length, 1);
    assert.equal(await readTelegramBotRequest(pool, browser, first.id), null);
    const live = results.find((_, index) => states[index] === "pending");
    assert.ok(live);
    await pool.query(
      `UPDATE telegram_bot_requests SET
         created_at = created_at - interval '6 minutes',
         expires_at = expires_at - interval '6 minutes'
       WHERE id = $1`,
      [live.id],
    );
    assert.equal(await readTelegramBotRequest(pool, browser, live.id), "expired");
    assert.equal(await cancelTelegramBotRequest(pool, browser, live.id), false);
  } finally {
    await pool.end();
  }
});
