import type {
  ApiService,
  MediaTypeContent,
  Operation,
  Parameter,
  Response,
  ResponseHeader,
  SecurityScheme,
  ServerDefinition,
} from "@specra/model";

import type {
  ReaderGroup,
  ReaderOperationSummary,
  ReaderService,
} from "./projection";
import { summarizeSchema, type SchemaSummary } from "./schema-summary";
import { mediaTypeAnchor, responseAnchor } from "./slug";

/**
 * Display-ready operation page data. The view keeps canonical semantics
 * (requirement alternatives, response statuses, parameter locations) and only
 * adds ordering, grouping, anchors, and type summaries.
 */

export type ParameterLocation = "cookie" | "header" | "path" | "query";

export const PARAMETER_LOCATION_ORDER: readonly ParameterLocation[] = [
  "path",
  "query",
  "header",
  "cookie",
];

export const PARAMETER_LOCATION_LABELS: Readonly<
  Record<ParameterLocation, string>
> = {
  cookie: "Cookie parameters",
  header: "Header parameters",
  path: "Path parameters",
  query: "Query parameters",
};

export interface ParameterRow {
  readonly name: string;
  readonly location: ParameterLocation;
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly description?: string;
  readonly type: string;
  readonly constraints?: string;
  /** Present for `content`-typed parameters: the single media type. */
  readonly mediaType?: string;
}

export interface ParameterGroupView {
  readonly location: ParameterLocation;
  readonly anchor: string;
  readonly label: string;
  readonly rows: readonly ParameterRow[];
}

export interface MediaTypeView {
  readonly mediaType: string;
  readonly anchor: string;
  readonly schema?: SchemaSummary;
  readonly exampleCount: number;
  readonly encodings: readonly {
    readonly propertyName: string;
    readonly detail: string;
  }[];
}

export interface RequestBodyView {
  readonly anchor: string;
  readonly required: boolean;
  readonly description?: string;
  readonly media: readonly MediaTypeView[];
}

export interface ResponseHeaderView {
  readonly name: string;
  readonly description?: string;
  readonly deprecated: boolean;
  readonly type: string;
}

export interface ResponseView {
  readonly anchor: string;
  /** `201`, `4XX`, or `default`. */
  readonly statusLabel: string;
  readonly statusText?: string;
  readonly tone: "danger" | "info" | "neutral" | "success" | "warning";
  readonly description: string;
  readonly headers: readonly ResponseHeaderView[];
  /** Empty means a body-less response; the status is the content. */
  readonly media: readonly MediaTypeView[];
}

export interface SecuritySchemeView {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly description?: string;
  readonly scopes: readonly string[];
}

export interface SecurityAlternativeView {
  /** Schemes joined with AND; empty means anonymous access. */
  readonly schemes: readonly SecuritySchemeView[];
}

export interface OperationView {
  readonly summary: ReaderOperationSummary;
  readonly service: ReaderService;
  readonly group: ReaderGroup;
  readonly title: string;
  readonly method: Operation["method"];
  readonly path: string;
  readonly contractId?: string;
  readonly description?: string;
  readonly deprecated: boolean;
  /** OR alternatives; `undefined` when the contract declares no security. */
  readonly security: readonly SecurityAlternativeView[] | undefined;
  readonly parameterGroups: readonly ParameterGroupView[];
  readonly requestBody?: RequestBodyView;
  readonly responses: readonly ResponseView[];
  readonly servers: readonly Pick<ServerDefinition, "label" | "url">[];
  readonly tags: readonly string[];
}

