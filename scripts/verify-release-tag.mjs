import { execFileSync } from "node:child_process";
import { appendFile } from "node:fs/promises";
import {
  readReleaseIdentity,
  RELEASE_REPOSITORY,
} from "./lib/release-identity.mjs";

const identity = await readReleaseIdentity(process.cwd());
const { version } = identity;
if (
  process.env.GITHUB_REF !== `refs/tags/v${version}` ||
  process.env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY ||
  !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "")
)
  throw new Error(
    "Release execution requires the exact version tag and source commit.",
  );

const api = (endpoint) =>
  JSON.parse(
    execFileSync("gh", ["api", `repos/${RELEASE_REPOSITORY}/${endpoint}`], {
      encoding: "utf8",
    }),
  );
const reference = api(`git/ref/tags/${identity.tag}`);
if (reference.object?.type !== "tag")
  throw new Error("Release tag must be annotated.");
const tag = api(`git/tags/${reference.object.sha}`);
if (
  tag.tag !== identity.tag ||
  tag.object?.type !== "commit" ||
  tag.object.sha !== process.env.GITHUB_SHA
)
  throw new Error("Annotated tag does not resolve to this frozen source.");
if (
  !["ahead", "identical"].includes(
    api(`compare/${process.env.GITHUB_SHA}...master`).status,
  )
)
  throw new Error("Release source is not reviewed master ancestry.");
const runs = api(
  `actions/workflows/ci.yml/runs?head_sha=${process.env.GITHUB_SHA}&event=push&status=success&per_page=100`,
).workflow_runs;
const run = runs.find(
  (item) =>
    item.head_sha === process.env.GITHUB_SHA &&
    item.head_branch === "master" &&
    item.conclusion === "success",
);
if (!run) throw new Error("Exact production source lacks successful push CI.");
const jobs = api(`actions/runs/${run.id}/jobs?per_page=100`).jobs;
for (const name of [
  "Fast quality gates",
  "Build, coverage, and audit",
  "Browser and accessibility smoke",
  "Packed CLI consumers",
  "Resource and performance evidence",
])
  if (!jobs.some((job) => job.name === name && job.conclusion === "success"))
    throw new Error(`Production CI gate not passed: ${name}`);
if (process.env.GITHUB_OUTPUT)
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `version=${version}\nprepared_artifact=${identity.preparedArtifact}\nartifact=${identity.artifact}\ntarball=${identity.tarball}\nsbom=${identity.sbom}\n`,
  );
