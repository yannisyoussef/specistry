import type { ContentArtifact } from "@specra/content";
import { describe, expect, it } from "vitest";

import { evaluateQuality } from "./engine.js";
import {
  factsFor,
  firstService,
  mutate,
  snippetsWithSdk,
  testinbox,
  testinboxContent,
  testinboxNavigation,
} from "./fixtures.test-helper.js";
import { RULES } from "./registry.js";

/**
 * SPEC-011 §127–§129: every rule has a clean case, a failing case, and the
 * boundary that decides between them. Failing cases are produced by
 * mutating the real TestInbox documentation, so a rule cannot pass by
 * matching a shape invented for it.
 */

const NOW = new Date("2026-09-07T00:00:00Z");

function findings(
  artifact = testinbox,
  overrides: Parameters<typeof factsFor>[1] = {},
): readonly { rule: string; identity: string; locator?: string }[] {
  const evaluation = evaluateQuality(factsFor(artifact, overrides), {
    now: NOW,
  });
  return evaluation.findings.map((finding) => ({
    ...(finding.locator === undefined ? {} : { locator: finding.locator }),
    identity: finding.target.identity,
    rule: finding.rule,
  }));
}

function forRule(
  rule: string,
  artifact = testinbox,
  overrides: Parameters<typeof factsFor>[1] = {},
): readonly { rule: string; identity: string; locator?: string }[] {
  return findings(artifact, overrides).filter(
    (finding) => finding.rule === rule,
  );
}

const service = firstService(testinbox);
const documented = service.operations.find(
  (operation) => (operation.description ?? "").length > 0,
);
const documentedId = `${service.id}~${documented?.id ?? ""}`;

describe("operation rules", () => {
  it("reports an operation with no description and accepts one with prose", () => {
    expect(forRule("operation-description")).not.toContainEqual(
      expect.objectContaining({ identity: documentedId }),
    );
    const stripped = mutate((entry) => {
      const target = entry.operations.find(
        (operation) => operation.id === documented?.id,
      );
      if (target !== undefined)
        delete (target as unknown as { description?: string }).description;
    });
    expect(forRule("operation-description", stripped)).toContainEqual({
      identity: documentedId,
      rule: "operation-description",
    });
    // Whitespace is not documentation.
    const blank = mutate((entry) => {
      const target = entry.operations.find(
        (operation) => operation.id === documented?.id,
      );
      if (target !== undefined)
        (target as unknown as { description?: string }).description = "   \n  ";
    });
    expect(forRule("operation-description", blank)).toContainEqual({
      identity: documentedId,
      rule: "operation-description",
    });
  });

  it("reports a title that fell back to the operation id or the route", () => {
    const derived = mutate((entry) => {
      const target = entry.operations[0];
      if (target !== undefined) {
        (target as unknown as { title: string }).title =
          target.contractId ?? target.title;
      }
    });
    const first = `${service.id}~${service.operations[0]?.id ?? ""}`;
    expect(forRule("operation-summary", derived)).toContainEqual({
      identity: first,
      rule: "operation-summary",
    });
    const written = mutate((entry) => {
      const target = entry.operations[0];
      if (target !== undefined)
        (target as unknown as { title: string }).title = "Create an inbox";
    });
    expect(forRule("operation-summary", written)).not.toContainEqual(
      expect.objectContaining({ identity: first }),
    );
  });

  it("reports an operation with only failure responses", () => {
    expect(forRule("operation-success-response")).toEqual([]);
    const failures = mutate((entry) => {
      const target = entry.operations[0];
      const first = target?.responses[0];
      if (target === undefined || first === undefined) return;
      (target as unknown as { responses: unknown[] }).responses = [
        { ...first, status: { code: 500, kind: "code" } },
      ];
    });
    expect(forRule("operation-success-response", failures)).toHaveLength(1);
    // A default response is a documented outcome, so it satisfies the rule.
    const fallback = mutate((entry) => {
      const target = entry.operations[0];
      if (target === undefined) return;
      const first = target.responses[0];
      if (first === undefined) return;
      (target as unknown as { responses: unknown[] }).responses = [
        { ...first, status: { kind: "default" } },
      ];
    });
    expect(forRule("operation-success-response", fallback)).toEqual([]);
  });

  it("reports a parameter with no description", () => {
    const withParameters = service.operations.find(
      (operation) => operation.parameters.length > 0,
    );
    expect(withParameters).toBeDefined();
    const undocumented = mutate((entry) => {
      const target = entry.operations.find(
        (operation) => operation.id === withParameters?.id,
      );
      const parameter = target?.parameters[0];
      if (parameter !== undefined)
        delete (parameter as unknown as { description?: string }).description;
    });
    const parameter = withParameters?.parameters[0];
    expect(
      forRule("operation-parameter-description", undocumented),
    ).toContainEqual({
      identity: `${service.id}~${withParameters?.id ?? ""}`,
      locator: `${parameter?.location ?? ""}:${parameter?.name ?? ""}`,
      rule: "operation-parameter-description",
    });
  });
});

