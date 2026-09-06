import type * as Mdast from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mdxExpressionFromMarkdown } from "mdast-util-mdx-expression";
import {
  mdxJsxFromMarkdown,
  type MdxJsxAttribute,
  type MdxJsxExpressionAttribute,
  type MdxJsxFlowElement,
  type MdxJsxTextElement,
} from "mdast-util-mdx-jsx";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { mdxExpression } from "micromark-extension-mdx-expression";
import { mdxJsx } from "micromark-extension-mdx-jsx";

import {
  createContentDiagnostic,
  sortContentDiagnostics,
  type ContentDiagnostic,
} from "./diagnostics.js";
import { parseFrontmatter, type Frontmatter } from "./frontmatter.js";
import {
  highlightCode,
  isSupportedLanguage,
  normalizeLanguage,
} from "./highlight.js";
import { isAnchor, resolveLink } from "./links.js";
import {
  anchorSlug,
  routeOf,
  slugFromSourcePath,
  uniqueAnchors,
} from "./slug.js";
import type {
  BlockNode,
  CalloutType,
  CardNode,
  CodeBlock,
  ContentHeading,
  ContentLocation,
  ContentPage,
  InlineNode,
  ListItem,
  StepNode,
  TabNode,
} from "./types.js";

/**
 * The controlled content pipeline: source bytes → parse (Markdown, GFM,
 * frontmatter, MDX component syntax without any JavaScript parser) →
 * validate (vocabulary, props, nesting, links, budgets) → normalize into the
 * Specra content model. Nothing here evaluates author text; expressions,
 * ESM, raw HTML, and unknown components are diagnostics, never code.
 */

/**
 * A tag that is not a Specra component: lowercase names are HTML elements
 * (`<div>`, `<em>`), which authored content never passes through; anything
 * else is an unknown component name.
 */
function tagDiagnostic(
  name: string | null,
): "CONTENT_COMPONENT_UNKNOWN" | "CONTENT_HTML_FORBIDDEN" {
  return name === null || /^[a-z]/.test(name)
    ? "CONTENT_HTML_FORBIDDEN"
    : "CONTENT_COMPONENT_UNKNOWN";
}

/** Counts `*` and `_` before parsing; the check is linear and cheap. */
function countEmphasisMarkers(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 42 || code === 95) count += 1;
  }
  return count;
}

export interface ContentSource {
  /** Project-relative POSIX path, e.g. `docs/getting-started/quickstart.mdx`. */
  readonly path: string;
  /** Path relative to the docs root, e.g. `getting-started/quickstart.mdx`. */
  readonly relativePath: string;
  readonly text: string;
}

export interface ContentBudgets {
  readonly maxSourceBytes: number;
  readonly maxPages: number;
  readonly maxTotalSourceBytes: number;
  readonly maxNodesPerPage: number;
  readonly maxHeadingsPerPage: number;
  readonly maxLinksPerPage: number;
  readonly maxCodeBlockCharacters: number;
  readonly maxCodeBlockLines: number;
  readonly maxHighlightedCharactersPerPage: number;
  readonly maxTableCells: number;
  readonly maxComponentDepth: number;
  readonly maxTextCharacters: number;
  /**
   * Emphasis delimiters (`*`, `_`) per page. CommonMark's attention
   * resolution is quadratic in unmatched delimiters, so a page of
   * asterisks would otherwise cost seconds per 10,000 characters.
   */
  readonly maxEmphasisMarkers: number;
}

/**
 * Defaults measured on the fixtures and the 1,000-page scale corpus
 * (`tests/performance/content-build.test.ts`); they are regression ceilings,
 * generous for real documentation and tight enough to bound a hostile file.
 */
export const DEFAULT_CONTENT_BUDGETS: ContentBudgets = {
  maxCodeBlockCharacters: 20_000,
  maxCodeBlockLines: 2_000,
  maxComponentDepth: 6,
  maxEmphasisMarkers: 8_000,
  maxHeadingsPerPage: 200,
  maxHighlightedCharactersPerPage: 200_000,
  maxLinksPerPage: 1_000,
  maxNodesPerPage: 20_000,
  maxPages: 2_000,
  maxSourceBytes: 1_000_000,
  maxTableCells: 5_000,
  maxTextCharacters: 200_000,
  maxTotalSourceBytes: 50_000_000,
};

