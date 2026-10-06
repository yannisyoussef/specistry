import { parseDocumentationArtifact } from "@specistry/model";
import {
  projectPlayground,
  serializePlaygroundArtifact,
} from "@specistry/playground";
import { parseSnippetsArtifact } from "@specistry/snippets";

import type { BuildContext, Diagnostic } from "./contracts.js";
import { artifactPath, configPath, createDiagnostic } from "./diagnostics.js";

/**
 * Playground policy build step (SPEC-009). Derived offline from the exact
 * canonical and snippets artifacts about to be published: the approved
 * environments become exact origins, every operation gets a bounded form
 * projection and a browser-capability verdict, and the limits are clamped
 * to the hard maximums. The build never contacts an environment.
 */

export interface PlaygroundBuildOutput {
  readonly json: string;
  readonly enabled: boolean;
  readonly environments: number;
  readonly operations: number;
  readonly diagnostics: readonly Diagnostic[];
}

export function buildPlayground(
  context: BuildContext,
  documentationJson: string,
  snippetsJson: string,
): PlaygroundBuildOutput {
  const artifact = parseDocumentationArtifact(documentationJson);
  const snippets = parseSnippetsArtifact(snippetsJson);
  const playground = context.config.playground;
  const policy = projectPlayground({
    approved: playground.environments,
    artifact,
    enabled: playground.mode === "browser",
    responseLimitBytes: playground.responseLimitBytes,
    snippets,
    timeoutMs: playground.timeoutMs,
  });
  const pointers = new Map<string, string>();
  artifact.model.versions.forEach((version, versionIndex) => {
    version.services.forEach((service, serviceIndex) => {
      service.operations.forEach((operation, operationIndex) => {
        pointers.set(
          `${service.id}~${operation.id}`,
          `/model/versions/${versionIndex}/services/${serviceIndex}/operations/${operationIndex}`,
        );
      });
    });
  });
  const diagnostics = policy.diagnostics.map((diagnostic) => {
    switch (diagnostic.code) {
      case "PLAYGROUND_ENVIRONMENT_NOT_FOUND":
      case "PLAYGROUND_ENVIRONMENT_ORIGIN_INVALID": {
        const index = playground.environments.indexOf(diagnostic.subject);
        return createDiagnostic(
          diagnostic.code,
          configPath(`playground.environments.${Math.max(index, 0)}`),
        );
      }
      case "PLAYGROUND_OPERATION_UNSUPPORTED":
        return createDiagnostic(
          diagnostic.code,
          artifactPath(pointers.get(diagnostic.subject) ?? ""),
        );
    }
  });
  return {
    diagnostics,
    enabled: policy.artifact.enabled,
    environments: policy.artifact.environments.length,
    json: serializePlaygroundArtifact(policy.artifact),
    operations: Object.keys(policy.artifact.operations).length,
  };
}
