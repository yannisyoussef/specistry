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
