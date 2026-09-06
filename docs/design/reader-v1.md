# Reader design contract v1

This document records the durable engineering decisions derived from the approved
Claude Design proposal for the Specra reader (direction "Reader with a contextual rail",
skinned **Glass**). The raw design package stays outside the repository; everything an
implementer needs to keep the reader faithful is here. Where a decision deviates from
the proposal, the deviation and its reason are listed at the end.

SPEC-004 implements the API reference subset of this contract. Later slices (schema
renderer, authored content, search, snippets, playground, versioning) extend the same
system; they must not replace it.

## Reader principles

- **Reading first.** One document column at a comfortable measure (680 px, 760 px on
  wide screens); body 17 px / 1.65. Density comes from hierarchy and whitespace, never
  from small text.
- **Hierarchy over decoration.** Breadcrumb → title → method and path → description →
  hairline-separated sections. The consumer's accent appears only in the brand mark,
  active states, links, and focus; it never sits behind text.
- **Honesty.** Nothing is rendered that the canonical artifact does not contain. A
  body-less response shows its status as the content; a missing description is
  omitted, not faked; capabilities owned by later slices are omitted rather than
  stubbed.
- **Progressive disclosure.** Sections are always present and deep-linkable; long
  content is grouped (parameters by location, responses by status) rather than
  collapsed by default.

## Layout

| Viewport                                  | Regions                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ≥ 1600 px                                 | Header 52 px · sidebar 248 px · document (max 760 px) · rail slot 480 px (reserved for SPEC-008/009) |
| 1180–1599 px (design 1440, verified 1366) | Header · sidebar 248 px · document 680–738 px · rail slot 380 px                                     |
| 768–1179 px (tablet)                      | Header · sidebar 224 px · document; no rail; examples fold inline in later slices                    |
| < 768 px (mobile)                         | Single column; sidebar becomes a left drawer (280 px + scrim) opened from the header menu button     |

SPEC-004 renders no rail. On laptops and desktops the document column is centred in the
space the rail would occupy, so the reading width never shrinks below 680 px at 1366 px.

### Glass mechanics

- Page background: brand-tinted radial gradients (`--page-bg`).
- Header, sidebar, and document are separate translucent panels: `--panel-bg`,
  `backdrop-filter: var(--panel-blur)`, 1 px `--panel-border`, 16 px radius,
  `--panel-shadow`, laid out with a 12 px gap and 12 px page padding (10 px on mobile).
- Code and example surfaces are raised cards on the panels (`--code-bg`, `--code-border`,
  `--code-shadow`).
- Fallbacks: no `backdrop-filter` → opaque panels; `prefers-reduced-transparency` →
  solid surfaces and no blur; blur capped at 12 px below 768 px; `forced-colors` →
  `Canvas` panels with a `CanvasText` border.
- The document panel itself does not blur (it is the largest surface and blurring it
  costs paint time on long pages); header, sidebar, and drawer do.
- CSS convention: `backdrop-filter` is written unprefixed only; the build adds the
  `-webkit-` prefix. Tokens are declared once in `tokens.css` (light on `:root`, dark
  under `[data-mode="dark"]` and the system-preference block), and component styles
  reference tokens rather than colours.

## Navigation

- **Global navigation** (header): consumer name plus "Docs", top-level tabs. SPEC-004
  shows only the tabs that exist (API reference). Guides, SDKs, Examples, Changelog,
  search, and the version selector arrive with their owning slices.
- **API navigation** (sidebar): one group per tag, mono uppercase eyebrow, items in
  canonical operation order with the HTTP method right-aligned in mono 10/700. Groups
  are rendered server-side as plain lists; hundreds of operations stay static HTML.
- **Active state**: `--active-bg` background, weight 500, 2 px inset brand bar on the
  left, `aria-current="page"`. The active item is scrolled into view without animation.
- **Collapsed behaviour**: groups are never collapsed on desktop; the sidebar scrolls
  independently under a sticky header.
- **Mobile**: the sidebar becomes a modal drawer (`<dialog>`) opened from a 44 px menu
  button; focus moves into the drawer, `Escape` and the scrim close it, and focus
  returns to the button.

## Typography

