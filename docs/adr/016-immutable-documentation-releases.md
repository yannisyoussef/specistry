# ADR-016: Immutable documentation releases, current alias, and reviewed changelogs

## Status

Accepted (SPEC-010). Implements the versioning and changelog decisions of
[ADR-003](003-build-time-artifacts-search-and-versioning.md).

## Context

A documentation version must be one immutable, coherent release set:
canonical API model, authored content, navigation, search, snippets, SDK
mappings, playground policy, assets, route table, redirects, and published
changelog frozen together. Serving v1 content with v2 search, or a
historical page that quietly becomes whatever is newest, would make
historical documentation untrustworthy. At the same time, ordinary local
development must stay a mutable candidate build, and the roadmap requires
`/docs/{version}` to be immutable and self-canonical while `/docs`
redirects non-permanently to the selected current release and never
appears in sitemaps.

## Decision

1. **Candidate versus release.** `specra build` keeps writing the mutable
   candidate under `.specra/artifacts`. Only the explicit
   `specra release <version>` promotes the exact validated candidate into
   `.specra/releases/<version>`: every candidate file is verified against
   its manifest, the route table, the frozen redirects, and the reviewed
   changelog are derived, the set is staged, fsynced, verified again, and
   promoted with one atomic rename. A crash leaves at most a staging
   directory the reader ignores.
2. **Immutability.** A release manifest (`release.json`, format 1) records
   every component with its format version, byte size, and SHA-256, the
   content-addressed assets, and an aggregate digest of the component set.
   Re-releasing identical bytes under the same id is an idempotent no-op;
   different bytes fail with `VERSION_ALREADY_EXISTS`. Nothing rewrites a
   release directory after promotion; there is no prune or edit command.
3. **Version identity.** A version id is a documentation-release identity
   (`v1`, `v1.2`, `1.2.0`, `2026-09`): ASCII letters, digits, dots,
   underscores, and hyphens, at most 64 characters, no dot segments, not a
   reserved routing name, and unique case-insensitively within a catalog.
   It is never derived from Git, packages, containers, or deployment
   metadata.
4. **Catalog and current alias.** `catalog.json` (format 1) is the only
   mutable file: the explicit `current` pointer, every retained release in
   creation order with its digest, lifecycle state (`supported` or
   `deprecated`), and optional author-provided label and date. `specra
current <version>` and `specra deprecate <version>` rewrite the catalog
   only, under a lock; the first release becomes current, later ones only
   with `--current`. Current is never inferred from ordering, SemVer, or
   file times, and a catalog naming a missing current fails closed.
5. **Routes.** Once a catalog exists the reader serves release mode:
   `/docs/{version}` is the release home, `/docs/{version}/<slug>` an
   authored page, `/docs/{version}/changelog` the published notes,
   `/api/{version}[/<service>]/<group>/<operation>` the reference. Every
   such page is self-canonical and indexable. `/`, `/docs`, and `/api` are
   mutable aliases that redirect with 307 to the current release, as do
   legacy unversioned routes that exist in the current release. Frozen
   author redirects use 308 inside their release. An explicit version that
   is not retained, or a route a release does not have, is a real 404;
   nothing falls through to current. Without a catalog the reader behaves
   exactly as before (candidate mode), so unversioned projects are
   unaffected until they release.
6. **Release-scoped loading.** The reader reads the small catalog first,
   then the requested release's manifest, then its components, each
   verified against the manifest digest before parsing; a component
   swapped in from another release is refused even when well-formed. Parsed
   releases live in a bounded cache keyed by version and aggregate digest
   (four releases); route tables and redirects in a separate small cache.
   Every href, breadcrumb, navigation entry, search result route, snippet,
   SDK example, asset, and playground policy comes from the release being
   served, mapped into its roots once at load time.
7. **Historical execution.** Only the current release's playground policy
   reaches the browser and its origins reach `connect-src`, on that
   release's API routes only. Historical operation pages keep Code and show
   a note pointing at the current counterpart; their CSP stays
   `connect-src 'self'`. Credentials never survive a version switch: the
   switch is a full navigation and the memory-only vault is per page.
8. **Redirects are data.** `redirects` in the configuration list internal
   sources and destinations in the unversioned grammar; the release
   validates them against its route table (grammar, duplicates, shadowing,
   destination existence, chains flattened, cycles rejected) and freezes the
   result. No scheme, host, query, or encoded separator can appear, so no
   redirect can leave the site.
9. **Structured diff candidates, human review, no generated prose.**
   `specra build` compares the candidate with the comparison base (the
   current release, or `--from`) into `.specra/candidates/diff.json`:
   deterministic, identity-based records (service, group, operation,
   schema added, removed, or changed with aspect-level detail), removed
   plus added rather than any rename guess, digests instead of values, no
   breaking-change label or score, bounded. The reader never reads that
   directory. `specra release` requires the author's
   `changelog/<version>.json` to disposition every candidate (described by
   an item, or listed as `omitted`, or `"omitted": "all"`); only the
   author's text is published as `changelog.json`, served at
   `/docs/{version}/changelog` and indexed with the release.

## Consequences

- Positive: historical URLs are truthful forever; rollback is a catalog
  edit; releases are reproducible from retained artifacts alone;
  redirects and diff candidates cannot leak or mislead; the reader's memory
  is bounded by the cache, not by the number of releases.
- Negative: canonical URLs gain a version segment, so unversioned links
  become aliases (redirects) once a project releases; historical pages
  cannot execute requests; a large diff requires an explicit disposition
  (`"omitted": "all"` exists for that).
- Neutral: assets are copied per release (content-addressed, shared by
  name across releases at serve time); the store grows with each release
  and nothing prunes it automatically.

## Alternatives rejected

- Deriving versions from Git tags or package versions (couples
  documentation to deployment).
- Inferring current from the highest version (ids are not SemVer).
- Mutating a release in place to fix a typo (breaks the immutability
  guarantee; publish a new release instead).
- Cross-version search or a union CSP (leaks and widens pages as versions
  accumulate).
- Generated changelog prose (SPEC-010 forbids it; SPEC-011 owns richer
  diff policy and the public `specra diff`).
