import { createHash } from "node:crypto";

import {
  createOperationId,
  createSchemaId,
  serializeDocumentationArtifact,
  validateDocumentationArtifact,
  type ApiService,
  type SchemaNode,
} from "@specra/model";
import { describe, expect, it } from "vitest";

import {
  fixtureAcquisition,
  fixtureDirectoryAcquisition,
  fixtureText,
  inlineAcquisition,
} from "./fixtures.test-helper.js";
import {
  DEFAULT_INGESTION_LIMITS,
  createMemoryAcquisition,
  ingestOpenApi,
  type IngestionResult,
  type SourceAcquisition,
} from "./index.js";

const project = { name: "Specra tests" };

async function ingest(
  source: SourceAcquisition,
  overrides: Partial<Parameters<typeof ingestOpenApi>[0]> = {},
): Promise<IngestionResult> {
  return await ingestOpenApi({ project, sources: [source], ...overrides });
}

function service(result: IngestionResult): ApiService {
  const first = result.artifact?.model.versions[0]?.services[0];
  if (first === undefined) throw new Error("expected a service");
  return first;
}

function schema(
  result: IngestionResult,
  document: string,
  pointer: string,
): SchemaNode {
  const node = service(result).schemas[createSchemaId(document, pointer)];
  if (node === undefined)
    throw new Error(`expected schema ${document}#${pointer}`);
  return node;
}

function codes(result: IngestionResult): readonly string[] {
  return result.diagnostics.map(
    (diagnostic) =>
      `${diagnostic.severity} ${diagnostic.code} ${diagnostic.location.document}#${diagnostic.location.pointer}`,
  );
}

function simple31(
  paths: Record<string, unknown>,
  components?: Record<string, unknown>,
) {
  return {
    components,
    info: { title: "Inline", version: "1.0.0" },
    openapi: "3.1.0",
    paths,
  };
}

