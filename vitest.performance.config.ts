import { defineConfig } from "vitest/config";

/**
 * Resource and performance evidence. These cases spawn fresh processes and run
 * multi-second workloads, so they live in their own CI job and are excluded
 * from the fast test run and from coverage instrumentation.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/performance/**/*.test.ts"],
    reporters: ["default"],
    testTimeout: 180_000,
  },
});
