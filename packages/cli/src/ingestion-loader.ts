import {
  parseDocumentationArtifact,
  type DocumentationArtifact,
} from "@specistry/model";
import {
  SOURCE_DIAGNOSTIC_MESSAGES,
  SOURCE_DIAGNOSTIC_SEVERITY,
  type IngestionLimits,
  type IngestionSourceRecord,
  type IngestionStatistics,
  type SourceDiagnosticCode,
} from "@specistry/openapi";

import { isDocumentId } from "./acquisition.js";
import {
  hostModuleUrl,
  runBoundedHost,
  type BoundedHostFailure,
} from "./bounded-host.js";
import { MAX_INGESTION_FRAME_BYTES } from "./contracts.js";

const MAX_PROCESS_OUTPUT_BYTES = 65_536;
const MAX_POINTER_LENGTH = 2_048;
const POINTER = /^(?:\/(?:[^~/]|~[01])*)*$/;
const SHA256 = /^[0-9a-f]{64}$/;

export interface IngestionRequest {
  readonly projectRoot: string;
  readonly entries: readonly string[];
  readonly project: { readonly name: string; readonly description?: string };
  readonly limits: IngestionLimits;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  /** Test seam: an alternative host module honouring the same protocol. */
  readonly hostModule?: URL;
}

export interface HostSourceDiagnostic {
  readonly code: SourceDiagnosticCode;
  readonly severity: "error" | "warning";
  readonly document: string;
  readonly pointer: string;
}

export interface HostArtifactDiagnostic {
  readonly code: string;
  readonly path: string;
}

export interface IngestionOutcome {
  readonly ok: boolean;
  readonly artifact?: DocumentationArtifact;
  readonly artifactJson?: string;
  readonly diagnostics: readonly HostSourceDiagnostic[];
  readonly artifactDiagnostics: readonly HostArtifactDiagnostic[];
  readonly sources: readonly IngestionSourceRecord[];
  readonly statistics: IngestionStatistics;
}

export type IngestionLoadResult =
  | { readonly ok: true; readonly outcome: IngestionOutcome }
  | { readonly ok: false; readonly reason: BoundedHostFailure };

/**
 * Runs the ingestion host and revalidates everything that crosses the
 * boundary: the frame shape, every diagnostic code/location, source records,
 * statistics, and the canonical artifact (parsed and validated again by the
 * model). A frame the parent cannot vouch for is a failure, never a result.
 */
export async function runIngestionIsolated(
  request: IngestionRequest,
): Promise<IngestionLoadResult> {
  const encoded = JSON.stringify({
    entries: request.entries,
    limits: request.limits,
    project: request.project,
    projectRoot: request.projectRoot,
  });
  const result = await runBoundedHost({
    args: [encoded],
    hostModule:
      request.hostModule ?? hostModuleUrl("ingestion-host.js", import.meta.url),
    maxFrameBytes: MAX_INGESTION_FRAME_BYTES,
    maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES,
    // Matches the documented 2 GiB evidence ceiling: two in-budget documents
    // of ~9 MiB and ~480k nodes each need more than 1 GiB of parser heap.
    memoryMiB: 2_048,
    signal: request.signal,
    stackKiB: 4_096,
    timeoutMs: request.timeoutMs,
  });
  if (!result.ok) return result;
  const outcome = parseIngestionFrame(result.frame, request.limits);
  if (outcome === undefined) return { ok: false, reason: "failed" };
  return { ok: true, outcome };
}

