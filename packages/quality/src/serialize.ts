/**
 * Deterministic serialization (SPEC-011 §55–§57, §147). Keys are sorted,
 * so the same artifacts and the same policy always produce the same bytes
 * on any machine. Nothing here adds a timestamp, a machine path, or a
 * duration.
 */

import type { QualityEvaluation } from "./contracts.js";

type Json = Json[] | boolean | null | number | string | { [key: string]: Json };

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const sorted: Record<string, Json> = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if (entry !== undefined) sorted[key] = sortKeys(entry);
  }
  return sorted;
}

/** Canonical JSON for one evaluation, newline-terminated. */
export function serializeEvaluation(evaluation: QualityEvaluation): string {
  return `${JSON.stringify(sortKeys(evaluation as unknown as Json), null, 2)}\n`;
}