export interface AssetReference {
  /** Docs-root-relative path of the referenced image, normalized. */
  readonly path: string;
  readonly location: ContentLocation;
}

export interface CompiledPage {
  readonly page: ContentPage;
  /** Images referenced by the page, for the build to confine and copy. */
  readonly assets: readonly AssetReference[];
}

export interface CompileOptions {
  /** Internal routes that exist outside authored content (`/api/...`). */
  readonly apiRoutes: ReadonlySet<string>;
  readonly budgets?: Partial<ContentBudgets>;
}

export interface CompileResult {
  readonly pages: readonly CompiledPage[];
  readonly diagnostics: readonly ContentDiagnostic[];
  readonly ok: boolean;
}

/** Compiles every authored source; the result is deterministic for equal input. */
export async function compileContent(
  sources: readonly ContentSource[],
  options: CompileOptions,
): Promise<CompileResult> {
  const budgets = { ...DEFAULT_CONTENT_BUDGETS, ...options.budgets };
  const diagnostics: ContentDiagnostic[] = [];
  const ordered = [...sources].sort((left, right) =>
    compare(left.relativePath, right.relativePath),
  );
  if (ordered.length > budgets.maxPages) {
    diagnostics.push(
      createContentDiagnostic("CONTENT_BUDGET_EXCEEDED", "docs"),
    );
    return { diagnostics, ok: false, pages: [] };
  }
  let totalBytes = 0;
  const drafts: Draft[] = [];
  for (const source of ordered) {
    const bytes = Buffer.byteLength(source.text, "utf8");
    totalBytes += bytes;
    if (
      bytes > budgets.maxSourceBytes ||
      totalBytes > budgets.maxTotalSourceBytes ||
      countEmphasisMarkers(source.text) > budgets.maxEmphasisMarkers
    ) {
      diagnostics.push(
        createContentDiagnostic("CONTENT_BUDGET_EXCEEDED", source.path, {
          column: 1,
          line: 1,
        }),
      );
      continue;
    }
    const draft = await compileSource(source, budgets, diagnostics);
    if (draft !== undefined) drafts.push(draft);
  }
  // Routes must be unique across pages.
  const byRoute = new Map<string, Draft>();
  for (const draft of drafts) {
    const existing = byRoute.get(draft.route);
    if (existing !== undefined) {
      diagnostics.push(
        createContentDiagnostic("ROUTE_COLLISION", draft.source.path, {
          column: 1,
          line: 1,
        }),
      );
      continue;
    }
    byRoute.set(draft.route, draft);
  }
  // Internal links resolve against the final page set and the API routes.
  for (const draft of byRoute.values()) {
    for (const link of draft.links) {
      if (link.route === undefined) {
        const target = draft;
        if (link.anchor !== undefined && !target.headingIds.has(link.anchor)) {
          diagnostics.push(
            createContentDiagnostic(
              "CONTENT_LINK_ANCHOR_MISSING",
              draft.source.path,
              link.location,
            ),
          );
        }
        continue;
      }
      const page = byRoute.get(link.route);
      const exists =
        page !== undefined ||
        link.route === "/" ||
        link.route === "/api" ||
        options.apiRoutes.has(link.route);
      if (!exists) {
        diagnostics.push(
          createContentDiagnostic(
            "CONTENT_LINK_TARGET_MISSING",
            draft.source.path,
            link.location,
          ),
        );
        continue;
      }
      if (
        link.anchor !== undefined &&
        page !== undefined &&
        !page.headingIds.has(link.anchor)
      ) {
        diagnostics.push(
          createContentDiagnostic(
            "CONTENT_LINK_ANCHOR_MISSING",
            draft.source.path,
            link.location,
          ),
        );
      }
    }
  }
  const sorted = sortContentDiagnostics(diagnostics);
  const ok = !sorted.some((diagnostic) => diagnostic.severity === "error");
  const pages = [...byRoute.values()]
    .sort((left, right) => compare(left.route, right.route))
    .map((draft) => ({ assets: draft.assets, page: draft.page }));
  return { diagnostics: sorted, ok, pages };
}

