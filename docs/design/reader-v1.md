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

| Viewport                     | Regions                                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| ≥ 1600 px                    | Header 52 px · sidebar 248 px · document (max 760 px) · Code rail 480 px (SPEC-008)                                                             |
| 1440–1599 px (design 1440)   | Header · sidebar 248 px · document 684 px · Code rail 380 px                                                                                    |
| 1280–1439 px (verified 1366) | Header · sidebar 224 px · document 620–706 px · Code rail 340 px                                                                                |
| 768–1279 px (tablet)         | Header · sidebar 224 px · document; the Code section folds inline after the page header                                                         |
| < 768 px (mobile)            | Single column; sidebar becomes a left drawer (280 px + scrim) opened from the header menu button; a bottom bar links to the inline Code section |

Pages without a rail (guides, the homepage, the reference index) centre the document
column in the full width. On operation pages the rail appears from 1280 px rather than the
proposal's 1180 px: with a 380 px rail at 1180–1279 px the document would drop to about
520 px, so the rail folds inline there instead (measured in SPEC-008, see Code rail).

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

## Authored pages

Authored pages share the document column, type scale, and surfaces of the endpoint page. The frame is breadcrumbs (from the navigation trail), title, lede, an "On this page" outline (left rule, muted links, `##`/`###` only), the body, and a two-column previous/next pager that stacks on mobile. Body rhythm is `--space-4` between blocks with extra space above `##`/`###`. Components: callouts are tinted surfaces with a bordered glyph and the kind as text; steps are a numbered rail with a hairline connector; cards are `auto-fill` tiles with an arrow affordance; tabs and code groups are a bordered block whose header row becomes the tab list; code blocks keep the endpoint code surface with a header (title or language, copy control) and the nine syntax tokens (`--syn-*`). Tables live inside a bordered horizontal scroller. Images are bordered and never exceed the column. The sidebar composes authored sections (eyebrow titles) above the API reference, which is separated by a hairline and titled with the configured label. Branding: the accent replaces `--brand`, the logo replaces the mark at 20 px, the favicon comes from the assets route.

## Code rail (screens 5d and 5e, 3f, 6n)

The endpoint context rail renders in Code mode only. Anatomy, top to bottom: a `Code`
heading styled as the proposal's selected segment (ink pill, 12.5 px / 500) with a mono
eyebrow on the right reading `Protocol` or `Protocol · SDK`; the selectors (Environment,
Body format, Authentication) as labelled native selects in a responsive grid, present only
when there is more than one choice; the language control, a native select whose option
groups are `Protocol` (cURL, HTTP, JavaScript, TypeScript, Java, Python) and `SDK` (one
option per mapped SDK, labelled by the consumer, with the package shown in the panel
header) in place of the proposal's REST/SDK segmented control and language dropdown, so
the six-plus-N choices never overflow; the selected example on the code surface with the
`Copy <label> example` control, the SDK example's authored title and note when present;
the contract's first success-response example as `Response · 201`; and the placeholder
note. `Try it`, `Try this request`, the `Following · …` eyebrow, and the `Next` link are
omitted rather than faked (SPEC-009 and later).

Layout: from 1280 px the operation page is a grid of the document panel (painted by a
pseudo-element so header and sections share one surface) and the rail as its own glass
panel (`--panel-bg`, `--panel-blur`, panel border, 16 px radius), sticky under the header
with internal scrolling; widths per the table above. Below 1280 px the rail is a bordered
inline section after the page header (screen 3f); below 768 px a sticky bottom bar with a
single 44 px `Code` link (screen 6n, one action) jumps to it. Code blocks keep the
endpoint code surface, 12.5 px / 1.7 mono, and the nine syntax tokens; generated examples
carry structural token classes and SDK examples are highlighted at build time.

Interaction: language switching is instant and remembered for the session; environment,
body, and authentication changes are URL query state applied by a soft navigation that
keeps scroll and focus; copying copies the code only and announces politely; without
JavaScript the cURL example stays visible, the other languages are a native disclosure,
and the selectors submit with Apply. Forced colours keep CanvasText borders on the panel,
the selects, and the border-drawn chevrons; nothing animates.

### Homepage (screens 6a and 8c)

