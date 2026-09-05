import type {
  ApiService,
  ArrayConstraints,
  JsonValue,
  ObjectConstraints,
  SchemaId,
  SchemaNode,
} from "@specra/model";

/**
 * Schema view projection (SPEC-005). Turns a canonical `SchemaNode` into a
 * bounded, context-aware tree of `SchemaView` nodes that the server renderer
 * turns into HTML. The projection never invents semantics the model does not
 * carry: it resolves registry references, marks recursion, applies read/write
 * context to object properties, and stops at explicit budgets, explaining
 * what it left out so the renderer can offer a focused view instead.
 *
 * Every node carries a structural locator (`p3.i.v1`) that identifies it from
 * the block root independently of object identity or context, so expansion
 * state, deep links, and focused views stay deterministic and testable.
 */

export type SchemaContext = "request" | "response";

export interface SchemaBudget {
  /** Nesting levels rendered inline; deeper expandable nodes become links. */
  readonly maxDepth: number;
  /** Total view nodes per block; further expandable nodes become links. */
  readonly maxNodes: number;
  /** Properties shown before the remainder sits behind a disclosure. */
  readonly initialProperties: number;
  /** Properties rendered per object; the rest is a count and a link. */
  readonly maxProperties: number;
  /** Variants rendered per composition; the rest is a count and a link. */
  readonly maxVariants: number;
  /** Enum values shown inline before a count. */
  readonly enumPreview: number;
  /** Enum values kept in the view at all. */
  readonly maxEnumValues: number;
}

/**
 * Defaults measured against the schema corpus (`tests/reader/schema-view.test.ts`
 * and `tests/performance/schema-render.test.ts`): a 200-property object renders
 * as ~1,900 DOM nodes, six levels keep the deepest fixture readable at 320 px,
 * and 600 nodes keep a complex operation page under the HTML budget.
 */
export const DEFAULT_SCHEMA_BUDGET: SchemaBudget = {
  enumPreview: 8,
  initialProperties: 30,
  maxDepth: 6,
  maxEnumValues: 200,
  maxNodes: 600,
  maxProperties: 200,
  maxVariants: 20,
};

export type SchemaFlag = "deprecated" | "nullable" | "read-only" | "write-only";

export type ValueKind =
  "any" | "false" | "scalar" | "true" | "type-less" | "unknown";

export interface SchemaViewBase {
  /** Structural locator from the block root; `""` is the root. */
  readonly locator: string;
  /** Human type phrase, e.g. `string · email`, `array of User`, `one of 3`. */
  readonly label: string;
  /** Definition name when the node is a named registry entry. */
  readonly name?: string;
  readonly title?: string;
  readonly description?: string;
  /** Mono constraints line, e.g. `default 3600 · min 60 · max 86400`. */
  readonly constraints?: string;
  readonly flags: readonly SchemaFlag[];
  readonly enumeration?: {
    readonly values: readonly string[];
    /** Values beyond `enumPreview`, kept for a disclosure. */
    readonly more: readonly string[];
    /** Values dropped beyond `maxEnumValues`. */
    readonly dropped: number;
  };
  /** Set when the node was reached through a registry reference. */
  readonly reference?: { readonly schemaId: string; readonly name?: string };
}

export interface PropertyView {
  readonly name: string;
  readonly required: boolean;
  readonly schema: SchemaView;
}

export interface OmittedProperties {
  readonly reason: "read-only" | "write-only";
  readonly names: readonly string[];
}

export interface VariantView {
  readonly label: string;
  readonly schema: SchemaView;
  /** Discriminator values that select this variant. */
  readonly values: readonly string[];
}

export interface DiscriminatorView {
  readonly propertyName: string;
  readonly mapping: readonly {
    readonly value: string;
    readonly label: string;
    /** Locator of the matching rendered variant, when it is rendered. */
    readonly locator?: string;
  }[];
}