interface PendingLink {
  readonly route?: string;
  readonly anchor?: string;
  readonly location: ContentLocation;
}

interface Draft {
  readonly source: ContentSource;
  readonly route: string;
  readonly page: ContentPage;
  readonly assets: readonly AssetReference[];
  readonly links: readonly PendingLink[];
  readonly headingIds: ReadonlySet<string>;
}

async function compileSource(
  source: ContentSource,
  budgets: ContentBudgets,
  diagnostics: ContentDiagnostic[],
): Promise<Draft | undefined> {
  const path = source.path;
  const derived = slugFromSourcePath(source.relativePath);
  if (derived === undefined) {
    diagnostics.push(
      createContentDiagnostic("ROUTE_SLUG_INVALID", path, {
        column: 1,
        line: 1,
      }),
    );
    return undefined;
  }
  let tree: Mdast.Root;
  try {
    tree = fromMarkdown(source.text, {
      extensions: [frontmatter(["yaml"]), gfm(), mdxJsx(), mdxExpression()],
      mdastExtensions: [
        frontmatterFromMarkdown(["yaml"]),
        gfmFromMarkdown(),
        mdxJsxFromMarkdown(),
        mdxExpressionFromMarkdown(),
      ],
    });
  } catch (error) {
    // micromark reports the offending position on the error; only numbers are
    // read from it, never the message.
    const at =
      typeof error === "object" && error !== null
        ? (error as Record<string, unknown>)
        : {};
    diagnostics.push(
      createContentDiagnostic("CONTENT_PARSE_FAILED", path, {
        column: typeof at.column === "number" ? at.column : 1,
        line: typeof at.line === "number" ? at.line : 1,
      }),
    );
    return undefined;
  }
  const yamlNode = tree.children.find((node) => node.type === "yaml");
  const frontmatterResult = parseFrontmatter(
    yamlNode === undefined ? undefined : (yamlNode as Mdast.Yaml).value,
    path,
    1,
  );
  diagnostics.push(...frontmatterResult.diagnostics);
  const frontmatterData = frontmatterResult.frontmatter;
  const slug = frontmatterData?.slug ?? derived;
  const walker = new Walker(path, slug, budgets, diagnostics);
  const body = await walker.blocks(
    tree.children.filter((node) => node.type !== "yaml") as Mdast.RootContent[],
    0,
    "root",
  );
  walker.finish();
  if (frontmatterData === undefined) return undefined;
  const headingIds = uniqueAnchors(
    walker.headings.map((heading) => heading.slug),
  );
  const headings: ContentHeading[] = walker.headings.map((heading, index) => ({
    depth: heading.depth,
    id: headingIds[index] ?? heading.slug,
    text: heading.text,
  }));
  const withIds = assignHeadingIds(body, headingIds);
  const page: ContentPage = {
    body: withIds,
    headings,
    id: slug,
    route: routeOf(slug),
    slug,
    sourcePath: path,
    text: walker.text.slice(0, budgets.maxTextCharacters),
    title: frontmatterData.title,
    ...(frontmatterData.description === undefined
      ? {}
      : { description: frontmatterData.description }),
    ...(frontmatterData.sidebarTitle === undefined
      ? {}
      : { sidebarTitle: frontmatterData.sidebarTitle }),
  };
  return {
    assets: walker.assets,
    headingIds: new Set(headingIds),
    links: walker.links,
    page,
    route: page.route,
    source,
  };
}

