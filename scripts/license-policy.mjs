const allowedLicenses = new Set([
  "(MIT OR CC0-1.0)",
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "ISC",
  "MIT",
  "MIT OR Apache-2.0",
  "PostgreSQL",
  "Python-2.0",
  "Unlicense",
]);

// Reviewed upstream LICENSE files, exact versions, test dependencies only.
// See docs/third-party-licenses.md for evidence and obligations.
const reviewedUnknown = new Set([
  "buildcheck@0.0.7",
  "cpu-features@0.0.10",
  "ssh2@1.17.0",
]);

// Exact workspace versions reviewed for development and CI, not for redistribution.
// See docs/third-party-licenses.md for outstanding release obligations.
const reviewedWorkspace = new Map([
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
]);

export function isReviewedWorkspaceLicense(name, license, sources) {
  return (
    sources.size === 1 &&
    sources.has("workspace") &&
    reviewedWorkspace.get(name) === license
  );
}

export function isAllowedLicense(name, license, sources) {
  if (allowedLicenses.has(license)) return true;
  if (isReviewedWorkspaceLicense(name, license, sources)) return true;
  if (
    name === "@fontsource-variable/manrope@5.3.0" &&
    license === "OFL-1.1" &&
    sources.size === 1 &&
    sources.has("workspace")
  )
    return true;
  return (
    license === "UNKNOWN" &&
    reviewedUnknown.has(name) &&
    sources.size === 1 &&
    sources.has("compatibility-tests")
  );
}
