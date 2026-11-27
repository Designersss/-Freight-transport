import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";
import pg from "pg";
import { createEmailAuth } from "../../packages/auth/dist/auth.js";
import { handleEmailRegistration } from "../../packages/auth/dist/registration-email-http.js";
import {
  issueRegistrationEmailProof,
  readRegistrationEmailProof,
} from "../../packages/auth/dist/registration-email-proof.js";
import {
  createAuthHttpRuntime,
  parseAuthConfig,
} from "../../packages/auth/dist/runtime.js";

test("registration creates only the mailbox owner account", async () => {
  const database = new URL(process.env.AUTH_COMPAT_DATABASE_URL);
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: database.href });
  const origin = "http://127.0.0.1:4000";
  const webOrigin = "http://127.0.0.1:3000";
  const secret = randomBytes(32).toString("hex");
  const runtime = createAuthHttpRuntime(
    parseAuthConfig({
      NODE_ENV: "test",
      AUTH_BASE_URL: origin,
      AUTH_WEB_ORIGIN: webOrigin,
      AUTH_SECRET: secret,
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
    const competingPassword = randomBytes(24).toString("hex");
    const competing = await Promise.all([
      call("registration/email/complete", { token, password, registration }),
      call(
        "registration/email/complete",
        { token, password: competingPassword, registration },
        "192.0.2.91",
      ),
    ]);
    const result = competing.find((response) => response.ok);
    assert.ok(result);
    assert.equal(competing.filter((response) => response.ok).length, 1);
    const rejected = competing.find((response) => !response.ok);
    assert.ok(rejected);
    assert.ok([400, 409].includes(rejected.status));
    assert.equal(rejected.headers.get("set-cookie"), null);
    const winnerPassword =
      competing[0] === result ? password : competingPassword;
    const loserPassword =
      competing[0] === result ? competingPassword : password;
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("set-cookie"), null);
    assert.deepEqual(await result.json(), { success: true });
    const after = await pool.query(
      `SELECT u."emailVerified", u.username, p.role,
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
    const duplicateProof = await issueRegistrationEmailProof(pool, email);
    assert.equal(
      (await call("registration/email/read", { token: duplicateProof })).status,
      409,
    );
    const duplicate = await call("registration/email/complete", {
      token: duplicateProof,
      password: untrustedPassword,
      registration: {
        ...registration,
        username: `other_${randomBytes(8).toString("hex")}`,
      },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.headers.get("set-cookie"), null);
    assert.equal(
      (
        await call(
          "sign-in/email",
          { email, password: loserPassword },
          "192.0.2.92",
        )
      ).status,
      401,
    );
    const login = await call("sign-in/email", {
      email,
      password: winnerPassword,
    });
    assert.equal(login.status, 200);
    assert.ok(login.headers.get("set-cookie"));
    // Invalid proofs are charged before lookup; a different source can
    // still confirm. Mapped IPv4 shares the original address budget.
    for (let i = 0; i < 10; i++) {
      const attempt = await call(
        "registration/email/complete",
        { token: "b".repeat(43), password, registration },
        "192.0.2.93",
      );
      assert.equal(attempt.status, 400);
    }
    const limited = await call(
      "registration/email/complete",
      { token: "b".repeat(43), password, registration },
      "::ffff:192.0.2.93",
    );
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    const otherSource = await call(
      "registration/email/complete",
      { token: "b".repeat(43), password, registration },
      "192.0.2.94",
    );
    assert.equal(otherSource.status, 400);

    // Independent links for the same mailbox must not create two accounts.
    const anotherEmail = `${randomBytes(12).toString("hex")}@example.test`;
    const links = await Promise.all([
      issueRegistrationEmailProof(pool, anotherEmail),
      issueRegistrationEmailProof(pool, anotherEmail),
    ]);
    const accounts = links.map((token, index) => ({
      token,
      password: randomBytes(24).toString("hex"),
      registration: {
        ...registration,
        username: `race_${randomBytes(8).toString("hex")}`,
        profile: { ...registration.profile, firstName: `Owner ${index}` },
      },
    }));
    const outcomes = await Promise.all(
      accounts.map((body, index) =>
        call("registration/email/complete", body, `192.0.2.${95 + index}`),
      ),
    );
    assert.deepEqual(outcomes.map(({ status }) => status).sort(), [200, 409]);
    const winner = outcomes[0].ok ? accounts[0] : accounts[1];
    const loser = outcomes[0].ok ? accounts[1] : accounts[0];
    const committed = await pool.query(
      `SELECT u.username, p.first_name
       FROM "user" u JOIN user_profiles p ON p.user_id = u.id
       WHERE u.email = $1`,
      [anotherEmail],
    );
    assert.deepEqual(committed.rows, [
      {
        username: winner.registration.username,
        first_name: winner.registration.profile.firstName,
      },
    ]);
    const losingRead = await call("registration/email/read", {
      token: loser.token,
    });
    assert.equal(losingRead.status, 409);
    const losingLogin = await call(
      "sign-in/email",
      { email: anotherEmail, password: loser.password },
      "192.0.2.97",
    );
    assert.equal(losingLogin.status, 401);
    const winningLogin = await call(
      "sign-in/email",
      { email: anotherEmail, password: winner.password },
      "192.0.2.97",
    );
    assert.equal(winningLogin.status, 200);

    const reader = "192.0.2.98";
    const readerDigest = createHmac("sha256", secret)
      .update(reader)
      .digest("hex");
    // Seed only this synthetic reader's bucket to its last allowed attempt.
    await pool.query(
      `INSERT INTO auth_mail_rate_limits (key, count, expires_at)
       VALUES ($1, 59, now() + interval '1 minute')`,
      [`registration:read:ip:${readerDigest}`],
    );
    const readableEmail = `${randomBytes(12).toString("hex")}@example.test`;
    const readableToken = await issueRegistrationEmailProof(
      pool,
      readableEmail,
    );
    const lastRead = await call(
      "registration/email/read",
      { token: readableToken },
      reader,
    );
    assert.equal(lastRead.status, 200);
    assert.deepEqual(await lastRead.json(), { email: readableEmail });
    const blockedRead = await call(
      "registration/email/read",
      { token: "c".repeat(43) },
      `::ffff:${reader}`,
    );
    assert.equal(blockedRead.status, 429);
    assert.ok(Number(blockedRead.headers.get("retry-after")) > 0);
    const independentRead = await call(
      "registration/email/read",
      { token: readableToken },
      "192.0.2.99",
    );
    assert.equal(independentRead.status, 200);
    assert.equal(
      (
        await call(
          "registration/email/complete",
          { token: "c".repeat(43), password, registration },
          reader,
        )
      ).status,
      400,
    );
  } finally {
    await runtime.close();
    await pool.end();
  }
});

test("failed registration mail preserves earlier proof", async () => {
  const database = new URL(process.env.AUTH_COMPAT_DATABASE_URL);
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: database.href });
  const email = `${randomBytes(12).toString("hex")}@example.test`;
  const config = parseAuthConfig({
    NODE_ENV: "test",
    AUTH_BASE_URL: "http://127.0.0.1:4000",
    AUTH_WEB_ORIGIN: "http://127.0.0.1:3000",
    AUTH_SECRET: randomBytes(32).toString("hex"),
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: process.env.AUTH_COMPAT_SMTP_PORT,
    SMTP_SECURITY: "local",
    SMTP_FROM: "auth@movaro.test",
  });
  const delivered = [];
  // Inject the transport error only in this test. The handler, SQL and
  // auth instance are real; the successful SMTP path is covered by Mailpit.
  const mailer = {
    async send(kind, recipient, url) {
      delivered.push({ kind, recipient, url });
      throw new Error("Synthetic SMTP failure");
    },
  };
  const auth = createEmailAuth(config, pool, mailer);
  const startUrl = new URL(
    "/api/v1/auth/registration/email/start",
    config.AUTH_BASE_URL,
  );
  const start = () =>
    handleEmailRegistration(
      new Request(startUrl, {
        method: "POST",
        headers: {
          origin: config.AUTH_WEB_ORIGIN,
          "content-type": "application/json",
          "x-movaro-client-ip": "192.0.2.100",
        },
        body: JSON.stringify({ email, locale: "en" }),
      }),
      config,
      auth,
      pool,
      mailer,
    );
  try {
    const earlier = await issueRegistrationEmailProof(pool, email);
    const failed = await start();
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { code: "AUTH_REQUEST_FAILED" });
    assert.equal(failed.headers.get("set-cookie"), null);
    assert.equal(delivered.length, 1);
    const message = delivered[0];
    assert.equal(message.kind, "registration-email");
    assert.equal(message.recipient, email);
    const link = new URL(message.url);
    assert.equal(link.origin, config.AUTH_WEB_ORIGIN);
    assert.equal(link.pathname, "/en/signup");
    assert.equal(link.search, "");
    const failedToken = new URLSearchParams(link.hash.slice(1)).get("token");
    assert.ok(failedToken);
    assert.equal(await readRegistrationEmailProof(pool, failedToken), null);
    assert.equal(await readRegistrationEmailProof(pool, earlier), email);
    const users = await pool.query('SELECT id FROM "user" WHERE email = $1', [
      email,
    ]);
    assert.equal(users.rowCount, 0);
    const retry = await start();
    assert.equal(retry.status, 429);
    assert.ok(Number(retry.headers.get("retry-after")) > 0);
    assert.equal(delivered.length, 1);
  } finally {
    try {
      await pool.query(
        "DELETE FROM registration_email_proofs WHERE email = $1",
        [email],
      );
    } finally {
      await pool.end();
    }
  }
});
