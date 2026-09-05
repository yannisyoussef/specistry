import type {
  ApiService,
  JsonValue,
  ObjectConstraints,
  SchemaNode,
} from "@specra/model";

/**
 * Restrained schema presentation for SPEC-004: a type phrase, an optional
 * constraints line, and one level of properties for object-shaped schemas.
 * This is the integration point the SPEC-005 schema renderer replaces; it
 * never invents structure the canonical node does not carry.
 */

export interface SchemaSummary {
  /** Human type phrase, e.g. `string`, `array of object`, `one of 2 variants`. */
  readonly type: string;
  /** Mono constraints line, e.g. `default 3600 · min 60 · max 86400`. */
  readonly constraints?: string;
  readonly description?: string;
  readonly deprecated: boolean;
  /** Direct properties when the schema is object-shaped. */
  readonly properties?: readonly PropertySummary[];
  /** True when the summary omits nested structure a later slice will render. */
  readonly truncated: boolean;
}

export interface PropertySummary {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly readOnly: boolean;
  readonly writeOnly: boolean;
  readonly description?: string;
  readonly constraints?: string;
  /** True when the property has nested structure not shown at this level. */
  readonly nested: boolean;
}

type Registry = ApiService["schemas"];

const MAX_ENUM_PREVIEW = 6;
const MAX_REFERENCE_HOPS = 8;

/** Summarizes one schema node against its service registry. */
export function summarizeSchema(
  node: SchemaNode,
  registry: Registry,
): SchemaSummary {
  const resolved = dereference(node, registry);
  const properties = objectProperties(resolved, registry);
  const description = firstDescription(node, resolved);
  return {
    deprecated: node.deprecated === true || resolved.deprecated === true,
    type: typePhrase(node, registry, 0),
    ...(description === undefined ? {} : { description }),
    ...(constraintsLine(resolved) === undefined
      ? {}
      : { constraints: constraintsLine(resolved) as string }),
    ...(properties === undefined ? {} : { properties }),
    truncated: properties === undefined ? hasNestedStructure(resolved) : false,
  };
}

/** Human type phrase for a node, following references by registry id. */
export function typePhrase(
  node: SchemaNode,
  registry: Registry,
  depth: number,
): string {
  if (depth > MAX_REFERENCE_HOPS) return "object";
  switch (node.kind) {
    case "any":
      return "any";
    case "boolean-schema":
      return node.accepts ? "any" : "never";
    case "unknown":
      return "unknown";
    case "ref": {
      const target = registry[node.schemaId];
      if (target === undefined) return "object";
      if (target.title !== undefined) return target.title;
      return typePhrase(target, registry, depth + 1);
    }
    case "scalar": {
      if (node.constValue !== undefined) return `${node.type} · constant`;
      const base =
        node.format === undefined ? node.type : `${node.type} · ${node.format}`;
      return node.enumValues === undefined ? base : `${base} · enum`;
    }
    case "array":
      return `array of ${typePhrase(node.items, registry, depth + 1)}`;
    case "tuple":
      return `tuple of ${node.prefixItems.length} item${node.prefixItems.length === 1 ? "" : "s"}`;
    case "object":
      return node.title ?? "object";
    case "type-less": {
      if (node.constValue !== undefined) return "constant";
      if (node.enumValues !== undefined) return "enum";
      if (node.applicableTypes.length === 0) return "value";
      return node.applicableTypes.join(" or ");
    }
    case "composition": {
      if (node.mode === "not") {
        return `not ${typePhrase(node.variants[0], registry, depth + 1)}`;
      }
      const nullable = node.variants.some(
        (variant) => variant.kind === "scalar" && variant.type === "null",
      );
      const concrete = node.variants.filter(
        (variant) => !(variant.kind === "scalar" && variant.type === "null"),
      );
      if (node.mode !== "allOf" && nullable && concrete.length === 1) {
        const only = concrete[0];
        return only === undefined
          ? "null"
          : `${typePhrase(only, registry, depth + 1)} or null`;
      }
      if (node.mode === "allOf") return node.title ?? "object";
      const phrases = node.variants.map((variant) =>
        typePhrase(variant, registry, depth + 1),
      );
      const distinct = [...new Set(phrases)];
      const joiner = node.mode === "oneOf" ? "one of" : "any of";
      return distinct.length <= 3
        ? `${joiner}: ${distinct.join(", ")}`
        : `${joiner} ${distinct.length} variants`;
    }
  }
}

/** Follows `ref` and single-variant nullable compositions to a concrete node. */
function dereference(node: SchemaNode, registry: Registry): SchemaNode {
  let current = node;
  for (let hop = 0; hop < MAX_REFERENCE_HOPS; hop += 1) {
    if (current.kind === "ref") {
      const target = registry[current.schemaId];
      if (target === undefined) return current;
      current = target;
      continue;
    }
    if (
      current.kind === "composition" &&
      current.mode !== "not" &&
      current.mode !== "allOf"
    ) {
      const concrete = current.variants.filter(
        (variant) => !(variant.kind === "scalar" && variant.type === "null"),
      );
      if (concrete.length === 1 && concrete[0] !== undefined) {
        current = concrete[0];
        continue;
      }
    }
    return current;
  }
  return current;
}

