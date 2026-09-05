import type {
  ArrayConstraints,
  JsonValue,
  NumericConstraints,
  ObjectConstraints,
  SchemaId,
  SchemaInstanceType,
  SchemaMetadata,
  SchemaNode,
  StringConstraints,
} from "@specra/model";

import type { SourceLocation } from "../diagnostics.js";
import { compareText } from "../identity.js";
import { isRecord } from "../parse.js";
import {
  anchorChild,
  child,
  type CanonicalAnchor,
  type NormalizeContext,
} from "./context.js";

const ANNOTATION_KEYS = new Set([
  "default",
  "deprecated",
  "description",
  "example",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
]);
/** Containers reached only through references; never diagnosed by themselves. */
const CONTAINER_KEYS = new Set(["$defs", "definitions"]);
const UNSUPPORTED_KEYS = new Set([
  "$dynamicAnchor",
  "$dynamicRef",
  "$recursiveAnchor",
  "$recursiveRef",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "dependentRequired",
  "dependentSchemas",
  "else",
  "if",
  "patternProperties",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
]);
const CORE_KEYS = new Set([
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "contains",
  "discriminator",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "items",
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minContains",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "not",
  "nullable",
  "oneOf",
  "pattern",
  "prefixItems",
  "properties",
  "required",
  "type",
  "uniqueItems",
]);
const INSTANCE_TYPES = new Set<SchemaInstanceType>([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);
const NUMERIC_KEYS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
] as const;
const STRING_KEYS = ["minLength", "maxLength", "pattern"] as const;
const ARRAY_KEYS = [
  "items",
  "prefixItems",
  "contains",
  "minContains",
  "maxContains",
  "minItems",
  "maxItems",
  "uniqueItems",
] as const;
const OBJECT_KEYS = [
  "properties",
  "required",
  "additionalProperties",
  "minProperties",
  "maxProperties",
] as const;
const MAX_INLINE_DEPTH = 256;

/**
 * Projects one source Schema Object into a canonical schema node. Registry
 * targets are reached through `ctx.registerSchema` and projected later by the
 * pipeline's work queue, so recursion here is bounded by inline nesting only.
 */
export function normalizeSchema(
  ctx: NormalizeContext,
  value: unknown,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  depth = 0,
): SchemaNode {
  if (depth > MAX_INLINE_DEPTH) {
    return unknownNode(ctx, "invalid", source, anchor);
  }
  if (typeof value === "boolean") {
    if (ctx.dialect === "oas30") {
      return unknownNode(ctx, "invalid", source, anchor);
    }
    return { accepts: value, kind: "boolean-schema" };
  }
  if (!isRecord(value)) {
    return unknownNode(ctx, "invalid", source, anchor);
  }
  if (typeof value.$ref === "string") {
    return referenceNode(ctx, value, source, anchor, depth);
  }
  if ("$ref" in value) {
    return unknownNode(ctx, "invalid", child(source, "$ref"), anchor);
  }
  return projectSchemaObject(ctx, value, source, anchor, depth);
}

function referenceNode(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  depth: number,
): SchemaNode {
  const reference = value.$ref as string;
  const resolved = ctx.resolve(child(source, "$ref"), reference);
  if (resolved === undefined) {
    const diagnosticId = ctx.capability(
      "SCHEMA_UNRESOLVED_REFERENCE",
      child(source, "$ref"),
      anchor,
    );
    return {
      diagnosticIds: [diagnosticId],
      kind: "unknown",
      reason: "unresolved",
    };
  }
  const schemaId = ctx.registerSchema(resolved.location);
  const siblings = Object.keys(value).filter((key) => key !== "$ref");
  if (siblings.length === 0) return { kind: "ref", schemaId };
  if (ctx.dialect === "oas30") {
    const diagnosticId = ctx.capability(
      "SCHEMA_IGNORED_ANNOTATION",
      source,
      anchor,
    );
    return { diagnosticIds: [diagnosticId], kind: "ref", schemaId };
  }
  const semantic = siblings.filter(
    (key) => !ANNOTATION_KEYS.has(key) && !key.startsWith("x-"),
  );
  const metadata = collectMetadata(ctx, value, source, anchor);
  if (semantic.length === 0) {
    return { ...metadata, kind: "ref", schemaId };
  }
  const siblingSchema: Record<string, unknown> = {};
  for (const key of semantic) siblingSchema[key] = value[key];
  return {
    ...metadata,
    kind: "composition",
    mode: "allOf",
    variants: [
      { kind: "ref", schemaId },
      normalizeSchema(
        ctx,
        siblingSchema,
        source,
        anchorChild(anchor, "allOf", "1"),
        depth + 1,
      ),
    ],
  };
}

