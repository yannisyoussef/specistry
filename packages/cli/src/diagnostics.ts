import type { Diagnostic, DiagnosticCode } from "./contracts.js";

const messages: Readonly<Record<DiagnosticCode, string>> = {
  CANCELLED: "Validation was cancelled.",
  CONFIG_INVALID: "The configuration does not match schema version 1.",
  CONFIG_LOAD_FAILED: "The trusted configuration could not be evaluated.",
  CONFIG_NOT_FOUND: "No specra.config.ts file was found at the project root.",
  CONFIG_NOT_SERIALIZABLE:
    "The configuration must contain only bounded JSON-serializable data.",
  CONFIG_PATH_INVALID:
    "The configured path does not have the required file or directory type.",
  CONFIG_PATH_NOT_FOUND: "The configured project path does not exist.",
  CONFIG_PATH_OUTSIDE_ROOT:
    "The configured path resolves outside the project root.",
  CONFIG_TIMEOUT: "Configuration evaluation exceeded the allowed time.",
  CONFIG_UNSUPPORTED: "The configuration schema version is not supported.",
  INTERNAL_ERROR:
    "Specra could not complete validation due to an internal error.",
  PROJECT_ROOT_INVALID:
    "The project root must resolve to an accessible directory.",
};

export function createDiagnostic(
  code: DiagnosticCode,
  path?: string,
): Diagnostic {
  return path === undefined
    ? { code, message: messages[code], severity: "error" }
    : { code, message: messages[code], path, severity: "error" };
}

export function sortDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const pathOrder = compareCodeUnits(left.path ?? "", right.path ?? "");
    if (pathOrder !== 0) return pathOrder;
    return compareCodeUnits(left.code, right.code);
  });
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