describe("schema rules", () => {
  it("accepts a schema with a title or a description and reports a bare one", () => {
    const [schemaId] = Object.keys(service.schemas);
    expect(schemaId).toBeDefined();
    const titled = mutate((entry) => {
      const schema = entry.schemas[schemaId ?? ""];
      if (schema !== undefined) {
        (schema as unknown as { title?: string }).title = "An inbox";
        delete (schema as unknown as { description?: string }).description;
      }
    });
    expect(forRule("schema-description", titled)).not.toContainEqual(
      expect.objectContaining({ identity: `${service.id}~${schemaId ?? ""}` }),
    );
    const described = mutate((entry) => {
      const schema = entry.schemas[schemaId ?? ""];
      if (schema !== undefined) {
        delete (schema as unknown as { title?: string }).title;
        (schema as unknown as { description?: string }).description =
          "An inbox.";
      }
    });
    expect(forRule("schema-description", described)).not.toContainEqual(
      expect.objectContaining({ identity: `${service.id}~${schemaId ?? ""}` }),
    );
  });

  it("skips a property that references a documented definition", () => {
    const objectId = Object.entries(service.schemas).find(
      ([, schema]) => schema.kind === "object",
    )?.[0];
    expect(objectId).toBeDefined();
    const referenced = mutate((entry) => {
      const schema = entry.schemas[objectId ?? ""];
      if (schema?.kind !== "object") return;
      const [name] = schema.propertyOrder;
      if (name === undefined) return;
      (schema.properties as Record<string, unknown>)[name] = {
        kind: "ref",
        schemaId: objectId,
      };
    });
    const before = forRule("schema-property-description").length;
    const after = forRule("schema-property-description", referenced).length;
    expect(after).toBeLessThan(before);
  });

  it("reports an enumeration with no explanation and accepts a described one", () => {
    const enumerated = mutate((entry) => {
      entry.schemas["quality_enum"] = {
        enumValues: ["draft", "sent"],
        kind: "scalar",
        type: "string",
      } as never;
    });
    expect(forRule("schema-enum-undocumented", enumerated)).toContainEqual({
      identity: `${service.id}~quality_enum`,
      rule: "schema-enum-undocumented",
    });
    const explained = mutate((entry) => {
      entry.schemas["quality_enum"] = {
        description: "draft is unsent; sent has left the outbox.",
        enumValues: ["draft", "sent"],
        kind: "scalar",
        type: "string",
      } as never;
    });
    expect(forRule("schema-enum-undocumented", explained)).toEqual([]);
  });
});

