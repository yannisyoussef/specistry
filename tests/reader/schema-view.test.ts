import { describe, expect, it } from "vitest";

import {
  countViewNodes,
  createSchemaView,
  DEFAULT_SCHEMA_BUDGET,
  LOCATOR_PATTERN,
  resolveLocator,
  schemaLabel,
  type SchemaView,
} from "../../apps/web/lib/reader/schema-view";
import {
  corpus,
  deepObject,
  hostileNames,
  object,
  roots,
} from "../fixtures/schemas/corpus";

function view(
  node: keyof typeof roots,
  context: "request" | "response" = "response",
  budget?: Parameters<typeof createSchemaView>[1]["budget"],
): SchemaView {
  return createSchemaView(roots[node], {
    context,
    registry: corpus,
    ...(budget === undefined ? {} : { budget }),
  });
}

function properties(node: SchemaView): readonly string[] {
  return node.kind === "object"
    ? [...node.properties, ...node.hidden].map((property) => property.name)
    : [];
}

describe("schema view: primitives and special forms", () => {
  it("labels scalars with format and compacts constraints", () => {
    const primitive = view("primitive");
    expect(primitive.kind).toBe("value");
    expect(primitive.label).toBe("string · email");
    expect(primitive.constraints).toBe("1–254 chars");
    expect(primitive.flags).toEqual([]);
  });

  it("keeps free-form, explicit true, and explicit false distinct", () => {
    const free = view("freeForm");
    const yes = view("booleanTrue");
    const no = view("booleanFalse");
    expect(free).toMatchObject({ kind: "value", valueKind: "any" });
    expect(yes).toMatchObject({
      kind: "value",
      name: "Everything",
      valueKind: "true",
    });
    expect(no).toMatchObject({
      kind: "value",
      label: "no value",
      valueKind: "false",
    });
    expect(free.label).toBe("any value");
  });

  it("never implies a type for keyword-only schemas", () => {
    const typeLess = view("typeLess");
    expect(typeLess).toMatchObject({
      applicableTypes: ["integer", "number", "string"],
      kind: "value",
      label: "unspecified type",
      valueKind: "type-less",
    });
    expect(typeLess.constraints).toBe("min 1 chars · min 0");
  });

  it("reports unrepresented schemas with their reason", () => {
    expect(view("unknown")).toMatchObject({
      kind: "value",
      label: "not represented",
      reason: "unsupported",
      valueKind: "unknown",
    });
  });

  it("bounds large enums to a preview, a disclosure, and a dropped count", () => {
    const large = view("largeEnum");
    expect(large.enumeration?.values).toHaveLength(
      DEFAULT_SCHEMA_BUDGET.enumPreview,
    );
    expect(large.enumeration?.values[0]).toBe("value-0");
    expect(large.enumeration?.more).toHaveLength(
      DEFAULT_SCHEMA_BUDGET.maxEnumValues - DEFAULT_SCHEMA_BUDGET.enumPreview,
    );
    expect(large.enumeration?.dropped).toBe(100);
    expect(large.label).toBe("string · enum");
    expect(large.name).toBe("LargeEnum");
  });

  it("distinguishes defaults from constants in the constraints line", () => {
    const constant = createSchemaView(
      { constValue: "card", kind: "scalar", type: "string" },
      { context: "request", registry: corpus },
    );
    const defaulted = createSchemaView(
      { defaultValue: 3_600, kind: "scalar", type: "integer" },
      { context: "request", registry: corpus },
    );
    expect(constant.constraints).toBe("always card");
    expect(constant.label).toBe("string · constant");
    expect(defaulted.constraints).toBe("default 3600");
  });
});

