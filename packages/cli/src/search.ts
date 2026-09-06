import {
  parseContentArtifact,
  parseNavigationArtifact,
  type ContentPage,
  type NavigationArtifact,
} from "@specra/content";
import { parseDocumentationArtifact } from "@specra/model";
import {
  buildSearch,
  projectSearchDocuments,
  type ProjectionInput,
} from "@specra/search";

import type { ContentBuildOutput } from "./content.js";

/**
 * Search generation (SPEC-007): runs after ingestion and authored content are
 * known valid, from the same serialized artifacts the reader will consume,
 * so the index can never describe anything the build did not publish.
 * `specra validate` projects documents only (cheap, reports the count);
 * `specra build` projects and indexes.
 */

export interface SearchBuildOutput {
  readonly json: string;
  readonly documents: number;
  readonly terms: number;
}

function projectionInput(content: ContentBuildOutput): ProjectionInput {
  const artifact = parseDocumentationArtifact(content.documentationJson);
  const pages: readonly ContentPage[] =
    content.contentJson === undefined
      ? []
      : parseContentArtifact(content.contentJson).pages;
  const navigation: NavigationArtifact | undefined =
    content.navigationJson === undefined
      ? undefined
      : parseNavigationArtifact(content.navigationJson);
  return { artifact, navigation, pages };
}

/** Number of search documents the project would produce. */
export function countSearchDocuments(content: ContentBuildOutput): number {
  return projectSearchDocuments(projectionInput(content)).documents.length;
}

export function buildSearchArtifact(
  content: ContentBuildOutput,
): SearchBuildOutput {
  const built = buildSearch(projectionInput(content));
  return {
    documents: built.statistics.documents,
    json: built.json,
    terms: built.statistics.terms,
  };
}
