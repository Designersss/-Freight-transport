import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { parseApiConfig } from "../../apps/api/dist/config/api-config.js";
import { createApp } from "../../apps/api/dist/create-app.js";
import { issueRegistrationEmailProof } from "../../packages/auth/dist/registration-email-proof.js";
import {
  createAuthHttpRuntime,
  parseAuthConfig,
  parseStorageConfig,
} from "../../packages/auth/dist/runtime.js";
import { PrivateStorage } from "../../packages/storage/dist/index.js";

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
    const entries = messages.filter((message) =>
      message.To.some((to) => to.Address === email),
    );
    for (const entry of entries) {
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
  const storageConfig = parseStorageConfig(process.env);
  assert.equal(new URL(storageConfig.S3_ENDPOINT).hostname, "127.0.0.1");
  const storage = new PrivateStorage(storageConfig);
  const photoKeys = new Set();
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
      storageConfig,
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
    const profile = {
      firstName: "Test",
      lastName: "Driver",
      role: "DRIVER",
      birthDate: "1998-05-15",
    };
    const signup = {
      token: "a".repeat(43),
      password,
      registration: {
        profile,
        username: `driver_${randomBytes(8).toString("hex")}`,
      },
    };
    for (const invalid of [
      creds,
      { ...creds, name: "Test" },
      { ...signup, name: "Test" },
      { ...signup, image: "https://example.test/photo.png" },
      {
        ...signup,
        registration: { ...signup.registration, photo: "test-photo" },
      },
      {
        ...signup,
        registration: {
          ...signup.registration,
          profile: { ...profile, photoKey: "test-photo" },
        },
      },
      { ...signup, registration: { profile } },
      { ...signup, registration: { username: signup.registration.username } },
    ]) {
      assert.equal(
        (await post("/registration/email/complete", invalid)).statusCode,
        400,
      );
    }
    const beforeSignup = await pool.query(
      'SELECT id FROM "user" WHERE email = $1',
      [email],
    );
    assert.equal(beforeSignup.rowCount, 0);
    for (const invalidPassword of ["12345", "a".repeat(129)]) {
      assert.equal(
        (await post("/sign-in/email", { email, password: invalidPassword }))
          .statusCode,
        400,
      );
      assert.equal(
        (
          await post("/registration/email/complete", {
            ...signup,
            password: invalidPassword,
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
        await post("/registration/email/complete", {
          ...signup,
          role: "PLATFORM_ADMIN",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await post("/registration/email/start", {
          email: "someone@telegram.invalid",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await post("/registration/email/complete", signup, {
          origin: "https://untrusted.invalid",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await post("/update-user", { role: "PLATFORM_ADMIN" })).statusCode,
      404,
    );
    assert.equal(
      (await post("/registration/email/start", { email })).statusCode,
      200,
    );
    const unverified = await post("/sign-in/email", creds);
    assert.equal(unverified.statusCode, 401);
    assert.equal(unverified.json().code, "INVALID_CREDENTIALS");
    assert.equal(unverified.headers["set-cookie"], undefined);
    assert.equal((await get(`${base}/profile`)).statusCode, 401);
    const blockedMail = await post("/registration/email/start", {
      email: email.toUpperCase(),
    });
    assert.equal(blockedMail.statusCode, 429);
    assert.ok(Number(blockedMail.headers["retry-after"]) > 0);
    const concurrentEmail = `${randomBytes(12).toString("hex")}@example.test`;
    const simultaneous = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        fastify.inject({
          method: "POST",
          url: `${base}/registration/email/start`,
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
    const verification = await mailLink(mailOrigin, email, "/signup#token=");
    assert.equal(verification.origin, webOrigin);
    assert.equal(verification.pathname, "/ru/signup");
    assert.equal(verification.search, "");
    const proof = new URLSearchParams(verification.hash.slice(1)).get("token");
    assert.ok(proof);
    const readProof = await post("/registration/email/read", { token: proof });
    assert.equal(readProof.statusCode, 200);
    assert.deepEqual(readProof.json(), { email });
    assert.equal(readProof.headers["set-cookie"], undefined);
    const pending = await pool.query('SELECT id FROM "user" WHERE email = $1', [
      email,
    ]);
    assert.equal(pending.rowCount, 0);
    const complete = await post("/registration/email/complete", {
      ...signup,
      token: proof,
    });
    assert.equal(complete.statusCode, 200);
    assert.equal(complete.headers["set-cookie"], undefined);
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
    assert.equal((await get(profilePath)).statusCode, 401);
    const obsolete = await post("/profile", profile);
    assert.equal(obsolete.statusCode, 405);
    assert.equal(obsolete.headers.allow, "GET");
    const saved = { ...profile, companyName: null };
    const read = await get(profilePath, cookie);
    assert.equal(read.statusCode, 200);
    assert.deepEqual(read.json(), saved);
    assert.equal(session.json().user.name, "Test Driver");
    const photoPath = `${base}/profile/photo`;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGUlEQVR4nGPUiKpgIAUwkaR6VMOohiGlAQAvmQEab3goXgAAAABJRU5ErkJggg==",
      "base64",
    );
    const uploadPhoto = (payload, extra = {}) =>
      fastify.inject({
        method: "POST",
        url: photoPath,
        payload,
        headers: {
          cookie,
          origin: webOrigin,
          "content-type": "image/png",
          ...extra,
        },
      });
    const readKey = async () => {
      const result = await pool.query(
        "SELECT photo_key FROM user_profiles WHERE user_id = $1",
        [session.json().user.id],
      );
      const key = result.rows[0].photo_key;
      if (key) photoKeys.add(key);
      return key;
    };
    assert.equal((await get(photoPath)).statusCode, 401);
    assert.equal((await get(photoPath, cookie)).statusCode, 404);
    assert.equal(await readKey(), null);
    assert.equal(
      (await uploadPhoto(png, { origin: "https://untrusted.invalid" }))
        .statusCode,
      403,
    );
    assert.equal(
      (await uploadPhoto(Buffer.alloc(2 * 1024 * 1024 + 1))).statusCode,
      413,
    );
    assert.equal(
      (await uploadPhoto("not an image", { "content-type": "text/plain" }))
        .statusCode,
      415,
    );
    assert.equal((await uploadPhoto(Buffer.from([0]))).statusCode, 400);
    assert.equal(await readKey(), null);
    const uploaded = await uploadPhoto(png);
    assert.equal(uploaded.statusCode, 200);
    assert.deepEqual(uploaded.json(), { success: true });
    const firstKey = await readKey();
    assert.match(firstKey, /^profile-photos\//);
    const fetched = await get(photoPath, cookie);
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.headers["content-type"], "image/jpeg");
    assert.equal(fetched.headers["cache-control"], "private, no-store");
    assert.equal(fetched.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(
      fetched.rawPayload,
      Buffer.from((await storage.getProfilePhoto(firstKey)).bytes),
    );
    assert.equal(
      (await get(`${photoPath}?userId=another-user`, cookie)).statusCode,
      400,
    );
    assert.equal((await uploadPhoto(png)).statusCode, 200);
    const secondKey = await readKey();
    assert.notEqual(firstKey, secondKey);
    assert.equal(
      (
        await fastify.inject({
          method: "DELETE",
          url: photoPath,
          headers: { cookie, origin: "https://untrusted.invalid" },
        })
      ).statusCode,
      403,
    );
    const removed = await fastify.inject({
      method: "DELETE",
      url: photoPath,
      headers: { cookie, origin: webOrigin },
    });
    assert.equal(removed.statusCode, 200);
    assert.deepEqual(removed.json(), { success: true });
    assert.equal(await readKey(), null);
    assert.equal((await get(photoPath, cookie)).statusCode, 404);
    const retired = await pool.query(
      "SELECT key FROM profile_photo_cleanup WHERE key = ANY($1::text[]) AND owner_id IS NULL",
      [[firstKey, secondKey]],
    );
    assert.equal(retired.rowCount, 2);
    const settings = await get(`${base}/username/settings`, cookie);
    assert.equal(settings.statusCode, 200);
    assert.deepEqual(settings.json(), {
      username: signup.registration.username,
      nextChangeAt: null,
    });
    assert.equal(
      (await get(`${profilePath}?userId=another-user`, cookie)).statusCode,
      400,
    );
    for (const payload of [
      profile,
      { ...profile, role: "PLATFORM_ADMIN" },
      { ...profile, role: "COMPANY_OWNER", companyName: "Test Equipment" },
    ]) {
      const response = await post("/profile", payload, { cookie });
      assert.equal(response.statusCode, 405);
      assert.equal(response.headers.allow, "GET");
    }
    const concurrent = await Promise.all([
      post("/profile", profile, { cookie }),
      post("/profile", { ...profile, role: "DISPATCHER" }, { cookie }),
    ]);
    assert.deepEqual(concurrent.map(({ statusCode }) => statusCode), [405, 405]);
    assert.deepEqual((await get(profilePath, cookie)).json(), saved);
    const personal = {
      firstName: " Updated ",
      lastName: "Driver",
      birthDate: "1996-02-29",
    };
    assert.equal((await post("/profile/settings", personal)).statusCode, 401);
    assert.equal(
      (
        await post("/profile/settings", personal, {
          cookie,
          origin: "https://untrusted.invalid",
        })
      ).statusCode,
      403,
    );
    for (const invalid of [
      { ...personal, role: "PLATFORM_ADMIN" },
      { ...personal, userId: "another-user" },
      { ...personal, username: "other_name" },
      { ...personal, email: "other@example.test" },
      { ...personal, companyName: "Other company" },
      { ...personal, photoKey: "test-photo" },
      { ...personal, status: "DEACTIVATED" },
      { ...personal, firstName: " " },
      { ...personal, birthDate: "1999-02-29" },
      { ...personal, birthDate: "9999-12-31" },
    ]) {
      assert.equal(
        (await post("/profile/settings", invalid, { cookie })).statusCode,
        400,
      );
    }
    assert.deepEqual((await get(profilePath, cookie)).json(), saved);
    const changedProfile = await post("/profile/settings", personal, {
      cookie,
    });
    assert.equal(changedProfile.statusCode, 200);
    const expectedProfile = {
      ...saved,
      firstName: "Updated",
      birthDate: personal.birthDate,
    };
    assert.deepEqual(changedProfile.json(), expectedProfile);
    assert.deepEqual((await get(profilePath, cookie)).json(), expectedProfile);
    const updatedSession = await get(`${base}/get-session`, cookie);
    assert.equal(updatedSession.json().user.name, "Updated Driver");
    assert.equal(updatedSession.json().user.email, email);
    const usernameUnchanged = await get(`${base}/username/settings`, cookie);
    assert.deepEqual(usernameUnchanged.json(), settings.json());
    // Reproduce a correction after the original profile creation date.
    // Yesterday remains valid even when the test crosses UTC midnight.
    const correctionDate = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    await pool.query(
      `UPDATE user_profiles SET created_at = $2::date::timestamp AT TIME ZONE 'UTC' - interval '1 day'
       WHERE user_id = $1`,
      [session.json().user.id, correctionDate],
    );
    const correction = await post(
      "/profile/settings",
      { ...personal, birthDate: correctionDate },
      { cookie },
    );
    assert.equal(correction.statusCode, 200);
    assert.equal(correction.json().birthDate, correctionDate);
    assert.deepEqual((await get(profilePath, cookie)).json(), {
      ...expectedProfile,
      birthDate: correctionDate,
    });
    const restoredProfile = await post(
      "/profile/settings",
      {
        firstName: profile.firstName,
        lastName: profile.lastName,
        birthDate: profile.birthDate,
      },
      { cookie },
    );
    assert.deepEqual(restoredProfile.json(), saved);

    const passwordChange = {
      currentPassword: password,
      newPassword,
    };
    assert.equal(
      (await post("/change-password", passwordChange)).statusCode,
      401,
    );
    assert.equal(
      (
        await post("/change-password", passwordChange, {
          cookie,
          origin: "https://untrusted.invalid",
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await post(
          "/change-password",
          { ...passwordChange, revokeOtherSessions: false },
          { cookie },
        )
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await post(
          "/change-password",
          { ...passwordChange, newPassword: "12345" },
          { cookie },
        )
      ).statusCode,
      400,
    );
    const userId = session.json().user.id;
    await pool.query(
      'UPDATE "user" SET "emailVerified" = false WHERE id = $1',
      [userId],
    );
    try {
      assert.equal((await get(profilePath, cookie)).statusCode, 403);
      assert.equal(
        (await post("/profile/settings", personal, { cookie })).statusCode,
        403,
      );
      assert.equal(
        (await post("/change-password", passwordChange, { cookie })).statusCode,
        403,
      );
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
        (await post("/profile/settings", personal, { cookie })).statusCode,
        403,
      );
      assert.equal(
        (await post("/profile", profile, { cookie })).statusCode,
        405,
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
      try {
        for (const key of photoKeys) await storage.deleteProfilePhoto(key);
        await pool.query(
          `DELETE FROM profile_photo_cleanup
           WHERE key = ANY($1::text[]) OR owner_id IN (
             SELECT id FROM "user" WHERE email = $2
           )`,
          [[...photoKeys], email],
        );
      } finally {
        storage.close();
        await pool.end();
      }
    }
  }
});

test("verified registration atomically claims one username", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const email = `${randomBytes(12).toString("hex")}@example.test`;
  const otherEmail = `${randomBytes(12).toString("hex")}@example.test`;
  const password = randomBytes(24).toString("hex");
  const username = `test_${randomBytes(8).toString("hex")}`;
  const profile = {
    firstName: "Test",
    lastName: "Owner",
    role: "COMPANY_OWNER",
    companyName: "Test Equipment",
    birthDate: "1996-02-29",
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
  try {
    const token = await issueRegistrationEmailProof(pool, email);
    const otherToken = await issueRegistrationEmailProof(pool, otherEmail);
    const signup = { token, password, registration };
    for (const invalid of [
      { ...registration, username: "admin" },
      { ...registration, username: "@bad" },
      { ...registration, profile: { ...profile, role: "PLATFORM_ADMIN" } },
      { ...registration, profile: { ...profile, companyName: "" } },
      { ...registration, profile: { ...profile, birthDate: undefined } },
      { ...registration, profile: { ...profile, birthDate: "1997-02-29" } },
      { ...registration, profile: { ...profile, birthDate: "9999-12-31" } },
    ]) {
      const result = await call("/registration/email/complete", {
        ...signup,
        registration: invalid,
      });
      assert.equal(result.status, 400);
    }
    for (const invalidProfile of [
      { ...profile, firstName: " " },
      { ...profile, driverAge: 30 },
      { ...profile, photoKey: "test-photo" },
      { ...profile, photo: "test-photo" },
      { ...profile, image: "https://example.test/photo.png" },
      { ...profile, companyName: undefined },
      { ...profile, role: "DRIVER", companyName: "Other company" },
      { ...profile, role: "DISPATCHER", companyName: "Other company" },
      { ...profile, role: "COMPANY_OWNER", companyName: " " },
      { ...profile, userId: "another-user" },
      { ...profile, status: "ACTIVE" },
    ]) {
      const invalid = await call("/registration/email/complete", {
        ...signup,
        registration: { ...registration, profile: invalidProfile },
      });
      assert.equal(invalid.status, 400);
    }
    const validProof = await call("/registration/email/read", { token });
    assert.equal(validProof.status, 200);
    assert.deepEqual(await validProof.json(), { email });
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
      call("/registration/email/complete", signup),
      call(
        "/registration/email/complete",
        {
          ...signup,
          token: otherToken,
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
      'SELECT id, username, "emailVerified" FROM "user" WHERE email IN ($1, $2)',
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
    assert.equal(user.emailVerified, true);
    const profileRows = () =>
      pool.query("SELECT role FROM user_profiles WHERE user_id = $1", [
        user.id,
      ]);
    assert.equal((await profileRows()).rowCount, 1);
    assert.equal((await profileRows()).rows[0].role, profile.role);
    const credentials = { email: winner, password };
    assert.equal((await call("/profile")).status, 401);
    const anonymous = await call("/get-session");
    assert.equal(anonymous.status, 200);
    assert.equal(await anonymous.json(), null);

    // Username conflict rolls back the losing user, leaving their proof usable.
    const loser = winner === email ? otherEmail : email;
    const loserToken = winner === email ? otherToken : token;
    const remainingProof = await call("/registration/email/read", {
      token: loserToken,
    });
    assert.equal(remainingProof.status, 200);
    assert.deepEqual(await remainingProof.json(), { email: loser });
    const winningToken = winner === email ? token : otherToken;
    assert.equal(
      (await call("/registration/email/read", { token: winningToken })).status,
      400,
    );
    const duplicateName = `other_${randomBytes(8).toString("hex")}`;
    const duplicateProof = await issueRegistrationEmailProof(pool, winner);
    const duplicate = await call(
      "/registration/email/complete",
      {
        ...signup,
        token: duplicateProof,
        registration: {
          username: duplicateName,
          profile: { ...profile, firstName: "Changed" },
        },
      },
      undefined,
      "192.0.2.52",
    );
    assert.equal(duplicate.status, 409);
    const unchanged = await pool.query(
      'SELECT id, username FROM "user" WHERE email = $1 OR username = $2',
      [winner, duplicateName],
    );
    assert.equal(unchanged.rowCount, 1);
    assert.equal(unchanged.rows[0].id, user.id);
    assert.equal(unchanged.rows[0].username, username);

    const [login, simultaneousLogin] = await Promise.all([
      call("/sign-in/email", credentials),
      call("/sign-in/email", credentials, undefined, "192.0.2.54"),
    ]);
    assert.equal(login.status, 200);
    assert.equal(simultaneousLogin.status, 200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.match(cookie, /session_token=/);
    const read = await call("/profile", undefined, cookie);
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), profile);
    assert.equal((await profileRows()).rowCount, 1);
    const session = await call("/get-session", undefined, cookie);
    assert.equal(session.status, 200);
    const data = await session.json();
    assert.equal(data.user.id, user.id);
    assert.equal(data.user.birthDate, undefined);
    assert.equal(data.user.username, undefined);
    const relogin = await call("/sign-in/email", credentials);
    assert.equal(relogin.status, 200);
    assert.equal((await profileRows()).rowCount, 1);

    const settingsPath = "/username/settings";
    const getSettings = () => call(settingsPath, undefined, cookie);
    const change = (name) => call(settingsPath, { username: name }, cookie);
    assert.equal((await call(settingsPath)).status, 401);
    assert.equal(
      (await call(settingsPath, { username: "unauthorized" })).status,
      401,
    );
    const initial = await getSettings();
    assert.equal(initial.status, 200);
    assert.deepEqual(await initial.json(), { username, nextChangeAt: null });
    const noop = await change(username.toUpperCase());
    assert.equal(noop.status, 200);
    assert.deepEqual(await noop.json(), { username, nextChangeAt: null });

    const occupied = `occupied_${randomBytes(8).toString("hex")}`;
    await pool.query(
      'INSERT INTO "user" (id, name, email, username) VALUES ($1, $2, $3, $4)',
      [
        randomBytes(16).toString("hex"),
        "Other",
        `${occupied}@example.test`,
        occupied,
      ],
    );
    const conflictChange = await change(occupied);
    assert.equal(conflictChange.status, 409);
    assert.deepEqual(await conflictChange.json(), { code: "USERNAME_TAKEN" });
    assert.deepEqual(await (await getSettings()).json(), {
      username,
      nextChangeAt: null,
    });
    const invalidChange = await call(
      settingsPath,
      { username: "valid_name", userId: "other" },
      cookie,
    );
    assert.equal(invalidChange.status, 400);

    const alternatives = [`${username}a`, `${username}b`];
    const changes = await Promise.all(alternatives.map(change));
    assert.deepEqual(changes.map(({ status }) => status).sort(), [200, 409]);
    const successful = changes.find(({ status }) => status === 200);
    const blocked = changes.find(({ status }) => status === 409);
    assert.ok(successful);
    assert.ok(blocked);
    const updated = await successful.json();
    assert.ok(alternatives.includes(updated.username));
    const savedChange = await pool.query(
      'SELECT username_changed_at, username FROM "user" WHERE id = $1',
      [user.id],
    );
    assert.equal(savedChange.rows[0].username, updated.username);
    assert.equal(
      Date.parse(updated.nextChangeAt) -
        savedChange.rows[0].username_changed_at.getTime(),
      168 * 60 * 60 * 1000,
    );
    assert.deepEqual(await blocked.json(), {
      code: "USERNAME_CHANGE_COOLDOWN",
      nextChangeAt: updated.nextChangeAt,
    });
    assert.deepEqual(await (await getSettings()).json(), updated);
    assert.deepEqual(await (await change(updated.username)).json(), updated);
    const deniedChange = await change(username);
    assert.equal(deniedChange.status, 409);
    assert.deepEqual(await deniedChange.json(), {
      code: "USERNAME_CHANGE_COOLDOWN",
      nextChangeAt: updated.nextChangeAt,
    });

    // Adjust only the isolated test user's clock state, not the application.
    await pool.query(
      `UPDATE "user" SET username_changed_at = clock_timestamp() - interval '168 hours'
       WHERE id = $1`,
      [user.id],
    );
    const eligible = await getSettings();
    assert.equal(eligible.status, 200);
    assert.deepEqual(await eligible.json(), {
      username: updated.username,
      nextChangeAt: null,
    });
    const afterCooldown = await change(username);
    assert.equal(afterCooldown.status, 200);
    assert.equal((await afterCooldown.json()).username, username);
    const sessionsPath = "/sessions";
    const listSessions = () => call(sessionsPath, undefined, cookie);
    assert.equal((await call(sessionsPath)).status, 401);
    assert.equal(
      (await call(sessionsPath, { action: "revokeOthers" })).status,
      401,
    );
    const foreignUser = await pool.query(
      'SELECT id FROM "user" WHERE username = $1',
      [occupied],
    );
    assert.equal(foreignUser.rowCount, 1);
    const foreignSessionId = randomBytes(16).toString("hex");
    const expiredSessionId = randomBytes(16).toString("hex");
    await pool.query(
      `INSERT INTO "session" (id, "userId", token, "expiresAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, now() + interval '1 hour', now(), now()),
              ($4, $5, $6, now() - interval '1 hour', now(), now())`,
      [
        foreignSessionId,
        foreignUser.rows[0].id,
        randomBytes(32).toString("hex"),
        expiredSessionId,
        user.id,
        randomBytes(32).toString("hex"),
      ],
    );
    for (const id of [foreignSessionId, expiredSessionId]) {
      const denied = await call(sessionsPath, { action: "revoke", id }, cookie);
      assert.equal(denied.status, 404);
      assert.deepEqual(await denied.json(), { code: "SESSION_NOT_FOUND" });
    }
    const foreignRequest = await runtime.handle(
      new Request(`${origin}${base}${sessionsPath}`, {
        method: "POST",
        headers: {
          origin: "https://untrusted.invalid",
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ action: "revokeOthers" }),
      }),
    );
    assert.equal(foreignRequest.status, 403);
    assert.equal((await call("/list-sessions", undefined, cookie)).status, 404);
    assert.equal(
      (await call("/revoke-session", { token: "secret" }, cookie)).status,
      404,
    );
    const listed = await listSessions();
    assert.equal(listed.status, 200);
    const active = await listed.json();
    assert.equal(active.hasMore, false);
    assert.equal(active.sessions.length, 3);
    assert.equal(active.sessions[0].current, true);
    assert.ok(
      active.sessions.every(
        ({ id }) => id !== foreignSessionId && id !== expiredSessionId,
      ),
    );
    const untouched = await pool.query(
      'SELECT id FROM "session" WHERE id = $1',
      [foreignSessionId],
    );
    assert.equal(untouched.rowCount, 1);
    for (const entry of active.sessions) {
      assert.deepEqual(Object.keys(entry).sort(), [
        "createdAt",
        "current",
        "expiresAt",
        "id",
        "userAgent",
      ]);
      assert.ok(Date.parse(entry.expiresAt) > Date.now());
    }
    const currentId = active.sessions[0].id;
    const currentRevoke = await call(
      sessionsPath,
      { action: "revoke", id: currentId },
      cookie,
    );
    assert.equal(currentRevoke.status, 409);
    assert.equal(
      (
        await call(
          sessionsPath,
          { action: "revoke", id: "missing-session" },
          cookie,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await call(
          sessionsPath,
          { action: "revokeOthers", userId: user.id },
          cookie,
        )
      ).status,
      400,
    );
    const thirdCookie = relogin.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const thirdList = await call(sessionsPath, undefined, thirdCookie);
    assert.equal(thirdList.status, 200);
    const thirdId = (await thirdList.json()).sessions[0].id;
    assert.notEqual(thirdId, currentId);
    const ended = await call(
      sessionsPath,
      { action: "revoke", id: thirdId },
      cookie,
    );
    assert.equal(ended.status, 200);
    assert.deepEqual(await ended.json(), { success: true });
    const thirdRevoked = await call("/get-session", undefined, thirdCookie);
    assert.equal(thirdRevoked.status, 200);
    assert.equal(await thirdRevoked.json(), null);
    assert.equal((await (await listSessions()).json()).sessions.length, 2);

    const retained = await call("/profile", undefined, cookie);
    assert.deepEqual(await retained.json(), profile);
    assert.equal((await profileRows()).rowCount, 1);

    await pool.query(
      "UPDATE user_profiles SET status = 'DEACTIVATED' WHERE user_id = $1",
      [user.id],
    );
    assert.equal((await getSettings()).status, 403);
    assert.equal((await change(username)).status, 403);
    assert.equal((await listSessions()).status, 403);
    assert.equal(
      (await call(sessionsPath, { action: "revokeOthers" }, cookie)).status,
      403,
    );
    const sessionCount = async () =>
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM "session" WHERE "userId" = $1',
          [user.id],
        )
      ).rows[0].count;
    const beforeBlockedLogin = await sessionCount();
    assert.equal((await call("/get-session", undefined, cookie)).status, 403);
    const blockedLogin = await call(
      "/sign-in/email",
      credentials,
      undefined,
      "192.0.2.77",
    );
    assert.equal(blockedLogin.status, 401);
    assert.deepEqual(await blockedLogin.json(), {
      code: "INVALID_CREDENTIALS",
    });
    assert.equal(blockedLogin.headers.get("set-cookie"), null);
    assert.equal(await sessionCount(), beforeBlockedLogin);

    await pool.query(
      "UPDATE user_profiles SET status = 'ACTIVE', role = 'PLATFORM_ADMIN', company_name = NULL WHERE user_id = $1",
      [user.id],
    );
    assert.equal((await call("/get-session", undefined, cookie)).status, 403);
    assert.equal((await call("/profile", undefined, cookie)).status, 403);
    const adminLogin = await call(
      "/sign-in/email",
      credentials,
      undefined,
      "192.0.2.78",
    );
    assert.equal(adminLogin.status, 401);
    assert.deepEqual(await adminLogin.json(), { code: "INVALID_CREDENTIALS" });
    assert.equal(adminLogin.headers.get("set-cookie"), null);
    assert.equal(await sessionCount(), beforeBlockedLogin);
    await pool.query(
      "UPDATE user_profiles SET role = 'COMPANY_OWNER', company_name = $2, status = 'DEACTIVATED' WHERE user_id = $1",
      [user.id, profile.companyName],
    );

    const replacementPassword = randomBytes(24).toString("hex");
    const passwordChange = {
      currentPassword: password,
      newPassword: replacementPassword,
    };
    assert.equal(
      (await call("/change-password", passwordChange, cookie)).status,
      403,
    );
    await pool.query(
      "UPDATE user_profiles SET status = 'ACTIVE' WHERE user_id = $1",
      [user.id],
    );
    const wrongPassword = await call(
      "/change-password",
      { ...passwordChange, currentPassword: "wrong-password" },
      cookie,
    );
    assert.equal(wrongPassword.status, 400);
    assert.deepEqual(await wrongPassword.json(), {
      code: "INVALID_CURRENT_PASSWORD",
    });
    assert.equal((await getSettings()).status, 200);
    const changedPassword = await call(
      "/change-password",
      passwordChange,
      cookie,
    );
    assert.equal(changedPassword.status, 200);
    assert.deepEqual(await changedPassword.json(), { success: true });
    const rotatedCookie = changedPassword.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.match(rotatedCookie, /session_token=/);
    assert.notEqual(rotatedCookie, cookie);
    const otherCookie = simultaneousLogin.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    for (const revoked of [cookie, otherCookie]) {
      const result = await call("/get-session", undefined, revoked);
      assert.equal(result.status, 200);
      assert.equal(await result.json(), null);
    }
    assert.equal(
      (await call("/profile", undefined, rotatedCookie)).status,
      200,
    );
    const extraLogin = await call(
      "/sign-in/email",
      { ...credentials, password: replacementPassword },
      undefined,
      "192.0.2.56",
    );
    assert.equal(extraLogin.status, 200);
    const extraCookie = extraLogin.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const bulk = await call(
      sessionsPath,
      { action: "revokeOthers" },
      rotatedCookie,
    );
    assert.equal(bulk.status, 200);
    assert.deepEqual(await bulk.json(), { success: true });
    const remaining = await call(sessionsPath, undefined, rotatedCookie);
    assert.equal(remaining.status, 200);
    assert.equal((await remaining.json()).sessions.length, 1);
    const extraRevoked = await call("/get-session", undefined, extraCookie);
    assert.equal(extraRevoked.status, 200);
    assert.equal(await extraRevoked.json(), null);
    assert.equal((await call("/sign-out", {}, rotatedCookie)).status, 200);
    assert.equal((await getSettings()).status, 401);
    const oldLogin = await call(
      "/sign-in/email",
      credentials,
      undefined,
      "192.0.2.55",
    );
    assert.equal(oldLogin.status, 401);
    const newLogin = await call(
      "/sign-in/email",
      { ...credentials, password: replacementPassword },
      undefined,
      "192.0.2.55",
    );
    assert.equal(newLogin.status, 200);
    assert.equal((await change(username)).status, 401);

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
