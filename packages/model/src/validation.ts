import { createDiagnostic, DIAGNOSTIC_MESSAGES } from "./diagnostics.js";
import { assertCanonicalId, createDiagnosticId } from "./identity.js";
import {
  DOCUMENT_MODEL_VERSION,
  type CanonicalDiagnostic,
  type DiagnosticCode,
  type ModelLimits,
  type SchemaInstanceType,
} from "./types.js";

export const DEFAULT_MODEL_LIMITS: ModelLimits = Object.freeze({
  maxCollectionEntries: 100_000,
  maxDepth: 128,
  maxNodes: 500_000,
  maxStringLength: 1_000_000,
});

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;
const SCHEMA_TYPES: readonly SchemaInstanceType[] = [
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
];

export function validateDocumentationModel(
  value: unknown,
  limits: ModelLimits = DEFAULT_MODEL_LIMITS,
): readonly CanonicalDiagnostic[] {
  return validateDocumentationModelInternal(value, limits);
}

function validateDocumentationModelInternal(
  value: unknown,
  limits: ModelLimits,
  artifactLinks?: { id: string; path: string }[],
): readonly CanonicalDiagnostic[] {
  const diagnostics = new Map<string, CanonicalDiagnostic>();
  if (!validLimits(limits)) {
    add(diagnostics, "MODEL_LIMIT_EXCEEDED", "/");
    return sorted(diagnostics.values());
  }
  if (!validateSerializableStructure(value, limits, diagnostics)) {
    return sorted(diagnostics.values());
  }
  if (!isRecord(value) || value.modelVersion !== DOCUMENT_MODEL_VERSION) {
    add(diagnostics, "INVALID_MODEL", "/modelVersion");
    return sorted(diagnostics.values());
  }
  if (!isRecord(value.project) || !isArray(value.versions)) {
    add(diagnostics, "INVALID_MODEL", "/");
    return sorted(diagnostics.values());
  }

  validateKeys(
    value,
    ["modelVersion", "project", "versions"],
    "/",
    diagnostics,
  );
  validateKeys(
    value.project,
    ["canonicalUrl", "description", "id", "name"],
    "/project",
    diagnostics,
  );

  validateId(value.project.id, "/project/id", diagnostics);
  requireString(value.project.name, "/project/name", diagnostics);
  validateOptionalString(
    value.project.description,
    "/project/description",
    diagnostics,
  );
  validateOptionalString(
    value.project.canonicalUrl,
    "/project/canonicalUrl",
    diagnostics,
  );

  const versionIds = new Set<string>();
  value.versions.forEach((versionValue, versionIndex) => {
    const versionPath = `/versions/${versionIndex}`;
    if (!isRecord(versionValue)) {
      add(diagnostics, "INVALID_MODEL", versionPath);
      return;
    }
    validateKeys(
      versionValue,
      ["id", "label", "pages", "services", "status"],
      versionPath,
      diagnostics,
    );
    if (validateId(versionValue.id, `${versionPath}/id`, diagnostics)) {
      checkDuplicate(
        versionIds,
        versionValue.id,
        `${versionPath}/id`,
        diagnostics,
      );
    }
    requireString(versionValue.label, `${versionPath}/label`, diagnostics);
    if (
      !new Set(["current", "deprecated", "preview"]).has(
        String(versionValue.status),
      )
    ) {
      add(diagnostics, "INVALID_MODEL", `${versionPath}/status`);
    }
    if (!isArray(versionValue.pages) || !isArray(versionValue.services)) {
      add(diagnostics, "INVALID_MODEL", versionPath);
      return;
    }
    validatePages(versionValue.pages, versionPath, diagnostics);
    validateServices(
      versionValue.services,
      versionPath,
      diagnostics,
      artifactLinks,
    );
  });

  return sorted(diagnostics.values());
}

export function validateDocumentationArtifact(
  value: unknown,
  limits: ModelLimits = DEFAULT_MODEL_LIMITS,
): readonly CanonicalDiagnostic[] {
  if (!isRecord(value)) {
    return [
      createDiagnostic({ code: "INVALID_MODEL", location: { path: "/" } }),
    ];
  }
  const diagnostics = new Map<string, CanonicalDiagnostic>();
  if (!validLimits(limits)) {
    add(diagnostics, "MODEL_LIMIT_EXCEEDED", "/");
    return sorted(diagnostics.values());
  }
  if (!validateSerializableStructure(value, limits, diagnostics)) {
    return sorted(diagnostics.values());
  }
  validateKeys(
    value,
    ["diagnostics", "model"],
    "/",
    diagnostics,
    "INVALID_MODEL",
  );
  const artifactLinks: { id: string; path: string }[] = [];
  for (const diagnostic of validateDocumentationModelInternal(
    value.model,
    limits,
    artifactLinks,
  )) {
    diagnostics.set(diagnostic.id, diagnostic);
  }
  if (!isArray(value.diagnostics)) {
    add(diagnostics, "INVALID_DIAGNOSTIC", "/diagnostics");
    return sorted(diagnostics.values());
  }

  const declaredIds = new Set<string>();
  value.diagnostics.forEach((diagnosticValue, index) => {
    const path = `/diagnostics/${index}`;
    if (!isRecord(diagnosticValue)) {
      add(diagnostics, "INVALID_DIAGNOSTIC", path);
      return;
    }
    validateKeys(
      diagnosticValue,
      ["code", "id", "location", "message", "severity"],
      path,
      diagnostics,
      "INVALID_DIAGNOSTIC",
    );
    const code = diagnosticValue.code;
    const location = validDiagnosticLocation(diagnosticValue.location)
      ? diagnosticValue.location
      : undefined;
    if (
      !isDiagnosticCode(code) ||
      (location === undefined && diagnosticValue.location !== undefined)
    ) {
      add(diagnostics, "INVALID_DIAGNOSTIC", path);
      return;
    }
    const expectedId = createDiagnosticId(code, location);
    const severity = diagnosticValue.severity;
    if (
      diagnosticValue.id !== expectedId ||
      diagnosticValue.message !== DIAGNOSTIC_MESSAGES[code] ||
      !new Set(["error", "info", "warning"]).has(String(severity))
    ) {
      add(diagnostics, "INVALID_DIAGNOSTIC", path);
      return;
    }
    checkDuplicate(declaredIds, expectedId, `${path}/id`, diagnostics);
  });

  for (const link of artifactLinks) {
    if (!declaredIds.has(link.id)) {
      add(diagnostics, "MISSING_DIAGNOSTIC", link.path);
    }
  }
  return sorted(diagnostics.values());
}

export function hasModelErrors(
  diagnostics: readonly CanonicalDiagnostic[],
): boolean {
  return diagnostics.some(({ severity }) => severity === "error");
}

