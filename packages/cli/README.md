# @specistry/cli

The supported Specistry authoring distribution. It validates and compiles local
OpenAPI 3.0/3.1 contracts and controlled authored content into deterministic
reader artifacts, evaluates documentation quality, and manages immutable
documentation releases.

Requires Node.js 24.20.0 or newer within Node 24.

```bash
npm install --save-dev ./specistry-cli-0.1.0-rc.3.tgz
npx specistry validate
npx specistry build
npx specistry check
```

The registry coordinate `@specistry/cli@0.1.0-rc.3` is available only after an
explicit public release. Until then, use the reviewed candidate tarball.

The package bundles its internal runtime dependencies. Only the executable,
the root programmatic export, and the documented `@specistry/config` dependency
are supported consumer surfaces. Do not import internal package subpaths.

This release candidate is source-available under the Business Source License
1.1 (`BUSL-1.1`), including its stated Additional Use Grant. It is not
currently open source. Each specific version changes to Apache-2.0 three years
after that version's first public distribution. The confirmed Licensor and
copyright owner is INFINITY VENTURES (legal form: SASU), and the release-license
gate passes. Public RC distribution requires verified protected provenance and
the committed public-distribution ledger. Manual VoiceOver/NVDA qualification
is accepted for pre-1.0 RCs and required before stable `1.0.0`; no comprehensive
screen-reader or formal WCAG conformance claim is made.

Documentation, compatibility policy, and security reporting instructions are
maintained in the [Specistry repository](https://github.com/yannisyoussef/specistry).
