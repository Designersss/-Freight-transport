import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { createAdminAuth } from "../../packages/auth/dist/admin-auth.js";
import { createAuthOptions } from "../../packages/auth/dist/auth.js";
import { parseAuthConfig } from "../../packages/auth/dist/config.js";
import { telegramLoginContext } from "../../packages/auth/dist/telegram-link-context.js";

const authRequire = createRequire(
  new URL("../../packages/auth/dist/auth.js", import.meta.url),
);
const { betterAuth } = await import(
  pathToFileURL(authRequire.resolve("better-auth")).href
);
const { APIError, createAuthEndpoint } = await import(
  pathToFileURL(authRequire.resolve("better-auth/api")).href
);
const { setSessionCookie } = await import(
  pathToFileURL(authRequire.resolve("better-auth/cookies")).href
);

const origin = "https://web.example.test";
const base = "/api/v1/auth";
const adminOrigin = "https://admin.example.test";
const endpoint = "/test-only/telegram-bot-session";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const identifier = (proof) => `telegram-bot-spike:${digest(proof)}`;

// This plugin exists only in the isolated compatibility suite. The fixture
// represents an already approved browser grant, not a real Telegram update.
// No production route, public client or runtime module imports this file.
function approvedGrantPlugin() {
  return {
    id: "telegram-bot-session-spike",
    endpoints: {
      finishBotSession: createAuthEndpoint(
        endpoint,
        { method: "POST" },
        async (ctx) => {
          if (ctx.headers?.get("origin") !== origin)
            throw new APIError("FORBIDDEN");
          const proof = ctx.getCookie("movaro-spike");
          if (!proof || !/^[A-Za-z0-9_-]{43}$/.test(proof))
            throw new APIError("UNAUTHORIZED");
          const adapter = ctx.context.internalAdapter;
          const grant = await adapter.consumeVerificationValue(
            identifier(proof),
          );
          if (!grant) throw new APIError("UNAUTHORIZED");

          const user = await adapter.findUserById(grant.value);
          if (!user || !/^[0-9a-f]{64}@telegram\.invalid$/.test(user.email))
            throw new APIError("FORBIDDEN");
          const session = await telegramLoginContext.run(
            { providerEmail: user.email },
            () => adapter.createSession(user.id),
          );
          if (!session) throw new APIError("FORBIDDEN");
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ success: true });
        },
      ),
    },
  };
}

