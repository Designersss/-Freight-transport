import { expect, test } from "@playwright/test";

test("web exposes install metadata and valid icons in both locales", async ({
  page,
}) => {
  for (const locale of ["ru", "en"]) {
    await page.goto(`/${locale}/login`);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      "href",
      "/manifest.webmanifest",
    );
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/pwa/apple-touch-icon.png",
    );
  }

  const response = await page.request.get("/manifest.webmanifest", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain(
    "application/manifest+json",
  );
  expect(await response.json()).toMatchObject({
    id: "/",
    name: "MOVARO",
    short_name: "MOVARO",
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [
      {
        src: "/pwa/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  });

  for (const icon of [
    { path: "/pwa/icon-192.png", size: 192 },
    { path: "/pwa/icon-512.png", size: 512 },
    { path: "/pwa/apple-touch-icon.png", size: 180 },
  ]) {
    const asset = await page.request.get(icon.path, { maxRedirects: 0 });
    expect(asset.status()).toBe(200);
    expect(asset.headers()["content-type"]).toContain("image/png");
    const bytes = await asset.body();
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(bytes.readUInt32BE(16)).toBe(icon.size);
    expect(bytes.readUInt32BE(20)).toBe(icon.size);
  }

  await page.goto("/");
  await expect(page).toHaveURL(/\/ru$/);
});
