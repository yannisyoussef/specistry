/**
 * Specra content model (SPEC-006). A small, source-independent, JSON-safe
 * representation of authored documentation: what a Markdown page *means*
 * (paragraphs, headings, lists, code, tables, images, links, and the curated
 * Specra components), never how a parser represented it and never arbitrary
 * HTML. It is the contract between the build (`specra build`), the reader,
 * and later consumers such as search. Every node is deterministic data.
 */

export const CONTENT_FORMAT_VERSION = 1 as const;
export const NAVIGATION_FORMAT_VERSION = 1 as const;

/** Where a link points, decided at build time so the reader never guesses. */
export type LinkTarget = "anchor" | "api" | "external" | "mailto" | "page";

export type InlineNode =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "emphasis"; readonly children: readonly InlineNode[] }
  | { readonly kind: "strong"; readonly children: readonly InlineNode[] }
  | { readonly kind: "delete"; readonly children: readonly InlineNode[] }
  | { readonly kind: "code"; readonly value: string }
  | { readonly kind: "break" }
  | {
      readonly kind: "link";
      readonly href: string;
      readonly target: LinkTarget;
      readonly children: readonly InlineNode[];
    };

export type CodeTokenClass =
  "attr" | "cmt" | "fn" | "kw" | "num" | "str" | "tag" | "type" | "var";

export interface CodeToken {
  readonly text: string;
  readonly cls?: CodeTokenClass;
}

export interface CodeBlock {
  readonly kind: "code";
  /** Normalized language identifier, absent for plain text. */
  readonly language?: string;
  readonly title?: string;
  readonly value: string;
  /** One entry per line; empty when highlighting is not available. */
  readonly lines: readonly (readonly CodeToken[])[];
}

export type TableAlignment = "center" | "left" | "right" | null;

export interface ListItem {
  readonly checked?: boolean;
  readonly children: readonly BlockNode[];
}

export interface StepNode {
  readonly title: string;
  readonly children: readonly BlockNode[];
}

export interface CardNode {
  readonly title: string;
  readonly href: string;
  readonly target: LinkTarget;
  readonly description?: string;
}

export interface TabNode {
  readonly label: string;
  readonly children: readonly BlockNode[];
}

export type BlockNode =
  | { readonly kind: "paragraph"; readonly children: readonly InlineNode[] }
  | {
      readonly kind: "heading";
      readonly depth: 2 | 3 | 4 | 5 | 6;
      readonly id: string;
      readonly children: readonly InlineNode[];
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly start?: number;
      readonly items: readonly ListItem[];
    }
  | { readonly kind: "blockquote"; readonly children: readonly BlockNode[] }
  | CodeBlock
  | {
      readonly kind: "table";
      readonly align: readonly TableAlignment[];
      readonly header: readonly (readonly InlineNode[])[];
      readonly rows: readonly (readonly (readonly InlineNode[])[])[];
    }
  | { readonly kind: "thematicBreak" }
  | {
      readonly kind: "image";
      /** Artifact asset reference (`assets/<name>`) after the build resolved it. */
      readonly src: string;
      readonly alt: string;
    }
  | {
      readonly kind: "callout";
      readonly type: CalloutType;
      readonly title?: string;
      readonly children: readonly BlockNode[];
    }
  | { readonly kind: "steps"; readonly steps: readonly StepNode[] }
  | { readonly kind: "cards"; readonly cards: readonly CardNode[] }
  | { readonly kind: "tabs"; readonly tabs: readonly TabNode[] }
  | { readonly kind: "codeGroup"; readonly blocks: readonly CodeBlock[] };

export type CalloutType = "danger" | "note" | "tip" | "warning";

export interface ContentHeading {
  readonly depth: 2 | 3 | 4 | 5 | 6;
  readonly id: string;
  readonly text: string;
}

export interface ContentPage {
  /** Stable page identity: the route slug (`""` for the homepage). */
  readonly id: string;
  /** Route-relative slug: `getting-started/authentication`, `""` for the home. */
  readonly slug: string;
  /** Public route: `/`, `/docs/getting-started/authentication`. */
  readonly route: string;
  readonly title: string;
  readonly description?: string;
  readonly sidebarTitle?: string;
  readonly headings: readonly ContentHeading[];
  readonly body: readonly BlockNode[];
  /** Plain text of the body for search and previews; bounded. */
  readonly text: string;
  /** Project-relative POSIX source path. */
  readonly sourcePath: string;
}

export interface ContentArtifact {
  readonly contentVersion: typeof CONTENT_FORMAT_VERSION;
  /** Pages in route order. */
  readonly pages: readonly ContentPage[];
}

export type NavigationNode =
  | { readonly kind: "page"; readonly route: string; readonly label: string }
  | {
      readonly kind: "section";
      readonly label: string;
      readonly items: readonly NavigationNode[];
    }
  | { readonly kind: "api"; readonly label: string }
  | { readonly kind: "link"; readonly href: string; readonly label: string };

export interface NavigationArtifact {
  readonly navigationVersion: typeof NAVIGATION_FORMAT_VERSION;
  readonly items: readonly NavigationNode[];
}

/** A source location inside an authored file, 1-based. */
export interface ContentLocation {
  readonly line: number;
  readonly column: number;
}
