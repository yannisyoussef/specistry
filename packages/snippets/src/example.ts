import type { ApiService, JsonValue, SchemaNode } from "@specra/model";

import {
  isSensitiveName,
  looksLikeSecret,
  placeholderFor,
  sanitizeLine,
  sanitizeText,
  secretPlaceholderFor,
} from "./sanitize.js";
import { PLACEHOLDERS, SNIPPET_LIMITS } from "./types.js";

/**
 * Bounded, deterministic example projection from canonical schema semantics
 * in request context. This is not a JSON Schema faker: it walks the schema
 * once, prefers explicit values (`examples`, `default`, `const`, the first
 * enum member) over type-shaped placeholders, never emits `readOnly`
 * properties, stops at recursion, and stays inside a node and depth budget.
 * Every string is sanitized, and any property whose name looks like a
 * credential becomes a `<YOUR_…>` placeholder regardless of the example.
 */

export interface ExampleBudget {
  nodes: number;
  truncated: boolean;
}

export function createBudget(): ExampleBudget {
  return { nodes: SNIPPET_LIMITS.maxBodyNodes, truncated: false };
}

interface Walk {
  readonly registry: ApiService["schemas"];
  readonly budget: ExampleBudget;
  /** Schema ids on the current path; re-entering one is recursion. */
  readonly path: readonly string[];
  readonly depth: number;
}

/** Whether a schema (through references) would appear as a file part. */
export function isBinarySchema(
  node: SchemaNode | undefined,
  registry: ApiService["schemas"],
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (node === undefined) return false;
  switch (node.kind) {
    case "scalar":
      return (
        node.type === "string" &&
        (node.format === "binary" || node.format === "base64")
      );
    case "ref": {
      if (seen.has(node.schemaId)) return false;
      const target = Object.hasOwn(registry, node.schemaId)
        ? registry[node.schemaId]
        : undefined;
      return isBinarySchema(
        target,
        registry,
        new Set([...seen, node.schemaId]),
      );
    }
    case "composition":
      return (
        node.mode !== "not" &&
        node.variants.some((variant) => isBinarySchema(variant, registry, seen))
      );
    default:
      return false;
  }
}

/** A representative request value for a schema, or `undefined` for no schema. */
export function exampleFor(
  node: SchemaNode | undefined,
  name: string,
  registry: ApiService["schemas"],
  budget: ExampleBudget = createBudget(),
): JsonValue {
  if (node === undefined) return placeholderFor(name);
  return walk(node, name, { budget, depth: 0, path: [], registry });
}

/** Applies the sensitive-name policy and sanitizes a contract example value. */
export function sanitizeExample(value: JsonValue, name = ""): JsonValue {
  const budget = createBudget();
  return sanitizeValue(value, name, budget, 0);
}

function sanitizeValue(
  value: JsonValue,
  name: string,
  budget: ExampleBudget,
  depth: number,
): JsonValue {
  budget.nodes -= 1;
  if (budget.nodes < 0 || depth > SNIPPET_LIMITS.maxBodyDepth) {
    budget.truncated = true;
    return Array.isArray(value) ? [] : isObject(value) ? {} : null;
  }
  if (typeof value === "string") {
    return isSensitiveName(name) || looksLikeSecret(value)
      ? secretPlaceholderFor(name)
      : sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 8)
      .map((item) => sanitizeValue(item, name, budget, depth + 1));
  }
  if (isObject(value)) {
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || key === "__proto__") continue;
      result[sanitizeLine(key, 120)] = sanitizeValue(
        item,
        key,
        budget,
        depth + 1,
      );
    }
    return result;
  }
  return value;
}

