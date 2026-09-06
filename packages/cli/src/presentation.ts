import type { CommandName } from "./arguments.js";
import {
  ARTIFACT_DIRECTORY,
  type BuildResult,
  type CatalogResult,
  type Diagnostic,
  type ReleaseResult,
  type ValidationResult,
} from "./contracts.js";

type CommandResult =
  BuildResult | CatalogResult | ReleaseResult | ValidationResult;

export const ROOT_HELP = `Specra — deterministic developer documentation tooling

Usage:
  specra <command> [options]

Commands:
  validate   Validate configuration, project paths, and OpenAPI sources
  build      Validate and write the candidate documentation artifact
  release    Promote the candidate into an immutable documentation release
  current    Select the release the current aliases point to
  deprecate  Mark a retained release as deprecated

Run 'specra <command> --help' for command options.
`;

const COMMON_OPTIONS = `Options:
  --root <path>                 Project root (default: current directory)
  --json                        Emit one JSON result to stdout
  --config-timeout <milliseconds>
                                Trusted config timeout (default: 5000; range: 100-60000)
  --source-timeout <milliseconds>
                                OpenAPI ingestion timeout (default: 30000; range: 100-600000)
  -h, --help                    Show this help
`;

export const VALIDATE_HELP = `Validate configuration, project paths, and OpenAPI sources

Usage:
  specra validate [options]

${COMMON_OPTIONS}
Validation evaluates the trusted configuration, confines every configured path,
then parses, resolves, validates, and normalizes the OpenAPI 3.0/3.1 sources
into canonical model v1 without writing anything. Warnings do not fail the
command; errors do.

Exit codes: 0 success, 2 validation failure, 64 usage, 70 internal, 130 cancelled.
`;

export const BUILD_HELP = `Validate and write the canonical documentation artifact

Usage:
  specra build [options]

${COMMON_OPTIONS}
  --from <version>              Compare the candidate with this retained release
                                (default: the current release, when one exists)

Build performs the same validation and then writes documentation.json,
manifest.json, search.json, snippets.json, playground.json, and any content artifacts
atomically to ${ARTIFACT_DIRECTORY}. A failed build removes any
previous artifact directory so stale output never represents the current input.
The artifact is a mutable candidate: rebuild as often as you like. When the
project has released versions, build also writes structured diff candidates to
.specra/candidates/diff.json for changelog review; they are never served.

Exit codes: 0 success, 2 validation failure, 64 usage, 70 internal, 130 cancelled.
`;

export const RELEASE_HELP = `Promote the candidate artifact into an immutable documentation release

Usage:
  specra release <version> [options]

${COMMON_OPTIONS}
  --current                     Select the new release as current
  --from <version>              Compare with this retained release for the
                                changelog review (default: the current release)
  --no-diff                     Release without a comparison base
  --label <text>                Display label for the version selector
  --date <YYYY-MM-DD>           Author-provided release date

The version id is a documentation release identity (v1, v1.2, 2026-09): letters,
digits, dots, underscores, and hyphens, never a reserved name. Release verifies
the candidate in ${ARTIFACT_DIRECTORY} against its manifest, derives the route
table and the configured redirects, validates changelog/<version>.json against
the structured diff candidates, stages the exact bytes, and promotes them with
one atomic rename into .specra/releases/<version>. An identical release is an
idempotent no-op; a different one fails: releases are immutable. The first
release becomes current; later ones only with --current.

Exit codes: 0 success, 2 validation failure, 64 usage, 70 internal, 130 cancelled.
`;

export const CURRENT_HELP = `Select the release the current aliases point to

Usage:
  specra current <version> [options]

${COMMON_OPTIONS}
Rewrites only the catalog pointer under .specra/releases/catalog.json; no
release content changes. /, /docs, and /api redirect non-permanently to the
selected release, and pointing back to an older release is a documentation
rollback.

Exit codes: 0 success, 2 validation failure, 64 usage, 70 internal, 130 cancelled.
`;

export const DEPRECATE_HELP = `Mark a retained release as deprecated

Usage:
  specra deprecate <version> [options]

${COMMON_OPTIONS}
Sets the catalog lifecycle state; the reader labels the release and shows a
deprecation notice on its pages. The current release cannot be deprecated and
nothing is deleted.

Exit codes: 0 success, 2 validation failure, 64 usage, 70 internal, 130 cancelled.
`;

export const COMMAND_HELP: Readonly<Record<CommandName, string>> = {
  build: BUILD_HELP,
  current: CURRENT_HELP,
  deprecate: DEPRECATE_HELP,
  release: RELEASE_HELP,
  validate: VALIDATE_HELP,
};

const FAILURE_TITLES: Readonly<Record<CommandName, string>> = {
  build: "Specra build failed",
  current: "Specra current selection failed",
  deprecate: "Specra deprecation failed",
  release: "Specra release failed",
  validate: "Specra validation failed",
};

