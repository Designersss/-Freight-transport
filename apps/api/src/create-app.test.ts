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
