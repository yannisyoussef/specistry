# Test strategy

## Principles

Tests assert semantics, invariants, diagnostics, security boundaries, and user behavior. Snapshots are limited to stable serializations or visual baselines and never substitute for intent. Fixtures include realistic contracts and adversarial structures. Randomized tests use recorded seeds.

SPEC-001 includes a committed canonical v1 golden artifact, a clean public-consumer
type contract, a recorded-seed permutation test, compatibility rejection for future
versions, hostile structure/limit cases, and broad/deep registry performance smoke
coverage.

## Layers

| Layer                   | Ownership and examples                                          | Phase 0 state                                            |
| ----------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| Unit                    | Model invariants, config defaults, reference classification     | Running                                                  |
| Parser/resolver         | YAML/JSON errors, refs, cycles, OpenAPI dialects                | Parser boundary running; full resolver in SPEC-003       |
| Normalization           | Determinism and semantic mappings                               | Model v1 semantics, permutation/round-trip tests running |
| Security                | limits, aliases, remote refs, script-looking values, redaction  | Running foundation cases                                 |
| Architecture            | forbidden package dependencies and raw-model leakage            | Running                                                  |
| Component/accessibility | rendering states, keyboard behavior, axe                        | Foundation page running                                  |
| CLI/orchestration       | worker config, root paths, diagnostics, exits, cancellation     | SPEC-002 subprocess/security tests running               |
| Integration             | config → source → canonical artifact → routes                   | Planned with ingestion slice                             |
| Browser E2E             | HTTP headers, metadata, keyboard skip flow, axe, 320 px reflow  | Chromium foundation smoke running                        |
| Visual regression       | stable representative states and themes                         | Strategy defined; baselines start with API reader        |
| Performance             | large/pathological parsing, rendering, index and bundle budgets | Ingestion plus 5,000-schema model smoke running          |
| Build/examples          | application, CLI, TestInbox and edge examples                   | App and clean-room packed CLI running                    |

## Fixture corpus

`tests/fixtures/openapi` begins with OpenAPI 3.0/3.1 sentinels, recursive schemas, composition and discriminator constructs, invalid references, and malicious HTML/script-looking content. SPEC-003 expands it with external/circular refs, deep `allOf`, nullable 3.0 vs type-null 3.1, boolean schemas, read/write flags, tuples, dictionaries, large enums/examples/descriptions, invalid media types, servers/security, multipart/binary/empty bodies, callbacks, duplicate IDs, and deprecated operations.

Large generated fixtures declare deterministic construction parameters rather than committing megabytes of repetition. A production-realistic TestInbox contract remains an acceptance fixture owned outside core behavior.

## CI grouping

The fast job runs formatting, lint, types, semantic tests (including actual CLI subprocess and clean-room package execution), architecture, security, dependency-manifest, license, and redacted secret checks. Build/coverage/audit and browser/axe jobs run after it. A dedicated frozen-install/manifest/license/audit dependency-policy job runs only for pull requests. Future visual shards begin when stable reader states exist; they do not block the fast feedback path.

Coverage enforces an 80% statement/line, 75% branch, and 90% function repository floor plus stricter CLI package floors of 85% statements/lines, 75% branches, and 95% functions. The compiled executable shim and config-worker module are excluded from in-process source instrumentation because they run in subprocess/worker realms; actual executable, worker failure, timeout, cancellation, output, serialization, secret, and clean-room cases cover those boundaries behaviorally.

## Manual checks

Before releasing UI slices, follow the accessibility matrix in [performance and accessibility objectives](performance-accessibility.md). Security reviewers manually inspect diagnostics/logs for secret leakage. OpenAPI reviewers compare normalized results to 3.0 and 3.1 normative semantics. Performance reviewers record hardware, runtime, input size, wall time, and peak RSS.
