import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createAuthOptions } from "../../packages/auth/dist/auth.js";
import { parseAuthConfig } from "../../packages/auth/dist/config.js";
import {
  createTelegramBotLoginPlugin,
  TELEGRAM_BOT_BROWSER_COOKIE,
} from "../../packages/auth/dist/telegram-bot-login.js";
import {
  claimTelegramBotRequest,
  confirmTelegramBotApproval,
  createTelegramBrowserCapability,
  prepareTelegramBotApproval,
  readTelegramBotRequest,
  startTelegramBotRequest,
} from "../../packages/auth/dist/telegram-bot-requests.js";

const authRequire = createRequire(
  new URL("../../packages/auth/dist/auth.js", import.meta.url),
);
const { betterAuth } = await import(
  pathToFileURL(authRequire.resolve("better-auth")).href
);
const origin = "https://web.example.test";
const base = "/api/v1/auth";

test("Native bot login consumes its browser grant with the session INSERT", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const config = parseAuthConfig({
    NODE_ENV: "test",
    AUTH_BASE_URL: origin,
    AUTH_WEB_ORIGIN: origin,
    AUTH_SECRET: randomBytes(32).toString("hex"),
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1025",
    SMTP_SECURITY: "local",
    SMTP_FROM: "auth@movaro.test",
  });
  const options = createAuthOptions(config, pool, {
    async send() {
      assert.fail("Bot login must not send email");
    },
  });
  const instance = () =>
    betterAuth({
      ...options,
      plugins: [createTelegramBotLoginPlugin(pool, origin)],
    });
  const auth = instance();
  const peer = instance();
  const telegramId = String(randomBytes(6).readUIntBE(0, 6) + 1);
  const accountId = randomUUID();
  const userId = randomUUID();
  const subject = `bot:${telegramId}`;
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const browser = createTelegramBrowserCapability();
  const actor = {
    chatType: "private",
    chatId: telegramId,
    userId: telegramId,
  };

  async function approve() {
    const request = await startTelegramBotRequest(pool, browser, {
      intent: "login",
      locale: "en",
    });
    assert.ok(await claimTelegramBotRequest(pool, request.deepLink, actor, {}));
    const returnProof = await prepareTelegramBotApproval(pool, request.id, actor);
    assert.ok(returnProof);
    assert.equal(
      await confirmTelegramBotApproval(pool, browser, request.id, returnProof),
      true,
    );
    return request;
  }

  function finish(instance, request, capability, ip, requestOrigin = origin) {
    return instance.handler(
      new Request(`${origin}${base}/telegram-bot/finish-login`, {
        method: "POST",
        headers: {
          origin: requestOrigin,
          cookie: `${TELEGRAM_BOT_BROWSER_COOKIE}=${capability}`,
          "content-type": "application/json",
          "x-movaro-client-ip": ip,
        },
        body: JSON.stringify({ requestId: request.id }),
      }),
    );
  }

  try {
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", username) VALUES ($1, $2, $3, false, $4)',
      [
        userId,
        "Synthetic Driver",
        `${hash(subject)}@telegram.invalid`,
        `tg_${userId.replaceAll("-", "").slice(0, 20)}`,
      ],
    );
    await pool.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date)
       VALUES ($1, 'Synthetic', 'Driver', 'DRIVER', '1990-01-01')`,
      [userId],
    );
    await pool.query(
      'INSERT INTO "account" (id, "userId", "providerId", "accountId") VALUES ($1, $2, $3, $4)',
      [accountId, userId, "telegram", subject],
    );
    const request = await approve();
    const wrong = await finish(
      auth,
      request,
      request.deepLink,
      "198.51.100.40",
    );
    assert.equal(wrong.status, 403);
    const cross = await finish(
      auth,
      request,
      browser,
      "198.51.100.41",
      "https://foreign.example.test",
    );
    assert.equal(cross.status, 403);
    assert.equal(
      await readTelegramBotRequest(pool, browser, request.id),
      "approved",
    );

    // A valid grant consumed by a failing INSERT must remain approved.
    await assert.rejects(
      pool.query(
        `INSERT INTO "session" (id, "userId", token, "expiresAt",
           "telegramAccountId", "telegramBotRequestId", "telegramBotBrowserHash")
         VALUES ($1, $2, NULL, clock_timestamp() + interval '1 hour', $3, $4, $5)`,
        [randomUUID(), userId, accountId, request.id, hash(browser)],
      ),
      { code: "23502" },
    );
    assert.equal(
      await readTelegramBotRequest(pool, browser, request.id),
      "approved",
    );
    const competing = await Promise.all([
      finish(auth, request, browser, "198.51.100.42"),
      finish(peer, request, browser, "198.51.100.43"),
    ]);
    assert.deepEqual(
      competing.map((response) => response.status).sort(),
      [200, 403],
    );
    const success = competing.find((response) => response.ok);
    assert.ok(success);
    assert.deepEqual(await success.json(), { success: true });
    const issued = success.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Secure-better-auth.session_token="));
    assert.ok(issued);
    assert.match(issued, /;\s*Secure(?:;|$)/i);
    assert.match(issued, /;\s*HttpOnly(?:;|$)/i);
    assert.match(issued, /;\s*SameSite=Lax(?:;|$)/i);
    assert.doesNotMatch(issued, /;\s*Domain=/i);
    const cookie = issued.split(";")[0];
    const current = await auth.handler(
      new Request(`${origin}${base}/get-session`, {
        headers: { cookie, "x-movaro-client-ip": "198.51.100.44" },
      }),
    );
    assert.equal(current.status, 200);
    assert.equal((await current.json())?.user.id, userId);
    const stored = await pool.query(
      `SELECT "telegramAccountId", "telegramBotRequestId",
        "telegramBotBrowserHash", "adminSession" FROM "session" WHERE "userId" = $1`,
      [userId],
    );
    assert.deepEqual(stored.rows, [
      {
        telegramAccountId: accountId,
        telegramBotRequestId: null,
        telegramBotBrowserHash: null,
        adminSession: false,
      },
    ]);
    assert.equal(
      await readTelegramBotRequest(pool, browser, request.id),
      "consumed",
    );
    assert.equal(
      (await finish(auth, request, browser, "198.51.100.45")).status,
      403,
    );
    const next = await approve();
    await pool.query(
      "UPDATE user_profiles SET status = 'DEACTIVATED' WHERE user_id = $1",
      [userId],
    );
    assert.equal(
      (await finish(auth, next, browser, "198.51.100.46")).status,
      403,
    );
    assert.equal(
      await readTelegramBotRequest(pool, browser, next.id),
      "approved",
    );
  } finally {
    await pool.end();
  }
});
