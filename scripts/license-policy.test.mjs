import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAllowedLicense,
  isReviewedWorkspaceLicense,
} from "./license-policy.mjs";

const workspace = new Set(["workspace"]);
const compatibility = new Set(["compatibility-tests"]);

test("allows reviewed permissive licenses and exact alternatives", () => {
  for (const license of [
    "MIT",
    "Apache-2.0",
    "BlueOak-1.0.0",
    "Python-2.0",
    "Unlicense",
    "(MIT OR CC0-1.0)",
    "MIT OR Apache-2.0",
  ]) {
    assert.equal(isAllowedLicense("example@1.0.0", license, workspace), true);
  }
});

test("rejects unknown and unreviewed licenses or expressions", () => {
  for (const license of [
    "UNKNOWN",
    "GPL-3.0-only",
    "AGPL-3.0-only",
    "SSPL-1.0",
    "MIT AND GPL-3.0-only",
    "MIT OR GPL-3.0-only",
    "SEE LICENSE IN LICENSE",
  ]) {
    assert.equal(isAllowedLicense("example@1.0.0", license, workspace), false);
  }
});

test("limits missing-metadata exceptions to exact test dependencies", () => {
  assert.equal(isAllowedLicense("ssh2@1.17.0", "UNKNOWN", compatibility), true);
  assert.equal(
    isAllowedLicense("ssh2@1.18.0", "UNKNOWN", compatibility),
    false,
  );
  assert.equal(isAllowedLicense("ssh2@1.17.0", "UNKNOWN", workspace), false);
  assert.equal(
    isAllowedLicense(
      "ssh2@1.17.0",
      "UNKNOWN",
      new Set(["workspace", "compatibility-tests"]),
    ),
    false,
  );
  assert.equal(
    isAllowedLicense("ssh2@1.17.0", "GPL-3.0-only", compatibility),
    false,
  );
});

test("allows OFL only for reviewed Manrope package", () => {
  assert.equal(
    isAllowedLicense(
      "@fontsource-variable/manrope@5.3.0",
      "OFL-1.1",
      workspace,
    ),
    true,
  );
  assert.equal(
    isAllowedLicense(
      "@fontsource-variable/manrope@5.3.1",
      "OFL-1.1",
      workspace,
    ),
    false,
  );
  assert.equal(isAllowedLicense("example@1.0.0", "OFL-1.1", workspace), false);
});

test("allows only explicitly reviewed workspace versions and license metadata", () => {
  for (const [name, license] of [
    ["@swc/core-darwin-arm64@1.16.22", "Apache-2.0 AND MIT"],
    ["@swc/core-linux-x64-gnu@1.16.22", "Apache-2.0 AND MIT"],
    ["@swc/core-linux-arm64-gnu@1.16.22", "Apache-2.0 AND MIT"],
    ["caniuse-lite@1.0.30001828", "CC-BY-4.0"],
    ["lightningcss@1.33.0", "MPL-2.0"],
    ["lightningcss-darwin-arm64@1.33.0", "MPL-2.0"],
    ["lightningcss-linux-x64-gnu@1.33.0", "MPL-2.0"],
    ["lightningcss-linux-arm64-gnu@1.33.0", "MPL-2.0"],
    ["@img/sharp-libvips-darwin-arm64@1.3.4", "LGPL-3.0-or-later"],
    ["@img/sharp-libvips-linux-x64@1.3.4", "LGPL-3.0-or-later"],
    ["@img/sharp-libvips-linux-arm64@1.3.4", "LGPL-3.0-or-later"],
  ]) {
    assert.equal(isReviewedWorkspaceLicense(name, license, workspace), true);
    assert.equal(isAllowedLicense(name, license, workspace), true);
    assert.equal(isAllowedLicense(name, license, compatibility), false);
    assert.equal(
      isAllowedLicense(
        name,
        license,
        new Set(["workspace", "compatibility-tests"]),
      ),
      false,
    );
    assert.equal(isAllowedLicense(name, "GPL-3.0-only", workspace), false);
  }
});

test("rejects unreviewed packages, versions and architectures", () => {
  for (const [name, license] of [
    ["example@1.0.0", "Apache-2.0 AND MIT"],
    ["example@1.0.0", "CC-BY-4.0"],
    ["example@1.0.0", "MPL-2.0"],
    ["example@1.0.0", "LGPL-3.0-or-later"],
    ["@swc/core-darwin-arm64@1.16.23", "Apache-2.0 AND MIT"],
    ["caniuse-lite@1.0.30001829", "CC-BY-4.0"],
    ["lightningcss@1.34.0", "MPL-2.0"],
    ["lightningcss-win32-x64-msvc@1.33.0", "MPL-2.0"],
    ["@img/sharp-libvips-linux-x64@1.3.5", "LGPL-3.0-or-later"],
    ["@img/sharp-libvips-linuxmusl-x64@1.3.4", "LGPL-3.0-or-later"],
  ]) {
    assert.equal(isAllowedLicense(name, license, workspace), false);
  }
});

test("allows reviewed argparse version only", () => {
  assert.equal(isAllowedLicense("argparse@3.0.4", "PSF-2.0", workspace), true);
  assert.equal(isAllowedLicense("argparse@3.0.5", "PSF-2.0", workspace), false);
});
