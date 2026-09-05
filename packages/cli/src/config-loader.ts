import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  isRedactedIssuePath,
  parseConfig,
  type SpecraConfig,
} from "@specra/config";

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
  | { readonly config: SpecraConfig; readonly ok: true }
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
  if (options.signal.aborted) return { code: "CANCELLED", ok: false };

  let child: ChildProcess;
  try {
    const hostUrl = new URL(
      import.meta.url.endsWith(".ts")
        ? "../dist/config-worker.js"
        : "./config-worker.js",
      import.meta.url,
    );
    child = spawn(
      process.execPath,
      [
        "--max-old-space-size=64",
        "--max-semi-space-size=16",
        "--stack-size=4096",
        fileURLToPath(hostUrl),
        import.meta.resolve("@specra/config"),
        options.configUrl.href,
      ],
      {
        detached: process.platform !== "win32",
        env: configProcessEnvironment(),
        stdio: ["ignore", "pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch {
    return { code: "CONFIG_LOAD_FAILED", ok: false };
  }

  return await new Promise<ConfigLoadResult>((resolve) => {
    const control = child.stdio[3] as Readable | null;
    if (control === null || child.stdout === null || child.stderr === null) {
      terminateProcessTree(child);
      resolve({ code: "CONFIG_LOAD_FAILED", ok: false });
      return;
    }
    const controlStream = control;

    let outputBytes = 0;
    let protocolBytes = 0;
    let protocol = Buffer.alloc(0);
    let settled = false;
    const timeout = setTimeout(() => {
      finish({ code: "CONFIG_TIMEOUT", ok: false });
    }, options.timeoutMs);

    const onAbort = (): void => {
      finish({ code: "CANCELLED", ok: false });
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (options.signal.aborted) {
      finish({ code: "CANCELLED", ok: false });
      return;
    }

    const countOutput = (chunk: Buffer | string): void => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
        finish({ code: "CONFIG_LOAD_FAILED", ok: false });
      }
    };
    const collectProtocol = (chunk: Buffer): void => {
      protocolBytes += chunk.byteLength;
      if (protocolBytes > MAX_PROTOCOL_BYTES) {
        finish({ code: "CONFIG_LOAD_FAILED", ok: false });
        return;
      }
      protocol = Buffer.concat([protocol, chunk], protocolBytes);
      const terminator = protocol.indexOf(0x0a);
      if (terminator === -1) return;
      if (terminator !== protocol.byteLength - 1) {
        finish({ code: "CONFIG_LOAD_FAILED", ok: false });
        return;
      }
      handleResponse(parseProcessResponse(protocol.subarray(0, terminator)));
    };
    child.stdout.on("data", countOutput);
    child.stderr.on("data", countOutput);
    controlStream.on("data", collectProtocol);

    child.once("error", () => {
      finish({ code: "CONFIG_LOAD_FAILED", ok: false });
    });
    child.once("close", () => {
      if (!settled) finish({ code: "CONFIG_LOAD_FAILED", ok: false });
    });

    function handleResponse(message: ProcessResponse | undefined): void {
      if (message === undefined) {
        finish({ code: "CONFIG_LOAD_FAILED", ok: false });
        return;
      }
      if (message.type === "failure") {
        const issuePaths =
          message.issuePaths === undefined
            ? undefined
            : [...new Set(message.issuePaths)].sort(compareCodeUnits);
        finish({
          code: categoryCode(message.category),
          ...(issuePaths === undefined ? {} : { issuePaths }),
          ok: false,
        });
        return;
      }
      try {
        const parsed: unknown = JSON.parse(message.configJson);
        const config = parseConfig(parsed);
        finish({ config, ok: true });
      } catch {
        finish({ code: "CONFIG_LOAD_FAILED", ok: false });
      }
    }

    function finish(result: ConfigLoadResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", onAbort);
      child.stdout?.removeListener("data", countOutput);
      child.stderr?.removeListener("data", countOutput);
      controlStream.removeListener("data", collectProtocol);
      terminateProcessTree(child);
      resolve(result);
    }
  });
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

function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid !== undefined && process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
    const result = spawnSync(
      path.join(systemRoot, "System32", "taskkill.exe"),
      ["/pid", String(pid), "/t", "/f"],
      {
        stdio: "ignore",
        timeout: 1_000,
        windowsHide: true,
      },
    );
    if (result.error === undefined && result.status === 0) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // The child may have exited while taskkill was running.
    }
    return;
  }
  if (pid !== undefined) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // The group can already be gone or unavailable; fall back to the child.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Termination races are expected after early process failure.
  }
}

function configProcessEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.NODE_OPTIONS;
  return environment;
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
