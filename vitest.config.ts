import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      autoAttachSubprocess: true,
      exclude: [
        "packages/cli/src/bin.ts",
        "packages/cli/src/config-worker.ts",
        "packages/cli/src/ingestion-host.ts",
        "**/*.test-helper.ts",
      ],
      include: ["packages/*/src/**/*.ts"],
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
    include: ["packages/**/*.test.ts", "tests/**/*.test.{ts,tsx}"],
    reporters: ["default"],
    testTimeout: 10_000,
  },
});
