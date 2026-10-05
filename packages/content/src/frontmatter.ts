import { parse as parseYaml } from "yaml";

import {
  createContentDiagnostic,
  type ContentDiagnostic,
} from "./diagnostics.js";
import { isRouteSlug } from "./slug.js";

/**
 * Frontmatter contract. Exactly these fields, all validated; unknown fields
 * are errors so typos never silently disappear.
 */
export interface Frontmatter {
  readonly title: string;
  readonly description?: string;
  readonly sidebarTitle?: string;
  /** Route override relative to `/docs`; must satisfy the route grammar. */
  readonly slug?: string;
}

export const FRONTMATTER_FIELDS = [
  "description",
  "sidebarTitle",
  "slug",
  "title",
] as const;

const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_FRONTMATTER_BYTES = 4_096;

export interface FrontmatterResult {
  readonly frontmatter: Frontmatter | undefined;
  readonly diagnostics: readonly ContentDiagnostic[];
}

/** Parses and validates the YAML text of a frontmatter block. */
export function parseFrontmatter(
  yamlText: string | undefined,
  path: string,
  line = 1,
): FrontmatterResult {
  const diagnostics: ContentDiagnostic[] = [];
  const at = { column: 1, line };
  if (yamlText === undefined) {
    diagnostics.push(
      createContentDiagnostic("CONTENT_FRONTMATTER_MISSING", path, at),
    );
    return { diagnostics, frontmatter: undefined };
  }
  if (Buffer.byteLength(yamlText, "utf8") > MAX_FRONTMATTER_BYTES) {
    diagnostics.push(
      createContentDiagnostic("CONTENT_FRONTMATTER_INVALID", path, at),
    );
    return { diagnostics, frontmatter: undefined };
  }
  let value: unknown;
  try {
    // YAML 1.2 core schema only: no custom tags, aliases are inert data.
    value = parseYaml(yamlText, { maxAliasCount: 8, schema: "core" });
  } catch {
    diagnostics.push(
      createContentDiagnostic("CONTENT_FRONTMATTER_INVALID", path, at),
    );
    return { diagnostics, frontmatter: undefined };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push(
      createContentDiagnostic("CONTENT_FRONTMATTER_INVALID", path, at),
    );
    return { diagnostics, frontmatter: undefined };
  }
  const record = value as Record<string, unknown>;
  const known = new Set<string>(FRONTMATTER_FIELDS);
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      diagnostics.push(
        createContentDiagnostic("CONTENT_FRONTMATTER_UNKNOWN_FIELD", path, at),
      );
    }
  }
  const title = readString(record.title, MAX_TITLE_LENGTH);
  if (title === undefined) {
    diagnostics.push(
      createContentDiagnostic("CONTENT_FRONTMATTER_MISSING", path, at),
    );
  }
  const description = optionalString(
    record.description,
    MAX_DESCRIPTION_LENGTH,
    diagnostics,
    path,
    at,
  );
  const sidebarTitle = optionalString(
    record.sidebarTitle,
    MAX_TITLE_LENGTH,
    diagnostics,
    path,
    at,
  );
  let slug: string | undefined;
  if (record.slug !== undefined) {
    if (typeof record.slug === "string" && isRouteSlug(record.slug)) {
      slug = record.slug;
    } else {
      diagnostics.push(createContentDiagnostic("ROUTE_SLUG_INVALID", path, at));
    }
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics, frontmatter: undefined };
  }
  return {
    diagnostics,
    frontmatter: {
      title: title as string,
      ...(description === undefined ? {} : { description }),
      ...(sidebarTitle === undefined ? {} : { sidebarTitle }),
      ...(slug === undefined ? {} : { slug }),
    },
  };
}

function readString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return undefined;
  if (/[\p{Cc}]/u.test(trimmed)) return undefined;
  return trimmed;
}

function optionalString(
  value: unknown,
  max: number,
  diagnostics: ContentDiagnostic[],
  path: string,
  at: { readonly line: number; readonly column: number },
): string | undefined {
  if (value === undefined) return undefined;
  const text = readString(value, max);
  if (text === undefined) {
    diagnostics.push(
      createContentDiagnostic("CONTENT_FRONTMATTER_INVALID", path, at),
    );
  }
  return text;
}
