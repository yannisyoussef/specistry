import type {
  ApiService,
  Operation,
  Parameter,
  SchemaNode,
  SecurityScheme,
} from "@specistry/model";

/**
 * A hand-built canonical service covering the SPEC-008 golden matrix:
 * every parameter location and style, every body media kind, every
 * security scheme kind including compound requirements, recursion,
 * composition, and hostile strings. Ids are plain strings cast to the
 * branded model types; nothing here goes through the OpenAPI adapter.
 */

type Brand<T> = T & { readonly __brand: never };
const id = <T>(value: string): T => value as unknown as T;

const string: SchemaNode = { kind: "scalar", type: "string" };
const integer: SchemaNode = { kind: "scalar", type: "integer" };

function parameter(
  name: string,
  location: "cookie" | "header" | "path" | "query",
  schema: SchemaNode,
  extra: Partial<Parameter> & {
    readonly serialization?: Record<string, unknown>;
    readonly example?: unknown;
  } = {},
): Parameter {
  const { example, serialization, ...rest } = extra;
  const base = {
    deprecated: false,
    description: undefined,
    examples:
      example === undefined
        ? []
        : [
            {
              id: id<Brand<string>>(`example-${name}`),
              name: "example",
              value: example as never,
            },
          ],
    id: id<Brand<string>>(`parameter-${location}-${name}`),
    location,
    name,
    required: location === "path",
    schema,
    valueKind: "schema" as const,
    ...rest,
  };
  const defaults =
    location === "query"
      ? { allowReserved: false, explode: true, style: "form" }
      : location === "path"
        ? { explode: false, style: "simple" }
        : location === "header"
          ? { explode: false, style: "simple" }
          : { explode: true, style: "form" };
  return {
    ...base,
    serialization: { ...defaults, ...serialization },
  } as unknown as Parameter;
}

const stringArray: SchemaNode = { items: string, kind: "array" };
const pointObject: SchemaNode = {
  additionalProperties: false,
  kind: "object",
  properties: { x: integer, y: integer },
  propertyOrder: ["x", "y"],
  required: ["x", "y"],
};

export const SCHEMES: Readonly<Record<string, SecurityScheme>> = {
  apiKeyCookie: { kind: "apiKey", location: "cookie", name: "sid" },
  apiKeyHeader: { kind: "apiKey", location: "header", name: "X-Api-Key" },
  apiKeyQuery: { kind: "apiKey", location: "query", name: "api_key" },
  basic: { kind: "http", scheme: "basic" },
  bearer: { bearerFormat: "JWT", kind: "http", scheme: "bearer" },
  digest: { kind: "http", scheme: "digest" },
  mtls: { kind: "mutualTLS" },
  oauth: {
    flows: [
      {
        authorizationUrl: "https://auth.example.com/authorize",
        kind: "authorizationCode",
        scopes: { "team:read": "Read", "team:write": "Write" },
        tokenUrl: "https://auth.example.com/token",
      },
    ],
    kind: "oauth2",
  },
  oidc: {
    kind: "openIdConnect",
    openIdConnectUrl:
      "https://auth.example.com/.well-known/openid-configuration",
  },
};

function operation(
  contractId: string,
  method: Operation["method"],
  path: string,
  extra: Partial<Operation> = {},
): Operation {
  return {
    contractId,
    deprecated: false,
    extensions: {},
    id: id<Brand<string>>(contractId),
    method,
    parameters: [],
    path,
    responses: [
      {
        bodies: [
          {
            encodings: [],
            examples: [],
            mediaType: "application/json",
            schema: { kind: "ref", schemaId: id<Brand<string>>("Item") },
          },
        ],
        description: "OK",
        headers: [],
        status: { code: 200, kind: "code" },
      },
    ],
    security: [
      { schemes: [{ schemeId: id<Brand<string>>("bearer"), scopes: [] }] },
    ],
    serverIds: [],
    tags: [],
    title: contractId,
    ...extra,
  };
}

