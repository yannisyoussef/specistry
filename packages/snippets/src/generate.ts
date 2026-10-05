import type { JsonValue } from "@specra/model";

import { writeJsonText } from "./escape.js";
import { generateCurl } from "./generators/curl.js";
import { generateHttp } from "./generators/http.js";
import { generateJava } from "./generators/java.js";
import { generateJavaScript } from "./generators/javascript.js";
import { generatePython } from "./generators/python.js";
import {
  resolveRequest,
  type ResolvedSelection,
  type Selection,
} from "./resolve.js";
import {
  PROTOCOL_LANGUAGES,
  type EnvironmentProjection,
  type ProtocolLanguage,
  type RequestProjection,
  type ResolvedRequest,
  type Snippet,
  type SnippetToken,
} from "./types.js";
import { Writer } from "./writer.js";

/** Pretty JSON as token lines, for contract examples shown beside the code. */
export function jsonLines(
  value: JsonValue,
): readonly (readonly SnippetToken[])[] {
  const writer = new Writer();
  writeJsonText(writer, value, "");
  return writer.finish("http").lines;
}

/**
 * Pure generation: a resolved request in, a snippet out. Given equal input
 * every generator returns identical text; nothing here has side effects.
 */
export function generateSnippet(
  request: ResolvedRequest,
  language: ProtocolLanguage,
): Snippet {
  switch (language) {
    case "curl":
      return generateCurl(request);
    case "http":
      return generateHttp(request);
    case "javascript":
      return generateJavaScript(request, false);
    case "typescript":
      return generateJavaScript(request, true);
    case "java":
      return generateJava(request);
    case "python":
      return generatePython(request);
  }
}

export interface GeneratedSet extends ResolvedSelection {
  readonly snippets: readonly Snippet[];
}

/** All six languages for one projection and selection, in presentation order. */
export function generateAll(
  projection: RequestProjection,
  environments: readonly EnvironmentProjection[],
  selection: Selection = {},
): GeneratedSet {
  const resolved = resolveRequest(projection, environments, selection);
  return {
    ...resolved,
    snippets: PROTOCOL_LANGUAGES.map((language) =>
      generateSnippet(resolved.request, language),
    ),
  };
}
