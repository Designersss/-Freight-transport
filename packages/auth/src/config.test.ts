import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAuthConfig } from "./config.ts";
import { isDeliverableEmail } from "./email.ts";

const env = {
  NODE_ENV: "test",
  AUTH_BASE_URL: "http://127.0.0.1:4000",
  AUTH_WEB_ORIGIN: "http://127.0.0.1:3000",
  AUTH_SECRET: "test-only-secret-0123456789-abcdefgh",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_SECURITY: "local",
  SMTP_FROM: "auth@movaro.test",
};

describe("auth config", () => {
  it("accepts local SMTP without credentials", () => {
    assert.equal(parseAuthConfig(env).SMTP_PORT, 1025);
  });

  it("requires secure production origins and SMTP", () => {
    assert.throws(
      () => parseAuthConfig({ ...env, NODE_ENV: "production" }),
      /AUTH_BASE_URL/,
    );

    assert.equal(
      parseAuthConfig({
        ...env,
        NODE_ENV: "production",
        AUTH_BASE_URL: "https://api.movaro.test",
        AUTH_WEB_ORIGIN: "https://movaro.test",
        SMTP_SECURITY: "starttls",
        SMTP_HOST: "smtp.movaro.test",
      }).SMTP_SECURITY,
      "starttls",
    );
  });

  for (const override of [
    { AUTH_SECRET: "short" },
    { AUTH_BASE_URL: "https://example.test/other" },
    { AUTH_WEB_ORIGIN: "https://user:pass@example.test" },
    { SMTP_HOST: "smtp.example.test" },
    { SMTP_USER: "user" },
    { SMTP_USER: "user", SMTP_PASSWORD: "password" },
  ]) {
    it(`rejects unsafe configuration ${JSON.stringify(override)}`, () => {
      assert.throws(
        () => parseAuthConfig({ ...env, ...override }),
        /Invalid auth environment/,
      );
    });
  }
});

describe("mail destinations", () => {
  for (const value of [
    "user@telegram.invalid",
    "USER@TELEGRAM.INVALID",
    "user@example.invalid",
    "not-an-email",
  ]) {
    it(`rejects ${value}`, () => {
      assert.equal(isDeliverableEmail(value), false);
    });
  }

  it("accepts an ordinary address", () => {
    assert.equal(isDeliverableEmail("user@example.test"), true);
  });
});
