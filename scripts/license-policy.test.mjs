import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedLicense } from "./license-policy.mjs";

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
