import { parseAuthConfig, parseStorageConfig } from "@freight/auth/runtime";
import { createDatabaseClient } from "@freight/database";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseApiConfig } from "../config/api-config.js";
import { createApp } from "../create-app.js";

describe("PostgreSQL integration", () => {
  let app: NestFastifyApplication;
  let client: ReturnType<typeof createDatabaseClient>;

  beforeAll(async () => {
    const config = parseApiConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: process.env.TEST_DATABASE_URL,
    });
    client = createDatabaseClient(config.DATABASE_URL);
    app = await createApp(config);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    await client?.$disconnect();
  });

  it("queries the migrated schema through HTTP readiness", async () => {
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/api/v1/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });

  it("requires the private bucket when photo storage is configured", async () => {
    const config = parseApiConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: process.env.TEST_DATABASE_URL,
    });
    const auth = parseAuthConfig({
      NODE_ENV: "test",
      AUTH_BASE_URL: "http://127.0.0.1:4000",
      AUTH_WEB_ORIGIN: "http://127.0.0.1:3000",
      AUTH_SECRET: "integration-readiness-secret-only",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "1025",
      SMTP_SECURITY: "local",
      SMTP_FROM: "test@example.test",
    });
    const storage = parseStorageConfig(process.env);
    const available = await createApp(config, auth, storage);
    try {
      await available.init();
      const response = await available
        .getHttpAdapter()
        .getInstance()
        .inject({ method: "GET", url: "/api/v1/health/ready" });
      expect(response.statusCode).toBe(200);
    } finally {
      await available.close();
    }
    const unavailable = await createApp(config, auth, {
      ...storage,
      S3_ENDPOINT: "http://127.0.0.1:1",
    });
    try {
      await unavailable.init();
      const fastify = unavailable.getHttpAdapter().getInstance();
      const ready = await fastify.inject({
        method: "GET",
        url: "/api/v1/health/ready",
      });
      expect(ready.statusCode).toBe(503);
      const live = await fastify.inject({
        method: "GET",
        url: "/api/v1/health",
      });
      expect(live.statusCode).toBe(200);
    } finally {
      await unavailable.close();
    }
  }, 30000);

  it("persists an outbox event in PostgreSQL and reads it back", async () => {
    const event = await client.outboxEvent.create({
      data: {
        eventType: "integration.test",
        aggregateId: "test",
        payload: { verified: true },
      },
    });
    try {
      const saved = await client.outboxEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
      expect(saved.payload).toEqual({ verified: true });
      expect(saved.attempts).toBe(0);
      expect(saved.processedAt).toBeNull();
    } finally {
      await client.outboxEvent.delete({ where: { id: event.id } });
    }
  });
});
