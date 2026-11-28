import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { parseApiConfig } from "../../apps/api/dist/config/api-config.js";
import { createApp } from "../../apps/api/dist/create-app.js";
import {
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
    assert.deepEqual(
      concurrent.map(({ statusCode }) => statusCode),
      [405, 405],
    );
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
