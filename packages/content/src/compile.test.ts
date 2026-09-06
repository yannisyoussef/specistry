import { describe, expect, it } from "vitest";

import {
  parseContentArtifact,
  parseNavigationArtifact,
  serializeContentArtifact,
  serializeNavigationArtifact,
} from "./artifact.js";
import {
  compileContent,
  DEFAULT_CONTENT_BUDGETS,
  type ContentSource,
} from "./compile.js";
import { parseFrontmatter } from "./frontmatter.js";
import { highlightCode, normalizeLanguage } from "./highlight.js";
import { resolveLink } from "./links.js";
import { buildNavigation, flattenNavigation } from "./navigation.js";
import { anchorSlug, slugFromSourcePath, uniqueAnchors } from "./slug.js";
import type { BlockNode, ContentPage } from "./types.js";

function source(relativePath: string, text: string): ContentSource {
  return { path: `docs/${relativePath}`, relativePath, text };
}

const API_ROUTES = new Set(["/api/inboxes", "/api/inboxes/create-inbox"]);

async function compile(...sources: ContentSource[]) {
  return await compileContent(sources, { apiRoutes: API_ROUTES });
}

function codes(result: { readonly diagnostics: readonly { code: string }[] }) {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

const QUICKSTART = `---
title: Quickstart
description: Receive your first test email.
sidebarTitle: Start
---

## Create an inbox

Every test gets its own *address* with **strong** words and \`code\`.

\`\`\`typescript title="signup.test.ts"
const inbox = await client.inboxes.create({ ttl: 600 });
\`\`\`

<Callout type="warning" title="Sandbox">
Keys are separate per environment. See [authentication](./authentication#api-keys).
</Callout>

<Steps>
<Step title="Install">
Run \`npm install\`.
</Step>
<Step title="Call the API">
Use [Create inbox](/api/inboxes/create-inbox).
</Step>
</Steps>

<Cards>
<Card title="Authentication" href="./authentication" description="API keys and OAuth." />
<Card title="Status" href="https://status.example.test" />
</Cards>

<Tabs>
<Tab label="npm">
\`\`\`bash
npm install @acme/client
\`\`\`
</Tab>
<Tab label="pnpm">
\`\`\`bash
pnpm add @acme/client
\`\`\`
</Tab>
</Tabs>

<CodeGroup>
\`\`\`bash title="cURL"
curl https://api.example.test/inboxes
\`\`\`
\`\`\`python
client.inboxes.create()
\`\`\`
</CodeGroup>

| Field | Type |
| --- | :-: |
| ttl | integer |

![Inbox lifecycle](./images/lifecycle.png)

### Create an inbox

Duplicate heading text gets a suffixed id. Back to [the top](#create-an-inbox).

- one
- [ ] task
- [x] done

> Quoted.

---
`;

const AUTHENTICATION = `---
title: Authentication
---

## API keys

Keys live in the dashboard.
`;

describe("content compiler", () => {
  it("compiles Markdown and every Specra component into the content model", async () => {
    const result = await compile(
      source("quickstart.mdx", QUICKSTART),
      source("authentication.md", AUTHENTICATION),
    );
    expect(codes(result)).toEqual([]);
    expect(result.ok).toBe(true);
    const page = result.pages.find(
      (entry) => entry.page.slug === "quickstart",
    )?.page;
    expect(page).toBeDefined();
    if (page === undefined) return;
    expect(page.route).toBe("/docs/quickstart");
    expect(page.title).toBe("Quickstart");
    expect(page.sidebarTitle).toBe("Start");
    expect(page.headings).toEqual([
      { depth: 2, id: "create-an-inbox", text: "Create an inbox" },
      { depth: 3, id: "create-an-inbox-2", text: "Create an inbox" },
    ]);
    const kinds = page.body.map((node) => node.kind);
    expect(kinds).toEqual([
      "heading",
      "paragraph",
      "code",
      "callout",
      "steps",
      "cards",
      "tabs",
      "codeGroup",
      "table",
      "image",
      "heading",
      "paragraph",
      "list",
      "blockquote",
      "thematicBreak",
    ]);
    const code = page.body[2];
    expect(code).toMatchObject({
      kind: "code",
      language: "typescript",
      title: "signup.test.ts",
    });
    if (code?.kind === "code") {
      expect(code.lines[0]?.some((token) => token.cls === "kw")).toBe(true);
      expect(code.lines[0]?.map((token) => token.text).join("")).toBe(
        code.value,
      );
    }
    expect(page.body[3]).toMatchObject({
      kind: "callout",
      title: "Sandbox",
      type: "warning",
    });
    const callout = page.body[3];
    if (callout?.kind === "callout") {
      const paragraph = callout.children[0];
      const link =
        paragraph?.kind === "paragraph" ? paragraph.children.at(-2) : undefined;
      expect(link).toMatchObject({
        href: "/docs/authentication#api-keys",
        kind: "link",
        target: "page",
      });
    }
    expect(page.body[4]).toMatchObject({
      kind: "steps",
      steps: [{ title: "Install" }, { title: "Call the API" }],
    });
    expect(page.body[5]).toMatchObject({
      cards: [
        {
          description: "API keys and OAuth.",
          href: "/docs/authentication",
          target: "page",
          title: "Authentication",
        },
        {
          href: "https://status.example.test",
          target: "external",
          title: "Status",
        },
      ],
      kind: "cards",
    });
    expect(page.body[6]).toMatchObject({
      kind: "tabs",
      tabs: [{ label: "npm" }, { label: "pnpm" }],
    });
    expect(page.body[7]).toMatchObject({
      blocks: [{ language: "bash", title: "cURL" }, { language: "python" }],
      kind: "codeGroup",
    });
    expect(page.body[8]).toMatchObject({
      align: [null, "center"],
      kind: "table",
    });
    expect(page.body[9]).toMatchObject({
      alt: "Inbox lifecycle",
      kind: "image",
      src: "images/lifecycle.png",
    });
    expect(page.body[10]).toMatchObject({
      id: "create-an-inbox-2",
      kind: "heading",
    });
    expect(page.body[12]).toMatchObject({
      items: [{}, { checked: false }, { checked: true }],
      kind: "list",
      ordered: false,
    });
    expect(page.text).toContain("Every test gets its own address");
    expect(page.text).toContain("Call the API");
    expect(result.pages[1]?.assets).toEqual([
      {
        location: { column: 1, line: expect.any(Number) },
        path: "images/lifecycle.png",
      },
    ]);
  });

  it("rejects expressions, ESM, raw HTML, unknown components, bad nesting, and bad props with locations", async () => {
    const hostile = `---
title: Hostile
---

Hello {process.env.SECRET} there.

{require("fs").readFileSync("/etc/passwd")}

import fs from "node:fs"

export const x = 1

<script>alert(1)</script>

Inline <em onmouseover="alert(1)">html</em> here.

<MyArbitraryComponent />

<Callout type={danger}>
x
</Callout>

<Callout type="loud">
x
</Callout>

<Step title="Loose">
x
</Step>

<Steps>
<Callout>not a step</Callout>
</Steps>

<Card title="x" href="javascript:alert(1)" />

<Cards>
<Card title="x" href="javascript:alert(1)" />
</Cards>

[bad](javascript:alert(1)) [data](data:text/html,x) [vb](vbscript:x) [file](file:///etc/passwd) [proto](//evil.example)

# Body H1

##### Skipped
`;
    const result = await compile(source("hostile.mdx", hostile));
    expect(result.ok).toBe(false);
    const found = result.diagnostics.map(
      (diagnostic) => `${diagnostic.code}@${diagnostic.line}`,
    );
    expect(found).toEqual(
      expect.arrayContaining([
        "CONTENT_EXPRESSION_FORBIDDEN@5",
        "CONTENT_EXPRESSION_FORBIDDEN@7",
        "CONTENT_ESM_FORBIDDEN@9",
        "CONTENT_ESM_FORBIDDEN@11",
        "CONTENT_HTML_FORBIDDEN@13",
        "CONTENT_HTML_FORBIDDEN@15",
        "CONTENT_COMPONENT_UNKNOWN@17",
        "CONTENT_EXPRESSION_FORBIDDEN@19",
        "CONTENT_COMPONENT_PROP_INVALID@23",
        "CONTENT_COMPONENT_NESTING_INVALID@27",
        "CONTENT_COMPONENT_NESTING_INVALID@32",
        "CONTENT_COMPONENT_NESTING_INVALID@35",
        "CONTENT_LINK_SCHEME_FORBIDDEN@38",
        "CONTENT_LINK_SCHEME_FORBIDDEN@41",
        "CONTENT_HEADING_H1@43",
        "CONTENT_HEADING_SKIPPED@45",
      ]),
    );
    expect(
      result.diagnostics.every(
        (diagnostic) => diagnostic.path === "docs/hostile.mdx",
      ),
    ).toBe(true);
    // Malformed component syntax (an unquoted attribute) fails the whole
    // document at the offending position instead of rendering anything.
    const malformed = await compile(
      source(
        "malformed.mdx",
        "---\ntitle: M\n---\n\nok\n\n<img src=x onerror=alert(1)>\n",
      ),
    );
    expect(malformed.diagnostics).toEqual([
      expect.objectContaining({ code: "CONTENT_PARSE_FAILED", line: 7 }),
    ]);
    // Messages never echo source values.
    expect(JSON.stringify(result.diagnostics)).not.toContain("alert");
    expect(JSON.stringify(result.diagnostics)).not.toContain("passwd");
  });

  it("validates frontmatter strictly", async () => {
    const missing = await compile(source("a.md", "## Only body\n"));
    expect(codes(missing)).toContain("CONTENT_FRONTMATTER_MISSING");
    const unknown = await compile(
      source("b.md", "---\ntitle: B\ntitel: typo\n---\n"),
    );
    expect(codes(unknown)).toContain("CONTENT_FRONTMATTER_UNKNOWN_FIELD");
    const invalid = await compile(source("c.md", "---\n- list\n---\n"));
    expect(codes(invalid)).toContain("CONTENT_FRONTMATTER_INVALID");
    const slug = await compile(
      source("d.md", "---\ntitle: D\nslug: Not Valid\n---\n"),
    );
    expect(codes(slug)).toContain("ROUTE_SLUG_INVALID");
    expect(
      parseFrontmatter("title: X\ndescription: y", "docs/x.md").frontmatter,
    ).toEqual({
      description: "y",
      title: "X",
    });
  });

  it("derives deterministic routes, honours slug overrides, and reports collisions", async () => {
    const result = await compile(
      source("index.mdx", "---\ntitle: Home\n---\n\nWelcome.\n"),
      source("guides/index.md", "---\ntitle: Guides\n---\n"),
      source("guides/ci.md", "---\ntitle: CI\n---\n"),
      source("other.md", "---\ntitle: Other\nslug: guides/ci\n---\n"),
      source("Bad Name.md", "---\ntitle: Bad\n---\n"),
    );
    expect(codes(result)).toEqual(["ROUTE_SLUG_INVALID", "ROUTE_COLLISION"]);
    expect(result.pages.map((entry) => entry.page.route)).toEqual([
      "/",
      "/docs/guides",
      "/docs/guides/ci",
    ]);
    expect(slugFromSourcePath("getting-started/index.mdx")).toBe(
      "getting-started",
    );
    expect(slugFromSourcePath("a/b/c/d/e.md")).toBeUndefined();
    expect(slugFromSourcePath("UPPER.md")).toBeUndefined();
  });

  it("validates internal links and anchors across pages and API routes", async () => {
    const result = await compile(
      source(
        "a.md",
        "---\ntitle: A\n---\n\n## Here\n\n[b](./b) [b anchor](./b#there) [missing](./nope) [api](/api/inboxes) [api missing](/api/nope) [anchor missing](#nowhere) [home](/) [api root](/api)\n",
      ),
      source("b.md", "---\ntitle: B\n---\n\n## There\n"),
    );
    expect(codes(result)).toEqual([
      "CONTENT_LINK_TARGET_MISSING",
      "CONTENT_LINK_TARGET_MISSING",
      "CONTENT_LINK_ANCHOR_MISSING",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.column)).toEqual([
      32, 70, 95,
    ]);
  });

  it("enforces resource budgets without failing the whole build silently", async () => {
    const huge = `---\ntitle: Huge\n---\n\n\`\`\`ts\n${"x".repeat(30_000)}\n\`\`\`\n`;
    const result = await compile(source("huge.md", huge));
    expect(codes(result)).toEqual(["CONTENT_BUDGET_EXCEEDED"]);
    const manyHeadings = `---\ntitle: Many\n---\n\n${Array.from({ length: 300 }, (_, index) => `## H${index}\n`).join("\n")}`;
    const headings = await compileContent([source("many.md", manyHeadings)], {
      apiRoutes: new Set(),
      budgets: { maxHeadingsPerPage: 100 },
    });
    expect(codes(headings)).toEqual(["CONTENT_BUDGET_EXCEEDED"]);
    const deep = `---\ntitle: Deep\n---\n\n${"<Callout>\n".repeat(8)}x${"\n</Callout>".repeat(8)}\n`;
    const nesting = await compile(source("deep.md", deep));
    expect(codes(nesting)).toContain("CONTENT_BUDGET_EXCEEDED");
    const tooMany = await compileContent(
      Array.from({ length: 3 }, (_, index) =>
        source(`p${index}.md`, "---\ntitle: P\n---\n"),
      ),
      { apiRoutes: new Set(), budgets: { maxPages: 2 } },
    );
    expect(codes(tooMany)).toEqual(["CONTENT_BUDGET_EXCEEDED"]);
    expect(DEFAULT_CONTENT_BUDGETS.maxCodeBlockCharacters).toBe(20_000);
  });

  it("survives pathological Markdown within bounds", async () => {
    // Unmatched emphasis delimiters make CommonMark attention quadratic; the
    // delimiter budget rejects the pathological page before parsing.
    const flood = `---\ntitle: E\n---\n\n${"*".repeat(5_000)}a${"*".repeat(5_000)}\n`;
    const started = performance.now();
    const rejected = await compile(source("e.md", flood));
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(codes(rejected)).toEqual(["CONTENT_BUDGET_EXCEEDED"]);
    const emphasis = `---\ntitle: E\n---\n\n${"*".repeat(1_500)}a${"*".repeat(1_500)}\n`;
    const result = await compile(source("e.md", emphasis));
    expect(result.ok).toBe(true);
    const nested = `---\ntitle: N\n---\n\n${"> ".repeat(200)}deep\n`;
    const quotes = await compile(source("n.md", nested));
    expect(quotes.ok).toBe(true);
    const links = `---\ntitle: L\n---\n\n${Array.from({ length: 1_200 }, (_, index) => `[l${index}](https://example.test/${index})`).join(" ")}\n`;
    const many = await compile(source("l.md", links));
    expect(codes(many)).toEqual(["CONTENT_BUDGET_EXCEEDED"]);
  });

  it("produces byte-identical artifacts for equal input and round-trips them", async () => {
    const first = await compile(
      source("quickstart.mdx", QUICKSTART),
      source("authentication.md", AUTHENTICATION),
    );
    const second = await compile(
      source("authentication.md", AUTHENTICATION),
      source("quickstart.mdx", QUICKSTART),
    );
    const artifact = (pages: readonly { page: ContentPage }[]) =>
      serializeContentArtifact({
        contentVersion: 1,
        pages: pages.map((entry) => rewrite(entry.page)),
      });
    const bytes = artifact(first.pages);
    expect(artifact(second.pages)).toBe(bytes);
    const parsed = parseContentArtifact(bytes);
    expect(serializeContentArtifact(parsed)).toBe(bytes);
    expect(parsed.pages.map((page) => page.route)).toEqual([
      "/docs/authentication",
      "/docs/quickstart",
    ]);
    expect(() =>
      parseContentArtifact(
        bytes.replace('"kind": "callout"', '"kind": "script"'),
      ),
    ).toThrow(/Unknown block kind/);
    expect(() =>
      parseContentArtifact(
        bytes.replace('"target": "external"', '"target": "javascript"'),
      ),
    ).toThrow(/Invalid link target/);
  });

  it("keeps hostile text as data and never produces markup", async () => {
    const text = `---\ntitle: T\n---\n\nEntity &lt;script&gt; and bidi ‮café and zero​width and \`<b>code</b>\`.\n`;
    const result = await compile(source("t.md", text));
    expect(result.ok).toBe(true);
    const paragraph = result.pages[0]?.page.body[0];
    expect(paragraph?.kind).toBe("paragraph");
    const json = JSON.stringify(paragraph);
    expect(json).toContain("<script>");
    expect(json).toContain("\u202e");
    expect(json).toContain("<b>code</b>");
  });
});

function rewrite(page: ContentPage): ContentPage {
  const visit = (nodes: readonly BlockNode[]): readonly BlockNode[] =>
    nodes.map((node) =>
      node.kind === "image"
        ? { ...node, src: "assets/0123456789abcdef.png" }
        : node,
    );
  return { ...page, body: visit(page.body) };
}

describe("slugs and anchors", () => {
  it("normalizes anchors and de-duplicates them deterministically", () => {
    expect(anchorSlug("Création d'une boîte")).toBe("creation-d-une-boite");
    expect(anchorSlug("   ")).toBe("section");
    expect(uniqueAnchors(["a", "a", "a-2", "content"])).toEqual([
      "a",
      "a-2",
      "a-2-2",
      "content-2",
    ]);
  });
});

describe("links", () => {
  it("accepts approved forms and rejects dangerous ones", () => {
    expect(resolveLink("./b", "a")).toEqual({
      href: "/docs/b",
      route: "/docs/b",
      target: "page",
    });
    expect(resolveLink("../x/y#z", "guides/a")).toEqual({
      anchor: "z",
      href: "/docs/x/y#z",
      route: "/docs/x/y",
      target: "page",
    });
    expect(resolveLink("/api/inboxes", "a")?.target).toBe("api");
    expect(resolveLink("#top", "a")).toEqual({
      anchor: "top",
      href: "#top",
      target: "anchor",
    });
    expect(resolveLink("mailto:dev@example.test", "a")?.target).toBe("mailto");
    expect(resolveLink("https://user:pw@example.test/", "a")).toBeUndefined();
    for (const bad of [
      "javascript:alert(1)",
      "JAVASCRIPT:x",
      "data:text/html,x",
      "vbscript:x",
      "file:///x",
      "//evil",
      "../../etc",
      "/etc/passwd",
      "/docs/Bad",
      "./a?b=c",
      "java\tscript:x",
    ]) {
      expect(resolveLink(bad, "a"), bad).toBeUndefined();
    }
  });
});

describe("highlighting", () => {
  it("normalizes languages, classifies tokens, and falls back safely", async () => {
    expect(normalizeLanguage("TS")).toBe("typescript");
    expect(normalizeLanguage("sh")).toBe("bash");
    expect(normalizeLanguage("text")).toBeUndefined();
    expect(normalizeLanguage("brainfuck")).toBeUndefined();
    const lines = await highlightCode('const x = "y"; // c', "typescript");
    expect(lines[0]?.map((token) => token.cls)).toContain("kw");
    expect(lines[0]?.map((token) => token.cls)).toContain("str");
    expect(lines[0]?.map((token) => token.cls)).toContain("cmt");
    expect(lines[0]?.map((token) => token.text).join("")).toBe(
      'const x = "y"; // c',
    );
    const plain = await highlightCode("a\n\nb", undefined);
    expect(plain).toEqual([[{ text: "a" }], [], [{ text: "b" }]]);
    const same = await highlightCode('const x = "y"; // c', "typescript");
    expect(JSON.stringify(same)).toBe(JSON.stringify(lines));
  });
});

describe("navigation", () => {
  const pages: ContentPage[] = [
    page("", "Home"),
    page("introduction", "Introduction"),
    page("quickstart", "Quickstart", "Start"),
    page("guides/ci", "CI integration"),
    page("orphan", "Orphan"),
  ];

  it("resolves a configured navigation with sections, api insertion, and links", () => {
    const result = buildNavigation(
      [
        {
          items: ["introduction", { label: "Quick start", page: "quickstart" }],
          section: "Getting started",
        },
        {
          items: [{ items: ["guides/ci"], section: "Integrations" }],
          section: "Guides",
        },
        { api: true },
        {
          items: [{ label: "Status", link: "https://status.example.test" }],
          section: "Resources",
        },
      ],
      pages,
    );
    expect(result.ok).toBe(true);
    expect(codes(result)).toEqual(["NAVIGATION_PAGE_ORPHANED"]);
    expect(result.items).toEqual([
      {
        items: [
          { kind: "page", label: "Introduction", route: "/docs/introduction" },
          { kind: "page", label: "Quick start", route: "/docs/quickstart" },
        ],
        kind: "section",
        label: "Getting started",
      },
      {
        items: [
          {
            items: [
              {
                kind: "page",
                label: "CI integration",
                route: "/docs/guides/ci",
              },
            ],
            kind: "section",
            label: "Integrations",
          },
        ],
        kind: "section",
        label: "Guides",
      },
      { kind: "api", label: "API reference" },
      {
        items: [
          {
            href: "https://status.example.test",
            kind: "link",
            label: "Status",
          },
        ],
        kind: "section",
        label: "Resources",
      },
    ]);
    expect(
      flattenNavigation(result.items).map((entry) => [
        entry.route,
        entry.trail,
      ]),
    ).toEqual([
      ["/docs/introduction", ["Getting started"]],
      ["/docs/quickstart", ["Getting started"]],
      ["/docs/guides/ci", ["Guides", "Integrations"]],
      ["/api", []],
    ]);
    const bytes = serializeNavigationArtifact({
      items: result.items,
      navigationVersion: 1,
    });
    expect(serializeNavigationArtifact(parseNavigationArtifact(bytes))).toBe(
      bytes,
    );
  });

  it("reports missing, duplicate, deep, invalid, and repeated api entries", () => {
    const result = buildNavigation(
      [
        "introduction",
        "introduction",
        "missing",
        "",
        { api: true },
        { api: true },
        {
          items: [
            {
              items: [{ items: ["quickstart"], section: "Three" }],
              section: "Two",
            },
          ],
          section: "One",
        },
        { label: "Bad", link: "javascript:alert(1)" },
        { label: "", link: "https://x.example" },
        { bogus: true } as never,
      ],
      pages,
    );
    expect(result.ok).toBe(false);
    // Errors sort by configuration position, then the orphan warnings.
    expect(codes(result)).toEqual([
      "NAVIGATION_PAGE_DUPLICATE",
      "NAVIGATION_PAGE_MISSING",
      "NAVIGATION_PAGE_MISSING",
      "NAVIGATION_API_DUPLICATE",
      "NAVIGATION_DEPTH_EXCEEDED",
      "NAVIGATION_LINK_INVALID",
      "NAVIGATION_LINK_INVALID",
      "NAVIGATION_INVALID",
      "NAVIGATION_PAGE_ORPHANED",
      "NAVIGATION_PAGE_ORPHANED",
      "NAVIGATION_PAGE_ORPHANED",
    ]);
    expect(result.diagnostics[0]?.path).toBe("config#/navigation/1");
    expect(result.diagnostics[3]?.path).toBe("config#/navigation/5");
  });

  it("derives a default navigation when none is configured", () => {
    const result = buildNavigation(undefined, pages);
    expect(result.items).toEqual([
      {
        items: [
          { kind: "page", label: "CI integration", route: "/docs/guides/ci" },
          { kind: "page", label: "Introduction", route: "/docs/introduction" },
          { kind: "page", label: "Orphan", route: "/docs/orphan" },
          { kind: "page", label: "Start", route: "/docs/quickstart" },
        ],
        kind: "section",
        label: "Documentation",
      },
      { kind: "api", label: "API reference" },
    ]);
  });
});

function page(slug: string, title: string, sidebarTitle?: string): ContentPage {
  return {
    body: [],
    headings: [],
    id: slug,
    route: slug === "" ? "/" : `/docs/${slug}`,
    ...(sidebarTitle === undefined ? {} : { sidebarTitle }),
    slug,
    sourcePath: `docs/${slug === "" ? "index" : slug}.md`,
    text: "",
    title,
  };
}
