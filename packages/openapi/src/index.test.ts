import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { OpenApiIngestionError } from "./index.js";
import {
  assertReferenceAllowed,
  classifyReference,
  parseOpenApiSource,
} from "./index.js";

const fixture = (name: string): string =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../tests/fixtures/openapi/${name}`, import.meta.url),
    ),
    "utf8",
  );

describe("parseOpenApiSource", () => {
  it("accepts OpenAPI 3.1 recursive schemas without traversing references", () => {
    const result = parseOpenApiSource(fixture("recursive.yaml"), {
      id: "recursive",
      kind: "file",
    });
    expect(result.openapiVersion).toBe("3.1.0");
    expect(result.format).toBe("openapi");
  });

  it.each([
    ["openapi-3.0.yaml", "3.0.3"],
    ["polymorphism.yaml", "3.1.0"],
    ["invalid-ref.yaml", "3.1.0"],
    ["malicious.yaml", "3.1.0"],
  ])(
    "keeps the %s fixture parseable at the source boundary",
    (name, version) => {
      expect(
        parseOpenApiSource(fixture(name), { id: name, kind: "file" })
          .openapiVersion,
      ).toBe(version);
    },
  );

  it("rejects unsupported versions with non-sensitive diagnostics", () => {
    expect(() =>
      parseOpenApiSource("openapi: 2.0.0\ninfo: { title: no, version: v1 }", {
        id: "unsupported",
        kind: "memory",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<OpenApiIngestionError>>({
        code: "UNSUPPORTED_VERSION",
      }),
    );
  });

  it("enforces byte, depth, node, string, and limit-configuration bounds", () => {
    const limits = {
      maxBytes: 10_000,
      maxDepth: 10,
      maxNodes: 100,
      maxStringBytes: 100,
    };
    expect(() =>
      parseOpenApiSource(
        "openapi: 3.1.0",
        { id: "large", kind: "memory" },
        {
          maxBytes: 4,
          maxDepth: 10,
          maxNodes: 10,
          maxStringBytes: 10,
        },
      ),
    ).toThrowError(
      expect.objectContaining<Partial<OpenApiIngestionError>>({
        code: "LIMIT_EXCEEDED",
      }),
    );
    expect(() =>
      parseOpenApiSource(
        JSON.stringify({ openapi: "3.1.0", x: { y: { z: true } } }),
        { id: "deep", kind: "memory" },
        { ...limits, maxDepth: 2 },
      ),
    ).toThrowError(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(() =>
      parseOpenApiSource(
        JSON.stringify({ openapi: "3.1.0", x: [1, 2, 3] }),
        { id: "wide", kind: "memory" },
        { ...limits, maxNodes: 3 },
      ),
    ).toThrowError(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(() =>
      parseOpenApiSource(
        JSON.stringify({ openapi: "3.1.0", x: "description-is-too-long" }),
        { id: "string", kind: "memory" },
        { ...limits, maxStringBytes: 10 },
      ),
    ).toThrowError(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
    expect(() =>
      parseOpenApiSource(
        "openapi: 3.1.0",
        { id: "invalid-limits", kind: "memory" },
        { ...limits, maxDepth: 0 },
      ),
    ).toThrowError(expect.objectContaining({ code: "LIMIT_EXCEEDED" }));
  });

  it("rejects non-finite YAML numbers and deeply freezes parsed data", () => {
    expect(() =>
      parseOpenApiSource("openapi: 3.1.0\nx-value: .inf", {
        id: "non-finite",
        kind: "memory",
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_DOCUMENT" }));

    const result = parseOpenApiSource(
      "openapi: 3.1.0\ninfo: { title: T, version: v1 }",
      { id: "frozen", kind: "memory" },
    );
    expect(Object.isFrozen(result.document.info)).toBe(true);
  });
});

describe("reference policy", () => {
  it("classifies local, document, and remote references", () => {
    expect(classifyReference("#/components/schemas/Thing")).toBe("fragment");
    expect(classifyReference("./common.yaml#/Thing")).toBe("document");
    expect(classifyReference("https://example.com/common.yaml#/Thing")).toBe(
      "remote",
    );
    expect(classifyReference("file:///etc/passwd")).toBe("unsupported");
    expect(classifyReference("//169.254.169.254/latest/meta-data")).toBe(
      "unsupported",
    );
  });

  it("requires an exact HTTPS origin policy for remote references", () => {
    expect(() =>
      assertReferenceAllowed("https://example.com/openapi.yaml"),
    ).toThrowError(
      expect.objectContaining<Partial<OpenApiIngestionError>>({
        code: "REMOTE_REFERENCE_DENIED",
      }),
    );
    expect(() =>
      assertReferenceAllowed("https://example.com/openapi.yaml", {
        allowedOrigins: ["https://example.com"],
      }),
    ).not.toThrow();
    expect(() =>
      assertReferenceAllowed("https://other.example/openapi.yaml", {
        allowedOrigins: ["https://example.com"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "REMOTE_REFERENCE_DENIED" }),
    );
    expect(() =>
      assertReferenceAllowed("http://example.com/openapi.yaml", {
        allowedOrigins: ["http://example.com"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "REMOTE_REFERENCE_DENIED" }),
    );
    expect(() =>
      assertReferenceAllowed("file:///etc/passwd", {
        allowedOrigins: ["https://example.com"],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<OpenApiIngestionError>>({
        code: "UNSUPPORTED_REFERENCE_SCHEME",
      }),
    );
  });
});
