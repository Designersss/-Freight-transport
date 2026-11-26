import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isAllowedLicense,
  isReviewedWorkspaceLicense,
} from "./license-policy.mjs";

const enforce = process.argv.includes("--check");

function directories(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => join(path, entry.name));
}

function packageDirectories(path) {
  return directories(path).flatMap((entry) =>
    entry.split("/").at(-1).startsWith("@") ? directories(entry) : [entry],
  );
}

function collect(path, inventory, source) {
  const manifestPath = join(path, "package.json");
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!manifest.name || !manifest.version) {
    throw new Error(`Invalid package manifest: ${manifestPath}`);
  }
  const license =
    typeof manifest.license === "string" && manifest.license.trim()
      ? manifest.license.trim()
      : "UNKNOWN";
  const key = `${manifest.name}@${manifest.version}`;
  const previous = inventory.get(key);
  if (previous && previous.license !== license) {
    throw new Error(`Conflicting license metadata for ${key}`);
  }
  if (previous) {
    previous.sources.add(source);
  } else {
    inventory.set(key, { license, sources: new Set([source]) });
  }
  const nested = join(path, "node_modules");
  if (existsSync(nested)) {
    for (const entry of packageDirectories(nested)) {
      collect(entry, inventory, source);
    }
  }
}

const inventory = new Map();
for (const entry of directories("node_modules/.pnpm")) {
  const modules = join(entry, "node_modules");
  if (!existsSync(modules)) continue;
  for (const path of packageDirectories(modules)) {
    collect(path, inventory, "workspace");
  }
}
const workspaceCount = inventory.size;
if (!workspaceCount) throw new Error("No installed workspace packages found");

for (const path of packageDirectories("scripts/auth-compat/node_modules")) {
  collect(path, inventory, "compatibility-tests");
}
if (
  ![...inventory.values()].some((item) =>
    item.sources.has("compatibility-tests"),
  )
) {
  throw new Error("No installed compatibility test packages found");
}

const groups = new Map();
const violations = [];
const releaseReview = [];
for (const [name, item] of [...inventory.entries()].sort()) {
  const group = groups.get(item.license) ?? [];
  group.push(name);
  groups.set(item.license, group);
}
for (const [license, packages] of [...groups.entries()].sort()) {
  console.log(`LICENSE ${license}: ${packages.length}`);
  for (const name of packages) {
    const item = inventory.get(name);
    if (!isAllowedLicense(name, license, item.sources)) {
      violations.push(name);
      console.log(`REVIEW ${license}: ${name}`);
    } else if (isReviewedWorkspaceLicense(name, license, item.sources)) {
      releaseReview.push(name);
      console.log(
        `REVIEWED FOR DEVELOPMENT; RELEASE REVIEW ${license}: ${name}`,
      );
    } else if (license === "UNKNOWN") {
      console.log(`REVIEWED EXCEPTION ${license}: ${name}`);
    }
  }
}
console.log(`Unique installed packages: ${inventory.size}`);
console.log(`Workspace packages: ${workspaceCount}`);
console.log(`Unreviewed packages: ${violations.length}`);
console.log(
  `Development-reviewed packages requiring release review: ${releaseReview.length}`,
);
if (enforce && violations.length > 0) process.exitCode = 1;
