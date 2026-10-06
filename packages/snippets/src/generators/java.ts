import { javaString, jsonText } from "../escape.js";
import type { ResolvedRequest, Snippet } from "../types.js";
import { Writer } from "../writer.js";
import {
  cookieHeader,
  headerLines,
  preambleNotes,
  writeComments,
} from "./shared.js";

/**
 * Java over the JDK's `java.net.http.HttpClient` (Java 17 baseline: text
 * blocks carry JSON and text bodies). No third-party dependency, no SDK.
 * Multipart bodies are assembled from byte arrays with a fixed boundary
 * because the JDK client has no multipart helper; file parts read a
 * placeholder path.
 */
export function generateJava(request: ResolvedRequest): Snippet {
  const writer = new Writer();
  const body = request.body;
  const imports = new Set([
    "java.net.URI",
    "java.net.http.HttpClient",
    "java.net.http.HttpRequest",
    "java.net.http.HttpResponse",
  ]);
  if (request.basic !== undefined) {
    imports.add("java.nio.charset.StandardCharsets");
    imports.add("java.util.Base64");
  }
  if (body?.kind === "binary") imports.add("java.nio.file.Path");
  if (body?.kind === "multipart") {
    imports.add("java.nio.charset.StandardCharsets");
    imports.add("java.util.ArrayList");
    imports.add("java.util.List");
    if ((body.fields ?? []).some((field) => field.file)) {
      imports.add("java.nio.file.Files");
      imports.add("java.nio.file.Path");
    }
  }
  for (const name of [...imports].sort()) {
    writer.kw("import").plain(" ").type(name).plain(";").nl();
  }
  writer.nl();
  writeComments(writer, "// ", preambleNotes(request));
  if (request.mutualTls) {
    writer
      .cmt(
        "// Mutual TLS: build the client with HttpClient.newBuilder().sslContext(...) holding the client certificate.",
      )
      .nl();
  }
  writer
    .type("HttpClient")
    .plain(" ")
    .variable("client")
    .plain(" = ")
    .type("HttpClient")
    .plain(".")
    .fn("newHttpClient")
    .plain("();")
    .nl();
  if (body?.kind === "multipart") writeMultipart(writer, body.fields ?? []);
  writer
    .type("HttpRequest")
    .plain(" ")
    .variable("request")
    .plain(" = ")
    .type("HttpRequest")
    .plain(".")
    .fn("newBuilder")
    .plain("()")
    .nl();
  writer
    .plain("    .")
    .fn("uri")
    .plain("(")
    .type("URI")
    .plain(".")
    .fn("create")
    .plain("(")
    .str(javaString(request.url))
    .plain("))")
    .nl();
  for (const header of headerLines(request, {
    withBasic: false,
    withCookies: true,
  })) {
    writer
      .plain("    .")
      .fn("header")
      .plain("(")
      .str(javaString(header.name))
      .plain(", ")
      .str(javaString(header.value))
      .plain(")")
      .nl();
  }
  if (request.basic !== undefined) {
    writer
      .plain("    .")
      .fn("header")
      .plain("(")
      .str(javaString("Authorization"))
      .plain(", ")
      .str(javaString("Basic "))
      .plain(" + ")
      .type("Base64")
      .plain(".")
      .fn("getEncoder")
      .plain("().")
      .fn("encodeToString")
      .plain("(")
      .str(javaString(`${request.basic.username}:${request.basic.password}`))
      .plain(".")
      .fn("getBytes")
      .plain("(")
      .type("StandardCharsets")
      .plain(".UTF_8)))")
      .nl();
  }
  if (body?.kind === "multipart") {
    writer
      .plain("    .")
      .fn("header")
      .plain("(")
      .str(javaString("Content-Type"))
      .plain(", ")
      .str(javaString(`${body.mediaType}; boundary=${BOUNDARY}`))
      .plain(")")
      .nl();
  }
  writeMethod(writer, request);
  writer.plain("    .").fn("build").plain("();").nl();
  writer
    .type("HttpResponse")
    .plain("<")
    .type("String")
    .plain("> ")
    .variable("response")
    .plain(" = ")
    .variable("client")
    .plain(".")
    .fn("send")
    .plain("(")
    .variable("request")
    .plain(", ")
    .type("HttpResponse")
    .plain(".")
    .type("BodyHandlers")
    .plain(".")
    .fn("ofString")
    .plain("());")
    .nl();
  writer
    .type("System")
    .plain(".")
    .variable("out")
    .plain(".")
    .fn("println")
    .plain("(")
    .variable("response")
    .plain(".")
    .fn("statusCode")
    .plain("());")
    .nl();
  writer
    .type("System")
    .plain(".")
    .variable("out")
    .plain(".")
    .fn("println")
    .plain("(")
    .variable("response")
    .plain(".")
    .fn("body")
    .plain("());")
    .nl();
  return writer.finish("java");
}

const BOUNDARY = "----SpecistryFormBoundary";

