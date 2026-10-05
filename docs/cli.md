# CLI reference

The `specra` executable provides two commands. `specra validate` evaluates the configuration, confines every configured path, and runs the complete OpenAPI ingestion pipeline (parse, resolve, validate, normalize) without writing anything. `specra build` performs the same validation and then writes the canonical documentation artifact atomically. `dev` is reserved for the reader integration slice and is not an executable command yet.

## Run validation and build

From a project root containing `specra.config.ts`:

```bash
specra validate
specra build
```

From another directory:

```bash
specra validate --root ./path/to/project
specra build --root /absolute/path/to/project
```

Relative `--root` values resolve from the invocation directory. Specra canonicalizes the selected directory through the filesystem, then requires `specra.config.ts` at that root. Invoking from a nested directory does not search upward automatically; pass `--root` explicitly. Configured project paths accept `/` or `\` as portable separators; drive, UNC, root-relative, URL-like, null-byte, and traversal forms are rejected on every host.

Options (both commands):

| Option                            | Meaning                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `--root <path>`                   | Project root; defaults to the invocation directory               |
| `--json`                          | Emit exactly one machine-readable result to stdout               |
| `--config-timeout <milliseconds>` | Trusted config limit; default 5000, accepted range 100–60,000 ms |
| `--source-timeout <milliseconds>` | OpenAPI ingestion limit; default 30,000, range 100–600,000 ms    |
| `-h`, `--help`                    | Show command help                                                |

Use `specra --help` for top-level help and `specra <command> --help` for the exact command contract.

## Quality and diff commands

```bash
specra check
specra check --version v2 --from v1
specra diff --from v1 --to v2
```

`specra check` (SPEC-011) evaluates the candidate build — or a retained
release with `--version <id>` — against the project's quality policy. It is
read-only: it writes nothing, rebuilds nothing, and applies no fix. With
`--from <candidate|current|id>` it also runs the compatibility rules against
that base. `specra diff --from <source> [--to <source>]` prints the SPEC-010
structured diff between two documentation sets (`--to` defaults to the
candidate) and never fails because something changed. The rule catalogue,
policy model, suppression governance, and machine format are in the
[quality reference](quality.md).

Exit codes for `check`: `0` the gate passed, `3` the gate failed, `2` the
project or policy could not be read. A failed gate is deliberately a
different code from a configuration error.

## Release commands

Once a project has authors ready to publish, three catalog commands (SPEC-010) turn a candidate build into an immutable documentation release and manage the mutable `current` pointer. The full workflow, version grammar, redirect and changelog rules are in the [versioning reference](versioning.md).

```bash
specra release v2 --current --label "2.0" --date 2026-09-05
specra current v1
specra deprecate v1
```

| Command               | Meaning                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `release <version>`   | Verify the candidate in `.specra/artifacts` byte for byte, derive the release's route table and frozen redirects, validate `changelog/<version>.json` against the diff candidates, and promote one immutable release set atomically into `.specra/releases/<version>`; identical re-release is a no-op, different content fails with `VERSION_ALREADY_EXISTS`; the first release becomes current |
| `current <version>`   | Point the catalog's `current` alias at a retained release (used for rollback too); no release directory is touched                                                                                                                                                                                                                                                                               |
| `deprecate <version>` | Mark a retained release deprecated in the catalog (still served, with a notice); the current release cannot be deprecated                                                                                                                                                                                                                                                                        |

`release` options: `--current` (select after promotion), `--from <version>` (comparison base for the changelog's diff candidates; default the current release), `--no-diff` (no comparison, no changelog required), `--label <text>` (1–40 printable characters shown in the version menu), `--date <YYYY-MM-DD>`, plus `--root`, `--json`, and the timeouts of `build`. When a catalog exists, `build` also compares the candidate with the current release (or `--from`) and writes structured candidates to `.specra/candidates/diff.json`; the reader never serves that directory.

## What validation proves

A successful validation proves that:

- `specra.config.ts` evaluated within its bounded child-process lifecycle;
- its default export is bounded, JSON-serializable data accepted by config schema v1;
- configured OpenAPI files, docs directory, and optional branding files exist with the required type;
- existing source paths remain inside the canonical project root after symlink resolution;
- the fixed artifact destination can be resolved beneath that root;
- every configured OpenAPI document and every project-local file it references parsed within the ingestion budgets, resolved without escaping the project root or fetching anything, satisfied the supported OpenAPI 3.0/3.1 shape, and normalized into a canonical model v1 artifact that the model contract accepts.

Warnings (unsupported or partially represented constructs) do not fail validation; they are listed in human output and returned in JSON. Errors fail it. See the [OpenAPI ingestion reference](openapi.md) for the support matrix, limits, and every diagnostic.

## Build and the artifact directory

`specra build` writes `documentation.json` (the canonical artifact) and `manifest.json` (artifact format, model version, project, ordered sources with SHA-256 digests, statistics, diagnostic counts) into:

```text
.specra/artifacts
```

The location is beneath the canonical project root, separate from authored sources, and reserved for Specra-produced build data. Build stages the files in a sibling directory, moves any previous artifact directory aside, promotes the staged directory by rename, and only then removes the old one. A failed build removes any previous artifact directory so stale output never represents the current input; a `.specra/artifacts` entry that is a symlink is refused. Artifact bytes are deterministic: no timestamps, identifiers, or machine paths, so equal inputs produce identical files on any machine. `validate` never creates, cleans, or modifies the directory. Confinement is re-checked immediately before every filesystem access because paths can change after validation.

## Output and exit contract

Human success is written to stdout. Human validation/internal/cancellation diagnostics are written to stderr. With `--json`, a successful or failed result is the only content written to stdout and stderr stays empty. Config-process and ingestion-process stream and raw-descriptor output are captured and never mixed into either public format. Usage errors remain concise human output on stderr because parsing did not establish a valid machine-mode request.

Success JSON has this stable shape (`artifacts.files` and `artifacts.bytes` appear for `build` only; `content` counts authored pages and copied assets, both zero for an API-only project):

```json
{
  "artifacts": {
    "bytes": 1234,
    "directory": ".specra/artifacts",
    "files": [
      "documentation.json",
      "manifest.json",
      "content.json",
      "navigation.json",
      "assets/5cb94515a1027e4c.svg"
    ]
  },
  "content": { "assets": 1, "pages": 9 },
  "diagnostics": [],
  "ok": true,
  "search": { "documents": 63 },
  "sources": [{ "bytes": 65, "path": "openapi.yaml", "sha256": "…" }],
  "statistics": {
    "documents": 1,
    "operations": 1,
    "references": 0,
    "schemas": 0
  }
}
```

`specra check --json` writes `{ diagnostics, ok, quality }` where `quality` is the versioned evaluation envelope (`qualityFormat: 1`); `ok: false` with a `quality` block is a failed gate, without one it is a project or policy error. `specra diff --json` writes `{ diagnostics, diff, ok }` where `diff` is the SPEC-010 `diffFormat: 1` record, reused rather than re-invented. `candidates` (`build` only, when the project has released versions) reports the comparison base, the number of structured diff candidates written to `.specra/candidates/diff.json`, and whether the bounded output was truncated (SPEC-010); `release` returns `release` (`version`, `digest`, `current`, `unchanged`, `components`, `bytes`, `directory`, `changelog`, `from`, `candidates`) and `current`/`deprecate` return `catalog` (`current` and every retained release with its digest, state, and changelog flag). `search.documents` counts the search documents the project produces (SPEC-007); `snippets.operations` and `snippets.sdkExamples` count the code-sample projections and authored SDK examples (SPEC-008); `build` also lists `search.json` and `snippets.json` among the artifact files. `diagnostics` on a successful result contains warnings only. Failure JSON contains `ok: false` and ordered diagnostics with `code`, fixed value-safe `message`, optional safe `path`, and `severity` (`error` or `warning`). It contains no timestamps, process IDs, absolute machine paths, config or source values, exception messages, or stack traces.

Content diagnostics additionally carry `line` and `column` (1-based) for the offending node; the human report prints them as `[source/docs/guides/attachments.md:42:7]`. `path` uses one grammar for every diagnostic: `scope[#pointer]` where the pointer is an RFC 6901 JSON pointer. Scopes are `config` (`specra.config.ts` data, with `*` for user-chosen record keys and numeric indices for list positions, for example `config#/environments/*/baseUrl` or `config#/openapi/1`), `cli` (command options, `cli#/root`), `source/<project-relative path>` (a source document and pointer, for example `source/schemas/user.yaml#/properties/id`), and `artifact` (the artifact directory or a canonical model pointer). Errors sort before warnings, then by code, then by path with numeric pointer segments compared numerically, then by line and column.

| Exit | Meaning                                                           |
| ---: | ----------------------------------------------------------------- |
|    0 | Validation, build, check, or diff succeeded                       |
|    3 | `specra check` ran and the quality gate failed                    |
|    2 | Project, config, path, source, or normalization validation failed |
|   64 | Command usage was invalid                                         |
|   70 | Specra encountered an internal orchestration or write failure     |
|  130 | The command was cancelled by `AbortSignal`, SIGINT, or SIGTERM    |

Configuration and orchestration codes are stable within this contract; source codes are listed in the [OpenAPI ingestion reference](openapi.md#diagnostics):

| Code                                    | Action                                                                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_NOT_FOUND`                      | Add `specra.config.ts` directly under the selected root                                                                                                                                                          |
| `CONFIG_LOAD_FAILED`                    | Fix config syntax/runtime failure or excessive captured output                                                                                                                                                   |
| `CONFIG_TIMEOUT`                        | Remove hung work or deliberately raise the bounded timeout                                                                                                                                                       |
| `CONFIG_INVALID`                        | Correct the reported schema-v1 field                                                                                                                                                                             |
| `CONFIG_NOT_SERIALIZABLE`               | Return only bounded JSON data                                                                                                                                                                                    |
| `CONFIG_UNSUPPORTED`                    | Use supported `schemaVersion: 1`                                                                                                                                                                                 |
| `CONFIG_PATH_NOT_FOUND`                 | Create or correct the configured path                                                                                                                                                                            |
| `CONFIG_PATH_INVALID`                   | Correct the path's file/directory type or inaccessible state                                                                                                                                                     |
| `CONFIG_PATH_OUTSIDE_ROOT`              | Remove traversal/absolute paths or an escaping symlink                                                                                                                                                           |
| `PROJECT_ROOT_INVALID`                  | Select an existing accessible directory                                                                                                                                                                          |
| `INGESTION_TIMEOUT`                     | Raise `--source-timeout` or reduce the sources                                                                                                                                                                   |
| `INGESTION_FAILED`                      | Re-run and report a reproducible failure without secrets                                                                                                                                                         |
| `ARTIFACT_INVALID`                      | Report: the produced model was rejected by the contract                                                                                                                                                          |
| `ARTIFACT_WRITE_FAILED`                 | Check permissions; remove a symlinked `.specra/artifacts`                                                                                                                                                        |
| `SEARCH_BUILD_FAILED`                   | Report: the search index could not be generated from valid artifacts                                                                                                                                             |
| `SNIPPETS_BUILD_FAILED`                 | Report: the code samples could not be generated from valid artifacts                                                                                                                                             |
| `SNIPPET_BODY_TRUNCATED`                | Warning: a request body example hit the example budget; the schema is larger than the bounded example                                                                                                            |
| `SNIPPET_HEADER_SKIPPED`                | Warning: a header parameter name is not an HTTP token and is omitted from examples                                                                                                                               |
| `SNIPPET_SERVER_UNUSABLE`               | Warning: a contract server is relative, plain HTTP off loopback, or carries credentials/query/fragment; it is not offered as an environment                                                                      |
| `SDK_ID_DUPLICATE`                      | Fix: two `sdks` entries share an `id`                                                                                                                                                                            |
| `SDK_EXAMPLE_TARGET_NOT_FOUND`          | Fix: the example's `operation` matches no canonical operation                                                                                                                                                    |
| `SDK_EXAMPLE_TARGET_AMBIGUOUS`          | Fix: the target matches several services; add `service`                                                                                                                                                          |
| `SDK_EXAMPLE_DUPLICATE`                 | Fix: the operation already has an example for this SDK                                                                                                                                                           |
| `SDK_EXAMPLE_CODE_EMPTY`                | Fix: the example code (or file) is empty                                                                                                                                                                         |
| `SDK_EXAMPLE_CODE_TOO_LARGE`            | Fix: the example exceeds 16 KiB                                                                                                                                                                                  |
| `SDK_EXAMPLE_FILE_INVALID`              | Fix: the examples file or code file is missing, outside the project, not a file, or not the expected shape                                                                                                       |
| `SDK_EXAMPLE_MISSING`                   | Warning: the SDK is declared `complete` but the operation has no example (see the [code samples reference](code-samples.md#sdk-mappings))                                                                        |
| `PLAYGROUND_BUILD_FAILED`               | Report: the playground policy could not be derived from valid artifacts                                                                                                                                          |
| `PLAYGROUND_ENVIRONMENT_NOT_FOUND`      | Fix: `playground.environments` names an environment that is not configured                                                                                                                                       |
| `PLAYGROUND_ENVIRONMENT_ORIGIN_INVALID` | Fix: the approved environment's base URL is not an exact HTTPS (or loopback HTTP) origin without credentials, query, or fragment                                                                                 |
| `PLAYGROUND_OPERATION_UNSUPPORTED`      | Warning: the operation needs a cookie, a forbidden header, or an authentication scheme browsers cannot produce; it renders with an explanation instead of a form (see the [playground reference](playground.md)) |
| `VERSION_ID_INVALID`                    | Fix: use letters, digits, `.`, `_`, `-` (at most 64, alphanumeric at both ends, no `..`, not a reserved routing name, not a case variant of an existing release)                                                 |
| `VERSION_ALREADY_EXISTS`                | Fix: the release exists with different content; publish a new version id instead                                                                                                                                 |
| `VERSION_NOT_FOUND`                     | Fix: the version is not in the catalog                                                                                                                                                                           |
| `VERSION_IS_CURRENT`                    | Fix: select another release as current before deprecating this one                                                                                                                                               |
| `CATALOG_INVALID`                       | Report: `.specra/releases/catalog.json` is malformed, names a missing current, or disagrees with a release manifest; restore it from backup                                                                      |
| `CANDIDATE_MISSING`                     | Fix: run `specra build` before `specra release`                                                                                                                                                                  |
| `CANDIDATE_INVALID`                     | Fix: the candidate no longer matches its manifest (edited or partially written); run `specra build` again                                                                                                        |
| `RELEASE_MANIFEST_INVALID`              | Report: a retained release's manifest or component digests do not verify                                                                                                                                         |
| `RELEASE_WRITE_FAILED`                  | Check permissions; remove a symlinked `.specra/releases` or version directory                                                                                                                                    |
| `RELEASE_LOCKED`                        | Re-run: another release or catalog command holds the store lock                                                                                                                                                  |
| `RELEASE_LIMIT_EXCEEDED`                | Fix: the catalog holds the maximum of 200 releases                                                                                                                                                               |
| `DIFF_TRUNCATED`                        | Warning: more than 10,000 diff candidates; the file holds the first 10,000 in canonical order                                                                                                                    |
| `REDIRECT_SOURCE_INVALID`               | Fix: a redirect `from` is not an internal unversioned path (`/`, `/docs/…`, `/api/…`)                                                                                                                            |
| `REDIRECT_DESTINATION_INVALID`          | Fix: a redirect `to` is not an internal path with an optional anchor                                                                                                                                             |
| `REDIRECT_SOURCE_DUPLICATE`             | Fix: two redirects share a source                                                                                                                                                                                |
| `REDIRECT_SOURCE_SHADOWS_ROUTE`         | Fix: the source is a live route of this release                                                                                                                                                                  |
| `REDIRECT_DESTINATION_NOT_FOUND`        | Fix: the destination is neither a route of this release nor another redirect source                                                                                                                              |
| `REDIRECT_CYCLE`                        | Fix: redirects loop                                                                                                                                                                                              |
| `CHANGELOG_INVALID`                     | Fix: `changelog/<version>.json` is not a valid changelog source (shape, kinds, dates, lengths, text characters)                                                                                                  |
| `CHANGELOG_CANDIDATE_UNKNOWN`           | Fix: an item names a candidate id that the comparison did not produce                                                                                                                                            |
| `CHANGELOG_CANDIDATE_UNREVIEWED`        | Fix: a diff candidate is neither described by an item nor listed under `omitted` (or the changelog file is missing while candidates exist)                                                                       |
| `CHANGELOG_OPERATION_NOT_FOUND`         | Fix: an item's `operation` matches no operation of the release (or of the compared release for removals)                                                                                                         |
| `QUALITY_RULE_UNKNOWN`                  | Fix: the policy names a rule that does not exist; see the catalogue in docs/quality.md                                                                                                                           |
| `QUALITY_SEVERITY_INVALID`              | Fix: a rule severity must be off, info, warning, or error                                                                                                                                                        |
| `QUALITY_SUPPRESSION_INVALID`           | Fix: a suppression needs a known rule, an exact target, a plain-text reason of at most 200 characters, and an optional YYYY-MM-DD expiry                                                                         |
| `QUALITY_THRESHOLD_INVALID`             | Fix: `failOn` must be error, warning, info, or never, and `maxWarnings` a non-negative integer                                                                                                                   |
| `CANCELLED`                             | Re-run when ready                                                                                                                                                                                                |
| `INTERNAL_ERROR`                        | Re-run and report a reproducible failure without secrets                                                                                                                                                         |

Authored content and navigation codes (SPEC-006) are reported at `source/docs/<file>:line:column` or `config#/navigation/…`; warnings do not fail the build. The [content authoring reference](content-authoring.md) explains each rule.

| Code                                | Severity | Action                                                                                |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `CONTENT_FRONTMATTER_MISSING`       | error    | Start the page with a `---` frontmatter block containing `title`                      |
| `CONTENT_FRONTMATTER_INVALID`       | error    | Give `title` (and optional `description`, `sidebarTitle`, `slug`) valid string values |
| `CONTENT_FRONTMATTER_UNKNOWN_FIELD` | error    | Remove keys the schema does not define                                                |
| `CONTENT_PARSE_FAILED`              | error    | Fix the Markdown/MDX syntax at the reported location                                  |
| `CONTENT_HEADING_H1`                | error    | Remove the body `#` heading; the title is the H1                                      |
| `CONTENT_HEADING_SKIPPED`           | warning  | Do not skip heading levels                                                            |
| `CONTENT_HTML_FORBIDDEN`            | error    | Replace raw HTML with Markdown or a component                                         |
| `CONTENT_EXPRESSION_FORBIDDEN`      | error    | Remove `{…}` expressions                                                              |
| `CONTENT_ESM_FORBIDDEN`             | error    | Remove `import`/`export` statements                                                   |
| `CONTENT_COMPONENT_UNKNOWN`         | error    | Use Callout, Steps/Step, Cards/Card, Tabs/Tab, or CodeGroup                           |
| `CONTENT_COMPONENT_NESTING_INVALID` | error    | Follow the documented parent/child rules and keep components block-level              |
| `CONTENT_COMPONENT_PROP_INVALID`    | error    | Provide the required string props with allowed values                                 |
| `CONTENT_LINK_SCHEME_FORBIDDEN`     | error    | Use relative, `/docs`, `/api`, `#anchor`, `https`, `http`, or `mailto` links          |
| `CONTENT_LINK_TARGET_MISSING`       | error    | Point the link at an existing page or API route                                       |
| `CONTENT_LINK_ANCHOR_MISSING`       | warning  | Point the fragment at an existing heading or section id                               |
| `CONTENT_ASSET_NOT_FOUND`           | error    | Add the referenced image under the docs directory                                     |
| `CONTENT_ASSET_OUTSIDE_ROOT`        | error    | Move the image under the docs directory                                               |
| `CONTENT_ASSET_INVALID`             | error    | Use a relative path without absolute or malformed segments                            |
| `CONTENT_ASSET_UNSUPPORTED`         | error    | Use PNG, JPEG, WebP, or GIF (logo also SVG without scripts; favicon also ICO)         |
| `CONTENT_ASSET_TOO_LARGE`           | error    | Keep images under 2 MiB (20 MiB per project) and branding under 512 KiB               |
| `CONTENT_BUDGET_EXCEEDED`           | error    | Split the page or shorten the block that exceeds a documented budget                  |
| `CONTENT_UNSUPPORTED`               | error    | Remove footnotes, reference links, or inline images                                   |
| `CONTENT_SOURCE_OUTSIDE_ROOT`       | error    | Remove the symlink that escapes the docs directory                                    |
| `ROUTE_SLUG_INVALID`                | error    | Rename the file or folder to a kebab-case slug (at most four segments)                |
| `ROUTE_COLLISION`                   | error    | Remove one of the files that resolve to the same route                                |
| `NAVIGATION_PAGE_MISSING`           | error    | Reference an existing page slug in `navigation`                                       |
| `NAVIGATION_PAGE_DUPLICATE`         | error    | List each page once                                                                   |
| `NAVIGATION_PAGE_ORPHANED`          | warning  | Add the page to `navigation` or accept URL-only reachability                          |
| `NAVIGATION_API_DUPLICATE`          | error    | Include `{ api: true }` at most once                                                  |
| `NAVIGATION_DEPTH_EXCEEDED`         | error    | Nest sections at most two levels deep                                                 |
| `NAVIGATION_LINK_INVALID`           | error    | Use an `https://` or `http://` URL for external links                                 |
| `NAVIGATION_INVALID`                | error    | Correct the navigation node shape                                                     |

## Programmatic orchestration

Consumers can validate or build without spawning a process:

```typescript
import {
  buildProject,
  checkProject,
  diffDocumentation,
  releaseProject,
  validateProject,
} from "@specra/cli";

const controller = new AbortController();
const result = await validateProject({
  root: "./documentation",
  signal: controller.signal,
});

if (result.ok) {
  console.log(result.context.projectRoot);
  console.log(result.ingestion.statistics.operations);
  console.log(result.diagnostics); // warnings only
}

const checked = await checkProject({ root: "./documentation" });
if ("quality" in checked) console.log(checked.quality.summary);

const built = await buildProject({ root: "./documentation" });
if (built.ok) console.log(built.artifacts.files);

const released = await releaseProject({
  root: "./documentation",
  version: "v2",
  current: true,
});
if (released.ok) console.log(released.release.digest);
```

`releaseProject`, `selectCurrentRelease`, and `deprecateRelease` mirror the three catalog commands with the same options and results as their `--json` output. `checkProject` and `diffDocumentation` do the same for the quality and diff commands; the rule engine itself is `@specra/quality`, which is pure and usable on its own.

`createBuildContext` exposes the configuration and path stage alone for future command composition; it performs no ingestion and returns a `ContextResult` that carries only the context. A successful `BuildContext` contains the canonical project/config paths, validated config v1, resolved source paths, fixed artifact root, and caller cancellation signal. It deliberately contains no parser, renderer, content compiler, terminal, or process-exit object. Successful `validateProject` and `buildProject` results add an `ingestion` summary (project-relative source paths with byte sizes and SHA-256 digests, plus statistics) and warning diagnostics; `buildProject` adds the artifact summary.

The context is an immutable snapshot. `config` is typed as `ValidatedConfig`, a `DeepReadonly` view of config v1, and the context, config, and resolved paths are deep-frozen at runtime, so later commands can neither drift the config away from the paths that were confined from it nor replace those paths; attempted mutation throws under strict mode and the snapshot stays consistent. Derive changed values into new objects instead of editing the context.

## Packaging the private CLI

The workspace links `@specra/config`, `@specra/model`, and `@specra/openapi` into the CLI through pnpm symlinks, and packing the package directory directly follows those links into escaping `../` archive entries with duplicated dependency trees. Stage a self-contained tree first, then pack exactly the canonical path the script prints:

```bash
pnpm --filter @specra/cli... build
staged="$(node scripts/stage-cli-package.mjs /path/to/new/staging-directory)"
npm pack "$staged" --pack-destination /path/to/tarballs --ignore-scripts
```

The script copies the built CLI, config, model, and openapi distributions plus one dereferenced copy each of Zod and `yaml`, writes reduced manifests without lifecycle scripts, and prints the canonical staged path. Packing the workspace directory directly is refused by the package's `prepack` guard. Pack that printed path rather than a symlinked alias of it: npm keys the staged root by the path it is given but bundled dependencies by real path, and a symlinked root (such as macOS `/var` for `/private/var`) silently produces an archive with no bundled dependencies. The clean-room test performs the same staging, checks the archive topology, installs offline without warnings, and runs `validate` and `build` through both the binary and the programmatic API.

## Trusted executable configuration

`specra.config.ts` is trusted build code. It runs in a fresh child process with the same operating-system identity and ambient environment as the build except that `NODE_OPTIONS` is removed to prevent parent loaders and flags from being re-evaluated. The process improves lifecycle isolation: its process tree is terminated after result, timeout, cancellation, output overflow, or failure; raw and stream output are captured; it receives memory/stack hints; and only a revalidated bounded JSON frame crosses to orchestration. It is **not** a sandbox against a malicious repository owner. Deliberately detached descendants remain outside ordinary lifecycle containment, although they can no longer delay CLI exit by holding inherited pipes. The config host exits on its own when the orchestrating process disappears, unless it is still inside synchronous work at that moment.

OpenAPI sources are untrusted data, not code. They are parsed in a separate bounded ingestion host with the same lifecycle controls, read only through the CLI's confined acquisition policy, and never trigger network access; see the [OpenAPI ingestion reference](openapi.md) and [ADR-009](adr/009-openapi-ingestion-and-source-isolation.md).

Do not run TypeScript config from an untrusted repository with production credentials. Use an isolated least-privilege CI identity with only necessary environment values. Hosted/untrusted builds require the future data-only JSON/YAML mode from ADR-004.

The pinned Node 24 runtime loads erasable TypeScript syntax. Keep runtime configuration to normal imports, object data, type annotations, and `defineConfig`; TypeScript constructs that require JavaScript transformation rather than type erasure are unsupported. Local imports should use Node-compatible module paths. The config process deliberately does not re-evaluate custom Node execution flags or loaders from the invoking process.

## Troubleshooting

- **Config not found:** verify `--root`, remember there is no upward search, and place `specra.config.ts` directly at that root.
- **Config load failed:** check syntax, Node-compatible imports, runtime throws, early process exit, or excessive output. Normal output intentionally omits exception text and stacks to avoid secret disclosure.
- **Config timeout:** remove long-running work from configuration. Increase `--config-timeout` only when deliberate finite setup needs it.
- **Invalid config:** use `schemaVersion: 1`, strict documented keys, and the configuration reference. Unknown keys fail.
- **Path outside root:** remove absolute/traversal values and inspect every symlink component, including `.specra`.
- **Invalid artifact directory:** `.specra/artifacts` must either not exist or be a real directory inside the project. `validate` never deletes it; `build` replaces it atomically.
- **Source diagnostics:** see the [OpenAPI troubleshooting list](openapi.md#troubleshooting) for unsupported versions, invalid YAML/JSON, missing or escaping references, disabled remote references, size limits, capability warnings, identity collisions, cancellation, and parser timeouts.
- **Unsupported Node runtime:** use the exact Node and pnpm versions declared by the repository/package engine contract.
