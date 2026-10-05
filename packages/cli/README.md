# @specra/cli

The supported Specra authoring distribution. It validates and compiles local
OpenAPI 3.0/3.1 contracts and controlled authored content into deterministic
reader artifacts, evaluates documentation quality, and manages immutable
documentation releases.

Requires Node.js 24.20.0 or newer within Node 24.

```bash
npm install --save-dev @specra/cli@0.1.0-rc.1
npx specra validate
npx specra build
npx specra check
```

The package bundles its internal runtime dependencies. Only the executable,
the root programmatic export, and the documented `@specra/config` dependency
are supported consumer surfaces. Do not import internal package subpaths.

This release candidate remains `UNLICENSED` until the repository owner makes
and applies the public software-license decision. It is suitable for local
evaluation, not public redistribution.

Documentation, compatibility policy, and security reporting instructions are
maintained in the [Specra repository](https://github.com/yannisyoussef/specra).