function validateServices(
  services: readonly unknown[],
  versionPath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
  artifactLinks?: { id: string; path: string }[],
): void {
  const serviceIds = new Set<string>();
  services.forEach((serviceValue, serviceIndex) => {
    const path = `${versionPath}/services/${serviceIndex}`;
    if (!isRecord(serviceValue)) {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }
    validateKeys(
      serviceValue,
      [
        "description",
        "extensions",
        "id",
        "name",
        "operations",
        "schemas",
        "securitySchemes",
        "servers",
      ],
      path,
      diagnostics,
    );
    if (validateId(serviceValue.id, `${path}/id`, diagnostics)) {
      checkDuplicate(serviceIds, serviceValue.id, `${path}/id`, diagnostics);
    }
    requireString(serviceValue.name, `${path}/name`, diagnostics);
    if (
      !isArray(serviceValue.servers) ||
      !isArray(serviceValue.operations) ||
      !isRecord(serviceValue.schemas) ||
      !isRecord(serviceValue.securitySchemes) ||
      !isRecord(serviceValue.extensions)
    ) {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }

    const serverIds = validateServers(serviceValue.servers, path, diagnostics);
    const securityIds = validateSecuritySchemes(
      serviceValue.securitySchemes,
      path,
      diagnostics,
    );
    const schemaIds = new Set(Object.keys(serviceValue.schemas));
    [...schemaIds].sort(compareText).forEach((id, schemaIndex) => {
      validateId(id, `${path}/schemas/${schemaIndex}/id`, diagnostics);
    });
    const diagnosticLinks: { id: string; path: string }[] = [];
    [...Object.entries(serviceValue.schemas)]
      .sort(([left], [right]) => compareText(left, right))
      .forEach(([, schema], schemaIndex) => {
        validateSchema(
          schema,
          schemaIds,
          `${path}/schemas/${schemaIndex}`,
          diagnostics,
          diagnosticLinks,
        );
      });
    validateOperations(
      serviceValue.operations,
      schemaIds,
      securityIds,
      serverIds,
      path,
      diagnostics,
      diagnosticLinks,
    );
    artifactLinks?.push(...diagnosticLinks);
  });
}

function validatePages(
  pages: readonly unknown[],
  versionPath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  const ids = new Set<string>();
  pages.forEach((pageValue, index) => {
    const path = `${versionPath}/pages/${index}`;
    if (!isRecord(pageValue)) {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }
    validateKeys(
      pageValue,
      ["description", "headings", "id", "slug", "sourcePath", "title"],
      path,
      diagnostics,
    );
    if (validateId(pageValue.id, `${path}/id`, diagnostics)) {
      checkDuplicate(ids, pageValue.id, `${path}/id`, diagnostics);
    }
    requireString(pageValue.slug, `${path}/slug`, diagnostics);
    requireString(pageValue.title, `${path}/title`, diagnostics);
    requireString(pageValue.sourcePath, `${path}/sourcePath`, diagnostics);
    if (!isArray(pageValue.headings)) {
      add(diagnostics, "INVALID_MODEL", `${path}/headings`);
    }
  });
}

function validateServers(
  servers: readonly unknown[],
  servicePath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  servers.forEach((serverValue, index) => {
    const path = `${servicePath}/servers/${index}`;
    if (!isRecord(serverValue)) {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }
    validateKeys(
      serverValue,
      ["description", "id", "label", "url", "variables"],
      path,
      diagnostics,
    );
    if (validateId(serverValue.id, `${path}/id`, diagnostics)) {
      checkDuplicate(ids, serverValue.id, `${path}/id`, diagnostics);
    }
    requireString(serverValue.url, `${path}/url`, diagnostics);
    requireString(serverValue.label, `${path}/label`, diagnostics);
    if (!isRecord(serverValue.variables)) {
      add(diagnostics, "INVALID_MODEL", `${path}/variables`);
      return;
    }
    Object.values(serverValue.variables).forEach((variable, variableIndex) => {
      const variablePath = `${path}/variables/${variableIndex}`;
      if (!isRecord(variable)) {
        add(diagnostics, "INVALID_MODEL", variablePath);
        return;
      }
      validateKeys(
        variable,
        ["allowedValues", "defaultValue", "description"],
        variablePath,
        diagnostics,
      );
      requireString(
        variable.defaultValue,
        `${variablePath}/defaultValue`,
        diagnostics,
      );
      if (!isArray(variable.allowedValues)) {
        add(diagnostics, "INVALID_MODEL", `${variablePath}/allowedValues`);
      } else {
        checkNormalizedDuplicates(
          variable.allowedValues,
          `${variablePath}/allowedValues`,
          diagnostics,
        );
        if (
          variable.allowedValues.length > 0 &&
          typeof variable.defaultValue === "string" &&
          !variable.allowedValues.includes(variable.defaultValue)
        ) {
          add(diagnostics, "INVALID_MODEL", `${variablePath}/defaultValue`);
        }
      }
    });
    const variableNames = new Set(Object.keys(serverValue.variables));
    for (const match of String(serverValue.url).matchAll(/\{([^{}]+)\}/g)) {
      if (match[1] !== undefined && !variableNames.has(match[1])) {
        add(diagnostics, "INVALID_MODEL", `${path}/variables`);
      }
    }
  });
  return ids;
}

