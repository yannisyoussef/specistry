# Versioning, redirects, and changelog

A documentation version is an immutable release: the canonical API model,
authored content, navigation, search index, code samples, SDK mappings,
playground policy, assets, route table, redirects, and published changelog
frozen together and served under one identity. This page is the author and
operator reference; [ADR-016](adr/016-immutable-documentation-releases.md)
records the decisions and the [threat model](security/threat-model.md) the
controls.

## The model in one picture

```text
edit sources → specra validate → specra build → .specra/artifacts (mutable candidate)
                                              ↓
                             review .specra/candidates/diff.json
                                              ↓
                             write changelog/<version>.json
                                              ↓
                  specra release <version> [--current] → .specra/releases/<version> (immutable)
                                              ↓
                  specra current <version>  → catalog.json (the only mutable file)
                                              ↓
                             deploy the reader with the project root
```

`specra build` stays a candidate build: run it as often as you like while
editing. Nothing becomes a release until you say so.

## Creating a documentation version

```bash
specra build
specra release v1 --current --label "1.0" --date 2026-08-01
```

`specra release <version>` verifies the candidate in `.specra/artifacts`
against its manifest byte for byte, derives the release's route table and
frozen redirects, validates the changelog against the structured diff
candidates, stages the exact files, fsyncs and re-reads them, and promotes
the directory with one atomic rename into `.specra/releases/<version>`.
Nothing is rebuilt from sources during a release. The release manifest
(`release.json`) records every component's format version, size, and
SHA-256, the assets, and an aggregate digest; the catalog records the
digest again.

The first release becomes current. Later releases become current only with
`--current`, or later through `specra current <version>`.

Version ids are documentation-release identities: `v1`, `v1.2`, `1.2.0`,
`2026-09` are all valid. They use ASCII letters, digits, dots, underscores,
and hyphens (at most 64 characters, starting and ending alphanumeric, no
`..`), cannot be a reserved routing name (`current`, `latest`, `api`,
`docs`, `assets`, `search`, `theme`, `changelog`, `not-found`, `releases`,
`candidates`, `sitemap.xml`, `robots.txt`, `_next`), and cannot differ from
an existing release only by case. Nothing ties them to Git tags, package
versions, container tags, or API deployment versions.

## Modifying an old release

You cannot. Re-running `specra release v1` with an identical candidate is a
no-op; with different content it fails with `VERSION_ALREADY_EXISTS` and the
retained release is untouched. To correct a mistake, publish a new release
(`v1.1`, `2026-09-b`) and, if the old one should stop being recommended,
`specra deprecate v1`. Deprecation is catalog metadata: the release still
renders, with a deprecation notice and a `Deprecated` label in the version
menu; the current release cannot be deprecated.

## Making a release current, and rolling back

```bash
specra current v2
specra current v1   # documentation rollback
```

Both commands rewrite `.specra/releases/catalog.json` under a lock and
touch no release directory. `/`, `/docs`, and `/api` redirect (307) to the
current release; canonical versioned URLs do not change, so rolling back is
safe for search engines and bookmarks.

## Retention

Every published release is retained. There is no automatic pruning, no
"keep last N", and no delete command in this slice; back up the whole
`.specra/releases` directory and restore it as a unit. Assets are copied
into each release (content-addressed, small) and served by name across
releases, so removing a release directory by hand can only break that
release. If you ever remove one, its canonical URLs become real 404s; they
never redirect to the current release.

## Routes

Once a catalog exists the reader serves release mode:

| Route                                                | Meaning                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| `/docs/{version}`                                    | Release home (authored `index`, or the reference for API-only)    |
| `/docs/{version}/<slug...>`                          | Authored page, self-canonical                                     |
| `/docs/{version}/changelog`                          | Published release notes, when the release has them                |
| `/api/{version}[/<service>]/<group>/<operation>`     | API reference, self-canonical                                     |
| `/`, `/docs`, `/api`                                 | Mutable aliases: 307 to the current release, absent from sitemaps |
| `/docs/<slug>`, `/api/<...>` (unversioned, existing) | Legacy aliases: 307 to the same route in the current release      |
| Frozen author redirects inside a release             | 308 to the destination route of that release                      |
| Unknown version, unknown route, retired release      | 404, never a fallback to current                                  |

Every page inside a release links only to that release: navigation,
breadcrumbs, previous/next, authored links, generated API links, search
results, the Code rail, Try it anchors, and focused schema views. Search on
`/docs/v1` searches v1 only. Code samples, SDK examples, and the playground
policy are the release's own. Without a catalog (a project that never
released) the reader keeps the previous unversioned routes unchanged.

To preview the candidate instead of the releases on a machine that has a
catalog, start the reader with `SPECRA_SERVE=candidate`.

## Historical playground policy

Only the current release executes requests. Historical operation pages keep
their code examples, show "Try it is available on the current version
only" with a link to the current counterpart, and carry a Content Security
Policy of `connect-src 'self'`; the current release's API pages allow
exactly its approved origins. Credentials typed on one release never reach
another: switching versions is a full navigation and the playground vault
lives in the page's memory only. The non-secret environment id remembered
between pages is validated against the release being read.

## Redirects

Redirects are data in `specra.config.ts`, validated at build and release
time and frozen with each release:

```ts
redirects: [
  { from: "/docs/getting-started", to: "/docs/quickstart" },
  { from: "/api/inboxes/get-mailbox", to: "/api/inboxes/get-inbox#responses" },
],
```

