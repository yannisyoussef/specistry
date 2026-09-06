import { describe, expect, it } from "vitest";

import { evaluateQuality } from "./engine.js";
import {
  factsFor,
  firstService,
  mutate,
  testinbox,
} from "./fixtures.test-helper.js";

/**
 * SPEC-011 §18–§21, §98–§106, §164–§171: compatibility findings are a
 * policy layer over the SPEC-010 diff, never a rewrite of it. Only
 * defensible semantics are classified; everything uncertain stays "changed,
 * review required". Direction matters, and authentication uses set
 * semantics rather than text comparison.
 */

const NOW = new Date("2026-09-07T00:00:00Z");
const service = firstService(testinbox);
const first = service.operations[0];
const firstIdentity = `${service.id}~${first?.id ?? ""}`;

function compat(
  next: ReturnType<typeof mutate>,
  base = testinbox,
): readonly { rule: string; identity: string; locator?: string }[] {
  const evaluation = evaluateQuality(factsFor(next, { base }), { now: NOW });
  return evaluation.findings
    .filter((finding) => finding.category === "compatibility")
    .map((finding) => ({
      ...(finding.locator === undefined ? {} : { locator: finding.locator }),
      identity: finding.target.identity,
      rule: finding.rule,
    }));
}

describe("no comparison base", () => {
  it("produces no compatibility finding at all", () => {
    const evaluation = evaluateQuality(factsFor(testinbox), { now: NOW });
    expect(
      evaluation.findings.filter(
        (finding) => finding.category === "compatibility",
      ),
    ).toEqual([]);
  });
});

describe("removals", () => {
  it("reports a removed operation as an error", () => {
    const removed = mutate((entry) => {
      entry.operations = entry.operations.slice(1);
    });
    expect(compat(removed)).toContainEqual({
      identity: firstIdentity,
      rule: "api-operation-removed",
    });
  });

  it("expands a removed service into its operations", () => {
    // A removed service produces no per-operation diff candidate, so the
    // rule walks the base facts rather than letting the operations vanish.
    const emptied = mutate((_entry, artifact) => {
      const clone = artifact as {
        model: { versions: { services: unknown[] }[] };
      };
      const version = clone.model.versions[0];
      if (version !== undefined) version.services = [];
    });
    const findings = compat(emptied);
    expect(findings.length).toBe(service.operations.length);
    expect(
      findings.every((finding) => finding.rule === "api-operation-removed"),
    ).toBe(true);
  });

  it("reports a removed parameter and a removed response status", () => {
    const withParameters = service.operations.find(
      (operation) => operation.parameters.length > 1,
    );
    expect(withParameters).toBeDefined();
    const parameter = withParameters?.parameters[0];
    const trimmed = mutate((entry) => {
      const target = entry.operations.find(
        (operation) => operation.id === withParameters?.id,
      );
      if (target === undefined) return;
      (target as unknown as { parameters: unknown[] }).parameters =
        target.parameters.slice(1);
      if (target.responses.length > 1) {
        (target as unknown as { responses: unknown[] }).responses =
          target.responses.slice(0, -1);
      }
    });
    const findings = compat(trimmed);
    expect(findings).toContainEqual({
      identity: `${service.id}~${withParameters?.id ?? ""}`,
      locator: `${parameter?.location ?? ""}:${parameter?.name ?? ""}`,
      rule: "api-parameter-removed",
    });
    expect(
      findings.some((finding) => finding.rule === "api-response-removed"),
    ).toBe(true);
  });
});

describe("parameters", () => {
  const withParameters = service.operations.find(
    (operation) => operation.parameters.length > 0,
  );
  const identity = `${service.id}~${withParameters?.id ?? ""}`;

  function added(required: boolean): ReturnType<typeof mutate> {
    return mutate((entry) => {
      const target = entry.operations.find(
        (operation) => operation.id === withParameters?.id,
      );
      const template = target?.parameters[0];
      if (target === undefined || template === undefined) return;
      (target as unknown as { parameters: unknown[] }).parameters = [
        ...target.parameters,
        {
          ...template,
          id: `${template.id}_added`,
          location: "query",
          name: "addedFilter",
          required,
          serialization: {
            allowReserved: false,
            explode: true,
            style: "form",
          },
        },
      ];
    });
  }

  it("reports a required parameter added and stays quiet about an optional one", () => {
    expect(compat(added(true))).toContainEqual({
      identity,
      locator: "query:addedFilter",
      rule: "api-required-parameter-added",
    });
    expect(compat(added(false))).not.toContainEqual(
      expect.objectContaining({ rule: "api-required-parameter-added" }),
    );
  });
});

