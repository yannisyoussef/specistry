import { isAnchor, isInternalRoute } from "./links.js";
import { isRouteSlug } from "./slug.js";
import {
  CONTENT_FORMAT_VERSION,
  NAVIGATION_FORMAT_VERSION,
  type BlockNode,
  type CodeBlock,
  type CodeToken,
  type CodeTokenClass,
  type ContentArtifact,
  type ContentPage,
  type InlineNode,
  type MediaNode,
  type NavigationArtifact,
  type NavigationNode,
} from "./types.js";

/**
 * Artifact contract for `content.json` and `navigation.json`. Serialization
 * is deterministic (recursively sorted keys, two-space indentation) and
 * parsing is strict: every node kind, key, and value is checked so the reader
 * can trust the shape without re-validating during rendering.
 */

export const ARTIFACT_CONTENT_FILENAME = "content.json";
export const ARTIFACT_NAVIGATION_FILENAME = "navigation.json";
export const ARTIFACT_ASSETS_DIRECTORY = "assets";

const MAX_ARTIFACT_BYTES = 200 * 1_024 * 1_024;
const MAX_DEPTH = 64;

export function serializeContentArtifact(artifact: ContentArtifact): string {
  return `${JSON.stringify(sortKeys(artifact), null, 2)}\n`;
}

export function serializeNavigationArtifact(
  artifact: NavigationArtifact,
): string {
  return `${JSON.stringify(sortKeys(artifact), null, 2)}\n`;
}

export class ContentArtifactError extends TypeError {
  public constructor(
    message: string,
    public readonly path: string,
  ) {
    super(`${message} (at ${path})`);
    this.name = "ContentArtifactError";
  }
}

export function parseContentArtifact(text: string): ContentArtifact {
  const value = parseJson(text);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["contentVersion", "pages"]) ||
    value.contentVersion !== CONTENT_FORMAT_VERSION ||
    !Array.isArray(value.pages)
  ) {
    throw new ContentArtifactError(
      "Content artifact shape is not recognized.",
      "/",
    );
  }
  const routes = new Set<string>();
  const pages = value.pages.map((page, index) => {
    const parsed = parsePage(page, `/pages/${index}`);
    if (routes.has(parsed.route)) {
      throw new ContentArtifactError(
        "Duplicate page route.",
        `/pages/${index}`,
      );
    }
    routes.add(parsed.route);
    return parsed;
  });
  return { contentVersion: CONTENT_FORMAT_VERSION, pages };
}

export function parseNavigationArtifact(text: string): NavigationArtifact {
  const value = parseJson(text);
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["items", "navigationVersion"]) ||
    value.navigationVersion !== NAVIGATION_FORMAT_VERSION ||
    !Array.isArray(value.items)
  ) {
    throw new ContentArtifactError(
      "Navigation artifact shape is not recognized.",
      "/",
    );
  }
  return {
    items: value.items.map((item, index) =>
      parseNavigationNode(item, `/items/${index}`, 0),
    ),
    navigationVersion: NAVIGATION_FORMAT_VERSION,
  };
}

