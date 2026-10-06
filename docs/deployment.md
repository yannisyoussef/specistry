# Production deployment

The initial supported production model is the Node 24 reader, prebuilt
consumer artifacts, and an immutable release store. Static export is not a
supported mode. The checked-in multi-stage `Dockerfile` is the reference
deployment artifact.

## Build and run

Build documentation before building or starting the reader:

```bash
specistry validate
specistry build
specistry check
specistry release v1 --current --no-diff
docker build --tag specistry-reader:0.1.0-rc.3 .
docker run --read-only --tmpfs /tmp --publish 3000:3000 \
  --mount type=bind,src="$PWD",dst=/data/project,readonly \
  --env SPECISTRY_SITE_URL=https://docs.example.com \
  specistry-reader:0.1.0-rc.3
```

The image pins Node 24.20.0, runs the minimal Next standalone output as the
unprivileged `node` user, contains no consumer source or secret, and reads the
mounted project at `/data/project`. Build from the repository root. Locally,
`pnpm --filter @specistry/web start` launches the same standalone server; the
build wrapper stages its static assets beside it. The reader image is a
separate release artifact from the packed author CLI.

`GET /healthz` proves the process can answer. `GET /readyz` verifies the
configured candidate or the current release, including the catalog, release
manifest, component digests, and artifact contracts. Both responses are
`no-store`; readiness returns 503 with no path or parser detail on failure.

## Reverse proxy and origin

Terminate TLS at a trusted reverse proxy, pass the original scheme and host
only from that proxy, and set `SPECISTRY_SITE_URL` to the public HTTPS origin.
Preserve the reader's response headers:

- nonce `Content-Security-Policy` with `frame-ancestors 'none'` and
  `object-src 'none'`;
- `Permissions-Policy`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `X-Content-Type-Options: nosniff`;
- `X-Frame-Options: DENY`.

Enable HSTS at the TLS edge. Do not infer it from local HTTP. If browser
playground execution is enabled, each API must explicitly allow the public
documentation origin through CORS; never broaden the reader into a proxy.

## Cache policy

| Surface                                               | Policy                                    |
| ----------------------------------------------------- | ----------------------------------------- |
| Content-addressed assets and search indexes           | Public immutable cache                    |
| Explicit `/docs/{version}` and `/api/{version}` pages | Cacheable with release-aware revalidation |
| `/docs`, `/api`, `/`, catalog, health, readiness      | Revalidate or `no-store`; never immutable |
| Personalized or credential-bearing API responses      | Never cached by Specistry                 |

The nonce policy makes rendered HTML request-specific. An edge that caches HTML
must preserve nonce/header equivalence or document and review a different CSP;
the reference deployment does not make that trade.

## Multiple instances

Every instance must see one coherent, read-only release-store snapshot. Bake
the same snapshot into each deployment or mount an atomically published shared
store. Specistry does not provide distributed locks or replication. Do not update
component files independently while instances are serving them.

## Backup and restore

Back up:

- `.specistry/releases`, including `catalog.json` and immutable version folders;
- consumer sources, configuration, changelog sources, and contract inputs;
- deployment configuration outside the repository.

`.specistry/artifacts` and `.specistry/candidates` are regenerable. To prove a
restore, copy the release store into a clean project root, start the same
reader image with that root mounted read-only, require `/readyz` to return 200,
and exercise the current alias plus an explicit historical route.

## Rollback and corruption

Rollback changes only the catalog pointer:

```bash
specistry current v1
```

Verify `/readyz`, `/docs`, search, snippets, sitemap, canonical URLs, and CSP.
The old current release remains byte-for-byte unchanged.

If the catalog is malformed, a release digest is wrong, or a component was
swapped, readiness and the affected route fail closed. Restore the known-good
release store as a unit. Never edit a retained release until the digest appears
to match; an operator who can consistently rewrite the store and manifests is
inside the trust boundary, so external provenance still matters.
