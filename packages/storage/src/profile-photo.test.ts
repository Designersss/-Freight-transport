import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_PROFILE_PHOTO_BYTES } from "./file-policy.js";
import {
  normalizeProfilePhoto,
  ProfilePhotoBusyError,
} from "./profile-photo.js";

function fixture(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 4, background: "#12345680" },
  });
}

describe("Profile photo normalization", () => {
  it("resizes PNG, flattens transparency and stores JPEG", async () => {
    const input = await fixture(1024, 512).png().toBuffer();
    const output = await normalizeProfilePhoto(input, "image/png");
    const metadata = await sharp(output.bytes).metadata();
    expect(output.contentType).toBe("image/jpeg");
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(256);
    expect(metadata.hasAlpha).toBe(false);
    expect(output.bytes.length).toBeLessThanOrEqual(MAX_PROFILE_PHOTO_BYTES);
  });

  it("applies EXIF orientation without retaining EXIF or enlarging", async () => {
    const input = await fixture(120, 60)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const original = await sharp(input).metadata();
    expect(original.orientation).toBe(6);
    expect(original.exif).toBeDefined();
    const output = await normalizeProfilePhoto(input, "image/jpeg");
    const metadata = await sharp(output.bytes).metadata();
    expect(metadata.width).toBe(60);
    expect(metadata.height).toBe(120);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it("rejects oversized dimensions, forged signatures and corrupt input", async () => {
    const oversized = await fixture(4001, 4000).png().toBuffer();
    await expect(
      normalizeProfilePhoto(oversized, "image/png"),
    ).rejects.toThrow();
    await expect(
      normalizeProfilePhoto(Buffer.from([255, 216, 255]), "image/jpeg"),
    ).rejects.toThrow();
    const png = await fixture(20, 20).png().toBuffer();
    await expect(normalizeProfilePhoto(png, "image/jpeg")).rejects.toThrow();
    await expect(
      normalizeProfilePhoto(png.subarray(0, png.length - 8), "image/png"),
    ).rejects.toThrow();
  });

  it("rejects PNG animation control chunks before decoding", async () => {
    const png = await fixture(20, 20).png().toBuffer();
    // Insert an acTL control chunk after IHDR. The parser must reject it
    // even before a decoder would verify its CRC or frame data.
    const control = Buffer.from(
      "000000086163544c000000020000000000000000",
      "hex",
    );
    const animated = Buffer.concat([
      png.subarray(0, 33),
      control,
      png.subarray(33),
    ]);
    await expect(normalizeProfilePhoto(animated, "image/png")).rejects.toThrow(
      "Animated profile photos",
    );
  });

  it("bounds concurrent decoding and releases capacity", async () => {
    const input = await fixture(1024, 1024).png().toBuffer();
    const first = normalizeProfilePhoto(input, "image/png");
    const second = normalizeProfilePhoto(input, "image/png");
    try {
      await expect(
        normalizeProfilePhoto(input, "image/png"),
      ).rejects.toBeInstanceOf(ProfilePhotoBusyError);
    } finally {
      await Promise.all([first, second]);
    }
    await expect(
      normalizeProfilePhoto(input, "image/png"),
    ).resolves.toMatchObject({
      contentType: "image/jpeg",
    });
  });
});
