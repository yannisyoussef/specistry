import { describe, expect, it } from "vitest";

import {
  parseArtifactManifest,
  serializeArtifactManifest,
  type ArtifactManifest,
} from "./index.js";

const manifest: ArtifactManifest = {
  artifactFormat: 1,
  diagnostics: { errors: 0, warnings: 2 },
  files: { documentation: "documentation.json" },
  generator: "specistry",
  modelVersion: 1,
  project: { id: "example", name: "Example" },
  sources: [
    { bytes: 12, path: "openapi.yaml", sha256: "a".repeat(64) },
    { bytes: 3, path: "schemas/user.yaml", sha256: "b".repeat(64) },
  ],
  statistics: { documents: 2, operations: 4, references: 1, schemas: 3 },
};

describe("artifact manifest contract", () => {
  it("serializes deterministically and round-trips", () => {
    const bytes = serializeArtifactManifest(manifest);
    expect(bytes.endsWith("\n")).toBe(true);
    expect(bytes.indexOf('"artifactFormat"')).toBeLessThan(
      bytes.indexOf('"diagnostics"'),
    );
    expect(parseArtifactManifest(bytes)).toEqual(manifest);
    const reordered = JSON.stringify(
      Object.fromEntries(Object.entries(manifest).reverse()),
    );
    expect(serializeArtifactManifest(parseArtifactManifest(reordered))).toBe(
      bytes,
    );
  });

  it("rejects malformed, foreign, escaping, and inconsistent manifests", () => {
    const cases: unknown[] = [
      "{",
      [],
      { ...manifest, extra: true },
      { ...manifest, artifactFormat: 2 },
      { ...manifest, modelVersion: 2 },
      { ...manifest, generator: "other" },
      { ...manifest, project: { id: "", name: "x" } },
      { ...manifest, files: { documentation: "other.json" } },
      {
        ...manifest,
        sources: [{ bytes: 1, path: "/abs.yaml", sha256: "a".repeat(64) }],
      },
      {
        ...manifest,
        sources: [{ bytes: 1, path: "../up.yaml", sha256: "a".repeat(64) }],
      },
      {
        ...manifest,
        sources: [{ bytes: -1, path: "a.yaml", sha256: "a".repeat(64) }],
      },
      { ...manifest, sources: [{ bytes: 1, path: "a.yaml", sha256: "zz" }] },
      { ...manifest, statistics: { documents: 1 } },
      { ...manifest, diagnostics: { errors: 1, warnings: 0 } },
    ];
    for (const value of cases) {
      expect(() =>
        parseArtifactManifest(
          typeof value === "string" ? value : JSON.stringify(value),
        ),
      ).toThrow(TypeError);
    }
  });
});
