import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  digest,
  verifyPublishableManifest,
  verifyReleaseEvidence,
} from "./lib/npm-publication.mjs";
import { readLicensePolicy } from "./lib/license-policy.mjs";
import {
  readReleaseIdentity,
  RELEASE_REPOSITORY,
} from "./lib/release-identity.mjs";

const identity = await readReleaseIdentity(process.cwd());
if (
  process.env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY ||
  process.env.GITHUB_REF !== `refs/tags/${identity.tag}`
)
  throw new Error(
    "Publication requires the canonical repository and exact release tag.",
  );
const api = (endpoint) =>
  JSON.parse(
    execFileSync("gh", ["api", `repos/${RELEASE_REPOSITORY}/${endpoint}`], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    }),
  );
const release = api(`releases/tags/${identity.tag}`);
if (
  release.draft ||
  release.prerelease !== identity.version.includes("-rc.") ||
  release.tag_name !== identity.tag ||
  release.target_commitish !== process.env.GITHUB_SHA
)
  throw new Error("Public release does not bind to the frozen tag/source.");
const subjects = [
  identity.tarball,
  identity.sbom,
  "license-metadata.json",
  "release-audit.json",
  "SHA256SUMS",
  `public-distribution-${identity.version}.json`,
];
const names = [
  ...subjects,
  "provenance.sigstore.json",
  "provenance-verification.json",
];
if (
  release.assets.length !== names.length ||
  names.some(
    (name) =>
      release.assets.filter(
        (asset) =>
          asset.name === name &&
          /^sha256:[a-f0-9]{64}$/.test(asset.digest ?? ""),
      ).length !== 1,
  )
)
  throw new Error(
    "Release assets are ambiguous, incomplete, or lack API integrity digests.",
  );
const directory = await mkdtemp(
  path.join(process.env.RUNNER_TEMP ?? tmpdir(), "specistry-npm-"),
);
execFileSync(
  "gh",
  [
    "release",
    "download",
    identity.tag,
    "--repo",
    RELEASE_REPOSITORY,
    "--dir",
    directory,
    ...names.flatMap((name) => ["--pattern", name]),
  ],
  { stdio: "inherit" },
);
const bytes = new Map(
  await Promise.all(
    names.map(async (name) => [
      name,
      await readFile(path.join(directory, name)),
    ]),
  ),
);
for (const asset of release.assets)
  if (`sha256:${digest(bytes.get(asset.name))}` !== asset.digest)
    throw new Error(`GitHub asset digest mismatch: ${asset.name}`);
const master = api("git/ref/heads/master").object.sha;
const ledger = api(
  `contents/release-ledger/${identity.version}.json?ref=${master}`,
);
if (ledger.encoding !== "base64")
  throw new Error("Unsupported reviewed ledger response.");
const policy = await readLicensePolicy(process.cwd());
const verified = verifyReleaseEvidence({
  version: identity.version,
  sourceCommit: process.env.GITHUB_SHA,
  policy,
  subjects: bytes,
  ledgerBytes: Buffer.from(ledger.content, "base64"),
});
for (const name of verified.subjects)
  execFileSync(
    "gh",
    [
      "attestation",
      "verify",
      path.join(directory, name),
      "--repo",
      RELEASE_REPOSITORY,
      "--signer-workflow",
      `${RELEASE_REPOSITORY}/.github/workflows/release-candidate.yml`,
      "--source-digest",
      process.env.GITHUB_SHA,
      "--signer-digest",
      process.env.GITHUB_SHA,
      "--source-ref",
      `refs/tags/${identity.tag}`,
      "--deny-self-hosted-runners",
      "--bundle",
      path.join(directory, "provenance.sigstore.json"),
    ],
    { stdio: "inherit" },
  );
const tarball = path.join(directory, identity.tarball);
const entries = execFileSync("tar", ["-tzf", tarball], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
})
  .trim()
  .split("\n");
if (
  new Set(entries).size !== entries.length ||
  entries.some(
    (entry) =>
      !entry.startsWith("package/") ||
      entry.split("/").includes("..") ||
      entry.includes("\\"),
  )
)
  throw new Error("Unsafe or ambiguous tarball entries.");
const types = execFileSync("tar", ["-tvzf", tarball], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
})
  .trim()
  .split("\n");
if (types.some((line) => !/^[d-]/.test(line)))
  throw new Error("Tarball links or special files are forbidden.");
const packedFile = (name) =>
  execFileSync("tar", ["-xOf", tarball, `package/${name}`], {
    maxBuffer: 1024 * 1024,
  });
verifyPublishableManifest(
  JSON.parse(packedFile("package.json")),
  identity.version,
);
for (const name of ["LICENSE", "NOTICE", "LICENSES/Apache-2.0.txt"])
  if (!packedFile(name).equals(await readFile(name)))
    throw new Error(
      `Packed legal surface differs from reviewed source: ${name}`,
    );
for (const file of ["README.md", "dist/bin.js", "dist/index.d.ts"])
  packedFile(file);
if (
  entries.some((entry) =>
    /^package\/(?:\.agent|src|tests?|fixtures?|prompts?|reviews?)(?:\/|$)/.test(
      entry,
    ),
  )
)
  throw new Error("Packed private implementation material.");
for (const name of [
  "config",
  "content",
  "model",
  "openapi",
  "playground",
  "quality",
  "release",
  "search",
  "snippets",
]) {
  const manifest = JSON.parse(
    packedFile(`node_modules/@specistry/${name}/package.json`),
  );
  if (
    manifest.name !== `@specistry/${name}` ||
    manifest.version !== identity.version ||
    manifest.private !== true ||
    manifest.license !== "BUSL-1.1"
  )
    throw new Error(
      "Internal bundled package identity or publication guard drifted.",
    );
}
if (entries.some((entry) => entry.includes("@specra/")))
  throw new Error("Obsolete package namespace in tarball.");
const sbom = JSON.parse(bytes.get(identity.sbom));
const component = sbom.metadata?.component;
if (
  `${component?.group}/${component?.name}` !== identity.package ||
  component.version !== identity.version
)
  throw new Error("SBOM release identity drifted.");
await appendFile(
  process.env.GITHUB_OUTPUT,
  `directory=${directory}\ntarball=${tarball}\nsha256=${verified.sha256}\ndist_tag=${identity.distTag}\n`,
);
console.log(
  "Exact release subjects cryptographically verified; publication eligible.",
);
