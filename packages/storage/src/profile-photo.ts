import sharp from "sharp";
import {
  MAX_PROFILE_PHOTO_BYTES,
  validateProfilePhoto,
} from "./file-policy.js";

const MAX_INPUT_PIXELS = 16_000_000;
const MAX_OUTPUT_DIMENSION = 512;
const MAX_CONCURRENT_DECODES = 2;
const DECODE_TIMEOUT_SECONDS = 10;
const OUTPUT_CONTENT_TYPE = "image/jpeg";

let activeDecodes = 0;

// libvips can read the default image of an APNG without exposing all frames.
// Reject animation control chunks before decoding any PNG.
function assertStaticPng(bytes: Buffer): void {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Invalid PNG chunk");
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL" || type === "fcTL" || type === "fdAT")
      throw new Error("Animated profile photos are unsupported");
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length)
        throw new Error("Invalid PNG end");
      return;
    }
    offset = end;
  }
  throw new Error("Invalid PNG end");
}

export class ProfilePhotoBusyError extends Error {
  constructor() {
    super("Profile photo decoder is busy");
    this.name = "ProfilePhotoBusyError";
  }
}

export async function normalizeProfilePhoto(
  bytes: Uint8Array,
  contentType: string,
): Promise<{ bytes: Buffer; contentType: "image/jpeg" }> {
  validateProfilePhoto(contentType, bytes);
  if (activeDecodes >= MAX_CONCURRENT_DECODES)
    throw new ProfilePhotoBusyError();

  activeDecodes += 1;
  try {
    const input = Buffer.from(bytes);
    if (contentType === "image/png") assertStaticPng(input);
    const image = sharp(input, {
      failOn: "warning",
      limitInputPixels: MAX_INPUT_PIXELS,
      limitInputChannels: 4,
      unlimited: false,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const expected = contentType === "image/png" ? "png" : "jpeg";
    if (
      metadata.format !== expected ||
      (metadata.pages ?? 1) !== 1 ||
      metadata.width < 1 ||
      metadata.height < 1 ||
      metadata.width * metadata.height > MAX_INPUT_PIXELS
    ) {
      throw new Error("Invalid profile photo dimensions or format");
    }

    // Do not retain source EXIF, ICC, IPTC or XMP metadata.
    const { data, info } = await image
      .autoOrient()
      .resize(MAX_OUTPUT_DIMENSION, MAX_OUTPUT_DIMENSION, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .timeout({ seconds: DECODE_TIMEOUT_SECONDS })
      .toBuffer({ resolveWithObject: true });
    if (
      data.byteLength > MAX_PROFILE_PHOTO_BYTES ||
      info.width > MAX_OUTPUT_DIMENSION ||
      info.height > MAX_OUTPUT_DIMENSION
    ) {
      throw new Error("Invalid processed profile photo");
    }
    validateProfilePhoto(OUTPUT_CONTENT_TYPE, data);
    return { bytes: data, contentType: OUTPUT_CONTENT_TYPE };
  } finally {
    activeDecodes -= 1;
  }
}
