import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { parseApiConfig } from "../../apps/api/dist/config/api-config.js";
import { createApp } from "../../apps/api/dist/create-app.js";
import { parseAuthConfig } from "../../packages/auth/dist/runtime.js";

test("trusted ingress separates rate limits and rejects spoofing", async () => {
  const databaseUrl = process.env.AUTH_COMPAT_DATABASE_URL;
  const target = new URL(databaseUrl);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.pathname, "/freight_auth_compat");
  const secret = randomBytes(32).toString("hex");
  const webOrigin = "http://127.0.0.1:3000";
  const app = await createApp(
    parseApiConfig({
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      LOG_LEVEL: "silent",
    }),
    parseAuthConfig({
      NODE_ENV: "test",
      AUTH_BASE_URL: "http://127.0.0.1:4000",
      AUTH_WEB_ORIGIN: webOrigin,
      AUTH_SECRET: randomBytes(32).toString("hex"),
      AUTH_PROXY_SECRET: secret,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: process.env.AUTH_COMPAT_SMTP_PORT,
      SMTP_SECURITY: "local",
      SMTP_FROM: "auth@movaro.test",
    }),
  );
  try {
    await app.init();
    const fastify = app.getHttpAdapter().getInstance();
    const payload = {
      email: `${randomBytes(12).toString("hex")}@example.test`,
      password: "invalid-password",
    };
    const login = (headers) =>
      fastify.inject({
        method: "POST",
        url: "/api/v1/auth/sign-in/email",
        remoteAddress: "127.0.0.1",
        payload,
        headers: {
          origin: webOrigin,
          "content-type": "application/json",
          ...headers,
        },
      });
    const first = {
      "x-movaro-proxy-ip": "203.0.113.170",
      "x-movaro-proxy-secret": secret,
    };
    assert.equal(
      (await login({ "x-forwarded-for": "203.0.113.170" })).statusCode,
      403,
    );
    assert.equal(
      (
        await login({
          ...first,
          "x-movaro-proxy-secret": "a".repeat(64),
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await login({
          ...first,
          "x-movaro-proxy-ip": "203.0.113.170, 203.0.113.171",
        })
      ).statusCode,
      403,
    );
    for (let i = 0; i < 3; i++)
      assert.equal((await login(first)).statusCode, 401);
    const limited = await login({
      ...first,
      "x-forwarded-for": "203.0.113.171",
      "x-movaro-client-ip": "203.0.113.171",
    });
    assert.equal(limited.statusCode, 429);
    assert.ok(Number(limited.headers["retry-after"]) > 0);
    assert.equal(
      (
        await login({
          ...first,
          "x-movaro-proxy-ip": "::ffff:203.0.113.170",
        })
      ).statusCode,
      429,
    );
    assert.equal(
      (
        await login({
          ...first,
          "x-movaro-proxy-ip": "203.0.113.171",
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});
