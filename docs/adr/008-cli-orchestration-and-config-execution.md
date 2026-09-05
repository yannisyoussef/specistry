# ADR-008: CLI orchestration and trusted config execution

## Status

ACCEPTED — 2026-09-05

## Context

SPEC-002 introduces the first author-facing command and a programmatic context that later ingestion and rendering slices can reuse. The command must load trusted `specra.config.ts` code without importing it into the long-lived orchestration thread, must return only validated data, and must establish a deterministic artifact location without beginning OpenAPI ingestion.

## Problem

Which package and execution boundary keep the CLI thin, make cancellation and diagnostics deterministic, constrain accidental config failures, and preserve the existing model/config dependency direction?

## Constraints

- `@specra/config` remains the only configuration-schema authority.
- `@specra/model` remains independent of CLI and process concepts.
- Trusted executable config is not a security sandbox and retains the consumer build's operating-system authority.
- Normal output cannot contain config logs, stack traces, secret-bearing exception text, terminal controls, or volatile fields.
- Source and artifact paths must remain beneath the canonical project root after symlink resolution.
- SPEC-003, not this slice, owns OpenAPI ingestion and operational `build`/`dev` commands.

## Considered options

1. **Import config in the CLI thread:** smallest implementation, but hung code, global mutation, output, and retained handles contaminate the orchestrator and cannot be cancelled cleanly.
2. **Worker Thread with bounded protocol:** separate JavaScript realm and low startup cost, but raw file-descriptor writes share the caller's stdout/stderr, synchronous native work can delay termination, and descendants outlive the worker.
3. **Child process and process group:** stronger process-failure, raw-output, native-block, and ordinary-descendant containment at higher startup/lifecycle cost; its protocol can still be spoofed by trusted code and it is not an operating-system sandbox.
4. **General JavaScript sandbox:** misleading without an operating-system isolation product and outside Specra's local trusted-config model.

## Decision

Create `@specra/cli` as the orchestration and executable boundary. It may currently depend only on `@specra/config`; architecture checks enforce that SPEC-003 parser dependencies have not leaked in. Its `validateProject` and `createBuildContext` APIs return typed results and never write to a terminal or exit a process. A successful `BuildContext` is a deep-frozen snapshot with a deeply readonly config type, so consumers cannot drift the validated config away from the paths confined from it. The executable owns parsing, presentation, signals, and exit-code projection.

Evaluate the fixed root `specra.config.ts` in a fresh detached Node child process. Node 24's built-in erasable-TypeScript support loads the file; `@specra/config` resolution is mapped to the CLI's reviewed dependency. Capture and discard both stream and raw-descriptor stdout/stderr with a 64 KiB aggregate limit. Use a 5-second default timeout, configurable only from 100 to 60,000 milliseconds, V8 memory/stack hints, and mandatory process-tree termination after success, failure, timeout, or abort. POSIX uses a dedicated process group; Windows uses the operating system's tree-aware `taskkill` utility with a direct-child kill fallback. Remove `NODE_OPTIONS` from the child environment so parent loaders and execution flags are not re-evaluated.

Before schema parsing, reject cycles, accessors, symbols, functions, non-finite numbers, non-plain instances, excessive depth/nodes, and results above 1 MiB. Parse with `@specra/config` inside the child, transfer one bounded JSON frame over a dedicated file descriptor, then parse and validate it again in orchestration. Treat the child protocol as untrusted: accept only exact message shapes and bounded allowlisted non-empty issue paths, and never transfer exception messages or stacks.

Canonicalize the project root with `realpath`. Existing configured paths must exist with their required type and their real path must be beneath that root. For future output, resolve the nearest existing ancestor and fail closed if it resolves outside; revalidation before later writes remains mandatory because path checks cannot eliminate filesystem races. The fixed artifact root is `.specra/artifacts`; validation calculates it but creates or deletes nothing.

Use no CLI framework. SPEC-002 has one command and three options, so a small explicit parser has less dependency and output surface. A release-staging script dereferences the built config package and its single Zod copy into an isolated package tree and prints its canonical path before `npm pack`; the packaged private CLI therefore installs in a clean room without workspace links, duplicate dependency trees, or escaping tar paths. Packing must use that canonical path because npm drops bundled dependencies behind a symlinked root.

## Consequences

- Positive: thin/testable CLI, deterministic results and exits, cancellable config evaluation, clean JSON stdout, stable future orchestration context, and no model pollution.
- Negative: a child process does not contain malicious trusted code; config can still read environment/files or perform network/process actions available to the build identity, and deliberately detached descendants can evade ordinary tree lifecycle policy (they cannot, however, hold the orchestrator open through inherited pipes, and the host exits when the orchestrator's control channel closes unless it is blocked in synchronous work). Node's built-in loader accepts erasable TypeScript, not every transform-requiring TypeScript feature.
- Negative: realpath validation is point-in-time; later readers/writers must revalidate and avoid following replaced symlinks.
- Neutral: `build` and `dev` remain absent until SPEC-003 supplies a real ingest-to-reader pipeline.

## Risks and mitigations

- A hung or noisy config consumes resources: bounded output, time, structured result size, resource hints, cancellation, and forced termination.
- A config error contains a secret: exception values/stacks and captured output never enter public diagnostics; canary tests cover runtime errors and protocol spoofing.
- Platform path behavior differs: host-realpath tests cover actual symlinks and pure POSIX/Windows tests cover separators, drives, case, UNC, traversal, and sibling-prefix cases.
- A consumer mistakes isolation for hostile-code safety: CLI/config documentation states the trusted-code rule and requires secret-minimized, least-privilege builds.

## Security implications

The child process is operational isolation, not a sandbox. Hosted or untrusted repository execution still requires the data-only configuration mode and stronger infrastructure isolation defined by ADR-004. Artifact deletion is not implemented; any future clean operation must revalidate the fixed owned root and fail closed.