/** Strict frame revalidation; exported for direct adversarial testing. */
export function parseIngestionFrame(
  frame: Buffer,
  limits: IngestionLimits,
): IngestionOutcome | undefined {
  if (frame.byteLength === 0 || frame.byteLength > MAX_INGESTION_FRAME_BYTES) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(frame.toString("utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.type !== "result") return undefined;
  if (
    !hasOnlyKeys(value, [
      "artifactDiagnostics",
      "artifactJson",
      "cancelled",
      "diagnostics",
      "ok",
      "sources",
      "statistics",
      "type",
    ])
  ) {
    return undefined;
  }
  if (typeof value.ok !== "boolean" || typeof value.cancelled !== "boolean") {
    return undefined;
  }
  const diagnostics = parseDiagnostics(
    value.diagnostics,
    limits.maxDiagnostics,
  );
  const artifactDiagnostics = parseArtifactDiagnostics(
    value.artifactDiagnostics,
    limits.maxDiagnostics,
  );
  const sources = parseSources(value.sources, limits.maxDocuments * 64);
  const statistics = parseStatistics(value.statistics);
  if (
    diagnostics === undefined ||
    artifactDiagnostics === undefined ||
    sources === undefined ||
    statistics === undefined
  ) {
    return undefined;
  }
  if (value.cancelled) return undefined;
  if (!value.ok) {
    if (value.artifactJson !== undefined) return undefined;
    if (
      !diagnostics.some((diagnostic) => diagnostic.severity === "error") &&
      artifactDiagnostics.length === 0
    ) {
      return undefined;
    }
    return { artifactDiagnostics, diagnostics, ok: false, sources, statistics };
  }
  if (typeof value.artifactJson !== "string") return undefined;
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return undefined;
  }
  if (artifactDiagnostics.length > 0) return undefined;
  let artifact: DocumentationArtifact;
  try {
    artifact = parseDocumentationArtifact(value.artifactJson);
  } catch {
    return undefined;
  }
  // `parseDocumentationArtifact` validates and canonicalizes, so the host
  // must have produced exactly these bytes; anything else is a spoof.
  const artifactJson = JSON.stringify(artifact);
  if (artifactJson !== value.artifactJson) return undefined;
  return {
    artifact,
    artifactDiagnostics,
    artifactJson,
    diagnostics,
    ok: true,
    sources,
    statistics,
  };
}

function parseDiagnostics(
  value: unknown,
  limit: number,
): readonly HostSourceDiagnostic[] | undefined {
  if (!Array.isArray(value) || value.length > limit) return undefined;
  const diagnostics: HostSourceDiagnostic[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["code", "document", "pointer", "severity"]) ||
      typeof entry.code !== "string" ||
      !Object.hasOwn(SOURCE_DIAGNOSTIC_MESSAGES, entry.code) ||
      entry.severity !==
        SOURCE_DIAGNOSTIC_SEVERITY[entry.code as SourceDiagnosticCode] ||
      typeof entry.document !== "string" ||
      !isDocumentId(entry.document) ||
      !isPointer(entry.pointer)
    ) {
      return undefined;
    }
    diagnostics.push({
      code: entry.code as SourceDiagnosticCode,
      document: entry.document,
      pointer: entry.pointer as string,
      severity: entry.severity as "error" | "warning",
    });
  }
  return diagnostics;
}

function parseArtifactDiagnostics(
  value: unknown,
  limit: number,
): readonly HostArtifactDiagnostic[] | undefined {
  if (!Array.isArray(value) || value.length > limit) return undefined;
  const diagnostics: HostArtifactDiagnostic[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["code", "path"]) ||
      typeof entry.code !== "string" ||
      !/^[A-Z][A-Z_]{1,63}$/.test(entry.code) ||
      !isPointer(entry.path) ||
      entry.path === ""
    ) {
      return undefined;
    }
    diagnostics.push({ code: entry.code, path: entry.path as string });
  }
  return diagnostics;
}

function parseSources(
  value: unknown,
  limit: number,
): readonly IngestionSourceRecord[] | undefined {
  if (!Array.isArray(value) || value.length > limit) return undefined;
  const sources: IngestionSourceRecord[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["bytes", "id", "sha256"]) ||
      typeof entry.id !== "string" ||
      !isDocumentId(entry.id) ||
      !Number.isSafeInteger(entry.bytes) ||
      Number(entry.bytes) < 0 ||
      typeof entry.sha256 !== "string" ||
      !SHA256.test(entry.sha256)
    ) {
      return undefined;
    }
    sources.push({
      bytes: entry.bytes as number,
      id: entry.id,
      sha256: entry.sha256,
    });
  }
  return sources;
}

function parseStatistics(value: unknown): IngestionStatistics | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["documents", "operations", "references", "schemas"])
  ) {
    return undefined;
  }
  const entries = ["documents", "operations", "references", "schemas"] as const;
  for (const key of entries) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0) {
      return undefined;
    }
  }
  return {
    documents: value.documents as number,
    operations: value.operations as number,
    references: value.references as number,
    schemas: value.schemas as number,
  };
}

function isPointer(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length <= MAX_POINTER_LENGTH &&
    POINTER.test(value) &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function hasOnlyKeys(value: object, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return (
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
