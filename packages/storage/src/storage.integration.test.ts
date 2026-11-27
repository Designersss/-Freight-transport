import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  MAX_PROFILE_PHOTO_BYTES,
  PrivateStorage,
  parseStorageConfig,
  type StorageConfig,
} from "./index.js";

describe("SeaweedFS private S3", () => {
  let config: StorageConfig;
  let storage: PrivateStorage;
  const bytes = Buffer.from("%PDF-1.7\nIntegration fixture\n%%EOF");

  beforeAll(async () => {
    config = parseStorageConfig(process.env);
    storage = new PrivateStorage(config);
    await vi.waitFor(() => storage.checkReadiness(), {
      timeout: 60000,
      interval: 1000,
    });
  }, 70000);

  afterAll(() => storage?.close());

  it("writes, reads and deletes an actual object without anonymous access", async () => {
    const uploaded = await storage.put(bytes, "application/pdf");
    try {
      expect(uploaded.size).toBe(bytes.byteLength);
      const downloaded = await storage.get(uploaded.key);
      expect(Buffer.from(downloaded.bytes)).toEqual(bytes);
      expect(downloaded.contentType).toBe("application/pdf");

      const url = new URL(
        `/${config.S3_BUCKET}/${uploaded.key}`,
        config.S3_ENDPOINT,
      );
      const anonymous = await fetch(url, { signal: AbortSignal.timeout(5000) });
      await anonymous.body?.cancel();
      expect([401, 403]).toContain(anonymous.status);

      const unauthorized = new PrivateStorage({
        ...config,
        S3_SECRET_KEY: "wrong-secret-for-test",
      });
      try {
        await expect(unauthorized.get(uploaded.key)).rejects.toMatchObject({
          $metadata: { httpStatusCode: 403 },
        });
      } finally {
        unauthorized.close();
      }
    } finally {
      await storage.delete(uploaded.key);
    }
    await expect(storage.get(uploaded.key)).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    });
  }, 30000);

  it("stores and retrieves a private profile photo", async () => {
    // A real, synthetic 1x1 PNG.
    const photo = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a66QAAAAASUVORK5CYII=",
      "base64",
    );
    const uploaded = await storage.putProfilePhoto(photo, "image/png");
    try {
      expect(uploaded.contentType).toBe("image/png");
      expect(uploaded.size).toBe(photo.byteLength);
      const downloaded = await storage.getProfilePhoto(uploaded.key);
      expect(Buffer.from(downloaded.bytes)).toEqual(photo);
      expect(downloaded.contentType).toBe("image/png");

      const url = new URL(
        `/${config.S3_BUCKET}/${uploaded.key}`,
        config.S3_ENDPOINT,
      );
      const anonymous = await fetch(url, { signal: AbortSignal.timeout(5000) });
      await anonymous.body?.cancel();
      expect([401, 403]).toContain(anonymous.status);
    } finally {
      await storage.delete(uploaded.key);
    }
    await expect(storage.getProfilePhoto(uploaded.key)).rejects.toMatchObject({
      $metadata: { httpStatusCode: 404 },
    });
  }, 30000);

  it("does not allow general files through the profile photo interface", async () => {
    await expect(
      storage.putProfilePhoto(bytes, "application/pdf"),
    ).rejects.toThrow("Unsupported");
    const uploaded = await storage.put(bytes, "application/pdf");
    try {
      await expect(storage.getProfilePhoto(uploaded.key)).rejects.toThrow(
        "Unsupported",
      );
    } finally {
      await storage.delete(uploaded.key);
    }
  });

  it("bounds photo reads even for objects written by the general interface", async () => {
    const oversized = Buffer.alloc(MAX_PROFILE_PHOTO_BYTES + 1);
    oversized.set([255, 216, 255]);
    const uploaded = await storage.put(oversized, "image/jpeg");
    try {
      await expect(storage.getProfilePhoto(uploaded.key)).rejects.toThrow(
        "size",
      );
    } finally {
      await storage.delete(uploaded.key);
    }
  }, 30000);

  it("rejects invalid data before upload", async () => {
    await expect(
      storage.put(Buffer.from("not an image"), "image/png"),
    ).rejects.toThrow("signature");
  });
});
