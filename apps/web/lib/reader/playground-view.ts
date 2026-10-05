import {
  CAPABILITY_MESSAGES,
  type OperationForm,
  type PlaygroundEnvironment,
  type PlaygroundLimits,
} from "@specra/playground";
import { operationKey } from "@specra/snippets";

import type { ReaderPlayground } from "./artifact";
import type { OperationView } from "./operation-view";

/**
 * Props of the Try it island (SPEC-009): the approved environments, the
 * operation's bounded form projection, the limits, and human explanations
 * for whatever the browser cannot execute. Everything is data from the
 * digest-checked artifact; nothing here holds a value the user typed.
 */
export interface PlaygroundView {
  readonly operationKey: string;
  readonly environments: readonly PlaygroundEnvironment[];
  readonly form: OperationForm;
  readonly limits: PlaygroundLimits;
  /** Explanations for an unsupported operation, in reason order. */
  readonly unsupported: readonly string[];
  /** The alternatives the browser cannot use, with their explanations. */
  readonly unavailableAuth: readonly {
    readonly label: string;
    readonly reason: string;
  }[];
}

export function createPlaygroundView(
  playground: ReaderPlayground | undefined,
  view: OperationView,
): PlaygroundView | undefined {
  if (playground === undefined || !playground.artifact.enabled)
    return undefined;
  const key = operationKey(view.service.id, view.summary.id);
  const form = Object.hasOwn(playground.artifact.operations, key)
    ? playground.artifact.operations[key]
    : undefined;
  if (form === undefined) return undefined;
  return {
    environments: playground.artifact.environments,
    form,
    limits: playground.artifact.limits,
    operationKey: key,
    unavailableAuth: form.auth
      .filter((alternative) => !alternative.supported)
      .map((alternative) => ({
        label: alternative.label,
        reason: alternative.schemes
          .filter((scheme) => !scheme.supported && scheme.reason !== undefined)
          .map(
            (scheme) => CAPABILITY_MESSAGES[scheme.reason ?? "no-environment"],
          )
          .join(" "),
      })),
    unsupported: form.capability.reasons.map(
      (reason) => CAPABILITY_MESSAGES[reason],
    ),
  };
}