describe("schema view: objects, arrays, tuples, dictionaries", () => {
  it("projects properties in canonical order with required state and locators", () => {
    const twenty = view("twenty");
    expect(twenty.kind).toBe("object");
    if (twenty.kind !== "object") return;
    expect(twenty.name).toBe("Twenty");
    expect(
      twenty.properties.map((property) => property.name).slice(0, 3),
    ).toEqual(["field0", "field1", "field2"]);
    expect(twenty.properties[0]).toMatchObject({
      required: true,
      schema: { label: "string", locator: "p0" },
    });
    expect(twenty.properties[2]).toMatchObject({
      required: false,
      schema: { label: "boolean", locator: "p2" },
    });
    expect(twenty.hidden).toEqual([]);
    expect(twenty.additional).toBe("any");
  });

  it("splits large property sets into initial rows, a disclosure, and a count", () => {
    const large = view("twoHundred");
    if (large.kind !== "object") throw new Error("object");
    expect(large.properties).toHaveLength(
      DEFAULT_SCHEMA_BUDGET.initialProperties,
    );
    expect(large.hidden).toHaveLength(
      DEFAULT_SCHEMA_BUDGET.maxProperties -
        DEFAULT_SCHEMA_BUDGET.initialProperties,
    );
    expect(large.more).toBe(0);
    const tighter = view("twoHundred", "response", { maxProperties: 50 });
    if (tighter.kind !== "object") throw new Error("object");
    expect(tighter.properties.length + tighter.hidden.length).toBe(50);
    expect(tighter.more).toBe(150);
  });

  it("reads dictionaries as maps and keeps additional-property semantics apart", () => {
    const dictionary = view("dictionary");
    expect(dictionary.label).toBe("Dictionary");
    if (dictionary.kind !== "object") throw new Error("object");
    expect(dictionary.properties).toEqual([]);
    expect(dictionary.additional).toMatchObject({
      kind: "object",
      label: "Address",
      locator: "a",
      name: "Address",
    });
    expect(
      schemaLabel(
        {
          additionalProperties: corpus.Address!,
          kind: "object",
          properties: {},
          propertyOrder: [],
          required: [],
        },
        corpus,
      ),
    ).toBe("map of Address");
    const closed = createSchemaView(
      object({ a: roots.primitive }, { additional: false }),
      {
        context: "response",
        registry: corpus,
      },
    );
    expect(closed.kind === "object" ? closed.additional : undefined).toBe(
      "none",
    );
  });

  it("projects tuples slot by slot with the remainder rule", () => {
    const tuple = view("tuple");
    expect(tuple.label).toBe("tuple of 3 items");
    if (tuple.kind !== "tuple") throw new Error("tuple");
    expect(tuple.slots.map((slot) => [slot.locator, slot.label])).toEqual([
      ["t0", "string"],
      ["t1", "integer"],
      ["t2", "boolean"],
    ]);
    expect(tuple.rest).toBe("none");
  });

  it("labels arrays by their item schema name", () => {
    const forest = view("arrayRecursion");
    expect(forest.label).toBe("Forest");
    if (forest.kind !== "array") throw new Error("array");
    expect(forest.items).toMatchObject({ label: "Node", locator: "i" });
    expect(forest.constraints).toBe("min 1 items");
    expect(schemaLabel({ items: corpus.Node!, kind: "array" }, corpus)).toBe(
      "array of Node",
    );
  });
});

