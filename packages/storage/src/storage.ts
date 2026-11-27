import { addAbortSignal, Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { StorageConfig } from "./config.js";
import {
  type AllowedContentType,
  assertObjectKey,
  assertProfilePhotoKey,
  createObjectKey,
  createProfilePhotoKey,
  MAX_FILE_BYTES,
  MAX_PROFILE_PHOTO_BYTES,
  type ProfilePhotoContentType,
  validateFile,
  validateProfilePhoto,
} from "./file-policy.js";

const REQUEST_TIMEOUT_MS = 15000;

export class PrivateStorage {
  private readonly client: S3Client;

  constructor(private readonly config: StorageConfig) {
    this.client = new S3Client({
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
  }

  async checkReadiness(): Promise<void> {
    await this.client.send(
      new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }),
      { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
  }

  async put(
    bytes: Uint8Array,
    contentType: string,
  ): Promise<{ key: string; contentType: AllowedContentType; size: number }> {
    validateFile(contentType, bytes);
    const key = createObjectKey();
    await this.write(key, bytes, contentType);
    return { key, contentType, size: bytes.byteLength };
  }

  private async write(
    key: string,
    bytes: Uint8Array,
    contentType: AllowedContentType,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        ContentLength: bytes.byteLength,
      }),
      { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
  }

  async putProfilePhoto(
    bytes: Uint8Array,
    contentType: string,
  ): Promise<{
    key: string;
    contentType: ProfilePhotoContentType;
    size: number;
  }> {
    validateProfilePhoto(contentType, bytes);
    const key = createProfilePhotoKey();
    await this.write(key, bytes, contentType);
    return { key, contentType, size: bytes.byteLength };
  }

  async get(
    key: string,
  ): Promise<{ bytes: Uint8Array; contentType: AllowedContentType }> {
    assertObjectKey(key);
    return this.read(key, MAX_FILE_BYTES);
  }

  async getProfilePhoto(
    key: string,
  ): Promise<{ bytes: Uint8Array; contentType: ProfilePhotoContentType }> {
    assertProfilePhotoKey(key);
    const { bytes, contentType } = await this.read(
      key,
      MAX_PROFILE_PHOTO_BYTES,
    );
    validateProfilePhoto(contentType, bytes);
    return { bytes, contentType };
  }

  private async read(
    key: string,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; contentType: AllowedContentType }> {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
      { abortSignal: signal },
    );
    const body = result.Body;
    if (!(body instanceof Readable))
      throw new Error("Missing Node.js object stream");
    try {
      addAbortSignal(signal, body);
      if (
        result.ContentLength !== undefined &&
        (result.ContentLength < 1 || result.ContentLength > maxBytes)
      ) {
        throw new Error("Invalid stored file size");
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of body) {
        if (!Buffer.isBuffer(chunk))
          throw new Error("Invalid object stream chunk");
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error("Invalid stored file size");
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks, size);
      const contentType = result.ContentType ?? "";
      validateFile(contentType, bytes);
      return { bytes, contentType };
    } finally {
      body.destroy();
    }
  }

  async delete(key: string): Promise<void> {
    assertObjectKey(key);
    await this.remove(key);
  }

  async deleteProfilePhoto(key: string): Promise<void> {
    assertProfilePhotoKey(key);
    await this.remove(key);
  }

  private async remove(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
      { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
  }

  close(): void {
    this.client.destroy();
  }
}