/** Rewrites heading ids in document order after de-duplication. */
function assignHeadingIds(
  blocks: readonly BlockNode[],
  ids: readonly string[],
): readonly BlockNode[] {
  let index = 0;
  const visit = (nodes: readonly BlockNode[]): readonly BlockNode[] =>
    nodes.map((node): BlockNode => {
      switch (node.kind) {
        case "heading": {
          const id = ids[index] ?? node.id;
          index += 1;
          return { ...node, id };
        }
        case "blockquote":
          return { ...node, children: visit(node.children) };
        case "callout":
          return { ...node, children: visit(node.children) };
        case "list":
          return {
            ...node,
            items: node.items.map((item) => ({
              ...item,
              children: visit(item.children),
            })),
          };
        case "steps":
          return {
            ...node,
            steps: node.steps.map((step) => ({
              ...step,
              children: visit(step.children),
            })),
          };
        case "tabs":
          return {
            ...node,
            tabs: node.tabs.map((tab) => ({
              ...tab,
              children: visit(tab.children),
            })),
          };
        default:
          return node;
      }
    });
  return visit(blocks);
}

type Container = "blockquote" | "callout" | "list" | "root" | "step" | "tab";

/** The subset of unist positions the compiler reads. */
interface Positioned {
  readonly position?:
    | { readonly start: { readonly line: number; readonly column: number } }
    | undefined;
}

const COMPONENTS = new Set([
  "Callout",
  "Card",
  "Cards",
  "CodeGroup",
  "Step",
  "Steps",
  "Tab",
  "Tabs",
]);
const CALLOUT_TYPES = new Set<CalloutType>([
  "danger",
  "note",
  "tip",
  "warning",
]);
const MAX_LABEL_LENGTH = 120;
const MAX_TABS = 12;

/** One page's traversal state: counters, collected metadata, and diagnostics. */
class Walker {
  public readonly headings: {
    readonly depth: 2 | 3 | 4 | 5 | 6;
    readonly slug: string;
    readonly text: string;
  }[] = [];
  public readonly links: PendingLink[] = [];
  public readonly assets: AssetReference[] = [];
  public text = "";
  private nodes = 0;
  private linkCount = 0;
  private highlighted = 0;
  private lastHeadingDepth = 1;
  private budgetReported = false;

  public constructor(
    private readonly path: string,
    private readonly slug: string,
    private readonly budgets: ContentBudgets,
    private readonly diagnostics: ContentDiagnostic[],
  ) {}

  public finish(): void {
    if (this.headings.length > this.budgets.maxHeadingsPerPage) {
      this.budget({ column: 1, line: 1 });
    }
  }

  public async blocks(
    nodes: readonly Mdast.RootContent[],
    depth: number,
    container: Container,
  ): Promise<readonly BlockNode[]> {
    const result: BlockNode[] = [];
    for (const node of nodes) {
      const block = await this.block(node, depth, container);
      if (block !== undefined) result.push(block);
    }
    return result;
  }

  private count(node: Positioned): boolean {
    this.nodes += 1;
    if (this.nodes > this.budgets.maxNodesPerPage) {
      this.budget(locationOf(node));
      return false;
    }
    return true;
  }

  private budget(location: ContentLocation): void {
    if (this.budgetReported) return;
    this.budgetReported = true;
    this.diagnostics.push(
      createContentDiagnostic("CONTENT_BUDGET_EXCEEDED", this.path, location),
    );
  }

  private report(
    code: Parameters<typeof createContentDiagnostic>[0],
    node: Positioned,
  ): undefined {
    this.diagnostics.push(
      createContentDiagnostic(code, this.path, locationOf(node)),
    );
    return undefined;
  }