describe("schema view: references and recursion", () => {
  it("names references and marks direct recursion instead of expanding it", () => {
    const node = view("directRecursion");
    expect(node).toMatchObject({
      kind: "object",
      name: "Node",
      reference: { name: "Node", schemaId: "Node" },
    });
    if (node.kind !== "object") throw new Error("object");
    const children = node.properties.find((p) => p.name === "children")?.schema;
    expect(children).toMatchObject({ kind: "array", label: "array of Node" });
    if (children?.kind !== "array") throw new Error("array");
    expect(children.items).toMatchObject({
      kind: "cycle",
      label: "Node",
      locator: "p1.i",
      reference: { name: "Node" },
    });
    // `Node or null` collapses to the named node with a nullable flag.
    const parent = node.properties.find((p) => p.name === "parent")?.schema;
    expect(parent).toMatchObject({
      flags: ["nullable"],
      kind: "cycle",
      label: "Node or null",
      locator: "p2.v0",
    });
  });

  it("terminates indirect, array, and composed recursion", () => {
    const a = view("indirectRecursion");
    if (a.kind !== "object") throw new Error("object");
    const b = a.properties[0]?.schema;
    expect(b).toMatchObject({ kind: "object", name: "CycleB", locator: "p0" });
    if (b?.kind !== "object") throw new Error("object");
    expect(b.properties[0]?.schema).toMatchObject({
      kind: "cycle",
      name: "CycleA",
      locator: "p0.p0",
    });
    expect(countViewNodes(a)).toBe(4);
    const forest = view("arrayRecursion");
    expect(countViewNodes(forest)).toBeLessThan(12);
    const composed = createSchemaView(
      {
        kind: "composition",
        mode: "oneOf",
        variants: [
          { kind: "ref", schemaId: "CycleA" as never },
          roots.primitive,
        ],
      },
      { context: "response", registry: corpus },
    );
    expect(countViewNodes(composed)).toBeLessThan(10);
  });

  it("opens exactly one more level through a focused view of a recursion marker", () => {
    const target = resolveLocator(roots.directRecursion, corpus, "p1.i");
    expect(target).toBeDefined();
    expect(target?.trail.map((entry) => entry.label)).toEqual([
      "children",
      "items",
    ]);
    expect(target?.ancestors).toEqual(["Node"]);
    const focused = createSchemaView(target!.node, {
      ancestors: target!.ancestors,
      context: "response",
      locator: "p1.i",
      registry: corpus,
    });
    expect(focused).toMatchObject({ kind: "object", name: "Node" });
    if (focused.kind !== "object") throw new Error("object");
    expect(focused.properties[1]?.schema).toMatchObject({
      kind: "array",
      locator: "p1.i.p1",
    });
    expect(
      focused.properties[1]?.schema.kind === "array"
        ? focused.properties[1].schema.items.kind
        : undefined,
    ).toBe("cycle");
  });
});

describe("schema view: composition", () => {
  it("keeps allOf as composition parts rather than a flattened object", () => {
    const tagged = view("tagged");
    expect(tagged).toMatchObject({
      kind: "composition",
      mode: "allOf",
      name: "Tagged",
    });
    if (tagged.kind !== "composition") throw new Error("composition");
    expect(tagged.variants.map((variant) => variant.label)).toEqual([
      "Base",
      "Audit",
      "object",
    ]);
    expect(tagged.variants[0]?.schema.locator).toBe("v0");
    expect(tagged.label).toBe("Tagged");
  });

  it("distinguishes oneOf from anyOf and exposes discriminator mappings", () => {
    const payment = view("discriminated");
    if (payment.kind !== "composition") throw new Error("composition");
    expect(payment.mode).toBe("oneOf");
    expect(
      payment.variants.map((variant) => [variant.label, variant.values]),
    ).toEqual([
      ["CardPayment", ["card"]],
      ["BankPayment", ["bank"]],
      ["CryptoPayment", ["crypto"]],
    ]);
    expect(payment.discriminator).toEqual({
      mapping: [
        { label: "BankPayment", locator: "v1", value: "bank" },
        { label: "CardPayment", locator: "v0", value: "card" },
        { label: "CryptoPayment", locator: "v2", value: "crypto" },
      ],
      propertyName: "method",
    });
    const loose = view("anyOfLoose");
    expect(loose).toMatchObject({
      kind: "composition",
      label: "any of 3",
      mode: "anyOf",
    });
    expect(payment.label).toBe("Payment");
  });

  it("bounds the number of rendered variants", () => {
    const twenty = view("oneOfTwenty", "response", { maxVariants: 5 });
    if (twenty.kind !== "composition") throw new Error("composition");
    expect(twenty.variants).toHaveLength(5);
    expect(twenty.more).toBe(15);
    expect(twenty.variants[0]?.label).toBe("V0");
  });

  it("represents not as exclusion, never as a variant", () => {
    const not = view("not");
    expect(not).toMatchObject({ kind: "not", label: "not string" });
    if (not.kind !== "not") throw new Error("not");
    expect(not.schema.locator).toBe("n");
  });
});

