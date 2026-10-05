import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("software license policy", () => {
  it("keeps the authoritative policy, all manifests, and legal texts consistent", async () => {
    const policy = JSON.parse(
      await readFile(path.join(repositoryRoot, "license-policy.json"), "utf8"),
    ) as {
      currentLicense: string;
      additionalUseGrant: string;
      changeLicense: string;
      changeDatePolicy: {
        yearsAfterFirstPublicDistribution: number;
        appliesPerVersion: boolean;
      };
      finalParametersOwnerApproved: boolean;
      externalLegalReview: {
        reference: string | null;
        status: string;
      };
      licensor: {
        legalForm: string;
        legalName: string;
        legalNameConfirmed: boolean;
        licensingAuthorityConfirmed: boolean;
      };
    };
    expect(policy).toMatchObject({
      currentLicense: "BUSL-1.1",
      changeDatePolicy: {
        appliesPerVersion: true,
        yearsAfterFirstPublicDistribution: 3,
      },
      changeLicense: "Apache-2.0",
      externalLegalReview: {
        reference: null,
        status: "not-recorded",
      },
      finalParametersOwnerApproved: true,
      licensor: {
        legalForm: "SASU",
        legalName: "INFINITY VENTURES",
        legalNameConfirmed: true,
        licensingAuthorityConfirmed: true,
      },
    });

    const license = await readFile(
      path.join(repositoryRoot, "LICENSE"),
      "utf8",
    );
    expect(license).toContain(
      `Additional Use Grant: ${policy.additionalUseGrant}`,
    );
    expect(license).toContain("Business Source License 1.1");
    expect(license).toContain("Licensor: INFINITY VENTURES");
    expect(license).toContain("Change License: Apache License, Version 2.0");
    const apache = await readFile(
      path.join(repositoryRoot, "LICENSES", "Apache-2.0.txt"),
      "utf8",
    );
    expect(apache).toContain("Apache License");
    expect(apache).toContain("Version 2.0, January 2004");
    const notice = await readFile(path.join(repositoryRoot, "NOTICE"), "utf8");
    expect(notice).toContain("Copyright © INFINITY VENTURES");
    expect(notice).toContain(
      "société par actions simplifiée unipersonnelle (SASU)",
    );

    const manifests = [
      "package.json",
      ...(await manifestPaths("apps")),
      ...(await manifestPaths("packages")),
    ];
    for (const manifestPath of manifests) {
      const manifest = JSON.parse(
        await readFile(path.join(repositoryRoot, manifestPath), "utf8"),
      ) as { license?: string; version?: string };
      expect(manifest.license, manifestPath).toBe("BUSL-1.1");
      expect(manifest.version, manifestPath).toBe("0.1.0-rc.2");
    }

    const checked = command(process.execPath, [
      path.join(repositoryRoot, "scripts", "check-project-license.mjs"),
    ]);
    expect(checked.status, checked.stderr).toBe(0);

    const readme = await readFile(
      path.join(repositoryRoot, "README.md"),
      "utf8",
    );
    expect(readme).toContain("Specra is source-available");
    expect(readme).toContain("Specra is not open source before");
    expect(readme).not.toMatch(/Specra is (?:an )?open[- ]source/i);
    const currentSurfaces = [
      readme,
      await readFile(
        path.join(repositoryRoot, "packages", "cli", "README.md"),
        "utf8",
      ),
      await readFile(
        path.join(repositoryRoot, "docs", "license-decision.md"),
        "utf8",
      ),
      await readFile(
        path.join(repositoryRoot, "docs", "release-process.md"),
        "utf8",
      ),
      await readFile(
        path.join(repositoryRoot, "dogfood", "specra-docs", "docs", "index.md"),
        "utf8",
      ),
    ];
    for (const surface of currentSurfaces) {
      expect(surface).not.toContain("UNLICENSED");
      expect(surface).not.toMatch(
        /has not made a public software-license decision/i,
      );
      expect(surface).not.toMatch(
        /(?:licensor|licensing authority).{0,80}(?:unconfirmed|requires? owner confirmation)/i,
      );
    }
  });

  it("fails closed when one manifest or the approved grant drifts", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "specra-license-gate-"));
    temporary.push(fixture);
    await mkdir(path.join(fixture, "apps", "web"), { recursive: true });
    await mkdir(path.join(fixture, "packages", "cli"), { recursive: true });
    await mkdir(path.join(fixture, "LICENSES"));
    for (const file of [
      "LICENSE",
      "NOTICE",
      "license-policy.json",
      "package.json",
    ])
      await cp(path.join(repositoryRoot, file), path.join(fixture, file));
    await cp(
      path.join(repositoryRoot, "LICENSES", "Apache-2.0.txt"),
      path.join(fixture, "LICENSES", "Apache-2.0.txt"),
    );
    await cp(
      path.join(repositoryRoot, "apps", "web", "package.json"),
      path.join(fixture, "apps", "web", "package.json"),
    );
    await cp(
      path.join(repositoryRoot, "packages", "cli", "package.json"),
      path.join(fixture, "packages", "cli", "package.json"),
    );

    const cliPath = path.join(fixture, "packages", "cli", "package.json");
    const cli = JSON.parse(await readFile(cliPath, "utf8")) as {
      license: string;
    };
    cli.license = "UNLICENSED";
    await writeFile(cliPath, `${JSON.stringify(cli, null, 2)}\n`);
    const staleManifest = command(
      process.execPath,
      [path.join(repositoryRoot, "scripts", "check-project-license.mjs")],
      fixture,
    );
    expect(staleManifest.status).toBe(1);
    expect(staleManifest.stderr).toContain(
      "packages/cli/package.json: license must be BUSL-1.1",
    );

    cli.license = "BUSL-1.1";
    await writeFile(cliPath, `${JSON.stringify(cli, null, 2)}\n`);
    const policyPath = path.join(fixture, "license-policy.json");
    const policy = JSON.parse(await readFile(policyPath, "utf8")) as {
      additionalUseGrant: string;
    };
    policy.additionalUseGrant += " Expanded use.";
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    const changedGrant = command(
      process.execPath,
      [path.join(repositoryRoot, "scripts", "check-project-license.mjs")],
      fixture,
    );
    expect(changedGrant.status).toBe(1);
    expect(changedGrant.stderr).toContain(
      "Additional Use Grant differs from the owner-approved text",
    );

    policy.additionalUseGrant = policy.additionalUseGrant.replace(
      " Expanded use.",
      "",
    );
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    const licensePath = path.join(fixture, "LICENSE");
    const license = await readFile(licensePath, "utf8");
    await writeFile(
      licensePath,
      license.replace(
        "Change License: Apache License, Version 2.0",
        "Change License: Apache License, Version 2.0\n\nChange License: MIT",
      ),
    );
    const duplicateParameter = command(
      process.execPath,
      [path.join(repositoryRoot, "scripts", "check-project-license.mjs")],
      fixture,
    );
    expect(duplicateParameter.status).toBe(1);
    expect(duplicateParameter.stderr).toContain(
      "parameter block must contain only the exact permitted BSL parameters",
    );

    await writeFile(licensePath, license);
    const confirmedPolicy = {
      ...policy,
      finalParametersOwnerApproved: true,
      licensor: {
        proposedName: "INFINITY VENTURES",
        legalName: "Confirmed Example Corporation",
        legalForm: "SASU",
        legalNameConfirmed: true,
        licensingAuthorityConfirmed: true,
      },
    };
    await writeFile(
      policyPath,
      `${JSON.stringify(confirmedPolicy, null, 2)}\n`,
    );
    const staleLegalFiles = command(
      process.execPath,
      [path.join(repositoryRoot, "scripts", "check-release-license.mjs")],
      fixture,
    );
    expect(staleLegalFiles.status).toBe(1);
    expect(staleLegalFiles.stderr).toContain(
      "LICENSE does not name the exact confirmed licensor",
    );
    expect(staleLegalFiles.stderr).toContain(
      "NOTICE has stale or inconsistent licensor text",
    );
  });

  it("packs the confirmed license surfaces and emits undated candidate metadata and SBOM license data", async () => {
    const temporaryRoot = await mkdtemp(
      path.join(tmpdir(), "specra-license-candidate-"),
    );
    const output = path.join(temporaryRoot, "candidate");
    temporary.push(temporaryRoot);
    const built = command(process.execPath, [
      path.join(repositoryRoot, "scripts", "build-release-candidate.mjs"),
      output,
    ]);
    expect(built.status, built.stderr).toBe(0);

    const tarball = path.join(output, "specra-cli-0.1.0-rc.2.tgz");
    const consumer = path.join(temporaryRoot, "consumer");
    await mkdir(consumer);
    const installed = command("npm", [
      "install",
      "--prefix",
      consumer,
      tarball,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--cache",
      path.join(temporaryRoot, "npm-cache"),
    ]);
    expect(installed.status, installed.stderr).toBe(0);
    const installedCli = path.join(consumer, "node_modules", "@specra", "cli");
    for (const file of ["LICENSE", "NOTICE", "package.json"])
      await expect(
        readFile(path.join(installedCli, file), "utf8"),
      ).resolves.toBeTruthy();
    await expect(
      readFile(path.join(installedCli, "LICENSES", "Apache-2.0.txt"), "utf8"),
    ).resolves.toContain("Version 2.0, January 2004");

    const metadata = JSON.parse(
      await readFile(path.join(output, "license-metadata.json"), "utf8"),
    );
    expect(metadata).toMatchObject({
      changeDate: null,
      changeLicense: "Apache-2.0",
      currentLicense: "BUSL-1.1",
      firstPublicDistribution: null,
      finalParametersOwnerApproved: true,
      legalForm: "SASU",
      licensor: "INFINITY VENTURES",
      licensorConfirmed: true,
      version: "0.1.0-rc.2",
    });
    const audit = JSON.parse(
      await readFile(path.join(output, "release-audit.json"), "utf8"),
    );
    expect(audit).toMatchObject({
      license: "BUSL-1.1",
      licenseMetadata: "license-metadata.json",
      publicDistribution: "eligible-after-protected-review",
      version: "0.1.0-rc.2",
    });
    expect(audit.bundledDependencies).toContain("zod");
    expect(audit.bundledDependencies).toContain("parse-entities");
    expect(audit.bundledDependencies.length).toBeGreaterThan(10);
    const sbom = JSON.parse(
      await readFile(path.join(output, "specra-cli.cdx.json"), "utf8"),
    );
    expect(JSON.stringify(sbom)).toContain('"id":"BUSL-1.1"');
    const unistVersions = sbom.components
      .filter(
        (component: { group?: string; name?: string }) =>
          component.group === "@types" && component.name === "unist",
      )
      .map((component: { version?: string }) => component.version)
      .sort();
    expect(unistVersions).toEqual(["2.0.11", "3.0.3"]);
    const checksums = await readFile(path.join(output, "SHA256SUMS"), "utf8");
    expect(checksums).toContain("license-metadata.json");

    const packed = (await readdir(output)).find((name) =>
      name.endsWith(".tgz"),
    );
    expect(packed).toBe("specra-cli-0.1.0-rc.2.tgz");

    const confirmedRepository = path.join(temporaryRoot, "confirmed-repo");
    await mkdir(confirmedRepository);
    await cp(
      path.join(repositoryRoot, "package.json"),
      path.join(confirmedRepository, "package.json"),
    );
    await cp(
      path.join(repositoryRoot, "license-policy.json"),
      path.join(confirmedRepository, "license-policy.json"),
    );
    const publicDistributionModuleUrl = pathToFileURL(
      path.join(repositoryRoot, "scripts", "lib", "public-distribution.mjs"),
    ).href;
    const { recordPublicDistribution } = (await import(
      publicDistributionModuleUrl
    )) as {
      recordPublicDistribution(options: {
        repositoryRoot: string;
        candidateDirectory: string;
        firstPublicDistribution: string;
        today?: string;
      }): Promise<string>;
    };
    await expect(
      recordPublicDistribution({
        repositoryRoot: confirmedRepository,
        candidateDirectory: output,
        firstPublicDistribution: "2028-03-01",
        today: "2028-02-29",
      }),
    ).rejects.toThrow("cannot be a future date");
    const distributionRecord = await recordPublicDistribution({
      repositoryRoot: confirmedRepository,
      candidateDirectory: output,
      firstPublicDistribution: "2028-02-29",
      today: "2028-02-29",
    });
    await expect(readFile(distributionRecord, "utf8")).resolves.toContain(
      '"changeDate": "2031-02-28"',
    );
    await expect(
      readFile(path.join(output, "SHA256SUMS"), "utf8"),
    ).resolves.toContain("public-distribution-0.1.0-rc.2.json");
    await expect(
      recordPublicDistribution({
        repositoryRoot: confirmedRepository,
        candidateDirectory: output,
        firstPublicDistribution: "2028-02-29",
        today: "2028-02-29",
      }),
    ).rejects.toThrow("already exists");
  }, 60_000);

  it("passes the confirmed release state and fails closed on confirmation drift", async () => {
    const checked = command(process.execPath, [
      path.join(repositoryRoot, "scripts", "check-release-license.mjs"),
    ]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toContain(
      "Public release license gate passed for INFINITY VENTURES",
    );

    const fixture = await mkdtemp(path.join(tmpdir(), "specra-release-gate-"));
    temporary.push(fixture);
    for (const file of ["LICENSE", "NOTICE", "license-policy.json"])
      await cp(path.join(repositoryRoot, file), path.join(fixture, file));
    const policyPath = path.join(fixture, "license-policy.json");
    const policy = JSON.parse(await readFile(policyPath, "utf8"));
    const mutations = [
      { key: "legalNameConfirmed", value: false },
      { key: "licensingAuthorityConfirmed", value: false },
      { key: "legalName", value: null },
      { key: "legalForm", value: "UNKNOWN" },
    ];
    for (const mutation of mutations) {
      const candidate = structuredClone(policy);
      candidate.licensor[mutation.key] = mutation.value;
      await writeFile(policyPath, `${JSON.stringify(candidate, null, 2)}\n`);
      const rejected = command(
        process.execPath,
        [path.join(repositoryRoot, "scripts", "check-release-license.mjs")],
        fixture,
      );
      expect(rejected.status, mutation.key).toBe(1);
    }
    const unapproved = structuredClone(policy);
    unapproved.finalParametersOwnerApproved = false;
    await writeFile(policyPath, `${JSON.stringify(unapproved, null, 2)}\n`);
    const rejectedApproval = command(
      process.execPath,
      [path.join(repositoryRoot, "scripts", "check-release-license.mjs")],
      fixture,
    );
    expect(rejectedApproval.status).toBe(1);
    expect(rejectedApproval.stderr).toContain(
      "final populated license parameters are not owner-approved",
    );
  });

  it("derives each version's Change Date without treating a dry run as distribution", () => {
    const moduleUrl = pathToFileURL(
      path.join(repositoryRoot, "scripts", "lib", "license-policy.mjs"),
    ).href;
    const evaluated = command(process.execPath, [
      "--input-type=module",
      "--eval",
      `import { licenseMetadata } from ${JSON.stringify(moduleUrl)};
       const policy = { currentLicense: "BUSL-1.1", changeLicense: "Apache-2.0", finalParametersOwnerApproved: true, changeDatePolicy: { yearsAfterFirstPublicDistribution: 3, appliesPerVersion: true }, licensor: { proposedName: "INFINITY VENTURES", legalName: "INFINITY VENTURES", legalForm: "SASU", legalNameConfirmed: true, licensingAuthorityConfirmed: true } };
       console.log(JSON.stringify({ dryRun: licenseMetadata(policy, "0.1.0-rc.2"), published: licenseMetadata(policy, "0.1.0-rc.2", "2028-02-29") }));`,
    ]);
    expect(evaluated.status, evaluated.stderr).toBe(0);
    expect(JSON.parse(evaluated.stdout)).toMatchObject({
      dryRun: {
        changeDate: null,
        finalParametersOwnerApproved: true,
        firstPublicDistribution: null,
        legalForm: "SASU",
        licensor: "INFINITY VENTURES",
        licensorConfirmed: true,
      },
      published: {
        changeDate: "2031-02-28",
        firstPublicDistribution: "2028-02-29",
      },
    });
  });
});

async function manifestPaths(group: string): Promise<string[]> {
  return (
    await readdir(path.join(repositoryRoot, group), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(group, entry.name, "package.json"));
}

function command(
  executable: string,
  args: readonly string[],
  cwd = repositoryRoot,
) {
  return spawnSync(executable, args, { cwd, encoding: "utf8" });
}