function validateSecuritySchemes(
  schemes: Readonly<Record<string, unknown>>,
  servicePath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): ReadonlyMap<string, string> {
  const ids = new Set(Object.keys(schemes));
  const kinds = new Map<string, string>();
  [...ids].sort(compareText).forEach((id, index) => {
    validateId(id, `${servicePath}/securitySchemes/${index}/id`, diagnostics);
    const scheme = schemes[id];
    if (!isRecord(scheme)) {
      add(
        diagnostics,
        "INVALID_MODEL",
        `${servicePath}/securitySchemes/${index}`,
      );
      return;
    }
    if (typeof scheme.kind === "string") kinds.set(id, scheme.kind);
    const common = ["description", "kind"];
    if (
      !new Set(["apiKey", "http", "mutualTLS", "oauth2", "openIdConnect"]).has(
        String(scheme.kind),
      )
    ) {
      add(
        diagnostics,
        "INVALID_MODEL",
        `${servicePath}/securitySchemes/${index}/kind`,
      );
    }
    const schemePath = `${servicePath}/securitySchemes/${index}`;
    if (scheme.kind === "apiKey") {
      validateKeys(
        scheme,
        [...common, "location", "name"],
        schemePath,
        diagnostics,
      );
      requireString(scheme.name, `${schemePath}/name`, diagnostics);
      if (!new Set(["cookie", "header", "query"]).has(String(scheme.location)))
        add(diagnostics, "INVALID_MODEL", `${schemePath}/location`);
    } else if (scheme.kind === "http") {
      validateKeys(
        scheme,
        [...common, "bearerFormat", "scheme"],
        schemePath,
        diagnostics,
      );
      if (
        typeof scheme.scheme !== "string" ||
        !/^[a-z][a-z0-9!#$%&'*+.^_`|~-]*$/.test(scheme.scheme)
      )
        add(diagnostics, "INVALID_MODEL", `${schemePath}/scheme`);
    } else if (scheme.kind === "oauth2") {
      validateKeys(scheme, [...common, "flows"], schemePath, diagnostics);
      validateOAuthFlows(scheme.flows, schemePath, diagnostics);
    } else if (scheme.kind === "openIdConnect") {
      validateKeys(
        scheme,
        [...common, "openIdConnectUrl"],
        schemePath,
        diagnostics,
      );
      requireString(
        scheme.openIdConnectUrl,
        `${schemePath}/openIdConnectUrl`,
        diagnostics,
      );
    } else if (scheme.kind === "mutualTLS") {
      validateKeys(scheme, common, schemePath, diagnostics);
    }
  });
  return kinds;
}

function validateOAuthFlows(
  flows: unknown,
  schemePath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  if (!isArray(flows) || flows.length === 0) {
    add(diagnostics, "INVALID_MODEL", `${schemePath}/flows`);
    return;
  }
  const kinds = new Set<string>();
  flows.forEach((flowValue, index) => {
    const path = `${schemePath}/flows/${index}`;
    if (!isRecord(flowValue) || typeof flowValue.kind !== "string") {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }
    checkDuplicate(kinds, flowValue.kind, `${path}/kind`, diagnostics);
    const common = ["kind", "refreshUrl", "scopes"];
    if (flowValue.kind === "implicit") {
      validateKeys(
        flowValue,
        [...common, "authorizationUrl"],
        path,
        diagnostics,
      );
      requireString(
        flowValue.authorizationUrl,
        `${path}/authorizationUrl`,
        diagnostics,
      );
    } else if (
      flowValue.kind === "password" ||
      flowValue.kind === "clientCredentials"
    ) {
      validateKeys(flowValue, [...common, "tokenUrl"], path, diagnostics);
      requireString(flowValue.tokenUrl, `${path}/tokenUrl`, diagnostics);
    } else if (flowValue.kind === "authorizationCode") {
      validateKeys(
        flowValue,
        [...common, "authorizationUrl", "tokenUrl"],
        path,
        diagnostics,
      );
      requireString(
        flowValue.authorizationUrl,
        `${path}/authorizationUrl`,
        diagnostics,
      );
      requireString(flowValue.tokenUrl, `${path}/tokenUrl`, diagnostics);
    } else {
      add(diagnostics, "INVALID_MODEL", `${path}/kind`);
    }
    if (
      !isRecord(flowValue.scopes) ||
      Object.values(flowValue.scopes).some(
        (description) => typeof description !== "string",
      )
    ) {
      add(diagnostics, "INVALID_MODEL", `${path}/scopes`);
    }
    validateOptionalString(
      flowValue.refreshUrl,
      `${path}/refreshUrl`,
      diagnostics,
    );
  });
}

function validateOperations(
  operations: readonly unknown[],
  schemaIds: ReadonlySet<string>,
  securitySchemes: ReadonlyMap<string, string>,
  serverIds: ReadonlySet<string>,
  servicePath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
  diagnosticLinks: { id: string; path: string }[],
): void {
  const operationIds = new Set<string>();
  operations.forEach((operationValue, operationIndex) => {
    const path = `${servicePath}/operations/${operationIndex}`;
    if (!isRecord(operationValue)) {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }
    validateKeys(
      operationValue,
      [
        "deprecated",
        "description",
        "extensions",
        "id",
        "method",
        "parameters",
        "path",
        "requestBody",
        "responses",
        "security",
        "serverIds",
        "tags",
        "title",
      ],
      path,
      diagnostics,
    );
    if (validateId(operationValue.id, `${path}/id`, diagnostics)) {
      checkDuplicate(
        operationIds,
        operationValue.id,
        `${path}/id`,
        diagnostics,
      );
    }
    if (
      !isArray(operationValue.parameters) ||
      !isArray(operationValue.responses) ||
      operationValue.responses.length === 0
    ) {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }
    const operationPath =
      typeof operationValue.path === "string" ? operationValue.path : "";
    if (!operationPath.startsWith("/"))
      add(diagnostics, "INVALID_MODEL", `${path}/path`);
    requireString(operationValue.title, `${path}/title`, diagnostics);
    if (typeof operationValue.deprecated !== "boolean")
      add(diagnostics, "INVALID_MODEL", `${path}/deprecated`);
    if (!isRecord(operationValue.extensions))
      add(diagnostics, "INVALID_MODEL", `${path}/extensions`);
    if (
      !new Set([
        "DELETE",
        "GET",
        "HEAD",
        "OPTIONS",
        "PATCH",
        "POST",
        "PUT",
        "TRACE",
      ]).has(String(operationValue.method))
    ) {
      add(diagnostics, "INVALID_MODEL", `${path}/method`);
    }
    validateParameters(
      operationValue.parameters,
      operationPath,
      schemaIds,
      path,
      diagnostics,
      diagnosticLinks,
    );
    if (operationValue.requestBody !== undefined) {
      if (
        !isRecord(operationValue.requestBody) ||
        !isArray(operationValue.requestBody.content)
      ) {
        add(diagnostics, "INVALID_MODEL", `${path}/requestBody`);
      } else {
        validateKeys(
          operationValue.requestBody,
          ["content", "description", "required"],
          `${path}/requestBody`,
          diagnostics,
        );
        if (typeof operationValue.requestBody.required !== "boolean")
          add(diagnostics, "INVALID_MODEL", `${path}/requestBody/required`);
        validateMedia(
          operationValue.requestBody.content,
          schemaIds,
          `${path}/requestBody/content`,
          diagnostics,
          diagnosticLinks,
        );
      }
    }
    validateResponses(
      operationValue.responses,
      schemaIds,
      path,
      diagnostics,
      diagnosticLinks,
    );
    validateOperationSecurity(
      operationValue.security,
      securitySchemes,
      path,
      diagnostics,
    );
    if (!isArray(operationValue.serverIds)) {
      add(diagnostics, "INVALID_MODEL", `${path}/serverIds`);
    } else {
      operationValue.serverIds.forEach((id, index) => {
        if (typeof id !== "string" || !serverIds.has(id)) {
          add(diagnostics, "MISSING_SERVER", `${path}/serverIds/${index}`);
        }
      });
    }
    if (isArray(operationValue.tags)) {
      checkNormalizedDuplicates(
        operationValue.tags,
        `${path}/tags`,
        diagnostics,
      );
    } else {
      add(diagnostics, "INVALID_MODEL", `${path}/tags`);
    }
  });
}

function validateParameters(
  parameters: readonly unknown[],
  operationPath: string,
  schemaIds: ReadonlySet<string>,
  basePath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
  diagnosticLinks: { id: string; path: string }[],
): void {
  const ids = new Set<string>();
  const parameterKeys = new Set<string>();
  const documentedPathNames = new Set<string>();
  parameters.forEach((parameterValue, index) => {
    const path = `${basePath}/parameters/${index}`;
    if (!isRecord(parameterValue)) {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }
    validateKeys(
      parameterValue,
      parameterValue.valueKind === "schema"
        ? [
            "deprecated",
            "description",
            "examples",
            "id",
            "location",
            "name",
            "required",
            "schema",
            "serialization",
            "valueKind",
          ]
        : [
            "content",
            "deprecated",
            "description",
            "examples",
            "id",
            "location",
            "name",
            "required",
            "valueKind",
          ],
      path,
      diagnostics,
    );
    if (validateId(parameterValue.id, `${path}/id`, diagnostics)) {
      checkDuplicate(ids, parameterValue.id, `${path}/id`, diagnostics);
    }
    const name =
      typeof parameterValue.name === "string" ? parameterValue.name : "";
    const semanticName =
      parameterValue.location === "header" ? name.toLowerCase() : name;
    const semanticKey = `${String(parameterValue.location)}\u001f${semanticName}`;
    if (parameterKeys.has(semanticKey)) {
      add(diagnostics, "INVALID_MODEL", path);
    }
    parameterKeys.add(semanticKey);
    requireString(parameterValue.name, `${path}/name`, diagnostics);
    if (
      !new Set(["cookie", "header", "path", "query"]).has(
        String(parameterValue.location),
      )
    )
      add(diagnostics, "INVALID_MODEL", `${path}/location`);
    if (
      typeof parameterValue.required !== "boolean" ||
      typeof parameterValue.deprecated !== "boolean"
    )
      add(diagnostics, "INVALID_MODEL", path);
    if (parameterValue.location === "path") {
      documentedPathNames.add(name);
      if (
        parameterValue.required !== true ||
        !operationPath.includes(`{${name}}`)
      ) {
        add(diagnostics, "INVALID_PATH_PARAMETER", path);
      }
    }
    if (parameterValue.valueKind === "schema") {
      validateSchema(
        parameterValue.schema,
        schemaIds,
        `${path}/schema`,
        diagnostics,
        diagnosticLinks,
      );
      validateParameterSerialization(
        parameterValue.serialization,
        `${path}/serialization`,
        diagnostics,
        true,
      );
    } else if (
      parameterValue.valueKind === "content" &&
      isRecord(parameterValue.content)
    ) {
      validateMedia(
        [parameterValue.content],
        schemaIds,
        `${path}/content`,
        diagnostics,
        diagnosticLinks,
      );
    } else {
      add(diagnostics, "INVALID_MODEL", `${path}/valueKind`);
    }
    validateExamples(parameterValue.examples, `${path}/examples`, diagnostics);
  });
  for (const match of operationPath.matchAll(/\{([^{}]+)\}/g)) {
    if (match[1] !== undefined && !documentedPathNames.has(match[1])) {
      add(diagnostics, "INVALID_PATH_PARAMETER", `${basePath}/parameters`);
    }
  }
}

function validateResponses(
  responses: readonly unknown[],
  schemaIds: ReadonlySet<string>,
  operationPath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
  diagnosticLinks: { id: string; path: string }[],
): void {
  const statuses = new Set<string>();
  responses.forEach((responseValue, index) => {
    const path = `${operationPath}/responses/${index}`;
    if (
      !isRecord(responseValue) ||
      !isArray(responseValue.headers) ||
      !isArray(responseValue.bodies)
    ) {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }
    validateKeys(
      responseValue,
      ["bodies", "description", "headers", "status"],
      path,
      diagnostics,
    );
    requireString(
      responseValue.description,
      `${path}/description`,
      diagnostics,
    );
    const status = responseStatusKey(responseValue.status);
    if (status === undefined)
      add(diagnostics, "INVALID_MODEL", `${path}/status`);
    else checkDuplicate(statuses, status, `${path}/status`, diagnostics);
    const headerNames = new Set<string>();
    responseValue.headers.forEach((headerValue, headerIndex) => {
      const headerPath = `${path}/headers/${headerIndex}`;
      if (!isRecord(headerValue) || typeof headerValue.name !== "string") {
        add(diagnostics, "INVALID_MODEL", headerPath);
        return;
      }
      validateKeys(
        headerValue,
        headerValue.valueKind === "schema"
          ? [
              "deprecated",
              "description",
              "examples",
              "name",
              "schema",
              "serialization",
              "valueKind",
            ]
          : [
              "content",
              "deprecated",
              "description",
              "examples",
              "name",
              "valueKind",
            ],
        headerPath,
        diagnostics,
      );
      if (typeof headerValue.deprecated !== "boolean")
        add(diagnostics, "INVALID_MODEL", `${headerPath}/deprecated`);
      checkDuplicate(
        headerNames,
        headerValue.name.toLowerCase(),
        `${headerPath}/name`,
        diagnostics,
      );
      if (headerValue.valueKind === "schema") {
        validateSchema(
          headerValue.schema,
          schemaIds,
          `${headerPath}/schema`,
          diagnostics,
          diagnosticLinks,
        );
        validateParameterSerialization(
          headerValue.serialization,
          `${headerPath}/serialization`,
          diagnostics,
          false,
        );
      } else if (
        headerValue.valueKind === "content" &&
        isRecord(headerValue.content)
      ) {
        validateMedia(
          [headerValue.content],
          schemaIds,
          `${headerPath}/content`,
          diagnostics,
          diagnosticLinks,
        );
      } else add(diagnostics, "INVALID_MODEL", `${headerPath}/valueKind`);
      validateExamples(
        headerValue.examples,
        `${headerPath}/examples`,
        diagnostics,
      );
    });
    validateMedia(
      responseValue.bodies,
      schemaIds,
      `${path}/bodies`,
      diagnostics,
      diagnosticLinks,
    );
  });
}

function validateMedia(
  content: readonly unknown[],
  schemaIds: ReadonlySet<string>,
  basePath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
  diagnosticLinks: { id: string; path: string }[],
): void {
  const mediaTypes = new Set<string>();
  content.forEach((mediaValue, index) => {
    const path = `${basePath}/${index}`;
    if (
      !isRecord(mediaValue) ||
      typeof mediaValue.mediaType !== "string" ||
      mediaValue.mediaType.length === 0
    ) {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }
    validateKeys(
      mediaValue,
      ["examples", "mediaType", "schema"],
      path,
      diagnostics,
    );
    checkDuplicate(
      mediaTypes,
      mediaValue.mediaType.toLowerCase(),
      `${path}/mediaType`,
      diagnostics,
    );
    if (mediaValue.schema !== undefined) {
      validateSchema(
        mediaValue.schema,
        schemaIds,
        `${path}/schema`,
        diagnostics,
        diagnosticLinks,
      );
    }
    validateExamples(mediaValue.examples, `${path}/examples`, diagnostics);
  });
}

function validateParameterSerialization(
  value: unknown,
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
  allowReservedField: boolean,
): void {
  if (!isRecord(value)) {
    add(diagnostics, "INVALID_MODEL", path);
    return;
  }
  validateKeys(
    value,
    allowReservedField
      ? ["allowReserved", "explode", "style"]
      : ["explode", "style"],
    path,
    diagnostics,
  );
  if (
    !new Set([
      "deepObject",
      "form",
      "label",
      "matrix",
      "pipeDelimited",
      "simple",
      "spaceDelimited",
    ]).has(String(value.style)) ||
    typeof value.explode !== "boolean" ||
    (allowReservedField && typeof value.allowReserved !== "boolean")
  ) {
    add(diagnostics, "INVALID_MODEL", path);
  }
}

function validateExamples(
  examples: unknown,
  basePath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  if (!isArray(examples)) {
    add(diagnostics, "INVALID_MODEL", basePath);
    return;
  }
  const ids = new Set<string>();
  examples.forEach((exampleValue, index) => {
    const path = `${basePath}/${index}`;
    if (!isRecord(exampleValue)) {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }
    validateKeys(
      exampleValue,
      ["externalValue", "id", "name", "summary", "value"],
      path,
      diagnostics,
    );
    requireString(exampleValue.name, `${path}/name`, diagnostics);
    validateOptionalString(
      exampleValue.summary,
      `${path}/summary`,
      diagnostics,
    );
    validateOptionalString(
      exampleValue.externalValue,
      `${path}/externalValue`,
      diagnostics,
    );
    if (validateId(exampleValue.id, `${path}/id`, diagnostics)) {
      checkDuplicate(ids, exampleValue.id, `${path}/id`, diagnostics);
    }
    if (
      exampleValue.value !== undefined &&
      exampleValue.externalValue !== undefined
    ) {
      add(diagnostics, "INVALID_MODEL", path);
    }
  });
}

function validateOperationSecurity(
  requirements: unknown,
  securitySchemes: ReadonlyMap<string, string>,
  operationPath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  if (!isArray(requirements)) {
    add(diagnostics, "INVALID_MODEL", `${operationPath}/security`);
    return;
  }
  const alternatives = new Set<string>();
  requirements.forEach((requirementValue, requirementIndex) => {
    const path = `${operationPath}/security/${requirementIndex}`;
    if (!isRecord(requirementValue) || !isArray(requirementValue.schemes)) {
      add(diagnostics, "INVALID_MODEL", path);
      return;
    }
    validateKeys(requirementValue, ["schemes"], path, diagnostics);
    const schemes = new Set<string>();
    requirementValue.schemes.forEach((useValue, useIndex) => {
      if (
        !isRecord(useValue) ||
        typeof useValue.schemeId !== "string" ||
        !securitySchemes.has(useValue.schemeId)
      ) {
        add(
          diagnostics,
          "MISSING_SECURITY_SCHEME",
          `${path}/schemes/${useIndex}`,
        );
        return;
      }
      validateKeys(
        useValue,
        ["schemeId", "scopes"],
        `${path}/schemes/${useIndex}`,
        diagnostics,
      );
      checkDuplicate(
        schemes,
        useValue.schemeId,
        `${path}/schemes/${useIndex}`,
        diagnostics,
      );
      checkNormalizedDuplicates(
        useValue.scopes,
        `${path}/schemes/${useIndex}/scopes`,
        diagnostics,
      );
      if (
        isArray(useValue.scopes) &&
        useValue.scopes.length > 0 &&
        !new Set(["oauth2", "openIdConnect"]).has(
          securitySchemes.get(useValue.schemeId) ?? "",
        )
      ) {
        add(diagnostics, "INVALID_MODEL", `${path}/schemes/${useIndex}/scopes`);
      }
    });
    const key = [...schemes].sort(compareText).join("\u001f");
    checkDuplicate(alternatives, key, path, diagnostics);
  });
}

function validateSchema(
  value: unknown,
  knownIds: ReadonlySet<string>,
  rootPath: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
  diagnosticLinks: { id: string; path: string }[],
): void {
  const stack: { value: unknown; path: string }[] = [{ value, path: rootPath }];
  const visited = new WeakSet<object>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (!isRecord(current.value)) {
      add(diagnostics, "INVALID_SCHEMA", current.path);
      continue;
    }
    if (visited.has(current.value)) continue;
    visited.add(current.value);
    validateSchemaShape(current.value, current.path, diagnostics);
    validateSchemaMetadata(current.value, current.path, diagnostics);
    collectSchemaDiagnosticLinks(
      current.value,
      current.path,
      diagnosticLinks,
      diagnostics,
    );
    switch (current.value.kind) {
      case "any":
        break;
      case "boolean-schema":
        if (typeof current.value.accepts !== "boolean") {
          add(diagnostics, "INVALID_SCHEMA", `${current.path}/accepts`);
        }
        break;
      case "scalar":
        validateScalar(current.value, current.path, diagnostics);
        break;
      case "ref":
        if (
          typeof current.value.schemaId !== "string" ||
          !knownIds.has(current.value.schemaId)
        ) {
          add(diagnostics, "MISSING_REFERENCE", `${current.path}/schemaId`);
        }
        break;
      case "object":
        pushObjectConstraints(current.value, current.path, stack, diagnostics);
        break;
      case "array":
        pushArrayConstraints(current.value, current.path, stack, diagnostics);
        break;
      case "tuple":
        if (!isArray(current.value.prefixItems))
          add(diagnostics, "INVALID_SCHEMA", current.path);
        else
          current.value.prefixItems.forEach((schema, index) =>
            stack.push({
              value: schema,
              path: `${current.path}/prefixItems/${index}`,
            }),
          );
        if (typeof current.value.additionalItems !== "boolean")
          stack.push({
            value: current.value.additionalItems,
            path: `${current.path}/additionalItems`,
          });
        validateMinMax(
          current.value.minItems,
          current.value.maxItems,
          current.path,
          diagnostics,
        );
        break;
      case "composition":
        pushComposition(
          current.value,
          knownIds,
          current.path,
          stack,
          diagnostics,
        );
        break;
      case "type-less":
        pushTypeLess(current.value, current.path, stack, diagnostics);
        break;
      case "unknown":
        if (
          !isArray(current.value.diagnosticIds) ||
          current.value.diagnosticIds.length === 0
        ) {
          add(diagnostics, "INVALID_SCHEMA", `${current.path}/diagnosticIds`);
        }
        if (
          !new Set(["invalid", "unresolved", "unsupported"]).has(
            String(current.value.reason),
          )
        ) {
          add(diagnostics, "INVALID_SCHEMA", `${current.path}/reason`);
        }
        break;
      default:
        add(diagnostics, "INVALID_SCHEMA", `${current.path}/kind`);
    }
  }
}

