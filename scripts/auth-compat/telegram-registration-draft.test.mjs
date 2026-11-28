import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  claimTelegramBotRequest,
  confirmTelegramBotApproval,
  createTelegramBrowserCapability,
  prepareTelegramBotApproval,
  readTelegramBotRequest,
  saveTelegramBotContact,
  startTelegramBotRequest,
} from "../../packages/auth/dist/telegram-bot-requests.js";
import {
  beginBotOnlyRegistrationDraft,
  beginTelegramRegistrationDraft,
  beginTelegramRegistrationInBot,
  cancelTelegramRegistrationDraft,
  completeTelegramRegistrationDraft,
  deleteExpiredTelegramRegistrationCompletions,
  deleteExpiredTelegramRegistrationDrafts,
  findTelegramRegistrationDraft,
  readTelegramRegistrationCompletion,
  readTelegramRegistrationDraft,
  resumeTelegramRegistrationInBrowser,
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
    const returnProof = await prepareTelegramBotApproval(pool, id, actor);
    assert.ok(returnProof);
    assert.equal(await begin(), null);
    assert.equal(
      await confirmTelegramBotApproval(pool, browser, id, returnProof),
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
      const returnProof = await prepareTelegramBotApproval(pool, id, actor);
      assert.ok(returnProof);
      assert.equal(
        await confirmTelegramBotApproval(pool, browser, id, returnProof),
        true,
      );
      assert.equal(
        await beginTelegramRegistrationDraft(pool, id, actor, channel),
        id,
      );
      const finish = (owner, revision) =>
        completeTelegramRegistrationDraft(pool, id, owner, revision);
      assert.equal(await finish(access, 0), "invalid");
      assert.equal(
        await readTelegramRegistrationCompletion(pool, id, browser),
        false,
      );
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
        await readTelegramRegistrationCompletion(pool, id, browser),
        false,
      );
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
      assert.equal(
        await readTelegramRegistrationCompletion(pool, id, browser),
        true,
      );
      assert.equal(
        await readTelegramRegistrationCompletion(pool, id, request.deepLink),
        false,
      );
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
      await pool.query(
        `UPDATE telegram_registration_completions SET
           created_at = created_at - interval '6 minutes',
           expires_at = expires_at - interval '6 minutes' WHERE id = $1`,
        [id],
      );
      assert.equal(
        await readTelegramRegistrationCompletion(pool, id, browser),
        false,
      );
      await deleteExpiredTelegramRegistrationCompletions(pool);
      const receipt = await pool.query(
        "SELECT id FROM telegram_registration_completions WHERE id = $1",
        [id],
      );
      assert.equal(receipt.rowCount, 0);
    }
  } finally {
    await pool.end();
  }
});