function projectSchemaObject(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  depth: number,
): SchemaNode {
  const diagnosticIds: string[] = [];
  const metadata = collectMetadata(ctx, value, source, anchor);
  for (const key of Object.keys(value)) {
    if (
      key.startsWith("x-") ||
      ANNOTATION_KEYS.has(key) ||
      CORE_KEYS.has(key) ||
      CONTAINER_KEYS.has(key)
    ) {
      continue;
    }
    if (UNSUPPORTED_KEYS.has(key)) {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_UNSUPPORTED_SEMANTIC",
          child(source, key),
          anchorChild(anchor, key),
        ),
      );
      continue;
    }
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_IGNORED_ANNOTATION",
        child(source, key),
        anchorChild(anchor, key),
      ),
    );
  }
  if (ctx.dialect === "oas30" && "examples" in value) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_IGNORED_ANNOTATION",
        child(source, "examples"),
        anchorChild(anchor, "examples"),
      ),
    );
  }
  if (ctx.dialect === "oas30" && "const" in value) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_UNSUPPORTED_SEMANTIC",
        child(source, "const"),
        anchorChild(anchor, "const"),
      ),
    );
  }
  if (ctx.dialect === "oas31" && "nullable" in value) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_UNSUPPORTED_SEMANTIC",
        child(source, "nullable"),
        anchorChild(anchor, "nullable"),
      ),
    );
  }

  const types = declaredTypes(ctx, value, source, anchor, diagnosticIds);
  const compositions = collectCompositions(ctx, value, source, anchor, depth);
  const own =
    types === undefined
      ? typeLessSchema(ctx, value, source, anchor, depth, diagnosticIds)
      : projectOwnSchema(
          ctx,
          value,
          types,
          source,
          anchor,
          depth,
          diagnosticIds,
        );

  let node: SchemaNode;
  if (compositions.length === 0) {
    node = own ?? { kind: "any" };
  } else if (
    own === undefined &&
    compositions.length === 1 &&
    compositions[0] !== undefined
  ) {
    node = compositions[0];
  } else {
    node = {
      kind: "composition",
      mode: "allOf",
      variants: [...(own === undefined ? [] : [own]), ...compositions],
    };
  }
  if ("discriminator" in value) {
    node = applyDiscriminator(
      ctx,
      node,
      value.discriminator,
      source,
      anchor,
      diagnosticIds,
    );
  }
  return attachMetadata(node, metadata, diagnosticIds);
}

/**
 * Returns the declared instance types after dialect rules: 3.0 accepts one
 * type string plus `nullable`; 3.1 accepts a string or unique array including
 * `null`. `undefined` means no type was declared (type-less projection).
 */
function declaredTypes(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  diagnosticIds: string[],
): readonly SchemaInstanceType[] | undefined {
  const raw = value.type;
  const types: SchemaInstanceType[] = [];
  if (raw === undefined) {
    if (ctx.dialect === "oas30" && value.nullable === true) {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_IGNORED_ANNOTATION",
          child(source, "nullable"),
          anchorChild(anchor, "nullable"),
        ),
      );
    }
    return undefined;
  }
  const candidates = Array.isArray(raw) ? raw : [raw];
  if (Array.isArray(raw) && ctx.dialect === "oas30") {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_INVALID_SEMANTIC",
        child(source, "type"),
        anchorChild(anchor, "type"),
      ),
    );
    return undefined;
  }
  for (const candidate of candidates) {
    if (
      typeof candidate !== "string" ||
      !INSTANCE_TYPES.has(candidate as SchemaInstanceType) ||
      (ctx.dialect === "oas30" && candidate === "null") ||
      types.includes(candidate as SchemaInstanceType)
    ) {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_INVALID_SEMANTIC",
          child(source, "type"),
          anchorChild(anchor, "type"),
        ),
      );
      return undefined;
    }
    types.push(candidate as SchemaInstanceType);
  }
  if (
    ctx.dialect === "oas30" &&
    value.nullable === true &&
    !types.includes("null")
  ) {
    types.push("null");
  } else if (
    ctx.dialect === "oas30" &&
    value.nullable !== undefined &&
    typeof value.nullable !== "boolean"
  ) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_INVALID_SEMANTIC",
        child(source, "nullable"),
        anchorChild(anchor, "nullable"),
      ),
    );
  }
  return types;
}

