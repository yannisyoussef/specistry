# CLI reference

SPEC-002 provides one executable command: `specra validate`. It validates the configuration and filesystem policy that the orchestration layer owns. It does **not** parse or semantically validate OpenAPI yet; SPEC-003 owns that pipeline. `build` and `dev` are consequently not executable commands.

## Run validation

From a project root containing `specra.config.ts`:

```bash
specra validate
```

From another directory:

```bash
specra validate --root ./path/to/project
specra validate --root /absolute/path/to/project
```

Relative `--root` values resolve from the invocation directory. Specra canonicalizes the selected directory through the filesystem, then requires `specra.config.ts` at that root. Invoking from a nested directory does not search upward automatically; pass `--root` explicitly. Configured project paths accept `/` or `\` as portable separators; drive, UNC, root-relative, URL-like, null-byte, and traversal forms are rejected on every host.

Options:

| Option                            | Meaning                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `--root <path>`                   | Project root; defaults to the invocation directory               |
| `--json`                          | Emit exactly one machine-readable result to stdout               |
| `--config-timeout <milliseconds>` | Trusted config limit; default 5000, accepted range 100–60,000 ms |
| `-h`, `--help`                    | Show command help                                                |

Use `specra --help` for top-level help and `specra validate --help` for the exact command contract.

## What validation proves

A successful SPEC-002 validation proves that:

- `specra.config.ts` evaluated within its bounded child-process lifecycle;
- its default export is bounded, JSON-serializable data accepted by config schema v1;
- configured OpenAPI files, docs directory, and optional branding files exist with the required type;
- existing source paths remain inside the canonical project root after symlink resolution;
- the fixed future artifact destination can be resolved beneath that root.

It does not prove that an OpenAPI document is valid, resolvable, or normalizable. The command says so in both help and successful human output.

## Artifact directory

Equivalent project roots and configuration always select:

```text
.specra/artifacts
```

The location is beneath the canonical project root, separate from authored sources, and reserved for Specra-produced build data. `validate` only calculates the location; it does not create, clean, or modify it. If `.specra` or `artifacts` already resolves through a symlink outside the project, validation fails. Future writers must repeat confinement checks immediately before access because filesystem paths can change after validation.

## Output and exit contract

Human success is written to stdout. Human validation/internal/cancellation diagnostics are written to stderr. With `--json`, a successful or failed validation result is the only content written to stdout and stderr stays empty. Config-process stream and raw-descriptor output are captured and never mixed into either public format. Usage errors remain concise human output on stderr because parsing did not establish a valid machine-mode request.

Success JSON has this stable shape:

```json
{
  "artifacts": { "directory": ".specra/artifacts" },
  "diagnostics": [],
  "ok": true
}
```

Failure JSON contains `ok: false` and ordered diagnostics with `code`, fixed value-safe `message`, optional safe `path`, and `severity`. It contains no timestamps, process IDs, absolute machine paths, config output, exception messages, or stack traces.

`path` is value-free and derived from the schema authority in `@specra/config`: schema validation issues use dotted schema keys with `*` for user-chosen record keys and `[]` for array positions (for example `environments.*.baseUrl` or `openapi.[]`), `config` names the whole document, `default` names a missing default export, and resolved-path diagnostics use the configured key with a numeric index only when the value is a list (`openapi`, `openapi[1]`). Diagnostics sort by code and then by path in code-unit order; both spellings and the ordering are stable within v1 and will be unified when the diagnostic contract grows in SPEC-003.

| Exit | Meaning                                                       |
| ---: | ------------------------------------------------------------- |
|    0 | Configuration/orchestration validation succeeded              |
|    2 | Project, config, path, or config-process validation failed    |
|   64 | Command usage was invalid                                     |
|   70 | Specra encountered an internal orchestration failure          |
|  130 | Validation was cancelled by `AbortSignal`, SIGINT, or SIGTERM |

Diagnostic codes are stable within this contract:

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
| `CANCELLED`                | Re-run when ready                                              |
| `INTERNAL_ERROR`           | Re-run and report a reproducible failure without secrets       |

## Programmatic orchestration

Consumers can validate without spawning a process:

```typescript
import { validateProject } from "@specra/cli";

