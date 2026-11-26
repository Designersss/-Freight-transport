import { randomUUID } from "node:crypto";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type AllowedContentType = "image/jpeg" | "image/png" | "application/pdf";

const signatures: Record<AllowedContentType, readonly number[]> = {
  "image/jpeg": [255, 216, 255],
  "image/png": [137, 80, 78, 71, 13, 10, 26, 10],
  "application/pdf": [37, 80, 68, 70, 45],
};

export function validateFile(
  contentType: string,
  bytes: Uint8Array,
): asserts contentType is AllowedContentType {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) {
    throw new Error("Invalid file size");
  }
  if (
    contentType !== "image/jpeg" &&
    contentType !== "image/png" &&
    contentType !== "application/pdf"
  ) {
    throw new Error("Unsupported file content type");
  }
  if (!signatures[contentType].every((byte, index) => bytes[index] === byte)) {
    throw new Error("File signature does not match content type");
  }
}

export function createObjectKey(): string {
  return `files/${randomUUID()}`;
}

export function assertObjectKey(key: string): void {
  if (
    !/^files\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      key,
    )
  ) {
    throw new Error("Invalid object key");
  }
}
