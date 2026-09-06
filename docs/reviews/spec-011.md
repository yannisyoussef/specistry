# SPEC-011 review record — Documentation quality gates and diff CLI

Reviews were run on the `feature/SPEC-011-quality-gates-diff-cli` branch
against develop `194f4ca`. Each specialist pass lists findings by severity
(P0 security/correctness/CI-bypass blocker, P1 major, P2 important, P3
minor) with their disposition. Completion requires no open P0 and no
unresolved P1.

## Principal Engineer self-review

The slice's own questions, answered against the code:

| Question                                       | Answer                                                                                                                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Did the CLI acquire rule semantics?            | No. `packages/cli/src/quality.ts` resolves artifact sets, calls `evaluateQuality`, formats, and maps an outcome to an exit code. It contains no severity decision and no `if (!operation.description)`. The architecture gate enforces the package boundary. |
| Does quality depend on a parser?               | No. `@specra/quality` depends on model, content, snippets, and release. Facts are an index over canonical artifacts; no YAML node, Markdown AST, React element, or browser value can reach a rule.                                                           |
| Are findings facts or policy?                  | Facts. A `RuleFinding` has a target, a message, and a locator; the engine adds severity, suppression state, and the gate. Re-scoring a rule changes nothing inside it.                                                                                       |
| Are rule ids stable and documented?            | 25 ASCII kebab-case ids, each with a title, one-line summary, default severity, and a documented false-positive boundary. A drift test fails if the registry and `docs/quality.md` disagree in either direction.                                             |
| Are the defaults usable?                       | Yes, and that is how they were chosen: TestInbox 0/24/97, edge 0/27/300, multi 0/14/13, versioned 0/5/12. Every fixture passes `failOn: "error"`. No rule defaults to error except the compatibility rules with defensible semantics.                        |
| Is a score being added for marketing?          | No score exists. The rationale is in ADR-017 and `docs/quality.md`.                                                                                                                                                                                          |
| Are warnings and errors deterministic?         | Findings sort by severity, rule, identity, then locator; serialization sorts keys; two evaluations of the same artifacts are byte-identical (unit test, plus a clean-room test that runs the packed binary twice and compares stdout).                       |
| Can a config typo silently disable a rule?     | No. An unknown id or severity is `QUALITY_RULE_UNKNOWN` / `QUALITY_SEVERITY_INVALID` and exits 2 with no evaluation. A CI self-test proves it.                                                                                                               |
| Can suppressions hide everything?              | No wildcard exists: rule and exact entity identity are both required. Disabling a rule everywhere is `rules: { id: "off" }`, which reads differently in review. Suppressed findings stay counted, listed, and attributed.                                    |
| Do suppressions require reasons, and expire?   | A reason of 1–200 printable characters is mandatory; control, newline, and bidi characters are rejected. `expires` is an optional UTC day, inclusive of the day itself, tested at both boundaries.                                                           |
| Can stale suppressions be detected?            | Yes. A rule keeps being evaluated on every other entity, so an unmatched suppression becomes `suppression-unused` and an expired one `suppression-expired`.                                                                                                  |
| Can a malicious title inject terminal control? | No. Human output routes every untrusted string through the existing `sanitizeTerminal`, and labels are clamped. The security suite asserts no ESC, no C0, no bidi in the report, and that a forged line never starts a line of its own.                      |
| Can secrets appear in reports?                 | Findings carry identities and fixed text. The credential rule reports the path inside an example; a canary value appears in neither JSON nor human output. Authored findings carry project-relative paths only.                                              |
| Can a huge contract exhaust memory?            | 1,000 findings per rule, 5,000 per evaluation, bounded messages and labels. 10,000 operations with 2,000 schemas: 7 ms, 1.2 MB output, 10 MB RSS delta.                                                                                                      |
| Can truncation falsely pass the gate?          | No. Truncation is recorded per rule; the gate fails whenever a truncated rule's effective severity could have counted toward the failure condition. Both the passing and failing directions are tested.                                                      |
| Does `specra diff` reuse SPEC-010?             | Yes: `diffArtifacts` with its `diffFormat: 1` envelope, re-emitted verbatim in `--json`. No parallel machine format exists.                                                                                                                                  |
| Did diff start guessing renames?               | No. Nothing in this slice touches identity matching; a changed identity is still a removal plus an addition.                                                                                                                                                 |
| Did schema compatibility overclaim?            | No. Schema, request-schema, and response-schema changes are `api-schema-changed` at `info`, worded as review required. A test asserts no rule id contains "breaking".                                                                                        |
| Are request and response contexts respected?   | `api-required-parameter-added` reads requiredness from the target facts and applies to request parameters only; response findings come from response aspects. Enumeration, nullability, and `additionalProperties` are deliberately unclassified.            |
| Are both commands read-only?                   | Tests assert the artifact directory is unchanged after `check`, that `.specra/candidates/diff.json` is byte-identical after `diff`, and that no changelog or report file appears.                                                                            |
| Did the reader or the bundle change?           | No file under `apps/web` changed. `pnpm check:bundle` reports the operation page at 137,778 B gzip and the docs page at 136,741 B, the SPEC-010 figures. Visual baselines are untouched.                                                                     |
| Did we start SPEC-012?                         | No. No signing, no shared asset store, no dogfood portal, no manual-AT automation.                                                                                                                                                                           |

