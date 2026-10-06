import type { JsonValue } from "@specistry/model";

import { placeholderFor, sanitizeLine } from "./sanitize.js";
import type { Pair } from "./types.js";
import { encodePathLiteral, encodePathValue, encodeQueryValue } from "./url.js";

/**
 * The one protocol serializer (SPEC-008 §12, SPEC-009 §30). Code examples
 * feed it representative values; the browser playground feeds it the
 * user's values. Both produce the same path segments, query pairs, header
 * values, and cookie values from the same canonical style/explode/
 * allowReserved semantics, so an operation never means one thing in Code
 * and another in Try it. No I/O, no globals; safe for the browser.
 */

export interface PathSerialization {
  readonly style: "label" | "matrix" | "simple";
  readonly explode: boolean;
}

export interface QuerySerialization {
  readonly style: "deepObject" | "form" | "pipeDelimited" | "spaceDelimited";
  readonly explode: boolean;
  readonly allowReserved: boolean;
}

type Primitive = boolean | number | string | null;

/** The wire text of a primitive; objects are JSON; nulls are empty. */
export function primitiveText(value: JsonValue): string {
  if (value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return sanitizeLine(String(value));
}

export function isPrimitive(value: JsonValue): value is Primitive {
  return value === null || typeof value !== "object";
}

function entriesOf(value: JsonValue): readonly (readonly [string, string])[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), primitiveText(item)]);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).map(([key, item]) => [
      sanitizeLine(key, 120),
      primitiveText(item),
    ]);
  }
  return [["", primitiveText(value)]];
}

/** Delimited primitive/array/object text, as the `simple` and cookie styles need. */
export function joinDelimited(value: JsonValue, delimiter: string): string {
  if (isPrimitive(value)) return primitiveText(value);
  if (Array.isArray(value)) return value.map(primitiveText).join(delimiter);
  return entriesOf(value)
    .flatMap(([key, item]) => [key, item])
    .join(delimiter);
}

/** One path parameter as the text that replaces `{name}` in the template. */
export function serializePathParameter(
  name: string,
  value: JsonValue,
  serialization: PathSerialization,
): string {
  const { explode, style } = serialization;
  if (isPrimitive(value)) {
    const encoded = encodePathValue(primitiveText(value));
    switch (style) {
      case "label":
        return `.${encoded}`;
      case "matrix":
        return `;${encodePathValue(name)}=${encoded}`;
      default:
        return encoded;
    }
  }
  const array = Array.isArray(value);
  const items = array
    ? value.map((item) => encodePathValue(primitiveText(item)))
    : entriesOf(value).map(
        ([key, item]) => [encodePathValue(key), encodePathValue(item)] as const,
      );
  const flat = array
    ? (items as string[])
    : (items as (readonly [string, string])[]).flatMap(([key, item]) => [
        key,
        item,
      ]);
  const pairs = array
    ? (items as string[])
    : (items as (readonly [string, string])[]).map(
        ([key, item]) => `${key}=${item}`,
      );
  switch (style) {
    case "label":
      return explode ? `.${pairs.join(".")}` : `.${flat.join(",")}`;
    case "matrix":
      if (!explode) return `;${encodePathValue(name)}=${flat.join(",")}`;
      return array
        ? pairs.map((item) => `;${encodePathValue(name)}=${item}`).join("")
        : pairs.map((pair) => `;${pair}`).join("");
    default:
      return explode && !array ? pairs.join(",") : flat.join(",");
  }
}

/**
 * Substitutes `{name}` in a path template with already-serialized values;
 * literal segments are percent-encoded and unknown names become
 * placeholders. The result always starts with `/`.
 */
export function renderPathTemplate(
  template: string,
  values: ReadonlyMap<string, string>,
): string {
  const clean = sanitizeLine(template, 2_048);
  let result = "";
  let rest = clean;
  for (;;) {
    const open = rest.indexOf("{");
    const close = open === -1 ? -1 : rest.indexOf("}", open);
    if (open === -1 || close === -1) {
      result += encodePathLiteral(rest);
      break;
    }
    result += encodePathLiteral(rest.slice(0, open));
    const name = rest.slice(open + 1, close);
    result += values.get(name) ?? placeholderFor(name);
    rest = rest.slice(close + 1);
  }
  return result.startsWith("/") ? result : `/${result}`;
}

/** Query pairs for one parameter (names and values percent-encoded). */
export function serializeQueryParameter(
  name: string,
  value: JsonValue,
  serialization: QuerySerialization,
  contentTyped = false,
): readonly Pair[] {
  const { allowReserved, explode, style } = serialization;
  const encodedName = encodeQueryValue(sanitizeLine(name, 120));
  const encode = (text: string) => encodeQueryValue(text, allowReserved);
  if (contentTyped) {
    // Content-typed parameters carry a serialized document (JSON) as the value.
    return [{ name: encodedName, value: encode(JSON.stringify(value)) }];
  }
  if (isPrimitive(value)) {
    return [{ name: encodedName, value: encode(primitiveText(value)) }];
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => encode(primitiveText(item)));
    if (items.length === 0) return [];
    if (explode)
      return items.map((item) => ({ name: encodedName, value: item }));
    const delimiter =
      style === "spaceDelimited"
        ? "%20"
        : style === "pipeDelimited"
          ? "|"
          : ",";
    return [{ name: encodedName, value: items.join(delimiter) }];
  }
  const entries = entriesOf(value);
  if (style === "deepObject") {
    return entries.map(([key, item]) => ({
      name: `${encodedName}[${encodeQueryValue(key)}]`,
      value: encode(item),
    }));
  }
  if (explode) {
    return entries.map(([key, item]) => ({
      name: encodeQueryValue(key),
      value: encode(item),
    }));
  }
  return [
    {
      name: encodedName,
      value: entries
        .flatMap(([key, item]) => [encodeQueryValue(key), encode(item)])
        .join(","),
    },
  ];
}

/** The `simple`-style header value (arrays comma-joined, objects exploded or not). */
export function serializeHeaderParameter(
  value: JsonValue,
  explode: boolean,
): string {
  if (isPrimitive(value)) return primitiveText(value);
  if (Array.isArray(value)) return value.map(primitiveText).join(",");
  return explode
    ? entriesOf(value)
        .map(([key, item]) => `${key}=${item}`)
        .join(",")
    : joinDelimited(value, ",");
}

/** The `form`-style cookie value, percent-encoded. */
export function serializeCookieParameter(value: JsonValue): string {
  return encodeQueryValue(joinDelimited(value, ","));
}
