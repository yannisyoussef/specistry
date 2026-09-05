import { describe, expect, it } from "vitest";

import { parseOpenApiSource } from "../../packages/openapi/src/index.js";

describe("malicious source controls", () => {
  it("does not evaluate script-looking content", () => {
    const marker = "<script>globalThis.compromised = true</script>";
    const result = parseOpenApiSource(
      `openapi: 3.1.0\ninfo:\n  title: Safe text\n  version: v1\n  description: ${JSON.stringify(marker)}\npaths: {}`,
      { id: "malicious", kind: "memory" },
    );
    const info = result.document.info as Record<string, unknown>;
    expect(info.description).toBe(marker);
    expect("compromised" in globalThis).toBe(false);
  });

  it("rejects YAML aliases to avoid expansion attacks", () => {
    expect(() =>
      parseOpenApiSource(
        "openapi: 3.1.0\ninfo: &info { title: Safe, version: v1 }\npaths: {}\ncopy: *info",
        { id: "aliases", kind: "memory" },
      ),
    ).toThrow();
  });
});
