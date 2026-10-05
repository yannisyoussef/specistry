import { describe, expect, it } from "vitest";

import {
  createMemoryAcquisition,
  ingestOpenApi,
} from "../../packages/openapi/src/index.js";

const project = { name: "Security" };

describe("malicious source controls", () => {
  it("does not evaluate script-looking content and keeps it as inert data", async () => {
    const marker = "<script>globalThis.compromised = true</script>";
    const result = await ingestOpenApi({
      project,
      sources: [
        createMemoryAcquisition("openapi.yaml", {
          "openapi.yaml": `openapi: 3.1.0\ninfo:\n  title: Safe text\n  version: v1\n  description: ${JSON.stringify(marker)}\npaths: {}`,
        }),
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.artifact?.model.versions[0]?.services[0]?.description).toBe(
      marker,
    );
    expect("compromised" in globalThis).toBe(false);
  });

  it("rejects YAML aliases to avoid expansion attacks", async () => {
    const result = await ingestOpenApi({
      project,
      sources: [
        createMemoryAcquisition("openapi.yaml", {
          "openapi.yaml":
            "openapi: 3.1.0\ninfo: &info { title: Safe, version: v1 }\npaths: {}\ncopy: *info",
        }),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "SOURCE_PARSE_FAILED",
    ]);
  });
});
