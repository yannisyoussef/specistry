import { Worker } from "node:worker_threads";

import { parseConfig, type SpecraConfig } from "@specra/config";

import type { DiagnosticCode } from "./contracts.js";

const MAX_WORKER_OUTPUT_BYTES = 65_536;
const MAX_CONFIG_BYTES = 1_048_576;
const MAX_ISSUE_PATHS = 128;
const SAFE_ISSUE_PATH =
  /^(?:branding(?:\.(?:favicon|logo))?|config|default|docs|environments(?:\.\*(?:\.(?:baseUrl|label))?)?|name|openapi(?:\.\[\])?|playground(?:\.mode)?|schemaVersion)$/;

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

type WorkerResponse =
  | { readonly configJson: string; readonly type: "success" }
  | {
      readonly category:
        "invalid" | "load-failed" | "not-serializable" | "unsupported";
      readonly issuePaths?: readonly string[];
      readonly type: "failure";
    };

type WorkerFailureCategory = Extract<
  WorkerResponse,
  { readonly type: "failure" }
>["category"];

export async function loadConfigInWorker(
  options: ConfigLoadOptions,
): Promise<ConfigLoadResult> {
  if (options.signal.aborted) return { code: "CANCELLED", ok: false };

  let worker: Worker;
  try {
    const workerUrl = new URL(
      import.meta.url.endsWith(".ts")
        ? "../dist/config-worker.js"
        : "./config-worker.js",
      import.meta.url,
    );
    worker = new Worker(workerUrl, {
      execArgv: [],
      resourceLimits: {
        codeRangeSizeMb: 16,
        maxOldGenerationSizeMb: 64,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
      stderr: true,
      stdout: true,
      workerData: {
        configPackageUrl: import.meta.resolve("@specra/config"),
        configUrl: options.configUrl.href,
      },
    });
  } catch {
    return { code: "CONFIG_LOAD_FAILED", ok: false };
  }

  return await new Promise<ConfigLoadResult>((resolve) => {
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      void finish({ code: "CONFIG_TIMEOUT", ok: false });
    }, options.timeoutMs);

    const onAbort = (): void => {
      void finish({ code: "CANCELLED", ok: false });
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    if (options.signal.aborted) {
      void finish({ code: "CANCELLED", ok: false });
      return;
    }

    const countOutput = (chunk: Buffer | string): void => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_WORKER_OUTPUT_BYTES) {
        void finish({ code: "CONFIG_LOAD_FAILED", ok: false });
      }
    };
    worker.stdout?.on("data", countOutput);
    worker.stderr?.on("data", countOutput);

    worker.once("message", (message: unknown) => {
      if (!isWorkerResponse(message)) {
        void finish({ code: "CONFIG_LOAD_FAILED", ok: false });
        return;
      }
      if (message.type === "failure") {
        const issuePaths =
          message.issuePaths === undefined
            ? undefined
            : [...new Set(message.issuePaths)].sort(compareCodeUnits);
        void finish({
          code: categoryCode(message.category),
          ...(issuePaths === undefined ? {} : { issuePaths }),
          ok: false,
        });
        return;
      }
      try {
        const parsed: unknown = JSON.parse(message.configJson);
        const config = parseConfig(parsed);
        void finish({ config, ok: true });
      } catch {
        void finish({ code: "CONFIG_LOAD_FAILED", ok: false });
      }
    });
    worker.once("error", () => {
      void finish({ code: "CONFIG_LOAD_FAILED", ok: false });
    });
    worker.once("exit", () => {
      if (!settled) void finish({ code: "CONFIG_LOAD_FAILED", ok: false });
    });

    async function finish(result: ConfigLoadResult): Promise<void> {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal.removeEventListener("abort", onAbort);
      worker.stdout?.removeListener("data", countOutput);
      worker.stderr?.removeListener("data", countOutput);
      try {
        await worker.terminate();
      } catch {
        if (result.ok) {
          resolve({ code: "CONFIG_LOAD_FAILED", ok: false });
          return;
        }
      }
      resolve(result);
    }
  });
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
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
    value.issuePaths.length <= MAX_ISSUE_PATHS &&
    value.issuePaths.every(
      (entry) => typeof entry === "string" && SAFE_ISSUE_PATH.test(entry),
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

function categoryCode(category: WorkerFailureCategory): DiagnosticCode {
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
