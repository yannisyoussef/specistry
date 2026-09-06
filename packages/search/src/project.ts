import {
  buildApiRouteTree,
  flattenNavigation,
  type BlockNode,
  type ContentPage,
  type InlineNode,
  type NavigationArtifact,
} from "@specra/content";
import type {
  ApiService,
  DocumentationArtifact,
  Operation,
  SchemaNode,
} from "@specra/model";

import { boundedText } from "./tokenize.js";
import {
  PROJECTION_LIMITS,
  type SearchDocument,
  type SearchIndexRecord,
  type SearchMethod,
  type SearchProjection,
} from "./types.js";

/**
 * Search projection (SPEC-007 §15–27): authored pages and their h2/h3
 * sections, API services (multi-service only), groups, and operations become
 * search documents in reading order. Only fields that help discovery are
 * indexed; examples, enum values, patterns, hashes, and fenced code bodies
 * are excluded. Everything is derived from the canonical and content
 * artifacts, never from source files.
 */

export interface ProjectionInput {
  readonly artifact: DocumentationArtifact;
  readonly pages: readonly ContentPage[];
  readonly navigation: NavigationArtifact | undefined;
  /**
   * Extra searchable terms per `<service id>~<operation id>` (SPEC-008): the labels
   * of the SDKs that carry an authored example for the operation, indexed in
   * the body field so "typescript sdk create inbox" finds the operation
   * without letting SDK words outrank titles and paths. There is no
   * standalone SDK result kind: the destination is the operation's Code rail.
   */
  readonly operationTerms?: ReadonlyMap<string, readonly string[]> | undefined;
}

const GUIDES_LABEL = "Guides";
const API_LABEL = "API reference";

interface Draft {
  readonly document: Omit<SearchDocument, "id">;
  readonly record: Omit<SearchIndexRecord, "id">;
}

export function projectSearchDocuments(
  input: ProjectionInput,
): SearchProjection {
  const drafts: Draft[] = [];
  const pagesByRoute = new Map(input.pages.map((page) => [page.route, page]));
  const listed = new Set<string>();
  const entries =
    input.navigation === undefined
      ? []
      : flattenNavigation(input.navigation.items);
  let apiPlaced = false;
  const placeApi = () => {
    if (apiPlaced) return;
    apiPlaced = true;
    drafts.push(...projectApi(input.artifact, input.operationTerms));
  };
  const home = pagesByRoute.get("/");
  if (home !== undefined && !entries.some((entry) => entry.route === "/")) {
    listed.add("/");
    drafts.push(...projectPage(home, [GUIDES_LABEL]));
  }
  for (const entry of entries) {
    if (entry.kind === "api") {
      placeApi();
      continue;
    }
    const page = pagesByRoute.get(entry.route);
    if (page === undefined || listed.has(entry.route)) continue;
    listed.add(entry.route);
    drafts.push(...projectPage(page, [GUIDES_LABEL, ...entry.trail]));
  }
  // Orphans stay URL-reachable and indexable (SPEC-006), so they are searchable.
  const orphans = [...pagesByRoute.keys()]
    .filter((route) => !listed.has(route))
    .sort();
  for (const route of orphans) {
    const page = pagesByRoute.get(route);
    if (page !== undefined) drafts.push(...projectPage(page, [GUIDES_LABEL]));
  }
  placeApi();
  return {
    documents: drafts.map((draft, id) => ({ id, ...draft.document })),
    records: drafts.map((draft, id) => ({ id, ...draft.record })),
  };
}

interface SectionDraft {
  readonly title: string;
  readonly anchor: string | undefined;
  readonly parts: string[];
}

