import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { handleTelegramBotCommand } from "../../packages/auth/dist/telegram-bot-internal.js";
import {
  confirmTelegramBotApproval,
  createTelegramBrowserCapability,
  startTelegramBotRequest,
} from "../../packages/auth/dist/telegram-bot-requests.js";

test("Internal bot commands validate ownership and require browser confirmation", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const userId = String(randomBytes(6).readUIntBE(0, 6) + 1);
  const actor = { chatType: "private", chatId: userId, userId };
  const otherId = String(Number(userId) + 1);
  const other = { chatType: "private", chatId: otherId, userId: otherId };
  const browser = createTelegramBrowserCapability();

  async function send(command, status = 200) {
    const response = await handleTelegramBotCommand(pool, command);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
    return response.json();
  }

  try {
    const request = await startTelegramBotRequest(pool, browser, {
      intent: "register",
      locale: "ru",
    });
    const requestId = request.id;
    const claim = {
      action: "claim",
      actor,
      deepLink: request.deepLink,
      names: { firstName: "Synthetic", lastName: "Driver" },
    };
    for (const invalid of [
      { ...claim, action: "unknown" },
      { ...claim, browserCapability: browser },
      { ...claim, actor: { ...actor, chatId: otherId } },
      { ...claim, actor: { ...actor, chatType: "group" } },
      { ...claim, names: { firstName: "x".repeat(129) } },
      { action: "draft-read", actor, draftId: "invalid" },
    ]) {
      assert.deepEqual(await send(invalid, 400), {
        code: "INVALID_REQUEST",
      });
    }
    const claimed = (await send(claim)).result;
    assert.equal(claimed.id, requestId);
    assert.equal(claimed.needsContact, true);
    assert.equal(claimed.browserHash, undefined);
    assert.equal(
      (await send({ action: "approve", actor: other, requestId })).result,
      null,
    );
    const contact = {
      userId,
      phoneNumber: "+12025550123",
      forwarded: false,
    };
    assert.deepEqual(
      await send(
        {
          action: "contact",
          actor,
          requestId,
          contact: { ...contact, forwarded: true },
        },
        400,
      ),
      { code: "INVALID_REQUEST" },
    );
    assert.equal(
      (await send({ action: "contact", actor, requestId, contact })).result,
      true,
    );
    const proof = (await send({ action: "approve", actor, requestId })).result;
    assert.match(proof, /^[A-Za-z0-9_-]{43}$/);
    const begin = { action: "draft-begin", actor, requestId, channel: "bot" };
    assert.equal((await send(begin)).result, null);
    assert.equal(
      await confirmTelegramBotApproval(pool, browser, requestId, proof),
      true,
    );
    assert.equal((await send(begin)).result, requestId);
    const read = { action: "draft-read", actor, draftId: requestId };
    const draft = (await send(read)).result;
    assert.equal(draft.id, requestId);
    assert.equal(draft.phoneNumber, undefined);
    assert.equal(draft.telegramUserId, undefined);
    assert.equal(draft.browserHash, undefined);
    assert.equal((await send({ ...read, actor: other })).result, null);
    const update = {
      action: "draft-update",
      actor,
      draftId: requestId,
      mutation: { action: "edit", revision: 0, firstName: "Edited" },
    };
    assert.equal((await send(update)).result.revision, 1);
    assert.equal((await send(update)).result, null);
    assert.equal(
      (
        await send({
          action: "draft-cancel",
          actor,
          draftId: requestId,
          revision: 1,
        })
      ).result,
      true,
    );
    assert.equal((await send(read)).result, null);
  } finally {
    await pool.end();
  }
});
