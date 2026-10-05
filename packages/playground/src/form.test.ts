import type {
  ApiService,
  Operation,
  Parameter,
  SchemaNode,
  SecurityScheme,
} from "@specra/model";
import { projectOperation } from "@specra/snippets";
import { describe, expect, it } from "vitest";

import { projectOperationForm } from "./form.js";

/**
 * SPEC-009 §32–§44, §53: the build-time capability analysis. Every browser
 * limitation is decided here from the canonical model: cookie parameters,
 * forbidden headers, query and cookie API keys, mutual TLS, and other HTTP
 * schemes are unsupported; bearer, OAuth 2.0, OpenID Connect, header API
 * keys, and basic are supported; an OR of ANDs is never flattened.
 */

const brand = <T>(value: string): T => value as unknown as T;
const string: SchemaNode = { kind: "scalar", type: "string" };

function parameter(
  name: string,
  location: Parameter["location"],
  overrides: Partial<{
    required: boolean;
    schema: SchemaNode;
    example: unknown;
    deprecated: boolean;
    description: string;
  }> = {},
): Parameter {
  return {
    deprecated: overrides.deprecated ?? false,
    ...(overrides.description === undefined
      ? {}
      : { description: overrides.description }),
    examples:
      overrides.example === undefined
        ? []
        : [{ id: brand(`e-${name}`), name: "x", value: overrides.example }],
    id: brand(`p-${name}`),
    location,
    name,
    required: overrides.required ?? false,
    schema: overrides.schema ?? string,
    serialization:
      location === "query"
        ? { allowReserved: false, explode: true, style: "form" }
        : location === "path"
          ? { explode: false, style: "simple" }
          : location === "header"
            ? { explode: false, style: "simple" }
            : { explode: true, style: "form" },
    valueKind: "schema",
  } as unknown as Parameter;
}

function build(input: {
  parameters?: readonly Parameter[];
  security?: Operation["security"];
  schemes?: Record<string, SecurityScheme>;
  requestBody?: Operation["requestBody"];
  schemas?: ApiService["schemas"];
}) {
  const operation: Operation = {
    contractId: "op",
    deprecated: false,
    extensions: {},
    id: brand("op"),
    method: "POST",
    parameters: input.parameters ?? [
      parameter("inboxId", "path", { example: "inb_1", required: true }),
    ],
    path: "/inboxes/{inboxId}",
    ...(input.requestBody === undefined
      ? {}
      : { requestBody: input.requestBody }),
    responses: [],
    security: input.security ?? [],
    serverIds: [],
    tags: [],
    title: "Op",
  };
  const service: ApiService = {
    extensions: {},
    id: brand("svc"),
    name: "Service",
    operations: [operation],
    schemas: input.schemas ?? {},
    securitySchemes: input.schemes ?? {},
    servers: [
      {
        id: brand("s"),
        label: "Prod",
        url: "https://api.example.com/v1",
        variables: {},
      },
    ],
  };
  return projectOperationForm(
    service,
    operation,
    projectOperation(service, operation).projection,
  );
}

