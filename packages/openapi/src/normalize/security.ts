import type {
  OAuthFlow,
  SecurityRequirement,
  SecurityScheme,
  SecuritySchemeId,
} from "@specistry/model";

import type { SourceLocation } from "../diagnostics.js";
import { compareText } from "../identity.js";
import { isRecord } from "../parse.js";
import {
  child,
  defineOwn,
  optionalString,
  type NormalizeContext,
} from "./context.js";

export interface SecurityCatalog {
  readonly schemes: Readonly<Record<string, SecurityScheme>>;
  readonly ids: ReadonlyMap<string, SecuritySchemeId>;
  readonly kinds: ReadonlyMap<string, SecurityScheme["kind"]>;
}

export function normalizeSecuritySchemes(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
): SecurityCatalog {
  const schemes: Record<string, SecurityScheme> = {};
  const ids = new Map<string, SecuritySchemeId>();
  const kinds = new Map<string, SecurityScheme["kind"]>();
  if (raw === undefined) return { ids, kinds, schemes };
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return { ids, kinds, schemes };
  }
  for (const key of Object.keys(raw).sort(compareText)) {
    const entrySource = child(source, key);
    const dereferenced = ctx.dereference(raw[key], entrySource);
    if (dereferenced === undefined) continue;
    const scheme = normalizeScheme(
      ctx,
      dereferenced.value,
      dereferenced.location,
    );
    if (scheme === undefined) continue;
    const id = ctx.slug("security", key) as SecuritySchemeId;
    const claim = ctx.ledger.claim("securityScheme", id, key, entrySource);
    if (!claim.ok) {
      ctx.sink.add("SOURCE_IDENTITY_COLLISION", entrySource);
      ctx.sink.add("SOURCE_IDENTITY_COLLISION", claim.existing.location);
      continue;
    }
    schemes[id] = scheme;
    ids.set(key, id);
    kinds.set(key, scheme.kind);
  }
  return { ids, kinds, schemes };
}

function normalizeScheme(
  ctx: NormalizeContext,
  value: unknown,
  source: SourceLocation,
): SecurityScheme | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    ctx.invalid(source);
    return undefined;
  }
  const description = optionalString(value, "description", source, ctx);
  const base = description === undefined ? {} : { description };
  switch (value.type) {
    case "apiKey": {
      const location = value.in;
      if (
        typeof value.name !== "string" ||
        value.name.length === 0 ||
        (location !== "cookie" && location !== "header" && location !== "query")
      ) {
        ctx.invalid(source);
        return undefined;
      }
      return { ...base, kind: "apiKey", location, name: value.name };
    }
    case "http": {
      if (
        typeof value.scheme !== "string" ||
        !/^[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*$/.test(value.scheme)
      ) {
        ctx.invalid(child(source, "scheme"));
        return undefined;
      }
      const bearerFormat = optionalString(value, "bearerFormat", source, ctx);
      return {
        ...base,
        kind: "http",
        scheme: value.scheme.toLowerCase(),
        ...(bearerFormat === undefined ? {} : { bearerFormat }),
      };
    }
    case "oauth2": {
      const flows = normalizeFlows(ctx, value.flows, child(source, "flows"));
      if (flows.length === 0) {
        ctx.invalid(child(source, "flows"));
        return undefined;
      }
      return { ...base, flows, kind: "oauth2" };
    }
    case "openIdConnect": {
      if (
        typeof value.openIdConnectUrl !== "string" ||
        value.openIdConnectUrl.length === 0
      ) {
        ctx.invalid(child(source, "openIdConnectUrl"));
        return undefined;
      }
      return {
        ...base,
        kind: "openIdConnect",
        openIdConnectUrl: value.openIdConnectUrl,
      };
    }
    case "mutualTLS": {
      if (ctx.dialect === "oas30") {
        ctx.invalid(child(source, "type"));
        return undefined;
      }
      return { ...base, kind: "mutualTLS" };
    }
    default:
      ctx.invalid(child(source, "type"));
      return undefined;
  }
}