const SCHEMA_METADATA_KEYS = [
  "defaultValue",
  "deprecated",
  "description",
  "diagnosticIds",
  "examples",
  "extensions",
  "kind",
  "readOnly",
  "title",
  "writeOnly",
] as const;

function validateSchemaShape(
  value: Readonly<Record<string, unknown>>,
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  let variant: readonly string[];
  switch (value.kind) {
    case "any":
      variant = [];
      break;
    case "boolean-schema":
      variant = ["accepts"];
      break;
    case "scalar":
      variant = ["constValue", "constraints", "enumValues", "format", "type"];
      break;
    case "object":
      variant = [
        "additionalProperties",
        "maxProperties",
        "minProperties",
        "properties",
        "propertyOrder",
        "required",
      ];
      break;
    case "array":
      variant = [
        "contains",
        "items",
        "maxContains",
        "maxItems",
        "minContains",
        "minItems",
        "uniqueItems",
      ];
      break;
    case "tuple":
      variant = ["additionalItems", "maxItems", "minItems", "prefixItems"];
      break;
    case "composition":
      variant = ["discriminator", "mode", "variants"];
      break;
    case "ref":
      variant = ["schemaId"];
      break;
    case "type-less":
      variant = [
        "applicableTypes",
        "array",
        "constValue",
        "enumValues",
        "numeric",
        "object",
        "string",
      ];
      break;
    case "unknown":
      variant = ["reason"];
      break;
    default:
      variant = [];
  }
  validateKeys(
    value,
    [...SCHEMA_METADATA_KEYS, ...variant],
    path,
    diagnostics,
    "INVALID_SCHEMA",
  );
}