Sources and destinations use the unversioned grammar (`/`, `/docs/<slugs>`,
`/api/<slugs>`, an optional anchor on destinations) and are scoped to the
release. A source may not be a live route (`REDIRECT_SOURCE_SHADOWS_ROUTE`)
or repeat (`REDIRECT_SOURCE_DUPLICATE`); a destination must exist in the
release (`REDIRECT_DESTINATION_NOT_FOUND`) or be another source, in which
case the chain is flattened; cycles fail (`REDIRECT_CYCLE`). Nothing can
name a scheme, host, query, backslash, or percent-encoded separator, so a
redirect can never leave the site. At most 10,000 redirects per release.

## Reviewing diff candidates

When a catalog exists, `specra build` compares the candidate with the
current release (or `--from <version>`) and writes structured candidates to
`.specra/candidates/diff.json`. The reader never reads that directory and
no artifact includes it. Candidates are identity-based and value-free:

| Kind                                               | Identity                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service-added`, `service-removed`                 | service id                                                                                                                                                                                                                                                          |
| `group-added`, `group-removed`                     | `service~tag`                                                                                                                                                                                                                                                       |
| `operation-added`, `operation-removed`             | `service~operation` (canonical id)                                                                                                                                                                                                                                  |
| `operation-changed`                                | same, with `changes` by aspect: method, path, title, description, deprecated, tags, parameter added/removed/changed, request media added/removed, request required, request schema, response added/removed, response media added/removed, response schema, security |
| `schema-added`, `schema-removed`, `schema-changed` | `service~schema id`                                                                                                                                                                                                                                                 |

An operation whose id changed appears as removed plus added; Specra never
guesses a rename. Schema and example changes are reported as digest
changes, never as values. There is no breaking-change label or score
(SPEC-011 owns that policy). Output is bounded to 10,000 candidates
(`DIFF_TRUNCATED` warns) and byte-identical across runs.

## Writing the changelog

The author's notes live in `changelog/<version>.json`:

```json
{
  "title": "Changelog",
  "summary": "API and SDK changes for version 2.",
  "from": "v1",
  "entries": [
    {
      "date": "2026-09-05",
      "items": [
        {
          "kind": "added",
          "operation": "openapi.yaml~waitForMessage",
          "candidates": ["v1..v2:operation-added:openapi.yaml~waitForMessage"],
          "text": "Wait synchronously for an incoming message."
        },
        {
          "kind": "changed",
          "target": "Inbox.expiresAt",
          "text": "Now uses RFC 3339."
        }
      ]
    }
  ],
  "omitted": ["v1..v2:schema-changed:openapi.yaml~schema_14ab563d3d387999"]
}
```

Item kinds are `added`, `changed`, `deprecated`, `removed`, and `fixed`.
`operation` names an operation of the release (or of the compared release
for removals) and renders as method and path with a link; `target` is a
free subject in mono text; `text` is plain text rendered as text. Every
diff candidate must be dispositioned: described by an item's `candidates`,
listed under `omitted`, or covered by `"omitted": "all"`; otherwise the
release fails with `CHANGELOG_CANDIDATE_UNREVIEWED`. A release with no
comparison base (`--no-diff`, or the first release) needs no changelog.

Specra publishes exactly what you wrote as `changelog.json`, at
`/docs/{version}/changelog`, with a Changelog tab in the header and,
once several releases publish notes, a release-history list. Specra does not automatically publish generated
changelog prose, and the private candidates never reach the reader, the
search index, the sitemap, or a browser bundle.

## Public and private

| Path                            | Visibility                                                 |
| ------------------------------- | ---------------------------------------------------------- |
| `.specra/artifacts`             | The candidate; served only in candidate mode               |
| `.specra/candidates/diff.json`  | Private review data; never served                          |
| `changelog/<version>.json`      | Author source; never served (the published copy is frozen) |
| `.specra/releases/<version>/*`  | Served under `/docs/{version}` and `/api/{version}`        |
| `.specra/releases/catalog.json` | Read by the reader; never served as a file                 |

## Migrating an existing site

A project with today's `.specra/artifacts` creates its first release with
`specra release <version>` (the candidate is promoted as is) and deploys the
reader with the same project root. From then on `/docs/<slug>` and
`/api/<...>` links redirect to the current release's routes with 307, `/`
and `/docs` redirect to the release home, and canonical URLs carry the
version. Nothing changes for a project that never releases.

## Operations

- **Deployment:** copy the whole project root (or at least
  `.specra/releases` and, for candidate mode, `.specra/artifacts`) to the
  reader host; the reader needs no historical sources.
- **Backup and restore:** back up `.specra/releases` as a unit; restore
  `catalog.json` to roll the current pointer back.
- **Integrity:** the reader refuses a release whose components do not
  match `release.json`, a manifest that does not match the catalog, and a
  catalog that names a missing current; restore from backup rather than
  editing by hand.
- **Memory:** the reader parses the catalog on first request and re-reads
  it only when the file changes (so `specra current` takes effect without a
  restart), loads each release on first request, and keeps at most four
  parsed releases; route tables and redirects are cached separately.
- **Sitemaps:** `/sitemap.xml` is an index of one sitemap per release
  (`/sitemaps/<version>.xml`, partitioned at 45,000 URLs); aliases never
  appear.
