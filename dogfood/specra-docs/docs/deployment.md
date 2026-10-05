---
title: Deployment
description: Operate the initial Node reader with prebuilt artifacts and immutable releases.
---

The initial supported production model is a Node 24 reader plus a prebuilt consumer artifact or release store. Static export is not supported. Build documentation separately, verify it, and make the coherent store available read-only to every reader instance.

Run the reader behind a TLS-terminating reverse proxy. Preserve the CSP, permissions, referrer, content-type, and framing headers; configure the public site origin; forward only trusted proxy headers; and allow playground destinations only when their CORS policy names the docs origin.

Versioned assets and release pages may be cached immutably. Current aliases and the catalog require revalidation. Back up the release store, catalog, and consumer sources; candidate artifacts are regenerable. Health must verify that the configured candidate or release catalog is readable without exposing filesystem or secret data.

Rollback changes the current pointer to a known-good immutable release. Never rewrite a retained release in place.
