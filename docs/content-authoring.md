# Content authoring reference

Authored pages live under the configured `docs` directory (default `./docs`) as Markdown (`.md`) or MDX-flavoured Markdown (`.mdx`). `specra validate` and `specra build` compile them into a bounded content model that the reader renders next to the generated API reference. Nothing an author writes ever executes: the compiler parses text into an abstract syntax tree, validates it against a fixed vocabulary, and the reader renders that tree through React components. There is no HTML pass-through, no expression evaluation, no imports, and no client-side Markdown.

## Files and routes

| Source file                         | Route                      |
| ----------------------------------- | -------------------------- |
| `docs/index.md` or `docs/index.mdx` | `/` (the site homepage)    |
| `docs/quickstart.mdx`               | `/docs/quickstart`         |
| `docs/guides/index.md`              | `/docs/guides`             |
| `docs/guides/attachments.md`        | `/docs/guides/attachments` |

The reader's primary tabs are `Guides` (authored pages) and `API reference`; the breadcrumb root of every authored page is `Guides`. Every path segment must be a route slug: lowercase ASCII letters and digits separated by single hyphens, at most 80 characters, at most four segments deep. `index` names the folder route. A file whose name is not a slug fails with `ROUTE_SLUG_INVALID`; two files that resolve to the same route (`page.md` and `page.mdx`) fail with `ROUTE_COLLISION`. Files that are not `.md` or `.mdx`, dotfiles, `node_modules`, and symlinked directories are ignored; a symlinked file that resolves outside the docs directory is an error (`CONTENT_SOURCE_OUTSIDE_ROOT`). `/docs` itself redirects to the homepage. Without an authored `docs/index.*` the reader keeps the generated API-reference homepage.

The frontmatter `slug` field overrides the file-derived slug with the same grammar (relative to the docs root), for example `slug: getting-started/install`.

## Frontmatter

Every page starts with a YAML frontmatter block. Only these keys are allowed; unknown keys fail with `CONTENT_FRONTMATTER_UNKNOWN_FIELD`, a missing block with `CONTENT_FRONTMATTER_MISSING`, and a wrong type or an empty title with `CONTENT_FRONTMATTER_INVALID`.

| Key            | Required | Purpose                                                                                                  |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `title`        | yes      | The page `<h1>`, the document title, the breadcrumb, and the default navigation label (1–120 characters) |
| `description`  | no       | The lede under the title and the `<meta name="description">` (1–500 characters)                          |
| `sidebarTitle` | no       | A shorter label for the sidebar and previous/next links                                                  |
| `slug`         | no       | Route override, see above                                                                                |

The body must not contain a level-one heading (`CONTENT_HEADING_H1`): the title is the only `<h1>`.

## Markdown

CommonMark plus the GitHub extensions that carry documentation: tables, task lists, strikethrough, and autolink literals. Supported: paragraphs, headings `##`–`######`, emphasis, strong, inline code, fenced code, blockquotes, ordered and unordered lists (nested), task-list items, thematic breaks, tables with column alignment, block images, links, and hard line breaks.

Not supported, and reported with a location: raw HTML (`CONTENT_HTML_FORBIDDEN`, including inline tags such as `<em>` and `<br>`), MDX expressions `{…}` (`CONTENT_EXPRESSION_FORBIDDEN`), `import`/`export` statements (`CONTENT_ESM_FORBIDDEN`), footnotes, reference-style links and images, and images inside a sentence (`CONTENT_UNSUPPORTED`). HTML entities such as `&lt;` decode to text, as in every Markdown processor, and that text is rendered as text.

### Headings and anchors

Each heading gets a deterministic id: the heading text lower-cased, accents folded, non-alphanumerics collapsed to single hyphens. Duplicate ids receive `-2`, `-3` suffixes in document order, and ids the reader reserves for its own landmarks (`content`, `outline`, `api-navigation`, `api-sidebar`, `api-sidebar-region`) are suffixed too. Heading levels may not skip (`##` then `####`); a skip is a warning (`CONTENT_HEADING_SKIPPED`) because the outline and screen-reader navigation degrade. The "On this page" outline lists `##` and `###` headings.

### Links

