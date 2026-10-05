import { readFile } from "node:fs/promises";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
if (
  process.env.GITHUB_REF !== `refs/tags/v${version}` ||
  !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "")
)
  throw new Error(
    "Release execution requires the exact version tag and source commit.",
  );
