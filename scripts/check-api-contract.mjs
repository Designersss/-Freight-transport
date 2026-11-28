import { execFileSync } from "node:child_process";

const paths = [
  "packages/client-api/openapi.json",
  "packages/client-api/src/generated",
];
const status = execFileSync(
  "git",
  ["status", "--porcelain", "--untracked-files=all", "--", ...paths],
  { encoding: "utf8" },
);
if (status.trim()) {
  console.error(
    "OpenAPI or generated client is outdated. Run pnpm api:generate and commit the result.",
  );
  console.error(status);
  console.error(
    execFileSync("git", ["diff", "--no-ext-diff", "--", ...paths], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    }),
  );
  process.exitCode = 1;
}
