import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { fromNodeHeaders } from "better-auth/node";
import pg from "pg";
import { parseApiConfig } from "../../apps/api/dist/config/api-config.js";
import { createApp } from "../../apps/api/dist/create-app.js";
import { openUserEventStream } from "../../apps/api/dist/realtime/user-event-stream.js";
import {
  appendUserInvalidation,
  createDatabaseClient,
} from "../../packages/database/dist/index.js";

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
  const database = createDatabaseClient(databaseUrl);
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
    const activeStreams = new Set();
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
    fastify.get("/api/v1/auth-compat/events", async (request, reply) => {
      const controller = new AbortController();
      reply.raw.once("close", () => {
        controller.abort();
        activeStreams.delete(controller);
      });
      const result = await openUserEventStream(
        database,
        async () => {
          const session = await auth.api.getSession({
            headers: fromNodeHeaders(request.headers),
          });
          return session?.user.id ?? null;
        },
        request.headers["last-event-id"],
        controller.signal,
      );
      if (result.status !== 200) return reply.code(result.status).send();
      if (!controller.signal.aborted) activeStreams.add(controller);
      return reply
        .header("content-type", "text/event-stream; charset=utf-8")
        .header("cache-control", "no-store")
        .header("x-accel-buffering", "no")
        .send(Readable.from(result.stream));
    });
    await app.init();
    await fastify.ready();
    const address = await fastify.listen({ host: "127.0.0.1", port: 0 });

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

    const eventsPath = "/api/v1/auth-compat/events";
    const unauthorized = await fastify.inject({
      method: "GET",
      url: eventsPath,
    });
    assert.equal(unauthorized.statusCode, 401);

    const otherSignup = await post("sign-up/email", {
      email: `${randomBytes(12).toString("hex")}@example.invalid`,
      password: randomBytes(24).toString("hex"),
      name: "Other user",
    });
    assert.equal(otherSignup.statusCode, 200);
    const otherUserId = otherSignup.json().user.id;
    for (let i = 0; i < 5; i++) {
      await database.$transaction((tx) =>
        appendUserInvalidation(tx, otherUserId),
      );
    }
    await assert.rejects(
      database.$transaction(async (tx) => {
        await appendUserInvalidation(tx, userId);
        throw new Error("rollback");
      }),
      /rollback/,
    );
    const sequences = await Promise.all(
      Array.from({ length: 3 }, () =>
        database.$transaction((tx) => appendUserInvalidation(tx, userId)),
      ),
    );
    assert.deepEqual(sequences.sort(), [1n, 2n, 3n]);

    const invalid = await fastify.inject({
      method: "GET",
      url: eventsPath,
      headers: { cookie, "last-event-id": "999" },
    });
    assert.equal(invalid.statusCode, 400);

    const response = await fetch(address + eventsPath, {
      headers: { cookie, "last-event-id": "2" },
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = "";
    try {
      while (!received.includes("id: 3\nevent: refresh\ndata: {}\n\n")) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        received += decoder.decode(chunk.value, { stream: true });
      }
      assert.equal(
        received,
        "retry: 3000\n\nid: 3\nevent: refresh\ndata: {}\n\n",
      );
    } finally {
      await reader.cancel();
    }

    for (let i = 0; activeStreams.size > 0 && i < 100; i++) {
      await delay(20);
    }
    assert.equal(
      activeStreams.size,
      0,
      "Disconnected HTTP stream was cleaned up",
    );

    const liveResponse = await fetch(address + eventsPath, {
      headers: { cookie, "last-event-id": "3" },
      signal: AbortSignal.timeout(30_000),
    });
    const liveReader = liveResponse.body.getReader();
    try {
      assert.equal(liveResponse.status, 200);
      const initial = await liveReader.read();
      assert.equal(decoder.decode(initial.value), "retry: 3000\n\n");
      await database.$transaction((tx) =>
        appendUserInvalidation(tx, otherUserId),
      );
      await database.$transaction((tx) => appendUserInvalidation(tx, userId));
      let live = "";
      while (!live.includes("id: 4\nevent: refresh\ndata: {}\n\n")) {
        const chunk = await liveReader.read();
        assert.equal(chunk.done, false);
        live += decoder.decode(chunk.value, { stream: true });
      }
      assert.equal(live, "id: 4\nevent: refresh\ndata: {}\n\n");
      let heartbeat = "";
      while (!heartbeat.includes(": heartbeat\n\n")) {
        const chunk = await liveReader.read();
        assert.equal(chunk.done, false);
        heartbeat += decoder.decode(chunk.value, { stream: true });
      }
      assert.equal(heartbeat, ": heartbeat\n\n");
      const logout = await post("sign-out", {}, { cookie });
      assert.equal(logout.statusCode, 200);
      assert.equal((await liveReader.read()).done, true);
    } finally {
      await liveReader.cancel();
    }

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
      await database.$disconnect();
      await pool.end();
    }
  }
});
