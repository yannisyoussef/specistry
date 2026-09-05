import {
  ARTIFACT_DIRECTORY,
  type Diagnostic,
  type ValidationResult,
} from "./contracts.js";

export const ROOT_HELP = `Specra — deterministic developer documentation tooling

Usage:
  specra <command> [options]

Commands:
  validate   Validate Specra configuration and project paths

Run 'specra validate --help' for command options.
`;

export const VALIDATE_HELP = `Validate Specra configuration and project paths

Usage:
  specra validate [options]

Options:
  --root <path>                 Project root (default: current directory)
  --json                        Emit one JSON result to stdout
  --config-timeout <milliseconds>
                                Trusted config timeout (default: 5000; range: 100-60000)
  -h, --help                    Show this help

Validation covers configuration, confined paths, and artifact policy. OpenAPI
semantic validation begins in SPEC-003 and is not performed by this command yet.

Exit codes: 0 success, 2 validation failure, 64 usage, 70 internal, 130 cancelled.
`;

export function formatHumanResult(result: ValidationResult): string {
  if (result.ok) {
    return [
      "Specra project configuration is valid.",
      `Project: ${sanitizeTerminal(result.context.config.name)}`,
      `Artifacts: ${ARTIFACT_DIRECTORY}`,
      "OpenAPI semantic validation is not part of this command yet.",
      "",
    ].join("\n");
  }
  const lines = ["Specra validation failed", ""];
  for (const diagnostic of result.diagnostics) {
    lines.push(
      formatDiagnostic(diagnostic),
      `  ${sanitizeTerminal(diagnostic.message)}`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function formatJsonResult(result: ValidationResult): string {
  const diagnostics = result.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
    severity: diagnostic.severity,
  }));
  const output = result.ok
    ? {
        artifacts: { directory: ARTIFACT_DIRECTORY },
        diagnostics,
        ok: true,
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
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
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

function formatDiagnostic(diagnostic: Diagnostic): string {
  const path =
    diagnostic.path === undefined
      ? ""
      : ` [${sanitizeTerminal(diagnostic.path)}]`;
  return `${diagnostic.code}${path}`;
}
