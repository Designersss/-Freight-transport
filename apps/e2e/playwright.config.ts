import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "chromium-mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    {
      command: "pnpm --filter @freight/web exec next start --hostname 127.0.0.1 --port 3100",
      cwd: root,
      port: 3100,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @freight/admin exec next dev --hostname 127.0.0.1 --port 3101",
      cwd: root,
      port: 3101,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @freight/admin exec next start --hostname 127.0.0.1 --port 3102",
      cwd: root,
      port: 3102,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @freight/storybook exec vite preview --outDir storybook-static --host 127.0.0.1 --port 6106 --strictPort",
      cwd: root,
      port: 6106,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