describe("ingestOpenApi", () => {
  it("normalizes a 3.1 contract into a validated, deterministic canonical artifact", async () => {
    const result = await ingest(fixtureAcquisition("basic-3.1.yaml"));
    expect(codes(result)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.artifactDiagnostics).toEqual([]);
    expect(result.statistics).toEqual({
      documents: 1,
      operations: 4,
      references: 7,
      schemas: 2,
    });
    const api = service(result);
    expect(api.id).toBe("basic-3.1.yaml");
    expect(api.name).toBe("Pet Store");
    expect(api.extensions).toEqual({ "x-owner": "platform" });
    expect(api.servers).toHaveLength(1);
    expect(api.servers[0]?.variables.region).toEqual({
      allowedValues: ["eu", "us"],
      defaultValue: "eu",
      description: "Deployment region",
    });
    expect(Object.keys(api.securitySchemes)).toEqual([
      "apiKey",
      "basic",
      "bearer",
      "mtls",
      "oauth",
      "oidc",
    ]);
    expect(api.securitySchemes.basic).toEqual({
      kind: "http",
      scheme: "basic",
    });
    expect(api.securitySchemes.oauth).toMatchObject({
      flows: [{ kind: "authorizationCode" }],
      kind: "oauth2",
    });

    const ids = api.operations.map((operation) => operation.id);
    expect(ids).toEqual([
      "listPets",
      "createPet",
      "getPet",
      createOperationId({ method: "DELETE", path: "/pets/{petId}" }),
    ]);
    const listPets = api.operations[0];
    expect(listPets?.contractId).toBe("listPets");
    expect(listPets?.title).toBe("List pets");
    expect(listPets?.tags).toEqual(["pets"]);
    expect(
      listPets?.parameters.map((parameter) => [
        parameter.id,
        parameter.name,
        parameter.location,
      ]),
    ).toEqual([
      ["query.limit", "limit", "query"],
      ["header.x-trace", "X-Trace", "header"],
    ]);
    const limit = listPets?.parameters[0];
    expect(
      limit?.valueKind === "schema" ? limit.serialization : undefined,
    ).toEqual({
      allowReserved: false,
      explode: true,
      style: "form",
    });
    expect(limit?.valueKind === "schema" ? limit.schema : undefined).toEqual({
      constraints: { maximum: 100, minimum: 1 },
      defaultValue: 20,
      kind: "scalar",
      type: "integer",
    });
    expect(listPets?.responses.map((response) => response.status)).toEqual([
      { code: 200, kind: "code" },
      { kind: "range", range: "4XX" },
      { kind: "default" },
    ]);
    expect(
      listPets?.responses[0]?.headers.map((header) => header.name),
    ).toEqual(["X-Next"]);
    expect(listPets?.responses[0]?.bodies[0]?.examples).toEqual([
      {
        id: "short",
        name: "short",
        summary: "One pet",
        value: [{ id: 1, kind: "dog", name: "Rex" }],
      },
    ]);
    expect(listPets?.security).toEqual([
      { schemes: [{ schemeId: "apiKey", scopes: [] }] },
    ]);

    const createPet = api.operations[1];
    expect(createPet?.security).toEqual([
      {
        schemes: [
          { schemeId: "apiKey", scopes: [] },
          { schemeId: "mtls", scopes: [] },
        ],
      },
      { schemes: [{ schemeId: "oauth", scopes: ["pets:write"] }] },
      { schemes: [] },
    ]);
    expect(createPet?.requestBody?.required).toBe(true);
    const bodies = createPet?.requestBody?.content.map(
      (media) => media.mediaType,
    );
    expect(bodies).toEqual([
      "application/json",
      "application/x-www-form-urlencoded",
      "multipart/form-data",
    ]);
    const multipart = createPet?.requestBody?.content.find(
      (media) => media.mediaType === "multipart/form-data",
    );
    expect(multipart?.encodings).toEqual([
      {
        encodingKind: "serialization",
        headers: [],
        propertyName: "meta",
        serialization: { allowReserved: false, explode: true, style: "form" },
      },
      {
        contentType: "image/png",
        encodingKind: "content",
        headers: [
          {
            deprecated: false,
            examples: [],
            name: "X-Rate",
            schema: { kind: "scalar", type: "integer" },
            serialization: { explode: false, style: "simple" },
            valueKind: "schema",
          },
        ],
        propertyName: "photo",
      },
    ]);
    expect(
      createPet?.responses.find(
        (response) =>
          response.status.kind === "code" && response.status.code === 204,
      )?.bodies,
    ).toEqual([]);

    const getPet = api.operations[2];
    expect(getPet?.deprecated).toBe(true);
    expect(getPet?.parameters[0]?.id).toBe("path.petId");
    expect(
      getPet?.responses[0]?.bodies.map((media) => media.mediaType),
    ).toEqual(["application/json", "application/octet-stream", "text/plain"]);

    const pet = schema(result, "basic-3.1.yaml", "/components/schemas/Pet");
    expect(pet.kind).toBe("object");
    if (pet.kind !== "object") return;
    expect(pet.required).toEqual(["id", "name"]);
    expect(pet.additionalProperties).toBe(false);
    expect(pet.propertyOrder).toEqual([
      "id",
      "name",
      "kind",
      "tags",
      "owner",
      "nickname",
      "weight",
      "matrix",
      "anything",
      "nothing",
      "mode",
    ]);
    expect(pet.properties.id).toEqual({
      format: "int64",
      kind: "scalar",
      type: "integer",
    });
    expect(pet.properties.kind).toEqual({
      enumValues: ["dog", "cat"],
      kind: "scalar",
      type: "string",
    });
    expect(pet.properties.tags).toEqual({
      items: { kind: "scalar", type: "string" },
      kind: "array",
      uniqueItems: true,
    });
    expect(pet.properties.owner).toEqual({
      kind: "ref",
      schemaId: createSchemaId("basic-3.1.yaml", "/components/schemas/Owner"),
    });
    expect(pet.properties.nickname).toEqual({
      kind: "composition",
      mode: "anyOf",
      variants: [
        { kind: "scalar", type: "string" },
        { kind: "scalar", type: "null" },
      ],
    });
    expect(pet.properties.weight).toEqual({
      constraints: { exclusiveMinimum: 0 },
      kind: "scalar",
      type: "number",
    });
    expect(pet.properties.matrix).toEqual({
      additionalItems: false,
      kind: "tuple",
      prefixItems: [
        { kind: "scalar", type: "number" },
        { kind: "scalar", type: "number" },
      ],
    });
    expect(pet.properties.anything).toEqual({
      accepts: true,
      kind: "boolean-schema",
    });
    expect(pet.properties.nothing).toEqual({
      accepts: false,
      kind: "boolean-schema",
    });
    expect(pet.properties.mode).toEqual({
      applicableTypes: [],
      constValue: "strict",
      kind: "type-less",
    });
    const owner = schema(result, "basic-3.1.yaml", "/components/schemas/Owner");
    expect(owner.kind === "object" ? owner.properties.pets : undefined).toEqual(
      {
        items: {
          kind: "ref",
          schemaId: createSchemaId("basic-3.1.yaml", "/components/schemas/Pet"),
        },
        kind: "array",
      },
    );

    const first = serializeDocumentationArtifact(result.artifact!);
    const again = await ingest(fixtureAcquisition("basic-3.1.yaml"));
    expect(serializeDocumentationArtifact(again.artifact!)).toBe(first);
    expect(validateDocumentationArtifact(result.artifact)).toEqual([]);
  });

  it("converts 3.0 dialect constructs and diagnoses invalid pairings", async () => {
    const sentinel = await ingest(fixtureAcquisition("openapi-3.0.yaml"));
    expect(sentinel.ok).toBe(true);
    expect(
      schema(
        sentinel,
        "openapi-3.0.yaml",
        "/components/schemas/LegacyNullable",
      ),
    ).toEqual({
      kind: "composition",
      mode: "anyOf",
      name: "LegacyNullable",
      variants: [
        { kind: "scalar", type: "string" },
        { kind: "scalar", type: "null" },
      ],
    });
    expect(
      schema(
        sentinel,
        "openapi-3.0.yaml",
        "/components/schemas/LegacyExclusiveMinimum",
      ),
    ).toEqual({
      constraints: { exclusiveMinimum: 0 },
      kind: "scalar",
      name: "LegacyExclusiveMinimum",
      type: "number",
    });

    const basic = await ingest(fixtureAcquisition("basic-3.0.yaml"));
    expect(basic.ok).toBe(false);
    expect(basic.artifact).toBeUndefined();
    expect(codes(basic)).toEqual([
      "error SOURCE_INVALID basic-3.0.yaml#/components/schemas/Pet/properties/broken/exclusiveMinimum",
      "warning SOURCE_UNSUPPORTED_SEMANTIC basic-3.0.yaml#/components/schemas/Pet/properties/legacyConst/const",
    ]);
    expect(
      basic.diagnostics.every(
        (diagnostic) => diagnostic.canonicalDiagnosticId !== undefined,
      ),
    ).toBe(true);

    const siblings = await ingest(
      createMemoryAcquisition("api.yaml", {
        "api.yaml": `openapi: 3.0.3
info: { title: Siblings, version: 1.0.0 }
paths: {}
components:
  schemas:
    A:
      type: string
    B:
      $ref: "#/components/schemas/A"
      description: ignored
    C:
      properties:
        inline: true
`,
      }),
    );
    expect(codes(siblings)).toEqual([
      "error SOURCE_INVALID api.yaml#/components/schemas/C/properties/inline",
    ]);
    const failedRun = siblings;
    expect(failedRun.ok).toBe(false);
    const fixed = await ingest(
      createMemoryAcquisition("api.yaml", {
        "api.yaml": `openapi: 3.0.3
info: { title: Siblings, version: 1.0.0 }
paths: {}
components:
  schemas:
    A:
      type: string
    B:
      $ref: "#/components/schemas/A"
      description: ignored
`,
      }),
    );
    expect(fixed.ok).toBe(true);
    const b = schema(fixed, "api.yaml", "/components/schemas/B");
    expect(b.kind).toBe("ref");
    expect(b.diagnosticIds).toHaveLength(1);
    expect(
      fixed.artifact?.diagnostics.map((diagnostic) => [
        diagnostic.code,
        diagnostic.severity,
      ]),
    ).toEqual([["SCHEMA_IGNORED_ANNOTATION", "info"]]);
    expect(fixed.diagnostics).toEqual([]);
  });

  it("produces identical bytes for paired 3.0/3.1 dialect fixtures and JSON/YAML equivalents", async () => {
    const nullable30 = await ingest(
      fixtureAcquisition("pairs/nullable-3.0.yaml", "api.yaml"),
    );
    const nullable31 = await ingest(
      fixtureAcquisition("pairs/nullable-3.1.yaml", "api.yaml"),
    );
    expect(nullable30.ok && nullable31.ok).toBe(true);
    expect(serializeDocumentationArtifact(nullable30.artifact!)).toBe(
      serializeDocumentationArtifact(nullable31.artifact!),
    );

    const yaml = await ingest(
      fixtureAcquisition("pairs/equivalent.yaml", "api.yaml"),
    );
    const json = await ingest(
      fixtureAcquisition("pairs/equivalent.json", "api.yaml"),
    );
    expect(yaml.ok && json.ok).toBe(true);
    expect(serializeDocumentationArtifact(yaml.artifact!)).toBe(
      serializeDocumentationArtifact(json.artifact!),
    );
    expect(service(yaml).operations.map((operation) => operation.id)).toEqual([
      "postA",
      "getB",
    ]);
    expect(service(yaml).operations[0]?.tags).toEqual(["alpha", "zeta"]);
  });

  it("resolves project-local file references, nested files, and cycles through the registry", async () => {
    const result = await ingest(
      fixtureDirectoryAcquisition("refs", "root.yaml"),
    );
    expect(codes(result)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.sources.map((source) => source.id)).toEqual([
      "nested/address.yaml",
      "nested/deeper/country.yaml",
      "root.yaml",
      "schemas/user.yaml",
    ]);
    const rootText = fixtureText("refs/root.yaml");
    expect(result.sources[2]?.sha256).toBe(
      createHash("sha256").update(rootText).digest("hex"),
    );
    expect(result.statistics.documents).toBe(4);
    const api = service(result);
    expect(api.operations[0]?.parameters[0]?.name).toBe("page");
    const users = api.operations[0]?.responses[0]?.bodies[0]?.schema;
    const userId = createSchemaId("schemas/user.yaml", "");
    expect(users).toEqual({
      items: { kind: "ref", schemaId: userId },
      kind: "array",
    });
    const user = api.schemas[userId];
    expect(user?.kind).toBe("object");
    if (user?.kind !== "object") return;
    expect(user.properties.manager).toEqual({ kind: "ref", schemaId: userId });
    const addressId = createSchemaId(
      "nested/address.yaml",
      "/components/schemas/Address",
    );
    expect(user.properties.address).toEqual({
      kind: "ref",
      schemaId: addressId,
    });
    const address = api.schemas[addressId];
    expect(
      address?.kind === "object" ? address.properties.country : undefined,
    ).toEqual({
      kind: "ref",
      schemaId: createSchemaId("nested/deeper/country.yaml", "/Country"),
    });
    expect(schema(result, "nested/deeper/country.yaml", "/Country")).toEqual({
      enumValues: ["CA", "US"],
      kind: "scalar",
      name: "Country",
      type: "string",
    });
    const tree = schema(result, "root.yaml", "/components/schemas/Tree");
    expect(tree).toEqual({
      kind: "ref",
      name: "Tree",
      schemaId: createSchemaId("root.yaml", "/components/schemas/Node"),
    });
    const left = schema(result, "root.yaml", "/components/schemas/Left");
    expect(left.kind === "object" ? left.properties.right : undefined).toEqual({
      kind: "ref",
      schemaId: createSchemaId("root.yaml", "/components/schemas/Right"),
    });
    // Display names: component keys, top-level keys of definition documents,
    // and file stems for whole-document references; never OpenAPI paths.
    expect(user?.name).toBe("user");
    expect(address?.name).toBe("Address");
    expect(tree).toMatchObject({ name: "Tree" });
    expect(Object.values(api.schemas).map((entry) => entry.name)).not.toContain(
      undefined,
    );
    expect(validateDocumentationArtifact(result.artifact)).toEqual([]);
  });

  it("diagnoses escaping, remote, unsupported, missing, and anchor references without acquiring them", async () => {
    let acquired: string[] = [];
    const inner = fixtureAcquisition("adversarial/escape.yaml", "escape.yaml");
    const observed: SourceAcquisition = {
      async acquire(id, maxBytes) {
        acquired = [...acquired, id];
        return await inner.acquire(id, maxBytes);
      },
      entry: "escape.yaml",
    };
    const result = await ingest(observed);
    expect(result.ok).toBe(false);
    expect(acquired).toEqual(["escape.yaml", "missing.yaml"]);
    expect(codes(result)).toEqual([
      "error SOURCE_REFERENCE_OUTSIDE_ROOT escape.yaml#/components/schemas/Absolute/$ref",
      "error SOURCE_REFERENCE_OUTSIDE_ROOT escape.yaml#/components/schemas/Encoded/$ref",
      "error SOURCE_REFERENCE_OUTSIDE_ROOT escape.yaml#/components/schemas/Passwd/$ref",
      "error SOURCE_REFERENCE_REMOTE_DISABLED escape.yaml#/components/schemas/Remote/$ref",
      "error SOURCE_REFERENCE_UNRESOLVED escape.yaml#/components/schemas/BadPointer/$ref",
      "error SOURCE_REFERENCE_UNRESOLVED escape.yaml#/components/schemas/Missing/$ref",
      "error SOURCE_REFERENCE_UNSUPPORTED escape.yaml#/components/schemas/Anchor/$ref",
      "error SOURCE_REFERENCE_UNSUPPORTED escape.yaml#/components/schemas/File/$ref",
      "error SOURCE_REFERENCE_UNSUPPORTED escape.yaml#/components/schemas/Protocol/$ref",
    ]);

    const invalid = await ingest(fixtureAcquisition("invalid-ref.yaml"));
    expect(codes(invalid)).toEqual([
      "error SOURCE_REFERENCE_UNRESOLVED invalid-ref.yaml#/paths/~1missing/get/responses/200/content/application~1json/schema/$ref",
    ]);
  });

  it("reports duplicate operation IDs and canonical identity collisions deterministically", async () => {
    const duplicates = await ingest(
      fixtureAcquisition("adversarial/duplicate-operation-id.yaml", "api.yaml"),
    );
    expect(codes(duplicates)).toEqual([
      "error SOURCE_DUPLICATE_OPERATION_ID api.yaml#/paths/~1a/get/operationId",
      "error SOURCE_DUPLICATE_OPERATION_ID api.yaml#/paths/~1b/get/operationId",
    ]);

    const hashed = createOperationId({ method: "GET", path: "/x" });
    const forward = await ingest(
      inlineAcquisition(
        simple31({
          "/x": { get: { responses: { "200": { description: "ok" } } } },
          "/y": {
            get: {
              operationId: hashed,
              responses: { "200": { description: "ok" } },
            },
          },
        }),
      ),
    );
    const reversed = await ingest(
      inlineAcquisition(
        simple31({
          "/y": {
            get: {
              operationId: hashed,
              responses: { "200": { description: "ok" } },
            },
          },
          "/x": { get: { responses: { "200": { description: "ok" } } } },
        }),
      ),
    );
    expect(codes(forward)).toEqual([
      "error SOURCE_IDENTITY_COLLISION openapi.yaml#/paths/~1x/get",
      "error SOURCE_IDENTITY_COLLISION openapi.yaml#/paths/~1y/get/operationId",
    ]);
    expect(codes(reversed)).toEqual(codes(forward));

    const examples = await ingest(
      inlineAcquisition(
        simple31({
          "/x": {
            get: {
              operationId: "x",
              responses: {
                "200": {
                  content: {
                    "application/json": {
                      example: 1,
                      examples: { example: { value: 2 } },
                    },
                  },
                  description: "ok",
                },
              },
            },
          },
        }),
      ),
    );
    expect(codes(examples)).toEqual([
      "error SOURCE_INVALID openapi.yaml#/paths/~1x/get/responses/200/content/application~1json/examples",
    ]);
  });

  it("rejects unsupported versions, malformed sources, duplicate keys, and alias expansion", async () => {
    for (const [name, pointer] of [
      ["adversarial/unsupported-version.yaml", "/openapi"],
      ["adversarial/future-version.yaml", "/openapi"],
    ] as const) {
      const result = await ingest(fixtureAcquisition(name, "api.yaml"));
      expect(codes(result)).toEqual([
        `error SOURCE_UNSUPPORTED_VERSION api.yaml#${pointer}`,
      ]);
    }
    for (const name of [
      "adversarial/malformed.yaml",
      "adversarial/malformed.json",
      "adversarial/duplicate-keys.yaml",
      "adversarial/alias-bomb.yaml",
    ]) {
      const result = await ingest(fixtureAcquisition(name, "api.yaml"));
      expect(codes(result)).toEqual(["error SOURCE_PARSE_FAILED api.yaml#"]);
      expect(result.statistics.documents).toBe(0);
    }
    const scalar = await ingest(
      createMemoryAcquisition("api.yaml", { "api.yaml": "just a string" }),
    );
    expect(codes(scalar)).toEqual(["error SOURCE_PARSE_FAILED api.yaml#"]);
    const binary = await ingest(
      createMemoryAcquisition("api.yaml", {
        "api.yaml": new Uint8Array([0xff, 0xfe, 0x00]),
      }),
    );
    expect(codes(binary)).toEqual(["error SOURCE_PARSE_FAILED api.yaml#"]);
    const bom = await ingest(
      createMemoryAcquisition("api.yaml", {
        "api.yaml": new Uint8Array([
          0xef,
          0xbb,
          0xbf,
          ...new TextEncoder().encode(
            '{"openapi":"3.1.0","info":{"title":"B","version":"1"},"paths":{}}',
          ),
        ]),
      }),
    );
    expect(bom.ok).toBe(true);
  });

  it("diagnoses invalid specification shapes at their source pointers", async () => {
    const result = await ingest(
      fixtureAcquisition("adversarial/invalid-shapes.yaml", "api.yaml"),
    );
    expect(codes(result)).toEqual([
      "error SOURCE_INVALID api.yaml#/paths/~1bad-status/get/responses/2xx",
      "error SOURCE_INVALID api.yaml#/paths/~1bad-status/get/responses/999",
      "error SOURCE_INVALID api.yaml#/paths/~1no-desc/get/responses",
      "error SOURCE_INVALID api.yaml#/paths/~1no-desc/get/responses/200",
      "error SOURCE_INVALID api.yaml#/paths/~1no-responses/get/responses",
      "error SOURCE_INVALID api.yaml#/paths/~1unknown-scheme/get/security/0/nope",
      "error SOURCE_INVALID api.yaml#/paths/~1{missing}/get/parameters",
      "warning SOURCE_PARTIALLY_REPRESENTED api.yaml#/paths/~1unknown-scheme/get/security/1/apiKey",
    ]);
  });

  it("warns for webhooks, callbacks, links, and unsupported schema keywords while succeeding", async () => {
    const events = await ingest(
      fixtureAcquisition("adversarial/webhooks-callbacks.yaml", "api.yaml"),
    );
    expect(events.ok).toBe(true);
    expect(codes(events)).toEqual([
      "warning SOURCE_UNSUPPORTED_SEMANTIC api.yaml#/paths/~1subscribe/post/callbacks",
      "warning SOURCE_UNSUPPORTED_SEMANTIC api.yaml#/paths/~1subscribe/post/responses/200/links",
      "warning SOURCE_UNSUPPORTED_SEMANTIC api.yaml#/webhooks",
    ]);

    const conditional = await ingest(
      inlineAcquisition(
        simple31(
          {},
          {
            schemas: {
              Shape: {
                else: { required: ["b"] },
                if: { properties: { kind: { const: "a" } } },
                properties: {
                  kind: { type: "string" },
                  unknownKeyword: { type: "string", vendorHint: 1 },
                },
                then: { required: ["a"] },
                type: "object",
              },
            },
          },
        ),
      ),
    );
    expect(conditional.ok).toBe(true);
    expect(codes(conditional)).toEqual([
      "warning SOURCE_UNSUPPORTED_SEMANTIC openapi.yaml#/components/schemas/Shape/else",
      "warning SOURCE_UNSUPPORTED_SEMANTIC openapi.yaml#/components/schemas/Shape/if",
      "warning SOURCE_UNSUPPORTED_SEMANTIC openapi.yaml#/components/schemas/Shape/then",
    ]);
    const shape = schema(
      conditional,
      "openapi.yaml",
      "/components/schemas/Shape",
    );
    expect(shape.kind).toBe("object");
    expect(shape.diagnosticIds).toHaveLength(3);
    const artifactCodes = conditional.artifact?.diagnostics
      .map((diagnostic) => diagnostic.code)
      .sort();
    expect(artifactCodes).toEqual([
      "SCHEMA_IGNORED_ANNOTATION",
      "SCHEMA_UNSUPPORTED_SEMANTIC",
      "SCHEMA_UNSUPPORTED_SEMANTIC",
      "SCHEMA_UNSUPPORTED_SEMANTIC",
    ]);
    expect(
      validateDocumentationArtifact(conditional.artifact).filter(
        (issue) => issue.severity === "error",
      ),
    ).toEqual([]);
  });

  it("projects composition, discriminators, recursion, type arrays, and type-less schemas", async () => {
    const polymorphism = await ingest(
      fixtureAcquisition("polymorphism.yaml", "api.yaml"),
    );
    expect(codes(polymorphism)).toEqual([]);
    const pet = schema(polymorphism, "api.yaml", "/components/schemas/Pet");
    expect(pet).toEqual({
      name: "Pet",
      discriminator: {
        mapping: {
          cat: createSchemaId("api.yaml", "/components/schemas/Cat"),
          dog: createSchemaId("api.yaml", "/components/schemas/Dog"),
        },
        propertyName: "kind",
      },
      kind: "composition",
      mode: "oneOf",
      variants: [
        {
          kind: "ref",
          schemaId: createSchemaId("api.yaml", "/components/schemas/Cat"),
        },
        {
          kind: "ref",
          schemaId: createSchemaId("api.yaml", "/components/schemas/Dog"),
        },
      ],
    });
    const cat = schema(polymorphism, "api.yaml", "/components/schemas/Cat");
    expect(cat.kind === "composition" ? cat.mode : undefined).toBe("allOf");
    const dog = schema(polymorphism, "api.yaml", "/components/schemas/Dog");
    expect(dog.kind === "object" ? dog.properties.tricks : undefined).toEqual({
      kind: "composition",
      mode: "anyOf",
      variants: [
        { items: { kind: "scalar", type: "string" }, kind: "array" },
        { kind: "scalar", type: "null" },
      ],
    });

    const recursive = await ingest(
      fixtureAcquisition("recursive.yaml", "api.yaml"),
    );
    const node = schema(recursive, "api.yaml", "/components/schemas/Node");
    expect(
      node.kind === "object" ? node.properties.children : undefined,
    ).toEqual({
      items: {
        kind: "ref",
        schemaId: createSchemaId("api.yaml", "/components/schemas/Node"),
      },
      kind: "array",
    });

    const inline = await ingest(
      inlineAcquisition(
        simple31(
          {},
          {
            schemas: {
              Bare: {},
              Described: { description: "free-form" },
              EnumOnly: { enum: [1, "two", null] },
              Implicit: {
                oneOf: [
                  { $ref: "#/components/schemas/Bare" },
                  { type: "string" },
                ],
                discriminator: { propertyName: "k" },
              },
              Keywords: { minLength: 1, minimum: 0, pattern: "^a" },
              Multi: {
                enum: ["a", 1, 2.5, true],
                type: ["string", "integer", "null"],
              },
              Nullable31: { nullable: true, type: "string" },
              ObjectEnum: {
                enum: [{ a: 1 }],
                properties: { a: { type: "integer" } },
                type: "object",
              },
              Sibling: { $ref: "#/components/schemas/Bare", minLength: 2 },
              Titled: { $ref: "#/components/schemas/Bare", title: "Alias" },
            },
          },
        ),
      ),
    );
    expect(codes(inline)).toEqual([
      "warning SOURCE_PARTIALLY_REPRESENTED openapi.yaml#/components/schemas/Implicit/discriminator",
      "warning SOURCE_UNSUPPORTED_SEMANTIC openapi.yaml#/components/schemas/Nullable31/nullable",
    ]);
    expect(inline.ok).toBe(true);
    expect(schema(inline, "openapi.yaml", "/components/schemas/Bare")).toEqual({
      kind: "any",
      name: "Bare",
    });
    expect(
      schema(inline, "openapi.yaml", "/components/schemas/Described"),
    ).toEqual({ description: "free-form", kind: "any", name: "Described" });
    expect(
      schema(inline, "openapi.yaml", "/components/schemas/EnumOnly"),
    ).toEqual({
      applicableTypes: [],
      enumValues: [1, "two", null],
      kind: "type-less",
      name: "EnumOnly",
    });
    expect(
      schema(inline, "openapi.yaml", "/components/schemas/Keywords"),
    ).toEqual({
      applicableTypes: ["integer", "number", "string"],
      kind: "type-less",
      name: "Keywords",
      numeric: { minimum: 0 },
      string: { minLength: 1, pattern: "^a" },
    });
    expect(schema(inline, "openapi.yaml", "/components/schemas/Multi")).toEqual(
      {
        kind: "composition",
        mode: "anyOf",
        name: "Multi",
        variants: [
          { enumValues: ["a"], kind: "scalar", type: "string" },
          { enumValues: [1], kind: "scalar", type: "integer" },
          { kind: "scalar", type: "null" },
        ],
      },
    );
    expect(
      schema(inline, "openapi.yaml", "/components/schemas/ObjectEnum"),
    ).toMatchObject({
      applicableTypes: ["object"],
      enumValues: [{ a: 1 }],
      kind: "type-less",
      object: { propertyOrder: ["a"] },
    });
    const bareId = createSchemaId("openapi.yaml", "/components/schemas/Bare");
    expect(
      schema(inline, "openapi.yaml", "/components/schemas/Titled"),
    ).toEqual({
      kind: "ref",
      name: "Titled",
      schemaId: bareId,
      title: "Alias",
    });
    expect(
      schema(inline, "openapi.yaml", "/components/schemas/Sibling"),
    ).toEqual({
      kind: "composition",
      mode: "allOf",
      name: "Sibling",
      variants: [
        { kind: "ref", schemaId: bareId },
        {
          applicableTypes: ["string"],
          kind: "type-less",
          string: { minLength: 2 },
        },
      ],
    });
    const implicit = schema(
      inline,
      "openapi.yaml",
      "/components/schemas/Implicit",
    );
    expect(
      implicit.kind === "composition" && implicit.mode !== "not"
        ? implicit.discriminator
        : undefined,
    ).toEqual({
      mapping: { Bare: bareId },
      propertyName: "k",
    });
  });

  it("preserves hostile text as inert data and never echoes source values in diagnostics", async () => {
    const result = await ingest(
      fixtureAcquisition("adversarial/controls.yaml", "api.yaml"),
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    const api = service(result);
    expect(api.name).toContain("\u001b]8;;");
    expect(api.operations[0]?.title).toBe("Summary\r\ninjected: line");
    expect(api.operations[0]?.responses[0]?.description).toBe(
      "Bearer do-not-log-this-fixture-value",
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain("do-not-log");

    const malicious = await ingest(
      fixtureAcquisition("malicious.yaml", "api.yaml"),
    );
    expect(malicious.ok).toBe(true);
    expect("compromised" in globalThis).toBe(false);
  });

  it("enforces operation, document, reference, example, and diagnostic budgets", async () => {
    const limits = { ...DEFAULT_INGESTION_LIMITS };
    const operations = await ingest(
      fixtureAcquisition("basic-3.1.yaml", "api.yaml"),
      { limits: { ...limits, maxOperations: 1 } },
    );
    expect(codes(operations)).toEqual([
      "error SOURCE_LIMIT_EXCEEDED api.yaml#/paths/~1pets/post",
    ]);

    const documents = await ingest(
      fixtureDirectoryAcquisition("refs", "root.yaml"),
      { limits: { ...limits, maxDocuments: 1 } },
    );
    expect(codes(documents)).toEqual([
      "error SOURCE_LIMIT_EXCEEDED root.yaml#/components/schemas/Address/$ref",
    ]);

    const references = await ingest(
      fixtureAcquisition("basic-3.1.yaml", "api.yaml"),
      { limits: { ...limits, maxReferences: 2 } },
    );
    expect(codes(references)).toEqual([
      "error SOURCE_LIMIT_EXCEEDED api.yaml#/paths/~1pets/post/requestBody/content/multipart~1form-data/schema/properties/meta/$ref",
    ]);

    const examples = await ingest(
      fixtureAcquisition("basic-3.1.yaml", "api.yaml"),
      { limits: { ...limits, maxExampleBytes: 8 } },
    );
    expect(codes(examples)).toEqual([
      "error SOURCE_LIMIT_EXCEEDED api.yaml#/paths/~1pets/get/responses/200/content/application~1json/examples/short/value",
    ]);

    const truncated = await ingest(
      fixtureAcquisition("adversarial/invalid-shapes.yaml", "api.yaml"),
      { limits: { ...limits, maxDiagnostics: 3 } },
    );
    expect(codes(truncated)).toEqual([
      "error SOURCE_INVALID api.yaml#/paths/~1bad-status/get/responses/2xx",
      "error SOURCE_INVALID api.yaml#/paths/~1bad-status/get/responses/999",
      "error SOURCE_LIMIT_EXCEEDED api.yaml#",
    ]);

    const bytes = await ingest(
      fixtureAcquisition("basic-3.1.yaml", "api.yaml"),
      { limits: { ...limits, maxBytes: 100 } },
    );
    expect(codes(bytes)).toEqual(["error SOURCE_LIMIT_EXCEEDED api.yaml#"]);

    const total = await ingest(
      fixtureDirectoryAcquisition("refs", "root.yaml"),
      { limits: { ...limits, maxTotalBytes: 1_100 } },
    );
    expect(codes(total)).toEqual(["error SOURCE_LIMIT_EXCEEDED root.yaml#"]);

    await expect(
      ingest(fixtureAcquisition("basic-3.1.yaml", "api.yaml"), {
        limits: { ...limits, maxDepth: 0 },
      }),
    ).rejects.toThrow(TypeError);
  });

  it("reports a canonical artifact that outgrows the model budget as a source limit", async () => {
    const result = await ingest(
      fixtureAcquisition("basic-3.1.yaml", "api.yaml"),
      {
        modelLimits: {
          maxCollectionEntries: 100_000,
          maxDepth: 128,
          maxDiagnostics: 10_000,
          maxNodes: 50,
          maxSerializedLength: 10_000_000,
          maxStringLength: 1_000_000,
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.artifactDiagnostics).toEqual([]);
    expect(codes(result)).toEqual(["error SOURCE_LIMIT_EXCEEDED api.yaml#"]);
  });

  it("supports cancellation, multiple services, and service identity collisions", async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = await ingest(fixtureAcquisition("basic-3.1.yaml"), {
      signal: controller.signal,
    });
    expect(cancelled).toMatchObject({ cancelled: true, ok: false });

    await expect(ingestOpenApi({ project, sources: [] })).rejects.toThrow(
      TypeError,
    );

    const two = await ingestOpenApi({
      project,
      sources: [
        fixtureAcquisition("basic-3.1.yaml", "b.yaml"),
        fixtureAcquisition("recursive.yaml", "a.yaml"),
      ],
    });
    expect(two.ok).toBe(true);
    expect(
      two.artifact?.model.versions[0]?.services.map((entry) => entry.id),
    ).toEqual(["b.yaml", "a.yaml"]);
    expect(two.artifact?.model.project.name).toBe("Specra tests");

    const clash = await ingestOpenApi({
      project,
      sources: [
        fixtureAcquisition("basic-3.1.yaml", "same.yaml"),
        fixtureAcquisition("recursive.yaml", "same.yaml"),
      ],
    });
    // Both locations are the same document root, so the sink keeps one entry.
    expect(codes(clash)).toEqual([
      "error SOURCE_IDENTITY_COLLISION same.yaml#",
    ]);
  });

  it("normalizes servers, parameter overrides, media types, and encodings faithfully", async () => {
    const result = await ingest(
      inlineAcquisition(
        simple31({
          "/items/{id}": {
            get: {
              operationId: "getItem",
              parameters: [
                {
                  in: "query",
                  name: "verbose",
                  schema: { type: "boolean" },
                  style: "form",
                  explode: false,
                },
                { in: "cookie", name: "session", schema: { type: "string" } },
                {
                  in: "path",
                  name: "id",
                  required: true,
                  schema: { type: "string" },
                  style: "label",
                },
                {
                  content: { "text/plain": { schema: { type: "string" } } },
                  in: "header",
                  name: "X-Raw",
                },
              ],
              responses: {
                "200": {
                  content: {
                    "application/JSON": { schema: { type: "string" } },
                    "application/json": { schema: { type: "string" } },
                    "not a media type": { schema: { type: "string" } },
                  },
                  description: "ok",
                },
              },
              servers: [{ url: "https://op.example.test" }],
            },
            parameters: [
              {
                in: "path",
                name: "id",
                required: true,
                schema: { type: "integer" },
              },
              { in: "query", name: "verbose", schema: { type: "string" } },
            ],
            servers: [
              { url: "https://path.example.test" },
              { url: "https://root.example.test" },
            ],
            post: {
              operationId: "createItem",
              requestBody: {
                content: {
                  "multipart/form-data": {
                    encoding: {
                      missing: { contentType: "image/png" },
                      name: { contentType: "text/plain" },
                    },
                    schema: {
                      properties: { name: { type: "string" } },
                      type: "object",
                    },
                  },
                },
              },
              responses: { "200": { description: "ok" } },
            },
          },
        }),
      ),
    );
    expect(codes(result)).toEqual([
      "error SOURCE_INVALID openapi.yaml#/paths/~1items~1{id}/get/responses/200/content/application~1json",
      "error SOURCE_INVALID openapi.yaml#/paths/~1items~1{id}/get/responses/200/content/not a media type",
      "error SOURCE_INVALID openapi.yaml#/paths/~1items~1{id}/post/requestBody/content/multipart~1form-data/encoding/missing",
    ]);
    const relaxed = await ingest(
      inlineAcquisition(
        simple31({
          "/items/{id}": {
            get: {
              operationId: "getItem",
              parameters: [
                {
                  in: "query",
                  name: "verbose",
                  schema: { type: "boolean" },
                  style: "form",
                  explode: false,
                },
                { in: "cookie", name: "session", schema: { type: "string" } },
                {
                  in: "path",
                  name: "id",
                  required: true,
                  schema: { type: "string" },
                  style: "label",
                },
                {
                  content: { "text/plain": { schema: { type: "string" } } },
                  in: "header",
                  name: "X-Raw",
                },
              ],
              responses: { "200": { description: "ok" } },
              servers: [{ url: "https://op.example.test" }],
            },
            parameters: [
              {
                in: "path",
                name: "id",
                required: true,
                schema: { type: "integer" },
              },
              { in: "query", name: "verbose", schema: { type: "string" } },
            ],
            servers: [
              { url: "https://path.example.test" },
              { url: "https://root.example.test" },
            ],
            post: {
              operationId: "createItem",
              responses: { "200": { description: "ok" } },
            },
          },
        }),
      ),
    );
    expect(relaxed.ok).toBe(true);
    const api = service(relaxed);
    expect(api.servers.map((server) => server.url)).toEqual([
      "https://path.example.test",
      "https://root.example.test",
      "https://op.example.test",
    ]);
    const getItem = api.operations.find(
      (operation) => operation.id === "getItem",
    );
    const createItem = api.operations.find(
      (operation) => operation.id === "createItem",
    );
    expect(getItem?.serverIds).toEqual([api.servers[2]?.id]);
    expect([...(createItem?.serverIds ?? [])].sort()).toEqual(
      [api.servers[0]?.id, api.servers[1]?.id].sort(),
    );
    expect(
      getItem?.parameters.map((parameter) => [
        parameter.location,
        parameter.name,
        parameter.valueKind === "schema"
          ? [parameter.serialization, parameter.schema]
          : "content",
      ]),
    ).toEqual([
      [
        "path",
        "id",
        [
          { explode: false, style: "label" },
          { kind: "scalar", type: "string" },
        ],
      ],
      [
        "query",
        "verbose",
        [
          { allowReserved: false, explode: false, style: "form" },
          { kind: "scalar", type: "boolean" },
        ],
      ],
      [
        "cookie",
        "session",
        [
          { explode: true, style: "form" },
          { kind: "scalar", type: "string" },
        ],
      ],
      ["header", "X-Raw", "content"],
    ]);
    expect(createItem?.parameters.map((parameter) => parameter.name)).toEqual([
      "id",
      "verbose",
    ]);
  });

  it("rejects mutual TLS in 3.0, invalid server variables, and inconsistent security metadata", async () => {
    const result = await ingest(
      createMemoryAcquisition("api.yaml", {
        "api.yaml": `openapi: 3.0.3
info: { title: Security, version: 1.0.0 }
servers:
  - url: https://{region}.example.test
    variables:
      other: { default: x }
paths: {}
components:
  securitySchemes:
    mtls:
      type: mutualTLS
    flows:
      type: oauth2
      flows:
        implicit:
          scopes: {}
    apiKey:
      type: apiKey
      name: k
      in: body
`,
      }),
    );
    expect(codes(result)).toEqual([
      "error SOURCE_INVALID api.yaml#/components/securitySchemes/apiKey",
      "error SOURCE_INVALID api.yaml#/components/securitySchemes/flows/flows",
      "error SOURCE_INVALID api.yaml#/components/securitySchemes/flows/flows/implicit/authorizationUrl",
      "error SOURCE_INVALID api.yaml#/components/securitySchemes/mtls/type",
      "error SOURCE_INVALID api.yaml#/servers/0/variables",
    ]);
  });
});
