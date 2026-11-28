import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import {
  createAuthHttpRuntime,
  parseAuthConfig,
} from "../../packages/auth/dist/runtime.js";

test("email change HTTP sends two real SMTP messages and consumes links only by POST", async () => {
  const target = new URL(process.env.AUTH_COMPAT_DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: target.href });
  const origin = "http://127.0.0.1:4000";
  const webOrigin = "http://127.0.0.1:3000";
  const mailOrigin = `http://127.0.0.1:${Number(process.env.AUTH_COMPAT_MAILPIT_PORT)}`;
  const config = parseAuthConfig({
    NODE_ENV: "test",
    AUTH_BASE_URL: origin,
    AUTH_WEB_ORIGIN: webOrigin,
    AUTH_SECRET: randomBytes(32).toString("hex"),
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: process.env.AUTH_COMPAT_SMTP_PORT,
    SMTP_SECURITY: "local",
    SMTP_FROM: "auth@movaro.test",
  });
  const runtime = createAuthHttpRuntime(config, target.href);
  const id = randomUUID();
  const email = `${id}@example.test`;
  const newEmail = `${randomUUID()}@example.test`;
  const password = "email-change-test-password";
  const input = { newEmail, locale: "en" };
  const call = (path, body, cookie, requestOrigin = webOrigin) =>
    runtime.handle(
      new Request(`${origin}/api/v1/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin: requestOrigin,
          "content-type": "application/json",
          "x-movaro-client-ip": "192.0.2.192",
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  async function tokenFromMail(recipient) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const list = await fetch(`${mailOrigin}/api/v1/messages`, {
        signal: AbortSignal.timeout(3000),
      });
      const { messages } = await list.json();
      const entry = messages.find((item) =>
        item.To.some((to) => to.Address === recipient),
      );
      if (entry) {
        const response = await fetch(
          `${mailOrigin}/api/v1/message/${entry.ID}`,
          {
            signal: AbortSignal.timeout(3000),
          },
        );
        const { Text } = await response.json();
        const raw = Text.match(/https?:\/\/[^\s]+/)?.[0];
        if (raw?.includes("/email-change-confirmation")) {
          const link = new URL(raw);
          assert.equal(link.origin, webOrigin);
          assert.equal(link.pathname, "/en/email-change-confirmation");
          assert.equal(link.search, "");
          const token = new URLSearchParams(link.hash.slice(1)).get("token");
          assert.match(token, /^[A-Za-z0-9_-]{43}$/);
          return token;
        }
      }
      await delay(100);
    }
    assert.fail("Expected email change message not received");
  }
  try {
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", username) VALUES ($1, $2, $3, true, $4)',
      [id, "Test Driver", email, `em_${id.replaceAll("-", "").slice(0, 20)}`],
    );
    await pool.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date)
       VALUES ($1, 'Test', 'Driver', 'DRIVER', '1998-05-15')`,
      [id],
    );
    await pool.query(
      'INSERT INTO "account" (id, "userId", "providerId", "accountId", password) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), id, "credential", id, await hashPassword(password)],
    );
    const login = await call("/sign-in/email", { email, password });
    assert.equal(login.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.match(cookie, /session_token=/);
    assert.equal((await call("/email/change", input)).status, 401);
    assert.equal(
      (await call("/email/change", input, cookie, "https://untrusted.invalid"))
        .status,
      403,
    );
    assert.equal(
      (await call("/email/change", { ...input, userId: id }, cookie)).status,
      400,
    );
    assert.equal((await call("/email/change/confirm")).status, 405);
    const started = await call("/email/change", input, cookie);
    assert.equal(started.status, 200);
    assert.deepEqual(await started.json(), { stage: "old-sent" });
    assert.equal((await call("/email/change", input, cookie)).status, 429);
    const oldToken = await tokenFromMail(email);
    const confirmedOld = await call("/email/change/confirm", {
      token: oldToken,
    });
    assert.equal(confirmedOld.status, 200);
    assert.deepEqual(await confirmedOld.json(), { stage: "new-sent" });
    assert.equal(
      (await call("/email/change/confirm", { token: oldToken })).status,
      400,
    );
    const current = await call("/get-session", undefined, cookie);
    assert.equal((await current.json()).user.email, email);
    const newToken = await tokenFromMail(newEmail);
    const confirmedNew = await call("/email/change/confirm", {
      token: newToken,
    });
    assert.equal(confirmedNew.status, 200);
    assert.deepEqual(await confirmedNew.json(), { stage: "completed" });
    assert.equal(
      (await call("/email/change/confirm", { token: newToken })).status,
      400,
    );
    const revoked = await call("/get-session", undefined, cookie);
    assert.equal(await revoked.json(), null);
    const newLogin = await call("/sign-in/email", {
      email: newEmail,
      password,
    });
    assert.equal(newLogin.status, 200);
    assert.deepEqual(await newLogin.json(), { success: true });
    const newCookie = newLogin.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const newSession = await call("/get-session", undefined, newCookie);
    assert.equal(newSession.status, 200);
    assert.equal((await newSession.json()).user.id, id);
  } finally {
    await runtime.close();
    await pool.end();
  }
});
