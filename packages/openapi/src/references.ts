export type ReferenceKind = "document" | "fragment" | "remote" | "unsupported";

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