function normalizeFlows(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
): readonly OAuthFlow[] {
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return [];
  }
  const flows: OAuthFlow[] = [];
  for (const kind of [
    "authorizationCode",
    "clientCredentials",
    "implicit",
    "password",
  ] as const) {
    const flow = raw[kind];
    if (flow === undefined) continue;
    const flowSource = child(source, kind);
    if (!isRecord(flow)) {
      ctx.invalid(flowSource);
      continue;
    }
    const scopes = readScopes(ctx, flow.scopes, child(flowSource, "scopes"));
    if (scopes === undefined) continue;
    const refreshUrl = optionalString(flow, "refreshUrl", flowSource, ctx);
    const common = {
      scopes,
      ...(refreshUrl === undefined ? {} : { refreshUrl }),
    };
    const authorizationUrl = requiredUrl(
      ctx,
      flow,
      "authorizationUrl",
      flowSource,
      kind === "implicit" || kind === "authorizationCode",
    );
    const tokenUrl = requiredUrl(
      ctx,
      flow,
      "tokenUrl",
      flowSource,
      kind !== "implicit",
    );
    if (kind === "implicit") {
      if (authorizationUrl === undefined) continue;
      flows.push({ ...common, authorizationUrl, kind });
    } else if (kind === "authorizationCode") {
      if (authorizationUrl === undefined || tokenUrl === undefined) continue;
      flows.push({ ...common, authorizationUrl, kind, tokenUrl });
    } else {
      if (tokenUrl === undefined) continue;
      flows.push({ ...common, kind, tokenUrl });
    }
  }
  return flows;
}

function requiredUrl(
  ctx: NormalizeContext,
  flow: Readonly<Record<string, unknown>>,
  key: string,
  source: SourceLocation,
  required: boolean,
): string | undefined {
  const value = flow[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (required || value !== undefined) ctx.invalid(child(source, key));
  return undefined;
}

function readScopes(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
): Readonly<Record<string, string>> | undefined {
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return undefined;
  }
  const scopes: Record<string, string> = {};
  for (const [name, description] of Object.entries(raw)) {
    if (typeof description !== "string") {
      ctx.invalid(child(source, name));
      return undefined;
    }
    defineOwn(scopes, name, description);
  }
  return scopes;
}

/**
 * Normalizes a Security Requirement list: array entries are OR alternatives,
 * scheme uses inside one entry are ANDed, and an empty object is an explicit
 * anonymous alternative. Unknown schemes and scopes on non-OAuth/OIDC schemes
 * are errors, matching the canonical validator.
 */
export function normalizeSecurityRequirements(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
  catalog: SecurityCatalog,
): readonly SecurityRequirement[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    ctx.invalid(source);
    return [];
  }
  const requirements: SecurityRequirement[] = [];
  raw.forEach((entry, index) => {
    const entrySource = child(source, String(index));
    if (!isRecord(entry)) {
      ctx.invalid(entrySource);
      return;
    }
    const schemes: { schemeId: SecuritySchemeId; scopes: readonly string[] }[] =
      [];
    let valid = true;
    for (const [name, scopesRaw] of Object.entries(entry)) {
      const useSource = child(entrySource, name);
      const schemeId = catalog.ids.get(name);
      if (
        schemeId === undefined ||
        !Array.isArray(scopesRaw) ||
        scopesRaw.some((scope) => typeof scope !== "string")
      ) {
        ctx.invalid(useSource);
        valid = false;
        continue;
      }
      const scopes = scopesRaw as string[];
      const kind = catalog.kinds.get(name);
      if (scopes.length > 0 && kind !== "oauth2" && kind !== "openIdConnect") {
        if (ctx.dialect === "oas30") {
          ctx.invalid(useSource);
          valid = false;
          continue;
        }
        // 3.1 allows role names here; the model has no field for them.
        ctx.partial(useSource);
        schemes.push({ schemeId, scopes: [] });
        continue;
      }
      if (
        new Set(scopes.map((scope) => scope.normalize("NFC"))).size !==
        scopes.length
      ) {
        ctx.invalid(useSource);
        valid = false;
        continue;
      }
      schemes.push({ schemeId, scopes });
    }
    if (valid) requirements.push({ schemes });
  });
  return requirements;
}