function projectOwnSchema(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  types: readonly SchemaInstanceType[],
  source: SourceLocation,
  anchor: CanonicalAnchor,
  depth: number,
  diagnosticIds: string[],
): SchemaNode {
  const enumValues = readEnum(ctx, value, source, anchor, diagnosticIds);
  const constValue = readConst(ctx, value, source, anchor, diagnosticIds);
  if (types.length === 1 && types[0] !== undefined) {
    return projectTypedSchema(
      ctx,
      value,
      types[0],
      enumValues,
      constValue,
      source,
      anchor,
      depth,
      diagnosticIds,
    );
  }
  const variants = types.map((type, index) =>
    projectTypedSchema(
      ctx,
      value,
      type,
      filterByType(enumValues, type),
      constValue !== undefined && matchesType(constValue, type)
        ? constValue
        : undefined,
      source,
      anchorChild(anchor, "anyOf", String(index)),
      depth,
      diagnosticIds,
    ),
  );
  return { kind: "composition", mode: "anyOf", variants };
}

function projectTypedSchema(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  type: SchemaInstanceType,
  enumValues: readonly JsonValue[] | undefined,
  constValue: JsonValue | undefined,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  depth: number,
  diagnosticIds: string[],
): SchemaNode {
  reportInapplicableKeywords(ctx, value, type, source, anchor, diagnosticIds);
  switch (type) {
    case "null":
      return { kind: "scalar", type: "null" };
    case "boolean":
      return {
        kind: "scalar",
        type: "boolean",
        ...(enumValues === undefined ? {} : { enumValues }),
        ...(constValue === undefined ? {} : { constValue }),
      };
    case "string": {
      const constraints = stringConstraints(
        ctx,
        value,
        source,
        anchor,
        diagnosticIds,
      );
      const format =
        typeof value.format === "string" ? value.format : undefined;
      return {
        kind: "scalar",
        type: "string",
        ...(format === undefined ? {} : { format }),
        ...(constraints === undefined ? {} : { constraints }),
        ...(enumValues === undefined ? {} : { enumValues }),
        ...(constValue === undefined ? {} : { constValue }),
      };
    }
    case "integer":
    case "number": {
      const constraints = numericConstraints(
        ctx,
        value,
        source,
        anchor,
        diagnosticIds,
      );
      const format =
        typeof value.format === "string" ? value.format : undefined;
      return {
        kind: "scalar",
        type,
        ...(format === undefined ? {} : { format }),
        ...(constraints === undefined ? {} : { constraints }),
        ...(enumValues === undefined ? {} : { enumValues }),
        ...(constValue === undefined ? {} : { constValue }),
      };
    }
    case "object": {
      const object = objectConstraints(
        ctx,
        value,
        source,
        anchor,
        depth,
        diagnosticIds,
      );
      if (enumValues === undefined && constValue === undefined) {
        return { kind: "object", ...object };
      }
      return {
        applicableTypes: ["object"],
        kind: "type-less",
        object,
        ...(enumValues === undefined ? {} : { enumValues }),
        ...(constValue === undefined ? {} : { constValue }),
      };
    }
    case "array": {
      if (ctx.dialect === "oas31" && Array.isArray(value.prefixItems)) {
        return tupleSchema(ctx, value, source, anchor, depth, diagnosticIds);
      }
      const array = arrayConstraints(
        ctx,
        value,
        source,
        anchor,
        depth,
        diagnosticIds,
      );
      if (enumValues === undefined && constValue === undefined) {
        return { kind: "array", ...array };
      }
      return {
        applicableTypes: ["array"],
        array,
        kind: "type-less",
        ...(enumValues === undefined ? {} : { enumValues }),
        ...(constValue === undefined ? {} : { constValue }),
      };
    }
  }
}