describe("authentication set semantics", () => {
  const schemes = Object.keys(service.securitySchemes);
  const primary = schemes[0];
  const secondary = schemes[1] ?? schemes[0];

  function withSecurity(
    alternatives: readonly (readonly string[])[],
    base = testinbox,
  ): ReturnType<typeof mutate> {
    return mutate((entry) => {
      const target = entry.operations[0];
      if (target === undefined) return;
      (target as unknown as { security: unknown[] }).security =
        alternatives.map((schemeIds) => ({
          schemes: schemeIds.map((schemeId) => ({ schemeId, scopes: [] })),
        }));
    }, base);
  }

  it("reports the loss of anonymous access", () => {
    const before = withSecurity([[], [primary ?? ""]]);
    const after = withSecurity([[primary ?? ""]]);
    expect(compat(after, before)).toContainEqual({
      identity: firstIdentity,
      rule: "api-security-restricted",
    });
  });

  it("stays quiet when an alternative is added", () => {
    const before = withSecurity([[primary ?? ""]]);
    const after = withSecurity([[primary ?? ""], [secondary ?? ""]]);
    expect(compat(after, before)).not.toContainEqual(
      expect.objectContaining({ rule: "api-security-restricted" }),
    );
  });

  it("reports a new AND requirement on an existing alternative", () => {
    const before = withSecurity([[primary ?? ""]]);
    const after = withSecurity([[primary ?? "", secondary ?? ""]]);
    // A caller holding only the first scheme satisfied the old contract and
    // satisfies no alternative of the new one.
    const findings = compat(after, before);
    expect(
      schemes.length > 1
        ? findings.some((finding) => finding.rule === "api-security-restricted")
        : true,
    ).toBe(true);
  });

  it("stays quiet when an AND requirement is relaxed", () => {
    const before = withSecurity([[primary ?? "", secondary ?? ""]]);
    const after = withSecurity([[primary ?? ""]]);
    expect(compat(after, before)).not.toContainEqual(
      expect.objectContaining({ rule: "api-security-restricted" }),
    );
  });
});

describe("schemas stay conservative", () => {
  it("reports a changed payload as review required, never as breaking", () => {
    const changed = mutate((entry) => {
      const target = entry.operations.find(
        (operation) => (operation.requestBody?.content.length ?? 0) > 0,
      );
      const content = target?.requestBody?.content[0];
      if (content?.schema === undefined) return;
      (content.schema as { description?: string }).description =
        "A different description entirely.";
    });
    const findings = compat(changed);
    const schemaFindings = findings.filter(
      (finding) => finding.rule === "api-schema-changed",
    );
    expect(schemaFindings.length).toBeGreaterThan(0);
    expect(findings.some((finding) => finding.rule.includes("breaking"))).toBe(
      false,
    );
  });

  it("keeps the review-required finding at info so it never fails a default gate", () => {
    const changed = mutate((entry) => {
      const [schemaId] = Object.keys(entry.schemas);
      const schema = entry.schemas[schemaId ?? ""];
      if (schema !== undefined)
        (schema as { description?: string }).description = "Changed.";
    });
    const evaluation = evaluateQuality(factsFor(changed, { base: testinbox }), {
      now: NOW,
    });
    const finding = evaluation.findings.find(
      (entry) => entry.rule === "api-schema-changed",
    );
    expect(finding?.severity).toBe("info");
    expect(evaluation.summary.gate).toBe("passed");
  });
});

describe("additions", () => {
  it("never reports an added operation as a compatibility problem", () => {
    const enlarged = mutate((entry) => {
      const template = entry.operations[0];
      if (template === undefined) return;
      entry.operations = [
        ...entry.operations,
        {
          ...template,
          contractId: "brandNewOperation",
          id: "brandNewOperation",
          parameters: [],
          path: "/brand-new",
        } as never,
      ];
    });
    expect(compat(enlarged)).toEqual([]);
  });

  it("never reports a deprecation as a compatibility problem", () => {
    const deprecated = mutate((entry) => {
      const target = entry.operations.find(
        (operation) => !operation.deprecated,
      );
      if (target !== undefined)
        (target as unknown as { deprecated: boolean }).deprecated = true;
    });
    expect(compat(deprecated)).toEqual([]);
  });
});