function validateSchemaMetadata(
  value: Readonly<Record<string, unknown>>,
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  validateOptionalString(
    value.title,
    `${path}/title`,
    diagnostics,
    "INVALID_SCHEMA",
  );
  validateOptionalString(
    value.description,
    `${path}/description`,
    diagnostics,
    "INVALID_SCHEMA",
  );
  for (const key of ["deprecated", "readOnly", "writeOnly"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") {
      add(diagnostics, "INVALID_SCHEMA", `${path}/${key}`);
    }
  }
  if (value.examples !== undefined && !isArray(value.examples)) {
    add(diagnostics, "INVALID_SCHEMA", `${path}/examples`);
  }
  if (value.extensions !== undefined && !isRecord(value.extensions)) {
    add(diagnostics, "INVALID_SCHEMA", `${path}/extensions`);
  }
}

function validateScalar(
  value: Readonly<Record<string, unknown>>,
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  const type = value.type;
  if (
    !new Set(["boolean", "integer", "null", "number", "string"]).has(
      String(type),
    )
  ) {
    add(diagnostics, "INVALID_SCHEMA", `${path}/type`);
    return;
  }
  if (isRecord(value.constraints)) {
    const constraints = value.constraints;
    validateKeys(
      constraints,
      [
        "exclusiveMaximum",
        "exclusiveMinimum",
        "format",
        "maxLength",
        "maximum",
        "minLength",
        "minimum",
        "multipleOf",
        "pattern",
      ],
      `${path}/constraints`,
      diagnostics,
      "INVALID_SCHEMA",
    );
    const hasNumeric = [
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "multipleOf",
    ].some((key) => constraints[key] !== undefined);
    const hasString = ["minLength", "maxLength", "pattern", "format"].some(
      (key) => constraints[key] !== undefined,
    );
    if (hasNumeric && type !== "integer" && type !== "number")
      add(diagnostics, "INVALID_SCHEMA", `${path}/constraints`);
    if (hasString && type !== "string")
      add(diagnostics, "INVALID_SCHEMA", `${path}/constraints`);
    validateNumeric(constraints, path, diagnostics);
    validateMinMax(
      constraints.minLength,
      constraints.maxLength,
      path,
      diagnostics,
    );
  }
  if (value.format !== undefined && typeof value.format !== "string") {
    add(diagnostics, "INVALID_SCHEMA", `${path}/format`);
  }
  if (isArray(value.enumValues) && value.enumValues.length === 0)
    add(diagnostics, "INVALID_SCHEMA", `${path}/enumValues`);
}

