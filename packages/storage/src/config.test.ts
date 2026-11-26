import { describe, expect, it } from "vitest";
import { parseStorageConfig } from "./config.js";

const env = { S3_ENDPOINT: "http://127.0.0.1:8333", S3_ACCESS_KEY: "test-key", S3_SECRET_KEY: "test-only-not-real" };

describe("Storage configuration", () => {
  it("uses the private bucket default", () => {
    expect(parseStorageConfig(env).S3_BUCKET).toBe("freight-private");
  });

  it.each(["", "file:///tmp", "http://127.0.0.1/path"])("rejects an invalid endpoint %s", (endpoint) => {
    expect(() => parseStorageConfig({ ...env, S3_ENDPOINT: endpoint })).toThrow("S3_ENDPOINT");
  });

  it("requires credentials without echoing the secret", () => {
    expect(() => parseStorageConfig({ ...env, S3_SECRET_KEY: "short" })).toThrow("Invalid storage environment: S3_SECRET_KEY");
  });
});
