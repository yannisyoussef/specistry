import { z } from "zod";

const relativePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !/^[a-z][a-z\d+.-]*:/i.test(value) &&
      !/^(?:[\\/]|[a-z]:[\\/])/i.test(value) &&
      !value.split(/[\\/]+/).includes(".."),
    "Path must stay relative to the consuming project root.",
  );

const environmentSchema = z
  .object({
    baseUrl: z.url().refine((url) => {
      const parsed = new URL(url);
      if (
        parsed.username !== "" ||
        parsed.password !== "" ||
        parsed.search !== "" ||
        parsed.hash !== ""
      )
        return false;
      if (parsed.protocol === "https:") return true;
      return (
        parsed.protocol === "http:" &&
        new Set(["127.0.0.1", "[::1]", "localhost"]).has(parsed.hostname)
      );
    }, "Environment URL must have no credentials, query, or fragment and use HTTPS; HTTP is limited to loopback development."),
    label: z.string().min(1).max(80).optional(),
  })
  .strict();

const label = z.string().trim().min(1).max(120);
const pageSlug = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,3}$/,
    "Page slugs are lower-case kebab-case segments, at most four deep.",
  );
const externalLink = z.url().refine((url) => {
  const parsed = new URL(url);
  return (
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    parsed.username === "" &&
    parsed.password === ""
  );
}, "Navigation links must be absolute https or http URLs without credentials.");

/**
 * Configured documentation navigation (SPEC-006): page slugs, sections (two
 * levels), exactly one generated API insertion, and external links. Data
 * only, so it crosses the isolated config host unchanged.
 */
export type NavigationNodeInput =
  | string
  | { readonly page: string; readonly label?: string | undefined }
  | {
      readonly section: string;
      readonly items: readonly NavigationNodeInput[];
    }
  | { readonly api: true; readonly label?: string | undefined }
  | { readonly link: string; readonly label: string };

const navigationNodeSchema: z.ZodType<NavigationNodeInput> = z.lazy(() =>
  z.union([
    pageSlug,
    z.object({ page: pageSlug, label: label.optional() }).strict(),
    z
      .object({
        section: label,
        items: z.array(navigationNodeSchema).max(200),
      })
      .strict(),
    z.object({ api: z.literal(true), label: label.optional() }).strict(),
    z.object({ link: externalLink, label }).strict(),
  ]),
);

/**
 * Environment keys name the base URL in generated code examples and in the
 * reader's environment selector, so they are identifiers, not free text.
 */
const environmentId = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/,
    "Environment names are identifiers: letters, digits, and . _ ~ -.",
  );

/**
 * Explicit SDK example mappings (SPEC-008). A project declares each SDK it
 * ships and, per operation, the exact code a developer would write with it.
 * Specistry renders that code as authored text; it never infers, generates, or
 * executes SDK calls. Everything is JSON-serializable data: no callbacks,
 * no components. `examples` is either inline or a relative path to a JSON
 * file `{ "examples": [...] }` with the same records, and each record holds
 * its code inline or in a relative source file.
 */
export const SDK_LANGUAGES = [
  "csharp",
  "go",
  "java",
  "javascript",
  "kotlin",
  "php",
  "python",
  "ruby",
  "rust",
  "swift",
  "text",
  "typescript",
] as const;

export type SdkLanguage = (typeof SDK_LANGUAGES)[number];

const HTTP_METHODS = [
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
] as const;

const sdkId = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "SDK ids are lower-case kebab-case identifiers.",
  )
  .max(64);

/** Where an SDK example applies: the contract operationId, or method + path (+ service). */
export type SdkExampleTarget =
  | string
  | {
      readonly method: (typeof HTTP_METHODS)[number];
      readonly path: string;
      /** The service (OpenAPI document title or canonical service id) for multi-service projects. */
      readonly service?: string | undefined;
    };

