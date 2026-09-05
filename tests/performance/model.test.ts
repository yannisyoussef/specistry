import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import {
  DOCUMENT_MODEL_VERSION,
  serializeDocumentationArtifact,
  validateDocumentationArtifact,
  type DocumentationArtifact,
  type DocumentationVersionId,
  type ProjectId,
  type SchemaId,
  type SchemaNode,
  type ServiceId,
} from "../../packages/model/src/index.js";

describe("canonical model smoke budget", () => {
  it("validates and serializes a deterministic 5,000-schema registry within the CI budget", () => {
    const schemas: Record<string, SchemaNode> = {};
    for (let index = 0; index < 5_000; index += 1) {
      const id = `Schema${String(index).padStart(5, "0")}`;
      schemas[id] = {
        additionalProperties: false,
        kind: "object",
        properties:
          index === 0
            ? {}
            : {
                previous: {
                  kind: "ref",
                  schemaId:
                    `Schema${String(index - 1).padStart(5, "0")}` as SchemaId,
                },
              },
        propertyOrder: index === 0 ? [] : ["previous"],
        required: [],
      };
    }
    const artifact = performanceArtifact(schemas);

    const started = performance.now();
    expect(validateDocumentationArtifact(artifact)).toEqual([]);
    const serialized = serializeDocumentationArtifact(artifact);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(serialized.length).toBeGreaterThan(500_000);
    expect(serialized.length).toBeLessThan(2_000_000);
  });

  it("validates a broad 20,000-property schema without quadratic slowdown", () => {
    const properties: Record<string, SchemaNode> = {};
    const propertyOrder: string[] = [];
    for (let index = 0; index < 20_000; index += 1) {
      const name = `property${String(index).padStart(5, "0")}`;
      properties[name] = { kind: "scalar", type: "string" };
      propertyOrder.push(name);
    }
    const artifact = performanceArtifact({
      Broad: {
        additionalProperties: false,
        kind: "object",
        properties,
        propertyOrder,
        required: [...propertyOrder],
      },
    });
    const started = performance.now();
    expect(validateDocumentationArtifact(artifact)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

function performanceArtifact(
  schemas: Readonly<Record<string, SchemaNode>>,
): DocumentationArtifact {
  return {
    diagnostics: [],
    model: {
      modelVersion: DOCUMENT_MODEL_VERSION,
      project: { id: "performance" as ProjectId, name: "Performance" },
      versions: [
        {
          id: "v1" as DocumentationVersionId,
          label: "v1",
          pages: [],
          services: [
            {
              extensions: {},
              id: "large" as ServiceId,
              name: "Large registry",
              operations: [],
              schemas,
              securitySchemes: {},
              servers: [],
            },
          ],
          status: "current",
        },
      ],
    },
  };
}
