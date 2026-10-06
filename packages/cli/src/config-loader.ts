import {
  isRedactedIssuePath,
  parseConfig,
  type SpecistryConfig,
} from "@specistry/config";

import { hostModuleUrl, runBoundedHost } from "./bounded-host.js";
import type { DiagnosticCode } from "./contracts.js";

const MAX_PROCESS_OUTPUT_BYTES = 65_536;
const MAX_CONFIG_BYTES = 1_048_576;
const MAX_PROTOCOL_BYTES = MAX_CONFIG_BYTES + 32_768;
const MAX_ISSUE_PATHS = 128;
// The host labels a missing default export itself; every other label must be
// one the schema authority could have produced.
const HOST_ISSUE_PATHS = new Set(["default"]);

interface ConfigLoadOptions {
  readonly configUrl: URL;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

export type ConfigLoadResult =
  | { readonly config: SpecistryConfig; readonly ok: true }
  | {
      readonly code: DiagnosticCode;
      readonly issuePaths?: readonly string[];
      readonly ok: false;
    };

type ProcessResponse =
  | { readonly configJson: string; readonly type: "success" }
  | {
      readonly category:
        "invalid" | "load-failed" | "not-serializable" | "unsupported";
      readonly issuePaths?: readonly string[];
      readonly type: "failure";
    };

type ProcessFailureCategory = Extract<
  ProcessResponse,
  { readonly type: "failure" }
>["category"];

export async function loadConfigIsolated(
  options: ConfigLoadOptions,
): Promise<ConfigLoadResult> {
  const outcome = await runBoundedHost({
    args: [import.meta.resolve("@specistry/config"), options.configUrl.href],
    hostModule: hostModuleUrl("config-worker.js", import.meta.url),
    maxFrameBytes: MAX_PROTOCOL_BYTES,
    maxOutputBytes: MAX_PROCESS_OUTPUT_BYTES,
    memoryMiB: 64,
    signal: options.signal,
    stackKiB: 4096,
    timeoutMs: options.timeoutMs,
  });
  if (!outcome.ok) {
    return {
      code:
        outcome.reason === "timeout"
          ? "CONFIG_TIMEOUT"
          : outcome.reason === "cancelled"
            ? "CANCELLED"
            : "CONFIG_LOAD_FAILED",
      ok: false,
    };
  }
  const message = parseProcessResponse(outcome.frame);
  if (message === undefined) return { code: "CONFIG_LOAD_FAILED", ok: false };
  if (message.type === "failure") {
    const issuePaths =
      message.issuePaths === undefined
        ? undefined
        : [...new Set(message.issuePaths)].sort(compareCodeUnits);
    return {
      code: categoryCode(message.category),
      ...(issuePaths === undefined ? {} : { issuePaths }),
      ok: false,
    };
  }
  try {
    const parsed: unknown = JSON.parse(message.configJson);
    return { config: parseConfig(parsed), ok: true };
  } catch {
    return { code: "CONFIG_LOAD_FAILED", ok: false };
  }
}

function parseProcessResponse(bytes: Buffer): ProcessResponse | undefined {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PROTOCOL_BYTES) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return isProcessResponse(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isProcessResponse(value: unknown): value is ProcessResponse {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return false;
  }
  if (value.type === "success") {
    return (
      hasOnlyKeys(value, ["configJson", "type"]) &&
      "configJson" in value &&
      typeof value.configJson === "string" &&
      Buffer.byteLength(value.configJson, "utf8") <= MAX_CONFIG_BYTES
    );
  }
  if (value.type !== "failure" || !("category" in value)) return false;
  if (!hasOnlyKeys(value, ["category", "issuePaths", "type"])) return false;
  if (typeof value.category !== "string") return false;
  const validCategory = new Set([
    "invalid",
    "load-failed",
    "not-serializable",
    "unsupported",
  ]).has(value.category);
  if (!validCategory) return false;
  if (!("issuePaths" in value) || value.issuePaths === undefined) return true;
  return (
    Array.isArray(value.issuePaths) &&
    value.issuePaths.length > 0 &&
    value.issuePaths.length <= MAX_ISSUE_PATHS &&
    value.issuePaths.every(
      (entry) =>
        typeof entry === "string" &&
        (HOST_ISSUE_PATHS.has(entry) || isRedactedIssuePath(entry)),
    )
  );
}

function hasOnlyKeys(value: object, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return (
    Object.getOwnPropertySymbols(value).length === 0 &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function categoryCode(category: ProcessFailureCategory): DiagnosticCode {
  switch (category) {
    case "invalid":
      return "CONFIG_INVALID";
    case "load-failed":
      return "CONFIG_LOAD_FAILED";
    case "not-serializable":
      return "CONFIG_NOT_SERIALIZABLE";
    case "unsupported":
      return "CONFIG_UNSUPPORTED";
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
