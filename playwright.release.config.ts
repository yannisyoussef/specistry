import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const fixture = path.resolve("tests/fixtures/reader/testinbox");

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  reporter: process.env.CI ? "line" : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "./tests/release",
  timeout: 20_000,
  use: {
    baseURL: "http://127.0.0.1:3110",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @specra/web start",
    env: {
      PORT: "3110",
      SPECRA_PROJECT_ROOT: fixture,
      SPECRA_SITE_URL: "https://docs.example.test",
    },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    url: "http://127.0.0.1:3110/readyz",
  },
});
