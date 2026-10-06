import { readFile } from "node:fs/promises";
import path from "node:path";

export const RELEASE_PRODUCT = "specistry";
export const RELEASE_REPOSITORY = "yannisyoussef/specistry";
export const NPM_REGISTRY = "https://registry.npmjs.org";

export function releaseIdentity(version) {
  if (!/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(version ?? ""))
    throw new Error("Release version must be stable semver or an explicit RC.");
  return {
    version,
    tag: `v${version}`,
    package: `@${RELEASE_PRODUCT}/cli`,
    tarball: `${RELEASE_PRODUCT}-cli-${version}.tgz`,
    sbom: `${RELEASE_PRODUCT}-cli.cdx.json`,
    preparedArtifact: `prepared-${RELEASE_PRODUCT}-${version}`,
    artifact: `${RELEASE_PRODUCT}-${version}`,
    distTag: version.includes("-rc.") ? "next" : "latest",
  };
}

export async function readReleaseIdentity(root) {
  const manifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  if (manifest.name !== RELEASE_PRODUCT)
    throw new Error("Root product identity drifted.");
  return releaseIdentity(manifest.version);
}
