import { jsonText, shellQuote } from "../escape.js";
import type { ResolvedRequest, Snippet } from "../types.js";
import { Writer } from "../writer.js";
import {
  CLIENT_CERT,
  CLIENT_KEY,
  cookieHeader,
  headerLines,
  preambleNotes,
  writeComments,
} from "./shared.js";

/**
 * cURL. Every argument is single-quoted (`'` becomes `'\''`), so no
 * canonical value can close the quote, start a subshell, or add an option;
 * options appear in a fixed order (request, url, headers, cookie, user,
 * certificate, body) and multi-line bodies stay inside their quotes.
 */
export function generateCurl(request: ResolvedRequest): Snippet {
  const writer = new Writer();
  writeComments(writer, "# ", preambleNotes(request));
  if (request.mutualTls) {
    writer
      .cmt("# Mutual TLS: present the client certificate issued for this API.")
      .nl();
  }
  const options: (() => void)[] = [];
  const option = (flag: string, value?: string) => {
    options.push(() => {
      writer.attr(flag);
      if (value !== undefined) writer.plain(" ").str(shellQuote(value));
    });
  };
  writer.fn("curl");
  if (request.method === "HEAD") {
    options.push(() => writer.attr("--head"));
  } else {
    options.push(() => {
      writer.attr("--request").plain(" ").kw(request.method);
    });
  }
  option("--url", request.url);
  for (const header of headerLines(request, {
    withBasic: false,
    withCookies: false,
  })) {
    option("--header", `${header.name}: ${header.value}`);
  }
  if (request.cookies.length > 0) {
    option("--cookie", cookieHeader(request.cookies));
  }
  if (request.basic !== undefined) {
    option("--user", `${request.basic.username}:${request.basic.password}`);
  }
  if (request.mutualTls) {
    option("--cert", CLIENT_CERT);
    option("--key", CLIENT_KEY);
  }
  const body = request.body;
  if (body !== undefined) {
    switch (body.kind) {
      case "json":
        option("--data", jsonText(body.json ?? {}));
        break;
      case "form":
        option(
          "--data",
          (body.fields ?? [])
            .map((field) => `${field.name}=${field.value}`)
            .join("&"),
        );
        break;
      case "multipart":
        for (const field of body.fields ?? []) {
          if (field.file) {
            option(
              "--form",
              `${field.name}=@${field.value}${field.contentType === undefined ? "" : `;type=${field.contentType}`}`,
            );
          } else {
            option("--form-string", `${field.name}=${field.value}`);
          }
        }
        break;
      case "binary":
        option("--data-binary", "@/path/to/file");
        break;
      case "text":
      case "opaque":
        option("--data-binary", body.text ?? "");
        break;
    }
  }
  options.forEach((emit, index) => {
    if (index === 0) writer.plain(" ");
    else writer.plain(" \\").nl().plain("  ");
    emit();
  });
  return writer.finish("curl");
}
