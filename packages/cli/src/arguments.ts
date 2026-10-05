import {
  DEFAULT_CONFIG_TIMEOUT_MS,
  DEFAULT_SOURCE_TIMEOUT_MS,
  MAX_CONFIG_TIMEOUT_MS,
  MAX_SOURCE_TIMEOUT_MS,
  MIN_CONFIG_TIMEOUT_MS,
  MIN_SOURCE_TIMEOUT_MS,
} from "./contracts.js";

export type CommandName =
  "build" | "check" | "current" | "deprecate" | "diff" | "release" | "validate";

export type ParsedArguments =
  | { readonly kind: "root-help" }
  | { readonly kind: "usage-error"; readonly message: string }
  | { readonly command: CommandName; readonly kind: "command-help" }
  | {
      readonly command: CommandName;
      readonly configTimeoutMs: number;
      readonly json: boolean;
      readonly kind: "command";
      readonly root: string;
      readonly sourceTimeoutMs: number;
      /** Positional version id for `release`, `current`, and `deprecate`. */
      readonly version?: string;
      /** `--current` on `release`. */
      readonly current: boolean;
      /** `--from <source>` on `build`, `release`, `check`, and `diff`. */
      readonly from?: string;
      /** `--to <source>` on `diff`; defaults to the candidate build. */
      readonly to?: string;
      /** `--no-diff` on `release`. */
      readonly noDiff: boolean;
      readonly label?: string;
      readonly date?: string;
    };

const COMMANDS = new Set<CommandName>([
  "build",
  "check",
  "current",
  "deprecate",
  "diff",
  "release",
  "validate",
]);
/** Commands whose `--from` and `--to` accept `candidate`, `current`, or an id. */
const SOURCE_COMMANDS = new Set<CommandName>(["check", "diff"]);
const VERSION_COMMANDS = new Set<CommandName>([
  "current",
  "deprecate",
  "release",
]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HELP_FLAGS = new Set(["--help", "-h"]);

export function parseArguments(args: readonly string[]): ParsedArguments {
  if (args.length === 0) {
    return usage("A command is required.");
  }
  const first = args[0] ?? "";
  if (args.length === 1 && HELP_FLAGS.has(first)) {
    return { kind: "root-help" };
  }
  if (!COMMANDS.has(first as CommandName)) {
    return usage("Unknown command.");
  }
  const command = first as CommandName;
  if (args.slice(1).some((value) => HELP_FLAGS.has(value))) {
    return args.length === 2
      ? { command, kind: "command-help" }
      : usage("--help cannot be combined with other options.");
  }

  let configTimeoutMs = DEFAULT_CONFIG_TIMEOUT_MS;
  let sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS;
  let json = false;
  let root = ".";
  let sawRoot = false;
  let sawConfigTimeout = false;
  let sawSourceTimeout = false;
  let version: string | undefined;
  let current = false;
  let from: string | undefined;
  let noDiff = false;
  let label: string | undefined;
  let date: string | undefined;
  let to: string | undefined;

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      if (json) return usage("--json may be specified only once.");
      json = true;
      continue;
    }
    if (argument === "--root") {
      if (sawRoot) return usage("--root may be specified only once.");
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return usage("--root requires a path value.");
      }
      root = value;
      sawRoot = true;
      index += 1;
      continue;
    }
    if (argument === "--config-timeout") {
      if (sawConfigTimeout) {
        return usage("--config-timeout may be specified only once.");
      }
      const value = parseTimeout(
        args[index + 1],
        MIN_CONFIG_TIMEOUT_MS,
        MAX_CONFIG_TIMEOUT_MS,
      );
      if (typeof value === "string") return usage(`--config-timeout ${value}`);
      configTimeoutMs = value;
      sawConfigTimeout = true;
      index += 1;
      continue;
    }
    if (argument === "--source-timeout") {
      if (sawSourceTimeout) {
        return usage("--source-timeout may be specified only once.");
      }
      const value = parseTimeout(
        args[index + 1],
        MIN_SOURCE_TIMEOUT_MS,
        MAX_SOURCE_TIMEOUT_MS,
      );
      if (typeof value === "string") return usage(`--source-timeout ${value}`);
      sourceTimeoutMs = value;
      sawSourceTimeout = true;
      index += 1;
      continue;
    }
    if (argument === "--version") {
      if (command !== "check") {
        return usage("--version applies to check only.");
      }
      if (version !== undefined) {
        return usage("--version may be specified only once.");
      }
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return usage("--version requires a version id.");
      }
      version = value;
      index += 1;
      continue;
    }
    if (argument === "--to") {
      if (command !== "diff") return usage("--to applies to diff only.");
      if (to !== undefined) return usage("--to may be specified only once.");
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return usage("--to requires a source.");
      }
      to = value;
      index += 1;
      continue;
    }
    if (argument === "--current") {
      if (command !== "release")
        return usage("--current applies to release only.");
      if (current) return usage("--current may be specified only once.");
      current = true;
      continue;
    }
    if (argument === "--no-diff") {
      if (command !== "release")
        return usage("--no-diff applies to release only.");
      if (noDiff) return usage("--no-diff may be specified only once.");
      noDiff = true;
      continue;
    }
    if (argument === "--from") {
      if (
        command !== "release" &&
        command !== "build" &&
        !SOURCE_COMMANDS.has(command)
      ) {
        return usage("--from applies to build, release, check, and diff only.");
      }
      if (from !== undefined)
        return usage("--from may be specified only once.");
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return usage("--from requires a version id.");
      }
      from = value;
      index += 1;
      continue;
    }
    if (argument === "--label" || argument === "--date") {
      if (command !== "release")
        return usage(`${argument} applies to release only.`);
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return usage(`${argument} requires a value.`);
      }
      if (argument === "--label") {
        if (label !== undefined)
          return usage("--label may be specified only once.");
        if (value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
          return usage("--label is at most 80 characters of plain text.");
        }
        label = value;
      } else {
        if (date !== undefined)
          return usage("--date may be specified only once.");
        if (!DATE.test(value)) return usage("--date must be YYYY-MM-DD.");
        date = value;
      }
      index += 1;
      continue;
    }
    if (
      argument !== undefined &&
      !argument.startsWith("-") &&
      VERSION_COMMANDS.has(command) &&
      version === undefined
    ) {
      version = argument;
      continue;
    }
    return usage(
      argument?.startsWith("-") ? "Unknown option." : "Unexpected argument.",
    );
  }
  if (VERSION_COMMANDS.has(command) && version === undefined) {
    return usage(`${command} requires a version id.`);
  }
  if (command === "diff" && from === undefined) {
    return usage("diff requires --from <candidate|current|version>.");
  }
  if (noDiff && from !== undefined) {
    return usage("--no-diff and --from cannot be combined.");
  }

  return {
    command,
    configTimeoutMs,
    current,
    ...(date === undefined ? {} : { date }),
    ...(from === undefined ? {} : { from }),
    json,
    kind: "command",
    ...(label === undefined ? {} : { label }),
    noDiff,
    root,
    sourceTimeoutMs,
    ...(to === undefined ? {} : { to }),
    ...(version === undefined ? {} : { version }),
  };
}

function parseTimeout(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | string {
  if (value === undefined || !/^\d+$/.test(value)) {
    return "requires an integer millisecond value.";
  }
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    return `must be between ${minimum} and ${maximum} milliseconds.`;
  }
  return parsed;
}

function usage(message: string): ParsedArguments {
  return { kind: "usage-error", message };
}
