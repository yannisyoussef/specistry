import {
  createSchemaId,
  serializeDocumentationArtifact,
  type SchemaNode,
} from "@specistry/model";
import { describe, expect, it } from "vitest";

import {
  fixtureAcquisition,
  inlineAcquisition,
} from "./fixtures.test-helper.js";
import {
  DEFAULT_INGESTION_LIMITS,
  createMemoryAcquisition,
  ingestOpenApi,
  type IngestionResult,
  type SourceAcquisition,
} from "./index.js";

/**
 * Table-driven evidence for the support matrix in
 * `docs/architecture/openapi-dialects.md`. Every row builds one inline
 * document per dialect, asserts the exact source diagnostics, and inspects the
 * canonical projection where a row promises a shape. Rows are named after the
 * matrix entry they prove.
 */

type Dialect = "3.0.3" | "3.1.0";
const project = { name: "Dialect matrix" };
const OK = { responses: { "200": { description: "ok" } } };

async function ingest(
  source: SourceAcquisition,
  overrides: Partial<Parameters<typeof ingestOpenApi>[0]> = {},
): Promise<IngestionResult> {
  return await ingestOpenApi({ project, sources: [source], ...overrides });
}

function codes(result: IngestionResult): readonly string[] {
  return result.diagnostics.map(
    (diagnostic) =>
      `${diagnostic.severity} ${diagnostic.code} ${diagnostic.location.document}#${diagnostic.location.pointer}`,
  );
}

function artifactCodes(result: IngestionResult): readonly string[] {
  return (result.artifact?.diagnostics ?? [])
    .map((diagnostic) => diagnostic.code)
    .sort();
}

function service(result: IngestionResult) {
  const first = result.artifact?.model.versions[0]?.services[0];
  if (first === undefined) throw new Error("expected a service");
  return first;
}

function operation(result: IngestionResult, index = 0) {
  const found = service(result).operations[index];
  if (found === undefined) throw new Error(`expected operation ${index}`);
  return found;
}

function schemaNamed(result: IngestionResult, name: string): SchemaNode {
  const node =
    service(result).schemas[
      createSchemaId("openapi.yaml", `/components/schemas/${name}`)
    ];
  if (node === undefined) throw new Error(`expected schema ${name}`);
  return node;
}

function doc(
  version: Dialect,
  paths: Record<string, unknown>,
  components?: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...(components === undefined ? {} : { components }),
    info: { title: "Matrix", version: "1.0.0" },
    openapi: version,
    paths,
    ...extra,
  };
}

function withSchema(
  version: Dialect,
  schema: unknown,
  others: Record<string, unknown> = {},
): Record<string, unknown> {
  return doc(
    version,
    {
      "/s": {
        get: {
          operationId: "s",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/S" },
                },
              },
              description: "ok",
            },
          },
        },
      },
    },
    { schemas: { S: schema, ...others } },
  );
}

const S = "openapi.yaml#/components/schemas/S";

