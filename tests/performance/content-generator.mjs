// Deterministic synthetic authored site shared by the content (SPEC-006) and
// search (SPEC-007) performance cases: `pages` MDX pages across `sections`
// navigation sections, each with a callout, six highlighted code blocks, a
// table, and steps, plus an OpenAPI document (a tiny one by default, or a
// generated large one). Construction parameters are the fixture identity.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function pageSource(
  section,
  index,
  apiLink = "/api/health/ping",
  perSection = 50,
) {
  const lines = [
    "---",
    `title: Section ${section} page ${index}`,
    `description: Synthetic page ${index} of section ${section} for the scale test.`,
    "---",
    "",
    `<Callout type="note" title="Scope">`,
    "",
    `Page ${index} links to [the next page](./page-${(index + 1) % perSection})${apiLink.length === 0 ? "" : ` and [the API](${apiLink})`}.`,
    "",
    "</Callout>",
    "",
  ];
  for (let heading = 1; heading <= 6; heading += 1) {
    lines.push(`## Heading ${heading}`, "");
    lines.push(
      `Paragraph ${heading} with **strong**, _emphasis_, \`code\`, and a [link](#heading-${(heading % 6) + 1}).`,
      "",
    );
    lines.push(
      "```typescript",
      `export function step${heading}(input: number): string {`,
      `  // heading ${heading}`,
      `  const value = input * ${heading} + ${index};`,
      "  return `${value}`;",
      "}",
      "```",
      "",
    );
  }
  lines.push("| Column A | Column B | Column C |", "| --- | --- | --- |");
  for (let row = 0; row < 10; row += 1)
    lines.push(`| a${row} | b${row} | c${row} |`);
  lines.push(
    "",
    "<Steps>",
    "",
    '<Step title="One">',
    "",
    "First.",
    "",
    "</Step>",
    "",
    '<Step title="Two">',
    "",
    "Second.",
    "",
    "</Step>",
    "",
    "</Steps>",
    "",
  );
  return lines.join("\n");
}

export const PING_DOCUMENT = [
  "openapi: 3.1.0",
  "info:",
  "  title: Scale",
  "  version: 1.0.0",
  "paths:",
  "  /ping:",
  "    get:",
  "      operationId: ping",
  "      tags: [health]",
  "      responses:",
  '        "200":',
  "          description: OK.",
  "",
].join("\n");

/**
 * Writes a project under `root`. `openapi` is either YAML text (written as
 * `openapi.yaml`) or a JSON document object (written as `openapi.json`).
 * Returns the authored input size in bytes.
 */
export async function writeSyntheticSite(
  root,
  { pages = 1_000, sections = 20, openapi = PING_DOCUMENT } = {},
) {
  // Generated contracts (JSON text or objects) have no /ping operation; those
  // pages carry no API link.
  const text = typeof openapi === "string" ? openapi : JSON.stringify(openapi);
  const contract = text.trimStart().startsWith("{")
    ? "openapi.json"
    : "openapi.yaml";
  const apiLink = openapi === PING_DOCUMENT ? "/api/health/ping" : "";
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, contract), text);
  const navigation = [];
  let bytes = 0;
  const perSection = Math.ceil(pages / sections);
  for (let section = 0; section < sections; section += 1) {
    const directory = path.join(root, "docs", `section-${section}`);
    await mkdir(directory, { recursive: true });
    const items = [];
    for (let index = 0; index < perSection; index += 1) {
      const source = pageSource(section, index, apiLink, perSection);
      bytes += Buffer.byteLength(source, "utf8");
      await writeFile(path.join(directory, `page-${index}.mdx`), source);
      items.push(`"section-${section}/page-${index}"`);
    }
    navigation.push(
      `{ section: "Section ${section}", items: [${items.join(", ")}] }`,
    );
  }
  await writeFile(
    path.join(root, "specra.config.ts"),
    `export default { schemaVersion: 1, name: "Scale", openapi: "./${contract}", navigation: [${navigation.join(", ")}, { api: true }] };`,
  );
  return bytes;
}