function typeLessSchema(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  depth: number,
  diagnosticIds: string[],
): SchemaNode | undefined {
  const enumValues = readEnum(ctx, value, source, anchor, diagnosticIds);
  const constValue = readConst(ctx, value, source, anchor, diagnosticIds);
  const applicableTypes: SchemaInstanceType[] = [];
  const numeric = NUMERIC_KEYS.some((key) => value[key] !== undefined)
    ? numericConstraints(ctx, value, source, anchor, diagnosticIds)
    : undefined;
  if (numeric !== undefined) applicableTypes.push("integer", "number");
  let string: StringConstraints | undefined;
  if (
    STRING_KEYS.some((key) => value[key] !== undefined) ||
    typeof value.format === "string"
  ) {
    const constraints =
      stringConstraints(ctx, value, source, anchor, diagnosticIds) ?? {};
    const format = typeof value.format === "string" ? value.format : undefined;
    string = { ...constraints, ...(format === undefined ? {} : { format }) };
    if (Object.keys(string).length > 0) applicableTypes.push("string");
    else string = undefined;
  }
  let array: ArrayConstraints | undefined;
  if (ARRAY_KEYS.some((key) => value[key] !== undefined)) {
    if (Array.isArray(value.prefixItems)) {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_UNSUPPORTED_SEMANTIC",
          child(source, "prefixItems"),
          anchorChild(anchor, "prefixItems"),
        ),
      );
    }
    array = arrayConstraints(ctx, value, source, anchor, depth, diagnosticIds);
    applicableTypes.push("array");
  }
  let object: ObjectConstraints | undefined;
  if (OBJECT_KEYS.some((key) => value[key] !== undefined)) {
    object = objectConstraints(
      ctx,
      value,
      source,
      anchor,
      depth,
      diagnosticIds,
    );
    applicableTypes.push("object");
  }
  if (
    applicableTypes.length === 0 &&
    enumValues === undefined &&
    constValue === undefined
  ) {
    return undefined;
  }
  return {
    applicableTypes,
    kind: "type-less",
    ...(numeric === undefined ? {} : { numeric }),
    ...(string === undefined ? {} : { string }),
    ...(array === undefined ? {} : { array }),
    ...(object === undefined ? {} : { object }),
    ...(enumValues === undefined ? {} : { enumValues }),
    ...(constValue === undefined ? {} : { constValue }),
  };
}

function collectCompositions(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  depth: number,
): SchemaNode[] {
  const compositions: SchemaNode[] = [];
  for (const mode of ["allOf", "anyOf", "oneOf"] as const) {
    const list = value[mode];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length === 0) {
      ctx.invalid(child(source, mode));
      continue;
    }
    compositions.push({
      kind: "composition",
      mode,
      variants: list.map((item, index) =>
        normalizeSchema(
          ctx,
          item,
          child(source, mode, String(index)),
          anchorChild(anchor, mode, String(index)),
          depth + 1,
        ),
      ),
    });
  }
  if (value.not !== undefined) {
    compositions.push({
      kind: "composition",
      mode: "not",
      variants: [
        normalizeSchema(
          ctx,
          value.not,
          child(source, "not"),
          anchorChild(anchor, "not"),
          depth + 1,
        ),
      ],
    });
  }
  return compositions;
}

function applyDiscriminator(
  ctx: NormalizeContext,
  node: SchemaNode,
  raw: unknown,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  diagnosticIds: string[],
): SchemaNode {
  const discriminatorSource = child(source, "discriminator");
  if (
    !isRecord(raw) ||
    typeof raw.propertyName !== "string" ||
    raw.propertyName.length === 0
  ) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_INVALID_SEMANTIC",
        discriminatorSource,
        anchorChild(anchor, "discriminator"),
      ),
    );
    return node;
  }
  if (node.kind !== "composition" || node.mode === "not") {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_PARTIALLY_REPRESENTED",
        discriminatorSource,
        anchorChild(anchor, "discriminator"),
      ),
    );
    return node;
  }
  const mapping: Record<string, SchemaId> = {};
  if (raw.mapping !== undefined) {
    if (!isRecord(raw.mapping)) {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_INVALID_SEMANTIC",
          child(discriminatorSource, "mapping"),
          anchorChild(anchor, "discriminator", "mapping"),
        ),
      );
    } else {
      for (const [key, target] of Object.entries(raw.mapping)) {
        const mappingSource = child(discriminatorSource, "mapping", key);
        if (typeof target !== "string") {
          diagnosticIds.push(
            ctx.capability(
              "SCHEMA_INVALID_SEMANTIC",
              mappingSource,
              anchorChild(anchor, "discriminator", "mapping", key),
            ),
          );
          continue;
        }
        const reference =
          target.includes("/") || target.includes("#")
            ? target
            : `#/components/schemas/${target}`;
        const resolved = ctx.resolve(mappingSource, reference);
        if (resolved === undefined) {
          diagnosticIds.push(
            ctx.capability(
              "SCHEMA_PARTIALLY_REPRESENTED",
              mappingSource,
              anchorChild(anchor, "discriminator", "mapping", key),
            ),
          );
          continue;
        }
        mapping[key] = ctx.registerSchema(resolved.location);
      }
    }
  } else {
    let complete = true;
    for (const variant of node.variants) {
      if (variant.kind !== "ref") {
        complete = false;
        continue;
      }
      const name = componentName(ctx, variant.schemaId);
      if (name === undefined) complete = false;
      else mapping[name] = variant.schemaId;
    }
    if (!complete) {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_PARTIALLY_REPRESENTED",
          discriminatorSource,
          anchorChild(anchor, "discriminator"),
        ),
      );
    }
  }
  return {
    ...node,
    discriminator: { mapping, propertyName: raw.propertyName },
  };
}

