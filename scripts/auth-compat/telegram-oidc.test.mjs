import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { hashPassword } from "better-auth/crypto";
import { genericOAuth } from "better-auth/plugins";
import pg from "pg";
import { createAuthOptions } from "../../packages/auth/dist/auth.js";
import { parseAuthConfig } from "../../packages/auth/dist/config.js";
import { handleProfilePhoto } from "../../packages/auth/dist/profile-photo.js";
import { handleTelegramOAuth } from "../../packages/auth/dist/telegram-oauth-http.js";
import {
  createTelegramProvider,
  TELEGRAM_ISSUER,
} from "../../packages/auth/dist/telegram-provider.js";
import { handleTelegramRegistration } from "../../packages/auth/dist/telegram-registration-http.js";
import { handleTelegramSettings } from "../../packages/auth/dist/telegram-settings-http.js";
import {
  internalSession,
  sessionAccess,
  toPublicSession,
} from "../../packages/auth/dist/verified-session.js";

const origin = "http://127.0.0.1:4000";
const base = "/api/v1/auth";
const clientId = "123456789";
const clientSecret = "synthetic-client-secret";

test("Telegram OIDC adapter verifies signed identity, nonce and account ownership", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const wrongKey = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey;
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-rsa" };
  let providerOrigin = "";
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/.well-known/openid-configuration") {
      response.end(
        JSON.stringify({
          issuer: TELEGRAM_ISSUER,
          authorization_endpoint: `${providerOrigin}/auth`,
          token_endpoint: `${providerOrigin}/token`,
          jwks_uri: `${providerOrigin}/jwks`,
          id_token_signing_alg_values_supported: ["RS256"],
        }),
      );
    } else if (request.url === "/jwks") {
      response.end(JSON.stringify({ keys: [jwk] }));
    } else {
      response.statusCode = 404;
      response.end("{}");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  providerOrigin = `http://127.0.0.1:${server.address().port}`;
  const subject = randomBytes(16).toString("hex");
  let nonce = "";
  let challenge = "";
  let token = "";
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  function mint(overrides = {}, key = privateKey) {
    const now = Math.floor(Date.now() / 1000);
    const input = [
      encode({ alg: "RS256", kid: "test-rsa", typ: "JWT" }),
      encode({
        iss: TELEGRAM_ISSUER,
        aud: clientId,
        sub: subject,
        nonce,
        iat: now,
        exp: now + 300,
        name: "Synthetic Telegram User",
        email: "attacker@example.test",
        email_verified: true,
        picture: "https://example.test/ignored.png",
        ...overrides,
      }),
    ].join(".");
    return `${input}.${sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`;
  }
  const config = createTelegramProvider(clientId, clientSecret);
  assert.equal(config.requireIdTokenVerification, true);
  assert.equal(config.disableIdTokenNonceBinding, false);
  assert.equal(config.disableImplicitSignUp, true);
  assert.deepEqual(config.scopes, ["openid", "profile"]);
  const authConfig = parseAuthConfig({
    NODE_ENV: "test",
    AUTH_BASE_URL: origin,
    AUTH_WEB_ORIGIN: origin,
    AUTH_SECRET: randomBytes(32).toString("hex"),
    AUTH_TELEGRAM_CLIENT_ID: clientId,
    AUTH_TELEGRAM_CLIENT_SECRET: clientSecret,
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1025",
    SMTP_SECURITY: "local",
    SMTP_FROM: "auth@movaro.test",
  });
  const auth = betterAuth({
    ...createAuthOptions(authConfig, pool, {
      async send() {
        assert.fail("Telegram must not send email");
      },
    }),
    plugins: [
      genericOAuth({
        config: [
          {
            ...config,
            // Only external network exchange is replaced. Better Auth still
            // performs the real callback, state, nonce, JWKS and DB operations.
            discoveryUrl: `${providerOrigin}/.well-known/openid-configuration`,
            redirectURI: `${origin}/api/auth/telegram/callback`,
            tokenUrl: `${providerOrigin}/token`,
            async getToken({ codeVerifier }) {
              assert.ok(codeVerifier);
              assert.equal(
                createHash("sha256").update(codeVerifier).digest("base64url"),
                challenge,
              );
              return { idToken: token, accessToken: "synthetic-access-token" };
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
  async function begin(requestSignUp = false, sessionCookie = "") {
    const response = await handleTelegramOAuth(
      new Request(`${origin}${base}/telegram/start`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          ...(sessionCookie ? { cookie: sessionCookie } : {}),
        },
        body: JSON.stringify({
          intent: sessionCookie ? "link" : requestSignUp ? "register" : "login",
          locale: "en",
        }),
      }),
      authConfig,
      auth,
      pool,
    );
    assert.equal(response.status, 200);
    const url = new URL((await response.json()).url);
    nonce = url.searchParams.get("nonce");
    challenge = url.searchParams.get("code_challenge");
    assert.ok(nonce);
    assert.ok(challenge);
    assert.ok(url.searchParams.get("state"));
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    return {
      url,
      cookies: [sessionCookie, cookie(response)].filter(Boolean).join("; "),
    };
  }
  async function callback(flow, state = flow.url.searchParams.get("state")) {
    const url = new URL(flow.url.searchParams.get("redirect_uri"));
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, "/api/auth/telegram/callback");
    url.pathname = `${base}/telegram/callback`;
    url.searchParams.set("code", "synthetic-code");
    url.searchParams.set("state", state);
    const result = await handleTelegramOAuth(
      new Request(url, { headers: { cookie: flow.cookies } }),
      authConfig,
      auth,
      pool,
    );
    assert.equal(result.status, 303);
    return result;
  }
  async function session(response) {
    const result = await auth.handler(
      new Request(`${origin}${base}/get-session`, {
        headers: { cookie: cookie(response) },
      }),
    );
    assert.equal(result.status, 200);
    return result.json();
  }
  async function reject(flow, state) {
    const result = await callback(flow, state);
    assert.match(
      result.headers.get("location") ?? "",
      /\/login\?telegram=error$/,
    );
    assert.equal(await session(result), null);
  }

  try {
    await assert.rejects(async () => {
      const invalid = createTelegramProvider("not-a-client", "secret");
      return invalid;
    });
    let flow = await begin();
    token = mint();
    await reject(flow); // Unknown identity may not silently sign up.

    flow = await begin(true);
    token = mint();
    await reject(flow, "tampered-state");
    for (const overrides of [
      { iss: "https://untrusted.invalid" },
      { aud: "987654321" },
      { exp: Math.floor(Date.now() / 1000) - 300 },
      { nonce: "different-nonce" },
      { nonce: undefined },
    ]) {
      flow = await begin(true);
      token = mint(overrides);
      await reject(flow);
    }
    flow = await begin(true);
    token = mint({}, wrongKey);
    await reject(flow);

    flow = await begin(true);
    token = mint();
    const first = await callback(flow);
    assert.equal(first.headers.get("location"), `${origin}/en/cabinet`);
    const created = await session(first);
    assert.ok(created?.user.id);
    assert.equal(created.user.emailVerified, false);
    assert.equal(
      created.user.email,
      `${createHash("sha256").update(subject).digest("hex")}@telegram.invalid`,
    );
    assert.ok(!created.user.image);
    const identity = internalSession.parse(created);
    assert.equal(await sessionAccess(pool, authConfig, identity), "onboarding");
    const publicView = toPublicSession(identity, "onboarding");
    assert.equal(publicView.user.email, null);
    assert.equal(publicView.user.emailVerified, false);
    assert.ok(!("id" in publicView.session));
    const registration = {
      username: `tg_${subject.slice(0, 20)}`,
      profile: {
        firstName: "Telegram",
        lastName: "Driver",
        role: "DRIVER",
        birthDate: "1996-02-29",
      },
    };
    const complete = await handleTelegramRegistration(
      new Request(`${origin}${base}/telegram/registration`, {
        method: "POST",
        headers: {
          origin,
          cookie: cookie(first),
          "content-type": "application/json",
        },
        body: JSON.stringify(registration),
      }),
      authConfig,
      auth,
      pool,
    );
    assert.equal(complete.status, 200);
    assert.equal(await sessionAccess(pool, authConfig, identity), "active");
    // Authorization must precede all storage operations. This test double
    // fails on any access; the real S3 success flow is exercised elsewhere.
    const noStorageAccess = {
      async getProfilePhoto() {
        assert.fail("Unexpected photo read");
      },
      async putProfilePhoto() {
        assert.fail("Unexpected photo write");
      },
    };
    const photoRequest = (sessionCookie, method) =>
      handleProfilePhoto(
        new Request(`${origin}${base}/profile/photo`, {
          method,
          headers: {
            cookie: sessionCookie,
            origin,
            ...(method === "POST" ? { "content-type": "image/png" } : {}),
          },
          ...(method === "POST" ? { body: new Uint8Array([0]) } : {}),
        }),
        authConfig,
        auth,
        pool,
        noStorageAccess,
      );
    for (const method of ["GET", "POST", "DELETE"]) {
      const denied = await photoRequest(cookie(first), method);
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), { code: "AUTH_REQUEST_FAILED" });
    }
    const photoState = await pool.query(
      "SELECT photo_key FROM user_profiles WHERE user_id = $1",
      [created.user.id],
    );
    assert.equal(photoState.rows[0].photo_key, null);
    const photoReservations = await pool.query(
      "SELECT key FROM profile_photo_cleanup WHERE owner_id = $1",
      [created.user.id],
    );
    assert.equal(photoReservations.rowCount, 0);
    await reject(flow); // Consumed state cannot be replayed.

    const previousToken = token;
    flow = await begin();
    token = previousToken;
    await reject(flow); // Old signed token cannot authorize a fresh nonce.
    flow = await begin();
    token = mint();
    const again = await callback(flow);
    assert.equal((await session(again)).user.id, created.user.id);
    const accounts = await pool.query(
      'SELECT "accountId", "userId", "accessToken", "refreshToken", "idToken" FROM "account" WHERE "providerId" = $1 AND "accountId" = $2',
      ["telegram", subject],
    );
    assert.deepEqual(accounts.rows, [
      {
        accountId: subject,
        userId: created.user.id,
        accessToken: null,
        refreshToken: null,
        idToken: null,
      },
    ]);
    const emailUser = randomBytes(16).toString("hex");
    const email = `${emailUser}@example.test`;
    const password = "synthetic-password";
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", username) VALUES ($1, $2, $3, true, $4)',
      [emailUser, "Email Driver", email, `em_${emailUser.slice(0, 20)}`],
    );
    await pool.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date)
       VALUES ($1, 'Email', 'Driver', 'DRIVER', '1998-05-15')`,
      [emailUser],
    );
    await pool.query(
      'INSERT INTO "account" (id, "userId", "providerId", "accountId", password) VALUES ($1, $2, $3, $4, $5)',
      [
        randomBytes(16).toString("hex"),
        emailUser,
        "credential",
        emailUser,
        await hashPassword(password),
      ],
    );
    const emailLogin = await auth.handler(
      new Request(`${origin}${base}/sign-in/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      }),
    );
    assert.equal(emailLogin.status, 200);
    const emailCookie = cookie(emailLogin);
    flow = await begin(false, emailCookie);
    token = mint(); // Already belongs to Telegram-only user.
    const conflict = await callback(flow);
    assert.equal(
      conflict.headers.get("location"),
      `${origin}/en/account?telegram=link-error`,
    );
    const newSubject = randomBytes(16).toString("hex");
    flow = await begin(false, emailCookie);
    token = mint({ sub: newSubject });
    const linked = await callback(flow);
    assert.equal(linked.headers.get("location"), `${origin}/en/account`);
    const owners = await pool.query(
      'SELECT "userId" FROM "account" WHERE "providerId" = $1 AND "accountId" = $2',
      ["telegram", newSubject],
    );
    assert.deepEqual(owners.rows, [{ userId: emailUser }]);
    flow = await begin();
    token = mint({ sub: newSubject });
    const viaTelegram = await callback(flow);
    const linkedSession = await session(viaTelegram);
    assert.equal(linkedSession.user.id, emailUser);
    assert.equal(linkedSession.user.email, email);
    assert.equal(linkedSession.user.emailVerified, true);
    assert.equal(linkedSession.user.name, "Email Driver");
    // A linked Telegram login is still eligible if the account's real email
    // is verified. No photo yet is 404, not an authorization denial.
    const photo = await photoRequest(cookie(viaTelegram), "GET");
    assert.equal(photo.status, 404);
    assert.deepEqual(await photo.json(), { code: "NOT_FOUND" });
    const provenance = await pool.query(
      'SELECT s."telegramAccountId", a."accountId" FROM "session" s JOIN "account" a ON a.id = s."telegramAccountId" WHERE s.id = $1',
      [linkedSession.session.id],
    );
    assert.equal(provenance.rows[0].accountId, newSubject);
    const refused = await handleTelegramSettings(
      new Request(`${origin}${base}/telegram/settings`, {
        method: "POST",
        headers: {
          origin,
          cookie: emailCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ action: "unlink" }),
      }),
      authConfig,
      auth,
      pool,
    );
    assert.equal(refused.status, 405);
    const raw = await auth.handler(
      new Request(`${origin}${base}/unlink-account`, {
        method: "POST",
        headers: {
          origin,
          cookie: emailCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          accountId: provenance.rows[0].telegramAccountId,
        }),
      }),
    );
    assert.equal(raw.status, 403);
    assert.equal((await session(viaTelegram)).user.id, emailUser);

    await assert.rejects(
      pool.query(
        'INSERT INTO "account" (id, "providerId", "accountId", "userId") VALUES ($1, $2, $3, $4)',
        [
          randomBytes(16).toString("hex"),
          "telegram",
          randomBytes(16).toString("hex"),
          created.user.id,
        ],
      ),
      (error) =>
        error.code === "23514" &&
        error.constraint === "account_telegram_link_guard",
    );
  } finally {
    try {
      await pool.end();
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
