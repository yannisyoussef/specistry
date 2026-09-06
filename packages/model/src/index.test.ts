import { describe, expect, expectTypeOf, it } from "vitest";

import goldenModelV1 from "./fixtures/model-v1.golden.json" with { type: "json" };

import {
  CanonicalModelError,
  DEFAULT_MODEL_LIMITS,
  DOCUMENT_MODEL_VERSION,
  canonicalizeDocumentationArtifact,
  createCanonicalId,
  createDiagnostic,
  createOperationId,
  createSchemaId,
  parseDocumentationArtifact,
  serializeDocumentationArtifact,
  validateDocumentationArtifact,
  validateDocumentationModel,
  type DiagnosticId,
  type ApiService,
  type DocumentationArtifact,
  type DocumentationVersionId,
  type ExampleId,
  type MediaTypeContent,
  type OperationId,
  type Parameter,
  type ParameterId,
  type ProjectId,
  type SchemaId,
  type SchemaNode,
  type SecuritySchemeId,
  type ServerId,
  type ServiceId,
} from "./index.js";

const asId = <T extends string>(value: string): T => value as T;

function artifactFixture(): DocumentationArtifact {
  const capability = createDiagnostic({
    code: "SCHEMA_UNSUPPORTED_SEMANTIC",
    location: { path: "/model/versions/0/services/0/schemas/Unsupported" },
  });
  const nodeId = asId<SchemaId>("Node");
  const branchId = asId<SchemaId>("Branch");
  const cycleAId = asId<SchemaId>("CycleA");
  const cycleBId = asId<SchemaId>("CycleB");
  const leafId = asId<SchemaId>("Leaf");
  const apiKeyId = asId<SecuritySchemeId>("api-key");
  const mtlsId = asId<SecuritySchemeId>("mtls");
  const oauthId = asId<SecuritySchemeId>("oauth");
  const serverId = asId<ServerId>("production");

  return {
    diagnostics: [capability],
    model: {
      modelVersion: DOCUMENT_MODEL_VERSION,
      project: {
        canonicalUrl: "https://docs.example.test",
        description: "Canonical fixture",
        id: asId<ProjectId>("specra-fixture"),
        name: "Fixture",
      },
      versions: [
        {
          id: asId<DocumentationVersionId>("v1"),
          label: "Version 1",
          pages: [],
          services: [
            {
              description: "Fixture service",
              extensions: { "x-owner": "platform" },
              id: asId<ServiceId>("payments"),
              name: "Payments",
              operations: [
                {
                  contractId: "create-payment",
                  deprecated: true,
                  description: "Create one payment",
                  extensions: {},
                  id: asId<OperationId>("create-payment"),
                  method: "POST",
                  parameters: [
                    {
                      deprecated: false,
                      examples: [example("merchant", "m_123")],
                      id: asId<ParameterId>("merchant-id"),
                      location: "path",
                      name: "merchantId",
                      required: true,
                      schema: { kind: "scalar", type: "string" },
                      serialization: {
                        explode: false,
                        style: "simple",
                      },
                      valueKind: "schema",
                    },
                    {
                      deprecated: false,
                      examples: [],
                      id: asId<ParameterId>("verbose"),
                      location: "query",
                      name: "verbose",
                      required: false,
                      schema: { kind: "scalar", type: "boolean" },
                      serialization: {
                        allowReserved: false,
                        explode: true,
                        style: "form",
                      },
                      valueKind: "schema",
                    },
                    {
                      content: {
                        encodings: [],
                        examples: [],
                        mediaType: "text/plain",
                        schema: { kind: "scalar", type: "string" },
                      },
                      deprecated: false,
                      examples: [],
                      id: asId<ParameterId>("trace"),
                      location: "header",
                      name: "X-Trace",
                      required: false,
                      valueKind: "content",
                    },
                    {
                      deprecated: false,
                      examples: [],
                      id: asId<ParameterId>("session"),
                      location: "cookie",
                      name: "session",
                      required: false,
                      schema: { kind: "scalar", type: "string" },
                      serialization: {
                        explode: true,
                        style: "form",
                      },
                      valueKind: "schema",
                    },
                  ],
                  path: "/merchants/{merchantId}/payments",
                  requestBody: {
                    description: "Payment payload",
                    required: true,
                    content: [
                      media(
                        "multipart/form-data",
                        {
                          kind: "ref",
                          schemaId: branchId,
                        },
                        [
                          {
                            contentType: "application/json",
                            encodingKind: "content",
                            headers: [],
                            propertyName: "child",
                          },
                        ],
                      ),
                      media("application/json", {
                        kind: "ref",
                        schemaId: branchId,
                      }),
                      media(
                        "application/x-www-form-urlencoded",
                        { kind: "ref", schemaId: branchId },
                        [
                          {
                            encodingKind: "serialization",
                            headers: [],
                            propertyName: "child",
                            serialization: {
                              allowReserved: false,
                              explode: true,
                              style: "form",
                            },
                          },
                          {
                            contentType: "image/png",
                            encodingKind: "content",
                            headers: [],
                            propertyName: "nodes",
                          },
                        ],
                      ),
                      media("text/plain", { kind: "scalar", type: "string" }),
                      media("application/octet-stream", {
                        kind: "scalar",
                        format: "binary",
                        type: "string",
                      }),
                    ],
                  },
                  responses: [
                    {
                      bodies: [],
                      description: "No content",
                      headers: [],
                      status: { code: 204, kind: "code" },
                    },
                    {
                      bodies: [
                        media("application/json", {
                          kind: "ref",
                          schemaId: nodeId,
                        }),
                      ],
                      description: "Created",
                      headers: [
                        {
                          deprecated: false,
                          examples: [],
                          name: "Location",
                          schema: { kind: "scalar", type: "string" },
                          serialization: { explode: false, style: "simple" },
                          valueKind: "schema",
                        },
                      ],
                      status: { code: 201, kind: "code" },
                    },
                    {
                      bodies: [],
                      description: "Client error",
                      headers: [],
                      status: { kind: "range", range: "4XX" },
                    },
                    {
                      bodies: [],
                      description: "Fallback",
                      headers: [],
                      status: { kind: "default" },
                    },
                  ],
                  security: [
                    {
                      schemes: [
                        { schemeId: apiKeyId, scopes: [] },
                        { schemeId: mtlsId, scopes: [] },
                      ],
                    },
                    {
                      schemes: [
                        { schemeId: oauthId, scopes: ["payments:write"] },
                      ],
                    },
                  ],
                  serverIds: [serverId],
                  tags: ["Payments", "Write"],
                  title: "Create payment",
                },
              ],
              schemas: {
                Any: { kind: "any" },
                Branch: {
                  additionalProperties: false,
                  kind: "object",
                  properties: {
                    child: { kind: "ref", schemaId: leafId },
                    nodes: {
                      items: { kind: "ref", schemaId: nodeId },
                      kind: "array",
                    },
                  },
                  propertyOrder: ["child", "nodes"],
                  required: ["child"],
                },
                Composed: {
                  discriminator: {
                    mapping: { branch: branchId, leaf: leafId },
                    propertyName: "kind",
                  },
                  kind: "composition",
                  mode: "oneOf",
                  variants: [
                    { kind: "ref", schemaId: branchId },
                    { kind: "ref", schemaId: leafId },
                  ],
                },
                ComposedCycle: {
                  kind: "composition",
                  mode: "allOf",
                  variants: [{ kind: "ref", schemaId: cycleAId }],
                },
                CycleA: {
                  additionalProperties: false,
                  kind: "object",
                  properties: { next: { kind: "ref", schemaId: cycleBId } },
                  propertyOrder: ["next"],
                  required: [],
                },
                CycleB: {
                  additionalProperties: false,
                  kind: "object",
                  properties: { next: { kind: "ref", schemaId: cycleAId } },
                  propertyOrder: ["next"],
                  required: [],
                },
                Every: { accepts: true, kind: "boolean-schema" },
                Intersection: {
                  discriminator: {
                    mapping: { branch: branchId },
                    propertyName: "kind",
                  },
                  kind: "composition",
                  mode: "allOf",
                  variants: [
                    { kind: "ref", schemaId: branchId },
                    { kind: "ref", schemaId: leafId },
                  ],
                },
                Leaf: {
                  constValue: "leaf",
                  enumValues: ["leaf", "terminal"],
                  kind: "scalar",
                  readOnly: true,
                  type: "string",
                },
                Neither: {
                  kind: "composition",
                  mode: "not",
                  variants: [{ kind: "ref", schemaId: leafId }],
                },
                Node: {
                  additionalProperties: false,
                  kind: "object",
                  name: "Node",
                  properties: {
                    children: {
                      items: { kind: "ref", schemaId: nodeId },
                      kind: "array",
                    },
                  },
                  propertyOrder: ["children"],
                  required: [],
                },
                Nothing: { accepts: false, kind: "boolean-schema" },
                Options: {
                  additionalItems: false,
                  kind: "tuple",
                  prefixItems: [
                    { kind: "scalar", type: "string" },
                    { kind: "scalar", type: "integer" },
                  ],
                },
                TypeLess: {
                  applicableTypes: ["integer", "number", "string"],
                  kind: "type-less",
                  numeric: { minimum: 0 },
                  string: { minLength: 1 },
                },
                TypeLessCollections: {
                  applicableTypes: ["array", "object"],
                  array: { items: { kind: "any" }, uniqueItems: true },
                  constValue: { mode: "strict" },
                  enumValues: [{ mode: "strict" }, ["fallback"]],
                  kind: "type-less",
                  object: {
                    additionalProperties: true,
                    properties: {},
                    propertyOrder: [],
                    required: [],
                  },
                },
                Union: {
                  kind: "composition",
                  mode: "anyOf",
                  variants: [
                    { kind: "scalar", type: "string" },
                    { kind: "scalar", type: "null" },
                  ],
                  writeOnly: true,
                },
                Unsupported: {
                  diagnosticIds: [capability.id],
                  kind: "unknown",
                  reason: "unsupported",
                },
              },
              securitySchemes: {
                "api-key": {
                  kind: "apiKey",
                  location: "header",
                  name: "X-API-Key",
                },
                basic: { kind: "http", scheme: "basic" },
                bearer: { bearerFormat: "JWT", kind: "http", scheme: "bearer" },
                mtls: { kind: "mutualTLS" },
                oauth: {
                  flows: [
                    {
                      authorizationUrl: "https://auth.example.test/authorize",
                      kind: "authorizationCode",
                      scopes: {
                        "payments:read": "Read",
                        "payments:write": "Write",
                      },
                      tokenUrl: "https://auth.example.test/token",
                    },
                  ],
                  kind: "oauth2",
                },
                oidc: {
                  kind: "openIdConnect",
                  openIdConnectUrl:
                    "https://auth.example.test/.well-known/openid-configuration",
                },
              },
              servers: [
                {
                  id: serverId,
                  label: "Production",
                  url: "https://{region}.api.example.test",
                  variables: {
                    region: {
                      allowedValues: ["ca", "us"],
                      defaultValue: "ca",
                      description: "Deployment region",
                    },
                  },
                },
              ],
            },
          ],
          status: "current",
        },
      ],
    },
  };
}

