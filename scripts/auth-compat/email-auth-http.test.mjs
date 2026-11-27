import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { parseApiConfig } from "../../apps/api/dist/config/api-config.js";
import { createApp } from "../../apps/api/dist/create-app.js";
import {
  createAuthHttpRuntime,
  parseAuthConfig,
} from "../../packages/auth/dist/runtime.js";

const origin = "http://127.0.0.1:4000";
const webOrigin = "http://127.0.0.1:3000";
const base = "/api/v1/auth";

async function mailLink(mailOrigin, email, fragment) {
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
      const detail = `${mailOrigin}/api/v1/message/${entry.ID}`;
      const message = await fetch(detail, {
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(message.status, 200);
      const { Text } = await message.json();
      const link = Text.match(/https?:\/\/[^\s]+/)?.[0];
      if (link?.includes(fragment)) return new URL(link);
    }
    await delay(100);
  }
  assert.fail("Expected SMTP message not received");
}

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
    assert.equal((await get(`${base}/profile`)).statusCode, 401);
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
    const verification = await mailLink(mailOrigin, email, "/verify-email?");
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
    const profilePath = `${base}/profile`;
    const profile = {
      firstName: "Test",
      lastName: "Driver",
      role: "DRIVER",
    };
    assert.equal((await get(profilePath)).statusCode, 401);
    assert.equal((await post("/profile", profile)).statusCode, 401);
    const missingProfile = await get(profilePath, cookie);
    assert.equal(missingProfile.statusCode, 200);
    assert.equal(missingProfile.json(), null);
    assert.equal(
      (await get(`${profilePath}?userId=another-user`, cookie)).statusCode,
      400,
    );
    for (const invalidProfile of [
      { ...profile, role: "PLATFORM_ADMIN" },
      { ...profile, firstName: " " },
      { ...profile, driverAge: 0 },
      { ...profile, role: "COMPANY_OWNER", driverAge: 30 },
      { ...profile, companyName: "Other company" },
      { ...profile, role: "DISPATCHER", companyName: "Other company" },
      { ...profile, role: "COMPANY_OWNER", companyName: " " },
      { ...profile, userId: "another-user" },
      { ...profile, status: "ACTIVE" },
    ]) {
      assert.equal(
        (await post("/profile", invalidProfile, { cookie })).statusCode,
        400,
      );
    }
    assert.equal(
      (
        await post("/profile", profile, {
          cookie,
          origin: "https://untrusted.invalid",
        })
      ).statusCode,
      403,
    );
    const competing = await Promise.all([
      post("/profile", profile, { cookie }),
      post(
        "/profile",
        { ...profile, role: "DISPATCHER", driverAge: 30 },
        { cookie },
      ),
    ]);
    assert.deepEqual(
      competing.map(({ statusCode }) => statusCode).sort(),
      [201, 409],
    );
    const created = competing.find(({ statusCode }) => statusCode === 201);
    assert.ok(created);
    const saved = created.json();
    assert.ok(["DRIVER", "DISPATCHER"].includes(saved.role));
    assert.deepEqual(saved, {
      firstName: "Test",
      lastName: "Driver",
      role: saved.role,
      driverAge: saved.role === "DISPATCHER" ? 30 : null,
      companyName: null,
    });
    const read = await get(profilePath, cookie);
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json(), saved);
    assert.equal(
      (
        await post(
          "/profile",
          { ...profile, role: "COMPANY_OWNER" },
          { cookie },
        )
      ).statusCode,
      409,
    );
    assert.deepEqual((await get(profilePath, cookie)).json(), saved);
    const userId = session.json().user.id;
    await pool.query(
      'UPDATE "user" SET "emailVerified" = false WHERE id = $1',
      [userId],
    );
    try {
      assert.equal((await get(profilePath, cookie)).statusCode, 403);
    } finally {
      await pool.query(
        'UPDATE "user" SET "emailVerified" = true WHERE id = $1',
        [userId],
      );
    }
    await pool.query(
      "UPDATE user_profiles SET status = 'DEACTIVATED' WHERE user_id = $1",
      [userId],
    );
    try {
      assert.equal((await get(profilePath, cookie)).statusCode, 403);
      assert.equal(
        (await post("/profile", profile, { cookie })).statusCode,
        403,
      );
    } finally {
      await pool.query(
        "UPDATE user_profiles SET status = 'ACTIVE' WHERE user_id = $1",
        [userId],
      );
    }
    assert.equal(
      (await post("/request-password-reset", { email })).statusCode,
      200,
    );
    assert.equal(
      (await post("/request-password-reset", { email })).statusCode,
      429,
    );
    const reset = await mailLink(mailOrigin, email, "/reset-password/");
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
    assert.equal((await get(profilePath, newCookie)).statusCode, 401);
  } finally {
    try {
      await app?.close();
    } finally {
      await pool.end();
    }
  }
});