function projectPage(page: ContentPage, context: readonly string[]): Draft[] {
  const sections = splitSections(page);
  const pageText = sections.map((section) => section.parts.join(" ")).join(" ");
  const boundedContext = context.map((label) =>
    boundedText(label, PROJECTION_LIMITS.contextCharacters),
  );
  const headings = page.headings.map((heading) => heading.text).join(" ");
  const first = sections[0];
  const excerpt = boundedText(
    page.description ?? first?.parts.join(" ") ?? "",
    PROJECTION_LIMITS.excerptCharacters,
  );
  const drafts: Draft[] = [
    {
      document: {
        context: boundedContext,
        excerpt,
        group: page.route,
        kind: "page",
        route: page.route,
        title: boundedText(page.title, PROJECTION_LIMITS.titleCharacters),
      },
      record: {
        body: boundedText(
          [page.description ?? "", pageText].join(" "),
          PROJECTION_LIMITS.bodyCharacters,
        ),
        context: [...context, page.sidebarTitle ?? ""].join(" "),
        headings,
        identifiers: "",
        method: "",
        path: "",
        title: page.title,
      },
    },
  ];
  for (const section of sections) {
    if (section.anchor === undefined) continue;
    const body = boundedText(
      section.parts.join(" "),
      PROJECTION_LIMITS.sectionBodyCharacters,
    );
    drafts.push({
      document: {
        context: boundedContext,
        excerpt: boundedText(body, PROJECTION_LIMITS.excerptCharacters),
        group: page.route,
        kind: "section",
        route: `${page.route}#${section.anchor}`,
        subtitle: boundedText(page.title, PROJECTION_LIMITS.titleCharacters),
        title: boundedText(section.title, PROJECTION_LIMITS.titleCharacters),
      },
      record: {
        body,
        context: [...context, page.title].join(" "),
        headings: "",
        identifiers: "",
        method: "",
        path: "",
        title: section.title,
      },
    });
  }
  return drafts;
}

/** The page lead followed by one section per h2/h3 heading, in order. */
function splitSections(page: ContentPage): SectionDraft[] {
  const sections: SectionDraft[] = [
    { anchor: undefined, parts: [], title: page.title },
  ];
  for (const block of page.body) {
    if (block.kind === "heading" && (block.depth === 2 || block.depth === 3)) {
      sections.push({
        anchor: block.id,
        parts: [],
        title: inlineText(block.children),
      });
      continue;
    }
    const current = sections[sections.length - 1] as SectionDraft;
    const text = blockText(block);
    if (text.length > 0) current.parts.push(text);
  }
  return sections;
}

export function inlineText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
        case "code":
          return node.value;
        case "break":
          return " ";
        default:
          return inlineText(node.children);
      }
    })
    .join("");
}

/** Searchable text of a block: prose, inline code, titles and labels; fenced code bodies are excluded. */
export function blockText(block: BlockNode): string {
  switch (block.kind) {
    case "paragraph":
    case "heading":
      return inlineText(block.children);
    case "list":
      return block.items.map((item) => blocksText(item.children)).join(" ");
    case "blockquote":
      return blocksText(block.children);
    case "code":
      // Commands are one-liners developers search for ("npm install");
      // multi-line bodies are excluded so listings cannot inflate the index.
      return [block.title ?? "", singleLine(block.value)].join(" ");
    case "table":
      return [...block.header, ...block.rows.flat()].map(inlineText).join(" ");
    case "thematicBreak":
      return "";
    case "image":
      return block.alt;
    case "callout":
      return [block.title ?? "", blocksText(block.children)].join(" ");
    case "steps":
      return [
        block.title ?? "",
        ...block.steps.map(
          (step) => `${step.title} ${blocksText(step.children)}`,
        ),
      ].join(" ");
    case "cards":
      return block.cards
        .map((card) => `${card.title} ${card.description ?? ""}`)
        .join(" ");
    case "tabs":
      return block.tabs
        .map((tab) => `${tab.label} ${blocksText(tab.children)}`)
        .join(" ");
    case "codeGroup":
      return block.blocks
        .map((code) => [code.title ?? "", singleLine(code.value)].join(" "))
        .join(" ");
    case "hero":
      return [
        block.eyebrow ?? "",
        ...block.actions.map((action) => action.label),
        block.media?.caption ?? "",
      ].join(" ");
    case "media":
      return [block.alt, block.caption ?? ""].join(" ");
    case "install":
      return block.options
        .map((option) => `${option.label} ${singleLine(option.command.value)}`)
        .join(" ");
    case "startHere":
      return block.entries
        .map((entry) => `${entry.title} ${entry.description ?? ""}`)
        .join(" ");
  }
}

const SINGLE_LINE_CHARACTERS = 160;

/** A fenced block that is one short line (a command) is searchable text. */
function singleLine(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes("\n") || trimmed.length > SINGLE_LINE_CHARACTERS
    ? ""
    : trimmed;
}

function blocksText(blocks: readonly BlockNode[]): string {
  return blocks
    .map(blockText)
    .filter((text) => text.length > 0)
    .join(" ");
}