describe("schema rows", () => {
  it.each([
    [
      "3.0 boolean schema is invalid",
      withSchema("3.0.3", { properties: { a: true }, type: "object" }),
      [`error SOURCE_INVALID ${S}/properties/a`],
    ],
    [
      "3.0 type array is invalid",
      withSchema("3.0.3", { type: ["string", "null"] }),
      [`error SOURCE_INVALID ${S}/type`],
    ],
    [
      "3.0 array-form items is invalid",
      withSchema("3.0.3", { items: [{ type: "string" }], type: "array" }),
      [`error SOURCE_INVALID ${S}/items`],
    ],
    [
      "3.0 const is unsupported",
      withSchema("3.0.3", { const: "a", type: "string" }),
      [`warning SOURCE_UNSUPPORTED_SEMANTIC ${S}/const`],
    ],
    [
      "3.0 prefixItems is unsupported rather than dropped",
      withSchema("3.0.3", {
        items: { type: "integer" },
        prefixItems: [{ type: "string" }],
        type: "array",
      }),
      [`warning SOURCE_UNSUPPORTED_SEMANTIC ${S}/prefixItems`],
    ],
    [
      "3.1 empty type array is invalid",
      withSchema("3.1.0", { type: [] }),
      [`error SOURCE_INVALID ${S}/type`],
    ],
    [
      "3.1 empty prefixItems is invalid",
      withSchema("3.1.0", { prefixItems: [], type: "array" }),
      [`error SOURCE_INVALID ${S}/prefixItems`],
    ],
    [
      "3.1 tuple enum is partially represented",
      withSchema("3.1.0", {
        enum: [["a"]],
        prefixItems: [{ type: "string" }],
        type: "array",
      }),
      [`warning SOURCE_PARTIALLY_REPRESENTED ${S}/enum`],
    ],
    [
      "single-type enum values must match the type",
      withSchema("3.1.0", { enum: ["a", 1], type: "string" }),
      [`error SOURCE_INVALID ${S}/enum`],
    ],
    [
      "format without a type cannot be attached",
      withSchema("3.1.0", { format: "int64" }),
      [`warning SOURCE_PARTIALLY_REPRESENTED ${S}/format`],
    ],
    [
      "unsupported applicator keywords warn individually",
      withSchema("3.1.0", {
        $dynamicRef: "#x",
        dependentRequired: {},
        dependentSchemas: {},
        patternProperties: {},
        propertyNames: {},
        type: "object",
        unevaluatedProperties: false,
      }),
      [
        `warning SOURCE_UNSUPPORTED_SEMANTIC ${S}/$dynamicRef`,
        `warning SOURCE_UNSUPPORTED_SEMANTIC ${S}/dependentRequired`,
        `warning SOURCE_UNSUPPORTED_SEMANTIC ${S}/dependentSchemas`,
        `warning SOURCE_UNSUPPORTED_SEMANTIC ${S}/patternProperties`,
        `warning SOURCE_UNSUPPORTED_SEMANTIC ${S}/propertyNames`,
        `warning SOURCE_UNSUPPORTED_SEMANTIC ${S}/unevaluatedProperties`,
      ],
    ],
  ])("%s", async (_row, document, expected) => {
    const result = await ingest(inlineAcquisition(document));
    expect(codes(result)).toEqual(expected);
    expect(result.artifactDiagnostics).toEqual([]);
  });

  it("projects 3.0 nullable with constraints byte-identically to 3.1 type arrays", async () => {
    const legacy = await ingest(
      inlineAcquisition(
        withSchema("3.0.3", { maxLength: 10, nullable: true, type: "string" }),
      ),
    );
    const modern = await ingest(
      inlineAcquisition(
        withSchema("3.1.0", { maxLength: 10, type: ["string", "null"] }),
      ),
    );
    for (const result of [legacy, modern]) {
      expect(codes(result)).toEqual([]);
      expect(artifactCodes(result)).toEqual([]);
      expect(result.artifact).toBeDefined();
    }
    if (legacy.artifact === undefined || modern.artifact === undefined) return;
    expect(serializeDocumentationArtifact(legacy.artifact)).toBe(
      serializeDocumentationArtifact(modern.artifact),
    );
    const objectForm = await ingest(
      inlineAcquisition(
        withSchema("3.0.3", {
          nullable: true,
          properties: { a: { type: "string" } },
          required: ["a"],
          type: "object",
        }),
      ),
    );
    expect(codes(objectForm)).toEqual([]);
    expect(artifactCodes(objectForm)).toEqual([]);
    const numeric = await ingest(
      inlineAcquisition(
        withSchema("3.0.3", {
          exclusiveMinimum: true,
          minimum: 0,
          nullable: true,
          type: "number",
        }),
      ),
    );
    expect(codes(numeric)).toEqual([]);
    expect(artifactCodes(numeric)).toEqual([]);
  });

  it("reports keywords that no declared type uses, exactly once", async () => {
    const result = await ingest(
      inlineAcquisition(
        withSchema("3.1.0", {
          properties: { a: { type: "string" } },
          type: ["string", "integer"],
        }),
      ),
    );
    expect(codes(result)).toEqual([]);
    expect(artifactCodes(result)).toEqual(["SCHEMA_IGNORED_ANNOTATION"]);
    const booleanFormat = await ingest(
      inlineAcquisition(withSchema("3.1.0", { format: "x", type: "boolean" })),
    );
    expect(artifactCodes(booleanFormat)).toEqual(["SCHEMA_IGNORED_ANNOTATION"]);
  });

  it("anchors 3.0 $ref sibling annotations at each sibling and ignores extensions", async () => {
    const result = await ingest(
      inlineAcquisition(
        withSchema(
          "3.0.3",
          { $ref: "#/components/schemas/T", description: "d", "x-a": 1 },
          { T: { type: "string" } },
        ),
      ),
    );
    expect(codes(result)).toEqual([]);
    const diagnostics = result.artifact?.diagnostics ?? [];
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "SCHEMA_IGNORED_ANNOTATION",
    ]);
    expect(diagnostics[0]?.location?.path).toBe("/description");
  });

  it("attaches a discriminator to the single polymorphic list beside own keywords", async () => {
    const result = await ingest(
      inlineAcquisition(
        withSchema(
          "3.1.0",
          {
            discriminator: { propertyName: "petType" },
            oneOf: [
              { $ref: "#/components/schemas/Cat" },
              { $ref: "#/components/schemas/Dog" },
            ],
            properties: { petType: { type: "string" } },
            required: ["petType"],
            type: "object",
          },
          {
            Cat: {
              properties: { petType: { type: "string" } },
              type: "object",
            },
            Dog: {
              properties: { petType: { type: "string" } },
              type: "object",
            },
          },
        ),
      ),
    );
    expect(codes(result)).toEqual([]);
    const pet = schemaNamed(result, "S");
    expect(pet.kind).toBe("composition");
    if (pet.kind !== "composition") return;
    expect(pet.mode).toBe("allOf");
    const polymorphic = pet.variants[1];
    expect(polymorphic?.kind).toBe("composition");
    if (polymorphic?.kind !== "composition") return;
    expect(polymorphic.mode).toBe("oneOf");
    if (polymorphic.mode === "not") return;
    expect(
      Object.keys(polymorphic.discriminator?.mapping ?? {}).sort(),
    ).toEqual(["Cat", "Dog"]);
    expect(polymorphic.discriminator?.propertyName).toBe("petType");
  });

  it("keeps prototype-named keys as ordinary data", async () => {
    // Object literals would set the prototype instead of an own key, so the
    // document is authored as text exactly as a user would write it.
    const text = `{
      "openapi": "3.1.0",
      "info": { "title": "Proto", "version": "1.0.0" },
      "servers": [
        { "url": "https://{__proto__}.example.com", "variables": { "__proto__": { "default": "api" } } }
      ],
      "paths": {
        "/s": {
          "get": {
            "operationId": "s",
            "security": [{ "oauth": ["__proto__"] }],
            "responses": {
              "200": {
                "description": "ok",
                "content": { "application/json": { "schema": { "$ref": "#/components/schemas/S" } } }
              }
            }
          }
        }
      },
      "components": {
        "schemas": {
          "S": {
            "type": "object",
            "properties": { "__proto__": { "type": "string" } },
            "discriminator": { "propertyName": "k", "mapping": { "__proto__": "#/components/schemas/T" } },
            "oneOf": [{ "$ref": "#/components/schemas/T" }]
          },
          "T": { "type": "object", "properties": { "k": { "type": "string" } } }
        },
        "securitySchemes": {
          "oauth": {
            "type": "oauth2",
            "flows": {
              "implicit": {
                "authorizationUrl": "https://auth.example.com/authorize",
                "scopes": { "__proto__": "prototype scope" }
              }
            }
          }
        }
      }
    }`;
    const result = await ingest(
      createMemoryAcquisition("openapi.yaml", { "openapi.yaml": text }),
    );
    expect(codes(result)).toEqual([]);
    expect(result.artifactDiagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect("polluted" in {}).toBe(false);
    const json =
      result.artifact === undefined ? "" : JSON.stringify(result.artifact);
    expect(json).toContain('"__proto__"');
    expect(json).toContain("prototype scope");
    const node = schemaNamed(result, "S");
    expect(node.kind).toBe("composition");
    if (node.kind !== "composition") return;
    const own = node.variants[0];
    expect(own?.kind).toBe("object");
    if (own?.kind !== "object") return;
    expect(Object.hasOwn(own.properties, "__proto__")).toBe(true);
    expect(own.propertyOrder).toEqual(["__proto__"]);
  });

  it("projects contains, multipleOf, not, metadata flags, and additionalProperties schemas", async () => {
    const result = await ingest(
      inlineAcquisition(
        withSchema("3.1.0", {
          additionalProperties: { type: "integer" },
          properties: {
            list: {
              contains: { type: "string" },
              maxContains: 3,
              minContains: 1,
              type: "array",
            },
            negated: { not: { type: "string" } },
            ratio: { multipleOf: 0.5, type: "number" },
            stamp: {
              deprecated: true,
              readOnly: true,
              type: "string",
              writeOnly: false,
            },
          },
          type: "object",
        }),
      ),
    );
    expect(codes(result)).toEqual([]);
    expect(artifactCodes(result)).toEqual([]);
    const node = schemaNamed(result, "S");
    expect(node.kind).toBe("object");
    if (node.kind !== "object") return;
    expect(node.additionalProperties).toEqual({
      kind: "scalar",
      type: "integer",
    });
    expect(node.properties.list).toMatchObject({
      contains: { kind: "scalar", type: "string" },
      kind: "array",
      maxContains: 3,
      minContains: 1,
    });
    expect(node.properties.negated).toMatchObject({
      kind: "composition",
      mode: "not",
    });
    expect(node.properties.ratio).toMatchObject({
      constraints: { multipleOf: 0.5 },
      kind: "scalar",
    });
    expect(node.properties.stamp).toMatchObject({
      deprecated: true,
      readOnly: true,
      writeOnly: false,
    });
  });

  it("bounds inline nesting independently of the parse depth budget", async () => {
    let nested: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 300; level += 1) {
      nested = { properties: { n: nested }, type: "object" };
    }
    const result = await ingest(
      inlineAcquisition(withSchema("3.1.0", nested)),
      {
        limits: { ...DEFAULT_INGESTION_LIMITS, maxDepth: 1_000 },
      },
    );
    // The guard trips at inline depth 257; its pointer exceeds the 2 KiB
    // diagnostic bound, so it is reported at the nearest ancestor that fits.
    // The canonical projection also outgrows the model depth budget, which is
    // reported as a source limit at the root.
    expect(codes(result)).toHaveLength(2);
    expect(codes(result)[0]).toMatch(
      /^error SOURCE_INVALID openapi\.yaml#\/components\/schemas\/S(\/properties\/n)*(\/properties)?$/,
    );
    expect(codes(result)[1]).toBe("error SOURCE_LIMIT_EXCEEDED openapi.yaml#");
    const pointer = result.diagnostics[0]?.location.pointer ?? "";
    expect(pointer.length).toBeLessThanOrEqual(2_048);
    expect(pointer.length).toBeGreaterThan(2_000);
    expect(result.artifactDiagnostics).toEqual([]);
  });

  it("documents that a pure schema reference cycle is accepted through registry identities", async () => {
    const result = await ingest(
      inlineAcquisition(
        withSchema(
          "3.1.0",
          { $ref: "#/components/schemas/T" },
          { T: { $ref: "#/components/schemas/S" } },
        ),
      ),
    );
    expect(codes(result)).toEqual([]);
    expect(schemaNamed(result, "S").kind).toBe("ref");
    expect(schemaNamed(result, "T").kind).toBe("ref");
  });
});