function componentName(
  ctx: NormalizeContext,
  schemaId: SchemaId,
): string | undefined {
  for (const [location, id] of ctx.schemaLocations()) {
    if (id !== schemaId) continue;
    const match = /^#\/components\/schemas\/([^/]+)$/.exec(
      location.slice(location.indexOf("#")),
    );
    if (match?.[1] !== undefined)
      return match[1].replaceAll("~1", "/").replaceAll("~0", "~");
  }
  return undefined;
}

function collectMetadata(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
): SchemaMetadata {
  const metadata: {
    -readonly [Key in keyof SchemaMetadata]?: SchemaMetadata[Key];
  } = {};
  for (const key of ["title", "description"] as const) {
    const item = value[key];
    if (item === undefined) continue;
    if (typeof item !== "string") {
      ctx.invalid(child(source, key));
      continue;
    }
    metadata[key] = item;
  }
  for (const key of ["deprecated", "readOnly", "writeOnly"] as const) {
    const item = value[key];
    if (item === undefined) continue;
    if (typeof item !== "boolean") {
      ctx.invalid(child(source, key));
      continue;
    }
    metadata[key] = item;
  }
  if (value.default !== undefined) {
    const converted = ctx.toJsonValue(
      value.default,
      child(source, "default"),
      true,
    );
    if (converted !== undefined) metadata.defaultValue = converted;
  }
  const examples: JsonValue[] = [];
  if (value.example !== undefined) {
    const converted = ctx.toJsonValue(
      value.example,
      child(source, "example"),
      true,
    );
    if (converted !== undefined) examples.push(converted);
  }
  if (ctx.dialect === "oas31" && value.examples !== undefined) {
    if (!Array.isArray(value.examples)) {
      ctx.invalid(child(source, "examples"));
    } else {
      value.examples.forEach((item, index) => {
        const converted = ctx.toJsonValue(
          item,
          child(source, "examples", String(index)),
          true,
        );
        if (converted !== undefined) examples.push(converted);
      });
    }
  }
  if (examples.length > 0) metadata.examples = examples;
  const extensions = ctx.extensions(value, source);
  if (Object.keys(extensions).length > 0) metadata.extensions = extensions;
  void anchor;
  return metadata;
}

function attachMetadata(
  node: SchemaNode,
  metadata: SchemaMetadata,
  diagnosticIds: readonly string[],
): SchemaNode {
  const existing = node.diagnosticIds ?? [];
  const merged = [...new Set([...existing, ...diagnosticIds])].sort(
    compareText,
  );
  return {
    ...node,
    ...metadata,
    ...(merged.length === 0 ? {} : { diagnosticIds: merged }),
  } as SchemaNode;
}

function unknownNode(
  ctx: NormalizeContext,
  reason: "invalid" | "unsupported",
  source: SourceLocation,
  anchor: CanonicalAnchor,
): SchemaNode {
  const diagnosticId = ctx.capability(
    reason === "invalid"
      ? "SCHEMA_INVALID_SEMANTIC"
      : "SCHEMA_UNSUPPORTED_SEMANTIC",
    source,
    anchor,
  );
  return { diagnosticIds: [diagnosticId], kind: "unknown", reason };
}

