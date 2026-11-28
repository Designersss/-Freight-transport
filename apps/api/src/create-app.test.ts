import { parseAuthConfig } from "@freight/auth/runtime";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseApiConfig } from "./config/api-config.js";
import { createApp } from "./create-app.js";

describe("API HTTP foundation", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(
      parseApiConfig({
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        DATABASE_URL:
          "postgresql://test:test@127.0.0.1:1/test?connect_timeout=1&pool_timeout=1",
      }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("serves real liveness under the versioned API prefix", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("does not expose the Telegram internal route when disabled", async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: "POST",
      url: "/internal/telegram-bot",
      payload: {},
    });
    expect(response.statusCode).toBe(404);
  });

  it("returns a structured error for missing routes", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/api/v1/missing" });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: "NOT_FOUND", requestId: expect.any(String) },
    });
  });
  it("returns 503 when PostgreSQL is unavailable without exposing credentials", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/api/v1/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: { code: "SERVICE_UNAVAILABLE", requestId: expect.any(String) },
    });
    expect(response.body).not.toContain("postgresql:");
  });
});

describe("Telegram bot activation", () => {
  const config = parseApiConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test",
  });
  const auth = parseAuthConfig({
    NODE_ENV: "test",
    AUTH_BASE_URL: "http://127.0.0.1:4000",
    AUTH_WEB_ORIGIN: "https://movaro.test",
    AUTH_SECRET: "test-only-secret-0123456789-abcdefgh",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: "1025",
    SMTP_SECURITY: "local",
    SMTP_FROM: "auth@movaro.test",
  });
  const botAuth = {
    ...auth,
    AUTH_TELEGRAM_BOT_USERNAME: "synthetic_movaro_bot",
  };
  const secret = "a".repeat(64);

  it("rejects an internal secret without a configured bot", async () => {
    await expect(createApp(config, auth, undefined, secret)).rejects.toThrow(
      "Telegram bot internal API requires loopback staging auth",
    );
  });

  it("rejects a configured bot without an internal secret", async () => {
    await expect(createApp(config, botAuth)).rejects.toThrow(
      "Telegram bot Web API requires internal service secret",
    );
  });
});