function parseJson(text: string): unknown {
  if (Buffer.byteLength(text, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new ContentArtifactError("Artifact exceeds the size ceiling.", "/");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ContentArtifactError("Artifact is not valid JSON.", "/");
  }
}

function parsePage(value: unknown, path: string): ContentPage {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "body",
      "description",
      "headings",
      "id",
      "route",
      "sidebarTitle",
      "slug",
      "sourcePath",
      "text",
      "title",
    ])
  ) {
    throw new ContentArtifactError("Page shape is not recognized.", path);
  }
  const slug = requireString(value.slug, `${path}/slug`, true);
  if (!isRouteSlug(slug))
    throw new ContentArtifactError("Invalid slug.", `${path}/slug`);
  const route = requireString(value.route, `${path}/route`);
  if (!isInternalRoute(route) || route.startsWith("/api")) {
    throw new ContentArtifactError("Invalid route.", `${path}/route`);
  }
  if (value.id !== slug)
    throw new ContentArtifactError("Id must equal the slug.", `${path}/id`);
  if (!Array.isArray(value.headings) || !Array.isArray(value.body)) {
    throw new ContentArtifactError("Headings and body must be lists.", path);
  }
  const headings = value.headings.map((heading, index) => {
    const at = `${path}/headings/${index}`;
    if (!isRecord(heading) || !hasOnlyKeys(heading, ["depth", "id", "text"])) {
      throw new ContentArtifactError("Heading shape is not recognized.", at);
    }
    const depth = heading.depth;
    if (!isDepth(depth))
      throw new ContentArtifactError("Invalid heading depth.", at);
    const id = requireString(heading.id, `${at}/id`);
    if (!isAnchor(id))
      throw new ContentArtifactError("Invalid heading id.", `${at}/id`);
    return { depth, id, text: requireString(heading.text, `${at}/text`, true) };
  });
  return {
    body: value.body.map((node, index) =>
      parseBlock(node, `${path}/body/${index}`, 0),
    ),
    headings,
    id: slug,
    route,
    slug,
    sourcePath: requireString(value.sourcePath, `${path}/sourcePath`),
    text: requireString(value.text, `${path}/text`, true),
    title: requireString(value.title, `${path}/title`),
    ...(value.description === undefined
      ? {}
      : {
          description: requireString(value.description, `${path}/description`),
        }),
    ...(value.sidebarTitle === undefined
      ? {}
      : {
          sidebarTitle: requireString(
            value.sidebarTitle,
            `${path}/sidebarTitle`,
          ),
        }),
  };
}