  private async block(
    node: Mdast.RootContent,
    depth: number,
    container: Container,
  ): Promise<BlockNode | undefined> {
    if (!this.count(node)) return undefined;
    switch (node.type) {
      case "paragraph": {
        if (isEsmParagraph(node)) {
          return this.report("CONTENT_ESM_FORBIDDEN", node);
        }
        const only = node.children.length === 1 ? node.children[0] : undefined;
        if (only?.type === "image") {
          return this.image(only);
        }
        return { children: this.inlines(node.children), kind: "paragraph" };
      }
      case "heading": {
        if (node.depth === 1) {
          this.report("CONTENT_HEADING_H1", node);
          return undefined;
        }
        if (node.depth > this.lastHeadingDepth + 1) {
          this.diagnostics.push(
            createContentDiagnostic(
              "CONTENT_HEADING_SKIPPED",
              this.path,
              locationOf(node),
            ),
          );
        }
        this.lastHeadingDepth = node.depth;
        const children = this.inlines(node.children);
        const text = plainText(children);
        const slug = anchorSlug(text);
        this.headings.push({ depth: node.depth, slug, text });
        this.text += `${text}\n`;
        return { children, depth: node.depth, id: slug, kind: "heading" };
      }
      case "list": {
        const items: ListItem[] = [];
        for (const item of node.children) {
          if (!this.count(item)) break;
          items.push({
            ...(item.checked === null || item.checked === undefined
              ? {}
              : { checked: item.checked }),
            children: await this.blocks(item.children, depth, "list"),
          });
        }
        return {
          items,
          kind: "list",
          ordered: node.ordered === true,
          ...(node.ordered === true &&
          node.start !== null &&
          node.start !== undefined &&
          node.start !== 1
            ? { start: node.start }
            : {}),
        };
      }
      case "blockquote":
        return {
          children: await this.blocks(node.children, depth, "blockquote"),
          kind: "blockquote",
        };
      case "code":
        return await this.code(node);
      case "table":
        return this.table(node);
      case "thematicBreak":
        return { kind: "thematicBreak" };
      case "html":
        return this.report("CONTENT_HTML_FORBIDDEN", node);
      case "mdxFlowExpression":
        return this.report("CONTENT_EXPRESSION_FORBIDDEN", node);
      case "mdxJsxFlowElement":
        return await this.component(node, depth, container);
      case "definition":
      case "footnoteDefinition":
      case "yaml":
        return this.report("CONTENT_UNSUPPORTED", node);
      default:
        return this.report("CONTENT_UNSUPPORTED", node);
    }
  }

  private inlines(
    nodes: readonly Mdast.PhrasingContent[],
  ): readonly InlineNode[] {
    const result: InlineNode[] = [];
    for (const node of nodes) {
      const inline = this.inline(node);
      if (inline !== undefined) result.push(inline);
    }
    return result;
  }

  private inline(node: Mdast.PhrasingContent): InlineNode | undefined {
    if (!this.count(node)) return undefined;
    switch (node.type) {
      case "text":
        this.text += node.value;
        return { kind: "text", value: node.value };
      case "emphasis":
        return { children: this.inlines(node.children), kind: "emphasis" };
      case "strong":
        return { children: this.inlines(node.children), kind: "strong" };
      case "delete":
        return { children: this.inlines(node.children), kind: "delete" };
      case "inlineCode":
        this.text += node.value;
        return { kind: "code", value: node.value };
      case "break":
        return { kind: "break" };
      case "link":
        return this.link(node);
      case "image":
        // Inline images inside text are not part of the model; block images are.
        return this.report("CONTENT_UNSUPPORTED", node);
      case "html":
        return this.report("CONTENT_HTML_FORBIDDEN", node);
      case "mdxTextExpression":
        return this.report("CONTENT_EXPRESSION_FORBIDDEN", node);
      case "mdxJsxTextElement":
        // Components are block-level; an inline tag is either an HTML-like
        // element (forbidden), an unknown name, or a misplaced component.
        return this.report(
          node.name !== null && COMPONENTS.has(node.name)
            ? "CONTENT_COMPONENT_NESTING_INVALID"
            : tagDiagnostic(node.name),
          node,
        );
      case "footnoteReference":
      case "imageReference":
      case "linkReference":
        return this.report("CONTENT_UNSUPPORTED", node);
      default:
        return this.report("CONTENT_UNSUPPORTED", node);
    }
  }

  private link(node: Mdast.Link): InlineNode | undefined {
    this.linkCount += 1;
    if (this.linkCount > this.budgets.maxLinksPerPage) {
      this.budget(locationOf(node));
      return undefined;
    }
    const resolved = resolveLink(node.url, this.slug);
    if (resolved === undefined) {
      return this.report("CONTENT_LINK_SCHEME_FORBIDDEN", node);
    }
    if (
      resolved.target === "page" ||
      resolved.target === "api" ||
      resolved.target === "anchor"
    ) {
      this.links.push({
        ...(resolved.anchor === undefined ? {} : { anchor: resolved.anchor }),
        location: locationOf(node),
        ...(resolved.route === undefined ? {} : { route: resolved.route }),
      });
    }
    return {
      children: this.inlines(node.children),
      href: resolved.href,
      kind: "link",
      target: resolved.target,
    };
  }