| Form                                             | Meaning                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `./quickstart`, `../guides/attachments#limits`   | Relative to the current page's route; must resolve to a page                   |
| `/docs/guides/attachments`, `/`                  | Absolute authored route                                                        |
| `/api`, `/api/inboxes/create-inbox#response-201` | Generated API reference routes, checked against the contract                   |
| `#errors`                                        | Anchor on the current page                                                     |
| `https://…`, `http://…`, `mailto:…`              | External; rendered with `rel="noopener noreferrer"` and an "external link" cue |

A link to a page or API route that does not exist is an error (`CONTENT_LINK_TARGET_MISSING`); a link whose anchor does not exist on the target page is a warning (`CONTENT_LINK_ANCHOR_MISSING`). Any other scheme (`javascript:`, `data:`, `file:`, protocol-relative `//`) is rejected (`CONTENT_LINK_SCHEME_FORBIDDEN`). Link text is text; it never becomes markup.

### Images and assets

`![Alternative text](./images/diagram.png)` references a file under the docs directory, relative to the page. The build reads the file, checks its bytes (PNG, JPEG, WebP, or GIF by signature, never by extension), enforces 2 MiB per file and 20 MiB per project, copies it to `.specra/artifacts/assets/<sha256 prefix>.<ext>`, and rewrites the source to that content-addressed name. The reader serves assets only by manifest name with an immutable cache policy, `nosniff`, and a sandboxing policy of their own. References outside the docs directory (`CONTENT_ASSET_OUTSIDE_ROOT`), missing files (`CONTENT_ASSET_NOT_FOUND`), absolute or malformed paths (`CONTENT_ASSET_INVALID`), other types including SVG (`CONTENT_ASSET_UNSUPPORTED`), and oversized files (`CONTENT_ASSET_TOO_LARGE`) are errors. Alternative text is required to be meaningful; decorative images are better omitted.

### Code blocks

Fenced code is highlighted at build time; the reader ships no highlighter. The info string names the language and optionally a title:

````markdown
```typescript title="signup.test.ts"
const inbox = await client.inboxes.create({ ttl: 600 });
```
````

Supported languages and aliases: `bash` (`sh`, `shell`, `zsh`, `console`), `csharp` (`cs`), `css`, `diff`, `dockerfile` (`docker`), `go`, `graphql`, `html`, `http`, `java`, `javascript` (`js`), `json`, `jsx`, `kotlin` (`kt`), `markdown` (`md`), `php`, `python` (`py`), `ruby` (`rb`), `rust` (`rs`), `sql`, `swift`, `toml`, `typescript` (`ts`), `tsx`, `xml`, `yaml` (`yml`). An unknown language renders as plain text without a diagnostic. `title="…"` (up to 120 characters) is the only fence attribute; anything else is `CONTENT_COMPONENT_PROP_INVALID`. Every block has a header with its title or language and a copy control; long lines scroll inside the block, which is keyboard-focusable. Blocks are limited to 2,000 lines and 20,000 characters, and a page to 200 KB of highlighted output (`CONTENT_BUDGET_EXCEEDED`).

Highlighting emits a small fixed set of token classes (`keyword`, `string`, `number`, `comment`, `function`, `tag`, `type`, `variable`, `attribute`) that the theme colours in light and dark mode; grammar output never reaches the page as markup.

## Components

Components are block-level: put a blank line before and after each tag, and around the content inside a tag. Props are string attributes only; expressions (`type={x}`) and spreads are rejected. Component names are case-sensitive; an unknown capitalised tag is `CONTENT_COMPONENT_UNKNOWN`, a lowercase tag is HTML and forbidden. Nesting is limited to six levels.

### Callout

```mdx
<Callout type="warning" title="Keep keys out of the browser">

API keys are secrets. Use them from CI and servers only.

</Callout>
```

`type` is one of `note`, `tip`, `warning`, `danger` (required); `title` is optional. The kind is rendered as text ("Warning") so the meaning never depends on colour alone. Callouts hold any block content except another callout.

### Steps

```mdx
<Steps>

<Step title="Create an inbox">

Every test gets its own address.

</Step>

<Step title="Trigger your application">

Use the inbox address wherever your application would send email.

</Step>

</Steps>
```

`Steps` contains only `Step` children; each `Step` needs a `title` and holds any block content, including code blocks and callouts. Steps render as an ordered list; titles continue the heading outline below the nearest heading.

### Cards

```mdx
<Cards>

<Card
  title="Quickstart"
  href="./quickstart"
  description="First test email in five minutes."
/>

<Card title="API reference" href="/api" />

</Cards>
```