function readEnum(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  diagnosticIds: string[],
): readonly JsonValue[] | undefined {
  if (value.enum === undefined) return undefined;
  if (!Array.isArray(value.enum) || value.enum.length === 0) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_INVALID_SEMANTIC",
        child(source, "enum"),
        anchorChild(anchor, "enum"),
      ),
    );
    return undefined;
  }
  const values: JsonValue[] = [];
  const seen = new Set<string>();
  let valid = true;
  value.enum.forEach((item, index) => {
    const converted = ctx.toJsonValue(
      item,
      child(source, "enum", String(index)),
    );
    if (converted === undefined) {
      valid = false;
      return;
    }
    const key = JSON.stringify(converted);
    if (seen.has(key)) {
      valid = false;
      return;
    }
    seen.add(key);
    values.push(converted);
  });
  if (!valid) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_INVALID_SEMANTIC",
        child(source, "enum"),
        anchorChild(anchor, "enum"),
      ),
    );
  }
  return values.length === 0 ? undefined : values;
}

function readConst(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  diagnosticIds: string[],
): JsonValue | undefined {
  if (!("const" in value) || ctx.dialect === "oas30") return undefined;
  const converted = ctx.toJsonValue(value.const, child(source, "const"));
  if (converted === undefined) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_INVALID_SEMANTIC",
        child(source, "const"),
        anchorChild(anchor, "const"),
      ),
    );
  }
  return converted;
}

function numericConstraints(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  diagnosticIds: string[],
): NumericConstraints | undefined {
  const constraints: {
    -readonly [Key in keyof NumericConstraints]?: number;
  } = {};
  const fail = (key: string): void => {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_INVALID_SEMANTIC",
        child(source, key),
        anchorChild(anchor, key),
      ),
    );
  };
  for (const key of ["minimum", "maximum", "multipleOf"] as const) {
    const item = value[key];
    if (item === undefined) continue;
    if (
      typeof item !== "number" ||
      !Number.isFinite(item) ||
      (key === "multipleOf" && item <= 0)
    ) {
      fail(key);
      continue;
    }
    constraints[key] = item;
  }
  for (const key of ["exclusiveMinimum", "exclusiveMaximum"] as const) {
    const item = value[key];
    if (item === undefined) continue;
    if (typeof item === "boolean") {
      if (ctx.dialect === "oas31") {
        fail(key);
        continue;
      }
      if (!item) continue;
      const paired = key === "exclusiveMinimum" ? "minimum" : "maximum";
      const bound = constraints[paired];
      if (bound === undefined) {
        fail(key);
        continue;
      }
      constraints[key] = bound;
      delete constraints[paired];
      continue;
    }
    if (
      typeof item !== "number" ||
      !Number.isFinite(item) ||
      ctx.dialect === "oas30"
    ) {
      fail(key);
      continue;
    }
    constraints[key] = item;
  }
  for (const [low, high] of [
    ["minimum", "maximum"],
    ["exclusiveMinimum", "exclusiveMaximum"],
  ] as const) {
    const minimum = constraints[low];
    const maximum = constraints[high];
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
      fail(low);
      delete constraints[low];
      delete constraints[high];
    }
  }
  return Object.keys(constraints).length === 0 ? undefined : constraints;
}

function stringConstraints(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  diagnosticIds: string[],
): Omit<StringConstraints, "format"> | undefined {
  const constraints: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  } = {};
  for (const key of ["minLength", "maxLength"] as const) {
    const item = value[key];
    if (item === undefined) continue;
    if (!Number.isSafeInteger(item) || Number(item) < 0) {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_INVALID_SEMANTIC",
          child(source, key),
          anchorChild(anchor, key),
        ),
      );
      continue;
    }
    constraints[key] = Number(item);
  }
  if (value.pattern !== undefined) {
    if (typeof value.pattern !== "string") {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_INVALID_SEMANTIC",
          child(source, "pattern"),
          anchorChild(anchor, "pattern"),
        ),
      );
    } else {
      constraints.pattern = value.pattern;
    }
  }
  if (
    constraints.minLength !== undefined &&
    constraints.maxLength !== undefined &&
    constraints.minLength > constraints.maxLength
  ) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_INVALID_SEMANTIC",
        child(source, "minLength"),
        anchorChild(anchor, "minLength"),
      ),
    );
    delete constraints.minLength;
    delete constraints.maxLength;
  }
  return Object.keys(constraints).length === 0 ? undefined : constraints;
}

