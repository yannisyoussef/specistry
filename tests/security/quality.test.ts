import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  collectFacts,
  evaluateQuality,
  parsePolicy,
  RULE_IDS,
  RULES,
  serializeEvaluation,
} from "@specistry/quality";
import {
  parseContentArtifact,
  parseNavigationArtifact,
} from "@specistry/content";
import {
  parseDocumentationArtifact,
  serializeDocumentationArtifact,
  type DocumentationArtifact,
} from "@specistry/model";
import { describe, expect, it } from "vitest";

import { formatHumanResult } from "../../packages/cli/src/presentation";

/**
 * SPEC-011 §69–§72, §149–§158, §197: hostile contract text cannot rewrite a
 * terminal, no example value or credential reaches a report, prototype-shaped
 * identities stay data, the engine loads nothing at runtime, and an evaluation
 * is bounded.
 */

const root = path.resolve(__dirname, "../..");
const fixtures = path.join(root, "tests/fixtures/reader");
const NOW = new Date("2026-09-07T00:00:00Z");

function artifact(name: string): DocumentationArtifact {
  return parseDocumentationArtifact(
    readFileSync(
      path.join(fixtures, name, ".specistry/artifacts/documentation.json"),
      "utf8",
    ),
  );
}

function evaluate(
  input: DocumentationArtifact,
  policy = parsePolicy(undefined).policy,
) {
  return evaluateQuality(
    collectFacts({ artifact: input, target: { kind: "candidate" } }),
    { now: NOW, policy },
  );
}

/** Renders a check result exactly as the CLI writes it to a terminal. */
function render(input: DocumentationArtifact): string {
  const quality = evaluate(input);
  return formatHumanResult(
    {
      context: { config: { name: "Hostile" } } as never,
      diagnostics: [],
      ok: true,
      outcome: "success",
      quality,
    },
    "check",
  );
}

function mutate(
  base: DocumentationArtifact,
  edit: (service: {
    name: string;
    operations: { title: string; path: string; responses: unknown[] }[];
    schemas: Record<string, unknown>;
  }) => void,
): DocumentationArtifact {
  const clone = JSON.parse(serializeDocumentationArtifact(base)) as {
    model: { versions: { services: Parameters<typeof edit>[0][] }[] };
  };
  const service = clone.model.versions[0]?.services[0];
  if (service === undefined) throw new Error("fixture has no service");
  edit(service);
  return parseDocumentationArtifact(JSON.stringify(clone));
}

describe("terminal safety", () => {
  it("neutralizes hostile contract text in the human report", () => {
    // A schema's display name reaches the report as a label, so it is the
    // text an attacker would use; operation labels are method and path.
    const hostile = mutate(artifact("testinbox"), (service) => {
      const [id] = Object.keys(service.schemas);
      const schema = service.schemas[id ?? ""] as {
        name?: string;
        title?: string;
        description?: string;
      };
      if (schema === undefined) return;
      schema.name = "\u001b[31mred\u0007\u000aFAKE: gate passed \u202ereversed";
      delete schema.title;
      delete schema.description;
    });
    const output = render(hostile);
    expect(output).not.toMatch(/\u001b/);
    expect(output).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
    expect(output).not.toMatch(/\u202e/);
    expect(output).toContain("\\u001b[31mred");
    // The forged line is inside one finding, not a line of its own.
    for (const line of output.split("\n")) {
      expect(line.startsWith("FAKE:")).toBe(false);
    }
  });

  it("keeps the adversarial fixture's own strings inert", () => {
    const output = render(artifact("edge"));
    expect(output).not.toMatch(/\u001b/);
    expect(output).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  });

  it("emits valid JSON with no ANSI and no raw control characters", () => {
    const hostile = mutate(artifact("testinbox"), (service) => {
      const [id] = Object.keys(service.schemas);
      const schema = service.schemas[id ?? ""] as {
        name?: string;
        title?: string;
        description?: string;
      };
      if (schema === undefined) return;
      schema.name = "\u001b]8;;http://evil.example\u0007link\u001b]8;;\u0007";
      delete schema.title;
      delete schema.description;
    });
    const json = serializeEvaluation(evaluate(hostile));
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
    // The text survives as data, escaped by JSON itself.
    expect(JSON.stringify(JSON.parse(json))).toContain("\\u001b");
  });
});