export type SchemaView = SchemaViewBase &
  (
    | {
        readonly kind: "value";
        readonly valueKind: ValueKind;
        /** Applicable instance types of a type-less node. */
        readonly applicableTypes?: readonly string[];
        readonly reason?: "invalid" | "unresolved" | "unsupported";
      }
    | {
        readonly kind: "object";
        /** True for a type-less node carrying object keywords. */
        readonly typeLess: boolean;
        readonly properties: readonly PropertyView[];
        /** Properties beyond `initialProperties`, rendered behind a disclosure. */
        readonly hidden: readonly PropertyView[];
        /** Properties beyond `maxProperties`, available in the focused view. */
        readonly more: number;
        readonly omitted?: OmittedProperties;
        readonly additional: SchemaView | "any" | "none";
      }
    | {
        readonly kind: "array";
        readonly typeLess: boolean;
        readonly items: SchemaView;
        readonly contains?: SchemaView;
      }
    | {
        readonly kind: "tuple";
        readonly slots: readonly SchemaView[];
        readonly rest: SchemaView | "any" | "none";
      }
    | {
        readonly kind: "composition";
        readonly mode: "allOf" | "anyOf" | "oneOf";
        readonly variants: readonly VariantView[];
        readonly more: number;
        readonly discriminator?: DiscriminatorView;
      }
    | { readonly kind: "not"; readonly schema: SchemaView }
    | {
        /** The referenced schema is already open above this node. */
        readonly kind: "cycle";
      }
    | {
        /** Expandable content beyond the budget; opened through the focused view. */
        readonly kind: "truncated";
        readonly reason: "depth" | "nodes";
      }
  );

export interface SchemaViewOptions {
  readonly registry: ApiService["schemas"];
  readonly context: SchemaContext;
  readonly budget?: Partial<SchemaBudget>;
  /** Locator prefix of the root, for focused views. */
  readonly locator?: string;
  /** Registry ids open above the root, for focused views. */
  readonly ancestors?: readonly SchemaId[];
}

export interface TrailEntry {
  readonly label: string;
  readonly locator: string;
}

export interface LocatorTarget {
  readonly node: SchemaNode;
  readonly ancestors: readonly SchemaId[];
  readonly trail: readonly TrailEntry[];
}

/** Locators are structural steps only, never author text. */
export const LOCATOR_PATTERN = /^[a-z][0-9]{0,6}(?:\.[a-z][0-9]{0,6}){0,39}$/;

type Registry = ApiService["schemas"];

interface State {
  readonly registry: Registry;
  readonly context: SchemaContext;
  readonly budget: SchemaBudget;
  nodes: number;
}

/** Projects one schema block for rendering. */
export function createSchemaView(
  node: SchemaNode,
  options: SchemaViewOptions,
): SchemaView {
  const state: State = {
    budget: { ...DEFAULT_SCHEMA_BUDGET, ...options.budget },
    context: options.context,
    nodes: 0,
    registry: options.registry,
  };
  return project(node, {
    ancestors: options.ancestors ?? [],
    depth: 0,
    locator: options.locator ?? "",
    state,
  });
}

/** One-line type phrase for compact contexts such as parameter rows. */
export function schemaLabel(node: SchemaNode, registry: Registry): string {
  return labelFor(node, registry, [], 0);
}

/**
 * Resolves a locator against the unbounded canonical structure. Steps: `p<i>`
 * property (index in canonical display order, context independent), `i` items,
 * `c` contains, `t<i>` tuple slot, `r` rest items, `a` additional properties,
 * `v<i>` composition variant, `n` the `not` operand. References are transparent.
 * Returns `undefined` for a malformed or dangling locator.
 */
export function resolveLocator(
  root: SchemaNode,
  registry: Registry,
  locator: string,
): LocatorTarget | undefined {
  if (locator === "") return { ancestors: [], node: root, trail: [] };
  if (!LOCATOR_PATTERN.test(locator)) return undefined;
  const trail: TrailEntry[] = [];
  let current = resolveReference(root, registry, []);
  const steps = locator.split(".");
  let walked = "";
  for (const step of steps) {
    const next = child(current.node, step, registry);
    if (next === undefined) return undefined;
    walked = walked === "" ? step : `${walked}.${step}`;
    trail.push({ label: next.label, locator: walked });
    current = resolveReference(next.node, registry, current.ancestors);
  }
  return { ancestors: current.ancestors, node: current.node, trail };
}