  private image(node: Mdast.Image): BlockNode | undefined {
    const reference = assetPath(node.url);
    if (reference === undefined) {
      return this.report("CONTENT_ASSET_INVALID", node);
    }
    const alt = (node.alt ?? "").trim();
    this.assets.push({ location: locationOf(node), path: reference });
    // The build replaces `src` with the copied asset name; until then the
    // docs-relative path is kept so the reference stays traceable.
    return { alt, kind: "image", src: reference };
  }

  private async code(node: Mdast.Code): Promise<BlockNode | undefined> {
    if (
      node.value.length > this.budgets.maxCodeBlockCharacters ||
      node.value.split("\n").length > this.budgets.maxCodeBlockLines
    ) {
      this.budget(locationOf(node));
      return undefined;
    }
    const block = await this.codeBlock(node);
    return block;
  }

  private async codeBlock(node: Mdast.Code): Promise<CodeBlock | undefined> {
    const rawLanguage = node.lang ?? undefined;
    if (!isSupportedLanguage(rawLanguage)) {
      // Unknown languages render as plain text; the fence still works.
    }
    const language = normalizeLanguage(rawLanguage);
    const title = titleFromMeta(node.meta ?? undefined);
    if (title === null) {
      return this.report("CONTENT_COMPONENT_PROP_INVALID", node);
    }
    this.highlighted += node.value.length;
    const lines =
      this.highlighted > this.budgets.maxHighlightedCharactersPerPage
        ? node.value
            .split("\n")
            .map((text) => (text.length === 0 ? [] : [{ text }]))
        : await highlightCode(node.value, language);
    this.text += `${node.value}\n`;
    return {
      kind: "code",
      ...(language === undefined ? {} : { language }),
      lines,
      ...(title === undefined ? {} : { title }),
      value: node.value,
    };
  }

  private table(node: Mdast.Table): BlockNode | undefined {
    const rows = node.children;
    const cells = rows.reduce((total, row) => total + row.children.length, 0);
    if (cells > this.budgets.maxTableCells) {
      this.budget(locationOf(node));
      return undefined;
    }
    const [head, ...body] = rows;
    if (head === undefined) return this.report("CONTENT_UNSUPPORTED", node);
    return {
      align: (node.align ?? []).map((value) => value ?? null),
      header: head.children.map((cell) => this.inlines(cell.children)),
      kind: "table",
      rows: body.map((row) =>
        row.children.map((cell) => this.inlines(cell.children)),
      ),
    };
  }

