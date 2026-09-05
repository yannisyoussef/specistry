# ADR-005: Playground networking and credentials

## Status

ACCEPTED — 2026-09-05

## Context

Interactive requests improve API adoption but introduce credentials, target-origin policy, CORS, sensitive payloads, SSRF, redirect, resource-exhaustion, and observability risks. A documentation server must not become a general proxy.

## Problem

Which network model provides a useful first playground and what credential lifetime is acceptable?

## Constraints

- Destinations must come only from validated project environments and operation paths.
- Security takes precedence over bypassing CORS.
- Credentials must not leak to persistence, URLs, logs, telemetry, traces, or artifacts.
- Self-hosted static deployments should retain a useful option.

## Considered options

1. **Browser-direct:** smallest server risk and static compatible, but target APIs need CORS.
2. **Integrated web-backend proxy:** hides CORS but gives every Specra host a major SSRF/credential boundary.
3. **Dedicated hardened proxy:** isolates risk and policy, but adds deployment and operational cost.
4. **Hybrid:** flexible but multiplies configuration, documentation, and test modes.

## Decision

SPEC-009 implements browser-direct requests only, disabled by default and restricted to validated configured base URLs. Credentials are component-memory-only by default and cleared with the playground lifecycle. They never enter URLs or automatic persistence. Browser requests use explicit method/header/body construction, timeouts/cancellation, response limits where browser APIs permit, no mutation retry, and redacted errors.

A proxy interface may be designed, but no proxy ships implicitly. If evidence demands one, a separately deployed dedicated component and slice must implement every control in the threat model. There is no `ALLOW_ALL` mode.

## Rationale

Browser-direct keeps the highest-risk credentials and destinations out of Specra infrastructure and works with static hosting. CORS is an honest target-API deployment requirement rather than a reason to create an unsafe proxy.

## Consequences

- Positive: no server SSRF surface or credential custody, minimal operations, and explicit target audit at the API.
- Negative: some APIs cannot use the playground until they configure CORS or a future proxy; browser limitations affect cookies and response headers.
- Neutral: code samples can still be generated when execution is unavailable.

## Risks

XSS or compromised browser extensions can read memory-held credentials. CSP, encoded content, dependency controls, clear security messaging, and no third-party analytics reduce but cannot remove browser-origin risk.

## Security implications

Authorization, cookies, keys, passwords, bodies, and full query URLs are redacted/omitted from logs, telemetry, errors, and tests. OAuth requires PKCE. Optional session storage is not approved by this ADR and requires a revision with TTL, UI, and threat analysis.
