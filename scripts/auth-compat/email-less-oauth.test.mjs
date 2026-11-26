import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { genericOAuth } from "better-auth/plugins";
import pg from "pg";

const origin = "http://127.0.0.1:4000";
const basePath = "/api/v1/auth";
const reservedDomain = "telegram.invalid";

// Compatibility fixture only. The upstream OAuth provider is simulated;
// no Telegram credentials, real accounts or production route are involved.
test("OAuth identity without email: mapped internal identifier and stable account", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const providerId = "email-less-compat";
  const unmappedProviderId = "unmapped-compat";
  const subject = randomBytes(16).toString("hex");
  const secondSubject = randomBytes(16).toString("hex");
  const internalEmail = (id) =>
    `${createHash("sha256").update(id).digest("hex")}@${reservedDomain}`;
  const fixture = {
    authorizationUrl: "https://provider.invalid/authorize",
    clientId: "test-client",
    clientSecret: "test-secret",
    pkce: true,
    async getToken({ code, codeVerifier }) {
      assert.ok(codeVerifier, "PKCE verifier must be provided");
      assert.ok([subject, secondSubject].includes(code));
      return { accessToken: code };
    },
    async getUserInfo({ accessToken }) {
      assert.ok([subject, secondSubject].includes(accessToken));
      return { id: accessToken, name: "OAuth test user" };
    },
  };
  const auth = betterAuth({
    baseURL: origin,
    basePath,
    secret: randomBytes(32).toString("hex"),
    database: pool,
    trustedOrigins: [origin],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    account: { accountLinking: { disableImplicitLinking: true } },
    session: { cookieCache: { enabled: false } },
    plugins: [
      genericOAuth({
        config: [
          { ...fixture, providerId: unmappedProviderId },
          {
            ...fixture,
            providerId,
            mapProfileToUser(profile) {
              assert.equal(typeof profile.id, "string");
              return { email: internalEmail(profile.id), emailVerified: false };
            },
          },
        ],
      }),
    ],
  });
  const cookie = (response) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
  const post = (path, body) =>
    auth.handler(
      new Request(origin + basePath + path, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  async function begin(provider) {
    const response = await post("/sign-in/social", {
      provider,
      callbackURL: `${origin}/dashboard`,
      requestSignUp: true,
    });
    assert.equal(response.status, 200);
    const redirect = new URL((await response.json()).url);
    assert.ok(redirect.searchParams.get("state"));
    assert.ok(redirect.searchParams.get("code_challenge"));
    return { redirect, cookies: cookie(response) };
  }
  async function callback(
    flow,
    code,
    state = flow.redirect.searchParams.get("state"),
  ) {
    const target = new URL(flow.redirect.searchParams.get("redirect_uri"));
    assert.equal(target.origin, origin);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
    const response = await auth.handler(
      new Request(target, {
        headers: { cookie: flow.cookies },
      }),
    );
    assert.equal(response.status, 302);
    return response;
  }
  async function session(response) {
    const result = await auth.handler(
      new Request(`${origin + basePath}/get-session`, {
        headers: { cookie: cookie(response) },
      }),
    );
    assert.equal(result.status, 200);
    return result.json();
  }
  try {
    const migrations = await getMigrations(auth.options);
    await migrations.runMigrations();

    const unmapped = await callback(await begin(unmappedProviderId), subject);
    assert.match(
      unmapped.headers.get("location") ?? "",
      /error=email_not_found/,
    );

    const flow = await begin(providerId);
    const tampered = await callback(flow, subject, "tampered-state");
    assert.match(tampered.headers.get("location") ?? "", /error=/);

    const first = await callback(await begin(providerId), subject);
    assert.equal(first.headers.get("location"), `${origin}/dashboard`);
    const firstSession = await session(first);
    assert.ok(firstSession?.user.id);
    assert.equal(firstSession.user.email, internalEmail(subject));
    assert.equal(firstSession.user.emailVerified, false);

    const again = await callback(await begin(providerId), subject);
    assert.equal((await session(again)).user.id, firstSession.user.id);

    const other = await callback(await begin(providerId), secondSubject);
    const otherSession = await session(other);
    assert.notEqual(otherSession.user.id, firstSession.user.id);
    assert.equal(otherSession.user.emailVerified, false);

    const accounts = await pool.query(
      'SELECT "accountId", "userId" FROM "account" WHERE "providerId" = $1',
      [providerId],
    );
    assert.equal(accounts.rowCount, 2);
    assert.deepEqual(
      new Map(accounts.rows.map((row) => [row.accountId, row.userId])),
      new Map([
        [subject, firstSession.user.id],
        [secondSubject, otherSession.user.id],
      ]),
    );

    const passwordAttempt = await post("/sign-in/email", {
      email: internalEmail(subject),
      password: randomBytes(24).toString("hex"),
    });
    assert.ok([401, 403].includes(passwordAttempt.status));
    const credentials = await pool.query(
      'SELECT id FROM "account" WHERE "userId" = $1 AND "providerId" = $2',
      [firstSession.user.id, "credential"],
    );
    assert.equal(credentials.rowCount, 0);
  } finally {
    await pool.end();
  }
});