/** Counts the nodes of a projected view, for budgets and evidence. */
export function countViewNodes(view: SchemaView): number {
  let total = 1;
  switch (view.kind) {
    case "object":
      for (const property of view.properties)
        total += countViewNodes(property.schema);
      for (const property of view.hidden)
        total += countViewNodes(property.schema);
      if (typeof view.additional === "object")
        total += countViewNodes(view.additional);
      break;
    case "array":
      total += countViewNodes(view.items);
      if (view.contains !== undefined) total += countViewNodes(view.contains);
      break;
    case "tuple":
      for (const slot of view.slots) total += countViewNodes(slot);
      if (typeof view.rest === "object") total += countViewNodes(view.rest);
      break;
    case "composition":
      for (const variant of view.variants)
        total += countViewNodes(variant.schema);
      break;
    case "not":
      total += countViewNodes(view.schema);
      break;
    default:
      break;
  }
  return total;
}

interface Frame {
  readonly state: State;
  readonly locator: string;
  readonly depth: number;
  readonly ancestors: readonly SchemaId[];
}

interface Resolved {
  readonly node: SchemaNode;
  /** The reference node when one was followed. */
  readonly via?: SchemaNode & { readonly kind: "ref" };
  readonly cycle?: SchemaId;
  readonly ancestors: readonly SchemaId[];
}

/**
 * Follows `ref` chains to the registry target. The returned chain extends the
 * caller's ancestry with every reference followed; `cycle` is set when a
 * reference points at a schema that is already open above it, in which case
 * the chain is not extended (the target is still returned so a focused view
 * can open exactly one more level).
 */
function resolveReference(
  node: SchemaNode,
  registry: Registry,
  ancestors: readonly SchemaId[],
): Resolved {
  let current = node;
  let via: (SchemaNode & { readonly kind: "ref" }) | undefined;
  let cycle: SchemaId | undefined;
  const chain = [...ancestors];
  for (let hop = 0; hop < 32; hop += 1) {
    if (current.kind !== "ref") break;
    via ??= current;
    const target = registry[current.schemaId];
    if (target === undefined) break;
    if (chain.includes(current.schemaId)) {
      cycle = current.schemaId;
      current = target;
      break;
    }
    chain.push(current.schemaId);
    current = target;
  }
  return {
    ancestors: chain,
    node: current,
    ...(via === undefined ? {} : { via }),
    ...(cycle === undefined ? {} : { cycle }),
  };
}

function project(node: SchemaNode, frame: Frame): SchemaView {
  const { state } = frame;
  const resolved = resolveReference(node, state.registry, frame.ancestors);
  const base = baseView(node, resolved, frame);
  state.nodes += 1;
  if (resolved.cycle !== undefined) {
    return { ...base, kind: "cycle" };
  }
  const target = resolved.node;
  const inner: Frame = { ...frame, ancestors: resolved.ancestors };
  const expandable = isExpandable(target, state.registry);
  if (expandable && frame.depth >= state.budget.maxDepth) {
    return { ...base, kind: "truncated", reason: "depth" };
  }
  if (expandable && state.nodes > state.budget.maxNodes) {
    return { ...base, kind: "truncated", reason: "nodes" };
  }
  switch (target.kind) {
    case "any":
      return { ...base, kind: "value", valueKind: "any" };
    case "boolean-schema":
      return {
        ...base,
        kind: "value",
        valueKind: target.accepts ? "true" : "false",
      };
    case "unknown":
      return {
        ...base,
        kind: "value",
        reason: target.reason,
        valueKind: "unknown",
      };
    case "scalar":
      return { ...base, kind: "value", valueKind: "scalar" };
    case "type-less":
      if (target.object !== undefined) {
        return objectView(base, target.object, inner, true);
      }
      if (target.array !== undefined) {
        return arrayView(base, target.array, inner, true);
      }
      return {
        ...base,
        applicableTypes: target.applicableTypes,
        kind: "value",
        valueKind: "type-less",
      };
    case "object":
      return objectView(base, target, inner, false);
    case "array":
      return arrayView(base, target, inner, false);
    case "tuple":
      return {
        ...base,
        kind: "tuple",
        rest:
          typeof target.additionalItems === "boolean"
            ? target.additionalItems
              ? "any"
              : "none"
            : project(target.additionalItems, childFrame(inner, "r")),
        slots: target.prefixItems.map((slot, index) =>
          project(slot, childFrame(inner, `t${index}`)),
        ),
      };
    case "composition":
      return compositionView(base, target, inner);
    case "ref":
      // Unresolvable reference: the registry has no such entry.
      return {
        ...base,
        kind: "value",
        reason: "unresolved",
        valueKind: "unknown",
      };
  }
}

