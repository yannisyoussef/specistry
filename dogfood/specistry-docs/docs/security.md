---
title: Security model
description: Review Specistry's build, artifact, rendering, network, and release trust boundaries.
---

Authored content and API descriptions are data. The reader has no raw-HTML pass-through, uses a nonce-based CSP, validates every artifact, and serves only content-addressed authored assets.

OpenAPI acquisition is local and confined. Remote references are disabled. Search stays in the browser. The playground is browser-direct and limited to exact approved origins. Release components are verified by size and SHA-256 before parsing, and corruption fails closed instead of falling back.

Configuration is trusted code and can access the build environment. Do not run an unreviewed consumer configuration with secrets. Keep build credentials out of documentation sources, examples, artifacts, logs, and container layers.

Report suspected vulnerabilities through the repository's GitHub Security Advisory flow. Public issues are appropriate for non-sensitive defects only.