function example(id: string, value: string) {
  return { id: asId<ExampleId>(id), name: id, value };
}

function media(
  mediaType: string,
  schema: DocumentationArtifact["model"]["versions"][number]["services"][number]["schemas"][string],
  encodings: MediaTypeContent["encodings"] = [],
) {
  return { encodings, examples: [], mediaType, schema };
}

describe("canonical model contract", () => {
  it("exposes a stable versioned, source-independent model", () => {
    const artifact = artifactFixture();
    expectTypeOf(artifact.model.modelVersion).toEqualTypeOf<1>();
    expect(artifact.model.modelVersion).toBe(1);
    expect(validateDocumentationArtifact(artifact)).toEqual([]);
  });

  it("represents primitive, free-form, boolean, tuple, type-less, and composed schemas", () => {
    const schemas = artifactFixture().model.versions[0]?.services[0]?.schemas;
    expect(schemas?.Any).toMatchObject({ kind: "any" });
    expect(schemas?.Every).toMatchObject({
      accepts: true,
      kind: "boolean-schema",
    });
    expect(schemas?.Nothing).toMatchObject({
      accepts: false,
      kind: "boolean-schema",
    });
    expect(schemas?.TypeLess).toMatchObject({
      applicableTypes: ["integer", "number", "string"],
      kind: "type-less",
      numeric: { minimum: 0 },
      string: { minLength: 1 },
    });
    expect(schemas?.Neither).toMatchObject({
      mode: "not",
      variants: [{ kind: "ref" }],
    });
    expect(schemas?.TypeLessCollections).toMatchObject({
      applicableTypes: ["array", "object"],
      constValue: { mode: "strict" },
      enumValues: [{ mode: "strict" }, ["fallback"]],
    });
  });

  it("carries declared tag definitions in declaration order (additive)", () => {
    const artifact = artifactFixture();
    const service = artifact.model.versions[0]?.services[0];
    if (service === undefined) throw new Error("service");
    const tagged = withService(artifact, {
      ...service,
      tags: [
        { description: "Second in source order.", name: "beta" },
        { name: "alpha" },
      ],
    });
    expect(validateDocumentationModel(tagged.model)).toEqual([]);
    const roundTrip = parseDocumentationArtifact(
      serializeDocumentationArtifact(tagged),
    );
    expect(roundTrip.model.versions[0]?.services[0]?.tags).toEqual([
      { description: "Second in source order.", name: "beta" },
      { name: "alpha" },
    ]);
    const duplicate = withService(artifact, {
      ...service,
      tags: [{ name: "alpha" }, { name: "alpha" }],
    });
    expect(
      validateDocumentationModel(duplicate.model).map((issue) => issue.code),
    ).toEqual(["DUPLICATE_ID"]);
    const empty = withService(artifact, {
      ...service,
      tags: [{ name: "" }],
    });
    expect(validateDocumentationModel(empty.model)).toHaveLength(1);
  });

  it("carries an optional, non-unique display name on registry schemas", () => {
    const artifact = artifactFixture();
    const schemas = artifact.model.versions[0]?.services[0]?.schemas;
    expect(schemas?.Node).toMatchObject({ kind: "object", name: "Node" });
    // The name is presentation only: identity stays the registry ID, so the
    // same name on two entries is valid and an absent name is valid.
    expect(schemas?.Branch?.name).toBeUndefined();
    expect(validateDocumentationModel(artifact.model)).toEqual([]);
    const roundTrip = parseDocumentationArtifact(
      serializeDocumentationArtifact(artifact),
    );
    expect(roundTrip.model.versions[0]?.services[0]?.schemas.Node?.name).toBe(
      "Node",
    );
    const duplicateNames = withSchema(artifact, "Leaf", {
      ...schemas!.Leaf!,
      name: "Node",
    });
    expect(validateDocumentationModel(duplicateNames.model)).toEqual([]);
    const emptyName = withSchema(artifact, "Node", {
      ...schemas!.Node!,
      name: "",
    });
    expect(
      validateDocumentationModel(emptyName.model).map((issue) => [
        issue.code,
        issue.location?.path,
      ]),
    ).toEqual([["INVALID_SCHEMA", "/versions/0/services/0/schemas/Node/name"]]);
    const numericName = withSchema(artifact, "Node", {
      ...schemas!.Node!,
      name: 7 as unknown as string,
    });
    expect(validateDocumentationModel(numericName.model)).toHaveLength(1);
  });

  it("represents direct, indirect, array, and composed recursion through registry IDs", () => {
    const artifact = artifactFixture();
    const schemas = artifact.model.versions[0]?.services[0]?.schemas;
    expect(schemas?.Node).toMatchObject({
      properties: { children: { items: { schemaId: "Node" } } },
    });
    expect(schemas?.Branch).toMatchObject({
      properties: { child: { schemaId: "Leaf" } },
    });
    expect(schemas?.Composed).toMatchObject({
      discriminator: { mapping: { branch: "Branch", leaf: "Leaf" } },
    });
    expect(schemas?.Intersection).toMatchObject({
      discriminator: { mapping: { branch: "Branch" } },
      mode: "allOf",
    });
    expect(schemas?.CycleA).toMatchObject({
      properties: { next: { schemaId: "CycleB" } },
    });
    expect(schemas?.CycleB).toMatchObject({
      properties: { next: { schemaId: "CycleA" } },
    });
    expect(schemas?.ComposedCycle).toMatchObject({
      variants: [{ schemaId: "CycleA" }],
    });
    expect(validateDocumentationModel(artifact.model)).toEqual([]);
  });

  it("preserves transport, body-less response, media, server, and auth AND/OR semantics", () => {
    const operation =
      artifactFixture().model.versions[0]?.services[0]?.operations[0];
    expect(operation?.parameters.map(({ location }) => location)).toEqual([
      "path",
      "query",
      "header",
      "cookie",
    ]);
    expect(
      operation?.requestBody?.content.map(({ mediaType }) => mediaType),
    ).toEqual([
      "multipart/form-data",
      "application/json",
      "application/x-www-form-urlencoded",
      "text/plain",
      "application/octet-stream",
    ]);
    expect(operation?.responses[0]).toMatchObject({
      bodies: [],
      status: { code: 204 },
    });
    expect(operation?.requestBody?.content[0]?.encodings[0]).toMatchObject({
      contentType: "application/json",
      encodingKind: "content",
      propertyName: "child",
    });
    expect(operation?.security).toHaveLength(2);
    expect(operation?.security[0]?.schemes).toHaveLength(2);
    expect(operation?.serverIds).toEqual(["production"]);
    expect(operation?.deprecated).toBe(true);
  });
});