function parseBlock(value: unknown, path: string, depth: number): BlockNode {
  if (depth > MAX_DEPTH)
    throw new ContentArtifactError("Content nests too deeply.", path);
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new ContentArtifactError("Block shape is not recognized.", path);
  }
  const blocks = (items: unknown, at: string): readonly BlockNode[] => {
    if (!Array.isArray(items))
      throw new ContentArtifactError("Expected a block list.", at);
    return items.map((item, index) =>
      parseBlock(item, `${at}/${index}`, depth + 1),
    );
  };
  const inlines = (items: unknown, at: string): readonly InlineNode[] => {
    if (!Array.isArray(items))
      throw new ContentArtifactError("Expected an inline list.", at);
    return items.map((item, index) => parseInline(item, `${at}/${index}`, 0));
  };
  switch (value.kind) {
    case "paragraph":
      only(value, ["children", "kind"], path);
      return {
        children: inlines(value.children, `${path}/children`),
        kind: "paragraph",
      };
    case "heading": {
      only(value, ["children", "depth", "id", "kind"], path);
      if (!isDepth(value.depth))
        throw new ContentArtifactError("Invalid heading depth.", path);
      const id = requireString(value.id, `${path}/id`);
      if (!isAnchor(id))
        throw new ContentArtifactError("Invalid heading id.", `${path}/id`);
      return {
        children: inlines(value.children, `${path}/children`),
        depth: value.depth,
        id,
        kind: "heading",
      };
    }
    case "list": {
      only(value, ["items", "kind", "ordered", "start"], path);
      if (typeof value.ordered !== "boolean" || !Array.isArray(value.items)) {
        throw new ContentArtifactError("Invalid list.", path);
      }
      if (value.start !== undefined && !Number.isSafeInteger(value.start)) {
        throw new ContentArtifactError("Invalid list start.", `${path}/start`);
      }
      return {
        items: value.items.map((item, index) => {
          const at = `${path}/items/${index}`;
          if (!isRecord(item) || !hasOnlyKeys(item, ["checked", "children"])) {
            throw new ContentArtifactError("Invalid list item.", at);
          }
          if (item.checked !== undefined && typeof item.checked !== "boolean") {
            throw new ContentArtifactError("Invalid list item.", at);
          }
          return {
            ...(item.checked === undefined ? {} : { checked: item.checked }),
            children: blocks(item.children, `${at}/children`),
          };
        }),
        kind: "list",
        ordered: value.ordered,
        ...(value.start === undefined ? {} : { start: value.start as number }),
      };
    }
    case "blockquote":
      only(value, ["children", "kind"], path);
      return {
        children: blocks(value.children, `${path}/children`),
        kind: "blockquote",
      };
    case "code":
      return parseCode(value, path);
    case "table": {
      only(value, ["align", "header", "kind", "rows"], path);
      if (
        !Array.isArray(value.align) ||
        !Array.isArray(value.header) ||
        !Array.isArray(value.rows)
      ) {
        throw new ContentArtifactError("Invalid table.", path);
      }
      const align = value.align.map((entry) => {
        if (
          entry !== null &&
          entry !== "left" &&
          entry !== "center" &&
          entry !== "right"
        ) {
          throw new ContentArtifactError(
            "Invalid table alignment.",
            `${path}/align`,
          );
        }
        return entry;
      });
      const row = (cells: unknown, at: string) => {
        if (!Array.isArray(cells))
          throw new ContentArtifactError("Invalid table row.", at);
        return cells.map((cell, index) => inlines(cell, `${at}/${index}`));
      };
      return {
        align,
        header: row(value.header, `${path}/header`),
        kind: "table",
        rows: value.rows.map((cells, index) =>
          row(cells, `${path}/rows/${index}`),
        ),
      };
    }
    case "thematicBreak":
      only(value, ["kind"], path);
      return { kind: "thematicBreak" };
    case "image": {
      only(value, ["alt", "kind", "src"], path);
      const src = requireString(value.src, `${path}/src`);
      if (!/^assets\/[a-f0-9]{16}\.(?:png|jpg|webp|gif)$/.test(src)) {
        throw new ContentArtifactError(
          "Invalid asset reference.",
          `${path}/src`,
        );
      }
      return {
        alt: requireString(value.alt, `${path}/alt`, true),
        kind: "image",
        src,
      };
    }
    case "callout": {
      only(value, ["children", "kind", "title", "type"], path);
      if (
        value.type !== "note" &&
        value.type !== "tip" &&
        value.type !== "warning" &&
        value.type !== "danger"
      ) {
        throw new ContentArtifactError("Invalid callout type.", `${path}/type`);
      }
      return {
        children: blocks(value.children, `${path}/children`),
        kind: "callout",
        ...(value.title === undefined
          ? {}
          : { title: requireString(value.title, `${path}/title`) }),
        type: value.type,
      };
    }
    case "steps": {
      only(value, ["kind", "steps", "title", "variant"], path);
      if (!Array.isArray(value.steps))
        throw new ContentArtifactError("Invalid steps.", path);
      if (value.variant !== undefined && value.variant !== "strip") {
        throw new ContentArtifactError("Invalid steps variant.", path);
      }
      return {
        kind: "steps",
        ...(value.title === undefined
          ? {}
          : { title: requireString(value.title, `${path}/title`) }),
        ...(value.variant === undefined ? {} : { variant: "strip" as const }),
        steps: value.steps.map((step, index) => {
          const at = `${path}/steps/${index}`;
          if (!isRecord(step) || !hasOnlyKeys(step, ["children", "title"])) {
            throw new ContentArtifactError("Invalid step.", at);
          }
          return {
            children: blocks(step.children, `${at}/children`),
            title: requireString(step.title, `${at}/title`),
          };
        }),
      };
    }
    case "hero": {
      only(value, ["actions", "eyebrow", "kind", "media"], path);
      if (!Array.isArray(value.actions))
        throw new ContentArtifactError("Invalid hero.", path);
      return {
        actions: value.actions.map((action, index) => {
          const at = `${path}/actions/${index}`;
          if (
            !isRecord(action) ||
            !hasOnlyKeys(action, ["href", "label", "target", "variant"]) ||
            (action.variant !== "primary" && action.variant !== "secondary")
          ) {
            throw new ContentArtifactError("Invalid action.", at);
          }
          return {
            href: requireString(action.href, `${at}/href`),
            label: requireString(action.label, `${at}/label`),
            target: parseTarget(action.target, `${at}/target`),
            variant: action.variant,
          };
        }),
        ...(value.eyebrow === undefined
          ? {}
          : { eyebrow: requireString(value.eyebrow, `${path}/eyebrow`) }),
        kind: "hero",
        ...(value.media === undefined
          ? {}
          : { media: parseMedia(value.media, `${path}/media`) }),
      };
    }
    case "media":
      return parseMedia(value, path);
    case "install": {
      only(value, ["kind", "options"], path);
      if (!Array.isArray(value.options))
        throw new ContentArtifactError("Invalid install block.", path);
      return {
        kind: "install",
        options: value.options.map((option, index) => {
          const at = `${path}/options/${index}`;
          if (
            !isRecord(option) ||
            !hasOnlyKeys(option, ["command", "label", "sample"])
          ) {
            throw new ContentArtifactError("Invalid install option.", at);
          }
          return {
            command: parseCode(option.command, `${at}/command`),
            label: requireString(option.label, `${at}/label`),
            ...(option.sample === undefined
              ? {}
              : { sample: parseCode(option.sample, `${at}/sample`) }),
          };
        }),
      };
    }
    case "startHere": {
      only(value, ["entries", "kind"], path);
      if (!Array.isArray(value.entries))
        throw new ContentArtifactError("Invalid start-here block.", path);
      return {
        entries: value.entries.map((entry, index) => {
          const at = `${path}/entries/${index}`;
          if (
            !isRecord(entry) ||
            !hasOnlyKeys(entry, [
              "description",
              "href",
              "meta",
              "target",
              "title",
            ])
          ) {
            throw new ContentArtifactError("Invalid start-here entry.", at);
          }
          return {
            ...(entry.description === undefined
              ? {}
              : {
                  description: requireString(
                    entry.description,
                    `${at}/description`,
                  ),
                }),
            href: requireString(entry.href, `${at}/href`),
            ...(entry.meta === undefined
              ? {}
              : { meta: requireString(entry.meta, `${at}/meta`) }),
            target: parseTarget(entry.target, `${at}/target`),
            title: requireString(entry.title, `${at}/title`),
          };
        }),
        kind: "startHere",
      };
    }
    case "cards": {
      only(value, ["cards", "kind"], path);
      if (!Array.isArray(value.cards))
        throw new ContentArtifactError("Invalid cards.", path);
      return {
        cards: value.cards.map((card, index) => {
          const at = `${path}/cards/${index}`;
          if (
            !isRecord(card) ||
            !hasOnlyKeys(card, ["description", "href", "target", "title"])
          ) {
            throw new ContentArtifactError("Invalid card.", at);
          }
          return {
            ...(card.description === undefined
              ? {}
              : {
                  description: requireString(
                    card.description,
                    `${at}/description`,
                  ),
                }),
            href: requireString(card.href, `${at}/href`),
            target: parseTarget(card.target, `${at}/target`),
            title: requireString(card.title, `${at}/title`),
          };
        }),
        kind: "cards",
      };
    }
    case "tabs": {
      only(value, ["kind", "tabs"], path);
      if (!Array.isArray(value.tabs))
        throw new ContentArtifactError("Invalid tabs.", path);
      return {
        kind: "tabs",
        tabs: value.tabs.map((tab, index) => {
          const at = `${path}/tabs/${index}`;
          if (!isRecord(tab) || !hasOnlyKeys(tab, ["children", "label"])) {
            throw new ContentArtifactError("Invalid tab.", at);
          }
          return {
            children: blocks(tab.children, `${at}/children`),
            label: requireString(tab.label, `${at}/label`),
          };
        }),
      };
    }
    case "codeGroup": {
      only(value, ["blocks", "kind"], path);
      if (!Array.isArray(value.blocks))
        throw new ContentArtifactError("Invalid code group.", path);
      return {
        blocks: value.blocks.map((block, index) =>
          parseCode(block, `${path}/blocks/${index}`),
        ),
        kind: "codeGroup",
      };
    }
    default:
      throw new ContentArtifactError("Unknown block kind.", path);
  }
}

