import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders } from "better-auth/node";
import pg from "pg";
import { createApp } from "../../apps/api/dist/create-app.js";
import { parseApiConfig } from "../../apps/api/dist/config/api-config.js";

const origin = "http://127.0.0.1:4000";
const basePath = "/api/v1/auth";

test("Better Auth on the real Nest/Fastify adapter and isolated PostgreSQL", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  assert.ok(databaseUrl, "AUTH_COMPAT_DATABASE_URL is required");
  const url = new URL(databaseUrl);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/freight_auth_compat");
  const pool = new pg.Pool({ connectionString: databaseUrl });
  let app;
  try {
    const auth = betterAuth({
      baseURL: origin,
      basePath,
      secret: randomBytes(32).toString("hex"),
      database: pool,
      trustedOrigins: [origin],
      emailAndPassword: { enabled: true },
      session: { cookieCache: { enabled: false } },
    });
    const migrations = await getMigrations(auth.options);
    await migrations.runMigrations();

    app = await createApp(
      parseApiConfig({
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        LOG_LEVEL: "silent",
      }),
    );
    const fastify = app.getHttpAdapter().getInstance();
    // Test-only routes. The production application never registers these.
    fastify.route({
      method: ["GET", "POST"],
      url: `${basePath}/*`,
      async handler(request, reply) {
        const response = await auth.handler(
          new Request(new URL(request.url, origin), {
            method: request.method,
            headers: fromNodeHeaders(request.headers),
            ...(request.body === undefined
              ? {}
              : { body: JSON.stringify(request.body) }),
          }),
        );
        reply.status(response.status);
        for (const [name, value] of response.headers) {
          if (name !== "set-cookie") reply.header(name, value);
        }
        const cookies = response.headers.getSetCookie();
        if (cookies.length) reply.header("set-cookie", cookies);
        return reply.send(response.body ? await response.text() : null);
      },
    });
    fastify.get("/api/v1/auth-compat/session", async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session) return reply.code(401).send({ code: "UNAUTHORIZED" });
      return { userId: session.user.id };
    });
    await app.init();
    await fastify.ready();

    const sessionUrl = "/api/v1/auth-compat/session";
    const anonymous = await fastify.inject({ method: "GET", url: sessionUrl });
    assert.equal(anonymous.statusCode, 401);

    const credentials = {
      email: `${randomBytes(12).toString("hex")}@example.invalid`,
      password: randomBytes(24).toString("hex"),
    };
    const post = (path, payload, headers = {}) =>
      fastify.inject({
        method: "POST",
        url: `${basePath}/${path}`,
        headers: { origin, "content-type": "application/json", ...headers },
        payload,
      });

    const rejected = await post(
      "sign-up/email",
      { ...credentials, name: "Compatibility test" },
      { origin: "https://untrusted.invalid" },
    );
    assert.equal(rejected.statusCode, 403);

    const signup = await post("sign-up/email", {
      ...credentials,
      name: "Compatibility test",
    });
    assert.equal(signup.statusCode, 200);
    const userId = signup.json().user.id;
    assert.ok(userId);

    const badLogin = await post("sign-in/email", {
      ...credentials,
      password: randomBytes(24).toString("hex"),
    });
    assert.equal(badLogin.statusCode, 401);

    const login = await post("sign-in/email", credentials);
    assert.equal(login.statusCode, 200);
    const cookies = login.headers["set-cookie"];
    assert.ok(cookies);
    const cookie = (Array.isArray(cookies) ? cookies : [cookies])
      .map((value) => value.split(";")[0])
      .join("; ");
    assert.match(cookie, /session_token=/);
    const session = await fastify.inject({
      method: "GET",
      url: sessionUrl,
      headers: { cookie },
    });
    assert.equal(session.statusCode, 200);
    assert.deepEqual(session.json(), { userId });

    const stored = await pool.query('SELECT id FROM "user" WHERE email = $1', [
      credentials.email,
    ]);
    assert.equal(stored.rows[0]?.id, userId);

    const logout = await post("sign-out", {}, { cookie });
    assert.equal(logout.statusCode, 200);
    const revoked = await fastify.inject({
      method: "GET",
      url: sessionUrl,
      headers: { cookie },
    });
    assert.equal(revoked.statusCode, 401);
  } finally {
    try {
      await app?.close();
    } finally {
      await pool.end();
    }
  }
});
