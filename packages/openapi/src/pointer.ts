/**
 * RFC 6901 JSON pointer helpers. Pointers are the adapter's only addressing
 * scheme: source diagnostics, schema identities, and reference targets all use
 * escaped pointers so locations stay value-free and machine-independent.
 */

export function escapeSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function unescapeSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function joinPointer(
  base: string,
  ...segments: readonly string[]
): string {
  return segments.reduce(
    (pointer, segment) => `${pointer}/${escapeSegment(segment)}`,
    base,
  );
}

/** Returns the unescaped segments, or `undefined` when the pointer is malformed. */
/**
 * Longest bound on a diagnostic pointer accepted by the model and the CLI
 * frame contract. Deeper locations are reported at the nearest ancestor that
 * fits, so an over-long author key can never turn a diagnostic into a crash.
 */
export const MAX_POINTER_LENGTH = 2_048;

export function boundPointer(
  pointer: string,
  maxLength = MAX_POINTER_LENGTH,
): string {
  if (pointer.length <= maxLength) return pointer;
  const cut = pointer.lastIndexOf("/", maxLength);
  return cut <= 0 ? "" : pointer.slice(0, cut);
}

export function parsePointer(pointer: string): readonly string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;
  const segments = pointer.slice(1).split("/");
  for (const segment of segments) {
    if (/~(?![01])/.test(segment)) return undefined;
  }
  return segments.map(unescapeSegment);
}

export type PointerLookup =
  { readonly found: true; readonly value: unknown } | { readonly found: false };

export function resolvePointer(
  root: unknown,
  segments: readonly string[],
): PointerLookup {
  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) return { found: false };
      const index = Number(segment);
      if (index >= current.length) return { found: false };
      current = current[index];
      continue;
    }
    if (
      current === null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, segment)
    ) {
      return { found: false };
    }
    current = (current as Readonly<Record<string, unknown>>)[segment];
  }
  return { found: true, value: current };
}

/**
 * Deterministic pointer ordering: segment by segment, numeric segments compare
 * numerically so `/paths/2` sorts before `/paths/10`, everything else by
 * UTF-16 code units. Shorter prefixes sort first.
 */
export function comparePointers(left: string, right: string): number {
  const leftSegments = left.split("/");
  const rightSegments = right.split("/");
  const length = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < length; index += 1) {
    const leftSegment = leftSegments[index] ?? "";
    const rightSegment = rightSegments[index] ?? "";
    if (leftSegment === rightSegment) continue;
    const numeric =
      /^(?:0|[1-9]\d*)$/.test(leftSegment) &&
      /^(?:0|[1-9]\d*)$/.test(rightSegment);
    if (numeric) {
      const difference = Number(leftSegment) - Number(rightSegment);
      if (difference !== 0) return difference < 0 ? -1 : 1;
    }
    return leftSegment < rightSegment ? -1 : 1;
  }
  return leftSegments.length - rightSegments.length;
}
