export {
  createMemoryAcquisition,
  type AcquiredSource,
  type AcquisitionFailure,
  type AcquisitionResult,
  type SourceAcquisition,
} from "./acquisition.js";
export {
  SOURCE_DIAGNOSTIC_MESSAGES,
  SOURCE_DIAGNOSTIC_SEVERITY,
  compareSourceDiagnostics,
  createSourceDiagnostic,
  type SourceDiagnostic,
  type SourceDiagnosticCode,
  type SourceDiagnosticSeverity,
  type SourceLocation,
} from "./diagnostics.js";
export {
  DEFAULT_INGESTION_LIMITS,
  snapshotIngestionLimits,
  type IngestionLimits,
} from "./limits.js";
export {
  ingestOpenApi,
  type IngestOptions,
  type IngestionProject,
  type IngestionResult,
  type IngestionSourceRecord,
  type IngestionStatistics,
} from "./pipeline.js";
export { comparePointers, escapeSegment } from "./pointer.js";
