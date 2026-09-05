import type { ServerDefinition, ServerId, ServerVariable } from "@specra/model";

import type { SourceLocation } from "../diagnostics.js";
import { stableHash } from "../identity.js";
import { isRecord } from "../parse.js";
import {
  child,
  defineOwn,
  optionalString,
  type NormalizeContext,
} from "./context.js";

/**
 * Normalizes a Server Object list. Servers are de-duplicated by their full
 * canonical content across root, path, and operation levels; each distinct
 * server receives a deterministic id derived from that content so identity
 * never depends on where it was first encountered.
 */
export function normalizeServers(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
): readonly ServerId[] {
  if (!Array.isArray(raw)) {
    ctx.invalid(source);
    return [];
  }
  const ids: ServerId[] = [];
  raw.forEach((entry, index) => {
    const entrySource = child(source, String(index));
    if (
      !isRecord(entry) ||
      typeof entry.url !== "string" ||
      entry.url.length === 0
    ) {
      ctx.invalid(entrySource);
      return;
    }
    const description = optionalString(entry, "description", entrySource, ctx);
    const variables = normalizeVariables(
      ctx,
      entry.variables,
      child(entrySource, "variables"),
    );
    if (variables === undefined) return;
    const referenced = new Set<string>();
    for (const match of entry.url.matchAll(/\{([^{}]+)\}/g)) {
      if (match[1] !== undefined) referenced.add(match[1]);
    }
    const declared = new Set(Object.keys(variables));
    if (
      referenced.size !== declared.size ||
      [...referenced].some((name) => !declared.has(name))
    ) {
      ctx.invalid(child(entrySource, "variables"));
      return;
    }
    const content = JSON.stringify({ description, url: entry.url, variables });
    const existing = ctx.servers.get(content);
    if (existing !== undefined) {
      if (!ids.includes(existing.id)) ids.push(existing.id);
      return;
    }
    // Identity derives from the complete server content, never from encounter
    // order, so reordering or duplicating server lists cannot rename servers.
    const candidate = `server_${stableHash(content)}` as ServerId;
    const definition: ServerDefinition = {
      ...(description === undefined ? {} : { description }),
      id: candidate,
      label:
        description === undefined || description.length === 0
          ? entry.url
          : description,
      url: entry.url,
      variables,
    };
    ctx.servers.set(content, { definition, id: candidate });
    ids.push(candidate);
  });
  return ids;
}

function normalizeVariables(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
): Readonly<Record<string, ServerVariable>> | undefined {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return undefined;
  }
  const variables: Record<string, ServerVariable> = {};
  for (const [name, entry] of Object.entries(raw)) {
    const entrySource = child(source, name);
    if (!isRecord(entry) || typeof entry.default !== "string") {
      ctx.invalid(entrySource);
      return undefined;
    }
    const description = optionalString(entry, "description", entrySource, ctx);
    let allowedValues: string[] = [];
    if (entry.enum !== undefined) {
      if (
        !Array.isArray(entry.enum) ||
        entry.enum.length === 0 ||
        entry.enum.some((value) => typeof value !== "string")
      ) {
        ctx.invalid(child(entrySource, "enum"));
        return undefined;
      }
      allowedValues = [...new Set(entry.enum as string[])];
      if (!allowedValues.includes(entry.default)) {
        ctx.invalid(child(entrySource, "default"));
        return undefined;
      }
    }
    defineOwn(variables, name, {
      allowedValues,
      defaultValue: entry.default,
      ...(description === undefined ? {} : { description }),
    });
  }
  return variables;
}
