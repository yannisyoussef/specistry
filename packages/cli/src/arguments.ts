import {
  DEFAULT_CONFIG_TIMEOUT_MS,
  DEFAULT_SOURCE_TIMEOUT_MS,
  MAX_CONFIG_TIMEOUT_MS,
  MAX_SOURCE_TIMEOUT_MS,
  MIN_CONFIG_TIMEOUT_MS,
  MIN_SOURCE_TIMEOUT_MS,
} from "./contracts.js";

export type CommandName = "build" | "validate";

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
    };

const COMMANDS = new Set<CommandName>(["build", "validate"]);
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
    return usage(
      argument?.startsWith("-") ? "Unknown option." : "Unexpected argument.",
    );
  }

  return {
    command,
    configTimeoutMs,
    json,
    kind: "command",
    root,
    sourceTimeoutMs,
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
