import { parseArguments } from "./arguments.js";
import {
  EXIT_CODES,
  type BuildResult,
  type CatalogResult,
  type ReleaseResult,
  type ValidationResult,
} from "./contracts.js";
import { buildProject, validateProject } from "./orchestrator.js";
import {
  BUILD_HELP,
  COMMAND_HELP,
  formatHumanResult,
  formatJsonResult,
  formatUsageError,
  ROOT_HELP,
} from "./presentation.js";
import {
  deprecateRelease,
  releaseProject,
  selectCurrentRelease,
} from "./release.js";

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
      io.stdout.write(COMMAND_HELP[parsed.command] ?? BUILD_HELP);
      return EXIT_CODES.success;
    case "usage-error":
      io.stderr.write(formatUsageError(parsed.message));
      return EXIT_CODES.usage;
    case "command": {
      const options = {
        configTimeoutMs: parsed.configTimeoutMs,
        cwd: io.cwd,
        ...(parsed.from === undefined ? {} : { from: parsed.from }),
        root: parsed.root,
        signal: io.signal,
        sourceTimeoutMs: parsed.sourceTimeoutMs,
      };
      const result = await run(parsed, options);
      if (parsed.json) io.stdout.write(formatJsonResult(result));
      else if (result.ok) {
        io.stdout.write(formatHumanResult(result, parsed.command));
      } else io.stderr.write(formatHumanResult(result, parsed.command));
      return exitCode(result);
    }
  }
}

type CommandResult =
  BuildResult | CatalogResult | ReleaseResult | ValidationResult;

async function run(
  parsed: Extract<ReturnType<typeof parseArguments>, { kind: "command" }>,
  options: {
    readonly configTimeoutMs: number;
    readonly cwd: string;
    readonly from?: string;
    readonly root: string;
    readonly signal: AbortSignal;
    readonly sourceTimeoutMs: number;
  },
): Promise<CommandResult> {
  switch (parsed.command) {
    case "build":
      return await buildProject(options);
    case "validate":
      return await validateProject(options);
    case "release":
      return await releaseProject({
        ...options,
        current: parsed.current,
        ...(parsed.date === undefined ? {} : { date: parsed.date }),
        ...(parsed.label === undefined ? {} : { label: parsed.label }),
        noDiff: parsed.noDiff,
        version: parsed.version ?? "",
      });
    case "current":
      return await selectCurrentRelease({
        ...options,
        version: parsed.version ?? "",
      });
    case "deprecate":
      return await deprecateRelease({
        ...options,
        version: parsed.version ?? "",
      });
  }
}

function exitCode(result: CommandResult): number {
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
