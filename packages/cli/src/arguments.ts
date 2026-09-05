import {
  DEFAULT_CONFIG_TIMEOUT_MS,
  MAX_CONFIG_TIMEOUT_MS,
  MIN_CONFIG_TIMEOUT_MS,
} from "./contracts.js";

export type ParsedArguments =
  | { readonly kind: "root-help" }
  | { readonly kind: "usage-error"; readonly message: string }
  | { readonly kind: "validate-help" }
  | {
      readonly configTimeoutMs: number;
      readonly json: boolean;
      readonly kind: "validate";
      readonly root: string;
    };

export function parseArguments(args: readonly string[]): ParsedArguments {
  if (args.length === 0) {
    return usage("A command is required.");
  }
  if (args.length === 1 && new Set(["--help", "-h"]).has(args[0] ?? "")) {
    return { kind: "root-help" };
  }
  if (args[0] !== "validate") {
    return usage("Unknown command.");
  }
  if (args.slice(1).some((value) => new Set(["--help", "-h"]).has(value))) {
    return args.length === 2
      ? { kind: "validate-help" }
      : usage("--help cannot be combined with other options.");
  }

  let configTimeoutMs = DEFAULT_CONFIG_TIMEOUT_MS;
  let json = false;
  let root = ".";
  let sawRoot = false;
  let sawTimeout = false;

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
      if (sawTimeout) {
        return usage("--config-timeout may be specified only once.");
      }
      const value = args[index + 1];
      if (value === undefined || !/^\d+$/.test(value)) {
        return usage("--config-timeout requires an integer millisecond value.");
      }
      configTimeoutMs = Number(value);
      if (
        configTimeoutMs < MIN_CONFIG_TIMEOUT_MS ||
        configTimeoutMs > MAX_CONFIG_TIMEOUT_MS
      ) {
        return usage(
          `--config-timeout must be between ${MIN_CONFIG_TIMEOUT_MS} and ${MAX_CONFIG_TIMEOUT_MS} milliseconds.`,
        );
      }
      sawTimeout = true;
      index += 1;
      continue;
    }
    return usage(
      argument?.startsWith("-") ? "Unknown option." : "Unexpected argument.",
    );
  }

  return { configTimeoutMs, json, kind: "validate", root };
}

function usage(message: string): ParsedArguments {
  return { kind: "usage-error", message };
}
