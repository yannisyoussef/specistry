/**
 * Memory-only credential vault (SPEC-009 §45–§50, §79). Values live in a
 * `Map` owned by the playground island for the life of the page; they are
 * keyed by environment and scheme so a Sandbox token can never be reused
 * against Production, and nothing here touches storage, cookies, URLs, or
 * the network. A hard reload discards the vault with the page.
 */

export interface CredentialValue {
  readonly token?: string;
  readonly apiKey?: string;
  readonly username?: string;
  readonly password?: string;
}

export interface CredentialVault {
  get(environmentId: string, schemeKey: string): CredentialValue | undefined;
  set(environmentId: string, schemeKey: string, value: CredentialValue): void;
  clear(environmentId?: string): void;
  /** Number of stored entries, for the UI's "Clear credentials" state. */
  size(): number;
}

const SEPARATOR = "\u001f";

export function createCredentialVault(): CredentialVault {
  const entries = new Map<string, CredentialValue>();
  const keyOf = (environmentId: string, schemeKey: string) =>
    `${environmentId}${SEPARATOR}${schemeKey}`;
  return {
    clear(environmentId) {
      if (environmentId === undefined) {
        entries.clear();
        return;
      }
      for (const key of [...entries.keys()]) {
        if (key.startsWith(`${environmentId}${SEPARATOR}`)) entries.delete(key);
      }
    },
    get(environmentId, schemeKey) {
      return entries.get(keyOf(environmentId, schemeKey));
    },
    set(environmentId, schemeKey, value) {
      const cleaned: CredentialValue = {
        ...(value.token === undefined || value.token === ""
          ? {}
          : { token: value.token }),
        ...(value.apiKey === undefined || value.apiKey === ""
          ? {}
          : { apiKey: value.apiKey }),
        ...(value.username === undefined || value.username === ""
          ? {}
          : { username: value.username }),
        ...(value.password === undefined || value.password === ""
          ? {}
          : { password: value.password }),
      };
      if (Object.keys(cleaned).length === 0)
        entries.delete(keyOf(environmentId, schemeKey));
      else entries.set(keyOf(environmentId, schemeKey), cleaned);
    },
    size() {
      return entries.size;
    },
  };
}

/** Stable identity of a scheme inside an alternative: kind plus name. */
export function schemeKey(scheme: {
  readonly kind: string;
  readonly name?: string;
}): string {
  return scheme.name === undefined
    ? scheme.kind
    : `${scheme.kind}:${scheme.name}`;
}
