import path from "node:path";

import { finalizePreparedCandidate } from "./lib/release-binding.mjs";

if (process.argv.length !== 4)
  throw new Error(
    "Usage: finalize-release-candidate.mjs <prepared-candidate> <ledger-checkout>",
  );
await finalizePreparedCandidate({
  repositoryRoot: process.cwd(),
  candidateDirectory: path.resolve(process.argv[2]),
  ledgerDirectory: path.resolve(process.argv[3], "release-ledger"),
  sourceCommit: process.env.GITHUB_SHA,
  sourceTag: process.env.GITHUB_REF?.replace(/^refs\/tags\//, ""),
});
console.log(
  "Prepared subjects, source/tag, and committed ledger verified; no rebuild performed.",
);
