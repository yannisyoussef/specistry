import { parseArguments } from "./arguments.js";
import {
  EXIT_CODES,
  type BuildResult,
  type ValidationResult,
} from "./contracts.js";
import { buildProject, validateProject } from "./orchestrator.js";
import {
  BUILD_HELP,
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
    case "command-help":
      io.stdout.write(parsed.command === "build" ? BUILD_HELP : VALIDATE_HELP);
      return EXIT_CODES.success;
    case "usage-error":
      io.stderr.write(formatUsageError(parsed.message));
      return EXIT_CODES.usage;
    case "command": {
      const options = {
        configTimeoutMs: parsed.configTimeoutMs,
        cwd: io.cwd,
        root: parsed.root,
        signal: io.signal,
        sourceTimeoutMs: parsed.sourceTimeoutMs,
      };
      const result =
        parsed.command === "build"
          ? await buildProject(options)
          : await validateProject(options);
      if (parsed.json) io.stdout.write(formatJsonResult(result));
      else if (result.ok) {
        io.stdout.write(formatHumanResult(result, parsed.command));
      } else io.stderr.write(formatHumanResult(result, parsed.command));
      return exitCode(result);
    }
  }
}

function exitCode(result: BuildResult | ValidationResult): number {
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