function boundedCount(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  key: string,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  diagnosticIds: string[],
): number | undefined {
  const item = value[key];
  if (item === undefined) return undefined;
  if (!Number.isSafeInteger(item) || Number(item) < 0) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_INVALID_SEMANTIC",
        child(source, key),
        anchorChild(anchor, key),
      ),
    );
    return undefined;
  }
  return Number(item);
}

function orderedPair(
  ctx: NormalizeContext,
  minimum: number | undefined,
  maximum: number | undefined,
  key: string,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  diagnosticIds: string[],
): readonly [number | undefined, number | undefined] {
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_INVALID_SEMANTIC",
        child(source, key),
        anchorChild(anchor, key),
      ),
    );
    return [undefined, undefined];
  }
  return [minimum, maximum];
}

function objectConstraints(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  depth: number,
  diagnosticIds: string[],
): ObjectConstraints {
  const properties: Record<string, SchemaNode> = {};
  const propertyOrder: string[] = [];
  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_INVALID_SEMANTIC",
          child(source, "properties"),
          anchorChild(anchor, "properties"),
        ),
      );
    } else {
      for (const [name, schema] of Object.entries(value.properties)) {
        properties[name] = normalizeSchema(
          ctx,
          schema,
          child(source, "properties", name),
          anchorChild(anchor, "properties", name),
          depth + 1,
        );
        propertyOrder.push(name);
      }
    }
  }
  const required: string[] = [];
  if (value.required !== undefined) {
    if (!Array.isArray(value.required)) {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_INVALID_SEMANTIC",
          child(source, "required"),
          anchorChild(anchor, "required"),
        ),
      );
    } else {
      const seen = new Set<string>();
      let valid = true;
      for (const item of value.required) {
        if (typeof item !== "string" || seen.has(item.normalize("NFC"))) {
          valid = false;
          continue;
        }
        seen.add(item.normalize("NFC"));
        required.push(item);
      }
      if (!valid) {
        diagnosticIds.push(
          ctx.capability(
            "SCHEMA_INVALID_SEMANTIC",
            child(source, "required"),
            anchorChild(anchor, "required"),
          ),
        );
      }
    }
  }
  let additionalProperties: boolean | SchemaNode = true;
  if (typeof value.additionalProperties === "boolean") {
    additionalProperties = value.additionalProperties;
  } else if (value.additionalProperties !== undefined) {
    additionalProperties = normalizeSchema(
      ctx,
      value.additionalProperties,
      child(source, "additionalProperties"),
      anchorChild(anchor, "additionalProperties"),
      depth + 1,
    );
  }
  const [minProperties, maxProperties] = orderedPair(
    ctx,
    boundedCount(ctx, value, "minProperties", source, anchor, diagnosticIds),
    boundedCount(ctx, value, "maxProperties", source, anchor, diagnosticIds),
    "minProperties",
    source,
    anchor,
    diagnosticIds,
  );
  return {
    additionalProperties,
    ...(maxProperties === undefined ? {} : { maxProperties }),
    ...(minProperties === undefined ? {} : { minProperties }),
    properties,
    propertyOrder,
    required,
  };
}

