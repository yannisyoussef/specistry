# ADR-017: Documentation quality as facts, rules, and policy

## Status

Accepted (SPEC-011). Consumes the structured diff port of
[ADR-016](016-immutable-documentation-releases.md).

## Context

Specra needed a quality gate authors would trust and a public way to see
what changed between two documentation sets. Quality tooling fails in
predictable ways: hundreds of noisy warnings, an opaque score nobody can
explain, suppressions that quietly become permanent, a rule engine that
grows a plugin system, and confident "breaking change" labels derived from
information the tool does not actually have. SPEC-010 deliberately produced
structured diff facts with no breaking-change semantics; SPEC-011 has to add
the policy layer without collapsing it back into the facts.

## Decision

1. **Three layers, never collapsed.** Normalized **facts** describe the
   documentation; **rules** turn facts into findings; **policy** decides what
   a finding means for a build. A rule never knows an exit code, a finding
   never carries a configured severity, and the CLI implements no rule. The
   frozen precedence is: rule default → configured severity (`off` removes
   the rule from the run) → suppression match → counts → `failOn` then
   `maxWarnings` → exit code.
2. **A dedicated pure package.** `@specra/quality` depends on
   `@specra/model`, `@specra/content`, `@specra/snippets`, and
   `@specra/release`. It reads no file, opens no socket, renders nothing,
   and touches no environment variable; the architecture gate enforces this,
   the reader may not depend on it, and it is on the browser-forbidden list.
3. **A static rule registry.** One array composed from explicit imports. No
   filesystem discovery, no dynamic `import`, no rule callback in
   configuration, no plugin marketplace. Configuration selects severities;
   it cannot add behaviour. A rule that throws aborts the evaluation as an
   internal error rather than yielding a credible clean report.
4. **No score.** Counts by severity are reported; there is no percentage.
   A single number hides which findings matter, drifts with API size rather
   than documentation quality, and invites gaming. The roadmap permitted
   either; this is a decision, not a deferral.
5. **Usable defaults.** Rules default to `info` or `warning` except the
   compatibility rules with defensible breaking semantics. `failOn` defaults
   to `error`, so a project adopting Specra sees guidance rather than a
   broken pipeline. Every fixture in the repository passes the default gate
   today, which is how the defaults were chosen.
6. **Governed suppressions.** A suppression names one rule and one exact
   entity identity — there is no wildcard — with a plain-text reason and an
   optional UTC expiry. Suppressed findings stay counted, listed, and
   attributed. A suppression that matches nothing becomes a
   `suppression-unused` finding, and an expired one stops applying and
   reports itself. Turning a rule off everywhere is a severity of `off`,
   which reads differently in review from accepting one piece of debt.
7. **Bounded, fail-safe evaluation.** At most 1,000 findings per rule and
   5,000 per evaluation. Truncation is reported, and it fails the gate
   whenever the truncated rule's severity could have changed the outcome:
   an incomplete evaluation may never claim a pass it cannot prove.
8. **Compatibility rules over the diff, not inside it.** Compatibility rules
   read the SPEC-010 diff records _and_ both fact sets, and never mutate a
   record or add a diff aspect. Only defensible semantics are classified:
   operation removed, required parameter added (requiredness read from the
   target facts), parameter removed, response removed, and authentication
   restricted under OR-of-AND set semantics. Schema changes stay "changed,
   review required" at `info`. Additions, deprecations, enumeration
   widening, nullability, and composition changes are not classified, and
   renames are never guessed.
9. **Public diff reuses the release port.** `specra diff --from <source>
[--to <source>]` resolves `candidate`, `current` (through the catalog),
   or an exact version id, hands both sets to `diffArtifacts`, and renders
   the result. It exits 0 whether or not anything changed, writes nothing,
   never touches `.specra/candidates` or the changelog, and its `--json`
   output is the SPEC-010 `diffFormat: 1` record rather than a parallel
   format.
10. **A distinct exit code for a failed gate.** `specra check` exits 3 when
    the gate fails and 2 when the project or the policy could not be read,
    so CI can tell a documentation problem from a configuration problem.
    Machine output says the same thing: `ok: false` with a `quality` block
    is a failed gate, without one it is an error.
11. **Value-free findings.** A finding names where something is, never what
    it contains. The credential rule reports the path inside an example and
    never the value. Untrusted contract text passes through the CLI's
    existing terminal sanitizer, and JSON output stays valid JSON with no
    escape sequences.
12. **Commands stay composable.** `specra release` does not run
    `specra check`. A pipeline orders them explicitly. Hidden coupling
    between a gate and a publish step is how gates get disabled.

## Consequences

- Positive: a finding can be re-scored, suppressed, or ignored without
  touching a rule; the diff stays a fact source for the changelog workflow,
  the public command, and the compatibility rules at once; the gate cannot
  be weakened by a typo, hidden by a wildcard, or silently truncated;
  evaluation of a 10,000-operation contract takes single-digit milliseconds
  and adds no browser bytes.
- Negative: rule ids and default severities become public compatibility
  surface with a documented migration policy; a coarse suppression target
  (one rule, one entity) cannot accept a single parameter's finding while
  keeping its siblings; refusing a score means Specra cannot show a headline
  number.
- Neutral: the catalogue starts at 25 rules on purpose; growing it is a
  policy decision with a migration path, not a code change alone.

## Alternatives rejected

- A 0–100 quality score (vanity metric; unstable across API sizes).
- Rule plugins or callbacks in configuration (arbitrary build-time code,
  and a separate security and compatibility design).
- Deriving breaking-change labels from schema digests (SPEC-010 made those
  value-free precisely because a digest cannot support the claim).
- Fuzzy rename detection to prettify diffs (guesswork presented as fact).
- Automatic quality gating inside `specra release` (hidden coupling).
- A hidden baseline file recording accepted findings (thresholds plus
  governed suppressions cover the ratchet without invisible state).
- SARIF output (not required; can be added later without changing the
  engine).