describe("operation rows", () => {
  it.each([
    [
      "duplicate tags are invalid",
      doc("3.1.0", {
        "/a": { get: { operationId: "a", tags: ["t", "t"], ...OK } },
      }),
      ["error SOURCE_INVALID openapi.yaml#/paths/~1a/get/tags/1"],
    ],
    [
      "non-default jsonSchemaDialect is unsupported",
      doc("3.1.0", { "/a": { get: { operationId: "a", ...OK } } }, undefined, {
        jsonSchemaDialect: "https://example.com/dialect",
      }),
      ["warning SOURCE_UNSUPPORTED_SEMANTIC openapi.yaml#/jsonSchemaDialect"],
    ],
    [
      "component callbacks and links are unsupported",
      doc(
        "3.1.0",
        { "/a": { get: { operationId: "a", ...OK } } },
        {
          callbacks: {},
          links: {},
        },
      ),
      [
        "warning SOURCE_UNSUPPORTED_SEMANTIC openapi.yaml#/components/callbacks",
        "warning SOURCE_UNSUPPORTED_SEMANTIC openapi.yaml#/components/links",
      ],
    ],
    [
      "operations beside a path item $ref are invalid",
      doc(
        "3.1.0",
        {
          "/a": {
            $ref: "#/components/pathItems/A",
            post: { operationId: "extra", ...OK },
            summary: "override",
          },
        },
        { pathItems: { A: { get: { operationId: "a", ...OK } } } },
      ),
      [
        "error SOURCE_INVALID openapi.yaml#/paths/~1a/post",
        "warning SOURCE_UNSUPPORTED_SEMANTIC openapi.yaml#/components/pathItems",
      ],
    ],
    [
      "duplicate parameters within one list are invalid",
      doc("3.1.0", {
        "/a": {
          get: {
            operationId: "a",
            parameters: [
              { in: "query", name: "q", schema: { type: "string" } },
              { in: "query", name: "q", schema: { type: "integer" } },
              { in: "header", name: "X-A", schema: { type: "string" } },
              { in: "header", name: "x-a", schema: { type: "string" } },
            ],
            ...OK,
          },
        },
      }),
      [
        "error SOURCE_INVALID openapi.yaml#/paths/~1a/get/parameters/1",
        "error SOURCE_INVALID openapi.yaml#/paths/~1a/get/parameters/3",
      ],
    ],
    [
      "allowEmptyValue is partially represented",
      doc("3.1.0", {
        "/a": {
          get: {
            operationId: "a",
            parameters: [
              {
                allowEmptyValue: true,
                in: "query",
                name: "q",
                schema: { type: "string" },
              },
            ],
            ...OK,
          },
        },
      }),
      [
        "warning SOURCE_PARTIALLY_REPRESENTED openapi.yaml#/paths/~1a/get/parameters/0/allowEmptyValue",
      ],
    ],
    [
      "styles are validated per location",
      doc("3.1.0", {
        "/c": {
          get: {
            operationId: "c",
            parameters: [
              { in: "cookie", name: "c", schema: {}, style: "simple" },
            ],
            ...OK,
          },
        },
        "/h": {
          get: {
            operationId: "h",
            parameters: [
              { in: "header", name: "h", schema: {}, style: "form" },
            ],
            ...OK,
          },
        },
        "/p/{id}": {
          get: {
            operationId: "p",
            parameters: [
              {
                in: "path",
                name: "id",
                required: true,
                schema: {},
                style: "form",
              },
            ],
            ...OK,
          },
        },
        "/q": {
          get: {
            operationId: "q",
            parameters: [
              { in: "query", name: "q", schema: {}, style: "simple" },
            ],
            ...OK,
          },
        },
      }),
      [
        "error SOURCE_INVALID openapi.yaml#/paths/~1c/get/parameters/0/style",
        "error SOURCE_INVALID openapi.yaml#/paths/~1h/get/parameters/0/style",
        "error SOURCE_INVALID openapi.yaml#/paths/~1p~1{id}/get/parameters",
        "error SOURCE_INVALID openapi.yaml#/paths/~1p~1{id}/get/parameters/0/style",
        "error SOURCE_INVALID openapi.yaml#/paths/~1q/get/parameters/0/style",
      ],
    ],
    [
      "reserved header parameters are dropped with a warning",
      doc("3.1.0", {
        "/a": {
          get: {
            operationId: "a",
            parameters: [
              { in: "header", name: "Accept", schema: { type: "string" } },
              {
                in: "header",
                name: "authorization",
                schema: { type: "string" },
              },
            ],
            ...OK,
          },
        },
      }),
      [
        "warning SOURCE_PARTIALLY_REPRESENTED openapi.yaml#/paths/~1a/get/parameters/0",
        "warning SOURCE_PARTIALLY_REPRESENTED openapi.yaml#/paths/~1a/get/parameters/1",
      ],
    ],
    [
      "a parameter needs schema or content and a body needs content",
      doc("3.1.0", {
        "/a": {
          post: {
            operationId: "a",
            parameters: [{ in: "query", name: "q" }],
            requestBody: { description: "no content" },
            ...OK,
          },
        },
      }),
      [
        "error SOURCE_INVALID openapi.yaml#/paths/~1a/post/parameters/0",
        "error SOURCE_INVALID openapi.yaml#/paths/~1a/post/requestBody/content",
      ],
    ],
    [
      "header required and reserved flags are partially represented",
      doc("3.1.0", {
        "/a": {
          get: {
            operationId: "a",
            responses: {
              "200": {
                description: "ok",
                headers: {
                  "X-Rate": {
                    allowReserved: true,
                    required: true,
                    schema: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      }),
      [
        "warning SOURCE_PARTIALLY_REPRESENTED openapi.yaml#/paths/~1a/get/responses/200/headers/X-Rate/allowReserved",
        "warning SOURCE_PARTIALLY_REPRESENTED openapi.yaml#/paths/~1a/get/responses/200/headers/X-Rate/required",
      ],
    ],
    [
      "Content-Type headers are ignored and duplicate header names are invalid",
      doc("3.1.0", {
        "/a": {
          get: {
            operationId: "a",
            responses: {
              "200": {
                description: "ok",
                headers: {
                  "Content-Type": { schema: { type: "string" } },
                  "X-A": { schema: { type: "string" } },
                  "X-C": {
                    content: { "text/plain": { schema: { type: "string" } } },
                  },
                  "x-a": { schema: { type: "string" } },
                },
              },
            },
          },
        },
      }),
      [
        "error SOURCE_INVALID openapi.yaml#/paths/~1a/get/responses/200/headers/x-a",
        "warning SOURCE_PARTIALLY_REPRESENTED openapi.yaml#/paths/~1a/get/responses/200/headers/Content-Type",
      ],
    ],
    [
      "encoding properties are looked up through referenced schemas",
      doc(
        "3.1.0",
        {
          "/a": {
            post: {
              operationId: "a",
              requestBody: {
                content: {
                  "multipart/form-data": {
                    encoding: {
                      file: { contentType: "application/octet-stream" },
                      missing: { contentType: "text/plain" },
                    },
                    schema: { $ref: "#/components/schemas/Form" },
                  },
                },
              },
              ...OK,
            },
          },
        },
        {
          schemas: {
            Base: { properties: { file: { type: "string" } }, type: "object" },
            Form: { allOf: [{ $ref: "#/components/schemas/Base" }] },
          },
        },
      ),
      [
        "error SOURCE_INVALID openapi.yaml#/paths/~1a/post/requestBody/content/multipart~1form-data/encoding/missing",
      ],
    ],
    [
      "3.1 role names on non-OAuth schemes are dropped with a warning",
      doc(
        "3.1.0",
        {
          "/a": {
            get: { operationId: "a", security: [{ key: ["admin"] }], ...OK },
          },
        },
        {
          securitySchemes: {
            key: { in: "header", name: "X-Key", type: "apiKey" },
          },
        },
      ),
      [
        "warning SOURCE_PARTIALLY_REPRESENTED openapi.yaml#/paths/~1a/get/security/0/key",
      ],
    ],
    [
      "3.0 role names on non-OAuth schemes are invalid",
      doc(
        "3.0.3",
        {
          "/a": {
            get: { operationId: "a", security: [{ key: ["admin"] }], ...OK },
          },
        },
        {
          securitySchemes: {
            key: { in: "header", name: "X-Key", type: "apiKey" },
          },
        },
      ),
      ["error SOURCE_INVALID openapi.yaml#/paths/~1a/get/security/0/key"],
    ],
    [
      "OpenID Connect requires a URL and unknown scheme types are invalid",
      doc(
        "3.1.0",
        { "/a": { get: { operationId: "a", ...OK } } },
        {
          securitySchemes: {
            magic: { type: "magic" },
            oidc: { type: "openIdConnect" },
          },
        },
      ),
      [
        "error SOURCE_INVALID openapi.yaml#/components/securitySchemes/magic/type",
        "error SOURCE_INVALID openapi.yaml#/components/securitySchemes/oidc/openIdConnectUrl",
      ],
    ],
  ])("%s", async (_row, document, expected) => {
    const result = await ingest(inlineAcquisition(document));
    expect(codes(result)).toEqual(expected);
    expect(result.artifactDiagnostics).toEqual([]);
  });

  it("projects status ranges, path item references, and inherited parameters", async () => {
    const result = await ingest(
      inlineAcquisition(
        doc("3.1.0", {
          "/a": {
            get: {
              operationId: "a",
              parameters: [
                { in: "query", name: "q", schema: { type: "integer" } },
              ],
              responses: {
                "1XX": { description: "info" },
                "5XX": { description: "server" },
                default: { description: "other" },
              },
            },
            parameters: [
              { in: "query", name: "q", schema: { type: "string" } },
              { in: "query", name: "page", schema: { type: "integer" } },
            ],
          },
        }),
      ),
    );
    expect(codes(result)).toEqual([]);
    const found = operation(result);
    expect(found.responses.map((response) => response.status)).toEqual([
      { kind: "range", range: "1XX" },
      { kind: "range", range: "5XX" },
      { kind: "default" },
    ]);
    expect(
      found.parameters.map((parameter) => [
        parameter.name,
        parameter.valueKind === "schema" ? parameter.schema : undefined,
      ]),
    ).toEqual([
      ["q", { kind: "scalar", type: "integer" }],
      ["page", { kind: "scalar", type: "integer" }],
    ]);
    const referenced = await ingest(
      inlineAcquisition(
        doc(
          "3.1.0",
          { "/a": { $ref: "#/components/pathItems/A" } },
          { pathItems: { A: { get: { operationId: "a", ...OK } } } },
        ),
      ),
    );
    expect(codes(referenced)).toEqual([
      "warning SOURCE_UNSUPPORTED_SEMANTIC openapi.yaml#/components/pathItems",
    ]);
    expect(operation(referenced).id).toBeDefined();
  });

  it("applies 3.1 Reference Object overrides and diagnoses 3.0 siblings", async () => {
    const paths = {
      "/a": {
        get: {
          operationId: "a",
          parameters: [
            { $ref: "#/components/parameters/P", description: "override" },
          ],
          requestBody: {
            $ref: "#/components/requestBodies/B",
            description: "override",
          },
          responses: {
            "200": {
              $ref: "#/components/responses/R",
              description: "override",
            },
          },
        },
      },
    };
    const components = {
      parameters: {
        P: { description: "orig", in: "query", name: "q", schema: {} },
      },
      requestBodies: {
        B: { content: { "text/plain": { schema: {} } }, description: "orig" },
      },
      responses: { R: { description: "orig" } },
    };
    const modern = await ingest(
      inlineAcquisition(doc("3.1.0", paths, components)),
    );
    expect(codes(modern)).toEqual([]);
    const found = operation(modern);
    expect(found.parameters[0]?.description).toBe("override");
    expect(found.requestBody?.description).toBe("override");
    expect(found.responses[0]?.description).toBe("override");

    const legacy = await ingest(
      inlineAcquisition(doc("3.0.3", paths, components)),
    );
    expect(codes(legacy)).toEqual([
      "warning SOURCE_PARTIALLY_REPRESENTED openapi.yaml#/paths/~1a/get/parameters/0/description",
      "warning SOURCE_PARTIALLY_REPRESENTED openapi.yaml#/paths/~1a/get/requestBody/description",
      "warning SOURCE_PARTIALLY_REPRESENTED openapi.yaml#/paths/~1a/get/responses/200/description",
    ]);
    expect(operation(legacy).parameters[0]?.description).toBe("orig");
  });

  it("reports parameter and security scheme identity collisions at both locations", async () => {
    const result = await ingest(
      inlineAcquisition(
        doc(
          "3.1.0",
          {
            "/a": {
              get: {
                operationId: "a",
                parameters: [
                  { in: "query", name: "caf\u00e9", schema: {} },
                  { in: "query", name: "cafe\u0301", schema: {} },
                ],
                ...OK,
              },
            },
          },
          {
            securitySchemes: {
              "caf\u00e9": { in: "header", name: "X", type: "apiKey" },
              "cafe\u0301": { in: "header", name: "Y", type: "apiKey" },
            },
          },
        ),
      ),
    );
    expect(codes(result)).toEqual([
      "error SOURCE_IDENTITY_COLLISION openapi.yaml#/components/securitySchemes/cafe\u0301",
      "error SOURCE_IDENTITY_COLLISION openapi.yaml#/components/securitySchemes/caf\u00e9",
      "error SOURCE_IDENTITY_COLLISION openapi.yaml#/paths/~1a/get/parameters/0",
      "error SOURCE_IDENTITY_COLLISION openapi.yaml#/paths/~1a/get/parameters/1",
    ]);
  });

  it("normalizes every OAuth flow", async () => {
    const result = await ingest(
      inlineAcquisition(
        doc(
          "3.1.0",
          { "/a": { get: { operationId: "a", ...OK } } },
          {
            securitySchemes: {
              oauth: {
                flows: {
                  authorizationCode: {
                    authorizationUrl: "https://auth.example.com/authorize",
                    scopes: { read: "read" },
                    tokenUrl: "https://auth.example.com/token",
                  },
                  clientCredentials: {
                    refreshUrl: "https://auth.example.com/refresh",
                    scopes: { read: "read" },
                    tokenUrl: "https://auth.example.com/token",
                  },
                  implicit: {
                    authorizationUrl: "https://auth.example.com/authorize",
                    scopes: { read: "read" },
                  },
                  password: {
                    scopes: { read: "read" },
                    tokenUrl: "https://auth.example.com/token",
                  },
                },
                type: "oauth2",
              },
            },
          },
        ),
      ),
    );
    expect(codes(result)).toEqual([]);
    const schemes = Object.values(service(result).securitySchemes);
    expect(schemes).toHaveLength(1);
    expect(schemes[0]?.kind).toBe("oauth2");
    expect(JSON.stringify(schemes[0])).toContain("refresh");
  });

  it("documents server inheritance: no synthesized default and explicit empty overrides", async () => {
    const result = await ingest(
      inlineAcquisition(
        doc("3.1.0", {
          "/a": { get: { operationId: "a", servers: [], ...OK } },
          "/b": { get: { operationId: "b", ...OK } },
        }),
      ),
    );
    expect(codes(result)).toEqual([]);
    expect(service(result).servers).toEqual([]);
    expect(operation(result, 0).serverIds).toEqual([]);
    expect(operation(result, 1).serverIds).toEqual([]);
  });
});

describe("parsing rows", () => {
  const raw = (text: string): SourceAcquisition =>
    createMemoryAcquisition("openapi.yaml", { "openapi.yaml": text });
  const head = "openapi: 3.1.0\ninfo: { title: T, version: '1' }\npaths: {}\n";

  it.each([
    ["binary tag", `${head}x-bin: !!binary aGVsbG8=\n`],
    ["timestamp tag", `${head}x-time: !!timestamp 2001-12-14\n`],
    ["set tag", `${head}x-set: !!set { a, b }\n`],
    ["custom tag", `${head}x-custom: !custom value\n`],
    ["alias", `${head}x-anchor: &x 1\nx-alias: *x\n`],
    ["merge key", `${head}x-base: &b { a: 1 }\nx-merged: { <<: *b }\n`],
    [
      "duplicate JSON keys",
      '{"openapi":"3.1.0","info":{"title":"T","version":"1"},"paths":{},"paths":{}}',
    ],
    ["non-scalar key", `${head}? [a, b]\n: value\n`],
  ])("rejects %s as a parse failure", async (_row, text) => {
    const result = await ingest(raw(text));
    expect(codes(result)).toEqual(["error SOURCE_PARSE_FAILED openapi.yaml#"]);
  });

  it.each([
    ["empty document", ""],
    ["whitespace only", "   \n\n"],
    ["array root", "- a\n- b\n"],
  ])("rejects %s as not an object", async (_row, text) => {
    const result = await ingest(raw(text));
    expect(codes(result)).toEqual(["error SOURCE_PARSE_FAILED openapi.yaml#"]);
  });

  it.each([["3.1"], ["3.2.0"], ["2.0"]])(
    "rejects openapi version %s",
    async (version) => {
      const result = await ingest(
        raw(
          `openapi: "${version}"\ninfo: { title: T, version: '1' }\npaths: {}\n`,
        ),
      );
      expect(codes(result)).toEqual([
        "error SOURCE_UNSUPPORTED_VERSION openapi.yaml#/openapi",
      ]);
    },
  );

  it("rejects pathological nesting before composing it", async () => {
    const flow = `${head}x-deep: ${"[".repeat(200_000)}${"]".repeat(200_000)}\n`;
    const started = performance.now();
    const result = await ingest(raw(flow));
    expect(codes(result)).toEqual([
      "error SOURCE_LIMIT_EXCEEDED openapi.yaml#",
    ]);
    expect(performance.now() - started).toBeLessThan(2_000);
    let block = `${head}x-deep:\n`;
    for (let level = 1; level <= 900; level += 1) {
      block += `${" ".repeat(level * 2)}n:\n`;
    }
    const indented = await ingest(raw(block));
    expect(codes(indented)).toEqual([
      "error SOURCE_LIMIT_EXCEEDED openapi.yaml#",
    ]);
  });

  it("treats $ref inside data values as opaque and never acquires from them", async () => {
    const seen: string[] = [];
    const inner = inlineAcquisition(
      doc(
        "3.1.0",
        {
          "/a": {
            get: {
              operationId: "a",
              responses: {
                "200": {
                  content: {
                    "application/json": {
                      examples: {
                        e: { $ref: "#/components/examples/E" },
                      },
                      schema: {
                        default: { $ref: "#/nope" },
                        enum: [{ $ref: "#/nope" }],
                        example: { $ref: "https://example.com/x" },
                        properties: {
                          x: { const: { $ref: "./missing.yaml" } },
                        },
                        type: "object",
                      },
                    },
                  },
                  description: "ok",
                },
              },
            },
          },
        },
        { examples: { E: { value: { $ref: "./missing.yaml" } } } },
        { "x-vendor": { $ref: "./missing.yaml" } },
      ),
    );
    const spy: SourceAcquisition = {
      acquire: async (id, maxBytes) => {
        seen.push(id);
        return await inner.acquire(id, maxBytes);
      },
      entry: inner.entry,
    };
    const result = await ingest(spy);
    expect(codes(result)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(seen).toEqual(["openapi.yaml"]);
    const body = operation(result).responses[0]?.bodies[0];
    expect(body?.examples.map((example) => example.name)).toEqual(["e"]);
    expect(body?.examples[0]?.value).toEqual({ $ref: "./missing.yaml" });
  });

  it("treats a differently spelled canonical id as unresolved", async () => {
    const inner = inlineAcquisition(
      withSchema("3.1.0", { $ref: "./OTHER.yaml#/T" }),
      "openapi.yaml",
      { "OTHER.yaml": JSON.stringify({ T: { type: "string" } }) },
    );
    const folded: SourceAcquisition = {
      acquire: async (id, maxBytes) => {
        const acquired = await inner.acquire(id, maxBytes);
        if (!acquired.ok || id === "openapi.yaml") return acquired;
        return {
          ok: true,
          source: { ...acquired.source, canonicalId: id.toLowerCase() },
        };
      },
      entry: inner.entry,
    };
    const result = await ingest(folded);
    expect(codes(result)).toEqual([
      "error SOURCE_REFERENCE_UNRESOLVED openapi.yaml#/components/schemas/S/$ref",
    ]);
  });

  it("diagnoses reference chains that cycle, overflow, or land on the wrong kind", async () => {
    const result = await ingest(
      fixtureAcquisition("adversarial/ref-chains.yaml", "api.yaml"),
    );
    expect(codes(result)).toEqual([
      "error SOURCE_INVALID api.yaml#/paths/~1scalar/get/parameters/0",
      "error SOURCE_REFERENCE_INVALID api.yaml#/components/parameters/A",
      "error SOURCE_REFERENCE_INVALID api.yaml#/components/responses/R1",
      "error SOURCE_REFERENCE_INVALID api.yaml#/paths/~1long/get/parameters/0",
    ]);
  });
});
