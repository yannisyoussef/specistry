import { createReadStream, writeSync } from "node:fs";
import { registerHooks } from "node:module";
import { exit } from "node:process";

import { redactIssuePath, specraConfigSchema } from "@specra/config";

const MAX_CONFIG_BYTES = 1_048_576;
// Must match the loader's protocol cap: the frame embeds the config JSON as a
// string, so escaping can inflate a config that is itself under the limit.
const MAX_PROTOCOL_BYTES = MAX_CONFIG_BYTES + 32_768;
const MAX_CONFIG_DEPTH = 64;
const MAX_CONFIG_NODES = 20_000;

interface ConfigHostData {
  readonly configPackageUrl: string;
  readonly configUrl: string;
}

type ProcessFailureCategory =
  "invalid" | "load-failed" | "not-serializable" | "unsupported";

type ProcessResponse =
  | { readonly configJson: string; readonly type: "success" }
  | {
      readonly category: ProcessFailureCategory;
      readonly issuePaths?: readonly string[];
      readonly type: "failure";
    };

void evaluateConfig(readHostData());

async function evaluateConfig(data: ConfigHostData | undefined): Promise<void> {
  try {
    if (data === undefined) {
      post({ category: "load-failed", type: "failure" });
      return;
    }

    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === "@specra/config") {
          return { shortCircuit: true, url: data.configPackageUrl };
        }
        return nextResolve(specifier, context);
      },
    });

    const loaded: unknown = await import(data.configUrl);
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
        ...new Set(
          parsed.error.issues.map((issue) => redactIssuePath(issue.path)),
        ),
      ].sort(compareCodeUnits);
      post({ category: "invalid", issuePaths, type: "failure" });
      return;
    }

    const configJson = JSON.stringify(parsed.data);
    const response: ProcessResponse = { configJson, type: "success" };
    if (
      Buffer.byteLength(configJson, "utf8") > MAX_CONFIG_BYTES ||
      Buffer.byteLength(JSON.stringify(response), "utf8") >= MAX_PROTOCOL_BYTES
    ) {
      post({ category: "not-serializable", type: "failure" });
      return;
    }
    post(response);
  } catch {
    post({ category: "load-failed", type: "failure" });
  }
}

function readHostData(): ConfigHostData | undefined {
  const [, , configPackageUrl, configUrl, ...extra] = process.argv;
  return extra.length === 0 &&
    typeof configPackageUrl === "string" &&
    typeof configUrl === "string"
    ? { configPackageUrl, configUrl }
    : undefined;
}

function post(response: ProcessResponse): void {
  try {
    writeSync(3, `${JSON.stringify(response)}\n`);
  } catch {
    exit(1);
  }
  // Stay alive only while the parent's end of the control channel is open:
  // the parent terminates the whole tree after a result, and a parent that
  // died first closes the channel, which ends this host instead of leaving it
  // orphaned under the init process.
  const control = createReadStream("", { fd: 3 });
  const stop = (): void => exit(0);
  control.on("data", () => undefined);
  control.once("end", stop);
  control.once("close", stop);
  control.once("error", stop);
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

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