describe("schema view: read and write context", () => {
  it("omits read-only fields from requests and write-only fields from responses, saying so", () => {
    const request = view("mixedContext", "request");
    const response = view("mixedContext", "response");
    expect(properties(request)).toEqual(["name", "password", "secretHint"]);
    expect(request.kind === "object" ? request.omitted : undefined).toEqual({
      names: ["id", "createdAt"],
      reason: "read-only",
    });
    expect(properties(response)).toEqual(["id", "name", "createdAt"]);
    expect(response.kind === "object" ? response.omitted : undefined).toEqual({
      names: ["password", "secretHint"],
      reason: "write-only",
    });
    // Locators stay structural across contexts.
    const name = (node: SchemaView) =>
      node.kind === "object"
        ? node.properties.find((property) => property.name === "name")?.schema
            .locator
        : undefined;
    expect(name(request)).toBe("p1");
    expect(name(response)).toBe("p1");
  });

  it("keeps read-only flags visible where a field is shown", () => {
    const response = view("mixedContext", "response");
    if (response.kind !== "object") throw new Error("object");
    expect(response.properties[0]?.schema.flags).toEqual(["read-only"]);
  });
});

describe("schema view: budgets and locators", () => {
  it("truncates by depth and by node count with an explicit reason", () => {
    const deep = view("deep");
    let cursor: SchemaView = deep;
    let depth = 0;
    while (cursor.kind === "object") {
      const child = cursor.properties.find((p) => p.name === "child")?.schema;
      if (child === undefined) break;
      cursor = child;
      depth += 1;
    }
    expect(depth).toBe(DEFAULT_SCHEMA_BUDGET.maxDepth);
    expect(cursor).toMatchObject({ kind: "truncated", reason: "depth" });
    const tight = createSchemaView(deepObject(3), {
      budget: { maxNodes: 4 },
      context: "response",
      registry: corpus,
    });
    const truncated = JSON.stringify(tight).includes('"reason":"nodes"');
    expect(truncated).toBe(true);
    expect(countViewNodes(tight)).toBeLessThanOrEqual(6);
  });

  it("projects deterministically and independently of object identity", () => {
    const first = JSON.stringify(view("discriminated"));
    const second = JSON.stringify(
      createSchemaView(
        { kind: "ref", schemaId: "Payment" as never },
        { context: "response", registry: { ...corpus } },
      ),
    );
    expect(first).toBe(second);
  });

  it("resolves locators through every step kind and rejects malformed ones", () => {
    expect(LOCATOR_PATTERN.test("p0.i.v2.t1.a.c.n.r")).toBe(true);
    for (const bad of [
      "",
      "P0",
      "p0/i",
      "p0..i",
      "0",
      "p0.",
      "x".repeat(400),
      "p1e3",
    ]) {
      expect(LOCATOR_PATTERN.test(bad), bad).toBe(false);
    }
    const target = resolveLocator(roots.discriminated, corpus, "v1.p1");
    expect(target?.trail).toEqual([
      { label: "BankPayment", locator: "v1" },
      { label: "iban", locator: "v1.p1" },
    ]);
    expect(target?.node).toMatchObject({ kind: "scalar", type: "string" });
    expect(resolveLocator(roots.discriminated, corpus, "v9")).toBeUndefined();
    expect(resolveLocator(roots.discriminated, corpus, "p0")).toBeUndefined();
    expect(
      resolveLocator(roots.dictionary, corpus, "a.p2")?.trail.at(-1),
    ).toEqual({
      label: "country",
      locator: "a.p2",
    });
    expect(resolveLocator(roots.tuple, corpus, "t2")?.node).toMatchObject({
      type: "boolean",
    });
    expect(resolveLocator(roots.not, corpus, "n")?.trail[0]?.label).toBe("not");
  });
});

describe("schema view: hostile input", () => {
  it("keeps hostile property names and descriptions as data", () => {
    const hostile = view("hostile");
    const names = properties(hostile);
    expect(names).toContain(hostileNames.html);
    expect(names).toContain(hostileNames.long);
    expect(names).toContain(hostileNames.bidi);
    expect(names).toContain(hostileNames.zeroWidth);
    expect(names).toContain("__proto__");
    expect(names).toContain("constructor");
    expect(names).toContain("a/b#c");
    if (hostile.kind !== "object") throw new Error("object");
    expect(hostile.properties[0]?.schema.description).toBe(
      "<script>alert(1)</script>",
    );
    expect({} as Record<string, unknown>).not.toHaveProperty("polluted");
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