describe("projectOperationForm", () => {
  it("projects an executable operation with typed fields and example-seeded values", () => {
    const form = build({
      parameters: [
        parameter("inboxId", "path", {
          description: "The inbox.",
          example: "inb_1",
          required: true,
        }),
        parameter("limit", "query", {
          example: 5,
          schema: { kind: "scalar", type: "integer" },
        }),
        parameter("unread", "query", {
          schema: { defaultValue: true, kind: "scalar", type: "boolean" },
        }),
        parameter("sort", "query", {
          schema: {
            enumValues: ["asc", "desc"],
            kind: "scalar",
            type: "string",
          },
        }),
        parameter("tags", "query", {
          schema: { items: string, kind: "array" },
        }),
        parameter("X-Request-Id", "header", { example: "req-1" }),
      ],
      schemes: { bearer: { kind: "http", scheme: "bearer" } },
      security: [{ schemes: [{ schemeId: brand("bearer"), scopes: [] }] }],
    });
    expect(form.capability).toEqual({ reasons: [], state: "executable" });
    expect(form.method).toBe("POST");
    expect(form.pathTemplate).toBe("/inboxes/{inboxId}");
    expect(
      form.parameters.map((field) => [
        field.name,
        field.location,
        field.kind,
        field.array,
        field.initial,
        field.required,
      ]),
    ).toEqual([
      ["inboxId", "path", "string", false, "inb_1", true],
      ["limit", "query", "integer", false, "5", false],
      ["unread", "query", "boolean", false, "true", false],
      ["sort", "query", "enum", false, "asc", false],
      ["tags", "query", "json", true, "", false],
      ["X-Request-Id", "header", "string", false, "req-1", false],
    ]);
    expect(form.parameters[0]?.description).toBe("The inbox.");
    expect(form.parameters[3]?.options).toEqual(["asc", "desc"]);
    expect(form.auth).toEqual([
      {
        label: "Bearer token",
        schemes: [
          {
            kind: "bearer",
            label: "Bearer token",
            scopes: [],
            supported: true,
          },
        ],
        supported: true,
      },
    ]);
  });

  it("never seeds a credential-shaped parameter or body value", () => {
    const form = build({
      parameters: [
        parameter("api_key", "query", { example: "sk_live_123" }),
        parameter("Authorization", "header", { example: "Bearer x" }),
      ],
      requestBody: {
        content: [
          {
            encodings: [],
            examples: [
              {
                id: brand("j"),
                name: "j",
                value: { label: "x", password: "hunter2", token: "t" },
              },
            ],
            mediaType: "application/json",
          },
        ],
        required: true,
      },
    });
    expect(form.parameters.map((field) => field.initial)).toEqual(["", ""]);
    expect(form.bodies[0]?.initial).not.toContain("hunter2");
    expect(form.bodies[0]?.initial).not.toContain('"t"');
    expect(form.bodies[0]?.initial).toContain('"label": "x"');
  });

  it("marks a required cookie parameter as unsupported and an optional one as partial", () => {
    const required = build({
      parameters: [parameter("session", "cookie", { required: true })],
    });
    expect(required.capability).toEqual({
      reasons: ["cookie-parameter"],
      state: "unsupported",
    });
    expect(required.parameters[0]).toMatchObject({
      capability: "unsupported",
      location: "cookie",
      reason: "cookie-parameter",
    });
    const optional = build({ parameters: [parameter("session", "cookie")] });
    expect(optional.capability).toEqual({ reasons: [], state: "partial" });
  });

  it("marks forbidden request headers as unsupported", () => {
    for (const name of [
      "Cookie",
      "Host",
      "Origin",
      "Sec-Fetch-Mode",
      "Proxy-Authorization",
      "Content-Length",
    ]) {
      const form = build({
        parameters: [parameter(name, "header", { required: true })],
      });
      expect(form.capability, name).toEqual({
        reasons: ["forbidden-header"],
        state: "unsupported",
      });
    }
    const custom = build({
      parameters: [parameter("X-Custom", "header", { required: true })],
    });
    expect(custom.capability.state).toBe("executable");
  });

  it("classifies every security scheme kind", () => {
    const schemes: Record<string, SecurityScheme> = {
      basic: { kind: "http", scheme: "basic" },
      bearer: { kind: "http", scheme: "bearer" },
      cookieKey: { kind: "apiKey", location: "cookie", name: "session" },
      digest: { kind: "http", scheme: "digest" },
      headerKey: { kind: "apiKey", location: "header", name: "X-Api-Key" },
      hostKey: { kind: "apiKey", location: "header", name: "Cookie" },
      mtls: { kind: "mutualTLS" },
      oauth: {
        flows: [
          {
            authorizationUrl: "https://auth.example/a",
            kind: "implicit",
            scopes: { "read:x": "Read" },
          },
        ],
        kind: "oauth2",
      },
      oidc: {
        kind: "openIdConnect",
        openIdConnectUrl:
          "https://auth.example/.well-known/openid-configuration",
      },
      queryKey: { kind: "apiKey", location: "query", name: "api_key" },
    };
    const form = build({
      schemes,
      security: Object.keys(schemes).map((schemeId) => ({
        schemes: [
          {
            schemeId: brand(schemeId),
            scopes: schemeId === "oauth" ? ["read:x"] : [],
          },
        ],
      })),
    });
    const byKind = Object.fromEntries(
      form.auth.map((alternative) => [
        alternative.schemes[0]?.kind,
        alternative,
      ]),
    );
    expect(byKind.basic).toMatchObject({ supported: true });
    expect(byKind.bearer).toMatchObject({ supported: true });
    expect(byKind.oauth2).toMatchObject({ supported: true });
    expect(byKind.oauth2?.schemes[0]?.scopes).toEqual(["read:x"]);
    expect(byKind.openIdConnect).toMatchObject({ supported: true });
    expect(byKind.apiKeyHeader).toBeDefined();
    expect(
      form.auth
        .filter(
          (alternative) => alternative.schemes[0]?.kind === "apiKeyHeader",
        )
        .map((alternative) => alternative.supported),
    ).toEqual([true, false]);
    expect(byKind.apiKeyQuery).toMatchObject({ supported: false });
    expect(byKind.apiKeyQuery?.schemes[0]?.reason).toBe("auth-query-api-key");
    expect(byKind.apiKeyCookie?.schemes[0]?.reason).toBe("auth-cookie-api-key");
    expect(byKind.mutualTls?.schemes[0]?.reason).toBe("auth-mutual-tls");
    expect(byKind.httpOther?.schemes[0]?.reason).toBe(
      "auth-unsupported-scheme",
    );
    // Some alternative is usable: partial, not unsupported.
    expect(form.capability.state).toBe("partial");
  });

  it("keeps an AND alternative intact: one unsupported scheme makes the whole alternative unusable", () => {
    const form = build({
      schemes: {
        key: { kind: "apiKey", location: "header", name: "X-Api-Key" },
        mtls: { kind: "mutualTLS" },
      },
      security: [
        {
          schemes: [
            { schemeId: brand("key"), scopes: [] },
            { schemeId: brand("mtls"), scopes: [] },
          ],
        },
      ],
    });
    expect(form.auth).toHaveLength(1);
    expect(form.auth[0]?.supported).toBe(false);
    expect(form.auth[0]?.schemes.map((scheme) => scheme.supported)).toEqual([
      true,
      false,
    ]);
    expect(form.capability).toEqual({
      reasons: ["auth-mutual-tls"],
      state: "unsupported",
    });
  });

  it("is unsupported when every alternative is unusable, listing each reason once", () => {
    const form = build({
      schemes: {
        cookie: { kind: "apiKey", location: "cookie", name: "s" },
        query: { kind: "apiKey", location: "query", name: "k" },
        query2: { kind: "apiKey", location: "query", name: "k2" },
      },
      security: [
        { schemes: [{ schemeId: brand("cookie"), scopes: [] }] },
        { schemes: [{ schemeId: brand("query"), scopes: [] }] },
        { schemes: [{ schemeId: brand("query2"), scopes: [] }] },
      ],
    });
    expect(form.capability).toEqual({
      reasons: ["auth-cookie-api-key", "auth-query-api-key"],
      state: "unsupported",
    });
  });

  it("treats anonymous access as executable without credentials", () => {
    const form = build({
      schemes: { key: { kind: "apiKey", location: "query", name: "k" } },
      security: [
        { schemes: [] },
        { schemes: [{ schemeId: brand("key"), scopes: [] }] },
      ],
    });
    expect(form.auth.some((alternative) => alternative.supported)).toBe(true);
    expect(form.capability.state).toBe("partial");
  });

  it("projects json, form, multipart, text, and binary bodies with fields", () => {
    const schemas: ApiService["schemas"] = {
      Upload: {
        additionalProperties: false,
        kind: "object",
        properties: {
          alt: string,
          logo: { format: "binary", kind: "scalar", type: "string" },
        },
        propertyOrder: ["logo", "alt"],
        required: ["logo"],
      },
    };
    const form = build({
      requestBody: {
        content: [
          {
            encodings: [],
            examples: [{ id: brand("j"), name: "j", value: { label: "x" } }],
            mediaType: "application/json",
          },
          {
            encodings: [],
            examples: [
              { id: brand("f"), name: "f", value: { label: "a b", note: "n" } },
            ],
            mediaType: "application/x-www-form-urlencoded",
          },
          {
            encodings: [],
            examples: [],
            mediaType: "multipart/form-data",
            schema: { kind: "ref", schemaId: brand("Upload") },
          },
          {
            encodings: [],
            examples: [{ id: brand("t"), name: "t", value: "hello" }],
            mediaType: "text/plain",
          },
          { encodings: [], examples: [], mediaType: "image/png" },
        ],
        required: true,
      },
      schemas,
    });
    expect(form.bodyRequired).toBe(true);
    expect(form.bodies.map((body) => [body.mediaType, body.kind])).toEqual([
      ["application/json", "json"],
      ["application/x-www-form-urlencoded", "form"],
      ["multipart/form-data", "multipart"],
      ["text/plain", "text"],
      ["image/png", "binary"],
    ]);
    expect(form.bodies[0]?.initial).toBe('{\n  "label": "x"\n}');
    expect(form.bodies[1]?.fields).toEqual([
      { file: false, initial: "a b", name: "label", required: false },
      { file: false, initial: "n", name: "note", required: false },
    ]);
    const multipart = form.bodies[2]?.fields ?? [];
    expect(multipart.find((field) => field.name === "logo")).toMatchObject({
      file: true,
      initial: "",
      required: true,
    });
    expect(multipart.find((field) => field.name === "alt")).toMatchObject({
      file: false,
      required: false,
    });
    expect(form.bodies[3]?.initial).toBe("hello");
    expect(form.bodies[4]?.initial).toBe("");
  });

  it("bounds parameter counts, option counts, and text lengths", () => {
    const parameters = Array.from({ length: 40 }, (_, index) =>
      parameter(`q${index}`, "query", {
        schema: {
          enumValues: Array.from({ length: 100 }, (_, option) => `o${option}`),
          kind: "scalar",
          type: "string",
        },
      }),
    );
    const form = build({
      parameters: [
        ...parameters,
        parameter("long", "header", { example: "word ".repeat(1_000) }),
      ],
    });
    expect(
      form.parameters.filter((field) => field.location === "query"),
    ).toHaveLength(24);
    expect(form.parameters[0]?.options).toHaveLength(64);
    expect(
      form.parameters.find((field) => field.name === "long")?.initial.length,
    ).toBeLessThanOrEqual(2_048);
  });

  it("omits deprecated optional parameters but keeps deprecated required ones", () => {
    const form = build({
      parameters: [
        parameter("old", "query", { deprecated: true }),
        parameter("must", "query", { deprecated: true, required: true }),
      ],
    });
    expect(form.parameters.map((field) => field.name)).toEqual(["must"]);
  });
});