| Role           | Font           | Size / weight / line-height       |
| -------------- | -------------- | --------------------------------- |
| Display        | Space Grotesk  | 44 / 600 / 1.05, tracking −0.03em |
| Page title     | Space Grotesk  | 34 / 600 / 1.1, tracking −0.03em  |
| Section title  | Space Grotesk  | 14 / 600 / 1.2                    |
| Body           | IBM Plex Sans  | 17 / 400 / 1.65                   |
| Body small     | IBM Plex Sans  | 14.5 / 400 / 1.6                  |
| UI             | IBM Plex Sans  | 13.5 / 400 / 1.5                  |
| Meta (eyebrow) | JetBrains Mono | 11 / 500, tracking 0.12em, upper  |
| Code           | JetBrains Mono | 12.5–13 / 400 / 1.7               |
| Method label   | JetBrains Mono | 11–12 / 700, tracking 0.04em      |

Fonts are self-hosted variable OFL fonts (`@fontsource-variable`), served from the
application origin under `font-src 'self'`. The design references the same families,
so no substitution is needed.

## Spacing

Scale 4 · 8 · 12 · 16 · 24 · 32 · 40 · 48 · 64 px (`--space-1` … `--space-9`).
Radii 3 (chips) · 5 (controls) · 8 (code, cards) · 12 (media) · 16 (panels) · 18
(overlays). Document padding 44 px vertical / 56 px horizontal on desktop, 20 px on
mobile. Widths: header 52, sidebar 248/224, document 680/760, drawer 280.

## Surfaces

- **Page**: `--page-bg` gradient ground.
- **Panel**: translucent glass (header, sidebar, document).
- **Code surface**: raised card, mono, syntax colours `--syn-*`.
- **Overlay**: `--overlay-bg` + `--overlay-blur`, scrim `--scrim` (drawer).
- **Interactive state**: hover tints rows with `--surface-subtle`; active uses
  `--active-bg`; focus is a 2 px surface gap plus 3 px brand ring on every focusable
  element (`:focus-visible`), identical in both themes.

## Endpoint anatomy

In this order, each section deep-linkable:

1. Breadcrumb: API reference › group.
2. Title (H1, 34 px) and, when deprecated, a `DEPRECATED` badge.
3. Method label and path (mono 15; path struck through when deprecated) with a copy
   control.
4. Description, rendered as safe text with paragraph breaks preserved.
5. Deprecation callout (amber, glyph `!`, no left bar) when applicable.
6. `#authentication` — the OR-of-AND requirement list; an empty alternative reads
   "No authentication".
7. `#parameters` — grouped by location (`path`, `query`, `header`, `cookie`), each row
   on a 160 / 1fr grid: name (mono), type summary, `required` or `optional` in words,
   `deprecated` when set, description, constraints line (mono 12).
8. `#request-body` — required/optional, description, one block per media type with a
   schema summary and property rows for object bodies.
9. `#responses` — one `#response-<status>` block per response in deterministic order
   (numeric codes ascending, then `1XX`…`5XX` ranges, then `default`): status coloured by
   class, description, headers, and either media-type blocks or "No response body".
10. Servers: the service servers the operation applies to, as text.

## Themes

Light and dark are both first-class (`data-mode="light|dark"` on `<html>`; system
preference by default). The consumer supplies one `--brand`; `--brand-ink` derives a
text-safe accent (mixed 85 % toward black in light, 65 % toward white in dark). Method
colours: GET blue, POST green (= success), PUT/PATCH amber (= warning/deprecated),
DELETE red (= danger); other methods use the strong text colour. Muted text on dark is
`#9a9aa1` to hold 4.5:1 on the panel; the light amber is `#8a5a00` for the same reason,
and the smallest labels (eyebrows, flags, joiners, counts) use muted rather than faint
text so every reading-size string holds 4.5:1. The inactive primary tab uses
`--tab-inactive`.

## Interaction behaviour

- **Focus**: a 3 px opaque `--brand-ink` outline with 2 px offset everywhere (an outline
  rather than a shadow so it survives forced colours); skip link is the first focusable
  element and moves focus to `<main>`.
- **Expand/collapse**: not used for endpoint sections in v1 (always open).
- **Copy**: method-and-path copy control named "Copy <method> <path>"; the label becomes
  "Copied" for 1.2 s and a polite status region announces the result (or the failure)
  without renaming the control.
