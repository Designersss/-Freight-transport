import { describe, expect, it } from "vitest";
import {
  assertObjectKey,
  assertProfilePhotoKey,
  createObjectKey,
  createProfilePhotoKey,
  MAX_FILE_BYTES,
  MAX_PROFILE_PHOTO_BYTES,
  validateFile,
  validateProfilePhoto,
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

describe("Profile photo envelope policy", () => {
  it("isolates photo keys from general object keys", () => {
    const photo = createProfilePhotoKey();
    const general = createObjectKey();
    expect(() => assertProfilePhotoKey(photo)).not.toThrow();
    expect(createProfilePhotoKey()).not.toBe(photo);
    expect(() => assertObjectKey(photo)).toThrow("key");
    expect(() => assertProfilePhotoKey(general)).toThrow("key");
    for (const invalid of ["../secret", "profile-photos/abc", `/${photo}`]) {
      expect(() => assertProfilePhotoKey(invalid)).toThrow("key");
    }
  });

  it.each([
    ["image/jpeg", [255, 216, 255, 0]],
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
  ] as const)("accepts the expected signature for %s", (type, signature) => {
    const bytes = new Uint8Array(MAX_PROFILE_PHOTO_BYTES);
    bytes.set(signature);
    expect(() => validateProfilePhoto(type, bytes)).not.toThrow();
  });

  it("rejects empty, oversized and disguised files", () => {
    expect(() => validateProfilePhoto("image/png", new Uint8Array())).toThrow(
      "size",
    );
    expect(() =>
      validateProfilePhoto(
        "image/jpeg",
        new Uint8Array(MAX_PROFILE_PHOTO_BYTES + 1),
      ),
    ).toThrow("size");
    const pdf = Uint8Array.from([37, 80, 68, 70, 45]);
    expect(() => validateProfilePhoto("application/pdf", pdf)).toThrow(
      "Unsupported",
    );
    expect(() => validateProfilePhoto("image/png", pdf)).toThrow("signature");
    expect(() => validateProfilePhoto("image/svg+xml", pdf)).toThrow(
      "Unsupported",
    );
  });
});
