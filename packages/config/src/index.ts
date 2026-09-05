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

export const specraConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(120),
    openapi: z.union([relativePath, z.array(relativePath).min(1)]),
    docs: relativePath.default("./docs"),
    branding: z
      .object({
        logo: relativePath.optional(),
        favicon: relativePath.optional(),
      })
      .strict()
      .optional(),
    environments: z
      .record(z.string().min(1).max(80), environmentSchema)
      .default({}),
    playground: z
      .object({
        mode: z.enum(["browser", "disabled"]).default("disabled"),
      })
      .strict()
      .default({ mode: "disabled" }),
  })
  .strict();

export type SpecraConfig = z.output<typeof specraConfigSchema>;
export type SpecraConfigInput = z.input<typeof specraConfigSchema>;

export function defineConfig(config: SpecraConfigInput): SpecraConfigInput {
  return config;
}

export function parseConfig(value: unknown): SpecraConfig {
  return specraConfigSchema.parse(value);
}

const MAX_ISSUE_PATH_SEGMENTS = 32;
const MAX_ISSUE_PATH_LENGTH = 256;

/**
 * Redacts a schema issue path into a value-free label derived from the schema
 * itself: schema keys are kept, user-chosen record keys become `*`, array
 * positions become `[]`, and anything the schema does not describe becomes
 * `*`. An empty path is the whole `config`.
 */
export function redactIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "config";
  const labels: string[] = [];
  let current: z.ZodType | undefined = specraConfigSchema;
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
  return matchesLabels(specraConfigSchema, labels);
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
    return { label: "[]", next: inner.element as z.ZodType };
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
    return label === "[]" && matchesLabels(inner.element as z.ZodType, rest);
  }
  return false;
}

function unwrapSchema(schema: z.ZodType | undefined): z.ZodType | undefined {
  let current = schema;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodNullable
  ) {
    current = current.unwrap() as z.ZodType;
  }
  return current;
}
