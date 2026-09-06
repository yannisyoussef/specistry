import { jsString, writeJsObject } from "../escape.js";
import type { ResolvedRequest, Snippet } from "../types.js";
import { Writer } from "../writer.js";
import {
  cookieHeader,
  headerLines,
  preambleNotes,
  writeComments,
} from "./shared.js";

/**
 * JavaScript and TypeScript over the platform `fetch` API: no third-party
 * dependency, a literal URL from the validated environment, a headers
 * object, and a body per media type. TypeScript is the same request with
 * explicit `RequestInit`, `Response`, and `unknown` types and a `declare`
 * for the file placeholder; no application interfaces or SDK types are
 * invented (see docs/code-samples.md).
 */
export function generateJavaScript(
  request: ResolvedRequest,
  typed: boolean,
): Snippet {
  const writer = new Writer();
  writeComments(writer, "// ", preambleNotes(request));
  if (request.mutualTls) {
    writer
      .cmt(
        "// Mutual TLS: configure the client certificate in your HTTP agent; browsers cannot present one from fetch.",
      )
      .nl();
  }
  const body = request.body;
  const usesFile =
    body?.kind === "binary" ||
    (body?.kind === "multipart" &&
      (body.fields ?? []).some((field) => field.file));
  if (usesFile) {
    if (typed) {
      writer
        .kw("declare const")
        .plain(" ")
        .variable("file")
        .plain(": ")
        .type("Blob")
        .plain(";")
        .nl();
    } else {
      writer.cmt("// const file = ... // a File or Blob").nl();
    }
  }
  if (body?.kind === "multipart") {
    writer
      .kw("const")
      .plain(" ")
      .variable("form")
      .plain(" = ")
      .kw("new")
      .plain(" ")
      .type("FormData")
      .plain("();")
      .nl();
    for (const field of body.fields ?? []) {
      writer
        .variable("form")
        .plain(".")
        .fn("append")
        .plain("(")
        .str(jsString(field.name))
        .plain(", ");
      if (field.file) writer.variable("file");
      else writer.str(jsString(field.value));
      writer.plain(");").nl();
    }
  }
  if (request.cookies.length > 0) {
    writer
      .cmt(
        "// Node.js sends the Cookie header as given; browsers manage cookies themselves.",
      )
      .nl();
  }
  if (typed) {
    writer
      .kw("const")
      .plain(" ")
      .variable("init")
      .plain(": ")
      .type("RequestInit")
      .plain(" = {")
      .nl();
  } else {
    writer
      .kw("const")
      .plain(" ")
      .variable("response")
      .plain(" = ")
      .kw("await")
      .plain(" ")
      .fn("fetch")
      .plain("(")
      .str(jsString(request.url))
      .plain(", {")
      .nl();
  }
  writer
    .plain("  ")
    .attr("method")
    .plain(": ")
    .str(jsString(request.method))
    .plain(",")
    .nl();
  const headers = headerLines(request, {
    withBasic: false,
    withCookies: false,
  });
  const cookies = request.cookies.length > 0;
  if (headers.length > 0 || request.basic !== undefined || cookies) {
    writer.plain("  ").attr("headers").plain(": {").nl();
    for (const header of headers) {
      writer
        .plain("    ")
        .attr(jsString(header.name))
        .plain(": ")
        .str(jsString(header.value))
        .plain(",")
        .nl();
    }
    if (request.basic !== undefined) {
      writer
        .plain("    ")
        .attr(jsString("Authorization"))
        .plain(": ")
        .str(jsString("Basic "))
        .plain(" + ")
        .fn("btoa")
        .plain("(")
        .str(jsString(`${request.basic.username}:${request.basic.password}`))
        .plain("),")
        .nl();
    }
    if (cookies) {
      writer
        .plain("    ")
        .attr(jsString("Cookie"))
        .plain(": ")
        .str(jsString(cookieHeader(request.cookies)))
        .plain(",")
        .nl();
    }
    writer.plain("  },").nl();
  }
  if (body !== undefined) {
    writer.plain("  ").attr("body").plain(": ");
    switch (body.kind) {
      case "json":
        writer.type("JSON").plain(".").fn("stringify").plain("(");
        writeJsObject(writer, body.json ?? {}, "  ");
        writer.plain(")");
        break;
      case "form":
        writer.str(
          jsString(
            (body.fields ?? [])
              .map((field) => `${field.name}=${field.value}`)
              .join("&"),
          ),
        );
        break;
      case "multipart":
        writer.variable("form");
        break;
      case "binary":
        writer.variable("file");
        break;
      case "text":
      case "opaque":
        writer.str(jsString(body.text ?? ""));
        break;
    }
    writer.plain(",").nl();
  }
  if (typed) {
    writer.plain("};").nl();
    writer
      .kw("const")
      .plain(" ")
      .variable("response")
      .plain(": ")
      .type("Response")
      .plain(" = ")
      .kw("await")
      .plain(" ")
      .fn("fetch")
      .plain("(")
      .str(jsString(request.url))
      .plain(", ")
      .variable("init")
      .plain(");")
      .nl();
  } else {
    writer.plain("});").nl();
  }
  switch (request.responseKind) {
    case "json":
      writer.kw("const").plain(" ").variable("data");
      if (typed) writer.plain(": ").type("unknown");
      writer
        .plain(" = ")
        .kw("await")
        .plain(" ")
        .variable("response")
        .plain(".")
        .fn("json")
        .plain("();")
        .nl();
      writer
        .variable("console")
        .plain(".")
        .fn("log")
        .plain("(")
        .variable("response")
        .plain(".")
        .attr("status")
        .plain(", ")
        .variable("data")
        .plain(");")
        .nl();
      break;
    case "text":
      writer
        .variable("console")
        .plain(".")
        .fn("log")
        .plain("(")
        .variable("response")
        .plain(".")
        .attr("status")
        .plain(", ")
        .kw("await")
        .plain(" ")
        .variable("response")
        .plain(".")
        .fn("text")
        .plain("());")
        .nl();
      break;
    case "none":
      writer
        .variable("console")
        .plain(".")
        .fn("log")
        .plain("(")
        .variable("response")
        .plain(".")
        .attr("status")
        .plain(");")
        .nl();
      break;
  }
  return writer.finish(typed ? "typescript" : "javascript");
}
