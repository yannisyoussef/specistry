import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { digest } from "./lib/npm-publication.mjs";
import {
  NPM_REGISTRY,
  readReleaseIdentity,
  RELEASE_REPOSITORY,
} from "./lib/release-identity.mjs";

const identity = await readReleaseIdentity(process.cwd());
const tarball = process.env.QUALIFIED_TARBALL;
if (
  process.env.GITHUB_REPOSITORY !== RELEASE_REPOSITORY ||
  process.env.GITHUB_REF !== `refs/tags/${identity.tag}` ||
  !process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
  !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ||
  process.env.NPM_TOKEN ||
  process.env.NODE_AUTH_TOKEN ||
  !tarball ||
  !/^[a-f0-9]{64}$/.test(process.env.QUALIFIED_SHA256 ?? "")
)
  throw new Error(
    "Publication requires exact-tag OIDC and verified bytes, never a persistent npm token.",
  );
const qualified = await readFile(tarball);
if (digest(qualified) !== process.env.QUALIFIED_SHA256)
  throw new Error("Qualified tarball changed before publication.");
const npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8" })
  .trim()
  .split(".")
  .map(Number);
if (
  npmVersion[0] < 11 ||
  (npmVersion[0] === 11 &&
    (npmVersion[1] < 5 || (npmVersion[1] === 5 && npmVersion[2] < 1)))
)
  throw new Error("npm 11.5.1 or newer is required for Trusted Publishing.");
const coordinate = encodeURIComponent(identity.package);
const before = await fetch(
  `${NPM_REGISTRY}/${coordinate}/${identity.version}`,
  { redirect: "error", signal: AbortSignal.timeout(30000) },
);
if (before.status !== 404)
  throw new Error(
    "Release version already exists or registry preflight is inconclusive; never reuse a version.",
  );
execFileSync(
  "npm",
  [
    "publish",
    tarball,
    "--ignore-scripts",
    "--access",
    "public",
    "--tag",
    identity.distTag,
    "--registry",
    NPM_REGISTRY,
  ],
  { stdio: "inherit" },
);
const metadataResponse = await fetch(`${NPM_REGISTRY}/${coordinate}`, {
  redirect: "error",
  signal: AbortSignal.timeout(30000),
});
if (!metadataResponse.ok)
  throw new Error("Published registry metadata unavailable.");
const metadata = await metadataResponse.json();
const published = metadata.versions?.[identity.version];
if (
  published?.name !== identity.package ||
  published.version !== identity.version ||
  metadata["dist-tags"]?.[identity.distTag] !== identity.version ||
  (identity.distTag === "next" &&
    metadata["dist-tags"]?.latest === identity.version)
)
  throw new Error("Published package identity or RC dist-tag policy mismatch.");
const url = new URL(published.dist.tarball);
if (
  url.origin !== NPM_REGISTRY ||
  !url.pathname.startsWith("/@specistry/cli/-/")
)
  throw new Error("Unexpected registry tarball origin/path.");
const response = await fetch(url, {
  redirect: "error",
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error("Registry tarball unavailable.");
const bytes = Buffer.from(await response.arrayBuffer());
if (
  digest(bytes) !== digest(qualified) ||
  published.dist.integrity !==
    `sha512-${createHash("sha512").update(qualified).digest("base64")}`
)
  throw new Error("npm and qualified GitHub tarball bytes differ.");
console.log(
  `Verified ${identity.package}@${identity.version}, ${identity.distTag}, and identical npm/GitHub bytes.`,
);