export function createOperationView(input: {
  readonly model: ApiService;
  readonly operation: Operation;
  readonly summary: ReaderOperationSummary;
  readonly service: ReaderService;
  readonly group: ReaderGroup;
}): OperationView {
  const { group, model, operation, service, summary } = input;
  const registry = model.schemas;
  const requestBody =
    operation.requestBody === undefined
      ? undefined
      : {
          anchor: "request-body",
          media: operation.requestBody.content.map((content) =>
            mediaView(content, "request-body", registry),
          ),
          required: operation.requestBody.required,
          ...(operation.requestBody.description === undefined
            ? {}
            : { description: operation.requestBody.description }),
        };
  const serverIds = new Set(operation.serverIds);
  return {
    ...(operation.contractId === undefined
      ? {}
      : { contractId: operation.contractId }),
    deprecated: operation.deprecated,
    ...(operation.description === undefined
      ? {}
      : { description: operation.description }),
    group,
    method: operation.method,
    parameterGroups: groupParameters(operation.parameters, registry),
    path: operation.path,
    ...(requestBody === undefined ? {} : { requestBody }),
    responses: orderResponses(operation.responses).map((response) =>
      responseView(response, registry),
    ),
    security: securityView(operation, model.securitySchemes),
    servers: model.servers
      .filter((server) => serverIds.has(server.id))
      .map((server) => ({ label: server.label, url: server.url })),
    service,
    summary,
    tags: operation.tags,
    title: operation.title,
  };
}

function groupParameters(
  parameters: readonly Parameter[],
  registry: ApiService["schemas"],
): readonly ParameterGroupView[] {
  return PARAMETER_LOCATION_ORDER.flatMap((location) => {
    const rows = parameters
      .filter((parameter) => parameter.location === location)
      .map((parameter) => parameterRow(parameter, registry));
    if (rows.length === 0) return [];
    return [
      {
        anchor: `parameters-${location}`,
        label: PARAMETER_LOCATION_LABELS[location],
        location,
        rows,
      },
    ];
  });
}

function parameterRow(
  parameter: Parameter,
  registry: ApiService["schemas"],
): ParameterRow {
  const base = {
    deprecated: parameter.deprecated,
    location: parameter.location,
    name: parameter.name,
    required: parameter.required,
    ...(parameter.description === undefined
      ? {}
      : { description: parameter.description }),
  };
  if (parameter.valueKind === "content") {
    const schema =
      parameter.content.schema === undefined
        ? undefined
        : summarizeSchema(parameter.content.schema, registry);
    return {
      ...base,
      mediaType: parameter.content.mediaType,
      type: schema?.type ?? "any",
      ...(schema?.constraints === undefined
        ? {}
        : { constraints: schema.constraints }),
    };
  }
  const schema = summarizeSchema(parameter.schema, registry);
  return {
    ...base,
    type: schema.type,
    ...(schema.constraints === undefined
      ? {}
      : { constraints: schema.constraints }),
  };
}

function mediaView(
  content: MediaTypeContent,
  prefix: string,
  registry: ApiService["schemas"],
): MediaTypeView {
  const schema =
    content.schema === undefined
      ? undefined
      : summarizeSchema(content.schema, registry);
  return {
    anchor: mediaTypeAnchor(prefix, content.mediaType),
    encodings: content.encodings.map((encoding) => ({
      detail:
        encoding.encodingKind === "content"
          ? encoding.contentType
          : `${encoding.serialization.style}${encoding.serialization.explode ? ", exploded" : ""}`,
      propertyName: encoding.propertyName,
    })),
    exampleCount: content.examples.length,
    mediaType: content.mediaType,
    ...(schema === undefined ? {} : { schema }),
  };
}

/** Numeric codes ascending, then `1XX`…`5XX` ranges, then `default`. */
export function orderResponses(
  responses: readonly Response[],
): readonly Response[] {
  return [...responses].sort(
    (left, right) => responseRank(left) - responseRank(right),
  );
}

function responseRank(response: Response): number {
  const { status } = response;
  if (status.kind === "code") return status.code;
  if (status.kind === "range") return 1_000 + Number(status.range.charAt(0));
  return 2_000;
}

