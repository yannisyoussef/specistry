import type { ProtocolLanguage, ResolvedRequest } from "@specistry/snippets";

/**
 * Reverse extractors for the cross-language semantic matrix (SPEC-008 §111,
 * §156): each generated example is parsed back into a normalized request so
 * a generator that drops a query parameter, header, or body is caught by a
 * comparison against the resolved request rather than by a snapshot alone.
 * These are test-only parsers for the shapes the generators emit.
 */

export interface NormalizedRequest {
  readonly method: string;
  readonly url: string;
  /** Lower-case names, sorted; `authorization: basic <u>:<p>` for basic auth. */
  readonly headers: readonly string[];
  /** JSON object, form string, `multipart:<fields>`, `binary`, text, or `none`. */
  readonly body: string;
}

export function normalizeExpected(request: ResolvedRequest): NormalizedRequest {
  const headers = request.headers
    .filter(
      (header) =>
        header.name.toLowerCase() !== "content-type" ||
        request.body?.kind !== "multipart",
    )
    .map((header) =>
      header.name.toLowerCase() === "authorization" &&
      request.basic !== undefined
        ? `authorization: basic ${request.basic.username}:${request.basic.password}`
        : `${header.name.toLowerCase()}: ${header.value}`,
    );
  if (request.cookies.length > 0) {
    headers.push(
      `cookie: ${request.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ")}`,
    );
  }
  return {
    body: bodyOf(request),
    headers: headers.sort(),
    method: request.method,
    url: request.url,
  };
}

function bodyOf(request: ResolvedRequest): string {
  const body = request.body;
  if (body === undefined) return "none";
  switch (body.kind) {
    case "json":
      return `json:${JSON.stringify(body.json ?? {})}`;
    case "form":
      return `form:${(body.fields ?? []).map((field) => `${field.name}=${field.value}`).join("&")}`;
    case "multipart":
      return `multipart:${(body.fields ?? [])
        .map((field) => `${field.name}=${field.file ? "<file>" : field.value}`)
        .sort()
        .join("&")}`;
    case "binary":
      return "binary";
    case "text":
    case "opaque":
      return `text:${body.text ?? ""}`;
  }
}

export function extract(
  language: ProtocolLanguage,
  code: string,
): NormalizedRequest {
  switch (language) {
    case "curl":
      return fromCurl(code);
    case "http":
      return fromHttp(code);
    case "javascript":
    case "typescript":
      return fromJs(code);
    case "java":
      return fromJava(code);
    case "python":
      return fromPython(code);
  }
}

// --- cURL -----------------------------------------------------------------

function shellWords(code: string): string[] {
  const text = code
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n")
    .replace(/\\\n/g, " ");
  const words: string[] = [];
  let current = "";
  let inWord = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] as string;
    if (character === "'") {
      inWord = true;
      const close = text.indexOf("'", index + 1);
      if (close === -1) throw new Error("Unterminated quote");
      current += text.slice(index + 1, close);
      index = close;
    } else if (character === "\\" && text[index + 1] === "'") {
      current += "'";
      index += 1;
    } else if (/\s/.test(character)) {
      if (inWord) words.push(current);
      current = "";
      inWord = false;
    } else {
      inWord = true;
      current += character;
    }
  }
  if (inWord) words.push(current);
  return words;
}