export function formatHumanResult(
  result: CommandResult,
  command: CommandName = "validate",
): string {
  if (!result.ok) {
    const lines = [
      FAILURE_TITLES[command],
      "",
      ...formatDiagnostics(result.diagnostics),
      "",
    ];
    return lines.join("\n");
  }
  if ("release" in result) {
    const { release } = result;
    const lines = [
      release.unchanged
        ? `Specra release ${sanitizeTerminal(release.version)} already exists with identical content; nothing changed.`
        : `Specra release ${sanitizeTerminal(release.version)} promoted.`,
      `Project: ${sanitizeTerminal(result.context.config.name)}`,
      `Release: ${release.directory} (${release.components.join(", ")}; ${release.bytes} bytes)`,
      `Identity: ${release.digest}`,
      `Current: ${sanitizeTerminal(release.current)}`,
      release.from === undefined
        ? "Diff candidates: none (no comparison base)"
        : `Diff candidates: ${release.candidates ?? 0} compared with ${sanitizeTerminal(release.from)}`,
      `Changelog: ${release.changelog ? "published" : "none"}`,
    ];
    if (result.diagnostics.length > 0) {
      lines.push(
        "",
        `Warnings (${result.diagnostics.length}):`,
        ...formatDiagnostics(result.diagnostics),
      );
    }
    lines.push("");
    return lines.join("\n");
  }
  if ("catalog" in result) {
    const { catalog } = result;
    const lines = [
      command === "deprecate"
        ? "Specra release deprecated."
        : "Specra current release selected.",
      `Current: ${sanitizeTerminal(catalog.current)}`,
      ...catalog.releases.map(
        (release) =>
          `  ${sanitizeTerminal(release.version)}${release.version === catalog.current ? " (current)" : ""} · ${release.state}${release.changelog ? " · changelog" : ""}`,
      ),
      "",
    ];
    return lines.join("\n");
  }
  const { statistics } = result.ingestion;
  const lines = [
    command === "build"
      ? "Specra build succeeded."
      : "Specra project is valid.",
    `Project: ${sanitizeTerminal(result.context.config.name)}`,
    `Sources: ${statistics.documents} document(s), ${statistics.operations} operation(s), ${statistics.schemas} schema(s)`,
    `Docs: ${result.content.pages} page(s), ${result.content.assets} asset(s)`,
    `Search: ${result.search.documents} document(s)`,
    `Code samples: ${result.snippets.operations} operation(s), ${result.snippets.sdkExamples} SDK example(s)`,
    `Playground: ${result.playground.enabled ? `enabled for ${result.playground.environments} environment(s)` : "disabled"}`,
  ];
  if ("artifacts" in result) {
    lines.push(
      `Artifacts: ${result.artifacts.directory} (${result.artifacts.files.join(", ")}; ${result.artifacts.bytes} bytes)`,
    );
    if (result.candidates !== undefined) {
      lines.push(
        `Diff candidates: ${result.candidates.count} compared with ${sanitizeTerminal(result.candidates.from)}${result.candidates.truncated ? " (truncated)" : ""} in .specra/candidates/diff.json`,
      );
    }
  } else {
    lines.push(`Artifacts: ${ARTIFACT_DIRECTORY}`);
  }
  if (result.diagnostics.length > 0) {
    lines.push(
      "",
      `Warnings (${result.diagnostics.length}):`,
      ...formatDiagnostics(result.diagnostics),
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function formatJsonResult(result: CommandResult): string {
  const diagnostics = result.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    ...(diagnostic.column === undefined ? {} : { column: diagnostic.column }),
    ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
    message: diagnostic.message,
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
    severity: diagnostic.severity,
  }));
  if (result.ok && "release" in result) {
    return `${JSON.stringify({ diagnostics, ok: true, release: result.release })}\n`;
  }
  if (result.ok && "catalog" in result) {
    return `${JSON.stringify({ catalog: result.catalog, diagnostics, ok: true })}\n`;
  }
  const output = result.ok
    ? {
        artifacts:
          "artifacts" in result
            ? {
                bytes: result.artifacts.bytes,
                directory: result.artifacts.directory,
                files: result.artifacts.files,
              }
            : { directory: ARTIFACT_DIRECTORY },
        ...("candidates" in result && result.candidates !== undefined
          ? { candidates: result.candidates }
          : {}),
        content: result.content,
        diagnostics,
        ok: true,
        playground: result.playground,
        search: result.search,
        snippets: result.snippets,
        sources: result.ingestion.sources,
        statistics: result.ingestion.statistics,
      }
    : { diagnostics, ok: false };
  return `${JSON.stringify(output)}\n`;
}

export function formatUsageError(message: string): string {
  return `Usage error: ${sanitizeTerminal(message)}\nRun 'specra --help' for usage.\n`;
}

export function sanitizeTerminal(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      /\p{Cf}/u.test(character)
    ) {
      result +=
        code <= 0xffff
          ? `\\u${code.toString(16).padStart(4, "0")}`
          : `\\u{${code.toString(16)}}`;
    } else {
      result += character;
    }
  }
  return result;
}

function formatDiagnostics(diagnostics: readonly Diagnostic[]): string[] {
  const lines: string[] = [];
  for (const diagnostic of diagnostics) {
    lines.push(
      formatDiagnostic(diagnostic),
      `  ${sanitizeTerminal(diagnostic.message)}`,
    );
  }
  return lines;
}

function formatDiagnostic(diagnostic: Diagnostic): string {
  const position =
    diagnostic.line === undefined
      ? ""
      : `:${diagnostic.line}${diagnostic.column === undefined ? "" : `:${diagnostic.column}`}`;
  const path =
    diagnostic.path === undefined
      ? ""
      : ` [${sanitizeTerminal(diagnostic.path)}${position}]`;
  const severity = diagnostic.severity === "warning" ? "warning " : "";
  return `${severity}${diagnostic.code}${path}`;
}
