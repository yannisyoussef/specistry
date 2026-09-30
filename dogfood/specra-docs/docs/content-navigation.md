---
title: Authored content and navigation
description: Write safe Markdown or controlled MDX and compose it with generated API pages.
---

Every page requires frontmatter with `title`; `description`, `sidebarTitle`, and `slug` are optional. The body may use Markdown plus the fixed Callout, Steps, Step, Cards, Card, Tabs, Tab, CodeGroup, Hero, Action, Media, Install, and StartHere component vocabulary.

Expressions, imports, exports, raw HTML, unknown components, non-string properties, and invalid nesting are build errors. Images must live below the docs root, match an allowed signature, and stay within byte budgets.

Navigation is configured independently of the filesystem. The same flattened order drives the sidebar, breadcrumbs, previous and next links, and the sitemap. Broken internal page, API, schema, and anchor links surface during the build.