describe("example rules", () => {
  it("accepts a body whose schema carries the example", () => {
    const withBody = service.operations.find(
      (operation) => (operation.requestBody?.content.length ?? 0) > 0,
    );
    expect(withBody).toBeDefined();
    const identity = `${service.id}~${withBody?.id ?? ""}`;
    const stripped = mutate((entry) => {
      const target = entry.operations.find(
        (operation) => operation.id === withBody?.id,
      );
      for (const content of target?.requestBody?.content ?? []) {
        (content as unknown as { examples: unknown[] }).examples = [];
        if (content.schema !== undefined)
          delete (content.schema as unknown as { examples?: unknown[] })
            .examples;
      }
    });
    expect(forRule("example-request-missing", stripped)).toContainEqual(
      expect.objectContaining({ identity }),
    );
    const schemaExample = mutate((entry) => {
      const target = entry.operations.find(
        (operation) => operation.id === withBody?.id,
      );
      for (const content of target?.requestBody?.content ?? []) {
        (content as unknown as { examples: unknown[] }).examples = [];
        if (content.schema !== undefined)
          (content.schema as unknown as { examples?: unknown[] }).examples = [
            { label: "demo" },
          ];
      }
    });
    expect(
      forRule("example-request-missing", schemaExample),
    ).not.toContainEqual(expect.objectContaining({ identity }));
  });

  it("names the place of a credential-shaped example without echoing it", () => {
    const leaked = mutate((entry) => {
      const target = entry.operations[0];
      const content = target?.responses[0]?.bodies[0];
      if (content === undefined) return;
      (content as unknown as { examples: unknown[] }).examples = [
        {
          id: "example_leak",
          name: "leak",
          value: {
            // Dotted so the repository's own secret scanner sees three
            // characters, while the rule still sees a long opaque value.
            apiKey: "aB3.dEfGhIjKlMnOpQrStUvWxYz012345",
            id: "inb_1",
          },
        },
      ];
    });
    const evaluation = evaluateQuality(factsFor(leaked), { now: NOW });
    const finding = evaluation.findings.find(
      (entry) => entry.rule === "example-credential-value",
    );
    expect(finding).toBeDefined();
    expect(finding?.locator).toContain("apiKey");
    expect(JSON.stringify(evaluation)).not.toContain(
      "dEfGhIjKlMnOpQrStUvWxYz012345",
    );
  });

  it("ignores obvious placeholders and short opaque values", () => {
    const placeholder = mutate((entry) => {
      const content = entry.operations[0]?.responses[0]?.bodies[0];
      if (content === undefined) return;
      (content as unknown as { examples: unknown[] }).examples = [
        {
          id: "example_placeholder",
          name: "placeholder",
          value: { apiKey: "<YOUR_API_KEY_GOES_RIGHT_HERE>", token: "tok_123" },
        },
      ];
    });
    expect(forRule("example-credential-value", placeholder)).toEqual([]);
  });

  it("reports a well-known secret format wherever it appears", () => {
    const jwt = mutate((entry) => {
      const content = entry.operations[0]?.responses[0]?.bodies[0];
      if (content === undefined) return;
      (content as unknown as { examples: unknown[] }).examples = [
        {
          id: "example_jwt",
          name: "jwt",
          value: {
            note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
          },
        },
      ];
    });
    expect(forRule("example-credential-value", jwt)).toHaveLength(1);
  });
});

describe("authentication rules", () => {
  it("reports an undescribed scheme in use and ignores an unused one", () => {
    const [schemeId] = Object.keys(service.securitySchemes);
    expect(schemeId).toBeDefined();
    const bare = mutate((entry) => {
      const scheme = entry.securitySchemes[schemeId ?? ""];
      if (scheme !== undefined)
        delete (scheme as { description?: string }).description;
    });
    expect(forRule("auth-scheme-description", bare)).toContainEqual({
      identity: `${service.id}~${schemeId ?? ""}`,
      rule: "auth-scheme-description",
    });
    const unused = mutate((entry) => {
      entry.securitySchemes["quality_unused"] = {
        kind: "http",
        scheme: "bearer",
      } as never;
    });
    expect(forRule("auth-scheme-description", unused)).not.toContainEqual(
      expect.objectContaining({ identity: `${service.id}~quality_unused` }),
    );
  });

  it("reports an operation that mixes anonymous and authenticated access", () => {
    const mixed = mutate((entry) => {
      const target = entry.operations[0];
      if (target === undefined) return;
      (target as unknown as { security: unknown[] }).security = [
        { schemes: [] },
        {
          schemes: [
            { schemeId: Object.keys(entry.securitySchemes)[0], scopes: [] },
          ],
        },
      ];
    });
    expect(forRule("auth-anonymous-alternative", mixed)).toHaveLength(1);
    const anonymousOnly = mutate((entry) => {
      const target = entry.operations[0];
      if (target !== undefined)
        (target as unknown as { security: unknown[] }).security = [
          { schemes: [] },
        ];
    });
    expect(forRule("auth-anonymous-alternative", anonymousOnly)).toEqual([]);
  });
});