Defects found and fixed during the self-review, before specialists:

- `operation-response-description` was near-vacuous: the canonical model
  already requires a non-empty response description, so the rule could only
  ever catch whitespace. It was **removed** rather than kept as a rule that
  almost never fires (SPEC-011 §33). The catalogue is 25 rules, not 26.
- The first compatibility implementation scanned every diff candidate for
  every operation — a cross product that would have cost 50 million
  comparisons on a 5,000-operation contract. Changed candidates are now
  indexed once in the facts layer; the performance case measures 4 ms.
- A composite suppression key joined a rule and an identity with a raw NUL
  written literally into the source, which makes Git treat the file as
  binary. Escaped, and the whole package is scanned for control characters.
- `parsePolicy` built its rule map with a plain object literal, so
  `__proto__` in configuration would have been a prototype assignment. The
  map is null-prototype and the case is tested.

## Architecture reviewer

- **P1 (fixed):** `packages/cli/src/quality.ts` originally duplicated the
  release module's digest verification. `readCandidate`, `operationRoutes`,
  `releaseStore`, and `readCatalog` are now shared from `release.ts` and the
  quality module adds only the reader that parses a full release set.
- **P2 (fixed):** the architecture gate now knows `@specra/quality`
  (allowed: model, content, snippets, release), lists it among the
  browser-forbidden packages, and a security test asserts that no file under
  `apps/web` mentions it and that the web manifest does not depend on it.
- **P2 (accepted):** facts are an index over canonical types rather than a
  second projection. Re-modelling every entity would duplicate the canonical
  model for no isolation benefit; "no parser objects" is what matters and is
  enforced.
- **P3 (accepted):** `RULE_REGISTRY_VERSION` is maintained by hand. A
  generated hash would drift from the human decision it records.

## Product / DX reviewer

- **P1 (fixed):** the first human report listed all 97 info findings, which
  is exactly the wall of noise the slice is meant to avoid. Errors and
  warnings are listed in full; info is summarized per rule unless the policy
  can fail on it.
- **P2 (fixed):** a failed gate printed only the failure line. The full
  report is now printed for both outcomes, because a failed gate is a result
  to act on.
- **P2 (accepted):** `--from` is required on `diff` while `--to` defaults to
  `candidate`. Two positional arguments read more naturally but would be a
  second syntax alongside the existing `--from` on `build` and `release`.
- **P3 (accepted):** there is no `specra check --fix`. Autofixing prose is
  out of scope and would write to sources that `check` promises not to touch.
- **P3 (deferred):** no `--output <file>`. `specra check --json > file` is
  what CI already does, and file writing would widen a read-only command.

## QA reviewer

- **P1 (fixed):** the CI dogfood ran `specra check` against a clean fixture
  and nothing else — a vacuous gate. `scripts/check-quality.mjs` now also
  mutates the policy and requires the command to exit 3 on a promoted rule,
  2 on a misspelled one, and 3 on an exceeded warning budget.
- **P2 (fixed):** the threshold tests checked only `maxWarnings: 0`. They
  now cover `0`, `N-1`, `N`, and `N+1` explicitly, since the inclusive
  boundary is the part people get wrong.
- **P2 (fixed):** rule tests originally constructed shapes that happened to
  trigger each rule. Every failing case is now a mutation of the real
  TestInbox documentation, so a rule cannot pass against an invented shape.
- Coverage: 67 files, 1,170 tests. Quality package 58, CLI check and diff
  15, security 12, performance 5, clean-room extended end to end.

## OpenAPI / JSON Schema reviewer

