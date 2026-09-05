import { describe, expect, it } from "vitest";

import { fixtureText } from "./fixtures.test-helper.js";
import { DEFAULT_PARSE_LIMITS } from "./limits.js";
import { detectOpenApiVersion, dialectOf, parseDocument } from "./parse.js";
import { classifyReference } from "./references.js";

describe("bounded document parsing", () => {
  it("parses every corpus fixture that is well-formed and detects its version", () => {
    for (const [name, version] of [
      ["recursive.yaml", "3.1.0"],
      ["openapi-3.0.yaml", "3.0.3"],
      ["polymorphism.yaml", "3.1.0"],
      ["invalid-ref.yaml", "3.1.0"],
      ["malicious.yaml", "3.1.0"],
    ] as const) {
      const outcome = parseDocument(fixtureText(name));
      expect(outcome.ok, name).toBe(true);
      if (!outcome.ok) continue;
      expect(detectOpenApiVersion(outcome.value)).toBe(version);
      expect(dialectOf(version)).toBe(
        version.startsWith("3.1") ? "oas31" : "oas30",
      );
    }
  });

  it("rejects unsupported versions without inventing a dialect", () => {
    const outcome = parseDocument(
      "openapi: 2.0.0\ninfo: { title: no, version: v1 }",
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(detectOpenApiVersion(outcome.value)).toBeUndefined();
  });

  it("enforces byte, depth, node, string, and limit-configuration bounds", () => {
    const limits = {
      maxBytes: 10_000,
      maxDepth: 10,
      maxNodes: 100,
      maxStringBytes: 100,
    };
    expect(
      parseDocument("openapi: 3.1.0", {
        maxBytes: 4,
        maxDepth: 10,
        maxNodes: 10,
        maxStringBytes: 10,
      }),
    ).toEqual({ failure: { budget: "bytes", kind: "limit" }, ok: false });
    expect(
      parseDocument(
        JSON.stringify({ openapi: "3.1.0", x: { y: { z: true } } }),
        {
          ...limits,
          maxDepth: 2,
        },
      ),
    ).toEqual({ failure: { budget: "depth", kind: "limit" }, ok: false });
    expect(
      parseDocument(JSON.stringify({ openapi: "3.1.0", x: [1, 2, 3] }), {
        ...limits,
        maxNodes: 3,
      }),
    ).toEqual({ failure: { budget: "nodes", kind: "limit" }, ok: false });
    expect(
      parseDocument(
        JSON.stringify({ openapi: "3.1.0", x: "description-is-too-long" }),
        { ...limits, maxStringBytes: 10 },
      ),
    ).toEqual({ failure: { budget: "string", kind: "limit" }, ok: false });
    expect(parseDocument("openapi: 3.1.0", { ...limits, maxDepth: 0 })).toEqual(
      { failure: { kind: "invalid-limits" }, ok: false },
    );
    expect(DEFAULT_PARSE_LIMITS.maxBytes).toBe(10 * 1024 * 1024);
  });

  it("rejects non-finite YAML numbers, aliases, and non-object roots, and freezes parsed data", () => {
    expect(parseDocument("openapi: 3.1.0\nx-value: .inf")).toEqual({
      failure: { kind: "non-finite" },
      ok: false,
    });
    expect(
      parseDocument(
        "openapi: 3.1.0\ninfo: &info { title: Safe, version: v1 }\npaths: {}\ncopy: *info",
      ),
    ).toEqual({ failure: { kind: "syntax" }, ok: false });
    expect(parseDocument("- just\n- a list")).toEqual({
      failure: { kind: "not-object" },
      ok: false,
    });
    const outcome = parseDocument(
      "openapi: 3.1.0\ninfo: { title: T, version: v1 }",
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(Object.isFrozen(outcome.value.info)).toBe(true);
  });
});

describe("reference classification", () => {
  it("classifies local, document, remote, and unsupported references", () => {
    expect(classifyReference("#/components/schemas/Thing")).toBe("fragment");
    expect(classifyReference("./common.yaml#/Thing")).toBe("document");
    expect(classifyReference("https://example.com/common.yaml#/Thing")).toBe(
      "remote",
    );
    expect(classifyReference("http://169.254.169.254/latest/meta-data")).toBe(
      "remote",
    );
    expect(classifyReference("file:///etc/passwd")).toBe("unsupported");
    expect(classifyReference("//169.254.169.254/latest/meta-data")).toBe(
      "unsupported",
    );
  });
});
