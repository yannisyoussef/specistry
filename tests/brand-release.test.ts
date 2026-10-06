import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const { verifyPublishableManifest, verifyReleaseEvidence, digest } =
  await import(
    pathToFileURL(path.join(root, "scripts/lib/npm-publication.mjs")).href
  );
const { releaseIdentity } = await import(
  pathToFileURL(path.join(root, "scripts/lib/release-identity.mjs")).href
);
const { licenseMetadata } = await import(
  pathToFileURL(path.join(root, "scripts/lib/license-policy.mjs")).href
);
const version = "0.1.0-rc.3";
const sourceCommit = "a".repeat(40);
const policy = JSON.parse(await readFile("license-policy.json", "utf8"));
const sourceManifest = JSON.parse(
  await readFile("packages/cli/package.json", "utf8"),
);
const parseYaml = createRequire(
  path.join(root, "packages/openapi/package.json"),
)("yaml").parse;

function manifest() {
  const source = { ...sourceManifest };
  delete source.scripts;
  return {
    ...source,
    private: false,
    publishConfig: { access: "public", registry: "https://registry.npmjs.org" },
    dependencies: Object.fromEntries(
      Object.entries(source.dependencies).map(([name, range]) => [
        name,
        range === "workspace:*" ? version : range,
      ]),
    ),
  };
}

function evidence() {
  const identity = releaseIdentity(version);
  const tarball = Buffer.from("qualified bytes");
  const ledgerBytes = Buffer.from(
    JSON.stringify({
      ...licenseMetadata(policy, version, "2026-10-06"),
      sourceCommit,
      artifact: identity.tarball,
      artifactSha256: digest(tarball),
    }),
  );
  const subjects = new Map<string, Buffer>([
    [identity.tarball, tarball],
    [identity.sbom, Buffer.from('{"bomFormat":"CycloneDX"}')],
    [
      "license-metadata.json",
      Buffer.from(JSON.stringify(licenseMetadata(policy, version))),
    ],
    [
      "release-audit.json",
      Buffer.from(
        JSON.stringify({
          sourceCommit,
          package: identity.package,
          version,
          artifact: identity.tarball,
          license: "BUSL-1.1",
          sbom: identity.sbom,
          qualification: {
            selfDocumentation: "PASS",
            odexa: "PASS",
            packageManagers: ["npm", "pnpm"],
            artifactSha256: digest(tarball),
            odexaSource: "b".repeat(40),
          },
        }),
      ),
    ],
    [`public-distribution-${version}.json`, ledgerBytes],
  ]);
  return { version, sourceCommit, policy, subjects, ledgerBytes };
}

function checksums(value: ReturnType<typeof evidence>) {
  value.subjects.set(
    "SHA256SUMS",
    Buffer.from(
      [...value.subjects]
        .filter(([name]) => name !== "SHA256SUMS")
        .map(([name, bytes]) => `${digest(bytes)}  ${name}`)
        .sort()
        .join("\n") + "\n",
    ),
  );
  return value;
}

