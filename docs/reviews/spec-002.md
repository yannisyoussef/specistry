# SPEC-002 review record

Date: 2026-09-05

The Principal Engineer reviewed the thin CLI and build orchestrator before independent
review. Independent reviews covered product/DX and QA, security, and architecture.
Reviewers inspected the committed baseline `ca0e2cc` and the review-fix delta, then the
security and architecture reviewers re-reviewed the final worktree.

## Severity summary

- **P0:** 0.
- **P1:** 0 open; all 6 reported instances were resolved.
- **P2:** 0 open; all 13 reported instances (one engine finding overlapped between
  reviewers) were resolved, including the 6 raised by the final re-reviews.
- **P3:** 16 reported in the final re-reviews; 11 resolved, 5 tracked or accepted below.

## Resolved P1

| Finding                                                                                                       | Disposition                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.specra` or another nearest artifact ancestor could be a regular file and still validate (Product/QA).       | `resolveFutureProjectPath` requires every nearest existing ancestor to be a directory and treats `ENOTDIR` as invalid rather than missing; regression test "rejects a regular file blocking the artifact directory".                                         |
| Worker raw `fs.writeSync(1/2, ...)` bypassed stream capture and could contaminate JSON or leak (Security).    | Config evaluation moved to a detached child process whose fd1/fd2 are pipes; raw-descriptor and stream output are both captured, capped at 64 KiB, and discarded. Subprocess tests assert clean JSON stdout under raw writes.                                |
| Worker termination awaited native/synchronous work, so timeout was not hard (Security).                       | Timeout and cancellation `SIGKILL` the process group (POSIX) or the `taskkill` tree (Windows). Test "hard-stops native blocking work" bounds a blocking `execFileSync` config under one second.                                                              |
| Ordinary descendants could survive a successful config result (Security).                                     | The host stays alive after posting its fd3 frame and the parent always terminates the tree on settle. Test "terminates ordinary descendants after a successful config result" proves a spawned grandchild never writes its marker.                           |
| Child-process implementation contradicted the Worker-based ADR and documentation (Architecture).              | ADR-008, README, CLI, configuration, architecture, testing, dependency-policy, roadmap, and threat-model documents describe and justify the child-process/process-group boundary and its residual limits.                                                    |
| Direct `npm pack packages/cli` produced 828 escaping `../config/...` entries and a duplicate Zod tree (Arch). | `scripts/stage-cli-package.mjs` stages built CLI/config plus one dereferenced Zod copy and prints the canonical path; the clean-room test asserts no absolute or `..` entries and exactly one `node_modules/zod/package.json`. See packaging evidence below. |

## Resolved P2

- Worker protocol accepted `issuePaths: []`, producing failure JSON without actionable
  diagnostics (Product/QA): the protocol now rejects empty arrays and the orchestrator
  falls back to a `config` diagnostic when no path is present.
- Inherited `NODE_OPTIONS` was re-parsed by the fresh child (Security): removed from the
  child environment; regression test injects a bogus `--require`.
- Standard bidi marks and Unicode line/paragraph separators were not escaped
  (Security): presentation now escapes U+061C, U+200E/U+200F, U+2028/U+2029 in addition
  to C0/C1 and bidi embedding controls, with tests.
- Standalone CLI package lacked `engines.node` (Security and Architecture): the manifest
  and the staged manifest declare `>=24.20.0 <25`; the clean-room test checks the installed
  manifest.
- `BuildContext.config` was only shallow-readonly (Architecture): `contracts.ts` adds
  `DeepReadonly` and `ValidatedConfig`; the orchestrator deep-freezes the context, config,
  and resolved paths. The regression test checks `Object.isFrozen` at every level, that
  assignment, `push`, index replacement, `Object.assign`, and deletion all fail, that the
  serialized snapshot is unchanged, and that the type rejects nested writes at compile
  time.
- The architecture check only fully enforced the model package (Architecture):
  `scripts/check-architecture.mjs` now validates every package's source imports and all
  four manifest sections against the direction map, rejects undeclared internal imports
  and relative imports that leave a package, and rejects browser globals and opaque
  runtime loads in model/openapi/config/cli production code with one reviewed exception
  for the trusted-config host. Each rule has a self-test, and injected violations (an
  opaque load in the orchestrator, a forbidden manifest edge in config) fail the gate.
- Windows tree termination (Security hardening): uses the absolute
  `%SystemRoot%\System32\taskkill.exe /t /f`, checks its result, and falls back to a
  direct child kill.

## Packaging evidence

The clean-room Vitest case originally reported `bundled: []` with 45 entries while a
manual pack of the same staged tree reported 878 entries. The cause was not the archive:
npm keys the staged root by the path it is given and its bundled children by real path,
and `os.tmpdir()` on macOS is the symlinked `/var/folders/...`. Packing the identical
staged tree through `/var/...` yields 45 entries; packing through its real path yields
878 entries with `bundled: ["zod", "@specra/config"]`. The test now canonicalizes the
clean room and the staging script prints the canonical staged path, which the test
asserts. No topology assertion was weakened: packing `./packages/cli` directly still
produces 1,706 entries, 828 escaping `..` paths, and two Zod manifests, which the
assertions reject.

## Final re-reviews of the finished worktree

After the fixes above, the security and architecture reviewers re-reviewed the final
worktree (commit `6bee637` plus the security follow-up). Neither found a P0 or P1.

### Security re-review: P0 0, P1 0, P2 2, P3 5

| Finding                                                                                                                                                                              | Disposition                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2: the parent kept the child's pipe ends open after settling, so a detached descendant holding them stalled CLI exit (6 s measured) and turned an early exit into `CONFIG_TIMEOUT`. | Fixed. `finish` destroys stdout/stderr/control streams and unrefs the child; the loader settles on `exit` with a 100 ms frame grace instead of `close`. Regression "settles promptly when a detached descendant keeps inherited pipes open" bounds both the success and early-exit cases under 3 s.                                                                                    |
| P2: the config host outlived a force-killed parent indefinitely (held open by a timer in its own session).                                                                           | Fixed. The host now reads its control channel until EOF and exits when the parent's end closes. Regression "does not leave the config host orphaned when the parent disappears" releases the channel without a signal and observes exit code 0 within 3 s. Residual: a host blocked in synchronous work when the parent is force-killed survives until that work returns (documented). |
| P3: the frame cap was smaller than the child's accepted config size after JSON escaping, so near-limit configs reported `CONFIG_LOAD_FAILED` instead of `CONFIG_NOT_SERIALIZABLE`.   | Fixed. The host bounds the complete frame against the shared protocol cap and reports `not-serializable`.                                                                                                                                                                                                                                                                              |
| P3: `sanitizeTerminal` passed invisible format characters (`\p{Cf}`) through.                                                                                                        | Fixed. All `Cf` characters are escaped in addition to the explicit list; the presentation test was extended with U+200B, U+FEFF, U+00AD, U+2060, and U+E0041.                                                                                                                                                                                                                          |
| P3: a closed stdout (`specra validate --json \| true`) crashed with an `EPIPE` stack trace and exit 1.                                                                               | Fixed. The executable ignores `EPIPE` on stdout/stderr; regression "exits quietly when a consumer closes stdout early".                                                                                                                                                                                                                                                                |
| P3: the architecture checker did not attribute absolute, `file:`, or `#` specifiers, did not see `eval`/`Function`/`getBuiltinModule`, and skipped any nested `dist`.                | Fixed. Those specifiers now leave the boundary, those calls count as opaque loads, and only the package-root `dist`/`.next` are skipped; self-tests added.                                                                                                                                                                                                                             |
| P3: a group kill issued after the child was reaped could in theory target a recycled PID.                                                                                            | Accepted and documented in the threat model; this is the standard pattern for reaping orphaned group members.                                                                                                                                                                                                                                                                          |

