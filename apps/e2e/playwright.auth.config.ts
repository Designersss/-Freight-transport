import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const databaseUrl = process.env.AUTH_BROWSER_DATABASE_URL;
const smtpPort = process.env.AUTH_BROWSER_SMTP_PORT;
const proxySecret = process.env.AUTH_BROWSER_PROXY_SECRET;
if (!databaseUrl || !smtpPort || !proxySecret)
  throw new Error("Run browser auth tests through Testcontainers");
if (!/^[0-9a-f]{64}$/.test(proxySecret))
  throw new Error("Invalid isolated browser proxy secret");
const database = new URL(databaseUrl);
if (
  database.hostname !== "127.0.0.1" ||
  database.pathname !== "/freight_auth_browser"
)
  throw new Error("Browser auth requires an isolated local database");

const api = "http://127.0.0.1:4110";
const web = "http://127.0.0.1:3110";
const admin = "http://127.0.0.1:3111";

export default defineConfig({
  testDir: "./auth-tests",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: web,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: [
    {
      command: "node apps/api/dist/main.js",
      cwd: root,
      url: `${api}/api/v1/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        LOG_LEVEL: "silent",
        API_HOST: "127.0.0.1",
        API_PORT: "4110",
        AUTH_ENABLED: "true",
        AUTH_BASE_URL: api,
        AUTH_WEB_ORIGIN: web,
        AUTH_SECRET: randomBytes(32).toString("hex"),
        AUTH_PROXY_SECRET: proxySecret,
        AUTH_ADMIN_ORIGIN: admin,
        AUTH_ADMIN_SECRET: randomBytes(32).toString("hex"),
        SMTP_HOST: "127.0.0.1",
        SMTP_PORT: smtpPort,
        SMTP_SECURITY: "local",
        SMTP_FROM: "auth@movaro.test",
      },
    },
    {
      command:
        "pnpm --filter @freight/web exec next start --hostname 127.0.0.1 --port 3110",
      cwd: root,
      url: `${web}/ru/login`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        AUTH_BASE_URL: api,
        AUTH_WEB_ORIGIN: web,
        MOVARO_AUTH_PREVIEW: "true",
        AUTH_PROXY_SECRET: proxySecret,
      },
    },
    {
      command:
        "pnpm --filter @freight/admin exec next dev --hostname 127.0.0.1 --port 3111",
      cwd: root,
      url: `${admin}/ru/login`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        AUTH_BASE_URL: api,
        AUTH_ADMIN_ORIGIN: admin,
        AUTH_PROXY_SECRET: proxySecret,
      },
    },
  ],
});
