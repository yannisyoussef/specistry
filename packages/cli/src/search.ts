import {
  parseContentArtifact,
  parseNavigationArtifact,
  type ContentPage,
  type NavigationArtifact,
} from "@specistry/content";
import { parseDocumentationArtifact } from "@specistry/model";
import {
  buildSearch,
  projectSearchDocuments,
  type ProjectionInput,
} from "@specistry/search";

import type { ContentBuildOutput } from "./content.js";

/**
 * Search generation (SPEC-007): runs after ingestion and authored content are
 * known valid, from the same serialized artifacts the reader will consume,
 * so the index can never describe anything the build did not publish.
 * `specistry validate` projects documents only (cheap, reports the count);
 * `specistry build` projects and indexes.
 */

export interface SearchBuildOutput {
  readonly json: string;
  readonly documents: number;
  readonly terms: number;
}

function projectionInput(
  content: ContentBuildOutput,
  operationTerms?: ReadonlyMap<string, readonly string[]>,
): ProjectionInput {
  const artifact = parseDocumentationArtifact(content.documentationJson);
  const pages: readonly ContentPage[] =
    content.contentJson === undefined
      ? []
      : parseContentArtifact(content.contentJson).pages;
  const navigation: NavigationArtifact | undefined =
    content.navigationJson === undefined
      ? undefined
      : parseNavigationArtifact(content.navigationJson);
  return { artifact, navigation, operationTerms, pages };
}

/** Number of search documents the project would produce. */
export function countSearchDocuments(
  content: ContentBuildOutput,
  operationTerms?: ReadonlyMap<string, readonly string[]>,
): number {
  return projectSearchDocuments(projectionInput(content, operationTerms))
    .documents.length;
}

export function buildSearchArtifact(
  content: ContentBuildOutput,
  operationTerms?: ReadonlyMap<string, readonly string[]>,
): SearchBuildOutput {
  const built = buildSearch(projectionInput(content, operationTerms));
  return {
    documents: built.statistics.documents,
    json: built.json,
    terms: built.statistics.terms,
  };
}