const requirement = (...ids: string[]) => ({
  schemes: ids.map((schemeId) => ({
    schemeId: id<Brand<string>>(schemeId),
    scopes: schemeId === "oauth" ? ["team:read"] : [],
  })),
});

const itemSchema: SchemaNode = {
  additionalProperties: false,
  kind: "object",
  properties: {
    children: {
      items: { kind: "ref", schemaId: id<Brand<string>>("Item") },
      kind: "array",
    },
    createdAt: {
      format: "date-time",
      kind: "scalar",
      readOnly: true,
      type: "string",
    },
    email: { format: "email", kind: "scalar", type: "string" },
    id: { kind: "scalar", readOnly: true, type: "string" },
    name: { kind: "scalar", type: "string" },
    parent: { kind: "ref", schemaId: id<Brand<string>>("Item") },
    secretToken: { kind: "scalar", type: "string" },
    ttl: {
      constraints: { minimum: 60 },
      defaultValue: 3600,
      kind: "scalar",
      type: "integer",
    },
  },
  propertyOrder: [
    "id",
    "name",
    "email",
    "ttl",
    "secretToken",
    "parent",
    "children",
    "createdAt",
  ],
  required: ["name"],
};

const shapeSchema: SchemaNode = {
  discriminator: {
    mapping: {
      circle: id<Brand<string>>("Circle"),
      square: id<Brand<string>>("Square"),
    },
    propertyName: "kind",
  },
  kind: "composition",
  mode: "oneOf",
  variants: [
    { kind: "ref", schemaId: id<Brand<string>>("Circle") },
    { kind: "ref", schemaId: id<Brand<string>>("Square") },
  ],
};

export const HOSTILE = {
  bidi: "safe‮evil",
  crlf: "value\r\nInjected-Header: yes",
  html: "</script><script>alert(1)</script>",
  java: 'say "hi" \\ path',
  js: "${process.env.SECRET}`+alert(1)+`",
  python: 'end" ; import os',
  shell: "$(touch /tmp/pwned)'; rm -rf / #",
  template: "`whoami`",
  unicode: "café 日本語 😀",
} as const;

