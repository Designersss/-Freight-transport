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
    for (const path of [
      "/telegram/start",
      "/telegram/callback",
      "/telegram/registration",
      "/telegram-bot/finish-login",
    ]) {
      expect(paths[`/api/v1/auth${path}`]).toBeUndefined();
    }
    const browser = paths["/api/v1/auth/telegram-bot/browser"]?.post;
    expect(browser?.tags).toEqual(["AuthBrowser"]);
    expect(JSON.stringify(browser?.requestBody)).toContain("draft-state");
    expect(JSON.stringify(browser?.requestBody)).toContain("confirm");
    expect(JSON.stringify(browser?.requestBody)).not.toContain("browserHash");
    expect(
      paths["/api/v1/auth/profile"]?.get?.responses[200],
    ).not.toMatchObject({
      content: { "application/json": { schema: { nullable: true } } },
    });
    expect(
      paths["/api/v1/auth/get-session"]?.get?.responses[200],
    ).toMatchObject({
      content: { "application/json": { schema: { nullable: true } } },
    });
  });
});
