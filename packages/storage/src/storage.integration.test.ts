import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProfilePhotoKey } from "./file-policy.js";
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

  async function seedPhotoObject(bytes: Buffer, contentType: string) {
    const key = createProfilePhotoKey();
    const client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 2,
    });
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          ContentLength: bytes.byteLength,
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
      return key;
    } finally {
      client.destroy();
    }
  }

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
    const photo = await sharp({
      create: {
        width: 800,
        height: 400,
        channels: 3,
        background: "#375a7f",
      },
    })
      .png()
      .toBuffer();
    const uploaded = await storage.putProfilePhoto(photo, "image/png");
    try {
      expect(uploaded.contentType).toBe("image/jpeg");
      const downloaded = await storage.getProfilePhoto(uploaded.key);
      expect(downloaded.bytes.byteLength).toBe(uploaded.size);
      expect(downloaded.contentType).toBe("image/jpeg");
      const metadata = await sharp(downloaded.bytes).metadata();
      expect(metadata.format).toBe("jpeg");
      expect(metadata.width).toBe(512);
      expect(metadata.height).toBe(256);
      expect(metadata.exif).toBeUndefined();
      expect(uploaded.key).toMatch(/^profile-photos\//);
      await expect(storage.get(uploaded.key)).rejects.toThrow("key");
      await expect(storage.delete(uploaded.key)).rejects.toThrow("key");

      const url = new URL(
        `/${config.S3_BUCKET}/${uploaded.key}`,
        config.S3_ENDPOINT,
      );
      const anonymous = await fetch(url, { signal: AbortSignal.timeout(5000) });
      await anonymous.body?.cancel();
      expect([401, 403]).toContain(anonymous.status);
    } finally {
      await storage.deleteProfilePhoto(uploaded.key);
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
        "key",
      );
      await expect(storage.deleteProfilePhoto(uploaded.key)).rejects.toThrow(
        "key",
      );
      expect(Buffer.from((await storage.get(uploaded.key)).bytes)).toEqual(
        bytes,
      );
    } finally {
      await storage.delete(uploaded.key);
    }
    const key = await seedPhotoObject(bytes, "application/pdf");
    try {
      await expect(storage.getProfilePhoto(key)).rejects.toThrow("Unsupported");
    } finally {
      await storage.deleteProfilePhoto(key);
    }
  });

  it("bounds reads of oversized objects in the photo namespace", async () => {
    const oversized = Buffer.alloc(MAX_PROFILE_PHOTO_BYTES + 1);
    oversized.set([255, 216, 255]);
    const key = await seedPhotoObject(oversized, "image/jpeg");
    try {
      await expect(storage.getProfilePhoto(key)).rejects.toThrow("size");
    } finally {
      await storage.deleteProfilePhoto(key);
    }
  }, 30000);

  it("rejects invalid data before upload", async () => {
    await expect(
      storage.put(Buffer.from("not an image"), "image/png"),
    ).rejects.toThrow("signature");
  });
});
