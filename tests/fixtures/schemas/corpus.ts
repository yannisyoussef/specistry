import type { ApiService, SchemaId, SchemaNode } from "@specra/model";

/**
 * Canonical schema corpus for the SPEC-005 renderer (prompt §70). Every entry
 * is a model-v1 node built directly, so renderer tests never parse OpenAPI.
 * Registry entries carry the display `name` an adapter would derive.
 */

export type Registry = ApiService["schemas"];

function id(name: string): SchemaId {
  return name as SchemaId;
}

function ref(name: string, extra: Partial<SchemaNode> = {}): SchemaNode {
  return { kind: "ref", schemaId: id(name), ...extra } as SchemaNode;
}

function str(extra: Record<string, unknown> = {}): SchemaNode {
  return { kind: "scalar", type: "string", ...extra } as SchemaNode;
}

function int(extra: Record<string, unknown> = {}): SchemaNode {
  return { kind: "scalar", type: "integer", ...extra } as SchemaNode;
}

export function object(
  properties: Record<string, SchemaNode>,
  options: {
    readonly required?: readonly string[];
    readonly name?: string;
    readonly additional?: boolean | SchemaNode;
    readonly extra?: Record<string, unknown>;
  } = {},
): SchemaNode {
  const order = Object.keys(properties);
  const safe: Record<string, SchemaNode> = {};
  for (const key of order) {
    Object.defineProperty(safe, key, {
      configurable: true,
      enumerable: true,
      value: properties[key],
      writable: true,
    });
  }
  return {
    additionalProperties: options.additional ?? true,
    kind: "object",
    ...(options.name === undefined ? {} : { name: options.name }),
    properties: safe,
    propertyOrder: order,
    required: [...(options.required ?? [])],
    ...(options.extra ?? {}),
  } as SchemaNode;
}

function fields(count: number, prefix = "field"): Record<string, SchemaNode> {
  const result: Record<string, SchemaNode> = {};
  for (let index = 0; index < count; index += 1) {
    result[`${prefix}${index}`] =
      index % 3 === 0
        ? str({ description: `Field ${index}.` })
        : index % 3 === 1
          ? int({ constraints: { minimum: 0 } })
          : { kind: "scalar", type: "boolean" };
  }
  return result;
}

/** Nested objects `depth` levels deep, each with one leaf and one child. */
export function deepObject(depth: number, name = "Level"): SchemaNode {
  let node: SchemaNode = str({ description: "The bottom." });
  for (let level = depth; level > 0; level -= 1) {
    node = object(
      { leaf: int(), child: node },
      { extra: { title: `${name} ${level}` } },
    );
  }
  return node;
}

const HOSTILE_NAME = "<img src=x onerror=alert(1)>";
const LONG_NAME = "x".repeat(2_000);
const BIDI_NAME = "user‮eman";
const ZERO_WIDTH_NAME = "a​b‌c‍d";

