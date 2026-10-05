# ADR-018: Dogfood public boundary and release-candidate distribution

## Status

Accepted (SPEC-012).

## Context

Passing repository fixtures did not prove that an independent product could
adopt Specra without workspace-private imports, fixture helpers, unpublished
package subpaths, or source-tree assumptions. SPEC-012 also needed an honest
production shape: a reader process, immutable generated artifacts, a package
that can be installed in a clean project, and release evidence that does not
claim a license or provenance event that has not happened.

Odexa is the external consumer. It has six real OpenAPI services, shared
references, an AsyncAPI contract, authentication and tenant constraints, and
domain workflows that cannot be replaced by a toy fixture. Specra's own docs
are the second consumer and need authored content without inventing an API.

## Decision

1. The supported consumer boundary is the packed `@specra/cli` executable,
   `specra.config.ts`, documented source formats, and generated artifacts.
   Consumers may not import workspace sources, tests, fixtures, or private
   package subpaths. A narrow static gate checks both dogfood projects.
2. OpenAPI is optional. `openapi: []` creates a canonical project with zero
   services, enabling authored-content-only sites without a fake contract or
   a second artifact model.
3. Source records are project identities. Shared referenced documents appear
   once in the manifest even when several configured roots use them. A digest
   mismatch for the same identity during one build fails closed.
4. The release candidate is `0.1.0-rc.2`. A clean-room npm install and a
   separate pnpm install exercise the packed CLI. The candidate bundle
   includes its README and metadata, is audited for required and forbidden
   paths, and ships a validated CycloneDX SBOM plus SHA-256 checksums.
5. Production runs the Next.js standalone Node server against prebuilt,
   externally mounted artifacts. `/healthz` is process liveness; `/readyz`
   validates that a readable current candidate or release exists without
   returning filesystem or exception details. The container runs as a
   non-root user. Deployment, restore, corruption recovery, and rollback are
   operator procedures, not hidden application behaviour.
6. Odexa documents event flows as authored content linked to its authoritative
   AsyncAPI source. SPEC-012 does not add partial AsyncAPI ingestion. It also
   does not invent SDK mappings where the consumer has none.
7. The software policy is BSL 1.1 with a per-version Apache-2.0 Change License.
   The owner has confirmed the canonical Licensor name, legal form, ownership,
   licensing authority, and final parameters. Build provenance is prepared for
   the protected release workflow but is not claimed before that workflow runs.
   A human manual assistive-technology pass is also a release gate, distinct
   from automated axe and keyboard coverage.

## Consequences

- Positive: two materially different consumers exercise one documented public
  boundary; content-only projects are first-class; deployments have explicit
  health and recovery contracts; release evidence is reproducible and honest.
- Negative: the packed candidate is larger because it contains the standalone
  runtime and bundled internal packages; Odexa's event reference remains
  authored until a complete AsyncAPI slice exists; owner actions can block a
  public release even when CI is green.
- Neutral: this ADR approves the technical release shape, not publication,
  license terms, cloud hosting, or a support SLA.

## Alternatives rejected

- Importing Specra workspace packages directly from Odexa (hidden coupling).
- Keeping a fake OpenAPI contract for Specra's own docs (misleading product
  behaviour and unnecessary maintenance).
- Treating AsyncAPI as OpenAPI or implementing a partial event parser inside a
  dogfood slice (incorrect semantics and unreviewed scope).
- Publishing without confirmed licensing authority or labeling locally
  generated checksums as signed provenance (false release evidence).
- Baking generated consumer artifacts into the reader image (couples content
  rollback to application rollout and weakens immutable release operations).
