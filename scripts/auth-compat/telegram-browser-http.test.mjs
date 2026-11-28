import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  createAuthHttpRuntime,
  parseAuthConfig,
} from "../../packages/auth/dist/runtime.js";
import { TELEGRAM_BOT_BROWSER_COOKIE } from "../../packages/auth/dist/telegram-bot-login.js";

const origin = "https://web.example.test";
const base = "/api/v1/auth";

test("Telegram Web runtime requires both proofs and completes registration before native login", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const runtime = createAuthHttpRuntime(
    parseAuthConfig({
      NODE_ENV: "test",
      AUTH_BASE_URL: origin,
      AUTH_WEB_ORIGIN: origin,
      AUTH_SECRET: randomBytes(32).toString("hex"),
      AUTH_TELEGRAM_BOT_USERNAME: "synthetic_movaro_bot",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      SMTP_SECURITY: "local",
      SMTP_FROM: "auth@movaro.test",
    }),
    databaseUrl,
  );
  const userId = String(randomBytes(6).readUIntBE(0, 6) + 1);
  const actor = { chatType: "private", chatId: userId, userId };
  let cookie = "";
  let sequence = 0;

  async function web(command, options = {}) {
    return runtime.handle(
      new Request(
        `${origin}${base}/telegram-bot/browser${options.query ?? ""}`,
        {
          method: "POST",
          headers: {
            origin: options.origin ?? origin,
            "content-type": "application/json",
            "x-movaro-client-ip": `198.51.100.${++sequence}`,
            cookie: options.cookie ?? cookie,
          },
          body: JSON.stringify(command),
        },
      ),
    );
  }
  async function expectWeb(command, status = 200, options = {}) {
    const response = await web(command, options);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response;
  }
  async function bot(command) {
    const response = await runtime.handleTelegramBotCommand({
      ...command,
      actor,
    });
    assert.equal(response.status, 200);
    return (await response.json()).result;
  }
  async function start(intent) {
    const response = await expectWeb({ action: "start", intent, locale: "en" });
    const issued = response.headers
      .getSetCookie()
      .find((value) => value.startsWith(`${TELEGRAM_BOT_BROWSER_COOKIE}=`));
    assert.ok(issued);
    assert.match(issued, /; Path=\//);
    assert.match(issued, /; Secure/);
    assert.match(issued, /; HttpOnly/);
    assert.match(issued, /; SameSite=Lax/);
    assert.doesNotMatch(issued, /; Domain=/i);
    cookie = issued.split(";")[0];
    const request = await response.json();
    const url = new URL(request.url);
    assert.equal(url.origin, "https://t.me");
    assert.equal(url.pathname, "/synthetic_movaro_bot");
    assert.match(url.searchParams.get("start"), /^[A-Za-z0-9_-]{43}$/);
    return { ...request, deepLink: url.searchParams.get("start") };
  }
  async function claim(request) {
    const claimed = await bot({
      action: "claim",
      deepLink: request.deepLink,
      names: { firstName: "Synthetic", lastName: "Driver" },
    });
    assert.equal(claimed.id, request.requestId);
    return claimed;
  }

  try {
    for (const [path, method] of [
      ["/telegram/start", "POST"],
      ["/telegram/callback?code=synthetic&state=synthetic", "GET"],
      ["/telegram/registration", "POST"],
      ["/sign-in/social", "POST"],
      ["/link-social", "POST"],
    ]) {
      const response = await runtime.handle(
        new Request(`${origin}${base}${path}`, {
          method,
          headers: { origin, "content-type": "application/json" },
          ...(method === "POST" ? { body: "{}" } : {}),
        }),
      );
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("set-cookie"), null);
    }
    await expectWeb(
      { action: "start", intent: "register", locale: "en" },
      403,
      { origin: "https://foreign.example.test" },
    );
    await expectWeb(
      { action: "start", intent: "register", locale: "en", userId },
      400,
    );
    const register = await start("login");
    const unknown = await claim(register);
    assert.equal(unknown.accountState, "unregistered");
    assert.equal(unknown.needsContact, false);
    const changed = await bot({
      action: "change-intent",
      requestId: register.requestId,
      intent: "register",
      names: { firstName: "Synthetic", lastName: "Driver" },
    });
    assert.equal(changed.intent, "register");
    assert.equal(changed.needsContact, true);
    assert.equal(changed.expiresAt, unknown.expiresAt);
    assert.equal(
      await bot({
        action: "contact",
        requestId: register.requestId,
        contact: { userId, phoneNumber: "+12025550123", forwarded: false },
      }),
      true,
    );
    const proof = await bot({
      action: "approve",
      requestId: register.requestId,
    });
    assert.match(proof, /^[A-Za-z0-9_-]{43}$/);
    const finish = { action: "finish", requestId: register.requestId };
    const confirm = { action: "confirm", requestId: register.requestId, proof };
    await expectWeb(finish, 403);
    await expectWeb(confirm, 403, { cookie: "" });
    await expectWeb(confirm, 403, { cookie: `${cookie}; ${cookie}` });
    await expectWeb(confirm, 403, {
      cookie: `${TELEGRAM_BOT_BROWSER_COOKIE}=${register.deepLink}`,
    });
    await expectWeb(confirm, 400, { query: "?unexpected=1" });
    assert.deepEqual(await (await expectWeb(confirm)).json(), {
      success: true,
    });
    await expectWeb(confirm, 403);
    const opened = await expectWeb(finish);
    assert.deepEqual(await opened.json(), {
      outcome: "registration",
      draftId: register.requestId,
    });
    assert.ok(
      !opened.headers
        .getSetCookie()
        .some(
          (value) =>
            value.includes("session_token=") && !value.includes("Max-Age=0"),
        ),
    );
    const draftId = register.requestId;
    const updated = await (
      await expectWeb({
        action: "draft-update",
        draftId,
        mutation: {
          action: "edit",
          revision: 0,
          role: "DRIVER",
          birthDate: "1990-01-01",
          username: `tg_${randomBytes(8).toString("hex")}`,
        },
      })
    ).json();
    assert.equal(updated.draft.revision, 1);
    assert.equal(updated.draft.telegramUserId, undefined);
    assert.equal(updated.draft.phoneNumber, undefined);
    assert.equal(
      (
        await (
          await expectWeb({
            action: "draft-update",
            draftId,
            mutation: { action: "edit", revision: 0, firstName: "Stale" },
          })
        ).json()
      ).draft,
      null,
    );
    const switched = await bot({
      action: "draft-update",
      draftId,
      mutation: { action: "switch", revision: 1, channel: "bot" },
    });
    assert.equal(switched.revision, 2);
    const state = { action: "draft-state", draftId };
    const waiting = await (await expectWeb(state)).json();
    assert.equal(waiting.draft.channel, "bot");
    assert.equal(waiting.completed, false);
    assert.deepEqual(
      await (
        await expectWeb({ action: "draft-complete", draftId, revision: 2 })
      ).json(),
      { outcome: "denied" },
    );
    assert.equal(
      await bot({ action: "draft-complete", draftId, revision: 2 }),
      "created",
    );
    assert.deepEqual(await (await expectWeb(state)).json(), {
      draft: null,
      completed: true,
    });
    assert.deepEqual(
      await (
        await expectWeb(state, 200, {
          cookie: `${TELEGRAM_BOT_BROWSER_COOKIE}=${register.deepLink}`,
        })
      ).json(),
      { draft: null, completed: false },
    );

    const login = await start("register");
    const existing = await claim(login);
    assert.equal(existing.accountState, "active");
    const signIn = await bot({
      action: "change-intent",
      requestId: login.requestId,
      intent: "login",
      names: {},
    });
    assert.equal(signIn.intent, "login");
    assert.equal(signIn.needsContact, false);
    const loginProof = await bot({
      action: "approve",
      requestId: login.requestId,
    });
    await expectWeb({
      action: "confirm",
      requestId: login.requestId,
      proof: loginProof,
    });
    const signedIn = await expectWeb({
      action: "finish",
      requestId: login.requestId,
    });
    assert.deepEqual(await signedIn.json(), { outcome: "logged-in" });
    const session = signedIn.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Secure-better-auth.session_token="));
    assert.ok(session);
    assert.match(session, /;\s*HttpOnly/);
    assert.doesNotMatch(session, /;\s*Domain=/i);
    const verified = await runtime.handle(
      new Request(`${origin}${base}/get-session`, {
        headers: {
          cookie: session.split(";")[0],
          "x-movaro-client-ip": "198.51.100.220",
        },
      }),
    );
    assert.equal(verified.status, 200);
    const current = await verified.json();
    assert.equal(current.user.email, null);
    assert.equal(current.user.emailVerified, false);
    await expectWeb({ action: "finish", requestId: login.requestId }, 403);

    const blocked = await runtime.handle(
      new Request(`${origin}${base}/telegram-bot/finish-login`, {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        body: JSON.stringify({ requestId: login.requestId }),
      }),
    );
    assert.equal(blocked.status, 404);
  } finally {
    await runtime.close();
  }
});
