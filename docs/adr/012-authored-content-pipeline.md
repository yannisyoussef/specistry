# ADR-012: Authored content pipeline, routes, and navigation composition

Date: 2026-09-05

Status: Accepted

## Context

SPEC-006 adds authored Markdown/MDX pages, navigation, and branding to a reader that so far rendered only the canonical API model. ADR-004 fixed the trust model (content text is never executable code; a fixed component vocabulary; validated props, paths, and assets) but left open where compilation happens, what the reader consumes, how authored routes coexist with the generated `/api` tree, and how one navigation is composed from both.

Options considered for compilation:

1. Compile MDX at request time in the reader with the MDX runtime. Rejected: it would ship a parser and a compiler to the server hot path, allow expressions and imports by construction, and make the nonce CSP meaningless for authored pages.
2. Compile MDX to JavaScript modules at build time (the usual `@mdx-js` route). Rejected: the output is code; keeping it inert would depend on a sanitizing transform rather than on the shape of the artifact.
3. Parse to a Markdown AST at build time, validate it against an allowlist, and serialize a bounded, versioned **content model** (JSON) that the reader renders through explicit React components. Chosen.

## Decision

- `@specra/content` (build-time only, depends on `@specra/model`) parses `.md`/`.mdx` with `mdast-util-from-markdown` plus the GFM, frontmatter, and MDX-JSX extensions. The MDX expression extension is loaded without a JavaScript parser, so `{…}` becomes a diagnostic; `import`/`export`, raw HTML (including lowercase inline tags), unknown components, misplaced components, and non-string props are diagnostics with a line and column. Fenced code is highlighted at build time (Shiki, JavaScript engine, literal grammar loaders) into a fixed set of token classes.
- The compiler emits `ContentPage` records (route, title, description, sidebar title, headings with ids, body as a discriminated union of block and inline nodes, plain text, source path) into `content.json` (`contentVersion: 1`) and a `NavigationArtifact` (`navigationVersion: 1`) into `navigation.json`; both are validated on read by strict parsers. Images are copied to `.specra/artifacts/assets/<sha256:16>.<ext>` after signature and size checks and the source is rewritten to the asset name. The manifest lists the content files, asset records, branding, and the page count; `documentation.json` gains the page identities (`home~`, `docs~<slug>` with `~` separators) so later slices can index them without reading `content.json`.
- Routes: `docs/<path>.md|mdx` maps to `/docs/<path>`, `index` names its folder, `docs/index.*` is `/`, and `/docs` redirects to `/`. Slugs are kebab-case segments, at most four deep and 80 characters each. The generated tree stays at `/api/...` (ADR-010); authored routes never shadow it because they always live under `/docs` or at `/`.
- Navigation: configuration nodes (`slug`, `{page,label}`, `{section,items}` two levels deep, `{api:true,label}` once, `{link,label}` external) are resolved against the compiled pages at build time; missing pages are errors, orphans are warnings, and the default order is pages by route followed by the API reference. The reader composes one sidebar from the navigation artifact and the API projection, inserting the API groups at the `api` node, and derives breadcrumbs, previous/next (with the API reference as a single entry), and the sitemap from the same flattened order.
- Branding: `accent` (`#rrggbb`) is emitted as a single custom property in a nonce-bearing `<style>`; `logo`/`favicon` are staged like assets (SVG allowed for the logo after a text check for scripts, handlers, external references, and `foreignObject`; ICO for the favicon) and served by the asset route with `default-src 'none'; sandbox`.
- Theme tokens are declared once with `light-dark()`; a mode is a `color-scheme` switch plus two blur filters, which removes the duplicated dark blocks SPEC-004 carried.

## Consequences

- Authored pages are inert by construction: the artifact is data, the renderer has no HTML pass-through, and the CSP is unchanged. The only new client script is the tabs enhancement, which is progressive (every panel is rendered statically).
- Artifacts are deterministic and atomic with the rest of the build; a content error removes stale artifacts rather than leaving a partially updated site.
- `content.json` scales linearly with the site (about 39 MiB for 1,000 dense pages with highlighting); the reader keeps it in memory like the model, so very large sites pay their size in server heap. Partitioning per route is deferred until measurements require it.
- Supported vocabulary is small on purpose (Callout, Steps, Cards, Tabs, CodeGroup); adding a component means extending the model, the compiler, the renderer, and the docs together.
- ADR-004 stays accepted; this record implements its "controlled static compilation" decision and pins the artifact and route shapes.