describe("identity", () => {
  it("derives deterministic IDs without conflating distinct paths", () => {
    const ids = ["/things", "/things/", "//things"].map((path) =>
      createOperationId({ method: "GET", path }),
    );
    expect(new Set(ids)).toHaveLength(3);
    expect(createSchemaId("memory:fixture", "/schemas/Node")).toBe(
      createSchemaId("memory:fixture", "/schemas/Node"),
    );
    expect(createSchemaId("memory:fixture", "/schemas/Node")).not.toBe(
      createSchemaId("memory:fixture", "/schemas/Leaf"),
    );
  });

  it("separates contract operation IDs from canonical identities", () => {
    expect(
      createOperationId({
        contractId: "get-item",
        method: "GET",
        path: "/items",
      }),
    ).toBe("get-item");
    const derived = createOperationId({
      contractId: "get item/v1",
      method: "GET",
      path: "/items",
    });
    expect(derived).toMatch(/^op_[a-f0-9]{16}$/);
    expect(derived).toBe(
      createOperationId({
        contractId: "get item/v1",
        method: "POST",
        path: "/elsewhere",
      }),
    );
    expect(() =>
      createOperationId({ contractId: "", method: "GET", path: "/items" }),
    ).toThrow(TypeError);
  });

  it("constructs branded explicit IDs through one validated public factory", () => {
    const project = createCanonicalId("project", "project-one");
    const service = createCanonicalId("service", "service-one");
    expectTypeOf(project).toEqualTypeOf<ProjectId>();
    expectTypeOf(service).toEqualTypeOf<ServiceId>();
    expect(project).toBe("project-one");
    expect(service).toBe("service-one");
  });

  it("validates schema pointer syntax before deriving an identity", () => {
    expect(createSchemaId("source", "/schemas/~0escaped/~1slash")).toMatch(
      /^schema_/,
    );
    expect(() => createSchemaId("source", "/schemas/~2invalid")).toThrow(
      TypeError,
    );
    expect(() => createSchemaId("", "/schemas/Value")).toThrow(TypeError);
  });

  it("rejects collisions within identity scopes", () => {
    const artifact = artifactFixture();
    const service = artifact.model.versions[0]?.services[0];
    if (service === undefined) throw new Error("fixture");
    (service.operations as unknown as object[]).push(
      service.operations[0] as object,
    );
    expect(validateDocumentationArtifact(artifact)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DUPLICATE_ID" }),
      ]),
    );
  });
});