- **Responsive drawer**: native `<dialog>` modal that clones the server-rendered
  navigation on open and scrolls the current item into view; focus trapped by the
  platform, restored on close; reduced motion disables the slide. Without JavaScript the
  menu control is an in-page link that reveals the sidebar.
- **Large contracts**: above 150 operations the sidebar expands only the current group
  (others show a count) and the reference index previews eight operations per group.
- **Deep links**: heading ids are deterministic (`authentication`, `parameters`,
  `parameters-query`, `request-body`, `responses`, `response-201`, `response-4xx`,
  `response-default`); `:target` sections receive scroll margin below the sticky header.
- **Theme**: a form in the footer posts to `/theme`; the server stores a cookie and
  redirects back. No client script is needed and the choice survives without JS.

## Schema rendering

Schemas extend the endpoint anatomy rather than introducing a second visual system
(handoff screen D, `06c`):

- Property rows keep the 160/1fr grid; nested rows use 130 px keys, then 110 px.
- Nested structure sits under the row behind a native disclosure. The summary is a
  short label with a chevron (`▸ 3 properties`, `▸ items`, `▸ 3 variants`); open
  disclosures tint the summary with `--surface-subtle`, and children hang under a
  1 px `--border-strong` guide with 16 px indentation. After three levels the
  indentation stops growing and the guide alone marks depth; on mobile the
  indentation is 12 px and rows stack.
- Type phrases are mono 11.5 px muted in rows and 12.5 px strong at a block root;
  definition names replace shapes (`array of User`). Flags (`required`, `optional`,
  `read-only`, `write-only`, `deprecated`) are mono 11 px words.
- Variants are a numbered disclosure list in 1 px `--border` cards rather than the
  reference's segmented control, so every variant stays visible and comparable,
  works without script, and scales past four options. Discriminator values sit as
  small outlined chips on the variant summary and in a "Selected by `type`" line.
- Recursion is `↻ Name · recursive` in `--brand-ink` with an "Open" link; budget
  cut-offs use the same link treatment. Links are 12.5 px sans in `--brand-ink`.
- Enumerations are outlined chips (`--border`, radius `--radius-xs`, mono 11.5 px)
  with a preview of eight and a disclosure for the rest.
- The focused view reuses the page header (breadcrumb, eyebrow "Response schema ·
  Response 200 · application/json", 34 px title, method and path) and adds the
  design's drill-in trail (`Message › content › HtmlContent`) with the current
  segment on `--surface-subtle`.
- Forced colours: guides and chips take `CanvasText`, links take `LinkText`; reduced
  motion removes the chevron transition.

## Design deviations

| Element                                     | Status   | Reason                                                                                                                                                                       |
| ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context rail (Code / Try it)                | deferred | Generated snippets are SPEC-008 and execution is SPEC-009; the rail is omitted rather than faked                                                                             |
| One-line SDK example under the title        | deferred | SDK mapping is SPEC-008                                                                                                                                                      |
| Search field and ⌘K palette                 | deferred | Search is SPEC-007; a dead search trigger would mislead                                                                                                                      |
| Version selector                            | deferred | Versioning is SPEC-010                                                                                                                                                       |
| Guides / SDKs / Examples / Changelog tabs   | deferred | Owned by SPEC-006/008/010; only existing tabs render                                                                                                                         |
| Mobile bottom action bar (Code / Try it)    | deferred | Both actions belong to SPEC-008/009                                                                                                                                          |
| Consumer logo and brand colour              | adapted  | Config exposes only logo/favicon paths today; the reader renders the project name as the wordmark and a neutral default `--brand` until SPEC-006 wires branding              |
| "Expand schema" links and schema drill-in   | adapted  | SPEC-005: inline disclosures plus a focused view with the reference's breadcrumb trail; variants are a disclosure list instead of a segmented control (see Schema rendering) |
| Section collapse on mobile                  | adapted  | Sections stay open so deep links always land on visible content and no client script is required                                                                             |
| Errors / Next sections on endpoint pages    | deferred | Error catalogue and page sequencing arrive with SPEC-006/010                                                                                                                 |
| Homepage hero with install block and guides | adapted  | Authored content is SPEC-006; the home page is a minimal API-reference entry using the same type scale and surfaces                                                          |