  private async component(
    node: MdxJsxFlowElement,
    depth: number,
    container: Container,
  ): Promise<BlockNode | undefined> {
    if (node.name === null || !COMPONENTS.has(node.name)) {
      return this.report(tagDiagnostic(node.name), node);
    }
    if (depth >= this.budgets.maxComponentDepth) {
      this.budget(locationOf(node));
      return undefined;
    }
    const props = this.props(node);
    if (props === undefined) return undefined;
    switch (node.name) {
      case "Callout": {
        const type = props.get("type") ?? "note";
        const title = props.get("title");
        if (
          !CALLOUT_TYPES.has(type as CalloutType) ||
          !allowed(props, ["title", "type"])
        ) {
          return this.report("CONTENT_COMPONENT_PROP_INVALID", node);
        }
        if (title !== undefined) this.text += `${title}\n`;
        return {
          children: await this.blocks(node.children, depth + 1, "callout"),
          kind: "callout",
          ...(title === undefined ? {} : { title }),
          type: type as CalloutType,
        };
      }
      case "Steps": {
        if (!allowed(props, []))
          return this.report("CONTENT_COMPONENT_PROP_INVALID", node);
        const steps: StepNode[] = [];
        for (const child of node.children) {
          if (!isElement(child, "Step")) {
            if (isBlank(child)) continue;
            return this.report("CONTENT_COMPONENT_NESTING_INVALID", child);
          }
          const stepProps = this.props(child);
          if (stepProps === undefined) return undefined;
          const title = stepProps.get("title");
          if (title === undefined || !allowed(stepProps, ["title"])) {
            return this.report("CONTENT_COMPONENT_PROP_INVALID", child);
          }
          this.text += `${title}\n`;
          steps.push({
            children: await this.blocks(child.children, depth + 1, "step"),
            title,
          });
        }
        if (steps.length === 0)
          return this.report("CONTENT_COMPONENT_NESTING_INVALID", node);
        return { kind: "steps", steps };
      }
      case "Cards": {
        if (!allowed(props, []))
          return this.report("CONTENT_COMPONENT_PROP_INVALID", node);
        const cards: CardNode[] = [];
        for (const child of node.children) {
          if (!isElement(child, "Card")) {
            if (isBlank(child)) continue;
            return this.report("CONTENT_COMPONENT_NESTING_INVALID", child);
          }
          const cardProps = this.props(child);
          if (cardProps === undefined) return undefined;
          const title = cardProps.get("title");
          const href = cardProps.get("href");
          const description = cardProps.get("description");
          if (
            title === undefined ||
            href === undefined ||
            !allowed(cardProps, ["description", "href", "title"]) ||
            child.children.some((grandchild) => !isBlank(grandchild))
          ) {
            return this.report("CONTENT_COMPONENT_PROP_INVALID", child);
          }
          const resolved = resolveLink(href, this.slug);
          if (resolved === undefined) {
            return this.report("CONTENT_LINK_SCHEME_FORBIDDEN", child);
          }
          if (resolved.target === "page" || resolved.target === "api") {
            this.links.push({
              ...(resolved.anchor === undefined
                ? {}
                : { anchor: resolved.anchor }),
              location: locationOf(child),
              ...(resolved.route === undefined
                ? {}
                : { route: resolved.route }),
            });
          }
          this.text += `${title}\n${description ?? ""}\n`;
          cards.push({
            ...(description === undefined ? {} : { description }),
            href: resolved.href,
            target: resolved.target,
            title,
          });
        }
        if (cards.length === 0)
          return this.report("CONTENT_COMPONENT_NESTING_INVALID", node);
        return { cards, kind: "cards" };
      }
      case "Tabs": {
        if (!allowed(props, []))
          return this.report("CONTENT_COMPONENT_PROP_INVALID", node);
        const tabs: TabNode[] = [];
        const labels = new Set<string>();
        for (const child of node.children) {
          if (!isElement(child, "Tab")) {
            if (isBlank(child)) continue;
            return this.report("CONTENT_COMPONENT_NESTING_INVALID", child);
          }
          const tabProps = this.props(child);
          if (tabProps === undefined) return undefined;
          const label = tabProps.get("label");
          if (
            label === undefined ||
            !allowed(tabProps, ["label"]) ||
            labels.has(label)
          ) {
            return this.report("CONTENT_COMPONENT_PROP_INVALID", child);
          }
          labels.add(label);
          if (tabs.length >= MAX_TABS)
            return this.report("CONTENT_COMPONENT_PROP_INVALID", child);
          this.text += `${label}\n`;
          tabs.push({
            children: await this.blocks(child.children, depth + 1, "tab"),
            label,
          });
        }
        if (tabs.length === 0)
          return this.report("CONTENT_COMPONENT_NESTING_INVALID", node);
        return { kind: "tabs", tabs };
      }
      case "CodeGroup": {
        if (!allowed(props, []))
          return this.report("CONTENT_COMPONENT_PROP_INVALID", node);
        const blocks: CodeBlock[] = [];
        const labels = new Set<string>();
        for (const child of node.children) {
          if (child.type !== "code") {
            if (isBlank(child)) continue;
            return this.report("CONTENT_COMPONENT_NESTING_INVALID", child);
          }
          if (!this.count(child)) return undefined;
          const block = await this.code(child);
          if (block === undefined || block.kind !== "code") return undefined;
          const label = block.title ?? block.language ?? "text";
          if (labels.has(label) || blocks.length >= MAX_TABS) {
            return this.report("CONTENT_COMPONENT_PROP_INVALID", child);
          }
          labels.add(label);
          blocks.push(block);
        }
        if (blocks.length === 0)
          return this.report("CONTENT_COMPONENT_NESTING_INVALID", node);
        return { blocks, kind: "codeGroup" };
      }
      case "Step":
      case "Card":
      case "Tab":
        // Only valid inside their parent; reaching here means they were not.
        void container;
        return this.report("CONTENT_COMPONENT_NESTING_INVALID", node);
      default:
        return this.report("CONTENT_COMPONENT_UNKNOWN", node);
    }
  }

