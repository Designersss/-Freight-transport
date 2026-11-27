import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { GenericContainer, Wait } from "testcontainers";

const databaseName = "freight_auth_compat";
const container = await new PostgreSqlContainer("postgres:17")
  .withDatabase(databaseName)
  .withUsername("freight")
  .withPassword(randomBytes(24).toString("hex"))
  .start();

let mailpit;
try {
  mailpit = await new GenericContainer("axllent/mailpit:v1.34.0")
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp("/livez", 8025))
    .start();
  if (!["localhost", "127.0.0.1"].includes(mailpit.getHost()))
    throw new Error("Mailpit requires local Docker host");
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
      fileURLToPath(new URL("./email-auth-http.test.mjs", import.meta.url)),
      fileURLToPath(new URL("./email-less-oauth.test.mjs", import.meta.url)),
      fileURLToPath(
        new URL("./profile-photo-record.test.mjs", import.meta.url),
      ),
    ],
    {
      env: {
        ...process.env,
        AUTH_COMPAT_DATABASE_URL: url.href,
        AUTH_COMPAT_SMTP_PORT: String(mailpit.getMappedPort(1025)),
        AUTH_COMPAT_MAILPIT_PORT: String(mailpit.getMappedPort(8025)),
      },
      stdio: "inherit",
      timeout: 120_000,
    },
  );
  const browserDatabase = "freight_auth_browser";
  const created = await container.exec([
    "createdb",
    "-U",
    "freight",
    browserDatabase,
  ]);
  if (created.exitCode !== 0)
    throw new Error("Cannot create isolated browser auth database");
  const browserUrl = new URL(url);
  browserUrl.pathname = `/${browserDatabase}`;
  execFileSync("pnpm", ["db:deploy"], {
    env: { ...process.env, DATABASE_URL: browserUrl.href },
    stdio: "inherit",
    timeout: 120_000,
  });
  const browserEnv = { ...process.env };
  delete browserEnv.SMTP_USER;
  delete browserEnv.SMTP_PASSWORD;
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@freight/e2e",
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.auth.config.ts",
    ],
    {
      env: {
        ...browserEnv,
        AUTH_BROWSER_DATABASE_URL: browserUrl.href,
        AUTH_BROWSER_SMTP_PORT: String(mailpit.getMappedPort(1025)),
        AUTH_BROWSER_MAILPIT_PORT: String(mailpit.getMappedPort(8025)),
      },
      stdio: "inherit",
      timeout: 240_000,
    },
  );
} finally {
  try {
    await mailpit?.stop();
  } finally {
    await container.stop();
  }
}