function parseMedia(value: unknown, path: string): MediaNode {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "alt",
      "caption",
      "duration",
      "kind",
      "link",
      "poster",
    ]) ||
    value.kind !== "media"
  ) {
    throw new ContentArtifactError("Invalid media block.", path);
  }
  const poster = requireString(value.poster, `${path}/poster`);
  if (!/^assets\/[a-f0-9]{16}\.(?:png|jpg|webp|gif)$/.test(poster)) {
    throw new ContentArtifactError(
      "Invalid asset reference.",
      `${path}/poster`,
    );
  }
  const duration =
    value.duration === undefined
      ? undefined
      : requireString(value.duration, `${path}/duration`);
  if (duration !== undefined && !/^\d{1,2}:\d{2}$/.test(duration)) {
    throw new ContentArtifactError("Invalid duration.", `${path}/duration`);
  }
  let link: MediaNode["link"];
  if (value.link !== undefined) {
    const at = `${path}/link`;
    if (
      !isRecord(value.link) ||
      !hasOnlyKeys(value.link, ["href", "label", "target"])
    ) {
      throw new ContentArtifactError("Invalid media link.", at);
    }
    link = {
      href: requireString(value.link.href, `${at}/href`),
      label: requireString(value.link.label, `${at}/label`),
      target: parseTarget(value.link.target, `${at}/target`),
    };
  }
  return {
    alt: requireString(value.alt, `${path}/alt`, true),
    ...(value.caption === undefined
      ? {}
      : { caption: requireString(value.caption, `${path}/caption`) }),
    ...(duration === undefined ? {} : { duration }),
    kind: "media",
    ...(link === undefined ? {} : { link }),
    poster,
  };
}