test("Bot-first draft can attach a freshly approved browser and revoke the old one", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const userId = String(randomBytes(6).readUIntBE(0, 6) + 1);
  const actor = { chatType: "private", chatId: userId, userId };
  const bot = { channel: "bot", actor };
  const contact = {
    userId,
    phoneNumber: "+12025550123",
    forwarded: false,
  };
  const names = { firstName: "Synthetic", lastName: "Driver" };
  try {
    const begin = (value) =>
      beginBotOnlyRegistrationDraft(pool, actor, value, names, "ru");
    assert.equal(await begin({ ...contact, forwarded: true }), null);
    assert.equal(await begin({ ...contact, userId: "999" }), null);
    const starts = await Promise.all([begin(contact), begin(contact)]);
    const id = starts.find(Boolean);
    assert.ok(id);
    assert.equal(starts.filter(Boolean).length, 1);
    const initial = await findTelegramRegistrationDraft(pool, bot);
    assert.equal(initial?.id, id);
    assert.equal(initial?.channel, "bot");
    assert.equal(
      await updateTelegramRegistrationDraft(pool, id, bot, {
        action: "switch",
        channel: "web",
        revision: 0,
      }),
      null,
    );
    const edited = await updateTelegramRegistrationDraft(pool, id, bot, {
      action: "edit",
      revision: 0,
      role: "DRIVER",
      firstName: "Edited",
    });
    assert.equal(edited?.revision, 1);
    async function approve(browser) {
      const request = await startTelegramBotRequest(pool, browser, {
        intent: "register",
        locale: "ru",
      });
      assert.equal(
        await resumeTelegramRegistrationInBrowser(
          pool,
          id,
          request.id,
          actor,
          1,
        ),
        null,
      );
      await claimTelegramBotRequest(pool, request.deepLink, actor, names);
      assert.equal(
        await saveTelegramBotContact(pool, request.id, actor, contact),
        true,
      );
      const returnProof = await prepareTelegramBotApproval(
        pool,
        request.id,
        actor,
      );
      assert.ok(returnProof);
      assert.equal(
        await confirmTelegramBotApproval(
          pool,
          browser,
          request.id,
          returnProof,
        ),
        true,
      );
      return request;
    }
    const browser = createTelegramBrowserCapability();
    const web = { channel: "web", browserCapability: browser };
    const request = await approve(browser);
    assert.equal(await findTelegramRegistrationDraft(pool, web), null);
    assert.equal(
      await resumeTelegramRegistrationInBrowser(pool, id, request.id, actor, 0),
      null,
    );
    const resumed = await Promise.all([
      resumeTelegramRegistrationInBrowser(pool, id, request.id, actor, 1),
      resumeTelegramRegistrationInBrowser(pool, id, request.id, actor, 1),
    ]);
    assert.equal(resumed.filter((value) => value === id).length, 1);
    const attached = await findTelegramRegistrationDraft(pool, web);
    assert.equal(attached?.firstName, "Edited");
    assert.equal(attached?.revision, 2);
    assert.equal(attached?.channel, "web");
    assert.equal(
      await readTelegramBotRequest(pool, browser, request.id),
      "consumed",
    );

    const next = createTelegramBrowserCapability();
    const nextRequest = await approve(next);
    assert.equal(
      await resumeTelegramRegistrationInBrowser(
        pool,
        id,
        nextRequest.id,
        actor,
        2,
      ),
      id,
    );
    assert.equal(await findTelegramRegistrationDraft(pool, web), null);
    const replacement = await findTelegramRegistrationDraft(pool, {
      channel: "web",
      browserCapability: next,
    });
    assert.equal(replacement?.firstName, "Edited");
    assert.equal(replacement?.revision, 3);
    const account = await pool.query(
      'SELECT id FROM "account" WHERE "providerId" = $1 AND "accountId" = $2',
      ["telegram", `bot:${userId}`],
    );
    assert.equal(account.rowCount, 0);
  } finally {
    await pool.end();
  }
});

test("Cancel and complete compete without publishing a false completion", async () => {
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
      locale: "en",
    });
    const { id } = request;
    await claimTelegramBotRequest(pool, request.deepLink, actor, {
      firstName: "Synthetic",
      lastName: "Driver",
    });
    assert.equal(
      await saveTelegramBotContact(pool, id, actor, {
        userId,
        phoneNumber: "+12025550123",
        forwarded: false,
      }),
      true,
    );
    const returnProof = await prepareTelegramBotApproval(pool, id, actor);
    assert.ok(returnProof);
    assert.equal(
      await confirmTelegramBotApproval(pool, browser, id, returnProof),
      true,
    );
    assert.equal(
      await beginTelegramRegistrationDraft(pool, id, actor, "bot"),
      id,
    );
    const edited = await updateTelegramRegistrationDraft(pool, id, bot, {
      action: "edit",
      revision: 0,
      role: "DRIVER",
      birthDate: "1990-01-01",
      username: `tg_${randomBytes(8).toString("hex")}`,
    });
    assert.equal(edited?.revision, 1);
    assert.equal(
      await cancelTelegramRegistrationDraft(pool, id, web, 1),
      false,
    );
    assert.equal(
      await cancelTelegramRegistrationDraft(pool, id, bot, 0),
      false,
    );
    const [cancelled, completed] = await Promise.all([
      cancelTelegramRegistrationDraft(pool, id, bot, 1),
      completeTelegramRegistrationDraft(pool, id, bot, 1),
    ]);
    assert.ok(
      (cancelled && completed === "denied") ||
        (!cancelled && completed === "created"),
    );
    assert.equal(
      await readTelegramRegistrationCompletion(pool, id, browser),
      completed === "created",
    );
    assert.equal(await readTelegramRegistrationDraft(pool, id, web), null);
  } finally {
    await pool.end();
  }
});