const controller = new AbortController();
const result = await validateProject({
  root: "./documentation",
  signal: controller.signal,
});

if (result.ok) {
  console.log(result.context.projectRoot);
  console.log(result.context.paths.artifactRoot);
}
```

`createBuildContext` exposes the same typed orchestration operation for future command composition. A successful `BuildContext` contains the canonical project/config paths, validated config v1, resolved source paths, fixed artifact root, and caller cancellation signal. It deliberately contains no parser, renderer, content compiler, terminal, or process-exit object.

The context is an immutable snapshot. `config` is typed as `ValidatedConfig`, a `DeepReadonly` view of config v1, and the context, config, and resolved paths are deep-frozen at runtime, so later commands can neither drift the config away from the paths that were confined from it nor replace those paths; attempted mutation throws under strict mode and the snapshot stays consistent. Derive changed values into new objects instead of editing the context.

## Packaging the private CLI

The workspace links `@specra/config` into the CLI through pnpm symlinks, and packing the package directory directly follows those links into escaping `../config/...` archive entries with a duplicated Zod tree. Stage a self-contained tree first, then pack exactly the canonical path the script prints:

```bash
pnpm --filter @specra/cli... build
staged="$(node scripts/stage-cli-package.mjs /path/to/empty/staging-directory)"
npm pack "$staged" --pack-destination /path/to/tarballs --ignore-scripts
```

The script copies the built CLI and config distributions plus one dereferenced Zod copy, writes reduced manifests without lifecycle scripts, and prints the canonical staged path. Packing the workspace directory directly is refused by the package's `prepack` guard. Pack that printed path rather than a symlinked alias of it: npm keys the staged root by the path it is given but bundled dependencies by real path, and a symlinked root (such as macOS `/var` for `/private/var`) silently produces an archive with no bundled dependencies. The clean-room test performs the same staging, checks the archive topology, installs offline without warnings, and runs the binary and programmatic API.

## Trusted executable configuration

`specra.config.ts` is trusted build code. It runs in a fresh child process with the same operating-system identity and ambient environment as the build except that `NODE_OPTIONS` is removed to prevent parent loaders and flags from being re-evaluated. The process improves lifecycle isolation: its process tree is terminated after result, timeout, cancellation, output overflow, or failure; raw and stream output are captured; it receives memory/stack hints; and only a revalidated bounded JSON frame crosses to orchestration. It is **not** a sandbox against a malicious repository owner, and deliberately detached descendants remain outside ordinary lifecycle containment.

Do not run TypeScript config from an untrusted repository with production credentials. Use an isolated least-privilege CI identity with only necessary environment values. Hosted/untrusted builds require the future data-only JSON/YAML mode from ADR-004.

The pinned Node 24 runtime loads erasable TypeScript syntax. Keep runtime configuration to normal imports, object data, type annotations, and `defineConfig`; TypeScript constructs that require JavaScript transformation rather than type erasure are unsupported. Local imports should use Node-compatible module paths. The config process deliberately does not re-evaluate custom Node execution flags or loaders from the invoking process.

## Troubleshooting

- **Config not found:** verify `--root`, remember there is no upward search, and place `specra.config.ts` directly at that root.
- **Config load failed:** check syntax, Node-compatible imports, runtime throws, early process exit, or excessive output. Normal output intentionally omits exception text and stacks to avoid secret disclosure.
- **Config timeout:** remove long-running work from configuration. Increase `--config-timeout` only when deliberate finite setup needs it.
- **Invalid config:** use `schemaVersion: 1`, strict documented keys, and the configuration reference. Unknown keys fail.
- **Path outside root:** remove absolute/traversal values and inspect every symlink component, including `.specra`.
- **Invalid artifact directory:** `.specra/artifacts` must either not exist or resolve to a directory inside the project. `validate` never deletes it.
- **Unsupported Node runtime:** use the exact Node and pnpm versions declared by the repository/package engine contract.
