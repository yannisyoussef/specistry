import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    environment: "node",
    include: ["packages/**/*.test.ts", "tests/**/*.test.{ts,tsx}"],
    reporters: ["default"],
    testTimeout: 10_000,
  },
});