function fromCurl(code: string): NormalizedRequest {
  const words = shellWords(code);
  if (words[0] !== "curl") throw new Error("Not a curl command");
  let method = "GET";
  let url = "";
  const headers: string[] = [];
  let body = "none";
  const forms: string[] = [];
  for (let index = 1; index < words.length; index += 1) {
    const flag = words[index];
    const value = words[index + 1] ?? "";
    switch (flag) {
      case "--request":
        method = value;
        index += 1;
        break;
      case "--head":
        method = "HEAD";
        break;
      case "--url":
        url = value;
        index += 1;
        break;
      case "--header": {
        const colon = value.indexOf(":");
        headers.push(
          `${value.slice(0, colon).toLowerCase()}: ${value.slice(colon + 1).trim()}`,
        );
        index += 1;
        break;
      }
      case "--cookie":
        headers.push(`cookie: ${value}`);
        index += 1;
        break;
      case "--user":
        headers.push(`authorization: basic ${value}`);
        index += 1;
        break;
      case "--cert":
      case "--key":
        index += 1;
        break;
      case "--data":
        body =
          value.startsWith("{") || value.startsWith("[")
            ? `json:${JSON.stringify(JSON.parse(value))}`
            : `form:${value}`;
        index += 1;
        break;
      case "--data-binary":
        body = value === "@/path/to/file" ? "binary" : `text:${value}`;
        index += 1;
        break;
      case "--form":
      case "--form-string": {
        const equals = value.indexOf("=");
        const fieldValue = value.slice(equals + 1);
        forms.push(
          `${value.slice(0, equals)}=${fieldValue.startsWith("@") ? "<file>" : fieldValue}`,
        );
        index += 1;
        break;
      }
      default:
        throw new Error(`Unexpected curl word ${flag}`);
    }
  }
  if (forms.length > 0) body = `multipart:${forms.sort().join("&")}`;
  return { body, headers: headers.sort(), method, url };
}

// --- HTTP -----------------------------------------------------------------

function fromHttp(code: string): NormalizedRequest {
  const [head, ...rest] = code.split("\n\n");
  const lines = (head ?? "").split("\n");
  const [method, target] = (lines[0] ?? "").split(" ");
  let host = "";
  const headers: string[] = [];
  let multipart = false;
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    const name = line.slice(0, colon).toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "host") host = value;
    else if (name === "content-type" && value.startsWith("multipart/"))
      multipart = true;
    else if (name === "authorization" && value === "Basic <BASE64_CREDENTIALS>")
      headers.push("authorization: basic <USERNAME>:<PASSWORD>");
    else headers.push(`${name}: ${value}`);
  }
  const scheme =
    host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const bodyText = rest.join("\n\n").replace(/\n$/, "");
  let body = "none";
  if (rest.length > 0) {
    if (multipart) {
      const fields = [
        ...bodyText.matchAll(
          /name="([^"]+)"(?:; filename="[^"]*")?\n(?:Content-Type: [^\n]+\n)?\n([^\n]*)/g,
        ),
      ].map(
        (match) =>
          `${match[1]}=${match[2] === "<FILE_CONTENTS>" ? "<file>" : match[2]}`,
      );
      body = `multipart:${fields.sort().join("&")}`;
    } else if (bodyText === "<FILE_CONTENTS>") body = "binary";
    else {
      const contentType =
        headers
          .find((header) => header.startsWith("content-type: "))
          ?.slice(14) ?? "";
      if (/^application\/(?:[\w.+-]+\+)?json/.test(contentType))
        body = `json:${JSON.stringify(JSON.parse(bodyText))}`;
      else if (contentType === "application/x-www-form-urlencoded")
        body = `form:${bodyText}`;
      else body = `text:${bodyText}`;
    }
  }
  return {
    body,
    headers: headers.sort(),
    method: method ?? "",
    url: `${scheme}://${host}${target}`,
  };
}

// --- JavaScript / TypeScript --------------------------------------------

function jsObjectToJson(literal: string): string {
  // Quote bare keys and drop trailing commas; string values are JSON already.
  const quoted = literal
    .replace(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/gm, '$1"$2"$3')
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.stringify(JSON.parse(quoted));
}