function parseCode(value: unknown, path: string): CodeBlock {
  if (!isRecord(value) || value.kind !== "code") {
    throw new ContentArtifactError("Invalid code block.", path);
  }
  only(value, ["kind", "language", "lines", "title", "value"], path);
  if (!Array.isArray(value.lines))
    throw new ContentArtifactError("Invalid code lines.", path);
  const lines = value.lines.map((line, index) => {
    const at = `${path}/lines/${index}`;
    if (!Array.isArray(line))
      throw new ContentArtifactError("Invalid code line.", at);
    return line.map((token, tokenIndex) => {
      if (!isRecord(token) || !hasOnlyKeys(token, ["cls", "text"])) {
        throw new ContentArtifactError(
          "Invalid code token.",
          `${at}/${tokenIndex}`,
        );
      }
      const text = requireString(token.text, `${at}/${tokenIndex}/text`, true);
      if (token.cls !== undefined && !TOKEN_CLASSES.has(String(token.cls))) {
        throw new ContentArtifactError(
          "Invalid token class.",
          `${at}/${tokenIndex}/cls`,
        );
      }
      const parsed: CodeToken =
        token.cls === undefined
          ? { text }
          : { cls: token.cls as CodeTokenClass, text };
      return parsed;
    });
  });
  return {
    kind: "code",
    ...(value.language === undefined
      ? {}
      : { language: requireString(value.language, `${path}/language`) }),
    lines,
    ...(value.title === undefined
      ? {}
      : { title: requireString(value.title, `${path}/title`) }),
    value: requireString(value.value, `${path}/value`, true),
  };
}

const TOKEN_CLASSES = new Set([
  "attr",
  "cmt",
  "fn",
  "kw",
  "num",
  "str",
  "tag",
  "type",
  "var",
]);