const sdkExampleTarget: z.ZodType<SdkExampleTarget> = z.union([
  z.string().trim().min(1).max(200),
  z
    .object({
      method: z.enum(HTTP_METHODS),
      path: z.string().min(1).max(2_048).startsWith("/"),
      service: z.string().trim().min(1).max(200).optional(),
    })
    .strict(),
]);

export const MAX_SDK_EXAMPLE_CHARACTERS = 16 * 1_024;

const sdkExampleSchema = z
  .object({
    operation: sdkExampleTarget,
    code: z.string().min(1).max(MAX_SDK_EXAMPLE_CHARACTERS).optional(),
    file: relativePath.optional(),
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict()
  .refine(
    (example) => (example.code === undefined) !== (example.file === undefined),
    "An SDK example provides exactly one of `code` or `file`.",
  );

export type SdkExampleInput = z.input<typeof sdkExampleSchema>;
export type SdkExampleRecord = z.output<typeof sdkExampleSchema>;

const sdkSchema = z
  .object({
    id: sdkId,
    label: z.string().trim().min(1).max(80),
    language: z.enum(SDK_LANGUAGES),
    package: z.string().trim().min(1).max(214).optional(),
    coverage: z.enum(["complete", "partial"]).default("partial"),
    examples: z
      .union([z.array(sdkExampleSchema).max(5_000), relativePath])
      .default([]),
  })
  .strict();

export type SdkConfig = z.output<typeof sdkSchema>;

/** The shape of an SDK examples file named by `sdks[].examples`. */
export const sdkExamplesFileSchema = z
  .object({ examples: z.array(sdkExampleSchema).max(5_000) })
  .strict();

export function parseSdkExamplesFile(
  value: unknown,
): z.output<typeof sdkExamplesFileSchema> {
  return sdkExamplesFileSchema.parse(value);
}

/** Response bytes the playground reads before stopping; bounded hard. */
export const PLAYGROUND_DEFAULT_RESPONSE_LIMIT_BYTES = 1_048_576;
export const PLAYGROUND_MAX_RESPONSE_LIMIT_BYTES = 4 * 1_048_576;
export const PLAYGROUND_DEFAULT_TIMEOUT_MS = 30_000;
export const PLAYGROUND_MAX_TIMEOUT_MS = 120_000;

/**
 * Browser-direct playground policy (SPEC-009). `mode` is the switch and
 * `environments` lists, by name, the configured environments approved for
 * live execution; nothing else is ever a destination. Limits are bounded
 * so no project can raise them past the safety maximum.
 */
const playgroundSchema = z
  .object({
    mode: z.enum(["browser", "disabled"]).default("disabled"),
    environments: z.array(environmentId).max(16).default([]),
    responseLimitBytes: z
      .number()
      .int()
      .min(1_024)
      .max(PLAYGROUND_MAX_RESPONSE_LIMIT_BYTES)
      .default(PLAYGROUND_DEFAULT_RESPONSE_LIMIT_BYTES),
    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(PLAYGROUND_MAX_TIMEOUT_MS)
      .default(PLAYGROUND_DEFAULT_TIMEOUT_MS),
  })
  .strict();

/**
 * Author-reviewed route migrations (SPEC-010): internal documentation
 * paths only, frozen with each release and validated against its route
 * table by the build. No scheme, host, query, or encoded separator can
 * appear, so a redirect never leaves the site.
 */
const redirectPath = z
  .string()
  .max(512)
  .regex(
    /^\/(?:(?:docs|api)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,6})?(?:#[a-z0-9]+(?:-[a-z0-9]+)*)?$/,
    "Redirect paths are internal documentation routes such as /docs/old-page or /api/old/route.",
  );
const redirectSchema = z
  .object({
    from: redirectPath.refine(
      (value) => !value.includes("#"),
      "A redirect source cannot carry an anchor.",
    ),
    to: redirectPath,
  })
  .strict();

/**
 * Documentation quality policy (SPEC-011). The configuration layer checks
 * shape only: `@specistry/quality` owns the rule catalogue and reports an
 * unknown rule id as a diagnostic, so a typo can never quietly weaken a
 * gate. Nothing here is executable, and there is no plugin hook.
 */
const qualityRuleId = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
    "A rule id is lower-case ASCII words joined by hyphens.",
  )
  .max(64);

const suppressionSchema = z
  .object({
    rule: qualityRuleId,
    target: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(200),
    expires: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "An expiry is a UTC date, YYYY-MM-DD.")
      .optional(),
  })
  .strict();