`Cards` contains only `Card` children; each `Card` needs `title` and `href` (any supported link form, validated like a link) and may carry a `description`. Cards are self-closing; they hold no children.

### Tabs

````mdx
<Tabs>

<Tab label="TypeScript">

```typescript
const client = new TestInbox({ apiKey });
```
````

</Tab>

<Tab label="Python">

```python
client = TestInbox(api_key=key)
```

</Tab>

</Tabs>
```

`Tabs` contains only `Tab` children with unique `label`s. Without JavaScript every panel renders in order under its label as a heading; with JavaScript the labels become a WAI-ARIA tab list (arrow keys, Home, End) and one panel is shown at a time. Tab panels hold any block content except another `Tabs`.

### CodeGroup

````mdx
<CodeGroup>

```bash title="npm"
npm install @testinbox/client
```

```bash title="pnpm"
pnpm add @testinbox/client
```

</CodeGroup>
````

`CodeGroup` contains only fenced code blocks; each fence's `title` (or language when there is no title) becomes the tab label. It behaves like `Tabs` with a code block per panel.

### Homepage components

The approved homepage (design contract screens 6a and 8c) is built from four block-level components that are only meaningful on `docs/index.*`. `Hero` must be the first block of the homepage; anywhere else it is `CONTENT_COMPONENT_NESTING_INVALID`. The other three work on any page but are designed for the home layout, where an `Install` block directly followed by a `StartHere` block (or the reverse) renders as one two-column row.

````mdx
---
title: Email testing built for automation.
description: Create disposable inboxes and receive real application emails from your tests.
---

<Hero eyebrow="TestInbox · v1">
  <Action label="Get started" href="./quickstart" />
  <Action label="API reference" href="/api" />
  <Media
    poster="./images/see-it-work.png"
    alt="A test creating an inbox and the email arriving."
    caption="See it work: from create() to a passing test."
    duration="0:42"
    linkLabel="Show as steps"
    linkHref="./quickstart"
  />
</Hero>

<Install>
<Tab label="TypeScript">
```bash
npm install @testinbox/client
````

```typescript
const client = new TestInbox({ apiKey: process.env.TESTINBOX_API_KEY });
```

</Tab>
</Install>

<StartHere>
<Entry title="Quickstart" href="./quickstart" description="First test email in five minutes" meta="5 min" />
<Entry title="API reference" href="/api" description="Inboxes, messages, attachments" meta="25 endpoints" />
</StartHere>

<Steps variant="strip" title="The workflow">
<Step title="Create an inbox">
`inboxes.create()`
</Step>
</Steps>
```

- **`Hero`** (`eyebrow?`): renders the frontmatter `title` as the 44 px display heading and the `description` as the lede, so the homepage keeps one source for its H1 and metadata. Children are up to three self-closing `Action` elements (`label`, `href`, `variant` `primary` or `secondary`; the first defaults to primary, the rest to secondary; hrefs follow the link rules) and at most one `Media`. Actions render as the ink and outline buttons; with a `Media` child the hero becomes the two-column layout of screen 8c.
- **`Media`** (`poster`, `alt`, `caption?`, `duration?` as `m:ss`, `linkLabel?` + `linkHref?` together): a media placeholder. The poster is an image asset (same rules as images); the play chrome, progress bar, and duration are decorative because the reader embeds no video, so the caption should say what the media shows and the link should point at a written alternative. `alt` describes the poster for screen readers.
- **`Install`**: contains `Tab` children (unique `label`s) that each hold one or two fenced code blocks: the first is the install command, rendered as a prompt line with a copy control; the optional second is a configuration sample. Labels render as chips; without JavaScript every option renders in order under a heading.
- **`StartHere`**: contains self-closing `Entry` elements (`title`, `href`, `description?`, `meta?`); each renders as a row with the meta right-aligned in mono.
- **`Steps variant="strip" title="…"`**: the workflow strip, a four-column row (stacked on mobile) with the step number in the accent, the title, and the step body in muted text; `title` renders as the eyebrow heading and the step titles sit one level below it. Without `variant`, `Steps` renders the numbered rail described above; `title` works for both.

## Navigation

Without configuration, the sidebar lists authored pages by route followed by the API reference. `navigation` in `specra.config.ts` sets the order and grouping:

```ts
navigation: [
  "introduction",
  { section: "Guides", items: ["guides/attachments", { page: "guides/ci-integration", label: "CI" }] },
  { api: true, label: "API reference" },
  { section: "Resources", items: [{ label: "Status page", link: "https://status.example.test" }] },
],
```

| Node                    | Meaning                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `"slug"`                | A page by route slug; the label is `sidebarTitle` or `title`                            |
| `{ page, label? }`      | The same with an explicit label                                                         |
| `{ section, items }`    | A titled group; sections nest at most two levels deep (`NAVIGATION_DEPTH_EXCEEDED`)     |
| `{ api: true, label? }` | The generated API reference at this position, at most once (`NAVIGATION_API_DUPLICATE`) |
| `{ label, link }`       | An external `https://` or `http://` link (`NAVIGATION_LINK_INVALID` otherwise)          |