Re-verified as fixed by the security reviewer: raw fd1/fd2 capture, hard timeout under
native blocking, descendant termination after success, `NODE_OPTIONS` removal,
bidi/separator escaping, `engines.node`, Windows `taskkill` fallback (by reading), and
empty `issuePaths` rejection. The reviewer also confirmed that the schema-derived issue
path redaction resolved a collision where a user environment key named `docs` had been
rejected by the old allowlist.

### Architecture re-review: P0 0, P1 0, P2 4, P3 11

| Finding                                                                                                                                | Disposition                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2: the CLI hand-copied the schema key vocabulary; a future schema key would surface as `CONFIG_LOAD_FAILED`.                          | Fixed. `@specra/config` exports `redactIssuePath` and `isRedactedIssuePath`, both derived from the schema; the host and loader use them; config tests round-trip every schema key and reject labels the schema cannot produce.                      |
| P2: the browser-global rule was name-based and would false-positive on an OpenAPI `document` variable.                                 | Fixed. The checker binds identifiers with a single-file TypeScript program and flags only unresolved globals, plus `globalThis` destructuring; negative and positive self-tests cover variables, parameters, imports, shorthand, and destructuring. |
| P2: the checker's package list was hand-maintained and unreconciled with the workspace.                                                | Fixed. Packages are discovered from `apps/*` and `packages/*`; a package without a boundary entry or an entry without a package fails the gate; one table holds the direction map.                                                                  |
| P2: the staging script and review record were untracked.                                                                               | Fixed by committing them.                                                                                                                                                                                                                           |
| P3: diagnostic path grammar differs between schema issues (`openapi.[]`) and resolved paths (`openapi[1]`), sorted in code-unit order. | Documented in `docs/cli.md` as stable within v1; unification is tracked for the SPEC-003 diagnostic contract.                                                                                                                                       |
| P3: direct `npm pack ./packages/cli` still produced the broken archive.                                                                | Fixed. A `prepack` guard refuses direct packs; the staged manifest carries no scripts.                                                                                                                                                              |
| P3: the staging script hardcoded dependencies and the clean-room test did not reconcile `bundled` with the manifest.                   | Fixed. The script fails if the CLI's declared dependencies differ from the staged set, and the test asserts the bundled set equals the staged manifest's dependencies.                                                                              |
| P3: `DeepReadonly` mangled functions and class instances.                                                                              | Fixed. Functions pass through unchanged and the type is documented as JSON-shape only.                                                                                                                                                              |
| P3: result typing forecloses warnings.                                                                                                 | Tracked for SPEC-003, which owns the broadened diagnostic contract; changing severity now would alter the documented JSON shape without a consumer.                                                                                                 |
| P3: out-of-range programmatic timeouts return `INTERNAL_ERROR` without a test.                                                         | Test added for the documented behaviour.                                                                                                                                                                                                            |
| P3: opaque-load rule narrower than the ADR wording; whole-file exception.                                                              | Fixed. Process-boundary modules are allowed only in the loader, and the host exception records an exact opaque-load count.                                                                                                                          |
| P3: the loader selects the built host when running from source.                                                                        | Tracked; `pretest` builds first and `docs/development/testing.md` documents the rebuild requirement.                                                                                                                                                |
| P3: staging usage text said "empty directory" but required a new directory.                                                            | Fixed.                                                                                                                                                                                                                                              |
| P3: consumers of the packed CLI cannot type-resolve `@specra/config` from the nested layout.                                           | Tracked for the publication decision (packages remain private); runtime resolution is provided by the host's resolve hook.                                                                                                                          |
| P3: timing-sensitive assertions may flake on loaded runners.                                                                           | Bounds widened while preserving the hard-stop property (a 4 s native block must finish under 3 s).                                                                                                                                                  |

