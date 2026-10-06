import process from "node:process";

// `npm pack`/`pnpm pack` on the workspace package directory follows pnpm's
// `@specistry/config` symlink and emits escaping `../config/...` archive entries
// with a duplicated Zod tree. The staging script writes a reduced manifest
// without lifecycle scripts, so only direct packs reach this guard.
process.stderr.write(
  "Refusing to pack @specistry/cli from the workspace directory. Stage it first:\n" +
    '  staged="$(node scripts/stage-cli-package.mjs <new-directory>)" && npm pack "$staged"\n',
);
process.exit(1);
