import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { recordPublicDistribution } from "./lib/public-distribution.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const [firstPublicDistribution, suppliedCandidateDirectory] =
  process.argv.slice(2);
if (
  firstPublicDistribution === undefined ||
  suppliedCandidateDirectory === undefined ||
  process.argv.length !== 4
) {
  throw new Error(
    "Usage: node scripts/record-public-distribution.mjs <YYYY-MM-DD> <candidate-directory>",
  );
}
const output = await recordPublicDistribution({
  repositoryRoot,
  candidateDirectory: path.resolve(suppliedCandidateDirectory),
  firstPublicDistribution,
});
process.stdout.write(`${output}\n`);
