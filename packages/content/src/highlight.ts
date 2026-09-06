import { createHighlighterCore, type HighlighterCore } from "@shikijs/core";
import { createJavaScriptRegexEngine } from "@shikijs/engine-javascript";

import type { CodeToken, CodeTokenClass } from "./types.js";

/**
 * Build-time syntax highlighting. Shiki runs with its pure-JavaScript regex
 * engine (no WebAssembly, no network) over a bounded grammar set that is
 * loaded once per process. Tokens are mapped to a small semantic class set
 * from their TextMate scopes, so the reader styles them with CSS classes and
 * never needs inline styles under the nonce policy or a client highlighter.
 */

/** Fence languages the build understands; aliases map onto one grammar. */
const LANGUAGES: Readonly<Record<string, string>> = {
  bash: "bash",
  console: "bash",
  cs: "csharp",
  csharp: "csharp",
  css: "css",
  diff: "diff",
  docker: "dockerfile",
  dockerfile: "dockerfile",
  go: "go",
  graphql: "graphql",
  html: "html",
  http: "http",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsx: "jsx",
  kotlin: "kotlin",
  kt: "kotlin",
  markdown: "markdown",
  md: "markdown",
  php: "php",
  py: "python",
  python: "python",
  rb: "ruby",
  ruby: "ruby",
  rs: "rust",
  rust: "rust",
  sh: "bash",
  shell: "bash",
  sql: "sql",
  swift: "swift",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

const PLAIN = new Set(["", "plain", "plaintext", "text", "txt"]);

/** Normalizes a fence language; `undefined` means plain text. */
export function normalizeLanguage(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const key = raw.trim().toLowerCase();
  if (PLAIN.has(key)) return undefined;
  return LANGUAGES[key];
}

export function isSupportedLanguage(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const key = raw.trim().toLowerCase();
  return PLAIN.has(key) || key in LANGUAGES;
}

/**
 * Grammar loaders with literal specifiers: the set is closed at build time,
 * so a fence language can never select an arbitrary module.
 */
const GRAMMAR_LOADERS: Readonly<Record<string, () => Promise<unknown>>> = {
  bash: () => import("@shikijs/langs/bash"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  diff: () => import("@shikijs/langs/diff"),
  dockerfile: () => import("@shikijs/langs/dockerfile"),
  go: () => import("@shikijs/langs/go"),
  graphql: () => import("@shikijs/langs/graphql"),
  html: () => import("@shikijs/langs/html"),
  http: () => import("@shikijs/langs/http"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  markdown: () => import("@shikijs/langs/markdown"),
  php: () => import("@shikijs/langs/php"),
  python: () => import("@shikijs/langs/python"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  sql: () => import("@shikijs/langs/sql"),
  swift: () => import("@shikijs/langs/swift"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
};

let highlighterPromise: Promise<HighlighterCore> | undefined;

/** The shared highlighter, created on first use with every grammar loaded. */
export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine({ forgiving: true }),
    langs: Object.values(GRAMMAR_LOADERS).map(
      (load) => load() as Promise<never>,
    ),
    themes: [import("@shikijs/themes/github-light") as Promise<never>],
  });
  return highlighterPromise;
}

interface ExplainedToken {
  readonly content: string;
  readonly explanation?: readonly {
    readonly content: string;
    readonly scopes: readonly { readonly scopeName: string }[];
  }[];
}

/**
 * Highlights code into lines of semantic tokens. Unknown languages and any
 * grammar failure fall back to unstyled lines, never to a build failure.
 */
export async function highlightCode(
  code: string,
  language: string | undefined,
): Promise<readonly (readonly CodeToken[])[]> {
  if (language === undefined) return plainLines(code);
  try {
    const highlighter = await getHighlighter();
    const lines = highlighter.codeToTokensBase(code, {
      includeExplanation: true,
      lang: language,
      theme: "github-light",
    }) as readonly (readonly ExplainedToken[])[];
    return lines.map((line) => mergeTokens(line.flatMap(classify)));
  } catch {
    return plainLines(code);
  }
}

function plainLines(code: string): readonly (readonly CodeToken[])[] {
  return code.split("\n").map((text) => (text.length === 0 ? [] : [{ text }]));
}

function classify(token: ExplainedToken): CodeToken[] {
  if (token.explanation === undefined || token.explanation.length === 0) {
    return token.content.length === 0 ? [] : [{ text: token.content }];
  }
  return token.explanation.flatMap((part) => {
    if (part.content.length === 0) return [];
    const cls = classOf(part.scopes.map((scope) => scope.scopeName));
    return [
      cls === undefined ? { text: part.content } : { cls, text: part.content },
    ];
  });
}

/** Most specific scope first; the first rule that matches wins. */
function classOf(scopes: readonly string[]): CodeTokenClass | undefined {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const scope = scopes[index] ?? "";
    for (const [prefix, cls] of RULES) {
      if (scope === prefix || scope.startsWith(`${prefix}.`)) return cls;
    }
  }
  return undefined;
}

const RULES: readonly (readonly [string, CodeTokenClass])[] = [
  ["comment", "cmt"],
  ["punctuation.definition.comment", "cmt"],
  ["string", "str"],
  ["punctuation.definition.string", "str"],
  ["constant.numeric", "num"],
  ["constant.language", "kw"],
  ["constant.character.escape", "str"],
  ["keyword", "kw"],
  ["storage", "kw"],
  ["entity.name.function", "fn"],
  ["support.function", "fn"],
  ["entity.name.type", "type"],
  ["entity.name.class", "type"],
  ["support.type", "type"],
  ["support.class", "type"],
  ["entity.name.tag", "tag"],
  ["punctuation.definition.tag", "tag"],
  ["entity.other.attribute-name", "attr"],
  ["variable.parameter", "var"],
  ["variable.other.property", "var"],
  ["support.type.property-name", "attr"],
  ["meta.object-literal.key", "attr"],
  ["variable", "var"],
  ["markup.heading", "kw"],
  ["markup.bold", "kw"],
  ["markup.inserted", "str"],
  ["markup.deleted", "kw"],
];

function mergeTokens(tokens: readonly CodeToken[]): CodeToken[] {
  const merged: CodeToken[] = [];
  for (const token of tokens) {
    const last = merged.at(-1);
    if (last !== undefined && last.cls === token.cls) {
      merged[merged.length - 1] = { ...last, text: last.text + token.text };
    } else {
      merged.push(token);
    }
  }
  return merged;
}