function projectApi(
  artifact: DocumentationArtifact,
  operationTerms: ReadonlyMap<string, readonly string[]> | undefined,
): Draft[] {
  const tree = buildApiRouteTree(artifact);
  const drafts: Draft[] = [];
  for (const route of tree.services) {
    const service = tree.version.services.find(
      (entry) => entry.id === route.id,
    );
    if (service === undefined) continue;
    const serviceContext = tree.singleService ? [] : [service.name];
    if (!tree.singleService) {
      drafts.push({
        document: {
          context: [API_LABEL],
          excerpt: boundedText(
            service.description ?? "",
            PROJECTION_LIMITS.excerptCharacters,
          ),
          group: route.href,
          kind: "service",
          route: route.href,
          title: boundedText(service.name, PROJECTION_LIMITS.titleCharacters),
        },
        record: {
          body: boundedText(
            service.description ?? "",
            PROJECTION_LIMITS.bodyCharacters,
          ),
          context: API_LABEL,
          headings: "",
          identifiers: "",
          method: "",
          path: "",
          title: service.name,
        },
      });
    }
    const operations = new Map<string, Operation>(
      service.operations.map((operation) => [operation.id, operation]),
    );
    for (const group of route.groups) {
      drafts.push({
        document: {
          context: [API_LABEL, ...serviceContext],
          excerpt: boundedText(
            group.description ?? "",
            PROJECTION_LIMITS.excerptCharacters,
          ),
          group: group.href,
          kind: "group",
          route: group.href,
          title: boundedText(group.name, PROJECTION_LIMITS.titleCharacters),
        },
        record: {
          body: boundedText(
            group.description ?? "",
            PROJECTION_LIMITS.bodyCharacters,
          ),
          context: [API_LABEL, ...serviceContext].join(" "),
          headings: "",
          identifiers: "",
          method: "",
          path: "",
          title: group.name,
        },
      });
      for (const entry of group.operations) {
        const operation = operations.get(entry.id);
        if (operation === undefined) continue;
        const method: SearchMethod = operation.method;
        const identifiers = operationIdentifiers(operation, service);
        const extraTerms = (
          operationTerms?.get(`${service.id}~${operation.id}`) ?? []
        ).slice(0, PROJECTION_LIMITS.identifiers);
        drafts.push({
          document: {
            context: [API_LABEL, ...serviceContext, group.name],
            ...(operation.deprecated ? { deprecated: true } : {}),
            excerpt: boundedText(
              operation.description ?? "",
              PROJECTION_LIMITS.excerptCharacters,
            ),
            group: group.href,
            kind: "operation",
            method,
            path: operation.path,
            route: entry.href,
            subtitle: `${method} ${operation.path}`,
            title: boundedText(
              operation.title,
              PROJECTION_LIMITS.titleCharacters,
            ),
          },
          record: {
            body: boundedText(
              [
                operation.description ?? "",
                ...operation.tags,
                ...extraTerms,
              ].join(" "),
              PROJECTION_LIMITS.bodyCharacters,
            ),
            context: [API_LABEL, ...serviceContext, group.name].join(" "),
            headings: "",
            identifiers: identifiers.join(" "),
            method,
            path: operation.path,
            title: operation.title,
          },
        });
      }
    }
  }
  return drafts;
}

/**
 * Names that developers search for: the contract operation id, parameter
 * names, and the top-level property names of request and response bodies
 * (references resolved one level through the service registry). Bounded so a
 * huge schema cannot inflate the index; values, examples, and enums are never
 * included.
 */
export function operationIdentifiers(
  operation: Operation,
  service: ApiService,
): readonly string[] {
  const names = new Set<string>();
  const add = (name: string) => {
    if (names.size < PROJECTION_LIMITS.identifiers && name.length > 0)
      names.add(name);
  };
  if (operation.contractId !== undefined) add(operation.contractId);
  for (const parameter of operation.parameters) add(parameter.name);
  const bodies = [
    ...(operation.requestBody?.content ?? []),
    ...operation.responses.flatMap((response) => response.bodies),
  ];
  for (const body of bodies) {
    if (body.schema === undefined) continue;
    for (const name of propertyNames(body.schema, service, 0)) add(name);
  }
  return [...names];
}

function propertyNames(
  schema: SchemaNode,
  service: ApiService,
  depth: number,
): readonly string[] {
  if (depth > 2) return [];
  switch (schema.kind) {
    case "object":
      return schema.propertyOrder;
    case "ref": {
      const target = service.schemas[schema.schemaId];
      return target === undefined
        ? []
        : propertyNames(target, service, depth + 1);
    }
    case "array":
      return propertyNames(schema.items, service, depth + 1);
    case "composition":
      return schema.variants.flatMap((variant) =>
        propertyNames(variant, service, depth + 1),
      );
    default:
      return [];
  }
}