function pushObjectConstraints(
  value: Readonly<Record<string, unknown>>,
  path: string,
  stack: { value: unknown; path: string }[],
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  if (
    !isRecord(value.properties) ||
    !isArray(value.propertyOrder) ||
    !isArray(value.required)
  ) {
    add(diagnostics, "INVALID_SCHEMA", path);
    return;
  }
  const keys = Object.keys(value.properties);
  const order = value.propertyOrder.filter(
    (item): item is string => typeof item === "string",
  );
  if (
    order.length !== value.propertyOrder.length ||
    new Set(order).size !== order.length ||
    !sameSet(keys, order)
  ) {
    add(diagnostics, "INVALID_SCHEMA", `${path}/propertyOrder`);
  }
  checkNormalizedDuplicates(value.required, `${path}/required`, diagnostics);
  Object.entries(value.properties)
    .sort(([left], [right]) => compareText(left, right))
    .forEach(([, schema], index) =>
      stack.push({ value: schema, path: `${path}/properties/${index}` }),
    );
  if (typeof value.additionalProperties !== "boolean")
    stack.push({
      value: value.additionalProperties,
      path: `${path}/additionalProperties`,
    });
  validateMinMax(value.minProperties, value.maxProperties, path, diagnostics);
}

function pushArrayConstraints(
  value: Readonly<Record<string, unknown>>,
  path: string,
  stack: { value: unknown; path: string }[],
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  if (value.items === undefined)
    add(diagnostics, "INVALID_SCHEMA", `${path}/items`);
  else stack.push({ value: value.items, path: `${path}/items` });
  if (value.contains !== undefined)
    stack.push({ value: value.contains, path: `${path}/contains` });
  if (
    (value.minContains !== undefined || value.maxContains !== undefined) &&
    value.contains === undefined
  )
    add(diagnostics, "INVALID_SCHEMA", `${path}/contains`);
  validateMinMax(value.minItems, value.maxItems, path, diagnostics);
  validateMinMax(value.minContains, value.maxContains, path, diagnostics);
}

