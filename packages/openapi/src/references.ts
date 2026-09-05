import { OpenApiIngestionError } from "./parse.js";

export type ReferenceKind = "document" | "fragment" | "remote" | "unsupported";

export interface RemoteReferencePolicy {
  /** Exact HTTPS origins, including a non-default port when applicable. */
  readonly allowedOrigins: readonly string[];
}

export function classifyReference(reference: string): ReferenceKind {
  if (reference.startsWith("#")) return "fragment";
  if (reference.startsWith("//")) return "unsupported";
  try {
    const url = new URL(reference);
    if (url.protocol === "http:" || url.protocol === "https:") return "remote";
    return "unsupported";
  } catch {
    // A relative path is a document reference, not a remotely fetchable URL.
  }
  return "document";
}

/**
 * Policy helper retained from SPEC-000. SPEC-003 keeps remote retrieval
 * disabled: the ingestion pipeline never calls this with a policy, so every
 * remote reference is diagnosed instead of fetched.
 */
export function assertReferenceAllowed(
  reference: string,
  policy?: RemoteReferencePolicy,
): void {
  const kind = classifyReference(reference);
  if (kind === "unsupported") {
    throw new OpenApiIngestionError(
      "UNSUPPORTED_REFERENCE_SCHEME",
      "OpenAPI reference uses an unsupported URL scheme.",
    );
  }
  if (kind === "remote") {
    const url = new URL(reference);
    const allowed =
      policy !== undefined &&
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      policy.allowedOrigins.some((candidate) =>
        isExactHttpsOrigin(candidate, url.origin),
      );
    if (!allowed) {
      throw new OpenApiIngestionError(
        "REMOTE_REFERENCE_DENIED",
        "Remote OpenAPI reference is not permitted by the exact HTTPS origin policy.",
      );
    }
  }
}

export interface SplitReference {
  /** Location part before `#`, percent-decoded; empty for fragment-only refs. */
  readonly location: string;
  /** Fragment after `#` without the `#`; `undefined` when absent. */
  readonly fragment: string | undefined;
}

export function splitReference(reference: string): SplitReference | undefined {
  const hash = reference.indexOf("#");
  const rawLocation = hash === -1 ? reference : reference.slice(0, hash);
  const fragment = hash === -1 ? undefined : reference.slice(hash + 1);
  let location: string;
  try {
    location = decodeURIComponent(rawLocation);
  } catch {
    return undefined;
  }
  if (location.includes("\0") || location.includes("\\")) return undefined;
  const decodedFragment =
    fragment === undefined ? undefined : safeDecode(fragment);
  if (fragment !== undefined && decodedFragment === undefined) return undefined;
  return { fragment: decodedFragment, location };
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

export type DocumentIdResolution =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly reason: "invalid" | "outside" };

/**
 * Lexically resolves a document-relative location against the referencing
 * document id. Both are project-relative POSIX ids; any result that would
 * leave the project root (after normalization of `.` and `..`) is `outside`.
 * Physical confinement (symlinks, types) is the acquisition port's job.
 */
export function resolveDocumentId(
  fromDocument: string,
  location: string,
): DocumentIdResolution {
  if (location.length === 0) return { ok: true, id: fromDocument };
  if (location.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(location)) {
    return { ok: false, reason: "outside" };
  }
  const base = fromDocument.split("/").slice(0, -1);
  const segments: string[] = [...base];
  for (const segment of location.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return { ok: false, reason: "outside" };
      segments.pop();
      continue;
    }
    if (segment.includes("\0")) return { ok: false, reason: "invalid" };
    segments.push(segment);
  }
  if (segments.length === 0) return { ok: false, reason: "invalid" };
  return { id: segments.join("/"), ok: true };
}

function isExactHttpsOrigin(candidate: string, expected: string): boolean {
  try {
    const parsed = new URL(candidate);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.origin === expected &&
      parsed.href === `${parsed.origin}/`
    );
  } catch {
    return false;
  }
}