function childFrame(frame: Frame, step: string): Frame {
  return {
    ...frame,
    depth: frame.depth + 1,
    locator: frame.locator === "" ? step : `${frame.locator}.${step}`,
  };
}

function baseView(
  node: SchemaNode,
  resolved: Resolved,
  frame: Frame,
): SchemaViewBase {
  const target = resolved.node;
  const { registry } = frame.state;
  const nullable = isNullable(target);
  const concrete = nullable ? concreteVariant(target) : undefined;
  const described =
    concrete === undefined
      ? target
      : resolveReference(concrete, registry, resolved.ancestors).node;
  const flags: SchemaFlag[] = [];
  if (node.deprecated === true || described.deprecated === true)
    flags.push("deprecated");
  if (nullable) flags.push("nullable");
  if (node.readOnly === true || described.readOnly === true)
    flags.push("read-only");
  if (node.writeOnly === true || described.writeOnly === true)
    flags.push("write-only");
  const description = node.description ?? described.description;
  const title = node.title ?? described.title;
  const name = described.name;
  const constraints = constraintsLine(described);
  const enumeration = enumerationOf(described, frame.state.budget);
  return {
    flags,
    label: labelFor(node, registry, [], 0),
    locator: frame.locator,
    ...(name === undefined ? {} : { name }),
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(constraints === undefined ? {} : { constraints }),
    ...(enumeration === undefined ? {} : { enumeration }),
    ...(resolved.via === undefined
      ? {}
      : {
          reference: {
            schemaId: resolved.via.schemaId,
            ...(described.name === undefined ? {} : { name: described.name }),
          },
        }),
  };
}

function objectView(
  base: SchemaViewBase,
  constraints: ObjectConstraints,
  frame: Frame,
  typeLess: boolean,
): SchemaView {
  const { state } = frame;
  const required = new Set(constraints.required);
  const omittedNames: string[] = [];
  const reason = state.context === "request" ? "read-only" : "write-only";
  const rows: PropertyView[] = [];
  let more = 0;
  constraints.propertyOrder.forEach((name, index) => {
    const property = constraints.properties[name];
    if (property === undefined) return;
    if (isOmitted(property, state.registry, state.context)) {
      omittedNames.push(name);
      return;
    }
    if (rows.length >= state.budget.maxProperties) {
      more += 1;
      return;
    }
    rows.push({
      name,
      required: required.has(name),
      schema: project(property, childFrame(frame, `p${index}`)),
    });
  });
  const additional =
    typeof constraints.additionalProperties === "boolean"
      ? constraints.additionalProperties
        ? "any"
        : "none"
      : project(constraints.additionalProperties, childFrame(frame, "a"));
  return {
    ...base,
    additional,
    hidden: rows.slice(state.budget.initialProperties),
    kind: "object",
    more,
    ...(omittedNames.length === 0
      ? {}
      : { omitted: { names: omittedNames, reason } }),
    properties: rows.slice(0, state.budget.initialProperties),
    typeLess,
  };
}

function arrayView(
  base: SchemaViewBase,
  constraints: ArrayConstraints,
  frame: Frame,
  typeLess: boolean,
): SchemaView {
  return {
    ...base,
    ...(constraints.contains === undefined
      ? {}
      : { contains: project(constraints.contains, childFrame(frame, "c")) }),
    items: project(constraints.items, childFrame(frame, "i")),
    kind: "array",
    typeLess,
  };
}

