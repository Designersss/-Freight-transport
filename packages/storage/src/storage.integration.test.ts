import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
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

  it("rejects invalid data before upload", async () => {
    await expect(
      storage.put(Buffer.from("not an image"), "image/png"),
    ).rejects.toThrow("signature");
  });
});
