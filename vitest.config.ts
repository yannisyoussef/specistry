import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      autoAttachSubprocess: true,
      exclude: [
        "packages/cli/src/bin.ts",
        "packages/cli/src/config-worker.ts",
        "packages/cli/src/ingestion-host.ts",
        "**/*.test-helper.ts",
        // Client islands and route files are exercised by the Playwright
        // suites against the production server, not by in-process rendering.
        "apps/web/components/reader/copy-button.tsx",
        "apps/web/components/reader/mobile-nav.tsx",
        "apps/web/components/reader/content/tabs.tsx",
      ],
      include: [
        "packages/*/src/**/*.ts",
        "apps/web/lib/**/*.ts",
        "apps/web/components/**/*.tsx",
      ],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 75,
        functions: 90,
        lines: 80,
        statements: 80,
        "packages/cli/src/**/*.ts": {
          branches: 75,
          functions: 95,
          lines: 85,
          statements: 85,
        },
      },
    },
    environment: "node",
    exclude: [...configDefaults.exclude, "tests/performance/**"],
    include: ["packages/**/*.test.ts", "tests/**/*.test.{ts,tsx}"],
    reporters: ["default"],
    testTimeout: 10_000,
  },
});
