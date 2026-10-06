---
title: Browser playground
description: Enable browser-direct requests only for explicitly approved origins.
---

The playground is disabled by default. Browser mode sends a request from the user's browser directly to an exact configured origin. The reader server is never a credentialed proxy.

Approved destinations require HTTPS, except loopback HTTP for local development. Credentials live in memory, forbidden headers are blocked, redirects cannot escape policy, response reads and timeouts are bounded, and reports redact credential-shaped values.

The target API must deliberately allow the documentation origin through CORS. For mutations, document the affected local or sandbox data and do not approve production merely because it is also an example environment.
