import type { JsonValue } from "@specistry/model";

import type { Writer } from "./writer.js";

/**
 * Language string escaping. Each function returns a complete quoted literal
 * for its language; generators never concatenate raw canonical text into
 * code. Values have already passed the sanitizer (no control characters
 * other than tab and newline), so these routines only need to neutralise
 * quotes, backslashes, line breaks, and the characters that break a host
 * language's lexer (`$`, `` ` ``, `</`, U+2028/9, non-printables).
 */

/** POSIX single quotes: nothing is interpreted inside, `'` closes and re-opens. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Double-quoted JavaScript/TypeScript literal (also valid JSON where no `</`). */
export function jsString(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
    .replace(/<\//g, "<\\/");
}

/** Double-quoted Java literal; non-ASCII stays literal, controls become escapes. */
export function javaString(value: string): string {
  let result = '"';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === '"') result += '\\"';
    else if (character === "\\") result += "\\\\";
    else if (character === "\n") result += "\\n";
    else if (character === "\r") result += "\\r";
    else if (character === "\t") result += "\\t";
    else if (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029
    )
      result += `\\u${code.toString(16).padStart(4, "0")}`;
    else result += character;
  }
  return `${result}"`;
}

/** Double-quoted Python literal with the same escape policy. */
export function pythonString(value: string): string {
  let result = '"';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === '"') result += '\\"';
    else if (character === "\\") result += "\\\\";
    else if (character === "\n") result += "\\n";
    else if (character === "\r") result += "\\r";
    else if (character === "\t") result += "\\t";
    else if (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029
    )
      result += `\\u${code.toString(16).padStart(4, "0")}`;
    else result += character;
  }
  return `${result}"`;
}

/** Deterministic two-space JSON text; keys keep their given order. */
export function jsonText(value: JsonValue): string {
  return JSON.stringify(value, null, 2)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED_JS: ReadonlySet<string> = new Set([
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

/** Writes a JSON value as a JavaScript object literal, pretty-printed. */
export function writeJsObject(
  writer: Writer,
  value: JsonValue,
  indent: string,
): void {
  if (value === null) {
    writer.kw("null");
  } else if (typeof value === "boolean") {
    writer.kw(String(value));
  } else if (typeof value === "number") {
    writer.num(Number.isFinite(value) ? String(value) : "0");
  } else if (typeof value === "string") {
    writer.str(jsString(value));
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      writer.plain("[]");
      return;
    }
    writer.plain("[").nl();
    value.forEach((item) => {
      writer.plain(`${indent}  `);
      writeJsObject(writer, item, `${indent}  `);
      writer.plain(",").nl();
    });
    writer.plain(`${indent}]`);
  } else {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      writer.plain("{}");
      return;
    }
    writer.plain("{").nl();
    for (const [key, item] of entries) {
      writer.plain(`${indent}  `);
      writer.attr(
        IDENTIFIER.test(key) && !RESERVED_JS.has(key) ? key : jsString(key),
      );
      writer.plain(": ");
      writeJsObject(writer, item, `${indent}  `);
      writer.plain(",").nl();
    }
    writer.plain(`${indent}}`);
  }
}

/** Writes a JSON value as a Python literal (`True`, `None`, …). */
export function writePythonObject(
  writer: Writer,
  value: JsonValue,
  indent: string,
): void {
  if (value === null) {
    writer.kw("None");
  } else if (typeof value === "boolean") {
    writer.kw(value ? "True" : "False");
  } else if (typeof value === "number") {
    writer.num(Number.isFinite(value) ? String(value) : "0");
  } else if (typeof value === "string") {
    writer.str(pythonString(value));
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      writer.plain("[]");
      return;
    }
    writer.plain("[").nl();
    value.forEach((item) => {
      writer.plain(`${indent}    `);
      writePythonObject(writer, item, `${indent}    `);
      writer.plain(",").nl();
    });
    writer.plain(`${indent}]`);
  } else {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      writer.plain("{}");
      return;
    }
    writer.plain("{").nl();
    for (const [key, item] of entries) {
      writer.plain(`${indent}    `);
      writer.str(pythonString(key));
      writer.plain(": ");
      writePythonObject(writer, item, `${indent}    `);
      writer.plain(",").nl();
    }
    writer.plain(`${indent}}`);
  }
}

/** Writes pretty JSON text with string/number/keyword/key classes. */
export function writeJsonText(
  writer: Writer,
  value: JsonValue,
  indent: string,
): void {
  if (value === null) {
    writer.kw("null");
  } else if (typeof value === "boolean") {
    writer.kw(String(value));
  } else if (typeof value === "number") {
    writer.num(Number.isFinite(value) ? String(value) : "0");
  } else if (typeof value === "string") {
    writer.str(jsString(value));
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      writer.plain("[]");
      return;
    }
    writer.plain("[").nl();
    value.forEach((item, index) => {
      writer.plain(`${indent}  `);
      writeJsonText(writer, item, `${indent}  `);
      if (index < value.length - 1) writer.plain(",");
      writer.nl();
    });
    writer.plain(`${indent}]`);
  } else {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      writer.plain("{}");
      return;
    }
    writer.plain("{").nl();
    entries.forEach(([key, item], index) => {
      writer.plain(`${indent}  `);
      writer.attr(jsString(key));
      writer.plain(": ");
      writeJsonText(writer, item, `${indent}  `);
      if (index < entries.length - 1) writer.plain(",");
      writer.nl();
    });
    writer.plain(`${indent}}`);
  }
}