function parseInline(value: unknown, path: string, depth: number): InlineNode {
  if (depth > MAX_DEPTH)
    throw new ContentArtifactError("Content nests too deeply.", path);
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new ContentArtifactError("Inline shape is not recognized.", path);
  }
  const children = (items: unknown): readonly InlineNode[] => {
    if (!Array.isArray(items))
      throw new ContentArtifactError(
        "Expected an inline list.",
        `${path}/children`,
      );
    return items.map((item, index) =>
      parseInline(item, `${path}/children/${index}`, depth + 1),
    );
  };
  switch (value.kind) {
    case "text":
      only(value, ["kind", "value"], path);
      return {
        kind: "text",
        value: requireString(value.value, `${path}/value`, true),
      };
    case "code":
      only(value, ["kind", "value"], path);
      return {
        kind: "code",
        value: requireString(value.value, `${path}/value`, true),
      };
    case "break":
      only(value, ["kind"], path);
      return { kind: "break" };
    case "emphasis":
    case "strong":
    case "delete":
      only(value, ["children", "kind"], path);
      return { children: children(value.children), kind: value.kind };
    case "link":
      only(value, ["children", "href", "kind", "target"], path);
      return {
        children: children(value.children),
        href: requireString(value.href, `${path}/href`),
        kind: "link",
        target: parseTarget(value.target, `${path}/target`),
      };
    default:
      throw new ContentArtifactError("Unknown inline kind.", path);
  }
}

function parseNavigationNode(
  value: unknown,
  path: string,
  depth: number,
): NavigationNode {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new ContentArtifactError(
      "Navigation node shape is not recognized.",
      path,
    );
  }
  switch (value.kind) {
    case "page": {
      only(value, ["kind", "label", "route"], path);
      const route = requireString(value.route, `${path}/route`);
      if (!isInternalRoute(route) || route.startsWith("/api")) {
        throw new ContentArtifactError("Invalid page route.", `${path}/route`);
      }
      return {
        kind: "page",
        label: requireString(value.label, `${path}/label`),
        route,
      };
    }
    case "section": {
      only(value, ["items", "kind", "label"], path);
      if (depth >= 2 || !Array.isArray(value.items)) {
        throw new ContentArtifactError("Invalid section.", path);
      }
      return {
        items: value.items.map((item, index) =>
          parseNavigationNode(item, `${path}/items/${index}`, depth + 1),
        ),
        kind: "section",
        label: requireString(value.label, `${path}/label`),
      };
    }
    case "api":
      only(value, ["kind", "label"], path);
      return {
        kind: "api",
        label: requireString(value.label, `${path}/label`),
      };
    case "link": {
      only(value, ["href", "kind", "label"], path);
      const href = requireString(value.href, `${path}/href`);
      if (!/^https?:\/\//i.test(href))
        throw new ContentArtifactError("Invalid link.", `${path}/href`);
      return {
        href,
        kind: "link",
        label: requireString(value.label, `${path}/label`),
      };
    }
    default:
      throw new ContentArtifactError("Unknown navigation kind.", path);
  }
}

function parseTarget(
  value: unknown,
  path: string,
): InlineNode extends never
  ? never
  : "anchor" | "api" | "external" | "mailto" | "page" {
  if (
    value === "anchor" ||
    value === "api" ||
    value === "external" ||
    value === "mailto" ||
    value === "page"
  ) {
    return value;
  }
  throw new ContentArtifactError("Invalid link target.", path);
}

function isDepth(value: unknown): value is 2 | 3 | 4 | 5 | 6 {
  return (
    value === 2 || value === 3 || value === 4 || value === 5 || value === 6
  );
}

function requireString(
  value: unknown,
  path: string,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new ContentArtifactError("Expected a string.", path);
  }
  return value;
}

function only(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  path: string,
): void {
  if (!hasOnlyKeys(value, keys)) {
    throw new ContentArtifactError("Unexpected key.", path);
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).every((key) => permitted.has(key));
}
