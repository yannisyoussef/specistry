import type { Pair, ResolvedRequest } from "../types.js";
import type { Writer } from "../writer.js";

/** `a=b; c=d` for the single `Cookie` header. */
export function cookieHeader(cookies: readonly Pair[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

/** Headers to emit as literal header lines for a language. */
export function headerLines(
  request: ResolvedRequest,
  options: { readonly withBasic: boolean; readonly withCookies: boolean },
): readonly Pair[] {
  const headers = request.headers.filter(
    (header) =>
      options.withBasic ||
      request.basic === undefined ||
      header.name.toLowerCase() !== "authorization",
  );
  return options.withCookies && request.cookies.length > 0
    ? [...headers, { name: "Cookie", value: cookieHeader(request.cookies) }]
    : headers;
}

/** Comment lines that precede the code: scopes and mutual TLS. */
export function preambleNotes(request: ResolvedRequest): readonly string[] {
  const notes: string[] = [];
  const scopes = request.auth.schemes.flatMap((scheme) =>
    scheme.kind === "oauth2" ? scheme.scopes : [],
  );
  if (scopes.length > 0) {
    notes.push(
      `Requires an OAuth 2.0 access token with the scope${scopes.length > 1 ? "s" : ""} ${scopes.join(", ")}.`,
    );
  } else if (request.auth.schemes.some((scheme) => scheme.kind === "oauth2")) {
    notes.push("Requires an OAuth 2.0 access token.");
  }
  if (request.auth.schemes.some((scheme) => scheme.kind === "openIdConnect")) {
    notes.push("Requires an access token obtained through OpenID Connect.");
  }
  return notes;
}

export function writeComments(
  writer: Writer,
  prefix: string,
  notes: readonly string[],
): void {
  for (const note of notes) writer.cmt(`${prefix}${note}`).nl();
}

export const MULTIPART_BOUNDARY = "----SpecistryFormBoundary";
export const CLIENT_CERT = "<CLIENT_CERT_PATH>";
export const CLIENT_KEY = "<CLIENT_KEY_PATH>";
export const FILE_CONTENTS = "<FILE_CONTENTS>";

/** `<HOST>` when the base URL is the unresolved placeholder. */
export function isPlaceholderUrl(request: ResolvedRequest): boolean {
  return request.baseUrl.startsWith("<");
}