function compositionView(
  base: SchemaViewBase,
  node: SchemaNode & { readonly kind: "composition" },
  frame: Frame,
): SchemaView {
  const { state } = frame;
  if (node.mode === "not") {
    return {
      ...base,
      kind: "not",
      schema: project(node.variants[0], childFrame(frame, "n")),
    };
  }
  // `X or null` reads as the concrete schema with a nullable flag; its
  // children keep the variant step so locators stay structural.
  if (isNullable(node)) {
    const index = node.variants.findIndex((variant) => !isNull(variant));
    const concrete = node.variants[index];
    if (concrete !== undefined) {
      const view = project(concrete, {
        ...frame,
        locator: stepLocator(frame.locator, `v${index}`),
      });
      return {
        ...view,
        flags: [...new Set([...base.flags, ...view.flags])],
        label: base.label,
        ...(base.description === undefined
          ? {}
          : { description: base.description }),
      };
    }
  }
  const shown = node.variants.slice(0, state.budget.maxVariants);
  const mapping = node.discriminator?.mapping ?? {};
  const valuesByVariant = shown.map((variant) =>
    variant.kind === "ref"
      ? Object.entries(mapping)
          .filter(([, target]) => target === variant.schemaId)
          .map(([value]) => value)
      : [],
  );
  const variants: VariantView[] = shown.map((variant, index) => {
    const schema = project(variant, childFrame(frame, `v${index}`));
    return {
      label: schema.name ?? schema.title ?? schema.label,
      schema,
      values: valuesByVariant[index] ?? [],
    };
  });
  const discriminator =
    node.discriminator === undefined
      ? undefined
      : {
          mapping: Object.entries(mapping).map(([value, target]) => {
            const index = shown.findIndex(
              (variant) =>
                variant.kind === "ref" && variant.schemaId === target,
            );
            const registryTarget = state.registry[target];
            const label =
              variants[index]?.label ??
              registryTarget?.name ??
              registryTarget?.title ??
              (registryTarget === undefined
                ? "unresolved schema"
                : labelFor(registryTarget, state.registry, [], 0));
            return {
              label,
              value,
              ...(index === -1
                ? {}
                : { locator: stepLocator(frame.locator, `v${index}`) }),
            };
          }),
          propertyName: node.discriminator.propertyName,
        };
  return {
    ...base,
    ...(discriminator === undefined ? {} : { discriminator }),
    kind: "composition",
    mode: node.mode,
    more: node.variants.length - shown.length,
    variants,
  };
}

function stepLocator(locator: string, step: string): string {
  return locator === "" ? step : `${locator}.${step}`;
}

/** A property is omitted when its annotation contradicts the context. */
function isOmitted(
  property: SchemaNode,
  registry: Registry,
  context: SchemaContext,
): boolean {
  const target = resolveReference(property, registry, []).node;
  const key = context === "request" ? "readOnly" : "writeOnly";
  return property[key] === true || target[key] === true;
}

function isExpandable(node: SchemaNode, registry: Registry): boolean {
  switch (node.kind) {
    case "object":
      return (
        node.propertyOrder.length > 0 ||
        typeof node.additionalProperties === "object"
      );
    case "array":
    case "tuple":
      return true;
    case "composition":
      if (node.mode === "not") return true;
      if (isNullable(node)) {
        const concrete = concreteVariant(node);
        return concrete === undefined
          ? false
          : isExpandable(
              resolveReference(concrete, registry, []).node,
              registry,
            );
      }
      return true;
    case "type-less":
      return node.object !== undefined || node.array !== undefined;
    default:
      return false;
  }
}

function isLeaf(node: SchemaNode): boolean {
  return (
    node.kind === "scalar" ||
    node.kind === "any" ||
    node.kind === "boolean-schema" ||
    node.kind === "unknown" ||
    (node.kind === "type-less" &&
      node.object === undefined &&
      node.array === undefined)
  );
}

function isNull(node: SchemaNode): boolean {
  return node.kind === "scalar" && node.type === "null";
}

/** `anyOf`/`oneOf` of exactly one concrete schema plus `null`. */
function isNullable(node: SchemaNode): boolean {
  return (
    node.kind === "composition" &&
    node.mode !== "not" &&
    node.mode !== "allOf" &&
    node.variants.length === 2 &&
    node.variants.some(isNull) &&
    !node.variants.every(isNull)
  );
}

function concreteVariant(node: SchemaNode): SchemaNode | undefined {
  if (node.kind !== "composition" || node.mode === "not") return undefined;
  return node.variants.find((variant) => !isNull(variant));
}

