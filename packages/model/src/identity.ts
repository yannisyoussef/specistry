import type {
  DiagnosticCode,
  DiagnosticId,
  DiagnosticLocation,
  DocumentationVersionId,
  ExampleId,
  HttpMethod,
  OperationId,
  PageId,
  ParameterId,
  ProjectId,
  SchemaId,
  SecuritySchemeId,
  ServerId,
  ServiceId,
} from "./types.js";

const CANONICAL_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._~-]{0,127})$/;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

interface CanonicalIdByKind {
  readonly diagnostic: DiagnosticId;
  readonly example: ExampleId;
  readonly operation: OperationId;
  readonly page: PageId;
  readonly parameter: ParameterId;
  readonly project: ProjectId;
  readonly schema: SchemaId;
  readonly securityScheme: SecuritySchemeId;
  readonly server: ServerId;
  readonly service: ServiceId;
  readonly version: DocumentationVersionId;
}

export function createCanonicalId<Kind extends keyof CanonicalIdByKind>(
  _kind: Kind,
  value: string,
): CanonicalIdByKind[Kind] {
  return normalizeCanonicalId(value) as CanonicalIdByKind[Kind];
}

export function normalizeCanonicalId(value: string): string {
  const normalized = value.normalize("NFC");
  assertCanonicalId(normalized);
  return normalized;
}

export function assertCanonicalId(value: string): void {
  if (!CANONICAL_ID.test(value) || value !== value.normalize("NFC")) {
    throw new TypeError(
      "Canonical IDs must be NFC-normalized, URL-safe, non-empty, and at most 128 characters.",
    );
  }
}

export function createOperationId(input: {
  readonly contractId?: string;
  readonly method: HttpMethod;
  readonly path: string;
}): OperationId {
  if (input.contractId !== undefined) {
    const contractId = input.contractId.normalize("NFC");
    if (contractId.length === 0) {
      throw new TypeError("Contract operation IDs must be non-empty.");
    }
    if (CANONICAL_ID.test(contractId)) return contractId as OperationId;
    return stableId("op", ["contract", contractId]) as OperationId;
  }
  return stableId("op", [
    "transport",
    input.method,
    input.path.normalize("NFC"),
  ]) as OperationId;
}

export function createSchemaId(
  canonicalSourceId: string,
  escapedJsonPointer: string,
): SchemaId {
  if (canonicalSourceId.length === 0) {
    throw new TypeError("Canonical source identities must be non-empty.");
  }
  if (!/^(?:\/(?:[^~/]|~[01])*)*$/.test(escapedJsonPointer)) {
    throw new TypeError("Schema pointers must use valid RFC 6901 escaping.");
  }
  return stableId("schema", [
    canonicalSourceId.normalize("NFC"),
    escapedJsonPointer,
  ]) as SchemaId;
}

export function createDiagnosticId(
  code: DiagnosticCode,
  location?: DiagnosticLocation,
): DiagnosticId {
  return stableId("diag", [code, stableLocation(location)]) as DiagnosticId;
}

function stableLocation(location: DiagnosticLocation | undefined): string {
  if (location === undefined) return "";
  return [
    location.versionId ?? "",
    location.serviceId ?? "",
    location.operationId ?? "",
    location.schemaId ?? "",
    location.path ?? "",
  ].join("\u001f");
}

function stableId(prefix: string, parts: readonly string[]): string {
  let hash = FNV_OFFSET;
  const input = parts
    .map((part) => {
      const normalized = part.normalize("NFC");
      return `${normalized.length}:${normalized}`;
    })
    .join("|");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return `${prefix}_${hash.toString(16).padStart(16, "0")}`;
}
