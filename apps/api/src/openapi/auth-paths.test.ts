import type { OpenAPIObject } from "@nestjs/swagger";
import { describe, expect, it } from "vitest";
import { addAuthPaths } from "./auth-paths.js";

describe("Auth OpenAPI contract", () => {
  function document() {
    const result: OpenAPIObject = {
      openapi: "3.0.0",
      info: { title: "Test", version: "1" },
      paths: {},
    };
    addAuthPaths(result);
    return result;
  }

  it("documents the public auth operations without internal Better Auth routes", () => {
    const result = document();
    const operations = Object.entries(result.paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(operations.sort()).toEqual(
      [
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
        .map((entry) => entry.replace(" /", " /api/v1/auth/"))
        .sort(),
    );
    const ids = Object.values(result.paths).flatMap((item) =>
      [item.get, item.post, item.delete]
        .filter((entry) => entry !== undefined)
        .map((entry) => entry.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(undefined);
  });

  it("publishes only public DTOs and separates admin and browser operations", () => {
    const { paths } = document();
    const complete = paths["/api/v1/auth/registration/email/complete"]?.post;
    expect(complete?.requestBody).toMatchObject({
      required: true,
      content: {
        "application/json": {
          schema: {
            required: ["token", "password", "registration"],
            additionalProperties: false,
          },
        },
      },
    });
    const text = JSON.stringify(paths);
    for (const hidden of [
      "registrationProofHash",
      "registrationDraft",
      "rotationRevision",
      "credentialRevision",
      "refreshToken",
      "photoKey",
      "x-movaro-proxy-secret",
    ]) {
      expect(text).not.toContain(hidden);
    }
    expect(paths["/api/v1/auth/profile"]?.post).toBeUndefined();
    expect(paths["/api/v1/auth/admin/sign-out"]?.post?.security).toEqual([
      { adminSession: [] },
      { adminSecureSession: [] },
    ]);
    expect(paths["/api/v1/auth/profile/photo"]?.post?.tags).toEqual([
      "AuthBrowser",
    ]);
    expect(
      paths["/api/v1/auth/telegram/callback"]?.get?.responses[303],
    ).toBeDefined();
    expect(
      paths["/api/v1/auth/get-session"]?.get?.responses[200],
    ).toMatchObject({
      content: { "application/json": { schema: { nullable: true } } },
    });
  });
});
