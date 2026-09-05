import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ignored = new Set([
  ".git",
  ".next",
  ".pnpm-store",
  "coverage",
  "dist",
  "node_modules",
]);
const checks = [
  {
    name: "private key",
    pattern: /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/,
  },
  { name: "GitHub token", pattern: /\bgh[opusr]_[A-Za-z0-9]{36,}\b/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: "assigned secret",
    pattern:
      /(?:api[_-]?key|client[_-]?secret|password|private[_-]?key|token)\s*[:=]\s*["']?[A-Za-z0-9+/_=-]{24,}/i,
  },
];
const findings = [];

for (const file of await filesUnder(process.cwd())) {
  if ((await stat(file)).size > 2 * 1024 * 1024) continue;
  let source;
  try {
    source = await readFile(file, "utf8");
  } catch {
    continue;
  }
  for (const check of checks) {
    if (check.pattern.test(source))
      findings.push(`${path.relative(process.cwd(), file)}: ${check.name}`);
  }
}

if (findings.length > 0) {
  console.error(
    `Potential secrets found (values redacted):\n${findings.join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    "Working-tree secret patterns passed (matched values are never printed). ",
  );
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(resolved)));
    else if (entry.isFile()) files.push(resolved);
  }
  return files;
}
