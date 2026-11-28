import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  claimTelegramBotRequest,
  createTelegramBrowserCapability,
  decideTelegramBotRequest,
  readTelegramBotRequest,
  saveTelegramBotContact,
  startTelegramBotRequest,
} from "../../packages/auth/dist/telegram-bot-requests.js";
import {
  beginTelegramRegistrationDraft,
  completeTelegramRegistrationDraft,
  deleteExpiredTelegramRegistrationDrafts,
  readTelegramRegistrationDraft,
  updateTelegramRegistrationDraft,
} from "../../packages/auth/dist/telegram-registration-draft.js";

test("Web and bot share one versioned registration draft without creating accounts", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const userId = String(randomBytes(6).readUIntBE(0, 6) + 1);
  const actor = { chatType: "private", chatId: userId, userId };
  const bot = { channel: "bot", actor };
  const browser = createTelegramBrowserCapability();
  const web = { channel: "web", browserCapability: browser };
  try {
    const request = await startTelegramBotRequest(pool, browser, {
      intent: "register",
      locale: "ru",
    });
    const id = request.id;
    const begin = () => beginTelegramRegistrationDraft(pool, id, actor, "bot");
    assert.equal(await begin(), null);
    assert.ok(
      await claimTelegramBotRequest(pool, request.deepLink, actor, {
        firstName: "Synthetic",
        lastName: "Driver",
      }),
    );
    assert.equal(await begin(), null);
    assert.equal(
      await saveTelegramBotContact(pool, id, actor, {
        userId,
        phoneNumber: "+12025550123",
        forwarded: false,
      }),
      true,
    );
    assert.equal(
      await decideTelegramBotRequest(pool, id, actor, "approve"),
      true,
    );
    const competing = await Promise.all([begin(), begin()]);
    assert.equal(competing.filter((value) => value === id).length, 1);
    assert.equal(await readTelegramBotRequest(pool, browser, id), "consumed");
    const initial = await readTelegramRegistrationDraft(pool, id, bot);
    assert.ok(initial);
    assert.equal(initial.firstName, "Synthetic");
    assert.equal(initial.revision, 0);
    assert.deepEqual(
      await readTelegramRegistrationDraft(pool, id, web),
      initial,
    );
    assert.equal(
      await readTelegramRegistrationDraft(pool, id, {
        channel: "web",
        browserCapability: request.deepLink,
      }),
      null,
    );
    const edit = (access, revision, fields) =>
      updateTelegramRegistrationDraft(pool, id, access, {
        action: "edit",
        revision,
        ...fields,
      });
    assert.equal(await edit(web, 0, { role: "DRIVER" }), null);
    assert.equal(await edit(bot, 0, { role: "PLATFORM_ADMIN" }), null);
    const race = await Promise.all([
      edit(bot, 0, { role: "DRIVER" }),
      edit(bot, 0, { role: "DISPATCHER" }),
    ]);
    assert.equal(race.filter(Boolean).length, 1);
    const switched = await updateTelegramRegistrationDraft(pool, id, web, {
      action: "switch",
      revision: 1,
      channel: "web",
    });
    assert.ok(switched);
    assert.equal(switched.revision, 2);
    assert.equal(switched.firstName, "Synthetic");
    assert.equal(await edit(bot, 2, { firstName: "Stale" }), null);
    assert.equal(await edit(web, 2, { birthDate: "2099-01-01" }), null);
    const saved = await edit(web, 2, {
      birthDate: "1990-01-01",
      username: "Synthetic_driver",
    });
    assert.ok(saved);
    assert.equal(saved.username, "synthetic_driver");
    assert.equal(saved.birthDate, "1990-01-01");
    assert.equal(saved.revision, 3);
    const accounts = await pool.query(
      'SELECT id FROM "account" WHERE "providerId" = $1 AND "accountId" = $2',
      ["telegram", `bot:${userId}`],
    );
    assert.equal(accounts.rowCount, 0);
    await pool.query(
      `UPDATE telegram_registration_drafts SET
         created_at = clock_timestamp() - interval '1 hour',
         expires_at = clock_timestamp() - interval '1 minute'
       WHERE id = $1`,
      [id],
    );
    assert.equal(await readTelegramRegistrationDraft(pool, id, web), null);
    assert.equal(await edit(web, 3, { firstName: "Expired" }), null);
    assert.ok((await deleteExpiredTelegramRegistrationDrafts(pool)) >= 1);
  } finally {
    await pool.end();
  }
});