/** Child lookup by locator step on the canonical structure. */
function child(
  node: SchemaNode,
  step: string,
  registry: Registry,
): { readonly node: SchemaNode; readonly label: string } | undefined {
  const kind = step[0];
  const index = step.length > 1 ? Number(step.slice(1)) : undefined;
  switch (node.kind) {
    case "object":
      return objectChild(node, kind, index);
    case "type-less":
      if (node.object !== undefined)
        return objectChild(node.object, kind, index);
      if (node.array !== undefined) return arrayChild(node.array, kind);
      return undefined;
    case "array":
      return arrayChild(node, kind);
    case "tuple":
      if (kind === "t" && index !== undefined) {
        const slot = node.prefixItems[index];
        return slot === undefined
          ? undefined
          : { label: `item ${index}`, node: slot };
      }
      if (kind === "r" && typeof node.additionalItems === "object") {
        return { label: "further items", node: node.additionalItems };
      }
      return undefined;
    case "composition":
      if (node.mode === "not") {
        return kind === "n"
          ? { label: "not", node: node.variants[0] }
          : undefined;
      }
      if (kind === "v" && index !== undefined) {
        const variant = node.variants[index];
        if (variant === undefined) return undefined;
        const resolved = resolveReference(variant, registry, []).node;
        return {
          label:
            resolved.name ??
            resolved.title ??
            `${VARIANT_WORD[node.mode]} ${index + 1}`,
          node: variant,
        };
      }
      return undefined;
    default:
      return undefined;
  }
}

const VARIANT_WORD = {
  allOf: "part",
  anyOf: "option",
  oneOf: "variant",
} as const;

function objectChild(
  constraints: ObjectConstraints,
  kind: string | undefined,
  index: number | undefined,
): { readonly node: SchemaNode; readonly label: string } | undefined {
  if (kind === "p" && index !== undefined) {
    const name = constraints.propertyOrder[index];
    const property =
      name === undefined ? undefined : constraints.properties[name];
    return name === undefined || property === undefined
      ? undefined
      : { label: name, node: property };
  }
  if (kind === "a" && typeof constraints.additionalProperties === "object") {
    return {
      label: "additional properties",
      node: constraints.additionalProperties,
    };
  }
  return undefined;
}

function arrayChild(
  constraints: ArrayConstraints,
  kind: string | undefined,
): { readonly node: SchemaNode; readonly label: string } | undefined {
  if (kind === "i") return { label: "items", node: constraints.items };
  if (kind === "c" && constraints.contains !== undefined) {
    return { label: "contains", node: constraints.contains };
  }
  return undefined;
}

const MAX_LABEL_HOPS = 8;