## Tracked P3

| Finding                                                                         | Owner / exit condition                                                                                                                        |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Diagnostic path grammar and ordering differ between schema and resolved paths.  | SPEC-003 unifies the grammar when it extends the diagnostic contract; the current spellings are documented and stable.                        |
| Success results cannot carry warnings.                                          | SPEC-003 introduces `warning` severity together with its first warning-producing rule and updates `docs/cli.md`.                              |
| The loader hard-codes the built host path when running from source.             | Acceptable while `pretest` builds; revisit if an in-process host option is needed for SPEC-003 tests.                                         |
| Packed CLI consumers cannot type-resolve `@specra/config`.                      | Resolved at the publication decision by shipping `@specra/config` as a sibling dependency or adding a type-check step to the clean-room test. |
| Synchronous work in the host survives a force-killed parent; PID reuse on reap. | Accepted residuals documented in the threat model; no Node-only mitigation exists without native code.                                        |

## Verification

Final gates on the final commit are recorded in the pull request. Locally, on the
worktree that contains every fix above: `pnpm check` (format, lint, markdownlint, all
typechecks, 138 tests, architecture, dependency, license, and secret gates), `pnpm build`,
`pnpm test:coverage` above every repository and CLI floor, `pnpm install --frozen-lockfile`
with no lockfile drift, `pnpm audit --audit-level high` with no known vulnerabilities,
`pnpm test:e2e` (4 Chromium desktop/mobile cases), and an explicit staged pack/offline
install of the CLI all passed. Direct `npm pack ./packages/cli` was confirmed to still
produce the malformed archive (1,706 entries, 828 escaping paths, two Zod manifests) that
the clean-room assertions reject, and is now refused by the `prepack` guard.

## Principal Engineer decision

No P0 or P1 remains and every P2 is resolved. The tracked P3 items do not weaken the
SPEC-002 contract: exits, JSON shape, path confinement, cancellation, and process
lifecycle guarantees hold as documented, and each tracked item names an owner and an exit
condition outside this slice. SPEC-003 was not started.
