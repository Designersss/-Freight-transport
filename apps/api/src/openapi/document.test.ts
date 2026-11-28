import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterEach, describe, expect, it } from "vitest";
import { parseApiConfig } from "../config/api-config.js";
import { createApp } from "../create-app.js";
import { createOpenApiDocument } from "./document.js";

describe("OpenAPI contract", () => {
  let app: NestFastifyApplication | undefined;

  async function start(mode: "development" | "production") {
    app = await createApp(
      parseApiConfig({
        NODE_ENV: mode,
        LOG_LEVEL: "silent",
        DATABASE_URL: "postgresql://127.0.0.1:1/contract",
      }),
    );
    await app.init();
    const fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();
    return { app, fastify };
  }

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("documents real versioned endpoints and the readiness error", async () => {
    const { app } = await start("production");
    const spec = createOpenApiDocument(app);
    const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(operations.sort()).toEqual(
      [
        "GET /api/v1/health",
        "GET /api/v1/health/ready",
        "POST /sign-in/email",
        "POST /sign-out",
        "GET /get-session",
        "POST /change-password",
        "POST /request-password-reset",
        "POST /reset-password",
        "GET /reset-password/{token}",
        "POST /registration/email/start",
        "POST /registration/email/read",
        "POST /registration/email/complete",
        "GET /profile",
        "POST /profile/settings",
        "GET /profile/photo",
        "POST /profile/photo",
        "DELETE /profile/photo",
        "POST /username",
        "GET /username/settings",
        "POST /username/settings",
        "GET /sessions",
        "POST /sessions",
        "POST /email/change",
        "POST /email/change/confirm",
        "POST /account/deactivate",
        "GET /telegram/status",
        "POST /telegram/start",
        "GET /telegram/callback",
        "POST /telegram/registration",
        "GET /telegram/settings",
        "GET /cabinet/company-owner",
        "GET /cabinet/dispatcher",
        "GET /cabinet/driver",
        "POST /admin/sign-in/email",
        "POST /admin/sign-out",
        "GET /admin/get-session",
      ]
        .map((entry) =>
          entry.includes(" /api/v1/")
            ? entry
            : entry.replace(" /", " /api/v1/auth/"),
        )
        .sort(),
    );
    const ids = Object.values(spec.paths).flatMap((item) =>
      [item.get, item.post, item.delete]
        .filter((entry) => entry !== undefined)
        .map((entry) => entry.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(undefined);
    expect(spec.paths["/api/v1/health"]?.get?.operationId).toBe("getLiveness");
    const ready = spec.paths["/api/v1/health/ready"]?.get;
    expect(ready?.operationId).toBe("getReadiness");
    expect(ready?.responses).toHaveProperty("200");
    expect(ready?.responses).toHaveProperty("503");
    expect(JSON.stringify(ready?.responses["503"])).toContain(
      "SERVICE_UNAVAILABLE",
    );
  });

  it("serves Swagger UI and JSON in development", async () => {
    const { fastify } = await start("development");
    const ui = await fastify.inject({ method: "GET", url: "/docs/" });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers["content-type"]).toContain("text/html");
    const json = await fastify.inject({
      method: "GET",
      url: "/docs/openapi.json",
    });
    expect(json.statusCode).toBe(200);
    expect(json.json().paths["/api/v1/health"].get.operationId).toBe(
      "getLiveness",
    );
  });

  it("does not expose documentation in production", async () => {
    const { fastify } = await start("production");
    for (const url of [
      "/docs",
      "/docs/",
      "/docs/openapi.json",
      "/docs/openapi.yaml",
      "/docs-json",
      "/docs-yaml",
    ]) {
      const result = await fastify.inject({ method: "GET", url });
      expect(result.statusCode).toBe(404);
    }
  });
});
