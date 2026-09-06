import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocumentationArtifact } from "@specra/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SchemaBlock } from "../../apps/web/components/reader/schema/schema-block";
import {
  countViewNodes,
  createSchemaView,
  DEFAULT_SCHEMA_BUDGET,
} from "../../apps/web/lib/reader/schema-view";
import { corpus, deepObject, object, roots } from "../fixtures/schemas/corpus";

/**
 * Schema renderer performance and DOM evidence (SPEC-005). Each case reports
 * projection time, view nodes, HTML bytes, and DOM elements for a
 * representative shape; the budgets are generous regression ceilings and the
 * printed numbers are the evidence recorded in the reader documentation.
 */

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/reader/", import.meta.url),
);
const measurementsPath = fileURLToPath(
  new URL("./schema-measurements.json", import.meta.url),
);

interface Measurement {
  readonly name: string;
  readonly projectMs: number;
  readonly renderMs: number;
  readonly viewNodes: number;
  readonly htmlBytes: number;
  readonly domElements: number;
  readonly details: number;
}

const measurements: Measurement[] = [];

function measure(
  name: string,
  node: Parameters<typeof createSchemaView>[0],
  registry: Parameters<typeof createSchemaView>[1]["registry"],
  context: "request" | "response" = "response",
): Measurement {
  const projectStart = performance.now();
  const view = createSchemaView(node, { context, registry });
  const projectMs = performance.now() - projectStart;
  const renderStart = performance.now();
  const html = renderToStaticMarkup(
    createElement(SchemaBlock, {
      context,
      focusHref: (locator: string) => `/op?schema=b&at=${locator}`,
      idPrefix: "b",
      view,
    }),
  );
  const renderMs = performance.now() - renderStart;
  const measurement: Measurement = {
    details: (html.match(/<details/g) ?? []).length,
    domElements: (html.match(/<[a-z]/g) ?? []).length,
    htmlBytes: Buffer.byteLength(html, "utf8"),
    name,
    projectMs: Number(projectMs.toFixed(2)),
    renderMs: Number(renderMs.toFixed(2)),
    viewNodes: countViewNodes(view),
  };
  measurements.push(measurement);
  console.log(
    `[schema] ${name}: project ${measurement.projectMs} ms, render ${measurement.renderMs} ms, ${measurement.viewNodes} view nodes, ${measurement.domElements} elements, ${measurement.htmlBytes} B, ${measurement.details} disclosures`,
  );
  return measurement;
}

function wide(count: number) {
  const properties: Record<string, ReturnType<typeof object>> = {};
  for (let index = 0; index < count; index += 1) {
    properties[`property${index}`] = object(
      {
        id: { kind: "scalar", type: "string" },
        count: { kind: "scalar", type: "integer" },
      },
      { name: `Item${index}` },
    );
  }
  return object(properties, { name: "Wide" });
}

describe("schema renderer performance", () => {
  it("projects and renders representative shapes within budget", () => {
    const twenty = measure("object-20", roots.twenty, corpus);
    expect(twenty.projectMs).toBeLessThan(50);
    expect(twenty.domElements).toBeLessThan(400);

    const twoHundred = measure("object-200", roots.twoHundred, corpus);
    expect(twoHundred.viewNodes).toBe(201);
    expect(twoHundred.domElements).toBeLessThan(2_600);
    expect(twoHundred.htmlBytes).toBeLessThan(120_000);
    expect(twoHundred.projectMs + twoHundred.renderMs).toBeLessThan(500);

    const fiveHundred = measure(
      "object-500",
      object(
        Object.fromEntries(
          Array.from({ length: 500 }, (_, index) => [
            `f${index}`,
            { kind: "scalar" as const, type: "string" as const },
          ]),
        ),
        { name: "FiveHundred" },
      ),
      corpus,
    );
    // Bounded at maxProperties: the rest is a count and a link.
    expect(fiveHundred.viewNodes).toBe(DEFAULT_SCHEMA_BUDGET.maxProperties + 1);
    expect(fiveHundred.domElements).toBeLessThan(2_600);

    const nested = measure("wide-nested-300", wide(300), corpus);
    expect(nested.viewNodes).toBeLessThan(
      DEFAULT_SCHEMA_BUDGET.maxNodes + 3 * DEFAULT_SCHEMA_BUDGET.maxProperties,
    );
    // Worst case at the node budget: ~5,100 elements and ~190 KB per block.
    expect(nested.domElements).toBeLessThan(6_500);
    expect(nested.htmlBytes).toBeLessThan(220_000);
    expect(nested.projectMs + nested.renderMs).toBeLessThan(1_500);

    const deep = measure("deep-40", deepObject(40), corpus);
    expect(deep.details).toBeLessThanOrEqual(
      DEFAULT_SCHEMA_BUDGET.maxDepth + 1,
    );

    const recursive = measure("recursive-node", roots.directRecursion, corpus);
    expect(recursive.viewNodes).toBeLessThan(10);

    const variants = measure("oneOf-20", roots.oneOfTwenty, corpus);
    expect(variants.details).toBe(20);

    const request = measure(
      "mixed-request",
      roots.mixedContext,
      corpus,
      "request",
    );
    const response = measure(
      "mixed-response",
      roots.mixedContext,
      corpus,
      "response",
    );
    expect(request.htmlBytes).not.toBe(response.htmlBytes);
  });

  it("renders the edge fixture's largest response within the page budget", () => {
    const artifact = parseDocumentationArtifact(
      readFileSync(
        path.join(
          fixtureRoot,
          "edge",
          ".specra",
          "artifacts",
          "documentation.json",
        ),
        "utf8",
      ),
    );
    const service = artifact.model.versions[0]?.services[0];
    const operation = service?.operations.find(
      (entry) => entry.contractId === "schemaShapes",
    );
    const body = operation?.responses[0]?.bodies[0]?.schema;
    if (service === undefined || body === undefined) throw new Error("fixture");
    const shapes = measure("edge-schema-shapes", body, service.schemas);
    expect(shapes.viewNodes).toBeLessThan(DEFAULT_SCHEMA_BUDGET.maxNodes + 300);
    expect(shapes.htmlBytes).toBeLessThan(160_000);
    expect(shapes.domElements).toBeLessThan(5_000);
    writeFileSync(
      measurementsPath,
      `${JSON.stringify(measurements, null, 2)}\n`,
    );
  });
});