function isObject(
  value: JsonValue,
): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function walk(node: SchemaNode, name: string, context: Walk): JsonValue {
  context.budget.nodes -= 1;
  if (context.budget.nodes < 0 || context.depth > SNIPPET_LIMITS.maxBodyDepth) {
    context.budget.truncated = true;
    return null;
  }
  const explicit = explicitValue(node, name);
  if (explicit !== undefined) return explicit;
  switch (node.kind) {
    case "ref": {
      if (context.path.includes(node.schemaId)) {
        // Bounded recursion: the structure is shown once, then closed.
        return recursionStub(node.schemaId, context.registry);
      }
      const target = Object.hasOwn(context.registry, node.schemaId)
        ? context.registry[node.schemaId]
        : undefined;
      if (target === undefined) return null;
      return walk(target, name, {
        ...context,
        depth: context.depth + 1,
        path: [...context.path, node.schemaId],
      });
    }
    case "scalar":
      return scalarPlaceholder(node.type, node.format, name, node.constraints);
    case "object":
      return objectExample(node, context);
    case "array": {
      // An array of a type already on the path closes the recursion as `[]`.
      if (
        node.items.kind === "ref" &&
        context.path.includes(node.items.schemaId)
      ) {
        return [];
      }
      const item = walk(node.items, singular(name), {
        ...context,
        depth: context.depth + 1,
      });
      return item === null && context.budget.truncated
        ? []
        : Array.from({ length: SNIPPET_LIMITS.maxArrayItems }, () => item);
    }
    case "tuple":
      return node.prefixItems.map((item, index) =>
        walk(item, `${name}${index}`, { ...context, depth: context.depth + 1 }),
      );
    case "composition":
      return compositionExample(node, name, context);
    case "type-less":
      return typeLessExample(node, name, context);
    case "any":
    case "boolean-schema":
      return {};
    case "unknown":
      return null;
  }
}

/** `examples[0]` → `default` → `const` → `enum[0]`, sanitized and redacted. */
function explicitValue(node: SchemaNode, name: string): JsonValue | undefined {
  if (node.kind === "unknown") return undefined;
  const candidates: (JsonValue | undefined)[] = [
    node.examples?.[0],
    node.defaultValue,
    node.kind === "scalar" || node.kind === "type-less"
      ? node.constValue
      : undefined,
    node.kind === "scalar" || node.kind === "type-less"
      ? node.enumValues?.[0]
      : undefined,
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined) return sanitizeExample(candidate, name);
  }
  return undefined;
}

function recursionStub(
  schemaId: string,
  registry: ApiService["schemas"],
): JsonValue {
  const target = Object.hasOwn(registry, schemaId)
    ? registry[schemaId]
    : undefined;
  return target?.kind === "array" ? [] : {};
}

function objectExample(
  node: Extract<SchemaNode, { kind: "object" }>,
  context: Walk,
): JsonValue {
  const result: Record<string, JsonValue> = {};
  const required = new Set(node.required);
  // Required properties first so the budget is spent on what matters.
  const order = [
    ...node.propertyOrder.filter((key) => required.has(key)),
    ...node.propertyOrder.filter((key) => !required.has(key)),
  ];
  for (const key of order) {
    const property = Object.hasOwn(node.properties, key)
      ? node.properties[key]
      : undefined;
    if (property === undefined || key === "__proto__") continue;
    if (isReadOnly(property, context.registry)) continue;
    if (context.budget.nodes <= 0) {
      context.budget.truncated = true;
      break;
    }
    result[key] = walk(property, key, {
      ...context,
      depth: context.depth + 1,
    });
  }
  // Keep the author's property order for display.
  const ordered: Record<string, JsonValue> = {};
  for (const key of node.propertyOrder) {
    if (Object.hasOwn(result, key)) ordered[key] = result[key] as JsonValue;
  }
  return ordered;
}

function isReadOnly(
  node: SchemaNode,
  registry: ApiService["schemas"],
  seen: ReadonlySet<string> = new Set(),
): boolean {
  if (node.readOnly === true) return true;
  if (node.kind === "ref" && !seen.has(node.schemaId)) {
    const target = Object.hasOwn(registry, node.schemaId)
      ? registry[node.schemaId]
      : undefined;
    return target === undefined
      ? false
      : isReadOnly(target, registry, new Set([...seen, node.schemaId]));
  }
  return false;
}