function pushComposition(
  value: Readonly<Record<string, unknown>>,
  knownIds: ReadonlySet<string>,
  path: string,
  stack: { value: unknown; path: string }[],
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  if (!isArray(value.variants) || value.variants.length === 0) {
    add(diagnostics, "INVALID_SCHEMA", `${path}/variants`);
    return;
  }
  if (value.mode === "not" && value.variants.length !== 1)
    add(diagnostics, "INVALID_SCHEMA", `${path}/variants`);
  else if (!new Set(["allOf", "anyOf", "oneOf", "not"]).has(String(value.mode)))
    add(diagnostics, "INVALID_SCHEMA", `${path}/mode`);
  value.variants.forEach((schema, index) =>
    stack.push({ value: schema, path: `${path}/variants/${index}` }),
  );
  if (value.discriminator !== undefined) {
    if (
      (value.mode !== "anyOf" && value.mode !== "oneOf") ||
      !isRecord(value.discriminator) ||
      !isRecord(value.discriminator.mapping)
    ) {
      add(diagnostics, "INVALID_SCHEMA", `${path}/discriminator`);
    } else {
      validateKeys(
        value.discriminator,
        ["mapping", "propertyName"],
        `${path}/discriminator`,
        diagnostics,
        "INVALID_SCHEMA",
      );
      requireString(
        value.discriminator.propertyName,
        `${path}/discriminator/propertyName`,
        diagnostics,
        "INVALID_SCHEMA",
      );
      Object.entries(value.discriminator.mapping)
        .sort(([left], [right]) => compareText(left, right))
        .forEach(([, id], index) => {
          if (typeof id !== "string" || !knownIds.has(id))
            add(
              diagnostics,
              "MISSING_REFERENCE",
              `${path}/discriminator/mapping/${index}`,
            );
        });
    }
  }
}

function pushTypeLess(
  value: Readonly<Record<string, unknown>>,
  path: string,
  stack: { value: unknown; path: string }[],
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  if (!isArray(value.applicableTypes)) {
    add(diagnostics, "INVALID_SCHEMA", `${path}/applicableTypes`);
    return;
  }
  const expected = new Set<SchemaInstanceType>();
  if (isRecord(value.numeric)) {
    expected.add("integer");
    expected.add("number");
    validateKeys(
      value.numeric,
      [
        "exclusiveMaximum",
        "exclusiveMinimum",
        "maximum",
        "minimum",
        "multipleOf",
      ],
      `${path}/numeric`,
      diagnostics,
      "INVALID_SCHEMA",
    );
    validateNumeric(value.numeric, path, diagnostics);
    if (Object.keys(value.numeric).length === 0) {
      add(diagnostics, "INVALID_SCHEMA", `${path}/numeric`);
    }
  }
  if (isRecord(value.string)) {
    expected.add("string");
    validateKeys(
      value.string,
      ["format", "maxLength", "minLength", "pattern"],
      `${path}/string`,
      diagnostics,
      "INVALID_SCHEMA",
    );
    validateMinMax(
      value.string.minLength,
      value.string.maxLength,
      path,
      diagnostics,
    );
    if (
      Object.keys(value.string).length === 0 ||
      [value.string.pattern, value.string.format].some(
        (item) => item !== undefined && typeof item !== "string",
      )
    ) {
      add(diagnostics, "INVALID_SCHEMA", `${path}/string`);
    }
  }
  if (isRecord(value.array)) {
    expected.add("array");
    validateKeys(
      value.array,
      [
        "contains",
        "items",
        "maxContains",
        "maxItems",
        "minContains",
        "minItems",
        "uniqueItems",
      ],
      `${path}/array`,
      diagnostics,
      "INVALID_SCHEMA",
    );
    pushArrayConstraints(value.array, `${path}/array`, stack, diagnostics);
  }
  if (isRecord(value.object)) {
    expected.add("object");
    validateKeys(
      value.object,
      [
        "additionalProperties",
        "maxProperties",
        "minProperties",
        "properties",
        "propertyOrder",
        "required",
      ],
      `${path}/object`,
      diagnostics,
      "INVALID_SCHEMA",
    );
    pushObjectConstraints(value.object, `${path}/object`, stack, diagnostics);
  }
  const actual = value.applicableTypes.filter(
    (item): item is SchemaInstanceType =>
      typeof item === "string" &&
      SCHEMA_TYPES.includes(item as SchemaInstanceType),
  );
  if (
    actual.length !== value.applicableTypes.length ||
    new Set(actual).size !== actual.length ||
    !sameSet([...expected], actual)
  ) {
    add(diagnostics, "INVALID_SCHEMA", `${path}/applicableTypes`);
  }
  if (
    expected.size === 0 &&
    value.constValue === undefined &&
    value.enumValues === undefined &&
    value.diagnosticIds === undefined
  ) {
    add(diagnostics, "INVALID_SCHEMA", path);
  }
}

function validateNumeric(
  value: Readonly<Record<string, unknown>>,
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  for (const key of [
    "exclusiveMaximum",
    "exclusiveMinimum",
    "maximum",
    "minimum",
    "multipleOf",
  ]) {
    if (value[key] !== undefined && typeof value[key] !== "number") {
      add(diagnostics, "INVALID_SCHEMA", `${path}/${key}`);
    }
  }
  if (typeof value.multipleOf === "number" && value.multipleOf <= 0)
    add(diagnostics, "INVALID_SCHEMA", `${path}/multipleOf`);
  for (const [minimum, maximum] of [
    [value.minimum, value.maximum],
    [value.exclusiveMinimum, value.exclusiveMaximum],
  ]) {
    if (
      typeof minimum === "number" &&
      typeof maximum === "number" &&
      minimum > maximum
    )
      add(diagnostics, "INVALID_SCHEMA", path);
  }
}

function validateMinMax(
  minimum: unknown,
  maximum: unknown,
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  if (
    (minimum !== undefined &&
      (!Number.isSafeInteger(minimum) || Number(minimum) < 0)) ||
    (maximum !== undefined &&
      (!Number.isSafeInteger(maximum) || Number(maximum) < 0)) ||
    (typeof minimum === "number" &&
      typeof maximum === "number" &&
      minimum > maximum)
  ) {
    add(diagnostics, "INVALID_SCHEMA", path);
  }
}

function collectSchemaDiagnosticLinks(
  value: Readonly<Record<string, unknown>>,
  path: string,
  links: { id: string; path: string }[],
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  if (value.diagnosticIds === undefined) return;
  if (!isArray(value.diagnosticIds)) {
    add(diagnostics, "INVALID_SCHEMA", `${path}/diagnosticIds`);
    return;
  }
  value.diagnosticIds.forEach((id, index) => {
    if (typeof id === "string")
      links.push({ id, path: `${path}/diagnosticIds/${index}` });
    else add(diagnostics, "INVALID_SCHEMA", `${path}/diagnosticIds/${index}`);
  });
}