/** Human type phrase; names win over shapes, shapes never invent a type. */
function labelFor(
  node: SchemaNode,
  registry: Registry,
  seen: readonly SchemaId[],
  depth: number,
): string {
  if (depth > MAX_LABEL_HOPS) return "schema";
  switch (node.kind) {
    case "any":
      return "any value";
    case "boolean-schema":
      return node.accepts ? "any value" : "no value";
    case "unknown":
      return "not represented";
    case "ref": {
      const target = registry[node.schemaId];
      if (target === undefined) return "unresolved schema";
      // Structured definitions read by name; a named leaf still reads by its
      // semantic phrase (the name travels separately on the view).
      if (!isLeaf(target)) {
        if (target.name !== undefined) return target.name;
        if (target.title !== undefined) return target.title;
      }
      if (seen.includes(node.schemaId)) return "schema";
      return labelFor(target, registry, [...seen, node.schemaId], depth + 1);
    }
    case "scalar": {
      if (node.constValue !== undefined) return `${node.type} · constant`;
      const base =
        node.format === undefined ? node.type : `${node.type} · ${node.format}`;
      return node.enumValues === undefined ? base : `${base} · enum`;
    }
    case "array":
      return `array of ${labelFor(node.items, registry, seen, depth + 1)}`;
    case "tuple":
      return `tuple of ${node.prefixItems.length} item${node.prefixItems.length === 1 ? "" : "s"}`;
    case "object": {
      if (node.name !== undefined) return node.name;
      if (node.title !== undefined) return node.title;
      if (
        node.propertyOrder.length === 0 &&
        typeof node.additionalProperties === "object"
      ) {
        return `map of ${labelFor(node.additionalProperties, registry, seen, depth + 1)}`;
      }
      return "object";
    }
    case "type-less":
      return "unspecified type";
    case "composition": {
      if (node.name !== undefined) return node.name;
      if (node.title !== undefined) return node.title;
      if (node.mode === "not") {
        return `not ${labelFor(node.variants[0], registry, seen, depth + 1)}`;
      }
      if (isNullable(node)) {
        const concrete = concreteVariant(node);
        return concrete === undefined
          ? "null"
          : `${labelFor(concrete, registry, seen, depth + 1)} or null`;
      }
      const count = node.variants.length;
      if (node.mode === "allOf") return `all of ${count}`;
      return node.mode === "oneOf" ? `one of ${count}` : `any of ${count}`;
    }
  }
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
    if (node.constraints !== undefined) {
      const { constraints } = node;
      if (
        constraints.minimum !== undefined &&
        constraints.maximum !== undefined
      ) {
        parts.push(`${constraints.minimum}–${constraints.maximum}`);
      } else {
        if (constraints.minimum !== undefined)
          parts.push(`min ${constraints.minimum}`);
        if (constraints.maximum !== undefined)
          parts.push(`max ${constraints.maximum}`);
      }
      if (constraints.exclusiveMinimum !== undefined) {
        parts.push(`greater than ${constraints.exclusiveMinimum}`);
      }
      if (constraints.exclusiveMaximum !== undefined) {
        parts.push(`less than ${constraints.exclusiveMaximum}`);
      }
      if (constraints.multipleOf !== undefined) {
        parts.push(`multiple of ${constraints.multipleOf}`);
      }
      if (
        constraints.minLength !== undefined &&
        constraints.maxLength !== undefined
      ) {
        parts.push(`${constraints.minLength}–${constraints.maxLength} chars`);
      } else {
        if (constraints.minLength !== undefined)
          parts.push(`min ${constraints.minLength} chars`);
        if (constraints.maxLength !== undefined)
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
    if (node.string?.minLength !== undefined)
      parts.push(`min ${node.string.minLength} chars`);
    if (node.string?.maxLength !== undefined)
      parts.push(`max ${node.string.maxLength} chars`);
    if (node.string?.pattern !== undefined)
      parts.push(`pattern ${node.string.pattern}`);
    if (node.numeric?.minimum !== undefined)
      parts.push(`min ${node.numeric.minimum}`);
    if (node.numeric?.maximum !== undefined)
      parts.push(`max ${node.numeric.maximum}`);
    if (node.array?.minItems !== undefined)
      parts.push(`min ${node.array.minItems} items`);
    if (node.array?.maxItems !== undefined)
      parts.push(`max ${node.array.maxItems} items`);
  }
  if (node.kind === "array") {
    if (node.minItems !== undefined) parts.push(`min ${node.minItems} items`);
    if (node.maxItems !== undefined) parts.push(`max ${node.maxItems} items`);
    if (node.uniqueItems === true) parts.push("unique items");
    if (node.minContains !== undefined)
      parts.push(`contains at least ${node.minContains}`);
    if (node.maxContains !== undefined)
      parts.push(`contains at most ${node.maxContains}`);
  }
  if (node.kind === "tuple") {
    if (node.minItems !== undefined) parts.push(`min ${node.minItems} items`);
    if (node.maxItems !== undefined) parts.push(`max ${node.maxItems} items`);
  }
  if (node.kind === "object") {
    if (node.minProperties !== undefined)
      parts.push(`min ${node.minProperties} properties`);
    if (node.maxProperties !== undefined)
      parts.push(`max ${node.maxProperties} properties`);
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function enumerationOf(
  node: SchemaNode,
  budget: SchemaBudget,
): SchemaViewBase["enumeration"] | undefined {
  const values =
    node.kind === "scalar" || node.kind === "type-less"
      ? node.enumValues
      : undefined;
  if (values === undefined) return undefined;
  const kept = values.slice(0, budget.maxEnumValues).map(formatValue);
  return {
    dropped: values.length - kept.length,
    more: kept.slice(budget.enumPreview),
    values: kept.slice(0, budget.enumPreview),
  };
}

const MAX_VALUE_CHARACTERS = 80;

/** Renders a JSON value as bounded text for constraint lines. */
export function formatValue(value: JsonValue): string {
  let text: string;
  if (typeof value === "string") text = value;
  else if (value === null) text = "null";
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  return text.length > MAX_VALUE_CHARACTERS
    ? `${text.slice(0, MAX_VALUE_CHARACTERS - 1)}…`
    : text;
}
