import { createDatabaseClient } from "@freight/database";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseApiConfig } from "../config/api-config.js";
import { createApp } from "../create-app.js";

describe("PostgreSQL integration", () => {
  let app: NestFastifyApplication;
  let client: ReturnType<typeof createDatabaseClient>;

  beforeAll(async () => {
    const config = parseApiConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: process.env.TEST_DATABASE_URL });
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
    const response = await app.getHttpAdapter().getInstance().inject({ method: "GET", url: "/api/v1/health/ready" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready" });
  });

  it("persists an outbox event in PostgreSQL and reads it back", async () => {
    const event = await client.outboxEvent.create({
      data: { eventType: "integration.test", aggregateId: "test", payload: { verified: true } },
    });
    try {
      const saved = await client.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      expect(saved.payload).toEqual({ verified: true });
      expect(saved.attempts).toBe(0);
      expect(saved.processedAt).toBeNull();
    } finally {
      await client.outboxEvent.delete({ where: { id: event.id } });
    }
  });
});