export const corpus: Registry = {
  Address: object(
    {
      street: str({ constraints: { maxLength: 120 } }),
      city: str(),
      country: str({ enumValues: ["CA", "FR", "GA", "US"] }),
    },
    { name: "Address", required: ["street", "city"] },
  ),
  Audit: object(
    {
      createdAt: str({ format: "date-time", readOnly: true }),
      updatedAt: str({ format: "date-time", readOnly: true }),
    },
    { name: "Audit" },
  ),
  BankPayment: object(
    {
      method: str({ constValue: "bank" }),
      iban: str({
        constraints: { pattern: "^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$" },
      }),
    },
    { name: "BankPayment", required: ["method", "iban"] },
  ),
  Base: object(
    { id: str({ format: "uuid", readOnly: true }) },
    { name: "Base", required: ["id"] },
  ),
  CardPayment: object(
    {
      method: str({ constValue: "card" }),
      last4: str({ constraints: { minLength: 4, maxLength: 4 } }),
      expiry: str({ format: "date" }),
    },
    { name: "CardPayment", required: ["method", "last4"] },
  ),
  CryptoPayment: object(
    { method: str({ constValue: "crypto" }), wallet: str() },
    { name: "CryptoPayment", required: ["method", "wallet"] },
  ),
  CycleA: object({ next: ref("CycleB") }, { name: "CycleA" }),
  CycleB: object({ back: ref("CycleA"), value: int() }, { name: "CycleB" }),
  Dictionary: object({}, { additional: ref("Address"), name: "Dictionary" }),
  Everything: { accepts: true, kind: "boolean-schema", name: "Everything" },
  Forest: {
    items: ref("Node"),
    kind: "array",
    minItems: 1,
    name: "Forest",
  },
  Hostile: object(
    {
      [HOSTILE_NAME]: str({ description: "<script>alert(1)</script>" }),
      [LONG_NAME]: str(),
      [BIDI_NAME]: str(),
      [ZERO_WIDTH_NAME]: str(),
      "a/b#c": str(),
      ["__proto__"]: str({ description: "Prototype-named property." }),
      constructor: int(),
      prototype: str(),
    },
    { name: "Hostile", required: [HOSTILE_NAME, "__proto__"] },
  ),
  LargeEnum: str({
    enumValues: Array.from({ length: 300 }, (_, index) => `value-${index}`),
    name: "LargeEnum",
  }),
  MixedContext: object(
    {
      id: str({ readOnly: true }),
      name: str(),
      password: str({ writeOnly: true, constraints: { minLength: 12 } }),
      secretHint: ref("Secret", { writeOnly: true }),
      createdAt: str({ format: "date-time", readOnly: true }),
    },
    { name: "MixedContext", required: ["id", "name", "password"] },
  ),
  Node: object(
    {
      value: str(),
      children: { items: ref("Node"), kind: "array" },
      parent: {
        kind: "composition",
        mode: "anyOf",
        variants: [ref("Node"), { kind: "scalar", type: "null" }],
      },
    },
    { name: "Node", required: ["value"] },
  ),
  Nothing: { accepts: false, kind: "boolean-schema", name: "Nothing" },
  Payment: {
    discriminator: {
      mapping: {
        bank: id("BankPayment"),
        card: id("CardPayment"),
        crypto: id("CryptoPayment"),
      },
      propertyName: "method",
    },
    kind: "composition",
    mode: "oneOf",
    name: "Payment",
    variants: [ref("CardPayment"), ref("BankPayment"), ref("CryptoPayment")],
  },
  Secret: str({ constraints: { minLength: 8 } }),
  Tagged: {
    kind: "composition",
    mode: "allOf",
    name: "Tagged",
    variants: [
      ref("Base"),
      ref("Audit"),
      object({ tags: { items: str(), kind: "array", uniqueItems: true } }),
    ],
  },
  Twenty: object(fields(20), {
    name: "Twenty",
    required: ["field0", "field1"],
  }),
  TwoHundred: object(fields(200), { name: "TwoHundred" }),
  TypeLess: {
    applicableTypes: ["integer", "number", "string"],
    kind: "type-less",
    name: "TypeLess",
    numeric: { minimum: 0 },
    string: { minLength: 1 },
  },
  Unknown: {
    diagnosticIds: [],
    kind: "unknown",
    name: "Unknown",
    reason: "unsupported",
  },
};

/** Root nodes used by tests, keyed by the §70 corpus names. */
export const roots = {
  anyOfLoose: {
    kind: "composition",
    mode: "anyOf",
    variants: [str(), int(), object({ note: str() })],
  } as SchemaNode,
  arrayRecursion: ref("Forest"),
  booleanFalse: ref("Nothing"),
  booleanTrue: ref("Everything"),
  composedRecursion: ref("CycleA"),
  deep: deepObject(12),
  dictionary: ref("Dictionary"),
  directRecursion: ref("Node"),
  discriminated: ref("Payment"),
  freeForm: { kind: "any" } as SchemaNode,
  hostile: ref("Hostile"),
  indirectRecursion: ref("CycleA"),
  largeEnum: ref("LargeEnum"),
  mixedContext: ref("MixedContext"),
  not: {
    kind: "composition",
    mode: "not",
    variants: [str()],
  } as SchemaNode,
  oneOfTwenty: {
    kind: "composition",
    mode: "oneOf",
    variants: Array.from({ length: 20 }, (_, index) =>
      object({ [`variant${index}`]: str() }, { extra: { title: `V${index}` } }),
    ),
  } as SchemaNode,
  primitive: str({
    constraints: { maxLength: 254, minLength: 1 },
    format: "email",
  }),
  tagged: ref("Tagged"),
  tuple: {
    additionalItems: false,
    kind: "tuple",
    prefixItems: [str(), int(), { kind: "scalar", type: "boolean" }],
  } as SchemaNode,
  twenty: ref("Twenty"),
  twoHundred: ref("TwoHundred"),
  typeLess: ref("TypeLess"),
  unknown: ref("Unknown"),
} as const;

export const hostileNames = {
  bidi: BIDI_NAME,
  html: HOSTILE_NAME,
  long: LONG_NAME,
  zeroWidth: ZERO_WIDTH_NAME,
} as const;