function publisher(writer: Writer, request: ResolvedRequest): void {
  const body = request.body;
  if (body === undefined) {
    writer
      .type("HttpRequest")
      .plain(".")
      .type("BodyPublishers")
      .plain(".")
      .fn("noBody")
      .plain("()");
    return;
  }
  switch (body.kind) {
    case "json":
      writer
        .type("HttpRequest")
        .plain(".")
        .type("BodyPublishers")
        .plain(".")
        .fn("ofString")
        .plain("(");
      writeTextBlock(writer, jsonText(body.json ?? {}));
      writer.plain(")");
      break;
    case "form":
      writer
        .type("HttpRequest")
        .plain(".")
        .type("BodyPublishers")
        .plain(".")
        .fn("ofString")
        .plain("(")
        .str(
          javaString(
            (body.fields ?? [])
              .map((field) => `${field.name}=${field.value}`)
              .join("&"),
          ),
        )
        .plain(")");
      break;
    case "multipart":
      writer
        .type("HttpRequest")
        .plain(".")
        .type("BodyPublishers")
        .plain(".")
        .fn("ofByteArrays")
        .plain("(")
        .variable("parts")
        .plain(")");
      break;
    case "binary":
      writer
        .type("HttpRequest")
        .plain(".")
        .type("BodyPublishers")
        .plain(".")
        .fn("ofFile")
        .plain("(")
        .type("Path")
        .plain(".")
        .fn("of")
        .plain("(")
        .str(javaString("/path/to/file"))
        .plain("))");
      break;
    case "text":
    case "opaque":
      writer
        .type("HttpRequest")
        .plain(".")
        .type("BodyPublishers")
        .plain(".")
        .fn("ofString")
        .plain("(");
      writeTextBlock(writer, body.text ?? "");
      writer.plain(")");
      break;
  }
}

function writeMethod(writer: Writer, request: ResolvedRequest): void {
  const hasBody = request.body !== undefined;
  writer.plain("    .");
  if (request.method === "GET" && !hasBody) {
    writer.fn("GET").plain("()").nl();
    return;
  }
  if (request.method === "DELETE" && !hasBody) {
    writer.fn("DELETE").plain("()").nl();
    return;
  }
  if ((request.method === "POST" || request.method === "PUT") && hasBody) {
    writer.fn(request.method).plain("(");
    publisher(writer, request);
    writer.plain(")").nl();
    return;
  }
  writer.fn("method").plain("(").str(javaString(request.method)).plain(", ");
  publisher(writer, request);
  writer.plain(")").nl();
}

/**
 * A Java text block: content lines indented, `\` and `"""` escaped, and the
 * last line ended with the `\<newline>` escape so the value carries no
 * trailing newline the source did not have.
 */
function writeTextBlock(writer: Writer, text: string): void {
  const escaped = text.replace(/\\/g, "\\\\").replace(/"""/g, '\\"""');
  const lines = escaped.split("\n");
  writer.str('"""').nl();
  lines.forEach((line, index) => {
    writer.str(`        ${line}${index === lines.length - 1 ? "\\" : ""}`).nl();
  });
  writer.str('        """');
}

function writeMultipart(
  writer: Writer,
  fields: readonly {
    name: string;
    value: string;
    file: boolean;
    contentType?: string;
  }[],
): void {
  writer
    .type("String")
    .plain(" ")
    .variable("boundary")
    .plain(" = ")
    .str(javaString(BOUNDARY))
    .plain(";")
    .nl();
  writer
    .type("List")
    .plain("<")
    .kw("byte")
    .plain("[]> ")
    .variable("parts")
    .plain(" = ")
    .kw("new")
    .plain(" ")
    .type("ArrayList")
    .plain("<>();")
    .nl();
  for (const field of fields) {
    const disposition = field.file
      ? `Content-Disposition: form-data; name="${field.name}"; filename="file"\r\n${field.contentType === undefined ? "" : `Content-Type: ${field.contentType}\r\n`}\r\n`
      : `Content-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`;
    writer
      .variable("parts")
      .plain(".")
      .fn("add")
      .plain("((")
      .str(javaString("--"))
      .plain(" + ")
      .variable("boundary")
      .plain(" + ")
      .str(javaString(`\r\n${disposition}`))
      .plain(").")
      .fn("getBytes")
      .plain("(")
      .type("StandardCharsets")
      .plain(".UTF_8));")
      .nl();
    if (field.file) {
      writer
        .variable("parts")
        .plain(".")
        .fn("add")
        .plain("(")
        .type("Files")
        .plain(".")
        .fn("readAllBytes")
        .plain("(")
        .type("Path")
        .plain(".")
        .fn("of")
        .plain("(")
        .str(javaString("/path/to/file"))
        .plain(")));")
        .nl();
      writer
        .variable("parts")
        .plain(".")
        .fn("add")
        .plain("(")
        .str(javaString("\r\n"))
        .plain(".")
        .fn("getBytes")
        .plain("(")
        .type("StandardCharsets")
        .plain(".UTF_8));")
        .nl();
    }
  }
  writer
    .variable("parts")
    .plain(".")
    .fn("add")
    .plain("((")
    .str(javaString("--"))
    .plain(" + ")
    .variable("boundary")
    .plain(" + ")
    .str(javaString("--\r\n"))
    .plain(").")
    .fn("getBytes")
    .plain("(")
    .type("StandardCharsets")
    .plain(".UTF_8));")
    .nl();
}

export { cookieHeader };
