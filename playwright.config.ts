import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Browser suites run against the production reader (`next start`) serving
 * the committed TestInbox fixture on port 3100; a second instance of the same
 * build serves the adversarial edge fixture on port 3101 for XSS and
 * long-content checks. `SPECRA_SITE_URL` is set on the first so canonical and
 * sitemap URLs are absolute and testable. Desktop and mobile reader suites are
 * separate files so each runs under one device profile. The `visual` project keeps its
 * Linux-only baselines under `tests/visual/__screenshots__`; see
 * `docs/development/testing.md` for the update procedure.
 */
const fixtureProject = path.resolve("tests/fixtures/reader/testinbox");
/** The adversarial fixture is served by a second reader on port 3101. */
const edgeProject = path.resolve("tests/fixtures/reader/edge");
export const EDGE_URL = "http://127.0.0.1:3101";
/** The fake target APIs the TestInbox playground is approved to reach. */
export const TARGET_URL = "http://127.0.0.1:47391";
export const STRICT_TARGET_URL = "http://127.0.0.1:47392";

export default defineConfig({
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      // Both limits apply: tiny anti-aliasing drift passes, a moved element or
      // changed colour fails even on a small viewport.
      maxDiffPixelRatio: 0.01,
      maxDiffPixels: 2_500,
      scale: "css",
    },
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  projects: [
    {
      name: "chromium-desktop",
      testDir: "./tests/e2e",
      testIgnore: /reader-mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      testDir: "./tests/e2e",
      testIgnore: /(?:reader|content|search)\.spec\.ts/,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "visual",
      testDir: "./tests/visual",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  retries: process.env.CI ? 1 : 0,
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  timeout: 20_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @specra/web start",
      env: {
        PORT: "3100",
        SPECRA_PROJECT_ROOT: fixtureProject,
        SPECRA_SITE_URL: "https://docs.example.test",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      url: "http://127.0.0.1:3100",
    },
    {
      command: "pnpm --filter @specra/web start",
      env: { PORT: "3101", SPECRA_PROJECT_ROOT: edgeProject },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      url: EDGE_URL,
    },
    // The playground's fake target APIs (SPEC-009): one answers CORS, one
    // refuses it. Neither is ever reached by the reader server.
    {
      command: "node tests/support/playground-api.mjs 47391 allow",
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      url: `${TARGET_URL}/__health`,
    },
    {
      command: "node tests/support/playground-api.mjs 47392 deny",
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      url: `${STRICT_TARGET_URL}/__health`,
    },
  ],
});
