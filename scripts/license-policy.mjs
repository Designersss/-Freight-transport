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

export function isAllowedLicense(name, license, sources) {
  if (allowedLicenses.has(license)) return true;
  if (
    name === "@fontsource-variable/manrope@5.3.0" &&
    license === "OFL-1.1" &&
    sources.size === 1 &&
    sources.has("workspace")
  ) return true;
  return (
    license === "UNKNOWN" &&
    reviewedUnknown.has(name) &&
    sources.size === 1 &&
    sources.has("compatibility-tests")
  );
}
