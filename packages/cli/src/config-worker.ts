import { registerHooks } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

import { specraConfigSchema } from "@specra/config";

const MAX_CONFIG_BYTES = 1_048_576;
const MAX_CONFIG_DEPTH = 64;
const MAX_CONFIG_NODES = 20_000;
const SAFE_PATH_SEGMENTS = new Set([
  "baseUrl",
  "branding",
  "docs",
  "environments",
  "favicon",
  "label",
  "logo",
  "mode",
  "name",
  "openapi",
  "playground",
  "schemaVersion",
]);

interface ConfigWorkerData {
  readonly configPackageUrl: string;
  readonly configUrl: string;
}

type WorkerFailureCategory =
  "invalid" | "load-failed" | "not-serializable" | "unsupported";

type WorkerResponse =
  | { readonly configJson: string; readonly type: "success" }
  | {
      readonly category: WorkerFailureCategory;
      readonly issuePaths?: readonly string[];
      readonly type: "failure";
    };

const port = parentPort;
if (port === null) throw new Error("Config worker requires a parent port.");

void evaluateConfig();

async function evaluateConfig(): Promise<void> {
  try {
    if (!isWorkerData(workerData)) {
      post({ category: "load-failed", type: "failure" });
      return;
    }

    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === "@specra/config") {
          return { shortCircuit: true, url: workerData.configPackageUrl };
        }
        return nextResolve(specifier, context);
      },
    });

    const loaded: unknown = await import(workerData.configUrl);
    if (!isModuleNamespace(loaded) || !("default" in loaded)) {
      post({ category: "invalid", issuePaths: ["default"], type: "failure" });
      return;
    }

    const candidate = loaded.default;
    if (!isBoundedJsonValue(candidate)) {
      post({ category: "not-serializable", type: "failure" });
      return;
    }
    if (isPlainRecord(candidate) && candidate.schemaVersion !== 1) {
      post({
        category: "unsupported",
        issuePaths: ["schemaVersion"],
        type: "failure",
      });
      return;
    }

    const parsed = specraConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      const issuePaths = [
        ...new Set(parsed.error.issues.map((issue) => safePath(issue.path))),
      ].sort(compareCodeUnits);
      post({ category: "invalid", issuePaths, type: "failure" });
      return;
    }

    const configJson = JSON.stringify(parsed.data);
    if (Buffer.byteLength(configJson, "utf8") > MAX_CONFIG_BYTES) {
      post({ category: "not-serializable", type: "failure" });
      return;
    }
    post({ configJson, type: "success" });
  } catch {
    post({ category: "load-failed", type: "failure" });
  }
}

function post(response: WorkerResponse): void {
  port?.postMessage(response);
}

function isWorkerData(value: unknown): value is ConfigWorkerData {
  return (
    isPlainRecord(value) &&
    typeof value.configPackageUrl === "string" &&
    typeof value.configUrl === "string"
  );
}

function isModuleNamespace(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isBoundedJsonValue(value: unknown): boolean {
  let nodes = 0;
  const active = new WeakSet<object>();

  const visit = (current: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_CONFIG_NODES || depth > MAX_CONFIG_DEPTH) return false;
    if (
      current === null ||
      typeof current === "boolean" ||
      typeof current === "string"
    ) {
      return true;
    }
    if (typeof current === "number") return Number.isFinite(current);
    if (typeof current !== "object" || active.has(current)) return false;

    const isArray = Array.isArray(current);
    if (!isArray && !isPlainRecord(current)) return false;
    if (active.has(current)) return false;
    active.add(current);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(current);
      const symbolKeys = Object.getOwnPropertySymbols(current);
      if (symbolKeys.length > 0) return false;

      if (isArray) {
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (
            descriptor === undefined ||
            !("value" in descriptor) ||
            !descriptor.enumerable ||
            !visit(descriptor.value, depth + 1)
          ) {
            return false;
          }
        }
        const allowed = new Set([
          "length",
          ...Array.from({ length: current.length }, (_, index) =>
            String(index),
          ),
        ]);
        return Object.keys(descriptors).every((key) => allowed.has(key));
      }

      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (
          !("value" in descriptor) ||
          !descriptor.enumerable ||
          !visit(descriptor.value, depth + 1)
        ) {
          return false;
        }
        if (Buffer.byteLength(key, "utf8") > MAX_CONFIG_BYTES) return false;
      }
      return true;
    } finally {
      active.delete(current);
    }
  };

  if (!visit(value, 0)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_CONFIG_BYTES;
  } catch {
    return false;
  }
}

function safePath(pathSegments: readonly PropertyKey[]): string {
  if (pathSegments.length === 0) return "config";
  return pathSegments
    .map((segment) => {
      if (typeof segment === "number") return "[]";
      return typeof segment === "string" && SAFE_PATH_SEGMENTS.has(segment)
        ? segment
        : "*";
    })
    .join(".");
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