function arrayConstraints(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  depth: number,
  diagnosticIds: string[],
): ArrayConstraints {
  let items: SchemaNode = { kind: "any" };
  if (value.items !== undefined) {
    if (Array.isArray(value.items)) {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_INVALID_SEMANTIC",
          child(source, "items"),
          anchorChild(anchor, "items"),
        ),
      );
    } else {
      items = normalizeSchema(
        ctx,
        value.items,
        child(source, "items"),
        anchorChild(anchor, "items"),
        depth + 1,
      );
    }
  }
  const contains =
    value.contains === undefined
      ? undefined
      : normalizeSchema(
          ctx,
          value.contains,
          child(source, "contains"),
          anchorChild(anchor, "contains"),
          depth + 1,
        );
  const [minItems, maxItems] = orderedPair(
    ctx,
    boundedCount(ctx, value, "minItems", source, anchor, diagnosticIds),
    boundedCount(ctx, value, "maxItems", source, anchor, diagnosticIds),
    "minItems",
    source,
    anchor,
    diagnosticIds,
  );
  let [minContains, maxContains] = orderedPair(
    ctx,
    boundedCount(ctx, value, "minContains", source, anchor, diagnosticIds),
    boundedCount(ctx, value, "maxContains", source, anchor, diagnosticIds),
    "minContains",
    source,
    anchor,
    diagnosticIds,
  );
  if (
    contains === undefined &&
    (minContains !== undefined || maxContains !== undefined)
  ) {
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_INVALID_SEMANTIC",
        child(source, "contains"),
        anchorChild(anchor, "contains"),
      ),
    );
    minContains = undefined;
    maxContains = undefined;
  }
  let uniqueItems: boolean | undefined;
  if (value.uniqueItems !== undefined) {
    if (typeof value.uniqueItems !== "boolean") {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_INVALID_SEMANTIC",
          child(source, "uniqueItems"),
          anchorChild(anchor, "uniqueItems"),
        ),
      );
    } else {
      uniqueItems = value.uniqueItems;
    }
  }
  return {
    items,
    ...(contains === undefined ? {} : { contains }),
    ...(maxContains === undefined ? {} : { maxContains }),
    ...(maxItems === undefined ? {} : { maxItems }),
    ...(minContains === undefined ? {} : { minContains }),
    ...(minItems === undefined ? {} : { minItems }),
    ...(uniqueItems === undefined ? {} : { uniqueItems }),
  };
}

function tupleSchema(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  depth: number,
  diagnosticIds: string[],
): SchemaNode {
  const prefix = value.prefixItems as readonly unknown[];
  const prefixItems = prefix.map((item, index) =>
    normalizeSchema(
      ctx,
      item,
      child(source, "prefixItems", String(index)),
      anchorChild(anchor, "prefixItems", String(index)),
      depth + 1,
    ),
  );
  let additionalItems: boolean | SchemaNode = true;
  if (value.items === false) additionalItems = false;
  else if (value.items !== undefined && value.items !== true) {
    additionalItems = normalizeSchema(
      ctx,
      value.items,
      child(source, "items"),
      anchorChild(anchor, "items"),
      depth + 1,
    );
  }
  for (const key of [
    "contains",
    "minContains",
    "maxContains",
    "uniqueItems",
  ] as const) {
    if (value[key] !== undefined) {
      diagnosticIds.push(
        ctx.capability(
          "SCHEMA_PARTIALLY_REPRESENTED",
          child(source, key),
          anchorChild(anchor, key),
        ),
      );
    }
  }
  const [minItems, maxItems] = orderedPair(
    ctx,
    boundedCount(ctx, value, "minItems", source, anchor, diagnosticIds),
    boundedCount(ctx, value, "maxItems", source, anchor, diagnosticIds),
    "minItems",
    source,
    anchor,
    diagnosticIds,
  );
  return {
    additionalItems,
    kind: "tuple",
    ...(maxItems === undefined ? {} : { maxItems }),
    ...(minItems === undefined ? {} : { minItems }),
    prefixItems,
  };
}

function reportInapplicableKeywords(
  ctx: NormalizeContext,
  value: Readonly<Record<string, unknown>>,
  type: SchemaInstanceType,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  diagnosticIds: string[],
): void {
  const inapplicable: string[] = [];
  if (type !== "number" && type !== "integer")
    inapplicable.push(...NUMERIC_KEYS);
  if (type !== "string") inapplicable.push(...STRING_KEYS);
  if (type !== "array") inapplicable.push(...ARRAY_KEYS);
  if (type !== "object") inapplicable.push(...OBJECT_KEYS);
  for (const key of inapplicable) {
    if (value[key] === undefined) continue;
    // Multi-type projections legitimately carry keywords for sibling types.
    if (Array.isArray(value.type) && value.type.length > 1) continue;
    diagnosticIds.push(
      ctx.capability(
        "SCHEMA_IGNORED_ANNOTATION",
        child(source, key),
        anchorChild(anchor, key),
      ),
    );
  }
}

function filterByType(
  values: readonly JsonValue[] | undefined,
  type: SchemaInstanceType,
): readonly JsonValue[] | undefined {
  if (values === undefined) return undefined;
  const filtered = values.filter((item) => matchesType(item, type));
  return filtered.length === 0 ? undefined : filtered;
}

function matchesType(value: JsonValue, type: SchemaInstanceType): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return (
        value !== null && typeof value === "object" && !Array.isArray(value)
      );
  }
}