export const OPERATIONS: readonly Operation[] = [
  operation(
    "getWithPathAndQuery",
    "GET",
    "/inboxes/{inboxId}/messages/{tag}/{point}",
    {
      parameters: [
        parameter("inboxId", "path", string),
        parameter("tag", "path", stringArray, {
          example: ["a", "b"],
          serialization: { explode: true, style: "label" },
        }),
        parameter("point", "path", pointObject, {
          example: { x: 1, y: 2 },
          serialization: { explode: true, style: "matrix" },
        }),
        parameter("limit", "query", integer, { example: 20 }),
        parameter("tags", "query", stringArray, { example: ["a", "b c"] }),
        parameter("csv", "query", stringArray, {
          example: ["a", "b"],
          serialization: { explode: false },
        }),
        parameter("space", "query", stringArray, {
          example: ["a", "b"],
          serialization: { explode: false, style: "spaceDelimited" },
        }),
        parameter("pipe", "query", stringArray, {
          example: ["a", "b"],
          serialization: { explode: false, style: "pipeDelimited" },
        }),
        parameter("filter", "query", pointObject, {
          example: { x: 1, y: 2 },
          serialization: { style: "deepObject" },
        }),
        parameter("obj", "query", pointObject, {
          example: { x: 1, y: 2 },
          serialization: { explode: false },
        }),
        parameter("path", "query", string, {
          example: "/a/b?c=d&e",
          serialization: { allowReserved: true },
        }),
        parameter("ignored", "query", string, { deprecated: true }),
        parameter("X-Trace", "header", stringArray, { example: ["t1", "t2"] }),
        parameter("X-Point", "header", pointObject, {
          example: { x: 1, y: 2 },
          serialization: { explode: true },
        }),
        parameter("Bad Header", "header", string),
        parameter("prefs", "cookie", string, { example: "compact mode" }),
      ],
      security: [requirement("apiKeyHeader")],
    },
  ),
  operation("postJson", "POST", "/inboxes", {
    requestBody: {
      content: [
        {
          encodings: [],
          examples: [],
          mediaType: "application/json",
          schema: { kind: "ref", schemaId: id<Brand<string>>("Item") },
        },
      ],
      required: true,
    },
    responses: [
      {
        bodies: [],
        description: "Created",
        headers: [],
        status: { code: 201, kind: "code" },
      },
    ],
    security: [requirement("apiKeyHeader"), requirement("bearer")],
  }),
  operation("patchJson", "PATCH", "/inboxes/{inboxId}", {
    parameters: [parameter("inboxId", "path", string)],
    requestBody: {
      content: [
        {
          encodings: [],
          examples: [
            { id: id<Brand<string>>("empty"), name: "empty", value: {} },
            {
              id: id<Brand<string>>("named"),
              name: "named",
              value: { name: "renamed", password: "hunter2" },
            },
          ],
          mediaType: "application/vnd.api+json",
        },
      ],
      required: true,
    },
    security: [requirement("basic")],
  }),
  operation("uploadMultipart", "PUT", "/domains/{domainId}/logo", {
    parameters: [parameter("domainId", "path", string)],
    requestBody: {
      content: [
        {
          encodings: [
            {
              contentType: "image/png, image/svg+xml",
              encodingKind: "content",
              headers: [],
              propertyName: "file",
            },
          ],
          examples: [],
          mediaType: "multipart/form-data",
          schema: {
            additionalProperties: false,
            kind: "object",
            properties: {
              altText: string,
              file: { format: "binary", kind: "scalar", type: "string" },
            },
            propertyOrder: ["file", "altText"],
            required: ["file"],
          },
        },
      ],
      required: true,
    },
    responses: [
      {
        bodies: [],
        description: "Stored",
        headers: [],
        status: { code: 204, kind: "code" },
      },
    ],
    security: [requirement("oauth")],
  }),
  operation("submitForm", "POST", "/forms", {
    requestBody: {
      content: [
        {
          encodings: [],
          examples: [],
          mediaType: "application/x-www-form-urlencoded",
          schema: {
            additionalProperties: false,
            kind: "object",
            properties: { note: string, ttl: integer },
            propertyOrder: ["ttl", "note"],
            required: ["ttl"],
          },
        },
        {
          encodings: [],
          examples: [],
          mediaType: "application/json",
          schema: {
            additionalProperties: false,
            kind: "object",
            properties: { note: string, ttl: integer },
            propertyOrder: ["ttl", "note"],
            required: ["ttl"],
          },
        },
      ],
      required: true,
    },
    security: [requirement("apiKeyQuery")],
  }),
  operation("uploadBinary", "PUT", "/files/{fileId}", {
    parameters: [parameter("fileId", "path", string)],
    requestBody: {
      content: [
        {
          encodings: [],
          examples: [],
          mediaType: "application/octet-stream",
          schema: { format: "binary", kind: "scalar", type: "string" },
        },
      ],
      required: true,
    },
    responses: [
      {
        bodies: [{ encodings: [], examples: [], mediaType: "text/plain" }],
        description: "Stored",
        headers: [],
        status: { code: 200, kind: "code" },
      },
    ],
    security: [requirement("apiKeyCookie")],
  }),
  operation("postText", "POST", "/notes", {
    requestBody: {
      content: [
        {
          encodings: [],
          examples: [
            {
              id: id<Brand<string>>("note"),
              name: "note",
              value: "line one\nline two",
            },
          ],
          mediaType: "text/plain",
        },
      ],
      required: true,
    },
    security: [requirement("digest")],
  }),
  operation("compoundAuth", "DELETE", "/team/{memberId}", {
    parameters: [parameter("memberId", "path", string)],
    responses: [
      {
        bodies: [],
        description: "Removed",
        headers: [],
        status: { code: 204, kind: "code" },
      },
    ],
    security: [
      requirement("apiKeyHeader", "mtls"),
      requirement("oidc"),
      { schemes: [] },
    ],
  }),
  operation("headCheck", "HEAD", "/inboxes/{inboxId}", {
    parameters: [parameter("inboxId", "path", string)],
    responses: [
      {
        bodies: [],
        description: "Exists",
        headers: [],
        status: { code: 200, kind: "code" },
      },
    ],
    security: [],
  }),
  operation("optionsProbe", "OPTIONS", "/inboxes", {
    responses: [
      {
        bodies: [],
        description: "Allowed",
        headers: [],
        status: { code: 204, kind: "code" },
      },
    ],
    security: [],
  }),
  operation("postShape", "POST", "/shapes", {
    requestBody: {
      content: [
        {
          encodings: [],
          examples: [],
          mediaType: "application/json",
          schema: shapeSchema,
        },
      ],
      required: true,
    },
    security: [],
  }),
  operation("postXml", "POST", "/xml", {
    requestBody: {
      content: [
        {
          encodings: [],
          examples: [],
          mediaType: "application/xml",
          schema: pointObject,
        },
      ],
      required: true,
    },
    security: [],
  }),
  operation("hostile", "POST", "/hostile/{seg}", {
    description: HOSTILE.shell,
    parameters: [
      parameter("seg", "path", string, { example: HOSTILE.shell }),
      parameter("q", "query", string, { example: HOSTILE.js }),
      parameter("X-Evil", "header", string, { example: HOSTILE.crlf }),
      parameter("c", "cookie", string, { example: HOSTILE.template }),
    ],
    requestBody: {
      content: [
        {
          encodings: [],
          examples: [
            {
              id: id<Brand<string>>("hostile"),
              name: "hostile",
              value: {
                bidi: HOSTILE.bidi,
                html: HOSTILE.html,
                java: HOSTILE.java,
                python: HOSTILE.python,
                shell: HOSTILE.shell,
                unicode: HOSTILE.unicode,
              },
            },
          ],
          mediaType: "application/json",
        },
        {
          encodings: [],
          examples: [
            {
              id: id<Brand<string>>("hostileText"),
              name: "text",
              value: `${HOSTILE.shell} ${HOSTILE.java} ${HOSTILE.python}`,
            },
          ],
          mediaType: "text/plain",
        },
      ],
      required: true,
    },
    security: [requirement("bearer")],
  }),
];

