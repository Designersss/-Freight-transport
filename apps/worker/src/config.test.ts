import { describe, expect, it } from "vitest";
import { parseWorkerConfig } from "./config.js";

const env = { NODE_ENV: "test", DATABASE_URL: "postgresql://127.0.0.1/test" };

describe("Worker configuration", () => {
  it("uses a bounded default batch size", () => {
    expect(parseWorkerConfig(env).OUTBOX_BATCH_SIZE).toBe(100);
  });

  it("requires explicit opt-in for private photo inventory", () => {
    expect(parseWorkerConfig(env).PROFILE_PHOTO_SCAN_ENABLED).toBe(false);
    expect(
      parseWorkerConfig({ ...env, PROFILE_PHOTO_SCAN_ENABLED: "true" })
        .PROFILE_PHOTO_SCAN_ENABLED,
    ).toBe(true);
    expect(() =>
      parseWorkerConfig({ ...env, PROFILE_PHOTO_SCAN_ENABLED: "yes" }),
    ).toThrow("PROFILE_PHOTO_SCAN_ENABLED");
  });

  it.each([0, 1001, 1.5, "invalid"])(
    "rejects invalid batch size %s",
    (size) => {
      expect(() =>
        parseWorkerConfig({ ...env, OUTBOX_BATCH_SIZE: size }),
      ).toThrow("OUTBOX_BATCH_SIZE");
    },
  );

  it.each(["", "invalid", "https://example.com"])(
    "rejects invalid database URL %s",
    (url) => {
      expect(() => parseWorkerConfig({ ...env, DATABASE_URL: url })).toThrow(
        "DATABASE_URL",
      );
    },
  );
});