test("Bot-approved single-use grant issues a native scoped Better Auth session", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl);
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const config = parseAuthConfig({
    NODE_ENV: "test",
    AUTH_BASE_URL: origin,
    AUTH_WEB_ORIGIN: origin,
    AUTH_ADMIN_ORIGIN: adminOrigin,
    AUTH_SECRET: randomBytes(32).toString("hex"),
    AUTH_ADMIN_SECRET: randomBytes(32).toString("hex"),
    // Only the existing Telegram identity guard is enabled. The spike
    // replaces the OIDC plugin and never contacts the external provider.
    AUTH_TELEGRAM_CLIENT_ID: "123456789",
    AUTH_TELEGRAM_CLIENT_SECRET: "synthetic-client-secret",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1025",
    SMTP_SECURITY: "local",
    SMTP_FROM: "auth@movaro.test",
  });
  const options = createAuthOptions(config, pool, {
    async send() {
      assert.fail("Bot session issuance must not send email");
    },
  });
  const auth = betterAuth({ ...options, plugins: [approvedGrantPlugin()] });
  const peer = betterAuth({ ...options, plugins: [approvedGrantPlugin()] });
  const admin = createAdminAuth(config, pool);
  assert.ok(admin);

  async function seedIdentity({ linked = true, inactive = false } = {}) {
    const userId = randomUUID();
    const accountId = randomUUID();
    const subject = String(randomBytes(6).readUIntBE(0, 6));
    const email = `${digest(subject)}@telegram.invalid`;
    const username = inactive
      ? `tg_${randomUUID().replaceAll("-", "").slice(0, 20)}`
      : null;
    await pool.query(
      'INSERT INTO "user" (id, name, email, "emailVerified", username) VALUES ($1, $2, $3, false, $4)',
      [userId, "Synthetic Telegram User", email, username],
    );
    if (linked) {
      await pool.query(
        'INSERT INTO "account" (id, "userId", "providerId", "accountId") VALUES ($1, $2, $3, $4)',
        [accountId, userId, "telegram", subject],
      );
    }
    if (inactive) {
      await pool.query(
        `INSERT INTO user_profiles (user_id, first_name, last_name, role, birth_date, status)
         VALUES ($1, 'Synthetic', 'Driver', 'DRIVER', '1990-01-01', 'DEACTIVATED')`,
        [userId],
      );
    }
    return { userId, accountId };
  }

  async function grant(userId, ttl = 300_000) {
    const proof = randomBytes(32).toString("base64url");
    const context = await auth.$context;
    await context.internalAdapter.createVerificationValue({
      identifier: identifier(proof),
      value: userId,
      expiresAt: new Date(Date.now() + ttl),
    });
    return proof;
  }

  function finish(instance, proof, ip, requestOrigin = origin) {
    return instance.handler(
      new Request(`${origin}${base}${endpoint}`, {
        method: "POST",
        headers: {
          origin: requestOrigin,
          cookie: `movaro-spike=${proof}`,
          "x-movaro-client-ip": ip,
        },
      }),
    );
  }

  function sessionCookie(response) {
    return response.headers
      .getSetCookie()
      .find((value) => value.startsWith("__Secure-better-auth.session_token="));
  }

  async function sessionCount(userId) {
    const result = await pool.query(
      'SELECT count(*)::int AS count FROM "session" WHERE "userId" = $1',
      [userId],
    );
    return result.rows[0].count;
  }

  async function readSession(cookie, instance = auth, path = base) {
    const response = await instance.handler(
      new Request(`${origin}${path}/get-session`, {
        headers: { cookie, "x-movaro-client-ip": "198.51.100.220" },
      }),
    );
    assert.equal(response.status, 200);
    return response.json();
  }

  try {
    const owner = await seedIdentity();
    const proof = await grant(owner.userId);

    const unrelated = await finish(
      auth,
      randomBytes(32).toString("base64url"),
      "198.51.100.201",
    );
    assert.equal(unrelated.status, 401);
    assert.equal(sessionCookie(unrelated), undefined);
    const crossOrigin = await finish(
      auth,
      proof,
      "198.51.100.202",
      "https://untrusted.example.test",
    );
    assert.equal(crossOrigin.status, 403);
    assert.equal(sessionCookie(crossOrigin), undefined);
    assert.equal(await sessionCount(owner.userId), 0);

    const competing = await Promise.all([
      finish(auth, proof, "198.51.100.203"),
      finish(peer, proof, "198.51.100.204"),
    ]);
    assert.deepEqual(
      competing.map((response) => response.status).sort(),
      [200, 401],
    );
    const success = competing.find((response) => response.ok);
    assert.ok(success);
    assert.deepEqual(await success.json(), { success: true });
    const issued = sessionCookie(success);
    assert.ok(issued);
    assert.match(issued, /;\s*Secure(?:;|$)/i);
    assert.match(issued, /;\s*HttpOnly(?:;|$)/i);
    assert.match(issued, /;\s*SameSite=Lax(?:;|$)/i);
    assert.doesNotMatch(issued, /;\s*Domain=/i);
    const cookie = issued.split(";")[0];

    const current = await readSession(cookie);
    assert.equal(current?.user.id, owner.userId);
    assert.equal(current?.user.emailVerified, false);
    assert.equal(await sessionCount(owner.userId), 1);
    const stored = await pool.query(
      'SELECT "telegramAccountId", "adminSession" FROM "session" WHERE "userId" = $1',
      [owner.userId],
    );
    assert.deepEqual(stored.rows, [
      { telegramAccountId: owner.accountId, adminSession: false },
    ]);
    assert.equal(await readSession(cookie, admin, `${base}/admin`), null);
    const renamed = cookie.replace(
      "__Secure-better-auth.session_token=",
      "__Secure-movaro-admin.session_token=",
    );
    assert.equal(await readSession(renamed, admin, `${base}/admin`), null);

    const replay = await finish(auth, proof, "198.51.100.205");
    assert.equal(replay.status, 401);
    assert.equal(sessionCookie(replay), undefined);
    assert.equal(await sessionCount(owner.userId), 1);

    const logout = await auth.handler(
      new Request(`${origin}${base}/sign-out`, {
        method: "POST",
        headers: {
          origin,
          cookie,
          "content-type": "application/json",
          "x-movaro-client-ip": "198.51.100.206",
        },
        body: "{}",
      }),
    );
    assert.equal(logout.status, 200);
    assert.equal(await readSession(cookie), null);
    assert.equal(await sessionCount(owner.userId), 0);

    const expired = await finish(
      auth,
      await grant(owner.userId, -1000),
      "198.51.100.207",
    );
    assert.equal(expired.status, 401);
    assert.equal(sessionCookie(expired), undefined);
    for (const [index, fixture] of [
      await seedIdentity({ linked: false }),
      await seedIdentity({ inactive: true }),
    ].entries()) {
      const denied = await finish(
        auth,
        await grant(fixture.userId),
        `198.51.100.${208 + index}`,
      );
      assert.equal(denied.status, 403);
      assert.equal(sessionCookie(denied), undefined);
      assert.equal(await sessionCount(fixture.userId), 0);
    }
    assert.equal(await sessionCount(owner.userId), 0);
  } finally {
    await pool.end();
  }
});
