import { pythonString, writePythonObject } from "../escape.js";
import type { ResolvedRequest, Snippet } from "../types.js";
import { Writer } from "../writer.js";
import {
  CLIENT_CERT,
  CLIENT_KEY,
  headerLines,
  preambleNotes,
  writeComments,
} from "./shared.js";

const METHODS: ReadonlySet<string> = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
]);

/**
 * Python over `requests` (the comment on the import says it is a package to
 * install). The standard library alone cannot express multipart uploads or
 * form bodies credibly; `requests` is the widely known baseline and keeps
 * the example to one call. The serialized URL is passed literally so query
 * semantics are identical to every other language.
 */
export function generatePython(request: ResolvedRequest): Snippet {
  const writer = new Writer();
  const body = request.body;
  const plainJson =
    body?.kind === "json" &&
    body.mediaType.toLowerCase() === "application/json";
  const jsonDumps = body?.kind === "json" && !plainJson;
  if (jsonDumps) writer.kw("import").plain(" ").type("json").nl().nl();
  writer
    .kw("import")
    .plain(" ")
    .type("requests")
    .plain("  ")
    .cmt("# pip install requests")
    .nl();
  writer.nl();
  writeComments(writer, "# ", preambleNotes(request));
  writer.variable("response").plain(" = ").type("requests").plain(".");
  if (METHODS.has(request.method)) {
    writer.fn(request.method.toLowerCase()).plain("(").nl();
  } else {
    writer.fn("request").plain("(").nl();
    writer.plain("    ").str(pythonString(request.method)).plain(",").nl();
  }
  writer.plain("    ").str(pythonString(request.url)).plain(",").nl();
  const headers = headerLines(request, {
    withBasic: false,
    withCookies: false,
  }).filter(
    (header) => !(plainJson && header.name.toLowerCase() === "content-type"),
  );
  if (headers.length > 0) {
    writer.plain("    ").variable("headers").plain("={").nl();
    for (const header of headers) {
      writer
        .plain("        ")
        .str(pythonString(header.name))
        .plain(": ")
        .str(pythonString(header.value))
        .plain(",")
        .nl();
    }
    writer.plain("    },").nl();
  }
  if (request.cookies.length > 0) {
    writer.plain("    ").variable("cookies").plain("={").nl();
    for (const cookie of request.cookies) {
      writer
        .plain("        ")
        .str(pythonString(cookie.name))
        .plain(": ")
        .str(pythonString(cookie.value))
        .plain(",")
        .nl();
    }
    writer.plain("    },").nl();
  }
  if (request.basic !== undefined) {
    writer
      .plain("    ")
      .variable("auth")
      .plain("=(")
      .str(pythonString(request.basic.username))
      .plain(", ")
      .str(pythonString(request.basic.password))
      .plain("),")
      .nl();
  }
  if (request.mutualTls) {
    writer
      .plain("    ")
      .variable("cert")
      .plain("=(")
      .str(pythonString(CLIENT_CERT))
      .plain(", ")
      .str(pythonString(CLIENT_KEY))
      .plain("),")
      .nl();
  }
  if (body !== undefined) {
    switch (body.kind) {
      case "json":
        if (plainJson) {
          writer.plain("    ").variable("json").plain("=");
          writePythonObject(writer, body.json ?? {}, "    ");
        } else {
          writer
            .plain("    ")
            .variable("data")
            .plain("=")
            .type("json")
            .plain(".")
            .fn("dumps")
            .plain("(");
          writePythonObject(writer, body.json ?? {}, "    ");
          writer.plain(")");
        }
        writer.plain(",").nl();
        break;
      case "form":
        writer
          .plain("    ")
          .variable("data")
          .plain("=")
          .str(
            pythonString(
              (body.fields ?? [])
                .map((field) => `${field.name}=${field.value}`)
                .join("&"),
            ),
          )
          .plain(",")
          .nl();
        break;
      case "multipart": {
        const fields = body.fields ?? [];
        const text = fields.filter((field) => !field.file);
        const files = fields.filter((field) => field.file);
        if (text.length > 0) {
          writer.plain("    ").variable("data").plain("={").nl();
          for (const field of text) {
            writer
              .plain("        ")
              .str(pythonString(field.name))
              .plain(": ")
              .str(pythonString(field.value))
              .plain(",")
              .nl();
          }
          writer.plain("    },").nl();
        }
        if (files.length > 0) {
          writer.plain("    ").variable("files").plain("={").nl();
          for (const field of files) {
            writer.plain("        ").str(pythonString(field.name)).plain(": ");
            if (field.contentType === undefined) {
              writer
                .fn("open")
                .plain("(")
                .str(pythonString(field.value))
                .plain(", ")
                .str(pythonString("rb"))
                .plain(")");
            } else {
              writer
                .plain("(")
                .str(pythonString("file"))
                .plain(", ")
                .fn("open")
                .plain("(")
                .str(pythonString(field.value))
                .plain(", ")
                .str(pythonString("rb"))
                .plain("), ")
                .str(pythonString(field.contentType))
                .plain(")");
            }
            writer.plain(",").nl();
          }
          writer.plain("    },").nl();
        }
        break;
      }
      case "binary":
        writer
          .plain("    ")
          .variable("data")
          .plain("=")
          .fn("open")
          .plain("(")
          .str(pythonString("/path/to/file"))
          .plain(", ")
          .str(pythonString("rb"))
          .plain("),")
          .nl();
        break;
      case "text":
      case "opaque":
        writer
          .plain("    ")
          .variable("data")
          .plain("=")
          .str(pythonString(body.text ?? ""))
          .plain(",")
          .nl();
        break;
    }
  }
  writer.plain(")").nl();
  writer
    .fn("print")
    .plain("(")
    .variable("response")
    .plain(".")
    .attr("status_code")
    .plain(")")
    .nl();
  switch (request.responseKind) {
    case "json":
      writer
        .fn("print")
        .plain("(")
        .variable("response")
        .plain(".")
        .fn("json")
        .plain("())")
        .nl();
      break;
    case "text":
      writer
        .fn("print")
        .plain("(")
        .variable("response")
        .plain(".")
        .attr("text")
        .plain(")")
        .nl();
      break;
    case "none":
      break;
  }
  return writer.finish("python");
}