test("Both registration channels finalize one account or roll back the draft", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    for (const channel of ["web", "bot"]) {
      const telegramId = String(randomBytes(6).readUIntBE(0, 6) + 1);
      const actor = {
        chatType: "private",
        chatId: telegramId,
        userId: telegramId,
      };
      const browser = createTelegramBrowserCapability();
      const bot = { channel: "bot", actor };
      const web = { channel: "web", browserCapability: browser };
      const access = channel === "web" ? web : bot;
      const inactive = channel === "web" ? bot : web;
      const request = await startTelegramBotRequest(pool, browser, {
        intent: "register",
        locale: "en",
      });
      const { id } = request;
      await claimTelegramBotRequest(pool, request.deepLink, actor, {
        firstName: "Synthetic",
        lastName: "Owner",
      });
      assert.equal(
        await saveTelegramBotContact(pool, id, actor, {
          userId: telegramId,
          phoneNumber: "+12025550123",
          forwarded: false,
        }),
        true,
      );
      assert.equal(
        await decideTelegramBotRequest(pool, id, actor, "approve"),
        true,
      );
      assert.equal(
        await beginTelegramRegistrationDraft(pool, id, actor, channel),
        id,
      );
      const finish = (owner, revision) =>
        completeTelegramRegistrationDraft(pool, id, owner, revision);
      assert.equal(await finish(access, 0), "invalid");
      assert.ok(await readTelegramRegistrationDraft(pool, id, access));
      const taken = `tg_${randomBytes(8).toString("hex")}`;
      const occupied = randomUUID();
      await pool.query(
        'INSERT INTO "user" (id, name, email, username) VALUES ($1, $2, $3, $4)',
        [occupied, "Synthetic", `${occupied}@example.test`, taken],
      );
      const saved = await updateTelegramRegistrationDraft(pool, id, access, {
        action: "edit",
        revision: 0,
        role: "COMPANY_OWNER",
        birthDate: "1990-01-01",
        companyName: "Synthetic Company",
        username: taken,
      });
      assert.equal(saved?.revision, 1);
      assert.equal(await finish(inactive, 1), "denied");
      assert.equal(await finish(access, 0), "denied");
      assert.equal(
        await finish(
          { channel: "web", browserCapability: request.deepLink },
          1,
        ),
        "denied",
      );
      assert.equal(await finish(access, 1), "username-taken");
      assert.equal(
        (await readTelegramRegistrationDraft(pool, id, access))?.revision,
        1,
      );
      const username = `tg_${randomBytes(8).toString("hex")}`;
      const corrected = await updateTelegramRegistrationDraft(
        pool,
        id,
        access,
        { action: "edit", revision: 1, username },
      );
      assert.equal(corrected?.revision, 2);
      const completed = await Promise.all([
        finish(access, 2),
        finish(access, 2),
      ]);
      assert.deepEqual(completed.sort(), ["created", "denied"]);
      assert.equal(await readTelegramRegistrationDraft(pool, id, access), null);
      const rows = await pool.query(
        `SELECT u.username, u."emailVerified", p.role, p.company_name,
           p.telegram_phone_number,
           (SELECT count(*)::int FROM "session" s WHERE s."userId" = u.id) AS sessions
         FROM "account" a JOIN "user" u ON u.id = a."userId"
         JOIN user_profiles p ON p.user_id = u.id
         WHERE a."providerId" = 'telegram' AND a."accountId" = $1`,
        [`bot:${telegramId}`],
      );
      assert.deepEqual(rows.rows, [
        {
          username,
          emailVerified: false,
          role: "COMPANY_OWNER",
          company_name: "Synthetic Company",
          telegram_phone_number: "+12025550123",
          sessions: 0,
        },
      ]);
      assert.equal(await finish(access, 2), "denied");
    }
  } finally {
    await pool.end();
  }
});
