import type { DocumentationArtifact } from "@specra/model";
import { operationKey, type SnippetsArtifact } from "@specra/snippets";

import {
  isLoopbackOrigin,
  originOf,
  parsePlaygroundArtifact,
  parsePlaygroundArtifactValue,
  PlaygroundArtifactError,
  serializePlaygroundArtifact,
} from "./artifact.js";
import { projectOperationForm } from "./form.js";
import {
  CAPABILITY_MESSAGES,
  FORBIDDEN_REQUEST_HEADERS,
  isForbiddenRequestHeader,
  PLAYGROUND_ARTIFACT_FILENAME,
  PLAYGROUND_FORMAT_VERSION,
  PLAYGROUND_HARD_LIMITS,
  type AuthAlternativeForm,
  type AuthSchemeForm,
  type BodyFieldForm,
  type BodyForm,
  type CapabilityReason,
  type CapabilityState,
  type FieldKind,
  type OperationCapability,
  type OperationForm,
  type ParameterField,
  type PlaygroundArtifact,
  type PlaygroundEnvironment,
  type PlaygroundLimits,
} from "./types.js";

/**
 * `@specra/playground` build entry (SPEC-009): the form projection and
 * capability analysis of every operation, the exact-origin environment
 * policy, and the strict artifact contract. This entry runs in the CLI and
 * the reader server; the browser loads `./client` only.
 */

export {
  CAPABILITY_MESSAGES,
  FORBIDDEN_REQUEST_HEADERS,
  isForbiddenRequestHeader,
  isLoopbackOrigin,
  originOf,
  parsePlaygroundArtifact,
  parsePlaygroundArtifactValue,
  PLAYGROUND_ARTIFACT_FILENAME,
  PLAYGROUND_FORMAT_VERSION,
  PLAYGROUND_HARD_LIMITS,
  PlaygroundArtifactError,
  projectOperationForm,
  serializePlaygroundArtifact,
};
export type {
  AuthAlternativeForm,
  AuthSchemeForm,
  BodyFieldForm,
  BodyForm,
  CapabilityReason,
  CapabilityState,
  FieldKind,
  OperationCapability,
  OperationForm,
  ParameterField,
  PlaygroundArtifact,
  PlaygroundEnvironment,
  PlaygroundLimits,
};

export interface PlaygroundPolicyInput {
  readonly artifact: DocumentationArtifact;
  readonly snippets: SnippetsArtifact;
  /** Configured environment ids approved for execution (config `playground.environments`). */
  readonly approved: readonly string[];
  readonly enabled: boolean;
  readonly responseLimitBytes: number;
  readonly timeoutMs: number;
}

export interface PlaygroundPolicyDiagnostic {
  readonly code:
    | "PLAYGROUND_ENVIRONMENT_NOT_FOUND"
    | "PLAYGROUND_ENVIRONMENT_ORIGIN_INVALID"
    | "PLAYGROUND_OPERATION_UNSUPPORTED";
  /** Environment id or operation key. */
  readonly subject: string;
}

export interface PlaygroundPolicy {
  readonly artifact: PlaygroundArtifact;
  readonly diagnostics: readonly PlaygroundPolicyDiagnostic[];
}

/**
 * Projects the whole playground policy from the canonical and snippets
 * artifacts. Every approved environment must resolve to an exact origin;
 * operations are projected whether or not they are executable so the
 * reader can explain why one is not.
 */
export function projectPlayground(
  input: PlaygroundPolicyInput,
): PlaygroundPolicy {
  const diagnostics: PlaygroundPolicyDiagnostic[] = [];
  const environments: PlaygroundEnvironment[] = [];
  for (const id of input.approved) {
    const configured = input.snippets.environments.find(
      (environment) => environment.id === id,
    );
    if (configured === undefined) {
      diagnostics.push({
        code: "PLAYGROUND_ENVIRONMENT_NOT_FOUND",
        subject: id,
      });
      continue;
    }
    const origin = originOf(configured.baseUrl);
    if (origin === undefined) {
      diagnostics.push({
        code: "PLAYGROUND_ENVIRONMENT_ORIGIN_INVALID",
        subject: id,
      });
      continue;
    }
    environments.push({
      baseUrl: configured.baseUrl,
      id,
      label: configured.label,
      loopback: isLoopbackOrigin(origin),
      origin,
    });
  }
  const enabled = input.enabled && environments.length > 0;
  const limits: PlaygroundLimits = {
    ...PLAYGROUND_HARD_LIMITS,
    responseBytes: Math.min(
      input.responseLimitBytes,
      PLAYGROUND_HARD_LIMITS.responseBytes,
    ),
    timeoutMs: Math.min(input.timeoutMs, PLAYGROUND_HARD_LIMITS.timeoutMs),
  };
  const operations: Record<string, OperationForm> = {};
  for (const version of input.artifact.model.versions) {
    for (const service of version.services) {
      for (const operation of service.operations) {
        const key = operationKey(service.id, operation.id);
        const projection = Object.hasOwn(input.snippets.operations, key)
          ? input.snippets.operations[key]
          : undefined;
        if (projection === undefined) continue;
        const form = projectOperationForm(service, operation, projection);
        operations[key] = form;
        if (enabled && form.capability.state === "unsupported") {
          diagnostics.push({
            code: "PLAYGROUND_OPERATION_UNSUPPORTED",
            subject: key,
          });
        }
      }
    }
  }
  return {
    artifact: {
      enabled,
      environments,
      limits,
      operations,
      playgroundVersion: 1,
    },
    diagnostics,
  };
}
