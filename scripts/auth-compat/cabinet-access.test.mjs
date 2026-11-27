import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import {
  createAuthHttpRuntime,
  parseAuthConfig,
} from "../../packages/auth/dist/runtime.js";

test("public cabinets require a live completed profile of the exact role", async () => {
  const target = new URL(process.env.AUTH_COMPAT_DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: target.href });
  const origin = "http://127.0.0.1:4000";
  const webOrigin = "http://127.0.0.1:3000";
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
  const password = "cabinet-access-test-password";
  const passwordHash = await hashPassword(password);
  const roles = [
    ["COMPANY_OWNER", "/cabinet/company-owner"],
    ["DISPATCHER", "/cabinet/dispatcher"],
    ["DRIVER", "/cabinet/driver"],
  ];

  const call = (path, cookie, body, ip = "192.0.2.201") =>
    runtime.handle(
      new Request(`${origin}/api/v1/auth${path}`, {
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

  async function createIdentity(role, ip) {
    const id = randomUUID();
    const email = `${id}@example.test`;
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", username) VALUES ($1, $2, $3, true, $4)',
      [id, "Test User", email, `rb_${id.replaceAll("-", "").slice(0, 20)}`],
    );
    if (role)
      await pool.query(
        `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date, company_name)
         VALUES ($1, 'Test', 'User', $2, '1998-05-15', $3)`,
        [id, role, role === "COMPANY_OWNER" ? "Test Equipment" : null],
      );
    await pool.query(
      'INSERT INTO "account" (id, "userId", "providerId", "accountId", password) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), id, "credential", id, passwordHash],
    );
    const login = await call(
      "/sign-in/email",
      undefined,
      { email, password },
      ip,
    );
    return {
      id,
      login,
      cookie: login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  }
  try {
    for (const [, path] of roles) {
      assert.equal((await call(path)).status, 401);
    }
    for (const [index, [role, ownPath]] of roles.entries()) {
      const ip = `192.0.2.${210 + index}`;
      const { id, login, cookie } = await createIdentity(role, ip);
      assert.equal(login.status, 200);
      assert.match(cookie, /session_token=/);
      for (const [required, path] of roles) {
        const result = await call(path, cookie, undefined, ip);
        assert.equal(result.status, role === required ? 200 : 403);
        if (role === required) assert.deepEqual(await result.json(), { role });
      }
      assert.equal(
        (await call(`${ownPath}?role=PLATFORM_ADMIN`, cookie, undefined, ip))
          .status,
        400,
      );
      assert.equal(
        (await call(ownPath, cookie, { role: "PLATFORM_ADMIN" }, ip)).status,
        405,
      );
      assert.equal(
        (await call("/cabinet/admin", cookie, undefined, ip)).status,
        404,
      );
      await pool.query(
        "UPDATE user_profiles SET status = 'DEACTIVATED' WHERE user_id = $1",
        [id],
      );
      assert.equal((await call(ownPath, cookie, undefined, ip)).status, 403);
      await pool.query(
        "UPDATE user_profiles SET status = 'ACTIVE' WHERE user_id = $1",
        [id],
      );
      await pool.query('DELETE FROM "session" WHERE "userId" = $1', [id]);
      assert.equal((await call(ownPath, cookie, undefined, ip)).status, 401);
    }
    const incomplete = await createIdentity(null, "192.0.2.220");
    assert.equal(incomplete.login.status, 200);
    assert.equal(
      (
        await call(
          "/cabinet/driver",
          incomplete.cookie,
          undefined,
          "192.0.2.220",
        )
      ).status,
      403,
    );
    const admin = await createIdentity("PLATFORM_ADMIN", "192.0.2.221");
    assert.equal(admin.login.status, 401);
    assert.equal(admin.cookie, "");
  } finally {
    await runtime.close();
    await pool.end();
  }
});
