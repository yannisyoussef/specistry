# Deployment requirements

Phase 0 provides a Node deployment shell. Static export and hosting adapters are architectural commitments for compatible future slices, not implemented features.

## Security-header equivalence

The Node server emits the headers defined in `apps/web/next.config.ts`. A static host or CDN must reproduce an equivalent effective policy at its public edge:

- `Content-Security-Policy`, including `frame-ancestors 'none'`, `object-src 'none'`, and project-specific `connect-src` once networking exists
- `Permissions-Policy`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-Content-Type-Options: nosniff`

HSTS belongs at the TLS-terminating production edge and must not be inferred from local HTTP development. Consumer authentication, cache policy, TLS, origin isolation, and private-network exposure remain deployment-owner responsibilities.

Deployment adapters must include an HTTP smoke test against the served artifact. Checking only source configuration is insufficient because a CDN or reverse proxy may remove or replace headers. The Phase 0 Playwright suite demonstrates this requirement against the production Next server.

## Future adapter contract

A static adapter must emit host-readable routing, redirect, and header metadata; document any unsupported policy; and test the deployed result. It must preserve immutable `/docs/{version}` routes, make `/docs` a non-permanent redirect, exclude that alias from sitemaps, and prevent open redirects.