describe("BRAND-001 release identity", () => {
  it("preserves the byte-exact historical RC2 ledger and current private source", async () => {
    expect(
      createHash("sha256")
        .update(await readFile("release-ledger/0.1.0-rc.2.json"))
        .digest("hex"),
    ).toBe("76928299b2f83e5f9698b0a8cfb55753ee9e37ad913889b50d0bc97743c5058f");
    expect(sourceManifest).toMatchObject({
      name: "@specistry/cli",
      version,
      private: true,
    });
    expect(Object.keys(sourceManifest.bin)).toEqual(["specistry"]);
    expect(sourceManifest.scripts.prepack).toContain("refuse-direct-pack.mjs");
  });

  it("uses next only for RCs and rejects ambiguous version strings", () => {
    expect(releaseIdentity(version)).toMatchObject({
      distTag: "next",
      tarball: "specistry-cli-0.1.0-rc.3.tgz",
    });
    expect(releaseIdentity("0.1.0").distTag).toBe("latest");
    for (const invalid of ["../0.1.0", "0.1.0-beta", "0.1.0-rc.0", "0.1.0\n"])
      expect(() => releaseIdentity(invalid)).toThrow();
  });

  it("accepts only an explicitly publishable staged CLI, not source or legacy identities", () => {
    expect(verifyPublishableManifest(manifest(), version).package).toBe(
      "@specistry/cli",
    );
    const mutations = [
      { name: "@specra/cli" },
      { private: true },
      { version: "0.1.0-rc.2" },
      { license: "Apache-2.0" },
      { bin: { specra: "./dist/bin.js" } },
      { bin: { specistry: "./dist/bin.js", specra: "./dist/bin.js" } },
      {
        publishConfig: {
          access: "restricted",
          registry: "https://registry.npmjs.org",
        },
      },
      {
        publishConfig: { access: "public", registry: "https://attacker.test" },
      },
      {
        repository: { url: "git+https://github.com/yannisyoussef/specra.git" },
      },
      { scripts: { postinstall: "arbitrary code" } },
      { exports: {} },
      { bundleDependencies: [] },
      { dependencies: { "@specistry/config": "workspace:*" } },
    ];
    for (const mutation of mutations)
      expect(() =>
        verifyPublishableManifest({ ...manifest(), ...mutation }, version),
      ).toThrow();
  });

  it("binds exact checksummed subjects to undated preparation, qualified bytes and reviewed ledger", () => {
    expect(verifyReleaseEvidence(checksums(evidence()))).toMatchObject({
      sha256: digest(Buffer.from("qualified bytes")),
    });
    for (const name of [
      "specistry-cli-0.1.0-rc.3.tgz",
      "specistry-cli.cdx.json",
      "license-metadata.json",
      "release-audit.json",
      `public-distribution-${version}.json`,
    ]) {
      const value = checksums(evidence());
      value.subjects.set(name, Buffer.from("tampered"));
      expect(() => verifyReleaseEvidence(value)).toThrow();
    }
    const ledger = checksums(evidence());
    ledger.ledgerBytes = Buffer.from("different reviewed record");
    expect(() => verifyReleaseEvidence(ledger)).toThrow();
    const extra = checksums(evidence());
    extra.subjects.set(
      "SHA256SUMS",
      Buffer.from(
        extra.subjects.get("SHA256SUMS")!.toString() +
          `${"c".repeat(64)}  ../escaped.json\n`,
      ),
    );
    expect(() => verifyReleaseEvidence(extra)).toThrow();
  });

  it("rejects rechecksummed identity, qualification, source and license drift", () => {
    for (const mutation of [
      { sourceCommit: "c".repeat(40) },
      { package: "@specra/cli" },
      { version: "0.1.0-rc.2" },
      { qualification: null },
      { artifact: "specra-cli-0.1.0-rc.2.tgz" },
    ]) {
      const value = evidence();
      const audit = JSON.parse(
        value.subjects.get("release-audit.json")!.toString(),
      );
      value.subjects.set(
        "release-audit.json",
        Buffer.from(JSON.stringify({ ...audit, ...mutation })),
      );
      expect(() => verifyReleaseEvidence(checksums(value))).toThrow();
    }
    const dated = evidence();
    dated.subjects.set(
      "license-metadata.json",
      Buffer.from(
        JSON.stringify(licenseMetadata(policy, version, "2026-10-06")),
      ),
    );
    expect(() => verifyReleaseEvidence(checksums(dated))).toThrow();
  });

  it("keeps publication-only OIDC, canonical identity and exact-candidate qualification in protected workflows", async () => {
    const publishText = await readFile(
      ".github/workflows/npm-publish.yml",
      "utf8",
    );
    const publish = parseYaml(publishText);
    expect(publish.permissions).toEqual({ contents: "read" });
    expect(publish.jobs.publish).toMatchObject({
      environment: "release",
      "runs-on": "ubuntu-latest",
      permissions: { "id-token": "write", contents: "read" },
    });
    expect(publish.jobs.publish.if).toContain("yannisyoussef/specistry");
    expect(publishText).not.toMatch(
      /pnpm (?:install|build)|npm run build|NPM_TOKEN|NODE_AUTH_TOKEN/,
    );
    expect(publishText).toContain("scripts/verify-npm-release.mjs");
    expect(publishText).toContain("scripts/publish-npm-candidate.mjs");
    const candidateText = await readFile(
      ".github/workflows/release-candidate.yml",
      "utf8",
    );
    const candidate = parseYaml(candidateText);
    expect(candidate.jobs.prepare.environment).toBe("release");
    expect(candidate.jobs.prepare.name).toBe("Reviewed candidate preparation");
    expect(candidate.jobs.prepare.permissions).toBeUndefined();
    expect(candidateText).toContain(
      "scripts/qualify-cli-candidate.mjs .release/candidate",
    );
    expect(candidate.jobs.prepare.if).not.toContain("repository.private");
    expect(candidateText).not.toContain("0.1.0-rc.2");
    const steps = candidate.jobs.prepare.steps as Array<{
      run?: string;
      with?: { repository?: string };
    }>;
    const consumerIndex = steps.findIndex(
      (step) => step.with?.repository === "yannisyoussef/odexa",
    );
    expect(consumerIndex).toBeGreaterThan(-1);
    for (const command of [
      "pnpm check",
      "pnpm build",
      "pnpm audit --audit-level high",
      "pnpm check:release-license",
      "pnpm release:candidate",
    ]) {
      const gateIndex = steps.findIndex((step) => step.run === command);
      expect(gateIndex).toBeGreaterThan(-1);
      expect(consumerIndex).toBeGreaterThan(gateIndex);
    }
    expect(steps[consumerIndex + 1].run).toBe(
      "node scripts/qualify-cli-candidate.mjs .release/candidate .specistry-tooling/odexa",
    );
  });
});