function fromJs(code: string): NormalizedRequest {
  const url = /fetch\("((?:[^"\\]|\\.)*)"/.exec(code)?.[1];
  const method = /method: "([A-Z]+)"/.exec(code)?.[1];
  if (url === undefined || method === undefined)
    throw new Error("Unrecognized fetch");
  const headers: string[] = [];
  const block = /headers: \{\n([\s\S]*?)\n {2}\}/.exec(code)?.[1] ?? "";
  for (const line of block.split("\n")) {
    const basic = /"Authorization": "Basic " \+ btoa\("([^"]+)"\)/.exec(line);
    if (basic !== null) {
      headers.push(`authorization: basic ${basic[1]}`);
      continue;
    }
    const pair = /^\s*"((?:[^"\\]|\\.)*)": "((?:[^"\\]|\\.)*)",$/.exec(line);
    if (pair !== null) {
      headers.push(
        `${JSON.parse(`"${pair[1]}"`).toLowerCase()}: ${JSON.parse(`"${pair[2]}"`)}`,
      );
    }
  }
  let body = "none";
  const json = /body: JSON\.stringify\(([\s\S]*?)\),\n(?:\}|\})/.exec(
    code,
  )?.[1];
  if (json !== undefined) body = `json:${jsObjectToJson(json)}`;
  else if (/body: form,/.test(code)) {
    const fields = [
      ...code.matchAll(
        /form\.append\("([^"]+)", (?:"((?:[^"\\]|\\.)*)"|file)\)/g,
      ),
    ].map(
      (match) =>
        `${match[1]}=${match[2] === undefined ? "<file>" : JSON.parse(`"${match[2]}"`)}`,
    );
    body = `multipart:${fields.sort().join("&")}`;
  } else if (/body: file,/.test(code)) body = "binary";
  else {
    const text = /body: "((?:[^"\\]|\\.)*)",/.exec(code)?.[1];
    if (text !== undefined) {
      const value = JSON.parse(`"${text}"`) as string;
      body = headers.includes("content-type: application/x-www-form-urlencoded")
        ? `form:${value}`
        : `text:${value}`;
    }
  }
  return {
    body,
    headers: headers.sort(),
    method,
    url: JSON.parse(`"${url}"`) as string,
  };
}

// --- Java -----------------------------------------------------------------

function javaUnescape(literal: string): string {
  return JSON.parse(`"${literal}"`) as string;
}

