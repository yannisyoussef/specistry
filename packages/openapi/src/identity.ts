import type { SourceLocation } from "./diagnostics.js";

const CANONICAL_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._~-]{0,127})$/;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

/**
 * Derives a canonical-ID-safe value from author text. Safe input is retained
 * exactly; anything else is hashed deterministically with a kind prefix so
 * distinct source names remain distinct and never depend on encounter order.
 */
export function canonicalSlug(kind: string, value: string): string {
  const normalized = value.normalize("NFC");
  if (CANONICAL_ID.test(normalized)) return normalized;
  return `${kind}_${stableHash(normalized)}`;
}

export function stableHash(input: string): string {
  let hash = FNV_OFFSET;
  const normalized = `${input.length}:${input}`;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= BigInt(normalized.charCodeAt(index));
    hash = (hash * FNV_PRIME) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

export interface LedgerEntry {
  readonly sourceIdentity: string;
  readonly location: SourceLocation;
}

export type ClaimResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: "collision" | "duplicate";
      readonly existing: LedgerEntry;
    };

/**
 * Collision ledger. Every canonical identity is claimed together with the exact
 * source identity that produced it. A second claim with the same source
 * identity is a duplicate (the author repeated an entity); a second claim with
 * a different source identity is a collision (two entities normalized to one
 * canonical ID). Callers claim in deterministic source order so the surviving
 * entry never depends on incidental traversal.
 */
export class IdentityLedger {
  readonly #scopes = new Map<string, Map<string, LedgerEntry>>();

  public claim(
    scope: string,
    canonicalId: string,
    sourceIdentity: string,
    location: SourceLocation,
  ): ClaimResult {
    let entries = this.#scopes.get(scope);
    if (entries === undefined) {
      entries = new Map();
      this.#scopes.set(scope, entries);
    }
    const existing = entries.get(canonicalId);
    if (existing === undefined) {
      entries.set(canonicalId, { location, sourceIdentity });
      return { ok: true };
    }
    return {
      existing,
      kind:
        existing.sourceIdentity === sourceIdentity ? "duplicate" : "collision",
      ok: false,
    };
  }

  public entries(scope: string): readonly (readonly [string, LedgerEntry])[] {
    return [...(this.#scopes.get(scope)?.entries() ?? [])];
  }
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
