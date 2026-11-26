import { describe, expect, it } from "vitest";
import { parseApiConfig } from "./api-config.js";

describe("API environment", () => {
  it("uses local defaults", () => {
    expect(parseApiConfig({ NODE_ENV: "development" })).toEqual({
      NODE_ENV: "development",
      API_HOST: "127.0.0.1",
      API_PORT: 4000,
      LOG_LEVEL: "info",
    });
  });

  it("parses explicit ports", () => {
    expect(parseApiConfig({ NODE_ENV: "production", API_PORT: "8080" }).API_PORT).toBe(8080);
  });

  it.each(["0", "65536", "not-a-port", "1.5"])("rejects invalid port %s", (port) => {
    expect(() => parseApiConfig({ NODE_ENV: "development", API_PORT: port })).toThrow("API_PORT");
  });

  it("requires a valid runtime mode", () => {
    expect(() => parseApiConfig({ NODE_ENV: "staging" })).toThrow("NODE_ENV");
  });
});
