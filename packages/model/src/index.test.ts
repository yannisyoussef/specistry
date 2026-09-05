import { describe, expect, expectTypeOf, it } from "vitest";

import {
  CanonicalModelError,
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
  type DocumentationArtifact,
  type DocumentationVersionId,
  type ExampleId,
  type OperationId,
  type Parameter,
  type ParameterId,
  type ProjectId,
  type SchemaId,
  type SecuritySchemeId,
  type ServerId,
  type ServiceId,
} from "./index.js";

const asId = <T extends string>(value: string): T => value as T;

function artifactFixture(): DocumentationArtifact {
  const capability = createDiagnostic({
    code: "SCHEMA_UNSUPPORTED_SEMANTIC",
    location: { path: "/model/versions/0/services/0/schemas/11" },
  });
  const nodeId = asId<SchemaId>("Node");
  const branchId = asId<SchemaId>("Branch");
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
                        allowReserved: false,
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
                        allowReserved: false,
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
                      media("multipart/form-data", {
                        kind: "ref",
                        schemaId: branchId,
                      }),
                      media("application/json", {
                        kind: "ref",
                        schemaId: branchId,
                      }),
                      media("application/x-www-form-urlencoded", {
                        kind: "ref",
                        schemaId: branchId,
                      }),
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
                Every: { accepts: true, kind: "boolean-schema" },
                Intersection: {
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
) {
  return { examples: [], mediaType, schema };
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
    expect(operation?.security).toHaveLength(2);
    expect(operation?.security[0]?.schemes).toHaveLength(2);
    expect(operation?.serverIds).toEqual(["production"]);
    expect(operation?.deprecated).toBe(true);
  });
});

describe("identity", () => {
  it("derives deterministic IDs independent of incidental path spelling", () => {
    expect(createOperationId({ method: "GET", path: "/things/" })).toBe(
      createOperationId({ method: "GET", path: "//things" }),
    );
    expect(createSchemaId("memory:fixture", "/schemas/Node")).toBe(
      createSchemaId("memory:fixture", "/schemas/Node"),
    );
    expect(createSchemaId("memory:fixture", "/schemas/Node")).not.toBe(
      createSchemaId("memory:fixture", "/schemas/Leaf"),
    );
  });

  it("normalizes explicit IDs and rejects unsafe identities", () => {
    expect(
      createOperationId({
        explicitId: "get-item",
        method: "GET",
        path: "/items",
      }),
    ).toBe("get-item");
    expect(() =>
      createOperationId({
        explicitId: "unsafe/id",
        method: "GET",
        path: "/items",
      }),
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

  it("enforces explicit depth, node, collection, and string budgets", () => {
    const artifact = artifactFixture();
    const limits = {
      maxCollectionEntries: 2,
      maxDepth: 2,
      maxNodes: 20,
      maxStringLength: 8,
    };
    expect(validateDocumentationArtifact(artifact, limits)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MODEL_LIMIT_EXCEEDED" }),
      ]),
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