test("Expired draft conflicts do not block a new registration or browser attachment", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const userId = String(randomBytes(6).readUIntBE(0, 6) + 1);
  const otherId = String(Number(userId) + 1);
  const actor = { chatType: "private", chatId: userId, userId };
  const other = { chatType: "private", chatId: otherId, userId: otherId };
  const bot = { channel: "bot", actor };
  const names = { firstName: "Synthetic", lastName: "Driver" };
  const contact = (owner) => ({
    userId: owner.userId,
    phoneNumber: "+12025550123",
    forwarded: false,
  });
  const browser = createTelegramBrowserCapability();
  const web = { channel: "web", browserCapability: browser };

  async function expire(id) {
    await pool.query(
      `UPDATE telegram_registration_drafts SET
         created_at = clock_timestamp() - interval '1 hour',
         expires_at = clock_timestamp() - interval '1 minute'
       WHERE id = $1`,
      [id],
    );
  }

  async function claim(owner) {
    const request = await startTelegramBotRequest(pool, browser, {
      intent: "register",
      locale: "ru",
    });
    assert.ok(
      await claimTelegramBotRequest(pool, request.deepLink, owner, names),
    );
    assert.equal(
      await saveTelegramBotContact(pool, request.id, owner, contact(owner)),
      true,
    );
    return request;
  }

  async function approve(request, owner) {
    const proof = await prepareTelegramBotApproval(pool, request.id, owner);
    assert.ok(proof);
    assert.equal(
      await confirmTelegramBotApproval(pool, browser, request.id, proof),
      true,
    );
  }

  try {
    const begin = () =>
      beginBotOnlyRegistrationDraft(pool, actor, contact(actor), names, "ru");
    const initial = await begin();
    assert.ok(initial);
    assert.ok(
      await updateTelegramRegistrationDraft(pool, initial, bot, {
        action: "edit",
        revision: 0,
        firstName: "Expired name",
      }),
    );
    await expire(initial);
    const starts = await Promise.all([begin(), begin()]);
    assert.equal(starts.filter(Boolean).length, 1);
    const fresh = starts.find(Boolean);
    assert.ok(fresh);
    assert.notEqual(fresh, initial);
    assert.equal(await readTelegramRegistrationDraft(pool, initial, bot), null);
    assert.equal((await findTelegramRegistrationDraft(pool, bot))?.revision, 0);
    assert.equal(
      (await findTelegramRegistrationDraft(pool, bot))?.firstName,
      names.firstName,
    );
    assert.equal(await begin(), null);

    // A live draft for another Telegram actor cannot be removed or replaced
    // just because a new request was approved in the same browser.
    const otherRequest = await claim(other);
    await approve(otherRequest, other);
    const otherDraft = await beginTelegramRegistrationDraft(
      pool,
      otherRequest.id,
      other,
      "web",
    );
    assert.ok(otherDraft);
    const attachment = await claim(actor);
    await approve(attachment, actor);
    const resume = () =>
      resumeTelegramRegistrationInBrowser(pool, fresh, attachment.id, actor, 0);
    assert.equal(await resume(), null);
    assert.equal((await findTelegramRegistrationDraft(pool, web))?.id, otherDraft);
    assert.equal(
      await readTelegramBotRequest(pool, browser, attachment.id),
      "approved",
    );
    await expire(otherDraft);
    assert.equal(await resume(), fresh);
    assert.equal((await findTelegramRegistrationDraft(pool, web))?.id, fresh);
    assert.equal((await findTelegramRegistrationDraft(pool, web))?.revision, 1);

    // Web can start over immediately after its own draft expires.
    await expire(fresh);
    const webRequest = await claim(actor);
    await approve(webRequest, actor);
    const webDraft = await beginTelegramRegistrationDraft(
      pool,
      webRequest.id,
      actor,
      "web",
    );
    assert.equal(webDraft, webRequest.id);
    assert.equal((await findTelegramRegistrationDraft(pool, web))?.revision, 0);

    // Choosing chat after expiry must also create a fresh, unbound draft.
    await expire(webDraft);
    const chatRequest = await claim(actor);
    const chatDraft = await beginTelegramRegistrationInBot(
      pool,
      chatRequest.id,
      actor,
    );
    assert.equal(chatDraft, chatRequest.id);
    assert.equal((await findTelegramRegistrationDraft(pool, bot))?.channel, "bot");
    assert.equal(await findTelegramRegistrationDraft(pool, web), null);
  } finally {
    await pool.end();
  }
});
