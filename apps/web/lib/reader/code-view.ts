import type { JsonValue } from "@specistry/model";
import {
  generateAll,
  jsonLines,
  operationKey,
  PROTOCOL_LANGUAGE_LABELS,
  type SdkDeclaration,
  type SdkExample,
  type SelectionOption,
  type Snippet,
  type SnippetToken,
} from "@specistry/snippets";

import type { ReaderSnippets } from "./artifact";
import type { OperationView } from "./operation-view";

/**
 * The Code rail's data (SPEC-008): six protocol examples generated on the
 * server from the operation's request projection for the selected
 * environment, body media type, and security alternative, plus the
 * consumer's authored SDK examples for the operation. Selections are URL
 * query state (`env`, `body`, `auth`) validated here against strict
 * grammars; anything unknown falls back to the default rather than being
 * echoed. Generation is memoized per artifact digest so a hot operation
 * page never re-runs the generators.
 */

export interface CodeOption {
  readonly id: string;
  readonly label: string;
  readonly group: "protocol" | "sdk";
  /** Package or language line shown in the panel header. */
  readonly detail?: string;
}

export interface CodePanel {
  readonly option: CodeOption;
  readonly code: string;
  readonly lines: readonly (readonly SnippetToken[])[];
  readonly title?: string;
  readonly description?: string;
}

export interface CodeField {
  readonly name: "auth" | "body" | "env";
  readonly label: string;
  readonly options: readonly SelectionOption[];
  readonly selected: string;
}

export interface CodeResponseExample {
  readonly status: string;
  readonly lines: readonly (readonly SnippetToken[])[];
  readonly truncated: boolean;
}

export interface CodeView {
  readonly panels: readonly CodePanel[];
  readonly options: readonly CodeOption[];
  /** Environment, body, and auth selectors; empty when there is one choice. */
  readonly fields: readonly CodeField[];
  /** Whether any selection differs from the default (search engines skip it). */
  readonly customized: boolean;
  /** Query string of the current selection, for links that must keep it. */
  readonly query: string;
  readonly response?: CodeResponseExample;
  readonly sdks: readonly SdkDeclaration[];
}

const ENVIRONMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const MEDIA_TYPE =
  /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}(?:;[a-z0-9!#$&^_.+=-]{1,64}){0,4}$/;
const AUTH = /^\d{1,2}$/;
const MAX_CACHE_ENTRIES = 500;
const MAX_RESPONSE_EXAMPLE_CHARACTERS = 4_000;

export interface CodeQuery {
  readonly env?: string | string[] | undefined;
  readonly body?: string | string[] | undefined;
  readonly auth?: string | string[] | undefined;
}

function single(
  value: string | string[] | undefined,
  grammar: RegExp,
): string | undefined {
  return typeof value === "string" && grammar.test(value) ? value : undefined;
}

const cache = new Map<string, CodeView>();

export function createCodeView(
  snippets: ReaderSnippets,
  view: OperationView,
  query: CodeQuery,
): CodeView | undefined {
  const key = operationKey(view.service.id, view.summary.id);
  const projection = Object.hasOwn(snippets.artifact.operations, key)
    ? snippets.artifact.operations[key]
    : undefined;
  if (projection === undefined) return undefined;
  const selection = {
    auth: single(query.auth, AUTH),
    body: single(query.body, MEDIA_TYPE),
    environment: single(query.env, ENVIRONMENT),
  };
  const cacheKey = JSON.stringify([
    snippets.sha256,
    key,
    selection.environment ?? "",
    selection.body ?? "",
    selection.auth ?? "",
  ]);
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const generated = generateAll(
    projection,
    snippets.artifact.environments,
    selection,
  );
  const protocolPanels: CodePanel[] = generated.snippets.map((snippet) => ({
    code: snippet.code,
    lines: snippet.lines,
    option: protocolOption(snippet),
  }));
  const examples = Object.hasOwn(snippets.artifact.sdkExamples, key)
    ? (snippets.artifact.sdkExamples[key] ?? [])
    : [];
  const sdkPanels = examples.flatMap((example) =>
    sdkPanel(example, snippets.artifact.sdks),
  );
  const panels = [...protocolPanels, ...sdkPanels];

  const defaults = generateAll(projection, snippets.artifact.environments, {});
  const fields: CodeField[] = [];
  if (generated.environments.length > 1) {
    fields.push({
      label: "Environment",
      name: "env",
      options: generated.environments,
      selected: generated.selected.environment,
    });
  }
  if (generated.bodies.length > 1 && generated.selected.body !== undefined) {
    fields.push({
      label: "Body format",
      name: "body",
      options: generated.bodies,
      selected: generated.selected.body,
    });
  }
  if (generated.auths.length > 1 && generated.selected.auth !== undefined) {
    fields.push({
      label: "Authentication",
      name: "auth",
      options: generated.auths,
      selected: generated.selected.auth,
    });
  }
  const customized =
    generated.selected.environment !== defaults.selected.environment ||
    generated.selected.body !== defaults.selected.body ||
    generated.selected.auth !== defaults.selected.auth;
  const parameters = new URLSearchParams();
  for (const field of fields) {
    if (
      (field.name === "env" &&
        field.selected !== defaults.selected.environment) ||
      (field.name === "body" && field.selected !== defaults.selected.body) ||
      (field.name === "auth" && field.selected !== defaults.selected.auth)
    ) {
      parameters.set(field.name, field.selected);
    }
  }
  const response = responseExample(view);
  const result: CodeView = {
    customized,
    fields,
    options: panels.map((panel) => panel.option),
    panels,
    query: parameters.toString(),
    ...(response === undefined ? {} : { response }),
    sdks: snippets.artifact.sdks,
  };
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, result);
  return result;
}

/** Clears the generation cache; used by tests that switch artifacts. */
export function resetCodeViewCache(): void {
  cache.clear();
}

function protocolOption(snippet: Snippet): CodeOption {
  return {
    group: "protocol",
    id: snippet.language,
    label: PROTOCOL_LANGUAGE_LABELS[snippet.language],
  };
}

function sdkPanel(
  example: SdkExample,
  sdks: readonly SdkDeclaration[],
): CodePanel[] {
  const sdk = sdks.find((candidate) => candidate.id === example.sdk);
  if (sdk === undefined) return [];
  return [
    {
      code: example.code,
      ...(example.description === undefined
        ? {}
        : { description: example.description }),
      lines: example.lines,
      option: {
        ...(sdk.package === undefined ? {} : { detail: sdk.package }),
        group: "sdk",
        id: `sdk-${sdk.id}`,
        label: sdk.label,
      },
      ...(example.title === undefined ? {} : { title: example.title }),
    },
  ];
}

/**
 * The contract's own example for the first success response, as static
 * documentation data (never a live response). Bounded like the page's
 * example blocks.
 */
function responseExample(view: OperationView): CodeResponseExample | undefined {
  for (const response of view.responses) {
    if (!/^2/.test(response.statusLabel)) continue;
    for (const media of response.media) {
      const example = media.examples.find(
        (candidate) => candidate.json !== undefined,
      );
      if (example?.json === undefined) continue;
      if (example.truncated) {
        return {
          lines: example.json
            .split("\n")
            .map((text) => (text.length === 0 ? [] : [{ text }])),
          status: response.statusLabel,
          truncated: true,
        };
      }
      try {
        const value = JSON.parse(example.json) as JsonValue;
        return {
          lines: jsonLines(value),
          status: response.statusLabel,
          truncated: example.json.length > MAX_RESPONSE_EXAMPLE_CHARACTERS,
        };
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  return undefined;
}
