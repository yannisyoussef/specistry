import {
  parseSearchArtifact,
  parseSearchArtifactValue,
  SearchArtifactError,
  serializeSearchArtifact,
} from "./artifact.js";
import {
  createEngine,
  ENGINE_OPTIONS,
  FIELD_BOOSTS,
  KIND_PRIORITY,
} from "./engine.js";
import { projectSearchDocuments, type ProjectionInput } from "./project.js";
import {
  boundedText,
  normalizeTerm,
  queryTerms,
  tokenize,
} from "./tokenize.js";
import {
  PROJECTION_LIMITS,
  QUERY_LIMITS,
  SEARCH_ARTIFACT_FILENAME,
  SEARCH_ENGINE,
  SEARCH_FORMAT_VERSION,
  type SearchArtifact,
  type SearchDocument,
  type SearchIndexRecord,
  type SearchKind,
  type SearchMethod,
  type SearchProjection,
  type SearchStatistics,
} from "./types.js";

/**
 * Build-time entry: project the canonical, content, and navigation
 * artifacts into search documents, index them, and produce the serialized
 * artifact. The browser never imports this module; it loads `./client`.
 */

export {
  boundedText,
  ENGINE_OPTIONS,
  FIELD_BOOSTS,
  KIND_PRIORITY,
  normalizeTerm,
  parseSearchArtifact,
  parseSearchArtifactValue,
  PROJECTION_LIMITS,
  projectSearchDocuments,
  QUERY_LIMITS,
  queryTerms,
  SEARCH_ARTIFACT_FILENAME,
  SEARCH_ENGINE,
  SEARCH_FORMAT_VERSION,
  SearchArtifactError,
  serializeSearchArtifact,
  tokenize,
};
export type {
  ProjectionInput,
  SearchArtifact,
  SearchDocument,
  SearchIndexRecord,
  SearchKind,
  SearchMethod,
  SearchProjection,
  SearchStatistics,
};

export interface SearchBuild {
  readonly artifact: SearchArtifact;
  readonly json: string;
  readonly statistics: SearchStatistics;
}

/** Indexes a projection deterministically: records are added in id order. */
export function buildSearchIndex(projection: SearchProjection): SearchBuild {
  const engine = createEngine();
  engine.addAll([...projection.records]);
  const artifact: SearchArtifact = {
    documents: projection.documents,
    engine: SEARCH_ENGINE,
    index: engine.toJSON(),
    searchVersion: SEARCH_FORMAT_VERSION,
  };
  return {
    artifact,
    json: serializeSearchArtifact(artifact),
    statistics: {
      documents: projection.documents.length,
      terms: engine.termCount,
    },
  };
}

/** Projection plus indexing in one call, for the CLI. */
export function buildSearch(input: ProjectionInput): SearchBuild {
  return buildSearchIndex(projectSearchDocuments(input));
}
