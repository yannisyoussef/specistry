import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";

import { verifyPreparationBinding } from "./lib/release-binding.mjs";

const repository = process.env.GITHUB_REPOSITORY;
const runId = process.env.CANDIDATE_RUN_ID;
const ledgerCommit = process.env.LEDGER_COMMIT;
if (
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
  !/^[1-9][0-9]*$/.test(runId ?? "") ||
  !/^[a-f0-9]{40}$/.test(ledgerCommit ?? "")
)
  throw new Error("Invalid repository, preparation run ID, or ledger commit.");
const api = (endpoint) =>
  JSON.parse(
    execFileSync("gh", ["api", `repos/${repository}/${endpoint}`], {
      encoding: "utf8",
    }),
  );
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const artifact = verifyPreparationBinding({
  repository,
  sourceCommit: process.env.GITHUB_SHA,
  sourceTag: `v${version}`,
  run: api(`actions/runs/${runId}`),
  jobs: api(`actions/runs/${runId}/jobs`).jobs,
  artifacts: api(`actions/runs/${runId}/artifacts`).artifacts,
  sourceToLedger: api(`compare/${process.env.GITHUB_SHA}...${ledgerCommit}`),
  ledgerToMaster: api(`compare/${ledgerCommit}...master`),
});
await appendFile(process.env.GITHUB_OUTPUT, `artifact_id=${artifact.id}\n`);
