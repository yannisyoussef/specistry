import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

async function main() {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    console.error(
      "Usage: node scripts/check-public-boundary.mjs <consumer> [...]",
    );
    process.exitCode = 64;
    return;
  }
  const violations = [];
  for (const supplied of roots) {
    const root = path.resolve(supplied);
    let metadata;
    try {
      metadata = await stat(root);
    } catch {
      violations.push(`${supplied}: consumer root does not exist`);
      continue;
    }
    if (!metadata.isDirectory()) {
      violations.push(`${supplied}: consumer root is not a directory`);
      continue;
    }
    for (const file of await implementationFiles(root)) {
      const source = await readFile(file, "utf8");
      const relative = path.relative(root, file).split(path.sep).join("/");
      inspect(source, `${supplied}/${relative}`, violations);
    }
  }
  if (violations.length > 0) {
    console.error(
      `Private Specistry boundary references found:\n${violations.join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Public Specistry boundary passed (${roots.length} consumer${roots.length === 1 ? "" : "s"}).`,
    );
  }
}

const inspectedExtensions = new Set([
  ".cjs",
  ".js",
  ".json",
  ".mjs",
  ".mts",
  ".sh",
  ".ts",
  ".yaml",
  ".yml",
  ".md",
  ".mdx",
  ".py",
]);
const ignoredDirectories = new Set([
  ".git",
  ".specistry",
  ".specra", // Historical local RC2 output; never a current configuration alias.
  ".specistry-tooling",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

async function implementationFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(
          ...(await implementationFiles(path.join(directory, entry.name))),
        );
      }
    } else if (
      entry.isFile() &&
      (entry.name === "Dockerfile" ||
        inspectedExtensions.has(path.extname(entry.name)))
    ) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files.sort();
}

function inspect(source, file, violations) {
  // Historical prose must opt in locally; executable files cannot exempt
  // themselves. This is a migration note, not a compatibility alias.
  const prose = /\.mdx?$/.test(file);
  const currentSource = prose
    ? source.replace(
        /<!-- specistry:historical -->[\s\S]*?<!-- \/specistry:historical -->/g,
        "",
      )
    : source;
  if (
    /@specra\/|\bspecra\s+(?:build|check)\b|\bSPECRA_[A-Z0-9_]+\b/.test(
      currentSource,
    )
  )
    violations.push(`${file}: active branding regression`);
  const rules = [
    [
      /(?:^|["'`/])packages\/[^/\s]+\/src(?:\/|["'`\s]|$)/m,
      "workspace source path",
    ],
    [/(?:^|["'`/])tests\/fixtures(?:\/|["'`\s]|$)/m, "private fixture path"],
    [
      /@specistry\/[a-z-]+\/(?:src|dist)(?:\/|["'`\s]|$)/m,
      "private package subpath",
    ],
    [/\b(?:workspace:|link:|file:\.\.?\/)/m, "local dependency protocol"],
    [/\b(?:test-helper|fixtures\.test-helper)\b/m, "test-helper import"],
  ];
  if (prose) return;
  for (const [pattern, label] of rules) {
    if (pattern.test(source)) violations.push(`${file}: ${label}`);
  }
  const allowedVariables = new Set([
    "SPECISTRY_PROJECT_ROOT",
    "SPECISTRY_SERVE",
    "SPECISTRY_SITE_URL",
    "SPECISTRY_CLI_TARBALL", // Documented Odexa integration artifact input.
  ]);
  for (const match of source.matchAll(/\bSPECISTRY_[A-Z0-9_]+\b/g)) {
    if (!allowedVariables.has(match[0])) {
      violations.push(`${file}: undocumented environment override ${match[0]}`);
    }
  }
}

await main();