describe("deterministic serialization", () => {
  it("matches and parses the committed canonical v1 golden fixture", () => {
    const bytes = JSON.stringify(goldenModelV1);
    const parsed = parseDocumentationArtifact(bytes);
    expect(serializeDocumentationArtifact(parsed)).toBe(bytes);
    expect(parsed.model.modelVersion).toBe(1);
  });
  it("canonicalizes unordered maps and semantic sets to byte-identical output", () => {
    const left = artifactFixture();
    const right = structuredClone(left) as DocumentationArtifact;
    const service = right.model.versions[0]?.services[0];
    const operation = service?.operations[0];
    if (service === undefined || operation === undefined)
      throw new Error("fixture");
    (service as unknown as Record<string, unknown>).schemas =
      Object.fromEntries(Object.entries(service.schemas).reverse());
    (service as unknown as Record<string, unknown>).securitySchemes =
      Object.fromEntries(Object.entries(service.securitySchemes).reverse());
    (operation.tags as unknown as string[]).reverse();
    (operation.responses as unknown as object[]).reverse();
    (operation.requestBody?.content as unknown as object[]).reverse();
    (operation.security as unknown as object[]).reverse();
    expect(serializeDocumentationArtifact(right)).toBe(
      serializeDocumentationArtifact(left),
    );
  });

  it("orders exact response codes before overlapping status ranges deterministically", () => {
    const left = artifactFixture();
    const operation = left.model.versions[0]?.services[0]?.operations[0];
    if (operation === undefined) throw new Error("fixture");
    (operation.responses as unknown as object[]).push({
      bodies: [],
      description: "Exact client error",
      headers: [],
      status: { code: 499, kind: "code" },
    });
    const right = structuredClone(left) as DocumentationArtifact;
    (
      right.model.versions[0]?.services[0]?.operations[0]
        ?.responses as unknown as object[]
    ).reverse();
    expect(serializeDocumentationArtifact(right)).toBe(
      serializeDocumentationArtifact(left),
    );
  });

  it("preserves presentation-significant array order", () => {
    const left = artifactFixture();
    const right = structuredClone(left) as DocumentationArtifact;
    (
      right.model.versions[0]?.services[0]?.operations[0]
        ?.parameters as unknown as Parameter[]
    ).reverse();
    expect(serializeDocumentationArtifact(right)).not.toBe(
      serializeDocumentationArtifact(left),
    );
  });

  it("canonicalizes seeded permutations of semantic collections", () => {
    const expected = serializeDocumentationArtifact(artifactFixture());
    let state = 0x5eed1234;
    const random = () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
    for (let run = 0; run < 32; run += 1) {
      const artifact = structuredClone(
        artifactFixture(),
      ) as DocumentationArtifact;
      const service = artifact.model.versions[0]?.services[0];
      const operation = service?.operations[0];
      if (service === undefined || operation === undefined)
        throw new Error("fixture");
      (service as unknown as Record<string, unknown>).schemas =
        Object.fromEntries(
          Object.entries(service.schemas).sort(() => random() - 0.5),
        );
      (service as unknown as Record<string, unknown>).securitySchemes =
        Object.fromEntries(
          Object.entries(service.securitySchemes).sort(() => random() - 0.5),
        );
      (operation.tags as unknown as string[]).sort(() => random() - 0.5);
      (operation.responses as unknown as object[]).sort(() => random() - 0.5);
      (operation.security as unknown as object[]).sort(() => random() - 0.5);
      expect(serializeDocumentationArtifact(artifact)).toBe(expected);
    }
  });

  it("distinguishes scoped security alternatives and orders them collision-free", () => {
    const left = artifactFixture();
    const operation = left.model.versions[0]?.services[0]?.operations[0];
    if (operation === undefined) throw new Error("fixture");
    (operation.security as unknown as object[]).push({
      schemes: [{ schemeId: "oauth", scopes: ["payments:read"] }],
    });
    const right = structuredClone(left) as DocumentationArtifact;
    (
      right.model.versions[0]?.services[0]?.operations[0]
        ?.security as unknown as object[]
    ).reverse();
    expect(validateDocumentationArtifact(left)).toEqual([]);
    expect(serializeDocumentationArtifact(right)).toBe(
      serializeDocumentationArtifact(left),
    );
  });

  it("canonicalizes media tokens without folding case-sensitive parameter values", () => {
    const artifact = artifactFixture();
    const content =
      artifact.model.versions[0]?.services[0]?.operations[0]?.requestBody
        ?.content;
    const text = content?.find(({ mediaType }) => mediaType === "text/plain");
    if (text === undefined) throw new Error("fixture");
    (text as unknown as Record<string, unknown>).mediaType =
      'Text/Plain; Profile="CaseSensitive"; CHARSET=utf-8';
    const serialized = serializeDocumentationArtifact(artifact);
    expect(serialized).toContain(
      'text/plain;charset=utf-8;profile=\\"CaseSensitive\\"',
    );
    expect(serialized).not.toContain('profile=\\"casesensitive\\"');
  });

  it("round-trips to a deeply frozen canonical artifact", () => {
    const serialized = serializeDocumentationArtifact(artifactFixture());
    const parsed = parseDocumentationArtifact(serialized);
    expect(serializeDocumentationArtifact(parsed)).toBe(serialized);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(
      Object.isFrozen(parsed.model.versions[0]?.services[0]?.schemas),
    ).toBe(true);
  });

  it("retains explicit true and false schemas as distinct bytes", () => {
    const serialized = serializeDocumentationArtifact(artifactFixture());
    expect(serialized).toContain('\"accepts\":true');
    expect(serialized).toContain('\"accepts\":false');
  });
});

