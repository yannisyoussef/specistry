import { jsonText } from "../escape.js";
import type { ResolvedRequest, Snippet } from "../types.js";
import { basePathOf, hostOf, queryString } from "../url.js";
import { Writer } from "../writer.js";
import {
  FILE_CONTENTS,
  headerLines,
  isPlaceholderUrl,
  MULTIPART_BOUNDARY,
} from "./shared.js";

/**
 * Raw HTTP/1.1 request as documentation: request line, `Host`, headers, a
 * blank line, and the body. No `Content-Length` or chunking is shown; the
 * representation is for reading, not wire framing. Header values cannot
 * contain CR or LF (the sanitizer removed them), so a value never becomes a
 * second header.
 */
export function generateHttp(request: ResolvedRequest): Snippet {
  const writer = new Writer();
  const placeholder = isPlaceholderUrl(request);
  // Built from the parts, not re-parsed from the URL, so placeholders keep
  // their `<NAME>` spelling in the request line.
  const basePath = placeholder ? "" : basePathOf(request.baseUrl);
  const target = `${basePath}${request.path}${request.query.length === 0 ? "" : `?${queryString(request.query)}`}`;
  writer
    .kw(request.method)
    .plain(" ")
    .str(target)
    .plain(" ")
    .type("HTTP/1.1")
    .nl();
  writer
    .attr("Host")
    .plain(": ")
    .plain(placeholder ? "<HOST>" : hostOf(request.url))
    .nl();
  const body = request.body;
  for (const header of headerLines(request, {
    withBasic: true,
    withCookies: true,
  })) {
    writer.attr(header.name).plain(": ").plain(header.value).nl();
  }
  if (body?.kind === "multipart") {
    writer
      .attr("Content-Type")
      .plain(": ")
      .plain(`${body.mediaType}; boundary=${MULTIPART_BOUNDARY}`)
      .nl();
  }
  if (body === undefined) return writer.finish("http");
  writer.nl();
  switch (body.kind) {
    case "json":
      writer.plain(jsonText(body.json ?? {})).nl();
      break;
    case "form":
      writer
        .plain(
          (body.fields ?? [])
            .map((field) => `${field.name}=${field.value}`)
            .join("&"),
        )
        .nl();
      break;
    case "multipart":
      for (const field of body.fields ?? []) {
        writer.cmt(`--${MULTIPART_BOUNDARY}`).nl();
        writer
          .attr("Content-Disposition")
          .plain(": form-data; name=")
          .str(`"${field.name}"`);
        if (field.file) writer.plain("; filename=").str('"file"');
        writer.nl();
        if (field.file && field.contentType !== undefined) {
          writer.attr("Content-Type").plain(": ").plain(field.contentType).nl();
        }
        writer.nl();
        writer.plain(field.file ? FILE_CONTENTS : field.value).nl();
      }
      writer.cmt(`--${MULTIPART_BOUNDARY}--`).nl();
      break;
    case "binary":
      writer.plain(FILE_CONTENTS).nl();
      break;
    case "text":
    case "opaque":
      writer.plain(body.text ?? "").nl();
      break;
  }
  return writer.finish("http");
}