function fromJava(code: string): NormalizedRequest {
  const url = /URI\.create\("((?:[^"\\]|\\.)*)"\)/.exec(code)?.[1];
  if (url === undefined) throw new Error("Unrecognized Java request");
  const headers: string[] = [];
  let multipart = false;
  for (const match of code.matchAll(
    /\.header\("((?:[^"\\]|\\.)*)", ("Basic " \+ Base64[^\n]*|"(?:[^"\\]|\\.)*")\)/g,
  )) {
    const name = javaUnescape(match[1] as string).toLowerCase();
    const raw = match[2] as string;
    if (raw.startsWith('"Basic " + Base64')) {
      const credentials =
        /encodeToString\("((?:[^"\\]|\\.)*)"/.exec(raw)?.[1] ?? "";
      headers.push(`authorization: basic ${javaUnescape(credentials)}`);
    } else if (name === "content-type" && raw.includes("multipart/")) {
      multipart = true;
    } else {
      headers.push(`${name}: ${javaUnescape(raw.slice(1, -1))}`);
    }
  }
  const explicit = /\.(GET|DELETE)\(\)/.exec(code)?.[1];
  const withBody = /\.(POST|PUT)\(/.exec(code)?.[1];
  const generic = /\.method\("([A-Z]+)"/.exec(code)?.[1];
  const method = explicit ?? withBody ?? generic ?? "";
  let body = "none";
  const block = /ofString\("""\n([\s\S]*?)\\\n\s*"""\)/.exec(code)?.[1];
  if (block !== undefined) {
    const text = block
      .split("\n")
      .map((line) => line.replace(/^ {8}/, ""))
      .join("\n")
      .replace(/\\"""/g, '"""')
      .replace(/\\\\/g, "\\");
    const contentType =
      headers
        .find((header) => header.startsWith("content-type: "))
        ?.slice(14) ?? "";
    body = /^application\/(?:[\w.+-]+\+)?json/.test(contentType)
      ? `json:${JSON.stringify(JSON.parse(text))}`
      : `text:${text}`;
  } else {
    const form = /ofString\("((?:[^"\\]|\\.)*)"\)/.exec(code)?.[1];
    if (form !== undefined) body = `form:${javaUnescape(form)}`;
    else if (/ofFile\(/.test(code)) body = "binary";
    else if (multipart) {
      const fields = [
        ...code.matchAll(
          /name=\\"([^\\]+)\\"(?:; filename=\\"file\\"\\r\\n(?:Content-Type: [^\\]+\\r\\n)?\\r\\n|\\r\\n\\r\\n([^\\]*)\\r\\n)/g,
        ),
      ].map(
        (match) =>
          `${match[1]}=${match[2] === undefined ? "<file>" : match[2]}`,
      );
      body = `multipart:${fields.sort().join("&")}`;
    } else if (/noBody\(\)/.test(code)) body = "none";
  }
  return { body, headers: headers.sort(), method, url: javaUnescape(url) };
}

// --- Python ---------------------------------------------------------------

function pyUnescape(literal: string): string {
  return JSON.parse(`"${literal}"`) as string;
}

function pyLiteralToJson(literal: string): string {
  const converted = literal
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.stringify(JSON.parse(converted));
}

function pyDict(section: string | undefined): [string, string][] {
  if (section === undefined) return [];
  return [
    ...section.matchAll(/"((?:[^"\\]|\\.)*)": "((?:[^"\\]|\\.)*)",/g),
  ].map((match) => [
    pyUnescape(match[1] as string),
    pyUnescape(match[2] as string),
  ]);
}

function fromPython(code: string): NormalizedRequest {
  const call = /requests\.(\w+)\(\n([\s\S]*)\n\)\nprint/.exec(code);
  if (call === null) throw new Error("Unrecognized requests call");
  // The last argument keeps its trailing comma but not its newline.
  const args = `${call[2] as string}\n`;
  let method = (call[1] as string).toUpperCase();
  let rest = args;
  if (method === "REQUEST") {
    method = pyUnescape(/^\s*"([A-Z]+)",\n/.exec(args)?.[1] ?? "");
    rest = args.replace(/^\s*"[A-Z]+",\n/, "");
  }
  const url = /^\s*"((?:[^"\\]|\\.)*)",/.exec(rest)?.[1];
  if (url === undefined) throw new Error("No URL");
  const headers = pyDict(/headers=\{\n([\s\S]*?)\n {4}\}/.exec(rest)?.[1]).map(
    ([name, value]) => `${name.toLowerCase()}: ${value}`,
  );
  const cookies = pyDict(/cookies=\{\n([\s\S]*?)\n {4}\}/.exec(rest)?.[1]);
  if (cookies.length > 0)
    headers.push(
      `cookie: ${cookies.map(([name, value]) => `${name}=${value}`).join("; ")}`,
    );
  const auth = /auth=\("((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\)/.exec(rest);
  if (auth !== null)
    headers.push(
      `authorization: basic ${pyUnescape(auth[1] as string)}:${pyUnescape(auth[2] as string)}`,
    );
  let body = "none";
  const json = /json=(\{[\s\S]*?\n {4}\}|\{\}),\n/.exec(rest)?.[1];
  const dumps = /data=json\.dumps\((\{[\s\S]*?\n {4}\}|\{\})\),\n/.exec(
    rest,
  )?.[1];
  if (json !== undefined) {
    body = `json:${pyLiteralToJson(json)}`;
    headers.push("content-type: application/json");
  } else if (dumps !== undefined) body = `json:${pyLiteralToJson(dumps)}`;
  else if (/data=open\(/.test(rest)) body = "binary";
  else if (/files=\{/.test(rest) || /data=\{/.test(rest)) {
    const data = pyDict(/data=\{\n([\s\S]*?)\n {4}\}/.exec(rest)?.[1]).map(
      ([name, value]) => `${name}=${value}`,
    );
    const files = [
      ...(/files=\{\n([\s\S]*?)\n {4}\}/.exec(rest)?.[1] ?? "").matchAll(
        /"((?:[^"\\]|\\.)*)": /g,
      ),
    ].map((match) => `${pyUnescape(match[1] as string)}=<file>`);
    body = `multipart:${[...data, ...files].sort().join("&")}`;
  } else {
    const text = /data="((?:[^"\\]|\\.)*)",\n/.exec(rest)?.[1];
    if (text !== undefined) {
      const value = pyUnescape(text);
      body = headers.includes("content-type: application/x-www-form-urlencoded")
        ? `form:${value}`
        : `text:${value}`;
    }
  }
  return { body, headers: headers.sort(), method, url: pyUnescape(url) };
}
