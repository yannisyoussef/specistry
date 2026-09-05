# Contributing to Specra

## Before changing code

1. Read the [product definition](docs/product-definition.md) and [architecture](docs/architecture/README.md).
2. Locate the owning package and confirm the intended dependency direction.
3. Read relevant accepted ADRs. Significant changes require a new ADR or an update that preserves decision history.
4. Add or update semantic tests. Snapshots may supplement, but must not replace, behavior assertions.

## Development workflow

Install the pinned toolchain and dependencies as described in the README. Run the narrowest useful tests during development, then run:

```bash
pnpm check
pnpm build
pnpm test:coverage
pnpm test:e2e
pnpm audit --audit-level high
```

Do not weaken a gate to land a change. Explain and disposition failures instead.

### Branch workflow

- `master` is the production branch. It receives reviewed promotion pull requests from `develop`; feature work never targets it directly.
- `develop` is the integration branch. Create a short-lived feature branch from `develop`, open a pull request back to `develop`, and merge only after required CI and review pass.
- Promote a tested release by opening a pull request from `develop` to `master`. Do not squash unrelated features together during promotion, and do not rewrite either shared branch.
- Urgent production fixes branch from `master`, return to `master` through review, and are then merged forward into `develop` so the branches do not diverge.

Both shared branches run the complete CI workflow. Repository rules should prohibit force pushes and deletion and require pull requests plus the fast, build, browser, and dependency-policy checks before merge.

## Change expectations

- Keep commits coherent and reviewable; avoid combining architectural changes, dependency upgrades, mass formatting, and product behavior.
- Preserve the canonical-model boundary. Adapters translate source formats; rendering consumes only canonical and rendering-specific view models.
- Treat OpenAPI, examples, descriptions, search terms, and upstream responses as untrusted.
- Never add `dangerouslySetInnerHTML` for source content.
- Never log authorization headers, API keys, cookies, request bodies, or playground credentials.
- New production dependencies require the review described in [dependency policy](docs/development/dependency-policy.md).
- Add difficult fixtures when extending source semantics; avoid tests that only cover demos.
- Use stable diagnostic codes and deterministic output for future CLI behavior.

## Testing guidance

Test files live beside package code for unit behavior and under `tests/` for cross-package concerns. The [test strategy](docs/development/testing.md) defines the full test pyramid, accessibility manual checks, visual-regression policy, and performance corpus.

When a source construct is unsupported, preserve an explicit diagnostic or `unknown` schema node. Silent semantic loss is a correctness defect.

## Pull requests

A pull request should state the work-item identifier, scope, non-goals, risks, verification commands, and any ADR impact. All P0/P1 review findings must be resolved or explicitly dispositioned before a slice completes.
