import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  cancelTelegramBotRequest,
  claimTelegramBotRequest,
  confirmTelegramBotApproval,
  createTelegramBrowserCapability,
  deleteExpiredTelegramBotRequests,
  prepareTelegramBotApproval,
  readTelegramBotRequest,
  rejectTelegramBotRequest,
  saveTelegramBotContact,
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
    assert.equal(
      await cancelTelegramBotRequest(pool, browser, first.id),
      false,
    );
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
    assert.equal(
      await readTelegramBotRequest(pool, browser, live.id),
      "expired",
    );
    assert.equal(await cancelTelegramBotRequest(pool, browser, live.id), false);
  } finally {
    await pool.end();
  }
});

test("Only the claiming private Telegram user can submit contact and decide", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const browser = createTelegramBrowserCapability();
  const actor = {
    chatType: "private",
    chatId: "123456789",
    userId: "123456789",
  };
  const other = { ...actor, chatId: "987654321", userId: "987654321" };
  const names = { firstName: "Synthetic", lastName: "Driver" };
  const contact = {
    userId: actor.userId,
    phoneNumber: "12025550123",
    forwarded: false,
  };
  try {
    const start = () =>
      startTelegramBotRequest(pool, browser, {
        intent: "register",
        locale: "en",
      });
    const first = await start();
    assert.equal(
      await claimTelegramBotRequest(
        pool,
        first.deepLink,
        { ...actor, chatType: "group" },
        names,
      ),
      null,
    );
    assert.equal(
      await claimTelegramBotRequest(pool, browser, actor, names),
      null,
    );
    const competing = await Promise.all([
      claimTelegramBotRequest(pool, first.deepLink, actor, names),
      claimTelegramBotRequest(pool, first.deepLink, other, names),
    ]);
    assert.equal(competing.filter(Boolean).length, 1);
    // Use a fresh request so subsequent checks have a deterministic claimant.
    const request = await start();
    const claimed = await claimTelegramBotRequest(
      pool,
      request.deepLink,
      actor,
      names,
    );
    assert.ok(claimed);
    assert.equal(claimed.id, request.id);
    assert.equal(claimed.displayCode, request.displayCode);
    assert.equal(claimed.needsContact, true);
    assert.equal(
      await claimTelegramBotRequest(pool, request.deepLink, other, names),
      null,
    );
    assert.equal(
      await prepareTelegramBotApproval(pool, request.id, actor),
      null,
    );
    for (const invalid of [
      { ...contact, userId: other.userId },
      { ...contact, userId: undefined },
      { ...contact, forwarded: true },
      { ...contact, phoneNumber: "not-a-phone" },
    ]) {
      assert.equal(
        await saveTelegramBotContact(pool, request.id, actor, invalid),
        false,
      );
    }
    assert.equal(
      await saveTelegramBotContact(pool, request.id, other, contact),
      false,
    );
    assert.equal(
      await saveTelegramBotContact(pool, request.id, actor, contact),
      true,
    );
    assert.equal(
      await saveTelegramBotContact(pool, request.id, actor, contact),
      true,
    );
    assert.equal(
      await saveTelegramBotContact(pool, request.id, actor, {
        ...contact,
        phoneNumber: "+12025550124",
      }),
      false,
    );
    const reopened = await claimTelegramBotRequest(
      pool,
      request.deepLink,
      actor,
      { firstName: "Changed" },
    );
    assert.equal(reopened?.needsContact, false);
    assert.equal(
      await prepareTelegramBotApproval(pool, request.id, other),
      null,
    );
    const previousProof = await prepareTelegramBotApproval(
      pool,
      request.id,
      actor,
    );
    assert.ok(previousProof);
    const proof = await prepareTelegramBotApproval(pool, request.id, actor);
    assert.ok(proof);
    assert.notEqual(proof, previousProof);
    assert.match(proof, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(
      await readTelegramBotRequest(pool, browser, request.id),
      "claimed",
    );
    const hashed = await pool.query(
      "SELECT return_hash FROM telegram_bot_requests WHERE id = $1",
      [request.id],
    );
    assert.equal(
      hashed.rows[0].return_hash,
      createHash("sha256").update(proof).digest("hex"),
    );
    for (const [capability, candidate] of [
      [createTelegramBrowserCapability(), proof],
      [browser, request.deepLink],
      [browser, request.displayCode],
      [browser, previousProof],
      [browser, undefined],
    ]) {
      assert.equal(
        await confirmTelegramBotApproval(
          pool,
          capability,
          request.id,
          candidate,
        ),
        false,
      );
    }
    const approvals = await Promise.all([
      confirmTelegramBotApproval(pool, browser, request.id, proof),
      confirmTelegramBotApproval(pool, browser, request.id, proof),
    ]);
    assert.deepEqual(approvals.sort(), [false, true]);
    assert.equal(
      await prepareTelegramBotApproval(pool, request.id, actor),
      null,
    );
    const erasedProof = await pool.query(
      "SELECT return_hash FROM telegram_bot_requests WHERE id = $1",
      [request.id],
    );
    assert.equal(erasedProof.rows[0].return_hash, null);
    assert.equal(
      await readTelegramBotRequest(pool, browser, request.id),
      "approved",
    );
    const stored = await pool.query(
      "SELECT first_name, last_name, phone_number FROM telegram_bot_requests WHERE id = $1",
      [request.id],
    );
    assert.deepEqual(stored.rows, [
      {
        first_name: "Synthetic",
        last_name: "Driver",
        phone_number: "+12025550123",
      },
    ]);
    assert.equal(
      await claimTelegramBotRequest(pool, request.deepLink, actor, names),
      null,
    );

    const rejected = await start();
    await claimTelegramBotRequest(pool, rejected.deepLink, actor, names);
    await saveTelegramBotContact(pool, rejected.id, actor, contact);
    assert.equal(
      await rejectTelegramBotRequest(pool, rejected.id, actor),
      true,
    );
    assert.equal(
      await readTelegramBotRequest(pool, browser, rejected.id),
      "rejected",
    );
    const erased = await pool.query(
      "SELECT telegram_user_id, first_name, last_name, phone_number FROM telegram_bot_requests WHERE id = $1",
      [rejected.id],
    );
    assert.deepEqual(erased.rows, [
      {
        telegram_user_id: null,
        first_name: null,
        last_name: null,
        phone_number: null,
      },
    ]);

    const login = await startTelegramBotRequest(pool, browser, {
      intent: "login",
      locale: "en",
    });
    const loginClaim = await claimTelegramBotRequest(
      pool,
      login.deepLink,
      actor,
      names,
    );
    assert.equal(loginClaim?.needsContact, false);
    assert.equal(
      await saveTelegramBotContact(pool, login.id, actor, contact),
      false,
    );
    const loginProof = await prepareTelegramBotApproval(pool, login.id, actor);
    assert.ok(loginProof);
    assert.equal(
      await confirmTelegramBotApproval(pool, browser, login.id, loginProof),
      true,
    );
    const expired = await start();
    await claimTelegramBotRequest(pool, expired.deepLink, actor, names);
    await saveTelegramBotContact(pool, expired.id, actor, contact);
    const expiredProof = await prepareTelegramBotApproval(
      pool,
      expired.id,
      actor,
    );
    assert.ok(expiredProof);
    await pool.query(
      `UPDATE telegram_bot_requests SET
         created_at = created_at - interval '6 minutes',
         expires_at = expires_at - interval '6 minutes'
       WHERE id = $1`,
      [expired.id],
    );
    assert.equal(
      await confirmTelegramBotApproval(
        pool,
        browser,
        expired.id,
        expiredProof,
      ),
      false,
    );
    assert.equal(
      await saveTelegramBotContact(pool, expired.id, actor, contact),
      false,
    );
    assert.ok((await deleteExpiredTelegramBotRequests(pool)) >= 1);
    assert.equal(await readTelegramBotRequest(pool, browser, expired.id), null);
  } finally {
    await pool.end();
  }
});