describe("sdk rules", () => {
  it("holds a complete SDK to every operation and leaves a partial one alone", () => {
    const complete = snippetsWithSdk({
      coverage: "complete",
      id: "typescript",
      label: "TypeScript",
      language: "typescript",
      package: "@testinbox/sdk",
    });
    const missing = forRule("sdk-example-missing", testinbox, {
      snippets: complete,
    });
    expect(missing).toHaveLength(service.operations.length);
    expect(missing[0]?.locator).toBe("typescript");
    const partial = snippetsWithSdk({
      coverage: "partial",
      id: "typescript",
      label: "TypeScript",
      language: "typescript",
    });
    expect(
      forRule("sdk-example-missing", testinbox, { snippets: partial }),
    ).toEqual([]);
  });

  it("reports a complete SDK with no package and an example on a deprecated operation", () => {
    const nameless = snippetsWithSdk({
      coverage: "complete",
      id: "typescript",
      label: "TypeScript",
      language: "typescript",
    });
    expect(
      forRule("sdk-package-missing", testinbox, { snippets: nameless }),
    ).toEqual([{ identity: "typescript", rule: "sdk-package-missing" }]);
    const deprecated = service.operations.find(
      (operation) => operation.deprecated,
    );
    expect(deprecated).toBeDefined();
    const key = `${service.id}~${deprecated?.id ?? ""}`;
    const mapped = snippetsWithSdk(
      {
        coverage: "partial",
        id: "typescript",
        label: "TypeScript",
        language: "typescript",
      },
      {
        [key]: [{ code: "await client.mark();", lines: [], sdk: "typescript" }],
      },
    );
    expect(
      forRule("sdk-example-deprecated", testinbox, { snippets: mapped }),
    ).toEqual([
      { identity: key, locator: "typescript", rule: "sdk-example-deprecated" },
    ]);
  });
});

describe("authored content rules", () => {
  it("reports a page without a description and carries its source path", () => {
    const withoutDescription: ContentArtifact = {
      ...testinboxContent,
      pages: testinboxContent.pages.map((page, index) => {
        if (index !== 0) return page;
        const { description: _description, ...rest } = page;
        return rest;
      }),
    };
    const evaluation = evaluateQuality(
      factsFor(testinbox, {
        content: withoutDescription,
        navigation: testinboxNavigation,
      }),
      { now: NOW },
    );
    const finding = evaluation.findings.find(
      (entry) => entry.rule === "page-description",
    );
    expect(finding?.target.identity).toBe(testinboxContent.pages[0]?.route);
    expect(finding?.source).toBe(testinboxContent.pages[0]?.sourcePath);
    expect(finding?.source ?? "").not.toContain("/Users");
  });

  it("says nothing about the fixture's own pages, which are all described", () => {
    expect(
      forRule("page-description", testinbox, {
        content: testinboxContent,
        navigation: testinboxNavigation,
      }),
    ).toEqual([]);
  });
});

describe("registry", () => {
  it("publishes unique ASCII rule ids with documented metadata", () => {
    const ids = RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of RULES) {
      expect(rule.id, rule.id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
      expect(rule.title.length, rule.id).toBeGreaterThan(0);
      expect(rule.summary.length, rule.id).toBeGreaterThan(20);
      expect(["error", "info", "warning"]).toContain(rule.defaultSeverity);
    }
  });

  it("produces byte-identical results for the same artifacts", () => {
    const first = evaluateQuality(factsFor(testinbox), { now: NOW });
    const second = evaluateQuality(factsFor(testinbox), { now: NOW });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