The homepage column widens to 1,080 px. `Hero`: mono eyebrow (12 px, wide tracking) → 44 px display title (the frontmatter title, with its period) → 18 px lede → ink "primary" and outline "secondary" buttons (40 px, 18 px padding, radius 5, press scale 0.98; 44 px on mobile). With media, the hero is a `minmax(0,1fr) 480px` grid with a 56 px gap, collapsing to one column below 1,180 px; the media frame is 16:10 with a 12 px radius, the brand radial glow, a 56 px frosted play disc, a 3 px track, the mono duration, and a 12.5 px caption row whose link sits right in the accent. Below the hero, `Install` and `Start here` share a two-column row (48 px gap): the Install eyebrow, mono chips (12.5 px, selected = primary colours), a raised command line with a `$` prompt and Copy, and a raised sample without header; Start-here rows are `1fr auto` with a 15/500 title, 13.5 px muted description, mono faint meta, and hairline dividers. The workflow strip is a four-column grid over a top hairline: number in `--brand-ink` mono, 15/500 title, muted 13.5 px body with code rendered as plain muted mono. Nothing on the homepage is a fake control: the play chrome is decorative and the caption link is the real path to the content.

### Search (screens 6e and 6p)

The header carries the Search control on the right: a 240 × 32 px field-shaped button (subtle surface, hairline border, radius 5) with the search glyph, "Search…" in faint text, and a mono `⌘K` (or `Ctrl K`) key cap; below 768 px it is a 44 px icon button. The palette is the one truly frosted overlay: a scrim with a 6 px blur, and a 640 px panel 120 px from the top on `--overlay-bg` with `--overlay-blur`, the panel border, radius 18, and the deep overlay shadow. Rows: a header row with the glyph, a 16 px input, and an `esc` key cap; groups titled by a mono eyebrow (API reference, Guides), ordered by which holds the best hit; result rows on a `52px 1fr auto` grid with 9 × 12 px padding and radius 5, the method (in its `--m-*` colour) or the kind (muted mono 10.5/700) in the first column, a 14 px title whose matched terms are 600 with a brand underline, a 12 px mono muted subtitle (path, or the breadcrumb trail), and a `⏎` cap on the active row, which takes `--active-bg`; a mono footer with "↑↓ move · ⏎ open · esc close" and "N results · M ms". Empty, loading, failure, and no-results states are one muted 14 px sentence in the panel. Below 768 px the panel becomes a full-screen sheet: the field row gains a "Cancel" text control, rows grow to 44 px and wrap, and the footer is dropped. The palette animates a 200 ms rise unless motion is reduced.

## Design deviations

| Element                                     | Status   | Reason                                                                                                                                                                                                                                                                                   |
| ------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context rail (Code / Try it)                | adapted  | SPEC-008: Code mode is implemented (see Code rail); `Try it`, `Try this request`, `Following` and `Next` are omitted rather than faked until SPEC-009; the REST/SDK segmented control and language dropdown became one grouped native select; the rail appears from 1280 px, not 1180 px |
| One-line SDK example under the title        | deferred | The design's inline SDK line needs a short authored form; SPEC-008 renders full authored SDK examples in the Code rail, and the inline line waits for evidence that a second copy helps                                                                                                  |
| Search field and ⌘K palette                 | done     | SPEC-007: header control with the platform key cap and the frosted command palette; the SDKs and Schemas result groups of the reference are not shown: schemas have no global route, and SPEC-008 indexes SDK labels with the operation instead of a standalone result                   |
| Version selector                            | deferred | Versioning is SPEC-010                                                                                                                                                                                                                                                                   |
| Guides / SDKs / Examples / Changelog tabs   | adapted  | SPEC-006 renders the `Guides` and `API reference` primary tabs; SDKs, Examples, and Changelog remain with SPEC-008/010                                                                                                                                                                   |
| Mobile bottom action bar (Code / Try it)    | adapted  | SPEC-008: a sticky bar with the single `Code` link to the inline Code section; `Try it` waits for SPEC-009                                                                                                                                                                               |
| Consumer logo and brand colour              | done     | SPEC-006: `branding.accent` sets `--brand` through a nonce style, `branding.logo` replaces the wordmark mark, `branding.favicon` sets the icon                                                                                                                                           |
| "Expand schema" links and schema drill-in   | adapted  | SPEC-005: inline disclosures plus a focused view with the reference's breadcrumb trail; variants are a disclosure list instead of a segmented control (see Schema rendering)                                                                                                             |
| Section collapse on mobile                  | adapted  | Sections stay open so deep links always land on visible content and no client script is required                                                                                                                                                                                         |
| Errors / Next sections on endpoint pages    | adapted  | SPEC-006 adds previous/next to authored pages with the API reference as one entry; an error catalogue on endpoint pages remains with SPEC-010                                                                                                                                            |
| Homepage hero with install block and guides | done     | SPEC-006: `Hero` (eyebrow, display title, lede, ink + outline actions, optional 16:10 media placeholder), `Install` chips with command and sample, `StartHere` rows, and the four-column workflow strip match screens 6a/8c; projects without docs keep the minimal API-reference entry  |
