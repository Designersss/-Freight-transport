import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import {
  createAuthHttpRuntime,
  parseAuthConfig,
} from "../../packages/auth/dist/runtime.js";
import { issueRegistrationEmailProof } from "../../packages/auth/dist/registration-email-proof.js";

test("registration creates only the mailbox owner account", async () => {
  const database = new URL(process.env.AUTH_COMPAT_DATABASE_URL);
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: database.href });
  const origin = "http://127.0.0.1:4000";
  const webOrigin = "http://127.0.0.1:3000";
  const runtime = createAuthHttpRuntime(
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
    database.href,
  );
  const email = `${randomBytes(12).toString("hex")}@example.test`;
  const password = randomBytes(24).toString("hex");
  const registration = {
    username: `owner_${randomBytes(8).toString("hex")}`,
    profile: {
      firstName: "Mailbox",
      lastName: "Owner",
      role: "DRIVER",
      birthDate: "1998-05-15",
    },
  };
  const call = (path, body, ip = "192.0.2.90") =>
    runtime.handle(
      new Request(`${origin}/api/v1/auth/${path}`, {
        method: "POST",
        headers: {
          origin: webOrigin,
          "content-type": "application/json",
          "x-movaro-client-ip": ip,
        },
        body: JSON.stringify(body),
      }),
    );
  try {
    const untrustedPassword = randomBytes(24).toString("hex");
    assert.equal(
      (
        await call("sign-up/email", {
          email,
          password: untrustedPassword,
          registration,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call("registration/email/complete", {
          token: "a".repeat(43),
          password,
          registration,
        })
      ).status,
      400,
    );
    const token = await issueRegistrationEmailProof(pool, email);
    const read = await call("registration/email/read", { token });
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { email });
    assert.equal(read.headers.get("set-cookie"), null);
    const before = await pool.query('SELECT id FROM "user" WHERE email = $1', [
      email,
    ]);
    assert.equal(before.rowCount, 0);
    const result = await call("registration/email/complete", {
      token,
      password,
      registration,
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("set-cookie"), null);
    assert.deepEqual(await result.json(), { success: true });
    const after = await pool.query(
      `SELECT u."emailVerified", u.username, u."registrationDraft", p.role,
         p.first_name, a."registrationProofHash", a."registrationProfile"
       FROM "user" u JOIN user_profiles p ON p.user_id = u.id
       JOIN "account" a ON a."userId" = u.id AND a."providerId" = 'credential'
       WHERE u.email = $1`,
      [email],
    );
    assert.deepEqual(after.rows, [
      {
        emailVerified: true,
        username: registration.username,
        registrationDraft: null,
        role: "DRIVER",
        first_name: "Mailbox",
        registrationProofHash: null,
        registrationProfile: null,
      },
    ]);
    assert.equal(
      (await call("registration/email/read", { token })).status,
      400,
    );
    assert.equal(
      (
        await call("registration/email/complete", {
          token,
          password: untrustedPassword,
          registration,
        })
      ).status,
      400,
    );
    assert.equal(
      (await call("sign-in/email", { email, password: untrustedPassword }))
        .status,
      401,
    );
    const login = await call("sign-in/email", { email, password });
    assert.equal(login.status, 200);
    assert.ok(login.headers.get("set-cookie"));
  } finally {
    await runtime.close();
    await pool.end();
  }
});
