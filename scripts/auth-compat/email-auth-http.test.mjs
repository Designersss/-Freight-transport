import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { parseApiConfig } from "../../apps/api/dist/config/api-config.js";
import { createApp } from "../../apps/api/dist/create-app.js";
import { parseAuthConfig } from "../../packages/auth/dist/runtime.js";

const origin = "http://127.0.0.1:4000";
const webOrigin = "http://127.0.0.1:3000";
const base = "/api/v1/auth";

test("MOVARO email HTTP routes deliver SMTP messages and revoke reset sessions", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const mailPort = Number(process.env.AUTH_COMPAT_MAILPIT_PORT);
  assert.ok(Number.isInteger(mailPort) && mailPort > 0);
  const mailOrigin = `http://127.0.0.1:${mailPort}`;
  const email = `${randomBytes(12).toString("hex")}@example.test`;
  const password = randomBytes(3).toString("hex");
  const newPassword = randomBytes(24).toString("hex");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  let app;
  async function mailLink(fragment) {
    for (let i = 0; i < 50; i++) {
      const list = await fetch(`${mailOrigin}/api/v1/messages`, {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(list.status, 200);
      const { messages } = await list.json();
      const entry = messages.find((message) =>
        message.To.some((to) => to.Address === email),
      );
      if (entry) {
        const message = await fetch(
          `${mailOrigin}/api/v1/message/${entry.ID}`,
          { signal: AbortSignal.timeout(3000) },
        );
        assert.equal(message.status, 200);
        const { Text } = await message.json();
        const link = Text.match(/https?:\/\/[^\s]+/)?.[0];
        if (link?.includes(fragment)) return new URL(link);
      }
      await delay(100);
    }
    assert.fail("Expected SMTP message not received");
  }
  try {
    app = await createApp(
      parseApiConfig({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        LOG_LEVEL: "silent",
      }),
      parseAuthConfig({
        NODE_ENV: "test",
        AUTH_BASE_URL: origin,
        AUTH_WEB_ORIGIN: webOrigin,
        AUTH_SECRET: randomBytes(32).toString("hex"),
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: process.env.AUTH_COMPAT_SMTP_PORT,
        SMTP_SECURITY: "local",
        SMTP_FROM: "auth@movaro.test",
      }),
    );
    await app.init();
    const fastify = app.getHttpAdapter().getInstance();
    const post = (path, payload, headers = {}) =>
      fastify.inject({
        method: "POST",
        url: `${base}${path}`,
        payload,
        headers: {
          origin: webOrigin,
          "content-type": "application/json",
          ...headers,
        },
      });
    const get = (url, cookie) =>
      fastify.inject({ method: "GET", url, headers: cookie ? { cookie } : {} });
    const creds = { email, password };
    for (const invalidPassword of ["12345", "a".repeat(129)]) {
      assert.equal(
        (await post("/sign-in/email", { email, password: invalidPassword }))
          .statusCode,
        400,
      );
      assert.equal(
        (
          await post("/sign-up/email", {
            email,
            password: invalidPassword,
            name: "Test",
          })
        ).statusCode,
        400,
      );
    }
    assert.equal(
      (await post("/sign-in/email", { email: "not-an-email", password }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await post("/sign-up/email", {
          ...creds,
          name: "Test",
          role: "PLATFORM_ADMIN",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await post("/sign-up/email", {
          ...creds,
          email: "someone@telegram.invalid",
          name: "Test",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await post(
          "/sign-up/email",
          { ...creds, name: "Test" },
          { origin: "https://untrusted.invalid" },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await post("/update-user", { role: "PLATFORM_ADMIN" })).statusCode,
      404,
    );
    assert.equal(
      (await post("/sign-up/email", { ...creds, name: "Test" })).statusCode,
      200,
    );
    const unverified = await post("/sign-in/email", creds);
    assert.equal(unverified.statusCode, 403);
    assert.equal(unverified.json().code, "EMAIL_NOT_VERIFIED");
    assert.equal(unverified.headers["set-cookie"], undefined);
    const blockedMail = await post("/send-verification-email", {
      email: email.toUpperCase(),
    });
    assert.equal(blockedMail.statusCode, 429);
    assert.ok(Number(blockedMail.headers["retry-after"]) > 0);
    const concurrentEmail = `${randomBytes(12).toString("hex")}@example.test`;
    const simultaneous = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        fastify.inject({
          method: "POST",
          url: `${base}/send-verification-email`,
          remoteAddress: `192.0.2.${i + 1}`,
          headers: {
            origin: webOrigin,
            "content-type": "application/json",
          },
          payload: { email: concurrentEmail },
        }),
      ),
    );
    assert.equal(
      simultaneous.filter((result) => result.statusCode === 200).length,
      1,
    );
    assert.equal(
      simultaneous.filter((result) => result.statusCode === 429).length,
      4,
    );
    const verification = await mailLink("/verify-email?");
    const verified = await get(verification.pathname + verification.search);
    assert.equal(verified.statusCode, 302);
    assert.equal(
      verified.headers.location,
      `${webOrigin}/ru/login?verified=done`,
    );
    assert.equal(verified.headers["set-cookie"], undefined);
    assert.equal((await get(`${base}/get-session`)).json(), null);
    const login = await post("/sign-in/email", creds);
    assert.equal(login.statusCode, 200);
    assert.deepEqual(login.json(), { success: true });
    const cookies = login.headers["set-cookie"];
    assert.ok(cookies);
    const cookie = (Array.isArray(cookies) ? cookies : [cookies])
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.match(cookie, /session_token=/);
    const session = await get(`${base}/get-session`, cookie);
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().user.emailVerified, true);
    assert.equal(session.json().session.token, undefined);
    assert.equal(
      (await post("/request-password-reset", { email })).statusCode,
      200,
    );
    assert.equal(
      (await post("/request-password-reset", { email })).statusCode,
      429,
    );
    const reset = await mailLink("/reset-password/");
    const redirect = await get(reset.pathname + reset.search);
    assert.equal(redirect.statusCode, 302);
    const token = new URL(redirect.headers.location).searchParams.get("token");
    assert.ok(token);
    const stored = await pool.query(
      'SELECT "expiresAt" FROM "verification" WHERE identifier = $1',
      [`reset-password:${token}`],
    );
    assert.equal(stored.rowCount, 1);
    const remaining = stored.rows[0].expiresAt.getTime() - Date.now();
    assert.ok(remaining > 840_000 && remaining <= 900_000);
    assert.equal(
      (await post("/reset-password", { token, newPassword })).statusCode,
      200,
    );
    assert.equal((await get(`${base}/get-session`, cookie)).json(), null);
    assert.equal(
      (await post("/reset-password", { token, newPassword: password }))
        .statusCode >= 400,
      true,
    );
    assert.equal((await post("/sign-in/email", creds)).statusCode, 401);

    const limited = await post("/sign-in/email", {
      email,
      password: newPassword,
    });

    assert.equal(limited.statusCode, 429);

    const retryAfter = Number(limited.headers["retry-after"]);
    assert.ok(
      Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 10,
    );

    await delay((retryAfter + 1) * 1000);

    const relogin = await post("/sign-in/email", {
      email,
      password: newPassword,
    });
    assert.equal(relogin.statusCode, 200);
    const newCookies = relogin.headers["set-cookie"];
    assert.ok(newCookies);
    const newCookie = (Array.isArray(newCookies) ? newCookies : [newCookies])
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.equal((await get(`${base}/get-session`, newCookie)).statusCode, 200);
    const logout = await post("/sign-out", {}, { cookie: newCookie });
    assert.equal(logout.statusCode, 200);
    assert.equal((await get(`${base}/get-session`, newCookie)).json(), null);
  } finally {
    try {
      await app?.close();
    } finally {
      await pool.end();
    }
  }
});