function responseView(
  response: Response,
  registry: ApiService["schemas"],
): ResponseView {
  const { status } = response;
  const statusLabel =
    status.kind === "code"
      ? String(status.code)
      : status.kind === "range"
        ? status.range
        : "default";
  const statusText =
    status.kind === "code" ? STATUS_TEXT[status.code] : undefined;
  return {
    anchor: responseAnchor(status),
    description: response.description,
    headers: response.headers.map((header) => headerView(header, registry)),
    media: response.bodies.map((body) =>
      mediaView(body, responseAnchor(status), registry),
    ),
    statusLabel,
    ...(statusText === undefined ? {} : { statusText }),
    tone: responseTone(status),
  };
}

function responseTone(status: Response["status"]): ResponseView["tone"] {
  const leading =
    status.kind === "code"
      ? Math.floor(status.code / 100)
      : status.kind === "range"
        ? Number(status.range.charAt(0))
        : 0;
  if (leading === 2) return "success";
  if (leading === 1 || leading === 3) return "info";
  if (leading === 4) return "warning";
  if (leading === 5) return "danger";
  return "neutral";
}

function headerView(
  header: ResponseHeader,
  registry: ApiService["schemas"],
): ResponseHeaderView {
  const schema =
    header.valueKind === "schema"
      ? summarizeSchema(header.schema, registry)
      : header.content.schema === undefined
        ? undefined
        : summarizeSchema(header.content.schema, registry);
  return {
    deprecated: header.deprecated,
    name: header.name,
    type: schema?.type ?? "any",
    ...(header.description === undefined
      ? {}
      : { description: header.description }),
  };
}

function securityView(
  operation: Operation,
  schemes: ApiService["securitySchemes"],
): readonly SecurityAlternativeView[] | undefined {
  if (operation.security.length === 0) return undefined;
  return operation.security.map((requirement) => ({
    schemes: requirement.schemes.map((use) => {
      const scheme = schemes[use.schemeId];
      return {
        key: use.schemeId,
        scopes: use.scopes,
        ...(scheme === undefined
          ? { detail: "Unknown scheme", label: use.schemeId }
          : describeScheme(use.schemeId, scheme)),
      };
    }),
  }));
}

function describeScheme(
  key: string,
  scheme: SecurityScheme,
): Pick<SecuritySchemeView, "description" | "detail" | "label"> {
  const description =
    scheme.description === undefined ? {} : { description: scheme.description };
  switch (scheme.kind) {
    case "apiKey":
      return {
        ...description,
        detail: `${scheme.name} ${scheme.location === "header" ? "header" : scheme.location === "query" ? "query parameter" : "cookie"}`,
        label: `API key (${key})`,
      };
    case "http":
      return {
        ...description,
        detail:
          scheme.bearerFormat === undefined
            ? `HTTP ${scheme.scheme}`
            : `HTTP ${scheme.scheme} · ${scheme.bearerFormat}`,
        label:
          scheme.scheme === "bearer"
            ? `Bearer token (${key})`
            : scheme.scheme === "basic"
              ? `HTTP basic (${key})`
              : `HTTP ${scheme.scheme} (${key})`,
      };
    case "oauth2":
      return {
        ...description,
        detail: `OAuth 2.0 · ${scheme.flows.map((flow) => FLOW_LABELS[flow.kind]).join(", ")}`,
        label: `OAuth 2.0 (${key})`,
      };
    case "openIdConnect":
      return {
        ...description,
        detail: "OpenID Connect discovery",
        label: `OpenID Connect (${key})`,
      };
    case "mutualTLS":
      return {
        ...description,
        detail: "Client certificate",
        label: `Mutual TLS (${key})`,
      };
  }
}

const FLOW_LABELS = {
  authorizationCode: "authorization code",
  clientCredentials: "client credentials",
  implicit: "implicit",
  password: "password",
} as const;

const STATUS_TEXT: Readonly<Record<number, string>> = {
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  412: "Precondition Failed",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  428: "Precondition Required",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};