function compositionExample(
  node: Extract<SchemaNode, { kind: "composition" }>,
  name: string,
  context: Walk,
): JsonValue {
  if (node.mode === "not") return null;
  const nested = { ...context, depth: context.depth + 1 };
  if (node.mode === "allOf") {
    // Merge object-shaped variants; anything else takes the first variant.
    const merged: Record<string, JsonValue> = {};
    let mergedAny = false;
    for (const variant of node.variants) {
      const value = walk(variant, name, nested);
      if (isObject(value)) {
        Object.assign(merged, value);
        mergedAny = true;
      } else if (!mergedAny) {
        return value;
      }
    }
    return merged;
  }
  // oneOf / anyOf: the first variant, with the discriminator value set when
  // the mapping names it.
  const first = node.variants[0];
  if (first === undefined) return null;
  const value = walk(first, name, nested);
  const discriminator = node.discriminator;
  if (discriminator !== undefined && isObject(value) && first.kind === "ref") {
    const entry = Object.entries(discriminator.mapping).find(
      ([, schemaId]) => schemaId === first.schemaId,
    );
    if (entry !== undefined) {
      return { ...value, [discriminator.propertyName]: entry[0] };
    }
  }
  return value;
}

function typeLessExample(
  node: Extract<SchemaNode, { kind: "type-less" }>,
  name: string,
  context: Walk,
): JsonValue {
  const type = node.applicableTypes[0];
  if (type === "object" && node.object !== undefined) {
    return objectExample({ kind: "object", ...node.object }, context);
  }
  if (type === "array" && node.array !== undefined) {
    return [
      walk(node.array.items, singular(name), {
        ...context,
        depth: context.depth + 1,
      }),
    ];
  }
  if (type === undefined || type === "object") return {};
  if (type === "array") return [];
  if (type === "null") return null;
  return scalarPlaceholder(type, node.string?.format, name, node.numeric);
}

function scalarPlaceholder(
  type: "boolean" | "integer" | "null" | "number" | "string",
  format: string | undefined,
  name: string,
  constraints:
    | { readonly minimum?: number; readonly exclusiveMinimum?: number }
    | undefined,
): JsonValue {
  switch (type) {
    case "boolean":
      return false;
    case "null":
      return null;
    case "integer":
    case "number": {
      const minimum = constraints?.minimum ?? constraints?.exclusiveMinimum;
      if (minimum !== undefined && minimum > 0) {
        return type === "integer" ? Math.ceil(minimum) : minimum;
      }
      return 0;
    }
    case "string":
      return stringPlaceholder(format, name);
  }
}

const FORMAT_PLACEHOLDERS: Readonly<Record<string, string>> = {
  base64: "<BASE64_CONTENT>",
  binary: "<FILE_CONTENTS>",
  byte: "<BASE64_CONTENT>",
  date: "2024-01-01",
  "date-time": "2024-01-01T00:00:00Z",
  email: "user@example.com",
  hostname: "example.com",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
  password: PLACEHOLDERS.password,
  time: "00:00:00Z",
  uri: "https://example.com/resource",
  url: "https://example.com/resource",
  uuid: "00000000-0000-0000-0000-000000000000",
};

function stringPlaceholder(format: string | undefined, name: string): string {
  if (isSensitiveName(name)) return secretPlaceholderFor(name);
  if (format !== undefined && Object.hasOwn(FORMAT_PLACEHOLDERS, format)) {
    return FORMAT_PLACEHOLDERS[format] as string;
  }
  return "string";
}

function singular(name: string): string {
  return name.endsWith("s") && name.length > 1 ? name.slice(0, -1) : name;
}
