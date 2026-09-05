import { describe, expect, expectTypeOf, it } from "vitest";

import {
  DOCUMENT_MODEL_VERSION,
  createCanonicalId,
  createOperationId,
  serializeDocumentationArtifact,
  type DocumentationArtifact,
  type Operation,
  type QueryParameterSerialization,
  type SchemaNode,
} from "./index.js";

describe("public model consumer contract", () => {
  it("constructs an artifact without parser, renderer, or framework types", () => {
    const query: QueryParameterSerialization = {
      allowReserved: false,
      explode: true,
      style: "form",
    };
    const invalidQuery: QueryParameterSerialization = {
      allowReserved: false,
      explode: false,
      // @ts-expect-error Matrix serialization is path-only.
      style: "matrix",
    };
    const schema: SchemaNode = { kind: "scalar", type: "string" };
    const artifact: DocumentationArtifact = {
      diagnostics: [],
      model: {
        modelVersion: DOCUMENT_MODEL_VERSION,
        project: {
          id: createCanonicalId("project", "consumer"),
          name: "Consumer",
        },
        versions: [],
      },
    };

    expect(query.style).toBe("form");
    expect(invalidQuery.style).toBe("matrix");
    expect(schema.kind).toBe("scalar");
    expect(serializeDocumentationArtifact(artifact)).toContain(
      '"modelVersion":1',
    );
    expectTypeOf(artifact).toEqualTypeOf<DocumentationArtifact>();
  });

  it("retains arbitrary source operation IDs behind safe canonical IDs", () => {
    const operation = {
      contractId: "get item/v1",
      deprecated: false,
      extensions: {},
      id: createOperationId({
        contractId: "get item/v1",
        method: "GET",
        path: "/items/{id}",
      }),
      method: "GET",
      parameters: [],
      path: "/items/{id}",
      responses: [
        {
          bodies: [],
          description: "Found",
          headers: [],
          status: { code: 200, kind: "code" },
        },
      ],
      security: [],
      serverIds: [],
      tags: [],
      title: "Get item",
    } satisfies Operation;

    expect(operation.contractId).toBe("get item/v1");
    expect(operation.id).toMatch(/^op_/);
  });
});
