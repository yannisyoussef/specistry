import { describe, expect, it } from "vitest";

import {
  DOCUMENT_MODEL_VERSION,
  validateDocumentationModel,
  type DocumentationModel,
  type ObjectSchema,
  type OperationId,
  type SchemaId,
  type SchemaNode,
} from "./index.js";

function modelWithParameter(
  required: boolean,
  schemaId: string,
): DocumentationModel {
  return {
    modelVersion: DOCUMENT_MODEL_VERSION,
    project: { name: "Fixture" },
    versions: [
      {
        id: "v1",
        label: "v1",
        pages: [],
        services: [
          {
            description: "Fixture service",
            extensions: {},
            id: "api",
            name: "Fixture API",
            operations: [
              {
                deprecated: false,
                extensions: {},
                id: "getThing" as OperationId,
                method: "GET",
                parameters: [
                  {
                    deprecated: false,
                    examples: [],
                    id: "thing-id",
                    location: "path",
                    name: "id",
                    required,
                    schema: { kind: "ref", schemaId: schemaId as SchemaId },
                    serialization: {
                      allowReserved: false,
                      explode: false,
                      style: "simple",
                    },
                    valueKind: "schema",
                  },
                ],
                path: "/things/{id}",
                responses: [],
                security: [],
                serverIds: [],
                tags: [],
                title: "Get thing",
              },
            ],
            schemas: {
              Thing: {
                additionalProperties: false,
                kind: "object",
                properties: {},
                required: [],
              },
            },
            securitySchemes: {},
            servers: [],
          },
        ],
        status: "current",
      },
    ],
  };
}

describe("validateDocumentationModel", () => {
  it("accepts a valid serializable registry reference", () => {
    expect(
      validateDocumentationModel(modelWithParameter(true, "Thing")),
    ).toEqual([]);
    expect(() =>
      JSON.stringify(modelWithParameter(true, "Thing")),
    ).not.toThrow();
    const model = modelWithParameter(true, "Thing");
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });

  it("reports invalid path parameters and missing registry references", () => {
    expect(
      validateDocumentationModel(modelWithParameter(false, "Missing")),
    ).toEqual([
      expect.objectContaining({
        code: "INVALID_PATH_PARAMETER",
        severity: "error",
      }),
      expect.objectContaining({ code: "MISSING_REFERENCE", severity: "error" }),
    ]);
  });

  it("diagnoses inline cycles and non-finite numbers without recursing forever", () => {
    const model = modelWithParameter(true, "Thing");
    const properties: Record<string, SchemaNode> = {};
    const cyclic: ObjectSchema = {
      additionalProperties: false,
      kind: "object",
      properties,
      required: [],
    };
    properties.self = cyclic;
    const service = model.versions[0]?.services[0];
    if (service === undefined) throw new Error("Invalid test fixture.");
    (service.schemas as Record<string, SchemaNode>).Thing = cyclic;
    (service.extensions as Record<string, unknown>).nonFinite = Number.NaN;

    expect(validateDocumentationModel(model)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "NON_SERIALIZABLE" }),
        expect.objectContaining({ code: "INVALID_JSON_VALUE" }),
      ]),
    );
  });

  it("never includes attacker-controlled identifiers in diagnostics", () => {
    const marker = "secret\n::error::forged";
    const diagnostics = validateDocumentationModel(
      modelWithParameter(false, marker),
    );
    expect(
      diagnostics
        .map(({ message, pointer }) => `${message}${pointer}`)
        .join("\n"),
    ).not.toContain(marker);
  });
});