function objectProperties(
  node: SchemaNode,
  registry: Registry,
): readonly PropertySummary[] | undefined {
  const constraints = objectConstraints(node, registry);
  if (constraints === undefined) return undefined;
  const required = new Set(constraints.required);
  return constraints.propertyOrder.map((name) => {
    const property = constraints.properties[name] ?? { kind: "any" as const };
    const resolved = dereference(property, registry);
    const description = firstDescription(property, resolved);
    const line = constraintsLine(resolved);
    return {
      deprecated: property.deprecated === true || resolved.deprecated === true,
      name,
      nested: hasNestedStructure(resolved),
      readOnly: property.readOnly === true || resolved.readOnly === true,
      required: required.has(name),
      type: typePhrase(property, registry, 0),
      writeOnly: property.writeOnly === true || resolved.writeOnly === true,
      ...(description === undefined ? {} : { description }),
      ...(line === undefined ? {} : { constraints: line }),
    };
  });
}

/**
 * Object constraints for object nodes, `allOf` compositions whose variants
 * are all object-shaped (merged in order, later properties win), and
 * type-less nodes carrying object keywords.
 */
function objectConstraints(
  node: SchemaNode,
  registry: Registry,
): ObjectConstraints | undefined {
  if (node.kind === "object") return node;
  if (node.kind === "type-less") return node.object;
  if (node.kind === "composition" && node.mode === "allOf") {
    const parts = node.variants.map((variant) =>
      objectConstraints(dereference(variant, registry), registry),
    );
    if (parts.some((part) => part === undefined)) return undefined;
    const properties: Record<string, SchemaNode> = {};
    const propertyOrder: string[] = [];
    const required = new Set<string>();
    for (const part of parts as readonly ObjectConstraints[]) {
      for (const name of part.propertyOrder) {
        const property = part.properties[name];
        if (property === undefined) continue;
        if (!propertyOrder.includes(name)) propertyOrder.push(name);
        Object.defineProperty(properties, name, {
          configurable: true,
          enumerable: true,
          value: property,
          writable: true,
        });
      }
      for (const name of part.required) required.add(name);
    }
    return {
      additionalProperties: true,
      properties,
      propertyOrder,
      required: [...required],
    };
  }
  return undefined;
}

function hasNestedStructure(node: SchemaNode): boolean {
  switch (node.kind) {
    case "object":
      return (
        node.propertyOrder.length > 0 ||
        typeof node.additionalProperties === "object"
      );
    case "array":
      return node.items.kind !== "scalar" && node.items.kind !== "any";
    case "tuple":
    case "composition":
      return true;
    case "type-less":
      return node.object !== undefined || node.array !== undefined;
    default:
      return false;
  }
}

function firstDescription(
  node: SchemaNode,
  resolved: SchemaNode,
): string | undefined {
  return node.description ?? resolved.description;
}

/** Mono constraints line in the design's `default 3600 · min 60 · max 86400` form. */
export function constraintsLine(node: SchemaNode): string | undefined {
  const parts: string[] = [];
  if (node.defaultValue !== undefined) {
    parts.push(`default ${formatValue(node.defaultValue)}`);
  }
  if (node.kind === "scalar") {
    if (node.constValue !== undefined) {
      parts.push(`always ${formatValue(node.constValue)}`);
    }
    if (node.enumValues !== undefined) parts.push(enumLine(node.enumValues));
    if (node.constraints !== undefined) {
      const { constraints } = node;
      if (constraints.minimum !== undefined)
        parts.push(`min ${constraints.minimum}`);
      if (constraints.exclusiveMinimum !== undefined) {
        parts.push(`greater than ${constraints.exclusiveMinimum}`);
      }
      if (constraints.maximum !== undefined)
        parts.push(`max ${constraints.maximum}`);
      if (constraints.exclusiveMaximum !== undefined) {
        parts.push(`less than ${constraints.exclusiveMaximum}`);
      }
      if (constraints.multipleOf !== undefined) {
        parts.push(`multiple of ${constraints.multipleOf}`);
      }
      if (constraints.minLength !== undefined) {
        parts.push(`min ${constraints.minLength} chars`);
      }
      if (constraints.maxLength !== undefined) {
        parts.push(`max ${constraints.maxLength} chars`);
      }
      if (constraints.pattern !== undefined) {
        parts.push(`pattern ${constraints.pattern}`);
      }
    }
  }
  if (node.kind === "type-less") {
    if (node.constValue !== undefined)
      parts.push(`always ${formatValue(node.constValue)}`);
    if (node.enumValues !== undefined) parts.push(enumLine(node.enumValues));
    if (node.string?.minLength !== undefined)
      parts.push(`min ${node.string.minLength} chars`);
    if (node.string?.maxLength !== undefined)
      parts.push(`max ${node.string.maxLength} chars`);
    if (node.numeric?.minimum !== undefined)
      parts.push(`min ${node.numeric.minimum}`);
    if (node.numeric?.maximum !== undefined)
      parts.push(`max ${node.numeric.maximum}`);
  }
  if (node.kind === "array") {
    if (node.minItems !== undefined) parts.push(`min ${node.minItems} items`);
    if (node.maxItems !== undefined) parts.push(`max ${node.maxItems} items`);
    if (node.uniqueItems === true) parts.push("unique items");
  }
  if (node.kind === "object") {
    if (node.minProperties !== undefined)
      parts.push(`min ${node.minProperties} properties`);
    if (node.maxProperties !== undefined)
      parts.push(`max ${node.maxProperties} properties`);
    if (node.additionalProperties === false)
      parts.push("no additional properties");
  }
  if (node.readOnly === true) parts.push("read-only");
  if (node.writeOnly === true) parts.push("write-only");
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function enumLine(values: readonly JsonValue[]): string {
  const preview = values.slice(0, MAX_ENUM_PREVIEW).map(formatValue);
  const rest = values.length - preview.length;
  return `one of ${preview.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}`;
}

function formatValue(value: JsonValue): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value).slice(0, 60);
  return String(value);
}
