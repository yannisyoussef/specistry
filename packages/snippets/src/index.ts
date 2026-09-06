import type { DocumentationArtifact } from "@specra/model";

import {
  parseSnippetsArtifact,
  parseSnippetsArtifactValue,
  serializeSnippetsArtifact,
  SnippetsArtifactError,
} from "./artifact.js";
import { exampleFor, sanitizeExample } from "./example.js";
import {
  generateAll,
  generateSnippet,
  jsonLines,
  type GeneratedSet,
} from "./generate.js";
import {
  projectBody,
  projectOperation,
  type OperationProjection,
  type ProjectionDiagnostic,
} from "./projection.js";
import {
  environmentsFor,
  resolveRequest,
  type ResolvedSelection,
  type Selection,
  type SelectionOption,
} from "./resolve.js";
import {
  isSensitiveName,
  looksLikeSecret,
  placeholderFor,
  sanitizeLine,
  sanitizeText,
  secretPlaceholderFor,
} from "./sanitize.js";
import {
  PLACEHOLDERS,
  PROTOCOL_LANGUAGE_LABELS,
  PROTOCOL_LANGUAGES,
  SNIPPET_LIMITS,
  SNIPPETS_ARTIFACT_FILENAME,
  SNIPPETS_FORMAT_VERSION,
  type AuthAlternative,
  type AuthSchemeKind,
  type AuthSchemeProjection,
  type BodyKind,
  type BodyProjection,
  type EnvironmentProjection,
  type FormField,
  type Pair,
  type ProtocolLanguage,
  type RequestProjection,
  type ResolvedRequest,
  type SdkDeclaration,
  type SdkExample,
  type Snippet,
  type SnippetsArtifact,
  type SnippetToken,
  type SnippetTokenClass,
} from "./types.js";
import {
  renderPathTemplate,
  serializeCookieParameter,
  serializeHeaderParameter,
  serializePathParameter,
  serializeQueryParameter,
} from "./serialize.js";
import { validateBaseUrl } from "./url.js";

/**
 * `@specra/snippets`: pure protocol request projection and generation
 * (cURL, HTTP, JavaScript, TypeScript, Java, Python) from the canonical
 * model, plus the artifact contract that carries projections and authored
 * SDK examples to the reader. This package never infers SDK APIs, never
 * executes a request, and never reads the environment.
 */

export {
  environmentsFor,
  exampleFor,
  generateAll,
  generateSnippet,
  isSensitiveName,
  jsonLines,
  looksLikeSecret,
  parseSnippetsArtifact,
  parseSnippetsArtifactValue,
  PLACEHOLDERS,
  placeholderFor,
  projectBody,
  projectOperation,
  PROTOCOL_LANGUAGE_LABELS,
  PROTOCOL_LANGUAGES,
  resolveRequest,
  sanitizeExample,
  sanitizeLine,
  sanitizeText,
  secretPlaceholderFor,
  renderPathTemplate,
  serializeCookieParameter,
  serializeHeaderParameter,
  serializePathParameter,
  serializeQueryParameter,
  serializeSnippetsArtifact,
  SNIPPET_LIMITS,
  SNIPPETS_ARTIFACT_FILENAME,
  SNIPPETS_FORMAT_VERSION,
  SnippetsArtifactError,
  validateBaseUrl,
};
export type {
  AuthAlternative,
  AuthSchemeKind,
  AuthSchemeProjection,
  BodyKind,
  BodyProjection,
  EnvironmentProjection,
  FormField,
  GeneratedSet,
  OperationProjection,
  Pair,
  ProjectionDiagnostic,
  ProtocolLanguage,
  RequestProjection,
  ResolvedRequest,
  ResolvedSelection,
  SdkDeclaration,
  SdkExample,
  Selection,
  SelectionOption,
  Snippet,
  SnippetsArtifact,
  SnippetToken,
  SnippetTokenClass,
};

export interface ProjectedOperations {
  /** Keyed by `operationKey(serviceId, operationId)`. */
  readonly operations: Readonly<Record<string, RequestProjection>>;
  readonly diagnostics: readonly (ProjectionDiagnostic & {
    readonly key: string;
  })[];
}

/**
 * Artifact key of an operation. Contract operation ids are unique within a
 * service only (two services may both declare `listUsers`), so the key
 * carries the canonical service id as well.
 */
export function operationKey(serviceId: string, operationId: string): string {
  return `${serviceId}~${operationId}`;
}

/** Projects every operation of every service in a canonical artifact. */
export function projectArtifact(
  artifact: DocumentationArtifact,
): ProjectedOperations {
  const operations: Record<string, RequestProjection> = {};
  const diagnostics: (ProjectionDiagnostic & { readonly key: string })[] = [];
  for (const version of artifact.model.versions) {
    for (const service of version.services) {
      for (const operation of service.operations) {
        const projected = projectOperation(service, operation);
        const key = operationKey(service.id, operation.id);
        operations[key] = projected.projection;
        diagnostics.push(
          ...projected.diagnostics.map((diagnostic) => ({
            ...diagnostic,
            key,
          })),
        );
      }
    }
  }
  return { diagnostics, operations };
}
