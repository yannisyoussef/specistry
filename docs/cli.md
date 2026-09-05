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

Success JSON has this stable shape (`artifacts.files` and `artifacts.bytes` appear for `build` only):

```json
{
  "artifacts": {
    "bytes": 1234,
    "directory": ".specra/artifacts",
    "files": ["documentation.json", "manifest.json"]
  },
  "diagnostics": [],
  "ok": true,
  "sources": [{ "bytes": 65, "path": "openapi.yaml", "sha256": "…" }],
  "statistics": {
    "documents": 1,
    "operations": 1,
    "references": 0,
    "schemas": 0
  }
}
```

`diagnostics` on a successful result contains warnings only. Failure JSON contains `ok: false` and ordered diagnostics with `code`, fixed value-safe `message`, optional safe `path`, and `severity` (`error` or `warning`). It contains no timestamps, process IDs, absolute machine paths, config or source values, exception messages, or stack traces.

`path` uses one grammar for every diagnostic: `scope[#pointer]` where the pointer is an RFC 6901 JSON pointer. Scopes are `config` (`specra.config.ts` data, with `*` for user-chosen record keys and numeric indices for list positions, for example `config#/environments/*/baseUrl` or `config#/openapi/1`), `cli` (command options, `cli#/root`), `source/<project-relative path>` (a source document and pointer, for example `source/schemas/user.yaml#/properties/id`), and `artifact` (the artifact directory or a canonical model pointer). Errors sort before warnings, then by code, then by path with numeric pointer segments compared numerically.

| Exit | Meaning                                                           |
| ---: | ----------------------------------------------------------------- |
|    0 | Validation or build succeeded (possibly with warnings)            |
|    2 | Project, config, path, source, or normalization validation failed |
|   64 | Command usage was invalid                                         |
|   70 | Specra encountered an internal orchestration or write failure     |
|  130 | The command was cancelled by `AbortSignal`, SIGINT, or SIGTERM    |

Configuration and orchestration codes are stable within this contract; source codes are listed in the [OpenAPI ingestion reference](openapi.md#diagnostics):

| Code                       | Action                                                         |
| -------------------------- | -------------------------------------------------------------- |
| `CONFIG_NOT_FOUND`         | Add `specra.config.ts` directly under the selected root        |
| `CONFIG_LOAD_FAILED`       | Fix config syntax/runtime failure or excessive captured output |
| `CONFIG_TIMEOUT`           | Remove hung work or deliberately raise the bounded timeout     |
| `CONFIG_INVALID`           | Correct the reported schema-v1 field                           |
| `CONFIG_NOT_SERIALIZABLE`  | Return only bounded JSON data                                  |
| `CONFIG_UNSUPPORTED`       | Use supported `schemaVersion: 1`                               |
| `CONFIG_PATH_NOT_FOUND`    | Create or correct the configured path                          |
| `CONFIG_PATH_INVALID`      | Correct the path's file/directory type or inaccessible state   |
| `CONFIG_PATH_OUTSIDE_ROOT` | Remove traversal/absolute paths or an escaping symlink         |
| `PROJECT_ROOT_INVALID`     | Select an existing accessible directory                        |
| `INGESTION_TIMEOUT`        | Raise `--source-timeout` or reduce the sources                 |
| `INGESTION_FAILED`         | Re-run and report a reproducible failure without secrets       |
| `ARTIFACT_INVALID`         | Report: the produced model was rejected by the contract        |
| `ARTIFACT_WRITE_FAILED`    | Check permissions; remove a symlinked `.specra/artifacts`      |
| `CANCELLED`                | Re-run when ready                                              |
| `INTERNAL_ERROR`           | Re-run and report a reproducible failure without secrets       |

## Programmatic orchestration

Consumers can validate or build without spawning a process:

```typescript
import { buildProject, validateProject } from "@specra/cli";

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

const built = await buildProject({ root: "./documentation" });
if (built.ok) console.log(built.artifacts.files);
```

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
