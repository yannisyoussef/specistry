export {
  createMemoryAcquisition,
  type AcquiredSource,
  type AcquisitionFailure,
  type AcquisitionResult,
  type SourceAcquisition,
} from "./acquisition.js";
export {
  SOURCE_DIAGNOSTIC_MESSAGES,
  compareSourceDiagnostics,
  createSourceDiagnostic,
  type SourceDiagnostic,
  type SourceDiagnosticCode,
  type SourceDiagnosticSeverity,
  type SourceLocation,
} from "./diagnostics.js";
export {
  DEFAULT_INGESTION_LIMITS,
  DEFAULT_PARSE_LIMITS,
  snapshotIngestionLimits,
  type IngestionLimits,
  type ParseLimits,
} from "./limits.js";
export {
  OpenApiIngestionError,
  detectOpenApiVersion,
  parseOpenApiSource,
  type OpenApiDialect,
  type OpenApiSourceDocument,
  type SourceOrigin,
} from "./parse.js";
export {
  ingestOpenApi,
  type IngestOptions,
  type IngestionProject,
  type IngestionResult,
  type IngestionSourceRecord,
  type IngestionStatistics,
} from "./pipeline.js";
export { comparePointers, escapeSegment, joinPointer } from "./pointer.js";
export {
  assertReferenceAllowed,
  classifyReference,
  resolveDocumentId,
  type ReferenceKind,
  type RemoteReferencePolicy,
} from "./references.js";
