import type { SchemaId, SchemaNode } from "@specra/model";
import { describe, expect, it } from "vitest";

import {
  countViewNodes,
  createSchemaView,
  DEFAULT_SCHEMA_BUDGET,
  resolveLocator,
  type SchemaView,
} from "../../apps/web/lib/reader/schema-view";

/**
 * Seeded random schema graphs stress the projection: arbitrary reference
 * cycles, nested composition, deep arrays, and hostile keys. For every graph
 * the projection must terminate, stay under its budgets, ignore object
 * identity, and resolve every locator it emitted. Seeds are recorded so a
 * failure reproduces exactly.
 */

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const KEYS = ["a", "__proto__", "constructor", "<b>", "x".repeat(300), "ü"];

function randomGraph(seed: number, size: number) {
  const next = random(seed);
  const ids = Array.from(
    { length: size },
    (_, index) => `S${index}` as SchemaId,
  );
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(next() * items.length)] as T;
  const leaf = (): SchemaNode =>
    pick<SchemaNode>([
      { kind: "scalar", type: "string" },
      { kind: "scalar", type: "integer", constraints: { minimum: 0 } },
      { kind: "any" },
      { accepts: next() > 0.5, kind: "boolean-schema" },
      {
        applicableTypes: ["string"],
        kind: "type-less",
        string: { minLength: 1 },
      },
    ]);
  const ref = (): SchemaNode => ({ kind: "ref", schemaId: pick(ids) });
  const node = (depth: number): SchemaNode => {
    if (depth > 4) return next() > 0.5 ? ref() : leaf();
    const roll = next();
    if (roll < 0.25) return ref();
    if (roll < 0.4) return leaf();
    if (roll < 0.65) {
      const count = 1 + Math.floor(next() * 5);
      const properties: Record<string, SchemaNode> = {};
      const order: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const key = `${pick(KEYS)}${index}`;
        Object.defineProperty(properties, key, {
          configurable: true,
          enumerable: true,
          value: node(depth + 1),
          writable: true,
        });
        order.push(key);
      }
      return {
        additionalProperties: next() > 0.7 ? node(depth + 1) : next() > 0.5,
        kind: "object",
        properties,
        propertyOrder: order,
        required: order.filter(() => next() > 0.5),
        ...(next() > 0.6 ? { readOnly: true } : {}),
      };
    }
    if (roll < 0.8) return { items: node(depth + 1), kind: "array" };
    if (roll < 0.9) {
      const mode = pick(["allOf", "anyOf", "oneOf"] as const);
      return {
        kind: "composition",
        mode,
        variants: Array.from({ length: 1 + Math.floor(next() * 4) }, () =>
          node(depth + 1),
        ),
      };
    }
    if (roll < 0.95) {
      return {
        additionalItems: next() > 0.5,
        kind: "tuple",
        prefixItems: [node(depth + 1), node(depth + 1)],
      };
    }
    return { kind: "composition", mode: "not", variants: [node(depth + 1)] };
  };
  const registry: Record<string, SchemaNode> = {};
  for (const id of ids) {
    registry[id] = { ...node(0), name: id };
  }
  return { registry, root: ref() };
}

function locators(view: SchemaView): string[] {
  const found = [view.locator];
  switch (view.kind) {
    case "object":
      for (const property of [...view.properties, ...view.hidden]) {
        found.push(...locators(property.schema));
      }
      if (typeof view.additional === "object")
        found.push(...locators(view.additional));
      break;
    case "array":
      found.push(...locators(view.items));
      break;
    case "tuple":
      for (const slot of view.slots) found.push(...locators(slot));
      if (typeof view.rest === "object") found.push(...locators(view.rest));
      break;
    case "composition":
      for (const variant of view.variants)
        found.push(...locators(variant.schema));
      break;
    case "not":
      found.push(...locators(view.schema));
      break;
    default:
      break;
  }
  return found;
}

describe("schema projection fuzzing", () => {
  const seeds = Array.from({ length: 60 }, (_, index) => 1_000 + index * 7);

  it.each(seeds)(
    "terminates within budget and resolves its own locators (seed %i)",
    (seed) => {
      const { registry, root } = randomGraph(seed, 12);
      const started = performance.now();
      const view = createSchemaView(root, { context: "request", registry });
      expect(performance.now() - started, `seed ${seed}`).toBeLessThan(500);
      const nodes = countViewNodes(view);
      // The node budget bounds expandable nodes; leaves under the last
      // expandable level can add at most one level of children.
      expect(nodes, `seed ${seed}`).toBeLessThan(
        DEFAULT_SCHEMA_BUDGET.maxNodes * 3,
      );
      for (const locator of locators(view)) {
        const target = resolveLocator(root, registry, locator);
        expect(target, `seed ${seed} locator ${locator}`).toBeDefined();
        // A focused view at any emitted locator also terminates.
        const focused = createSchemaView(target!.node, {
          ancestors: target!.ancestors,
          context: "response",
          locator,
          registry,
        });
        expect(countViewNodes(focused)).toBeLessThan(
          DEFAULT_SCHEMA_BUDGET.maxNodes * 3,
        );
      }
      const again = createSchemaView(root, {
        context: "request",
        registry: { ...registry },
      });
      expect(JSON.stringify(again), `seed ${seed}`).toBe(JSON.stringify(view));
      expect(Object.prototype).not.toHaveProperty("polluted");
    },
  );

  it("survives a fully connected reference cycle of every kind", () => {
    const ids = ["A", "B", "C", "D"] as SchemaId[];
    const registry: Record<string, SchemaNode> = {
      A: {
        additionalProperties: { kind: "ref", schemaId: ids[1]! },
        kind: "object",
        name: "A",
        properties: { b: { kind: "ref", schemaId: ids[1]! } },
        propertyOrder: ["b"],
        required: [],
      },
      B: {
        items: { kind: "ref", schemaId: ids[2]! },
        kind: "array",
        name: "B",
      },
      C: {
        kind: "composition",
        mode: "oneOf",
        name: "C",
        variants: [
          { kind: "ref", schemaId: ids[3]! },
          { kind: "ref", schemaId: ids[0]! },
        ],
      },
      D: {
        kind: "composition",
        mode: "not",
        name: "D",
        variants: [{ kind: "ref", schemaId: ids[0]! }],
      },
    };
    const view = createSchemaView(
      { kind: "ref", schemaId: ids[0]! },
      {
        context: "response",
        registry,
      },
    );
    expect(countViewNodes(view)).toBeLessThan(20);
    expect(JSON.stringify(view)).toContain('"kind":"cycle"');
  });

  it("never overflows the stack on a 10,000-deep inline chain", () => {
    let node: SchemaNode = { kind: "scalar", type: "string" };
    for (let level = 0; level < 10_000; level += 1) {
      node = { items: node, kind: "array" };
    }
    const view = createSchemaView(node, { context: "response", registry: {} });
    expect(countViewNodes(view)).toBeLessThanOrEqual(
      DEFAULT_SCHEMA_BUDGET.maxDepth + 2,
    );
    expect(JSON.stringify(view)).toContain('"reason":"depth"');
    // Locator resolution walks only the requested steps.
    expect(resolveLocator(node, {}, "i.i.i.i.i.i.i.i")?.node.kind).toBe(
      "array",
    );
  });
});
