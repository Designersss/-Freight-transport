import { describe, expect, it } from "vitest";
import { parseAuthConfig } from "./config.js";
import { isDeliverableEmail } from "./email.js";

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
    expect(parseAuthConfig(env).SMTP_PORT).toBe(1025);
  });
  it("requires secure production origins and SMTP", () => {
    expect(() => parseAuthConfig({ ...env, NODE_ENV: "production" })).toThrow("AUTH_BASE_URL");
    expect(parseAuthConfig({ ...env, NODE_ENV: "production", AUTH_BASE_URL: "https://api.movaro.test", AUTH_WEB_ORIGIN: "https://movaro.test", SMTP_SECURITY: "starttls", SMTP_HOST: "smtp.movaro.test" }).SMTP_SECURITY).toBe("starttls");
  });
  it.each([
    { AUTH_SECRET: "short" },
    { AUTH_BASE_URL: "https://example.test/other" },
    { AUTH_WEB_ORIGIN: "https://user:pass@example.test" },
    { SMTP_HOST: "smtp.example.test" },
    { SMTP_USER: "user" },
    { SMTP_USER: "user", SMTP_PASSWORD: "password" },
  ])("rejects unsafe configuration %j", (override) => {
    expect(() => parseAuthConfig({ ...env, ...override })).toThrow("Invalid auth environment");
  });
});

describe("mail destinations", () => {
  it.each(["user@telegram.invalid", "USER@TELEGRAM.INVALID", "user@example.invalid", "not-an-email"])("rejects %s", (value) => {
    expect(isDeliverableEmail(value)).toBe(false);
  });
  it("accepts an ordinary address", () => {
    expect(isDeliverableEmail("user@example.test")).toBe(true);
  });
});
