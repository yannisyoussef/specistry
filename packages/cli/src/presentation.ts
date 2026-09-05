import {
  ARTIFACT_DIRECTORY,
  type BuildResult,
  type Diagnostic,
  type ValidationResult,
} from "./contracts.js";

export const ROOT_HELP = `Specra — deterministic developer documentation tooling

Usage:
  specra <command> [options]

Commands:
  validate   Validate configuration, project paths, and OpenAPI sources
  build      Validate and write the canonical documentation artifact

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
Build performs the same validation and then writes documentation.json and
manifest.json atomically to ${ARTIFACT_DIRECTORY}. A failed build removes any
previous artifact directory so stale output never represents the current input.

Exit codes: 0 success, 2 validation failure, 64 usage, 70 internal, 130 cancelled.
`;

export function formatHumanResult(
  result: BuildResult | ValidationResult,
  command: "build" | "validate" = "validate",
): string {
  if (!result.ok) {
    const lines = [
      command === "build" ? "Specra build failed" : "Specra validation failed",
      "",
      ...formatDiagnostics(result.diagnostics),
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
  ];
  if ("artifacts" in result) {
    lines.push(
      `Artifacts: ${result.artifacts.directory} (${result.artifacts.files.join(", ")}; ${result.artifacts.bytes} bytes)`,
    );
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

export function formatJsonResult(
  result: BuildResult | ValidationResult,
): string {
  const diagnostics = result.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
    severity: diagnostic.severity,
  }));
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
        diagnostics,
        ok: true,
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
  const path =
    diagnostic.path === undefined
      ? ""
      : ` [${sanitizeTerminal(diagnostic.path)}]`;
  const severity = diagnostic.severity === "warning" ? "warning " : "";
  return `${severity}${diagnostic.code}${path}`;
}
