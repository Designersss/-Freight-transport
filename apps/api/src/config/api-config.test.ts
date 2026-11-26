import { describe, expect, it } from "vitest";
import { parseApiConfig } from "./api-config.js";

const DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test?connect_timeout=1&pool_timeout=1";

describe("API environment", () => {
  it("uses local defaults", () => {
    expect(parseApiConfig({ NODE_ENV: "development", DATABASE_URL })).toEqual({
      NODE_ENV: "development", DATABASE_URL,
      API_HOST: "127.0.0.1",
      API_PORT: 4000,
      LOG_LEVEL: "info",
    });
  });

  it("parses explicit ports", () => {
    expect(
      parseApiConfig({ NODE_ENV: "production", DATABASE_URL, API_PORT: "8080" }).API_PORT,
    ).toBe(8080);
  });

  it.each(["0", "65536", "not-a-port", "1.5"])(
    "rejects invalid port %s",
    (port) => {
      expect(() =>
        parseApiConfig({ NODE_ENV: "development", DATABASE_URL, API_PORT: port }),
      ).toThrow("API_PORT");
    },
  );

  it("requires a valid runtime mode", () => {
    expect(() => parseApiConfig({ NODE_ENV: "staging", DATABASE_URL })).toThrow("NODE_ENV");
  });
  it.each(["", "not-a-url", "https://example.com"])("rejects invalid database URL %s", (url) => {
    expect(() => parseApiConfig({ NODE_ENV: "test", DATABASE_URL: url })).toThrow("DATABASE_URL");
  });
});
