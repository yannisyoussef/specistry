/**
 * Schema rules (SPEC-011 §27). Only reusable registry schemas are judged:
 * they are the definitions a reader meets by name across many operations.
 * Inline shapes and JSON Schema style preferences are deliberately not
 * rules.
 */

import type { SchemaNode } from "@specra/model";

import type { QualityRule } from "../contracts.js";
import type { SchemaFacts } from "../facts.js";
import { hasText } from "./text.js";

function target(schema: SchemaFacts) {
  return {
    identity: schema.identity,
    kind: "schema" as const,
    label: schema.label,
  };
}

function documented(schema: SchemaNode): boolean {
  return hasText(schema.description) || hasText(schema.title);
}

export const schemaDescription: QualityRule = {
  category: "schemas",
  defaultSeverity: "warning",
  evaluate(facts, emit) {
    for (const entry of facts.schemas) {
      if (documented(entry.schema)) continue;
      emit({
        message: "The reusable schema has neither a title nor a description.",
        target: target(entry),
      });
    }
  },
  id: "schema-description",
  summary:
    "A definition a reader meets by name across operations says what it represents.",
  title: "Reusable schema has a description",
};

export const schemaPropertyDescription: QualityRule = {
  category: "schemas",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    for (const entry of facts.schemas) {
      if (entry.schema.kind !== "object") continue;
      for (const name of entry.schema.propertyOrder) {
        const property = entry.schema.properties[name];
        if (property === undefined) continue;
        // A reference carries its documentation on the definition it names.
        if (property.kind === "ref" || documented(property)) continue;
        emit({
          locator: name,
          message: "The property has no description.",
          target: target(entry),
        });
      }
    }
  },
  id: "schema-property-description",
  summary:
    "Each property of a reusable object explains itself; referenced definitions document themselves.",
  title: "Schema property has a description",
};

export const schemaEnumUndocumented: QualityRule = {
  category: "schemas",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    for (const entry of facts.schemas) {
      const values =
        entry.schema.kind === "scalar" ? entry.schema.enumValues : undefined;
      if (values === undefined || values.length === 0) continue;
      if (hasText(entry.schema.description)) continue;
      emit({
        message:
          "The enumeration lists allowed values without explaining what they mean.",
        target: target(entry),
      });
    }
  },
  id: "schema-enum-undocumented",
  summary:
    "A closed set of values is only useful when a reader knows what each value selects.",
  title: "Enumeration is explained",
};

export const SCHEMA_RULES: readonly QualityRule[] = [
  schemaDescription,
  schemaPropertyDescription,
  schemaEnumUndocumented,
];