A navigation entry whose page does not exist is an error (`NAVIGATION_PAGE_MISSING`, reported at `config#/navigation/…`); a page listed twice is `NAVIGATION_PAGE_DUPLICATE`; a page that exists but is not listed is a warning (`NAVIGATION_PAGE_ORPHANED`) and stays reachable by URL. The homepage need not be listed: it opens the reading order. Breadcrumbs derive from the section trail, previous/next links follow the flattened order with the API reference as one entry, and the sitemap lists every authored route.

## Branding

```ts
branding: { accent: "#2a6fdb", logo: "./assets/logo.svg", favicon: "./assets/favicon.png" }
```

`accent` is a six-digit hex colour applied as the reader's `--brand` custom property through a nonce-bearing `<style>`; every other colour derives from it. `logo` (PNG, JPEG, WebP, GIF, or SVG) replaces the wordmark mark and `favicon` (the same types plus ICO) sets the site icon; both are checked by content, limited to 512 KiB, copied into the assets directory, and served with a policy that forbids scripts even when a browser opens the SVG directly. An SVG containing `<script`, event-handler attributes, external references, or `foreignObject` is rejected (`CONTENT_ASSET_UNSUPPORTED`).

## Budgets

| Limit                          | Value                            |
| ------------------------------ | -------------------------------- |
| Pages                          | 2,000 (5,000 files scanned)      |
| Source size                    | 1 MB per page, 50 MB per project |
| Nodes per page                 | 20,000                           |
| Headings / links / table cells | 200 / 1,000 / 5,000 per page     |
| Code block                     | 2,000 lines, 20,000 characters   |
| Highlighted output per page    | 200 KB                           |
| Component nesting              | 6 levels                         |
| Emphasis markers (`*`, `_`)    | 8,000 per page                   |
| Images                         | 2 MiB each, 20 MiB per project   |
| Navigation                     | 500 root nodes, 200 per section  |

A breached budget is `CONTENT_BUDGET_EXCEEDED` at the offending location; the build fails rather than truncating content silently.

## Changelog

Release notes are authored, not generated. `changelog/<version>.json` holds dated entries of `added`, `changed`, `deprecated`, `removed`, and `fixed` items with plain text, an optional operation reference, and the structured diff candidates each item reviews; `specra release` publishes exactly that text at `/docs/{version}/changelog` once every candidate is dispositioned. The format and workflow are in the [versioning reference](versioning.md#writing-the-changelog).

## Diagnostics

Content diagnostics use the CLI's path grammar with a source location: `source/docs/guides/attachments.md:42:7` names the line and column of the offending node; navigation diagnostics point at the configuration (`config#/navigation/1/items/0`). Messages are fixed text and never quote the authored value. `specra validate` reports every problem in one run so a large migration can be fixed in one pass, and `specra build` refuses to write artifacts while any error remains. See the [CLI reference](cli.md#output-and-exit-contract) for the full code list.

## What the reader guarantees

- Authored text is data. The reader never calls `dangerouslySetInnerHTML`, never interprets HTML, and never evaluates author-supplied expressions; hostile strings such as `<script>alert(1)</script>` render literally.
- Every page is complete server-rendered HTML: navigation, outline, code, tables, and every tab panel work without JavaScript. The only client script an authored page adds is the tab list enhancement.
- Links are validated at build time, so a published site has no broken internal link, and external links are marked.
- Assets are content-addressed, type-checked by bytes, size-limited, and served from a fixed directory with an immutable cache and a restrictive policy.
- Builds are deterministic: the same sources produce byte-identical `content.json`, `navigation.json`, and assets regardless of machine or working directory.