const qualitySchema = z
  .object({
    rules: z
      .record(qualityRuleId, z.enum(["off", "info", "warning", "error"]))
      .default({}),
    failOn: z.enum(["error", "warning", "info", "never"]).default("error"),
    maxWarnings: z.number().int().min(0).max(1_000_000).optional(),
    suppressions: z.array(suppressionSchema).max(1_000).default([]),
  })
  .strict();

export type QualityConfig = z.output<typeof qualitySchema>;

export const specistryConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(120),
    // Authored-content-first projects are a supported public shape. An empty
    // list means "no API reference"; it is intentionally different from a
    // missing or unreadable configured contract.
    openapi: z.union([relativePath, z.array(relativePath).max(64)]).default([]),
    docs: relativePath.default("./docs"),
    navigation: z.array(navigationNodeSchema).max(500).optional(),
    branding: z
      .object({
        logo: relativePath.optional(),
        favicon: relativePath.optional(),
        accent: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "Accent must be a six-digit hex colour.")
          .optional(),
      })
      .strict()
      .optional(),
    environments: z.record(environmentId, environmentSchema).default({}),
    sdks: z.array(sdkSchema).max(32).default([]),
    redirects: z.array(redirectSchema).max(10_000).default([]),
    quality: qualitySchema.default({
      failOn: "error",
      rules: {},
      suppressions: [],
    }),
    playground: playgroundSchema.default({
      environments: [],
      mode: "disabled",
      responseLimitBytes: PLAYGROUND_DEFAULT_RESPONSE_LIMIT_BYTES,
      timeoutMs: PLAYGROUND_DEFAULT_TIMEOUT_MS,
    }),
  })
  .strict()
  .superRefine((config, context) => {
    // Live execution is an explicit, per-environment opt-in: an
    // environment configured for code examples is not thereby approved
    // for network requests, and every listed name must exist.
    config.playground.environments.forEach((id, index) => {
      if (!Object.hasOwn(config.environments, id)) {
        context.addIssue({
          code: "custom",
          message:
            "Playground environments must name a configured environment.",
          path: ["playground", "environments", index],
        });
      } else if (!isExactExecutionOrigin(config.environments[id]?.baseUrl)) {
        context.addIssue({
          code: "custom",
          message:
            "Playground environments must be exact HTTPS origins (plain HTTP only on loopback) without credentials, query, fragment, or wildcards.",
          path: ["playground", "environments", index],
        });
      }
    });
    if (
      config.playground.environments.length > 0 &&
      config.playground.mode !== "browser"
    ) {
      context.addIssue({
        code: "custom",
        message:
          'Playground environments require `playground.mode: "browser"`.',
        path: ["playground", "mode"],
      });
    }
  });

/**
 * Whether a base URL can be approved for browser execution (SPEC-009): an
 * absolute HTTPS URL, or plain HTTP on a loopback host, with a DNS-shaped
 * hostname and no userinfo, query, or fragment. The build re-derives the
 * exact origin from the same URL; this check fails early, in the config.
 */
export function isExactExecutionOrigin(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined) return false;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return false;
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    baseUrl.endsWith("?") ||
    baseUrl.endsWith("#")
  ) {
    return false;
  }
  const hostname = parsed.hostname;
  if (!/^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$/i.test(hostname)) return false;
  if (parsed.protocol === "https:") return true;
  return (
    parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(hostname)
  );
}

