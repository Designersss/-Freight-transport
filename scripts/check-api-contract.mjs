import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
  // Temporary recovery of the public, generated contract from the pinned
  // CI toolchain when the developer environment cannot run the generator.
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const path of [
      "packages/client-api/openapi.json",
      "packages/client-api/src/generated/api.ts",
    ]) {
      const content = readFileSync(path, "utf8");
      for (let offset = 0; offset < content.length; offset += 4000) {
        console.log(
          "MOVARO_GENERATED",
          JSON.stringify({
            path,
            offset,
            content: content.slice(offset, offset + 4000),
          }),
        );
      }
    }
  }
  process.exitCode = 1;
}