test("registration draft survives verification and reserves one username", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const mailPort = Number(process.env.AUTH_COMPAT_MAILPIT_PORT);
  assert.ok(Number.isInteger(mailPort) && mailPort > 0);
  const mailOrigin = `http://127.0.0.1:${mailPort}`;
  const email = `${randomBytes(12).toString("hex")}@example.test`;
  const otherEmail = `${randomBytes(12).toString("hex")}@example.test`;
  const password = randomBytes(24).toString("hex");
  const username = `test_${randomBytes(8).toString("hex")}`;
  const profile = {
    firstName: "Test",
    lastName: "Owner",
    role: "COMPANY_OWNER",
    companyName: "Test Equipment",
  };
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
  const runtime = createAuthHttpRuntime(config, databaseUrl);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const call = (path, body, cookie, ip = "192.0.2.50") =>
    runtime.handle(
      new Request(`${origin}${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin: webOrigin,
          "content-type": "application/json",
          "x-movaro-client-ip": ip,
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  const registration = { profile, username };
  const signup = { email, password, name: "Test", registration };
  try {
    for (const invalid of [
      { ...registration, username: "admin" },
      { ...registration, username: "@bad" },
      { ...registration, profile: { ...profile, role: "PLATFORM_ADMIN" } },
      { ...registration, profile: { ...profile, companyName: "" } },
    ]) {
      const result = await call("/sign-up/email", {
        ...signup,
        registration: invalid,
      });
      assert.equal(result.status, 400);
    }
    const check = (name) =>
      call("/username", { action: "check", username: name });
    const suggestion = (firstName, lastName) =>
      call("/username", { action: "suggest", firstName, lastName });
    const foreign = await runtime.handle(
      new Request(`${origin}${base}/username`, {
        method: "POST",
        headers: {
          origin: "https://untrusted.invalid",
          "content-type": "application/json",
          "x-movaro-client-ip": "192.0.2.50",
        },
        body: JSON.stringify({ action: "check", username }),
      }),
    );
    assert.equal(foreign.status, 403);
    assert.equal((await call("/username")).status, 405);
    const invalid = await call("/username", {
      action: "check",
      username,
      userId: "other",
    });
    assert.equal(invalid.status, 400);
    const available = await check(username.toUpperCase());
    assert.equal(available.status, 200);
    assert.deepEqual(await available.json(), { available: true });
    assert.equal(available.headers.get("cache-control"), "no-store");
    assert.equal((await check("admin")).status, 400);
    const cyrillic = await suggestion("Иван", "Петров");
    assert.equal(cyrillic.status, 200);
    assert.deepEqual(await cyrillic.json(), { username: "ivan_petrov" });
    const latin = await suggestion("Émile", "Dubois");
    assert.equal(latin.status, 200);
    assert.deepEqual(await latin.json(), { username: "emile_dubois" });
    const fallback = await suggestion("王", "小明");
    assert.equal(fallback.status, 200);
    assert.match((await fallback.json()).username, /^[a-z][a-z0-9_]{2,31}$/);

    const competing = await Promise.all([
      call("/sign-up/email", signup),
      call(
        "/sign-up/email",
        {
          ...signup,
          email: otherEmail,
          registration: { ...registration, username: username.toUpperCase() },
        },
        undefined,
        "192.0.2.51",
      ),
    ]);
    assert.deepEqual(competing.map(({ status }) => status).sort(), [200, 409]);
    const winner = competing[0].status === 200 ? email : otherEmail;
    const conflict = competing.find(({ status }) => status === 409);
    assert.ok(conflict);
    assert.deepEqual(await conflict.json(), { code: "USERNAME_TAKEN" });
    const accepted = competing.find(({ status }) => status === 200);
    assert.ok(accepted);
    assert.deepEqual(await accepted.json(), { success: true });
    assert.equal(accepted.headers.get("set-cookie"), null);
    const stored = await pool.query(
      'SELECT id, username, "registrationDraft", "emailVerified" FROM "user" WHERE email IN ($1, $2)',
      [email, otherEmail],
    );
    assert.equal(stored.rowCount, 1);
    const user = stored.rows[0];
    assert.equal(user.username, username);
    const taken = await check(username.toUpperCase());
    assert.equal(taken.status, 200);
    assert.deepEqual(await taken.json(), { available: false });
    const [first, last] = username.split("_");
    const next = await suggestion(first, last);
    assert.equal(next.status, 200);
    assert.deepEqual(await next.json(), { username: `${username}2` });
    assert.equal(user.emailVerified, false);
    assert.deepEqual(JSON.parse(user.registrationDraft), profile);
    const profileRows = () =>
      pool.query("SELECT role FROM user_profiles WHERE user_id = $1", [
        user.id,
      ]);
    assert.equal((await profileRows()).rowCount, 0);
    const credentials = { email: winner, password };
    const unverified = await call("/sign-in/email", credentials);
    assert.equal(unverified.status, 403);
    assert.equal(unverified.headers.get("set-cookie"), null);
    assert.equal((await call("/profile")).status, 401);
    const anonymous = await call("/get-session");
    assert.equal(anonymous.status, 200);
    assert.equal(await anonymous.json(), null);

    // Advance only this isolated recipient's minute bucket to exercise
    // Better Auth's duplicate-email behavior without waiting a real minute.
    const digest = createHmac("sha256", config.AUTH_SECRET)
      .update(winner)
      .digest("hex");
    await pool.query(
      "UPDATE auth_mail_rate_limits SET expires_at = now() - interval '1 second' WHERE key = $1",
      [`recipient:verification:${digest}:minute`],
    );
    const duplicateName = `other_${randomBytes(8).toString("hex")}`;
    const duplicate = await call(
      "/sign-up/email",
      {
        ...signup,
        email: winner,
        registration: {
          username: duplicateName,
          profile: { ...profile, firstName: "Changed" },
        },
      },
      undefined,
      "192.0.2.52",
    );
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { success: true });
    const unchanged = await pool.query(
      'SELECT id, username, "registrationDraft" FROM "user" WHERE email = $1 OR username = $2',
      [winner, duplicateName],
    );
    assert.equal(unchanged.rowCount, 1);
    assert.equal(unchanged.rows[0].id, user.id);
    assert.equal(unchanged.rows[0].username, username);
    assert.deepEqual(JSON.parse(unchanged.rows[0].registrationDraft), profile);

    const verification = await mailLink(mailOrigin, winner, "/verify-email?");
    const verified = await runtime.handle(new Request(verification));
    assert.equal(verified.status, 302);
    assert.equal(verified.headers.get("set-cookie"), null);
    assert.equal((await profileRows()).rowCount, 0);
    const login = await call("/sign-in/email", credentials);
    assert.equal(login.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.match(cookie, /session_token=/);
    const read = await call("/profile", undefined, cookie);
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { ...profile, driverAge: null });
    assert.equal((await profileRows()).rowCount, 1);
    const finished = await pool.query(
      'SELECT "registrationDraft" FROM "user" WHERE id = $1',
      [user.id],
    );
    assert.equal(finished.rows[0].registrationDraft, null);
    const session = await call("/get-session", undefined, cookie);
    assert.equal(session.status, 200);
    const data = await session.json();
    assert.equal(data.user.id, user.id);
    assert.equal(data.user.registrationDraft, undefined);
    assert.equal(data.user.username, undefined);
    const relogin = await call("/sign-in/email", credentials);
    assert.equal(relogin.status, 200);
    assert.equal((await profileRows()).rowCount, 1);

    const rateDigest = createHmac("sha256", config.AUTH_SECRET)
      .update("192.0.2.50")
      .digest("hex");
    await pool.query(
      "UPDATE auth_mail_rate_limits SET count = 59, expires_at = now() + interval '1 minute' WHERE key = $1",
      [`username:ip:${rateDigest}`],
    );
    const limited = await Promise.all([check(username), check(username)]);
    assert.deepEqual(limited.map(({ status }) => status).sort(), [200, 429]);
    const denied = limited.find(({ status }) => status === 429);
    assert.ok(denied);
    assert.ok(Number(denied.headers.get("retry-after")) > 0);
    assert.deepEqual(await denied.json(), { code: "RATE_LIMITED" });
    const otherIp = await call(
      "/username",
      { action: "check", username },
      undefined,
      "192.0.2.53",
    );
    assert.equal(otherIp.status, 200);
  } finally {
    try {
      await runtime.close();
    } finally {
      await pool.end();
    }
  }
});