export const SERVICE: ApiService = {
  extensions: {},
  id: id<Brand<string>>("service"),
  name: "Golden API",
  operations: OPERATIONS,
  schemas: {
    Circle: {
      additionalProperties: false,
      kind: "object",
      properties: { kind: string, radius: integer },
      propertyOrder: ["kind", "radius"],
      required: ["kind", "radius"],
    },
    Item: itemSchema,
    Square: {
      additionalProperties: false,
      kind: "object",
      properties: { kind: string, side: integer },
      propertyOrder: ["kind", "side"],
      required: ["kind", "side"],
    },
  },
  securitySchemes: SCHEMES,
  servers: [
    {
      id: id<Brand<string>>("production"),
      label: "Production",
      url: "https://api.example.com/{version}",
      variables: { version: { allowedValues: ["v1"], defaultValue: "v1" } },
    },
    {
      id: id<Brand<string>>("relative"),
      label: "Relative",
      url: "/v1",
      variables: {},
    },
    {
      id: id<Brand<string>>("insecure"),
      label: "Insecure",
      url: "http://api.example.com",
      variables: {},
    },
    {
      id: id<Brand<string>>("credentials"),
      label: "Credentials",
      url: "https://user:pass@api.example.com",
      variables: {},
    },
    {
      id: id<Brand<string>>("local"),
      label: "Local",
      url: "http://localhost:8080/api",
      variables: {},
    },
  ],
};

export function findOperation(contractId: string): Operation {
  const found = OPERATIONS.find(
    (candidate) => candidate.contractId === contractId,
  );
  if (found === undefined)
    throw new Error(`No fixture operation ${contractId}`);
  return found;
}
