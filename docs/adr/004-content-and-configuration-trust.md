# ADR-004: Content and configuration trust model

## Status

ACCEPTED — 2026-09-05

## Context

Technical authors need reusable components and typed configuration. MDX and TypeScript both execute JavaScript if imported normally, which is unsafe when repositories, branches, or hosted inputs are only partially trusted.

## Problem

How can Specra provide expressive authorship and `specra.config.ts` while keeping text from becoming arbitrary application/build code?

## Constraints

- `specra.config.ts` is the canonical local filename.
- Content requires callouts, tabs, steps, cards, API references, diagrams, and code groups.
- Source text, front matter, component props, paths, and assets must be validated.
- Some future services may build third-party repositories.

## Considered options

1. **Unrestricted MDX and TypeScript:** maximum flexibility, but grants arbitrary build/server authority and creates unsafe extension coupling.
2. **Plain Markdown and JSON only:** safest and portable, but weak typed author DX and limited components.
3. **Restricted Markdown/MDX vocabulary plus trusted TS config:** preserves common DX with explicit trust levels.
4. **Sandbox arbitrary code:** strong isolation in theory, but cross-platform sandboxing and side-channel hardening are substantial products themselves.

## Decision

Authored content is data: parse Markdown/MDX syntax, reject raw HTML, imports, exports, and arbitrary expressions, and allow only registered Specra components with schema-validated JSON-like props. Includes resolve within the configured docs root with cycle and size limits. Advanced arbitrary components are not initially supported.

Local `specra.config.ts` is trusted executable developer code. Load it only during build/dev in an isolated least-privilege process, then validate with the versioned config schema and pass only serializable resolved data onward. Untrusted or hosted workflows accept a data-only JSON/YAML equivalent and never execute TS config.

## Rationale

The component vocabulary delivers documentation-specific expressiveness without treating prose as code. Calling TS config trusted prevents a false sandbox claim. A data-only path provides a safe boundary for future remote builds.

## Consequences

- Positive: clear threat boundary, portable content, stable components, strong validation, and useful local types.
- Negative: some MDX ecosystem features and consumer components are unavailable; TS config cannot safely process untrusted repos.
- Neutral: the config schema begins at version 1 and deprecations need documented migration windows.

## Risks

Parser plugins may reintroduce execution or raw HTML. Content tests inspect AST capability and compiled output. Build isolation cannot make trusted malicious code safe; consumer CI must withhold production secrets.

## Security implications

Paths are root-confined and symlink-aware; props and URLs are validated; output is encoded; assets are inspected. Config errors never echo secret environment values. No `eval`, dynamic remote import, or arbitrary component resolution is allowed.