- **P1 (fixed):** `api-security-restricted` first compared alternative
  counts, which reports a false positive when an alternative is replaced by
  a broader one. It now uses subset semantics over OR-of-AND sets: a change
  is restrictive only when some credential set accepted before satisfies no
  alternative after. Four cases test it, including relaxation.
- **P2 (accepted):** requiredness for `api-required-parameter-added` is read
  from the target facts rather than from a new diff aspect. Extending the
  SPEC-010 record would change a frozen format for information the rule can
  already obtain correctly.
- **P2 (accepted):** parameter serialization changes (`style`, `explode`,
  `allowReserved`) are reported by the diff as `parameter-changed` but are
  not classified. Compatibility depends on the receiving server, which
  Specra cannot see.
- **P3 (accepted):** `operation-success-response` treats a `default`
  response as sufficient. A contract documenting only `default` is unusual
  but not wrong.

## Security reviewer

- **P1 (fixed):** the credential detector originally flagged any long
  opaque string, which reported ordinary identifiers and would have trained
  authors to ignore it. It now requires either a published secret format
  anywhere, or a credential-named key holding a long mixed-class value that
  is not an obvious placeholder.
- **P2 (fixed):** suppression reasons accepted arbitrary text, so a reason
  could carry escape sequences into a terminal. Control characters, line
  breaks, and bidi marks are rejected at parse time.
- **P2 (accepted):** a project can set `failOn: "never"` or turn a rule off
  and weaken its own gate. That is source-controlled, reviewable, and
  visible in the output; the alternative is a tool that overrides its users.
- **P3 (accepted):** `__proto__` cannot be a canonical identity at all (it
  does not start with a letter or digit), so the model rejects it before any
  rule runs; `constructor` and `prototype` are valid ids and are handled as
  plain data. Both directions are tested.
- Structural tests: no `import(`, `require(`, `eval`, `new Function`,
  `fetch`, `node:fs`, `node:net`, `node:http`, or `process.env` anywhere in
  the quality package.

## CLI / DX reviewer

- **P1 (fixed):** a failed gate first returned exit 2, indistinguishable
  from a broken configuration. `EXIT_CODES.qualityFailure = 3` was added
  with the `quality-failure` outcome, and the JSON envelope distinguishes
  the two by whether a `quality` block is present.
- **P2 (fixed):** `--version` and `--to` were accepted on every command.
  The parser now rejects them outside `check` and `diff`, with a message
  naming the command, and 24 invalid invocations are tested.
- **P2 (accepted):** there is no `--strict`, `--no-fail`, or
  `--ignore-errors`. One source of truth for policy, and no flag that a
  pipeline can use to walk past a gate.
- **P3 (accepted):** human output is not colourized, so `NO_COLOR` needs no
  handling and the report is identical on a TTY and in a log.

## Performance reviewer

- Evidence (`tests/performance/quality-measurements.json`): TestInbox 2 ms
  for 121 findings; 1,000 operations with 200 schemas 0.5 ms collect, 1.6 ms
  evaluate, 663 KB output; 10,000 operations with 2,000 schemas 4.7 ms
  collect, 7 ms evaluate, 5.4 ms serialize, 1.2 MB output, 10 MB RSS delta,
  truncated as designed; 1,000 suppressions and 25 overrides parse in 0.7 ms
  and evaluate in 3.5 ms; a 5,000-operation comparison diffs in 14 ms and
  classifies in 3.5 ms.
- **P2 (accepted):** the per-rule budget truncates a 10,000-operation
  project's info findings. That is the documented bound, and the gate is
  only affected when the truncated rule could have changed it.
- No client JavaScript, no HTML, and no reader change: the bundle budget
  output is unchanged.

## Documentation reviewer

- **P1 (fixed):** the rule catalogue and the registry could drift. A test
  parses `docs/quality.md` and requires the documented ids and the published
  ids to match exactly, in both directions.
- **P2 (fixed):** every rule now documents a false-positive boundary, not
  only what it detects; several boundaries were vague on first draft.
- **P2 (fixed):** the migration policy was missing. `docs/quality.md` now
  states that a new rule enters at info or warning, that raising a default
  or renaming an id is a documented compatibility change with a one-window
  alias, and that message text is not an interface.
- Updated: `docs/quality.md` (new), ADR-017, ADR index, CLI reference
  (commands, diagnostics, exit codes, programmatic API), configuration
  reference, architecture README, testing guide, threat model (five rows
  plus residual risks), roadmap outcome, README.

## Disposition

No open P0. All P1 findings fixed on the branch with tests. P2 items are
fixed or accepted with rationale above; P3 items are accepted or tracked for
SPEC-012 and beyond.
