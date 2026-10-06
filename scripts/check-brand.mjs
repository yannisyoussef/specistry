import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const findings = [];
for (const file of files) {
  if (
    file.startsWith("docs/adr/") ||
    file.startsWith("docs/reviews/") ||
    file === "release-ledger/0.1.0-rc.2.json" ||
    file === "docs/brand-migration.md" ||
    file === "scripts/check-brand.mjs" ||
    file === "scripts/check-public-boundary.mjs" ||
    file.startsWith("logo/") ||
    file.startsWith(".agent/") ||
    (/\.test\.(?:ts|tsx)$/.test(file) && !file.startsWith("tests/fixtures/"))
  )
    continue;
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  if (
    bytes.includes(0) &&
    !/\.(?:ts|tsx|js|mjs|json|md|mdx|yml|yaml)$/.test(file)
  )
    continue;
  let source = bytes.toString("utf8");
  if (file === "README.md")
    source = source.replace(
      /^Specistry was previously released as Specra\..*$/m,
      "",
    );
  if (file === "docs/release-process.md")
    source = source
      .replace(/Specra 0\.1\.0-rc\.2/g, "historical RC2")
      .replaceAll("release-ledger/0.1.0-rc.2.json", "historical ledger")
      .replaceAll("yannisyoussef/specra", "previous repository");
  if (file === ".gitignore") source = source.replace(/^\*\*\/\.specra\/$/m, "");
  if (
    [
      "scripts/lib/npm-publication.mjs",
      "scripts/verify-npm-release.mjs",
    ].includes(file)
  )
    source = source.replaceAll("@specra\\/", "").replaceAll("@specra/", "");
  if (/Specra|specra|SPECRA/.test(source) || /specra/.test(file))
    findings.push(file);
}
const ledger = await readFile("release-ledger/0.1.0-rc.2.json");
if (
  createHash("sha256").update(ledger).digest("hex") !==
  "76928299b2f83e5f9698b0a8cfb55753ee9e37ad913889b50d0bc97743c5058f"
)
  findings.push("immutable RC2 ledger changed");
if (findings.length)
  throw new Error(`Active branding regression:\n${findings.join("\n")}`);
console.log("Active Specistry identity and immutable RC2 ledger passed.");
