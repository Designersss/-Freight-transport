import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

const databaseName = "freight_auth_compat";
const container = await new PostgreSqlContainer("postgres:17")
  .withDatabase(databaseName)
  .withUsername("freight")
  .withPassword(randomBytes(24).toString("hex"))
  .start();

try {
  const url = new URL(container.getConnectionUri());
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  if (url.hostname !== "127.0.0.1") {
    throw new Error("Compatibility test requires a local Docker host");
  }
  execFileSync("pnpm", ["db:deploy"], {
    env: { ...process.env, DATABASE_URL: url.href },
    stdio: "inherit",
    timeout: 120_000,
  });
  execFileSync(
    process.execPath,
    [
      "--test",
      "--test-concurrency=1",
      fileURLToPath(new URL("./auth-schema.test.mjs", import.meta.url)),
      fileURLToPath(new URL("./compat.test.mjs", import.meta.url)),
      fileURLToPath(new URL("./email-less-oauth.test.mjs", import.meta.url)),
    ],
    {
      env: { ...process.env, AUTH_COMPAT_DATABASE_URL: url.href },
      stdio: "inherit",
      timeout: 120_000,
    },
  );
} finally {
  await container.stop();
}