describe("value and secret safety", () => {
  const CANARY = "sk_live_qA7pZ2mN8xR4tW6vB1cD3fG5";

  it("never copies an example value into a finding or the JSON output", () => {
    const leaked = mutate(artifact("testinbox"), (service) => {
      const operation = service.operations[0] as unknown as {
        responses: { bodies: { examples: unknown[] }[] }[];
      };
      const body = operation.responses[0]?.bodies[0];
      if (body === undefined) return;
      body.examples = [
        {
          id: "example_canary",
          name: "canary",
          value: { apiKey: CANARY, nested: { token: CANARY } },
        },
      ];
    });
    const evaluation = evaluate(leaked);
    const json = serializeEvaluation(evaluation);
    expect(json).not.toContain(CANARY);
    expect(render(leaked)).not.toContain(CANARY);
    const finding = evaluation.findings.find(
      (entry) => entry.rule === "example-credential-value",
    );
    expect(finding).toBeDefined();
    expect(finding?.locator).toContain("apiKey");
  });

  it("keeps a suppression reason out of reach of terminal control characters", () => {
    const result = parsePolicy({
      suppressions: [
        {
          reason: `\u001b[2Kfake pass ${CANARY}`,
          rule: "operation-description",
          target: "openapi.yaml~listInboxes",
        },
      ],
    });
    expect(result.diagnostics).toEqual([
      { code: "QUALITY_SUPPRESSION_INVALID", path: "/suppressions/0" },
    ]);
    expect(result.policy.suppressions).toEqual([]);
  });

  it("reports no machine path for an authored finding", () => {
    const content = parseContentArtifact(
      readFileSync(
        path.join(fixtures, "testinbox/.specistry/artifacts/content.json"),
        "utf8",
      ),
    );
    const navigation = parseNavigationArtifact(
      readFileSync(
        path.join(fixtures, "testinbox/.specistry/artifacts/navigation.json"),
        "utf8",
      ),
    );
    const stripped = {
      ...content,
      pages: content.pages.map((page) => ({ ...page, description: undefined })),
    };
    const evaluation = evaluateQuality(
      collectFacts({
        artifact: artifact("testinbox"),
        content: stripped,
        navigation,
        target: { kind: "candidate" },
      }),
      { now: NOW },
    );
    const json = serializeEvaluation(evaluation);
    expect(json).not.toContain(root);
    expect(json).not.toContain("/Users");
    expect(
      evaluation.findings.some(
        (finding) => finding.rule === "page-description",
      ),
    ).toBe(true);
  });
});

