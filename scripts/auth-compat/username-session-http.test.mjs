import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { issueRegistrationEmailProof } from "../../packages/auth/dist/registration-email-proof.js";
import {
  createAuthHttpRuntime,
  parseAuthConfig,
} from "../../packages/auth/dist/runtime.js";

const origin = "http://127.0.0.1:4000";
const webOrigin = "http://127.0.0.1:3000";
const base = "/api/v1/auth";

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