export type SpecistryConfig = z.output<typeof specistryConfigSchema>;
export type SpecistryConfigInput = z.input<typeof specistryConfigSchema>;

export function defineConfig(
  config: SpecistryConfigInput,
): SpecistryConfigInput {
  return config;
}

export function parseConfig(value: unknown): SpecistryConfig {
  return specistryConfigSchema.parse(value);
}

const MAX_ISSUE_PATH_SEGMENTS = 32;
const MAX_ISSUE_PATH_LENGTH = 256;

/**
 * Redacts a schema issue path into a value-free label derived from the schema
 * itself: schema keys are kept, user-chosen record keys become `*`, array
 * positions keep their numeric index, and anything the schema does not
 * describe becomes `*`. An empty path is the whole `config`.
 */
export function redactIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "config";
  const labels: string[] = [];
  let current: z.ZodType | undefined = specistryConfigSchema;
  for (const segment of path) {
    const step = describeSegment(current, segment);
    labels.push(step.label);
    current = step.next;
  }
  return labels.join(".");
}

/**
 * Reports whether a redacted label could have been produced from the current
 * schema by `redactIssuePath`, so consumers can validate labels that crossed a
 * process boundary without keeping their own copy of the schema vocabulary.
 */
export function isRedactedIssuePath(value: string): boolean {
  if (value === "config") return true;
  if (value.length === 0 || value.length > MAX_ISSUE_PATH_LENGTH) return false;
  const labels = value.split(".");
  if (labels.length > MAX_ISSUE_PATH_SEGMENTS) return false;
  return matchesLabels(specistryConfigSchema, labels);
}

interface SegmentStep {
  readonly label: string;
  readonly next: z.ZodType | undefined;
}

function describeSegment(
  schema: z.ZodType | undefined,
  segment: PropertyKey,
): SegmentStep {
  const inner = unwrapSchema(schema);
  if (inner === undefined) return { label: "*", next: undefined };
  if (inner instanceof z.ZodUnion) {
    for (const option of inner.options as readonly z.ZodType[]) {
      const step = describeSegment(option, segment);
      if (step.label !== "*") return step;
    }
    return { label: "*", next: undefined };
  }
  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, z.ZodType>;
    if (typeof segment === "string" && Object.hasOwn(shape, segment)) {
      return { label: segment, next: shape[segment] };
    }
    return { label: "*", next: undefined };
  }
  if (inner instanceof z.ZodRecord) {
    return { label: "*", next: inner.valueType as z.ZodType };
  }
  if (inner instanceof z.ZodArray && typeof segment === "number") {
    return { label: String(segment), next: inner.element as z.ZodType };
  }
  return { label: "*", next: undefined };
}

function matchesLabels(
  schema: z.ZodType | undefined,
  labels: readonly string[],
): boolean {
  if (labels.length === 0) return true;
  const inner = unwrapSchema(schema);
  if (inner === undefined) return false;
  const [label, ...rest] = labels;
  if (label === undefined) return false;
  if (inner instanceof z.ZodUnion) {
    return (inner.options as readonly z.ZodType[]).some((option) =>
      matchesLabels(option, labels),
    );
  }
  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, z.ZodType>;
    return Object.hasOwn(shape, label) && matchesLabels(shape[label], rest);
  }
  if (inner instanceof z.ZodRecord) {
    return label === "*" && matchesLabels(inner.valueType as z.ZodType, rest);
  }
  if (inner instanceof z.ZodArray) {
    return (
      /^(?:0|[1-9]\d*)$/.test(label) &&
      matchesLabels(inner.element as z.ZodType, rest)
    );
  }
  return false;
}

function unwrapSchema(schema: z.ZodType | undefined): z.ZodType | undefined {
  let current = schema;
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodDefault ||
      current instanceof z.ZodNullable
    ) {
      current = current.unwrap() as z.ZodType;
    } else if (current instanceof z.ZodLazy) {
      current = current.unwrap() as z.ZodType;
    } else {
      return current;
    }
  }
  return current;
}
