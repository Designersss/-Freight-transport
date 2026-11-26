import { describe, expect, it } from "vitest";
import {
  assertObjectKey,
  createObjectKey,
  MAX_FILE_BYTES,
  validateFile,
} from "./file-policy.js";

describe("File policy", () => {
  it.each([
    ["image/jpeg", [255, 216, 255, 0]],
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["application/pdf", [37, 80, 68, 70, 45]],
  ] as const)("accepts the expected signature for %s", (type, bytes) => {
    expect(() => validateFile(type, Uint8Array.from(bytes))).not.toThrow();
  });

  it("rejects mismatched signatures and unapproved formats", () => {
    const bytes = Uint8Array.from([37, 80, 68, 70, 45]);
    expect(() => validateFile("image/png", bytes)).toThrow("signature");
    expect(() => validateFile("image/svg+xml", bytes)).toThrow("Unsupported");
  });

  it("rejects empty and oversized files", () => {
    expect(() => validateFile("application/pdf", new Uint8Array())).toThrow(
      "size",
    );
    expect(() =>
      validateFile("application/pdf", new Uint8Array(MAX_FILE_BYTES + 1)),
    ).toThrow("size");
  });

  it("generates opaque distinct keys and rejects user-defined paths", () => {
    const key = createObjectKey();
    expect(() => assertObjectKey(key)).not.toThrow();
    expect(createObjectKey()).not.toBe(key);
    for (const invalid of [
      "../secret",
      "/files/abc",
      "files/abc",
      "other/path",
    ]) {
      expect(() => assertObjectKey(invalid)).toThrow("key");
    }
  });
});
