/**
 * Test helpers built on the production-realistic TestInbox artifact
 * (SPEC-011 §128–§129). Rules are exercised by mutating real documentation
 * rather than by hand-writing a shape that happens to satisfy them, so a
 * golden can never pass vacuously.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseContentArtifact,
  parseNavigationArtifact,
  type ContentArtifact,
  type NavigationArtifact,
} from "@specistry/content";
import {
  parseDocumentationArtifact,
  serializeDocumentationArtifact,
  type ApiService,
  type DocumentationArtifact,
  type Operation,
  type SchemaNode,
  type SecurityScheme,
} from "@specistry/model";
import { diffArtifacts } from "@specistry/release";
import {
  parseSnippetsArtifact,
  type SdkDeclaration,
  type SdkExample,
  type SnippetsArtifact,
} from "@specistry/snippets";

import { collectFacts, type QualityFacts } from "./facts.js";

const artifactRoot =
  "../../../tests/fixtures/reader/testinbox/.specistry/artifacts";

function load(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`${artifactRoot}/${name}`, import.meta.url)),
    "utf8",
  );
}

export const testinbox: DocumentationArtifact = parseDocumentationArtifact(
  load("documentation.json"),
);
export const testinboxContent: ContentArtifact = parseContentArtifact(
  load("content.json"),
);
export const testinboxNavigation: NavigationArtifact = parseNavigationArtifact(
  load("navigation.json"),
);
export const testinboxSnippets: SnippetsArtifact = parseSnippetsArtifact(
  load("snippets.json"),
);

/** A writable view of one service, for mutation inside a test. */
export interface MutableService {
  name: string;
  description?: string;
  operations: Operation[];
  schemas: Record<string, SchemaNode>;
  securitySchemes: Record<string, SecurityScheme>;
  tags?: { name: string; description?: string }[];
}

/** Deep-clones the fixture and applies an edit to its first service. */
export function mutate(
  edit: (service: MutableService, artifact: unknown) => void,
  base: DocumentationArtifact = testinbox,
): DocumentationArtifact {
  const clone = JSON.parse(serializeDocumentationArtifact(base)) as {
    model: { versions: { services: MutableService[] }[] };
  };
  const service = clone.model.versions[0]?.services[0];
  if (service === undefined) throw new Error("fixture has no service");
  edit(service, clone);
  return parseDocumentationArtifact(JSON.stringify(clone));
}

export interface FactsOverrides {
  readonly content?: ContentArtifact;
  readonly navigation?: NavigationArtifact;
  readonly snippets?: SnippetsArtifact;
  readonly base?: DocumentationArtifact;
}

/** Facts for one artifact, optionally compared with a base artifact. */
export function factsFor(
  artifact: DocumentationArtifact,
  overrides: FactsOverrides = {},
): QualityFacts {
  return collectFacts({
    artifact,
    target: { kind: "candidate" },
    ...(overrides.content === undefined ? {} : { content: overrides.content }),
    ...(overrides.navigation === undefined
      ? {}
      : { navigation: overrides.navigation }),
    ...(overrides.snippets === undefined
      ? {}
      : { snippets: overrides.snippets }),
    ...(overrides.base === undefined
      ? {}
      : {
          comparison: {
            artifact: overrides.base,
            diff: diffArtifacts(
              { artifact: overrides.base, version: "v1" },
              { artifact, version: "candidate" },
            ),
            from: "v1",
          },
        }),
  });
}

/** The canonical service of the fixture, for reading identities in a test. */
export function firstService(artifact: DocumentationArtifact): ApiService {
  const service = artifact.model.versions[0]?.services[0];
  if (service === undefined) throw new Error("fixture has no service");
  return service;
}

/** A snippets artifact with one SDK declaration and chosen coverage. */
export function snippetsWithSdk(
  declaration: SdkDeclaration,
  examples: Readonly<Record<string, readonly SdkExample[]>> = {},
): SnippetsArtifact {
  return {
    environments: [],
    operations: {},
    sdkExamples: examples,
    sdks: [declaration],
    snippetsVersion: testinboxSnippets.snippetsVersion,
  };
}

/**
 * A synthetic artifact with `count` undocumented operations, for budget and
 * scale tests. Built by cloning a real operation so the canonical model
 * accepts it; every clone keeps a unique id and path.
 */
export function manyOperations(
  count: number,
  base: DocumentationArtifact = testinbox,
): DocumentationArtifact {
  return mutate((service) => {
    const template = service.operations[0];
    if (template === undefined) throw new Error("fixture has no operation");
    const operations: Operation[] = [];
    for (let index = 0; index < count; index += 1) {
      // The model derives the operation id from the contract id, so the two
      // must agree or the artifact is rejected.
      const contractId = `syntheticOperation${index}`;
      operations.push({
        ...template,
        contractId,
        description: undefined,
        id: contractId as Operation["id"],
        parameters: [],
        path: `/synthetic/${index}`,
        title: `Synthetic operation ${index}`,
      } as unknown as Operation);
    }
    service.operations = operations;
  }, base);
}