describe("hostile identities", () => {
  it("treats prototype-shaped names as ordinary data", () => {
    // `__proto__` is not a canonical id at all — it does not start with a
    // letter or digit — so the model refuses it before any rule runs.
    expect(() =>
      mutate(artifact("testinbox"), (service) => {
        Object.defineProperty(service.schemas, "__proto__", {
          configurable: true,
          enumerable: true,
          value: { kind: "any" },
          writable: true,
        });
      }),
    ).toThrow();

    // `constructor` and `prototype` are valid ids, and stay plain data.
    const hostile = mutate(artifact("testinbox"), (service) => {
      service.schemas["constructor"] = { kind: "any" };
      service.schemas["prototype"] = { kind: "any" };
    });
    const evaluation = evaluate(hostile);
    const identities = evaluation.findings.map(
      (finding) => finding.target.identity,
    );
    expect(identities).toContain("openapi.yaml~constructor");
    expect(identities).toContain("openapi.yaml~prototype");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);

    // A suppression can name one of them, and it suppresses only that one.
    const policy = parsePolicy({
      suppressions: [
        {
          reason: "The definition is generated and cannot be renamed yet.",
          rule: "schema-description",
          target: "openapi.yaml~constructor",
        },
      ],
    }).policy;
    const suppressed = evaluate(hostile, policy);
    expect(suppressed.summary.suppressed).toBe(1);
    expect(
      suppressed.findings.filter(
        (finding) =>
          finding.rule === "schema-description" &&
          finding.suppressed === undefined,
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("no dynamic behaviour", () => {
  function walk(directory: string, out: string[] = []): string[] {
    for (const entry of readdirSync(directory)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.ts$/.test(entry) && !/\.test\.ts$|test-helper/.test(entry)) {
        out.push(full);
      }
    }
    return out;
  }

  it("loads no module, reads no file, and opens no socket", () => {
    for (const file of walk(path.join(root, "packages/quality/src"))) {
      const source = readFileSync(file, "utf8");
      const relative = path.relative(root, file);
      expect(source, relative).not.toMatch(/\bimport\s*\(/);
      expect(source, relative).not.toMatch(/\brequire\s*\(/);
      expect(source, relative).not.toMatch(/\beval\s*\(/);
      expect(source, relative).not.toMatch(/new Function\s*\(/);
      expect(source, relative).not.toMatch(/\bfetch\s*\(/);
      expect(source, relative).not.toMatch(/node:fs|node:net|node:http/);
      expect(source, relative).not.toMatch(/process\.(env|cwd)/);
    }
  });

  it("exposes no way for configuration to add or replace a rule", () => {
    const before = RULE_IDS.length;
    const policy = parsePolicy({
      rules: { "custom-rule": "error" },
    });
    expect(policy.diagnostics[0]?.code).toBe("QUALITY_RULE_UNKNOWN");
    expect(RULE_IDS.length).toBe(before);
    // The registry is a plain array composed from explicit imports.
    expect(RULES.every((rule) => typeof rule.evaluate === "function")).toBe(
      true,
    );
  });

  it("keeps the quality engine out of the reader", () => {
    for (const directory of ["apps/web/app", "apps/web/lib"]) {
      for (const file of walk(path.join(root, directory))) {
        expect(readFileSync(file, "utf8"), file).not.toContain(
          "@specistry/quality",
        );
      }
    }
    const manifest = JSON.parse(
      readFileSync(path.join(root, "apps/web/package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain(
      "@specistry/quality",
    );
  });
});

describe("bounded reports", () => {
  it("cannot be made to emit an unbounded report", () => {
    const many = mutate(artifact("testinbox"), (service) => {
      const template = service.operations[0];
      if (template === undefined) return;
      service.operations = Array.from({ length: 4_000 }, (_, index) => ({
        ...template,
        contractId: `flood${index}`,
        description: undefined,
        id: `flood${index}`,
        parameters: [],
        path: `/flood/${index}`,
      })) as never;
    });
    const evaluation = evaluate(many);
    expect(evaluation.findings.length).toBeLessThanOrEqual(5_000);
    expect(evaluation.summary.truncated).toBe(true);
    expect(serializeEvaluation(evaluation).length).toBeLessThan(5_000_000);
  });

  it("cannot pass a gate it did not finish evaluating", () => {
    const many = mutate(artifact("testinbox"), (service) => {
      const template = service.operations[0];
      if (template === undefined) return;
      service.operations = Array.from({ length: 1_500 }, (_, index) => ({
        ...template,
        contractId: `flood${index}`,
        description: undefined,
        id: `flood${index}`,
        parameters: [],
        path: `/flood/${index}`,
      })) as never;
    });
    const strict = parsePolicy({
      rules: { "operation-description": "error" },
    }).policy;
    const evaluation = evaluate(many, strict);
    expect(evaluation.summary.truncated).toBe(true);
    expect(evaluation.summary.gate).toBe("failed");
  });
});
