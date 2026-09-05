import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { parseOpenApiSource } from "../../packages/openapi/src/index.js";

describe("OpenAPI ingestion smoke budget", () => {
  it("parses a synthetic 1,000-operation document within the Phase 0 budget", () => {
    const paths = Object.fromEntries(
      Array.from({ length: 1_000 }, (_, index) => [
        `/things/${index}`,
        {
          get: {
            operationId: `getThing${index}`,
            responses: { "200": { description: "ok" } },
          },
        },
      ]),
    );
    const source = JSON.stringify({
      info: { title: "Large", version: "v1" },
      openapi: "3.1.0",
      paths,
    });
    const started = performance.now();
    parseOpenApiSource(source, { id: "large", kind: "memory" });
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
