/**
 * SDK rules (SPEC-011 §31). Specra knows the mappings a project declared
 * (SPEC-008), never the real package: no rule claims an SDK method exists,
 * is missing, or was removed. These rules only hold a declaration to what
 * it promises.
 */

import type { QualityRule } from "../contracts.js";

export const sdkExampleMissing: QualityRule = {
  category: "sdk",
  defaultSeverity: "warning",
  evaluate(facts, emit) {
    for (const sdk of facts.sdks) {
      if (sdk.declaration.coverage !== "complete") continue;
      for (const entry of facts.operations) {
        if (sdk.documented.has(entry.identity)) continue;
        emit({
          locator: sdk.identity,
          message:
            "The SDK declares complete coverage but maps no example to this operation.",
          target: {
            identity: entry.identity,
            kind: "operation",
            label: entry.label,
          },
        });
      }
    }
  },
  id: "sdk-example-missing",
  summary:
    "An SDK that declares complete coverage has a mapped example for every operation.",
  title: "Complete SDK covers every operation",
};

export const sdkExampleDeprecated: QualityRule = {
  category: "sdk",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    for (const sdk of facts.sdks) {
      for (const entry of facts.operations) {
        if (!entry.operation.deprecated) continue;
        if (!sdk.documented.has(entry.identity)) continue;
        emit({
          locator: sdk.identity,
          message:
            "The SDK example targets a deprecated operation; point readers at the replacement.",
          target: {
            identity: entry.identity,
            kind: "operation",
            label: entry.label,
          },
        });
      }
    }
  },
  id: "sdk-example-deprecated",
  summary: "An SDK example does not showcase an operation being retired.",
  title: "SDK example targets a supported operation",
};

export const sdkPackageMissing: QualityRule = {
  category: "sdk",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    for (const sdk of facts.sdks) {
      if (sdk.declaration.coverage !== "complete") continue;
      if (
        sdk.declaration.package !== undefined &&
        sdk.declaration.package.trim().length > 0
      ) {
        continue;
      }
      emit({
        message:
          "The SDK declares complete coverage but names no installable package.",
        target: { identity: sdk.identity, kind: "sdk", label: sdk.label },
      });
    }
  },
  id: "sdk-package-missing",
  summary:
    "An SDK presented as complete tells a reader what to install to use it.",
  title: "Complete SDK names a package",
};

export const SDK_RULES: readonly QualityRule[] = [
  sdkExampleMissing,
  sdkExampleDeprecated,
  sdkPackageMissing,
];