function validateSerializableStructure(
  value: unknown,
  limits: ModelLimits,
  diagnostics: Map<string, CanonicalDiagnostic>,
): boolean {
  const active = new WeakSet<object>();
  const stack: { depth: number; leaving: boolean; value: unknown }[] = [
    { depth: 0, leaving: false, value },
  ];
  let nodes = 0;
  let valid = true;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const item = current.value;
    if (
      typeof item === "number" &&
      (!Number.isFinite(item) || Object.is(item, -0))
    ) {
      add(diagnostics, "INVALID_JSON_VALUE", "/");
      valid = false;
      continue;
    }
    if (typeof item === "string" && item.length > limits.maxStringLength) {
      add(diagnostics, "MODEL_LIMIT_EXCEEDED", "/");
      valid = false;
      continue;
    }
    if (
      item === undefined ||
      typeof item === "bigint" ||
      typeof item === "function" ||
      typeof item === "symbol"
    ) {
      add(diagnostics, "NON_SERIALIZABLE", "/");
      valid = false;
      continue;
    }
    if (item === null || typeof item !== "object") continue;
    if (current.leaving) {
      active.delete(item);
      continue;
    }
    if (current.depth > limits.maxDepth) {
      add(diagnostics, "MODEL_LIMIT_EXCEEDED", "/");
      return false;
    }
    if (active.has(item)) {
      add(diagnostics, "NON_SERIALIZABLE", "/");
      valid = false;
      continue;
    }
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype
    ) {
      add(diagnostics, "NON_SERIALIZABLE", "/");
      valid = false;
      continue;
    }
    if (Reflect.ownKeys(item).some((key) => typeof key === "symbol")) {
      add(diagnostics, "NON_SERIALIZABLE", "/");
      valid = false;
      continue;
    }
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const serializedDescriptors = Object.entries(descriptors).filter(
      ([key]) => !Array.isArray(item) || key !== "length",
    );
    if (
      serializedDescriptors.some(
        ([key, descriptor]) =>
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          descriptor.enumerable !== true ||
          (Array.isArray(item) && !/^\d+$/.test(key)),
      )
    ) {
      add(diagnostics, "NON_SERIALIZABLE", "/");
      valid = false;
      continue;
    }
    const values: unknown[] = [];
    if (Array.isArray(item)) {
      if (item.length > limits.maxCollectionEntries) {
        add(diagnostics, "MODEL_LIMIT_EXCEEDED", "/");
        return false;
      }
      for (let index = 0; index < item.length; index += 1) {
        if (!(index in item)) {
          add(diagnostics, "NON_SERIALIZABLE", "/");
          valid = false;
        } else values.push(item[index]);
      }
    } else {
      if (serializedDescriptors.length > limits.maxCollectionEntries) {
        add(diagnostics, "MODEL_LIMIT_EXCEEDED", "/");
        return false;
      }
      serializedDescriptors.forEach(([, descriptor]) =>
        values.push(descriptor.value),
      );
    }
    nodes += 1 + values.length;
    if (nodes > limits.maxNodes) {
      add(diagnostics, "MODEL_LIMIT_EXCEEDED", "/");
      return false;
    }
    active.add(item);
    stack.push({ depth: current.depth, leaving: true, value: item });
    values
      .reverse()
      .forEach((child) =>
        stack.push({ depth: current.depth + 1, leaving: false, value: child }),
      );
  }
  return valid;
}

function responseStatusKey(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "default" && Object.keys(value).length === 1)
    return "default";
  if (
    value.kind === "range" &&
    Object.keys(value).length === 2 &&
    new Set(["1XX", "2XX", "3XX", "4XX", "5XX"]).has(String(value.range))
  )
    return `range:${String(value.range)}`;
  if (
    value.kind === "code" &&
    Object.keys(value).length === 2 &&
    Number.isInteger(value.code) &&
    Number(value.code) >= 100 &&
    Number(value.code) <= 599
  )
    return `code:${String(value.code)}`;
  return undefined;
}

function validateKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
  code: DiagnosticCode = "INVALID_MODEL",
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    add(diagnostics, code, path);
  }
}

function validDiagnosticLocation(
  value: unknown,
): value is NonNullable<CanonicalDiagnostic["location"]> {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const allowed = new Set([
    "operationId",
    "path",
    "schemaId",
    "serviceId",
    "versionId",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  for (const key of [
    "operationId",
    "schemaId",
    "serviceId",
    "versionId",
  ] as const) {
    const id = value[key];
    if (id !== undefined && (typeof id !== "string" || !isValidId(id)))
      return false;
  }
  return (
    value.path === undefined ||
    (typeof value.path === "string" &&
      value.path.length <= 2_048 &&
      /^\/(?:[^~\/]|~[01]|\/)*$/.test(value.path) &&
      !/[\u0000-\u001f\u007f]/.test(value.path))
  );
}

function validateId(
  value: unknown,
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): value is string {
  if (typeof value !== "string" || !isValidId(value)) {
    add(diagnostics, "INVALID_CANONICAL_ID", path);
    return false;
  }
  return true;
}

function isValidId(value: string): boolean {
  try {
    assertCanonicalId(value);
    return true;
  } catch {
    return false;
  }
}

function requireString(
  value: unknown,
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
  code: DiagnosticCode = "INVALID_MODEL",
): void {
  if (typeof value !== "string" || value.length === 0)
    add(diagnostics, code, path);
}

function validateOptionalString(
  value: unknown,
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
  code: DiagnosticCode = "INVALID_MODEL",
): void {
  if (value !== undefined && typeof value !== "string")
    add(diagnostics, code, path);
}

function checkDuplicate(
  values: Set<string>,
  value: string,
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  if (values.has(value)) add(diagnostics, "DUPLICATE_ID", path);
  values.add(value);
}

function checkNormalizedDuplicates(
  values: unknown,
  path: string,
  diagnostics: Map<string, CanonicalDiagnostic>,
): void {
  if (!isArray(values) || values.some((value) => typeof value !== "string")) {
    add(diagnostics, "INVALID_MODEL", path);
    return;
  }
  const seen = new Set<string>();
  values.forEach((value, index) =>
    checkDuplicate(
      seen,
      String(value).normalize("NFC").toLowerCase(),
      `${path}/${index}`,
      diagnostics,
    ),
  );
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((item) => right.includes(item))
  );
}

function add(
  diagnostics: Map<string, CanonicalDiagnostic>,
  code: DiagnosticCode,
  path: string,
): void {
  const diagnostic = createDiagnostic({ code, location: { path } });
  diagnostics.set(diagnostic.id, diagnostic);
}

function sorted(
  values: Iterable<CanonicalDiagnostic>,
): readonly CanonicalDiagnostic[] {
  return [...values].sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      compareText(left.code, right.code) ||
      compareText(left.location?.path ?? "", right.location?.path ?? "") ||
      compareText(left.id, right.id),
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDiagnosticCode(value: unknown): value is DiagnosticCode {
  return typeof value === "string" && Object.hasOwn(DIAGNOSTIC_MESSAGES, value);
}

function validLimits(limits: ModelLimits): boolean {
  return Object.values(limits).every(
    (limit) => Number.isSafeInteger(limit) && limit > 0,
  );
}
