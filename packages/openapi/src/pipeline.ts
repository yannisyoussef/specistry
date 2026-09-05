import {
  CanonicalModelError,
  canonicalizeDocumentationArtifact,
  DEFAULT_MODEL_LIMITS,
  DOCUMENT_MODEL_VERSION,
  type ApiService,
  type CanonicalDiagnostic,
  type DocumentationArtifact,
  type DocumentationVersionId,
  type ModelLimits,
  type ProjectId,
  type ServiceId,
} from "@specra/model";

import type { SourceAcquisition } from "./acquisition.js";
import {
  DiagnosticSink,
  compareSourceDiagnostics,
  type SourceDiagnostic,
} from "./diagnostics.js";
import { loadDocumentGraph } from "./documents.js";
import { IdentityLedger, canonicalSlug, compareText } from "./identity.js";
import {
  DEFAULT_INGESTION_LIMITS,
  snapshotIngestionLimits,
  type IngestionLimits,
} from "./limits.js";
import { normalizeService } from "./normalize/service.js";

export interface IngestionProject {
  readonly name: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
}

export interface IngestOptions {
  /** One acquisition port per configured root OpenAPI document, in config order. */
  readonly sources: readonly SourceAcquisition[];
  readonly project: IngestionProject;
  readonly limits?: IngestionLimits;
  /** Canonical model budgets; may only tighten the model defaults. */
  readonly modelLimits?: ModelLimits;
  readonly signal?: AbortSignal;
}

export interface IngestionSourceRecord {
  readonly id: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface IngestionStatistics {
  readonly documents: number;
  readonly references: number;
  readonly operations: number;
  readonly schemas: number;
}

export interface IngestionResult {
  /** True when no error-severity diagnostic was produced. */
  readonly ok: boolean;
  /** Present only when `ok` is true; canonical, validated, and frozen. */
  readonly artifact?: DocumentationArtifact;
  readonly diagnostics: readonly SourceDiagnostic[];
  /**
   * Canonical model validation errors that the adapter could not attribute to
   * a source location. Empty unless an adapter invariant is broken.
   */
  readonly artifactDiagnostics: readonly CanonicalDiagnostic[];
  readonly sources: readonly IngestionSourceRecord[];
  readonly statistics: IngestionStatistics;
  readonly cancelled: boolean;
}

/**
 * Runs the complete pipeline: acquisition → bounded parse → reference graph →
 * validation/normalization → canonical model v1 → validated artifact. No
 * network or filesystem access happens outside the supplied acquisition ports.
 */
export async function ingestOpenApi(
  options: IngestOptions,
): Promise<IngestionResult> {
  const limits = snapshotIngestionLimits(
    options.limits ?? DEFAULT_INGESTION_LIMITS,
  );
  if (limits === undefined) {
    throw new TypeError("Ingestion limits must be positive safe integers.");
  }
  if (options.sources.length === 0) {
    throw new TypeError("At least one source acquisition is required.");
  }
  const rootDocument = options.sources[0]?.entry ?? "";
  const sink = new DiagnosticSink(limits.maxDiagnostics, rootDocument);
  const sources: IngestionSourceRecord[] = [];
  const services: ApiService[] = [];
  const canonicalDiagnostics = new Map<string, CanonicalDiagnostic>();
  const ledger = new IdentityLedger();
  let documents = 0;
  let references = 0;
  let operations = 0;
  let schemas = 0;

  for (const acquisition of options.sources) {
    if (isAborted(options.signal)) {
      return failure(
        sink.toSorted(),
        [],
        sources,
        { documents, operations, references, schemas },
        true,
      );
    }
    const graph = await loadDocumentGraph(acquisition, limits, sink, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (graph === undefined) {
      if (isAborted(options.signal)) {
        return failure(
          sink.toSorted(),
          [],
          sources,
          { documents, operations, references, schemas },
          true,
        );
      }
      continue;
    }
    for (const parsed of [...graph.documents.values()].sort((left, right) =>
      compareText(left.id, right.id),
    )) {
      sources.push({
        bytes: parsed.bytes,
        id: parsed.id,
        sha256: parsed.sha256,
      });
    }
    documents += graph.documents.size;
    references += graph.referenceCount;
    const serviceId = canonicalSlug("service", acquisition.entry) as ServiceId;
    const claim = ledger.claim("service", serviceId, acquisition.entry, {
      document: acquisition.entry,
      pointer: "",
    });
    if (!claim.ok) {
      sink.add("SOURCE_IDENTITY_COLLISION", {
        document: acquisition.entry,
        pointer: "",
      });
      sink.add("SOURCE_IDENTITY_COLLISION", claim.existing.location);
      continue;
    }
    const normalized = normalizeService(graph, limits, sink, serviceId);
    operations += normalized.context.operationCount;
    schemas += normalized.context.registry.size;
    for (const [id, diagnostic] of normalized.context.canonicalDiagnostics) {
      canonicalDiagnostics.set(id, diagnostic);
    }
    services.push(normalized.service);
  }

  const statistics = { documents, operations, references, schemas };
  const artifact: DocumentationArtifact = {
    diagnostics: [...canonicalDiagnostics.values()],
    model: {
      modelVersion: DOCUMENT_MODEL_VERSION,
      project: {
        id: canonicalSlug("project", options.project.name) as ProjectId,
        name: options.project.name,
        ...(options.project.description === undefined
          ? {}
          : { description: options.project.description }),
        ...(options.project.canonicalUrl === undefined
          ? {}
          : { canonicalUrl: options.project.canonicalUrl }),
      },
      versions: [
        {
          id: "current" as DocumentationVersionId,
          label: "Current",
          pages: [],
          services,
          status: "current",
        },
      ],
    },
  };
  const modelLimits = options.modelLimits ?? DEFAULT_MODEL_LIMITS;
  // Canonicalization validates once and throws on model errors, so the model
  // walk runs a single time per build.
  let canonical: DocumentationArtifact | undefined;
  let modelIssues: readonly CanonicalDiagnostic[] = [];
  try {
    canonical = canonicalizeDocumentationArtifact(artifact, modelLimits);
  } catch (error) {
    if (!(error instanceof CanonicalModelError)) throw error;
    modelIssues = error.diagnostics;
  }
  // A canonical artifact that outgrows the frozen model budget is an input-size
  // outcome, not an adapter defect: report it as a source limit at the root.
  if (modelIssues.some((issue) => issue.code === "MODEL_LIMIT_EXCEEDED")) {
    sink.add("SOURCE_LIMIT_EXCEEDED", { document: rootDocument, pointer: "" });
  }
  const artifactDiagnostics = modelIssues.filter(
    (issue) =>
      issue.severity === "error" && issue.code !== "MODEL_LIMIT_EXCEEDED",
  );
  const diagnostics = sink.toSorted();
  if (sink.hasErrors || canonical === undefined) {
    return failure(
      diagnostics,
      artifactDiagnostics,
      sources,
      statistics,
      false,
    );
  }
  return {
    artifact: canonical,
    artifactDiagnostics: [],
    cancelled: false,
    diagnostics,
    ok: true,
    sources,
    statistics,
  };
}

function failure(
  diagnostics: readonly SourceDiagnostic[],
  artifactDiagnostics: readonly CanonicalDiagnostic[],
  sources: readonly IngestionSourceRecord[],
  statistics: IngestionStatistics,
  cancelled: boolean,
): IngestionResult {
  return {
    artifactDiagnostics,
    cancelled,
    diagnostics: [...diagnostics].sort(compareSourceDiagnostics),
    ok: false,
    sources,
    statistics,
  };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}
