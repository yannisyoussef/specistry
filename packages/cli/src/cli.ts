import { parseArguments } from "./arguments.js";
import { EXIT_CODES, type ValidationResult } from "./contracts.js";
import { validateProject } from "./orchestrator.js";
import {
  formatHumanResult,
  formatJsonResult,
  formatUsageError,
  ROOT_HELP,
  VALIDATE_HELP,
} from "./presentation.js";

export interface CliIo {
  readonly cwd: string;
  readonly signal: AbortSignal;
  readonly stderr: { write(value: string): unknown };
  readonly stdout: { write(value: string): unknown };
}

export async function runCli(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  const parsed = parseArguments(args);
  switch (parsed.kind) {
    case "root-help":
      io.stdout.write(ROOT_HELP);
      return EXIT_CODES.success;
    case "validate-help":
      io.stdout.write(VALIDATE_HELP);
      return EXIT_CODES.success;
    case "usage-error":
      io.stderr.write(formatUsageError(parsed.message));
      return EXIT_CODES.usage;
    case "validate": {
      const result = await validateProject({
        configTimeoutMs: parsed.configTimeoutMs,
        cwd: io.cwd,
        root: parsed.root,
        signal: io.signal,
      });
      if (parsed.json) io.stdout.write(formatJsonResult(result));
      else if (result.ok) io.stdout.write(formatHumanResult(result));
      else io.stderr.write(formatHumanResult(result));
      return exitCode(result);
    }
  }
}

function exitCode(result: ValidationResult): number {
  switch (result.outcome) {
    case "success":
      return EXIT_CODES.success;
    case "validation-failure":
      return EXIT_CODES.validationFailure;
    case "internal-failure":
      return EXIT_CODES.internalFailure;
    case "cancelled":
      return EXIT_CODES.cancelled;
  }
}