describe("validation and diagnostics", () => {
  it("rejects missing references and invalid path parameters", () => {
    const artifact = artifactFixture();
    const operation = artifact.model.versions[0]?.services[0]?.operations[0];
    const parameter = operation?.parameters[0];
    if (operation === undefined || parameter === undefined)
      throw new Error("fixture");
    (parameter as unknown as Record<string, unknown>).required = false;
    (parameter as unknown as Record<string, unknown>).schema = {
      kind: "ref",
      schemaId: "Missing",
    };
    expect(validateDocumentationArtifact(artifact)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_PATH_PARAMETER" }),
        expect.objectContaining({ code: "MISSING_REFERENCE" }),
      ]),
    );
  });

  it("rejects inconsistent type-less applicability and property display order", () => {
    const artifact = artifactFixture();
    const schemas = artifact.model.versions[0]?.services[0]?.schemas;
    if (schemas === undefined) throw new Error("fixture");
    (schemas.TypeLess as unknown as Record<string, unknown>).applicableTypes = [
      "string",
    ];
    (schemas.Branch as unknown as Record<string, unknown>).propertyOrder = [
      "child",
    ];
    expect(
      validateDocumentationModel(artifact.model).filter(
        ({ code }) => code === "INVALID_SCHEMA",
      ),
    ).toHaveLength(2);
  });

  it.each([
    ["NaN", Number.NaN, "INVALID_JSON_VALUE"],
    ["positive infinity", Number.POSITIVE_INFINITY, "INVALID_JSON_VALUE"],
    ["negative infinity", Number.NEGATIVE_INFINITY, "INVALID_JSON_VALUE"],
    ["negative zero", -0, "INVALID_JSON_VALUE"],
    ["bigint", 1n, "NON_SERIALIZABLE"],
    ["function", () => undefined, "NON_SERIALIZABLE"],
    ["symbol", Symbol("unsafe"), "NON_SERIALIZABLE"],
    ["class instance", new Date(0), "NON_SERIALIZABLE"],
  ])("rejects %s", (_label, invalid, code) => {
    const artifact = artifactFixture();
    (artifact.model.project as unknown as Record<string, unknown>).description =
      invalid;
    expect(validateDocumentationArtifact(artifact)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
    expect(() => serializeDocumentationArtifact(artifact)).toThrow(
      CanonicalModelError,
    );
  });

  it("rejects inline cycles, sparse arrays, accessors, and symbol properties", () => {
    const cases = [
      artifactFixture(),
      artifactFixture(),
      artifactFixture(),
      artifactFixture(),
    ];
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    (
      cases[0]?.model.project as unknown as Record<string, unknown>
    ).description = cycle;
    (cases[1]?.model.versions as unknown as unknown[])[2] =
      cases[1]?.model.versions[0];
    Object.defineProperty(cases[2]?.model.project, "description", {
      enumerable: true,
      get: () => "secret",
    });
    Object.defineProperty(cases[3]?.model.project, Symbol("hidden"), {
      enumerable: true,
      value: "secret",
    });
    cases.forEach((artifact) => {
      expect(validateDocumentationArtifact(artifact)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "NON_SERIALIZABLE" }),
        ]),
      );
    });
  });

  it("enforces explicit depth, node, diagnostic, aggregate, collection, and string budgets", () => {
    const artifact = artifactFixture();
    const limits = {
      maxCollectionEntries: 2,
      maxDepth: 2,
      maxDiagnostics: 2,
      maxNodes: 20,
      maxSerializedLength: 100,
      maxStringLength: 8,
    };
    expect(validateDocumentationArtifact(artifact, limits)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MODEL_LIMIT_EXCEEDED" }),
      ]),
    );
  });

  it("caps amplified diagnostics and rejects oversized serialized input before parsing", () => {
    const artifact = artifactFixture();
    const version = artifact.model.versions[0];
    if (version === undefined) throw new Error("fixture");
    (version.pages as unknown as object[]).push({}, {}, {}, {});
    const diagnostics = validateDocumentationArtifact(artifact, {
      ...DEFAULT_MODEL_LIMITS,
      maxDiagnostics: 3,
    });
    expect(diagnostics.length).toBeLessThanOrEqual(3);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MODEL_LIMIT_EXCEEDED" }),
      ]),
    );
    expect(() =>
      parseDocumentationArtifact(" ".repeat(101), {
        ...DEFAULT_MODEL_LIMITS,
        maxSerializedLength: 100,
      }),
    ).toThrow(CanonicalModelError);
    expect(() =>
      parseDocumentationArtifact(" ".repeat(10_000_001), {
        ...DEFAULT_MODEL_LIMITS,
        maxSerializedLength: DEFAULT_MODEL_LIMITS.maxSerializedLength + 1,
      }),
    ).toThrow(
      expect.objectContaining({
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "MODEL_LIMIT_EXCEEDED" }),
        ]),
      }),
    );
  });

  it("requires exact, stable diagnostics and linked capability findings", () => {
    const missing = artifactFixture();
    (missing.diagnostics as unknown as unknown[]).splice(0, 1);
    expect(validateDocumentationArtifact(missing)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_DIAGNOSTIC" }),
      ]),
    );

    const forged = artifactFixture();
    const diagnostic = forged.diagnostics[0];
    if (diagnostic === undefined) throw new Error("fixture");
    (diagnostic as unknown as Record<string, unknown>).message =
      "attacker supplied";
    expect(validateDocumentationArtifact(forged)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_DIAGNOSTIC" }),
      ]),
    );
  });

  it("does not interpret inert extension keys as diagnostic links", () => {
    const artifact = artifactFixture();
    const service = artifact.model.versions[0]?.services[0];
    if (service === undefined) throw new Error("fixture");
    (service.extensions as unknown as Record<string, unknown>).diagnosticIds = [
      "diag_not-a-link",
    ];
    expect(validateDocumentationArtifact(artifact)).toEqual([]);
  });

  it("rejects vocabulary fields outside explicit extensions or capability diagnostics", () => {
    const artifact = artifactFixture();
    const schemas = artifact.model.versions[0]?.services[0]?.schemas;
    if (schemas === undefined) throw new Error("fixture");
    (schemas.Leaf as unknown as Record<string, unknown>).unevaluatedProperties =
      false;
    expect(validateDocumentationArtifact(artifact)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_SCHEMA" }),
      ]),
    );
    expect(() => serializeDocumentationArtifact(artifact)).toThrow(
      CanonicalModelError,
    );
  });

  it("rejects invalid constraint types, empty responses, and scopes on API keys", () => {
    const artifact = artifactFixture();
    const service = artifact.model.versions[0]?.services[0];
    const operation = service?.operations[0];
    if (service === undefined || operation === undefined)
      throw new Error("fixture");
    (service.schemas.Leaf as unknown as Record<string, unknown>).constraints = {
      minLength: "one",
    };
    (operation.security[0]?.schemes[0]?.scopes as unknown as string[]).push(
      "invalid:scope",
    );
    (operation.responses as unknown as unknown[]).splice(0);
    const diagnostics = validateDocumentationArtifact(artifact);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_MODEL" }),
        expect.objectContaining({ code: "INVALID_SCHEMA" }),
      ]),
    );
  });

  it.each([
    ["scalar constraints", "Leaf", "constraints", "oops"],
    ["scalar enum", "Leaf", "enumValues", "oops"],
    ["array uniqueness", "Node", "uniqueItems", "oops"],
    ["type-less numeric group", "TypeLess", "numeric", "oops"],
  ])("rejects malformed optional %s", (_label, schemaName, key, invalid) => {
    const artifact = artifactFixture();
    const schemas = artifact.model.versions[0]?.services[0]?.schemas;
    if (schemas === undefined) throw new Error("fixture");
    (schemas[schemaName] as unknown as Record<string, unknown>)[key] = invalid;
    expect(validateDocumentationArtifact(artifact)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_SCHEMA" }),
      ]),
    );
    expect(() => serializeDocumentationArtifact(artifact)).toThrow(
      CanonicalModelError,
    );
  });

  it("preserves distinct case-sensitive schema names, scopes, tags, and server values", () => {
    const artifact = artifactFixture();
    const service = artifact.model.versions[0]?.services[0];
    const operation = service?.operations[0];
    const branch = service?.schemas.Branch;
    const server = service?.servers[0];
    if (
      operation === undefined ||
      branch?.kind !== "object" ||
      server === undefined
    )
      throw new Error("fixture");
    (branch as unknown as Record<string, unknown>).required = ["ID", "id"];
    (server.variables.region?.allowedValues as unknown as string[]).push("CA");
    (operation.tags as unknown as string[]).push("payments");
    (operation.security as unknown as object[]).push({
      schemes: [{ schemeId: "oauth", scopes: ["Payments:Write"] }],
    });
    expect(validateDocumentationArtifact(artifact)).toEqual([]);
  });

  it("rejects malformed headings and location-incompatible serialization", () => {
    const artifact = artifactFixture();
    const version = artifact.model.versions[0];
    const operation = version?.services[0]?.operations[0];
    if (version === undefined || operation === undefined)
      throw new Error("fixture");
    (version.pages as unknown as object[]).push({
      headings: [null],
      id: "page",
      slug: "page",
      sourcePath: "page.md",
      title: "Page",
    });
    const parameter = operation.parameters[0];
    if (parameter?.valueKind !== "schema") throw new Error("fixture");
    (parameter.serialization as unknown as Record<string, unknown>).style =
      "form";
    expect(validateDocumentationArtifact(artifact)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_MODEL" }),
      ]),
    );
  });

  it("rejects per-property encodings outside multipart and form bodies", () => {
    const artifact = artifactFixture();
    const json =
      artifact.model.versions[0]?.services[0]?.operations[0]?.requestBody?.content.find(
        ({ mediaType }) => mediaType === "application/json",
      );
    if (json === undefined) throw new Error("fixture");
    (json.encodings as unknown as object[]).push({
      contentType: "application/json",
      encodingKind: "content",
      headers: [],
      propertyName: "child",
    });
    expect(validateDocumentationArtifact(artifact)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_MODEL" }),
      ]),
    );
  });

  it("requires one unambiguous materialized encoding mode", () => {
    const missing = artifactFixture();
    const missingEncoding =
      missing.model.versions[0]?.services[0]?.operations[0]?.requestBody
        ?.content[0]?.encodings[0];
    if (missingEncoding === undefined) throw new Error("fixture");
    delete (missingEncoding as unknown as Record<string, unknown>).encodingKind;
    expect(validateDocumentationArtifact(missing)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_MODEL" }),
      ]),
    );

    const conflicting = artifactFixture();
    const conflictingEncoding =
      conflicting.model.versions[0]?.services[0]?.operations[0]?.requestBody
        ?.content[0]?.encodings[0];
    if (conflictingEncoding === undefined) throw new Error("fixture");
    (conflictingEncoding as unknown as Record<string, unknown>).serialization =
      {
        allowReserved: false,
        explode: true,
        style: "form",
      };
    expect(validateDocumentationArtifact(conflicting)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_MODEL" }),
      ]),
    );
  });

  it("rejects missing, extra, or relaxed resource-limit fields", () => {
    const artifact = artifactFixture();
    expect(validateDocumentationArtifact(artifact, {} as never)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MODEL_LIMIT_EXCEEDED" }),
      ]),
    );
    expect(
      validateDocumentationArtifact(artifact, {
        ...DEFAULT_MODEL_LIMITS,
        maxDepth: DEFAULT_MODEL_LIMITS.maxDepth + 1,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MODEL_LIMIT_EXCEEDED" }),
      ]),
    );
  });

  it("rejects accessor-based limits without invoking them", () => {
    const artifact = artifactFixture();
    let invoked = false;
    const hostile = Object.fromEntries(
      Object.entries(DEFAULT_MODEL_LIMITS).map(([key, value]) => [key, value]),
    ) as unknown as Record<string, unknown>;
    Object.defineProperty(hostile, "maxDepth", {
      enumerable: true,
      get: () => {
        invoked = true;
        return Number.MAX_SAFE_INTEGER;
      },
    });
    expect(validateDocumentationArtifact(artifact, hostile as never)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MODEL_LIMIT_EXCEEDED" }),
      ]),
    );
    expect(invoked).toBe(false);
  });

  it("rejects array subclasses and non-index enumerable properties without access", () => {
    const inherited = artifactFixture();
    const version = inherited.model.versions[0];
    if (version === undefined) throw new Error("fixture");
    let invoked = false;
    class HostileArray extends Array<unknown> {}
    Object.defineProperty(HostileArray.prototype, "0", {
      get: () => {
        invoked = true;
        return version;
      },
    });
    const hostile = new HostileArray();
    hostile.length = 1;
    (inherited.model as unknown as Record<string, unknown>).versions = hostile;
    expect(validateDocumentationArtifact(inherited)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "NON_SERIALIZABLE" }),
      ]),
    );
    expect(invoked).toBe(false);

    const decorated = artifactFixture();
    Object.defineProperty(decorated.model.versions, "01", {
      enumerable: true,
      value: "must not disappear",
    });
    expect(validateDocumentationArtifact(decorated)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "NON_SERIALIZABLE" }),
      ]),
    );
  });

  it("requires unknown schemas to link the matching capability taxonomy", () => {
    const artifact = artifactFixture();
    const schema = artifact.model.versions[0]?.services[0]?.schemas.Unsupported;
    if (schema?.kind !== "unknown") throw new Error("fixture");
    const mismatch = createDiagnostic({
      code: "SCHEMA_INVALID_SEMANTIC",
      location: { path: "/model/versions/0/services/0/schemas/Unsupported" },
    });
    (artifact as unknown as Record<string, unknown>).diagnostics = [mismatch];
    (schema as unknown as Record<string, unknown>).diagnosticIds = [
      mismatch.id,
    ];
    expect(validateDocumentationArtifact(artifact)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_SCHEMA" }),
      ]),
    );
  });

  it("fixes invariant severity and rejects control-bearing diagnostic paths", () => {
    expect(() =>
      createDiagnostic({ code: "INVALID_MODEL", severity: "warning" }),
    ).toThrow(TypeError);
    expect(() =>
      createDiagnostic({
        code: "SCHEMA_UNSUPPORTED_SEMANTIC",
        location: { path: "/safe/\u202edanger" },
      }),
    ).toThrow(TypeError);
  });

  it("reports artifact-relative RFC 6901 locations", () => {
    const artifact = artifactFixture();
    const schema = artifact.model.versions[0]?.services[0]?.schemas.Leaf;
    if (schema === undefined) throw new Error("fixture");
    (schema as unknown as Record<string, unknown>).constraints = "bad";
    expect(validateDocumentationArtifact(artifact)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          location: {
            path: "/model/versions/0/services/0/schemas/Leaf/constraints",
          },
        }),
      ]),
    );
  });

  it("rejects diagnostic accessors without invoking them", () => {
    const artifact = artifactFixture();
    const diagnostic = artifact.diagnostics[0];
    if (diagnostic === undefined) throw new Error("fixture");
    let invoked = false;
    Object.defineProperty(diagnostic, "message", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "secret";
      },
    });
    expect(validateDocumentationArtifact(artifact)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "NON_SERIALIZABLE" }),
      ]),
    );
    expect(invoked).toBe(false);
  });

  it("keeps diagnostics value-free even for secret-like hostile values", () => {
    const marker = "Bearer secret-token\n::error::forged";
    const artifact = artifactFixture();
    const schemas = artifact.model.versions[0]?.services[0]?.schemas;
    if (schemas === undefined) throw new Error("fixture");
    (schemas.Node as unknown as Record<string, unknown>).properties = {
      [marker]: { kind: "ref", schemaId: marker },
    };
    const output = JSON.stringify(validateDocumentationArtifact(artifact));
    expect(output).not.toContain(marker);
    expect(output).not.toContain("secret-token");
  });

  it("sorts validation diagnostics deterministically", () => {
    const first = artifactFixture();
    const second = structuredClone(first) as DocumentationArtifact;
    const service = second.model.versions[0]?.services[0];
    if (service === undefined) throw new Error("fixture");
    (service.schemas as unknown as Record<string, unknown>) =
      Object.fromEntries(Object.entries(service.schemas).reverse());
    (first.model.project as unknown as Record<string, unknown>).id =
      "invalid/id";
    (second.model.project as unknown as Record<string, unknown>).id =
      "invalid/id";
    expect(validateDocumentationArtifact(second)).toEqual(
      validateDocumentationArtifact(first),
    );
  });

  it("rejects incompatible model versions and invalid serialized input", () => {
    const future = artifactFixture() as unknown as Record<string, unknown>;
    ((future.model as Record<string, unknown>).modelVersion as unknown) = 2;
    expect(validateDocumentationArtifact(future)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_MODEL" }),
      ]),
    );
    expect(() => parseDocumentationArtifact("not json")).toThrow(
      CanonicalModelError,
    );
  });

  it("does not mutate caller-owned input while canonicalizing", () => {
    const artifact = artifactFixture();
    const before = structuredClone(artifact);
    canonicalizeDocumentationArtifact(artifact);
    expect(artifact).toEqual(before);
    expect(Object.isFrozen(artifact)).toBe(false);
  });
});

void (null as unknown as DiagnosticId);

/** Returns a copy of the fixture with the first service replaced. */
function withService(
  artifact: DocumentationArtifact,
  service: ApiService,
): DocumentationArtifact {
  const version = artifact.model.versions[0];
  if (version === undefined) throw new Error("fixture");
  return {
    ...artifact,
    model: {
      ...artifact.model,
      versions: [{ ...version, services: [service] }],
    },
  };
}

/** Returns a copy of the fixture with one registry schema replaced. */
function withSchema(
  artifact: DocumentationArtifact,
  id: string,
  node: SchemaNode,
): DocumentationArtifact {
  const version = artifact.model.versions[0];
  const service = version?.services[0];
  if (version === undefined || service === undefined)
    throw new Error("fixture");
  return {
    ...artifact,
    model: {
      ...artifact.model,
      versions: [
        {
          ...version,
          services: [
            { ...service, schemas: { ...service.schemas, [id]: node } },
          ],
        },
      ],
    },
  };
}