  /** String attributes only; expressions and spreads are rejected. */
  private props(
    node: MdxJsxFlowElement | MdxJsxTextElement,
  ): Map<string, string> | undefined {
    const props = new Map<string, string>();
    for (const attribute of node.attributes as readonly (
      MdxJsxAttribute | MdxJsxExpressionAttribute
    )[]) {
      if (attribute.type !== "mdxJsxAttribute") {
        this.report("CONTENT_EXPRESSION_FORBIDDEN", node);
        return undefined;
      }
      const value = attribute.value;
      if (typeof value !== "string" && value !== null && value !== undefined) {
        this.report("CONTENT_EXPRESSION_FORBIDDEN", node);
        return undefined;
      }
      const text = value === null || value === undefined ? "" : value;
      if (
        props.has(attribute.name) ||
        text.length > MAX_LABEL_LENGTH ||
        /[\p{Cc}]/u.test(text)
      ) {
        this.report("CONTENT_COMPONENT_PROP_INVALID", node);
        return undefined;
      }
      props.set(attribute.name, text.trim());
    }
    return props;
  }
}

function allowed(
  props: ReadonlyMap<string, string>,
  names: readonly string[],
): boolean {
  const permitted = new Set(names);
  for (const [name, value] of props) {
    if (!permitted.has(name)) return false;
    if (value.length === 0 && name !== "description") return false;
  }
  return true;
}

function isElement(
  node: Mdast.RootContent,
  name: string,
): node is MdxJsxFlowElement {
  return node.type === "mdxJsxFlowElement" && node.name === name;
}

/** Whitespace-only text between components is not content. */
function isBlank(node: Mdast.RootContent): boolean {
  return (
    node.type === "paragraph" &&
    node.children.every(
      (child) => child.type === "text" && child.value.trim().length === 0,
    )
  );
}

const ESM_LINE = /^(?:import|export)\s/;

function isEsmParagraph(node: Mdast.Paragraph): boolean {
  const first = node.children[0];
  return (
    first?.type === "text" &&
    node.position?.start.column === 1 &&
    ESM_LINE.test(first.value)
  );
}

/** `title="…"` is the only fence attribute; anything else is invalid. */
function titleFromMeta(meta: string | undefined): string | undefined | null {
  if (meta === undefined || meta.trim().length === 0) return undefined;
  const match = /^title="([^"\n]{1,120})"$/.exec(meta.trim());
  if (match?.[1] === undefined) return null;
  return match[1];
}

/**
 * Page-relative asset path from an image URL. Only relative forms are kept;
 * `..` segments survive so the build can resolve them against the page's
 * directory and confine the result to the documentation root.
 */
function assetPath(url: string): string | undefined {
  if (url.length === 0 || url.length > 512) return undefined;
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(url) ||
    url.startsWith("/") ||
    url.startsWith("\\")
  ) {
    return undefined;
  }
  if (url.includes("?") || url.includes("#") || /[\s\0]/.test(url)) {
    return undefined;
  }
  const segments = url
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.every((segment) => segment === "..")) {
    return undefined;
  }
  return segments.join("/");
}

function plainText(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
        case "code":
          return node.value;
        case "break":
          return " ";
        default:
          return plainText(node.children);
      }
    })
    .join("");
}

function locationOf(node: Positioned): ContentLocation {
  return {
    column: node.position?.start.column ?? 1,
    line: node.position?.start.line ?? 1,
  };
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export type { Frontmatter };
export { isAnchor };
