import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseContentArtifact, parseNavigationArtifact } from "@specra/content";
import {
  parseArtifactManifest,
  parseDocumentationArtifact,
} from "@specra/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { DocsPage } from "../../apps/web/components/reader/content/docs-page";
import { Shell } from "../../apps/web/components/reader/shell";
import { createReaderContent } from "../../apps/web/lib/reader/content";
import { createReaderIndex } from "../../apps/web/lib/reader/projection";

/**
 * Authored content at scale (SPEC-006): a synthetic 1,000-page site with
 * highlighted code on every page is built by the packed CLI in a fresh
 * process, then the largest page and the composed navigation are rendered to
 * HTML. Budgets are generous regression ceilings; the printed numbers are the
 * evidence recorded in docs/development/performance-accessibility.md.
 */

const cliPath = fileURLToPath(
  new URL("../../packages/cli/dist/bin.js", import.meta.url),
);
const evidencePath = fileURLToPath(
  new URL("./content-measurements.json", import.meta.url),
);
const temporary: string[] = [];
const evidence: Record<string, unknown>[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

afterAll(async () => {
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
});

const PAGES = 1_000;
const SECTIONS = 20;

function pageSource(section: number, index: number): string {
  const lines: string[] = [
    "---",
    `title: Section ${section} page ${index}`,
    `description: Synthetic page ${index} of section ${section} for the scale test.`,
    "---",
    "",
    `<Callout type="note" title="Scope">`,
    "",
    `Page ${index} links to [the next page](./page-${(index + 1) % 50}) and [Ping](/api/health/ping).`,
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

async function createSite(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "specra-content-scale-"));
  temporary.push(root);
  await writeFile(
    path.join(root, "openapi.yaml"),
    [
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
    ].join("\n"),
  );
  const navigation: string[] = [];
  let bytes = 0;
  for (let section = 0; section < SECTIONS; section += 1) {
    const directory = path.join(root, "docs", `section-${section}`);
    await mkdir(directory, { recursive: true });
    const items: string[] = [];
    for (let index = 0; index < PAGES / SECTIONS; index += 1) {
      const source = pageSource(section, index);
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
    `export default { schemaVersion: 1, name: "Scale", openapi: "./openapi.yaml", navigation: [${navigation.join(", ")}, { api: true }] };`,
  );
  evidence.push({ inputBytes: bytes, kind: "input", pages: PAGES });
  return root;
}

describe("authored content at scale", () => {
  it("builds 1,000 highlighted pages within the budgets and renders them within size limits", async () => {
    const root = await createSite();
    const started = performance.now();
    const build = spawnSync(
      process.execPath,
      [
        "-e",
        `const { buildProject } = await import(${JSON.stringify(cliPath.replace(/bin\.js$/, "index.js"))});
         const result = await buildProject({ cwd: process.argv[1] });
         process.stdout.write(JSON.stringify({ ok: result.ok, diagnostics: result.diagnostics.length, maxRssBytes: process.resourceUsage().maxRSS * 1024 }));`,
        "--input-type=module",
        "--",
        root,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1_024 * 1_024 },
    );
    const elapsedMs = performance.now() - started;
    expect(build.status, build.stderr).toBe(0);
    const summary = JSON.parse(build.stdout) as {
      ok: boolean;
      diagnostics: number;
      maxRssBytes: number;
    };
    expect(summary.ok).toBe(true);
    expect(summary.diagnostics).toBe(0);
    const artifacts = path.join(root, ".specra", "artifacts");
    const manifest = parseArtifactManifest(
      await readFile(path.join(artifacts, "manifest.json"), "utf8"),
    );
    expect(manifest.statistics.pages).toBe(PAGES);
    const contentJson = await readFile(
      path.join(artifacts, "content.json"),
      "utf8",
    );
    const content = parseContentArtifact(contentJson);
    const navigation = parseNavigationArtifact(
      await readFile(path.join(artifacts, "navigation.json"), "utf8"),
    );
    const reader = createReaderContent(content.pages, navigation, undefined);
    const largest = [...content.pages].sort(
      (a, b) => b.text.length - a.text.length,
    )[0];
    if (largest === undefined) throw new Error("no pages");
    const renderStart = performance.now();
    const html = renderToStaticMarkup(
      createElement(DocsPage, { content: reader, page: largest }),
    );
    const renderMs = performance.now() - renderStart;
    // The composed sidebar lists every authored page on every request.
    const index = createReaderIndex(
      parseDocumentationArtifact(
        await readFile(path.join(artifacts, "documentation.json"), "utf8"),
      ),
    );
    const shellStart = performance.now();
    const shellHtml = renderToStaticMarkup(
      createElement(
        Shell,
        { content: reader, currentPath: largest.route, index, mode: "system" },
        null,
      ),
    );
    const shellMs = performance.now() - shellStart;
    const measurement = {
      buildMs: Number(elapsedMs.toFixed(0)),
      contentBytes: Buffer.byteLength(contentJson, "utf8"),
      kind: "build-1000",
      maxRssBytes: summary.maxRssBytes,
      navigationEntries: reader.entries.length,
      navigationHtmlBytes: Buffer.byteLength(shellHtml, "utf8"),
      navigationRenderMs: Number(shellMs.toFixed(2)),
      pageHtmlBytes: Buffer.byteLength(html, "utf8"),
      pageRenderMs: Number(renderMs.toFixed(2)),
      pages: PAGES,
    };
    evidence.push(measurement);
    console.log(
      `[content] ${PAGES} pages: build ${measurement.buildMs} ms, peak RSS ${(measurement.maxRssBytes / 1_048_576).toFixed(0)} MiB, content.json ${(measurement.contentBytes / 1_048_576).toFixed(1)} MiB, largest page ${measurement.pageHtmlBytes} B in ${measurement.pageRenderMs} ms, composed navigation ${measurement.navigationHtmlBytes} B in ${measurement.navigationRenderMs} ms`,
    );
    // Ceilings: two minutes on a slow runner, 2 GiB peak, and the reader's
    // per-page HTML budget for the largest authored page.
    expect(elapsedMs).toBeLessThan(120_000);
    expect(summary.maxRssBytes).toBeLessThan(2 * 1_024 * 1_024 * 1_024);
    expect(measurement.pageHtmlBytes).toBeLessThan(200 * 1_024);
    // Navigation HTML grows linearly with pages; 1,000 links stay well
    // under the operation-page HTML budget and carry no client state.
    expect(measurement.navigationHtmlBytes).toBeLessThan(200 * 1_024);
    // Exactly two current markers: the Docs primary tab and the sidebar item.
    expect(shellHtml.match(/aria-current="page"/g)).toHaveLength(2);
    expect(reader.entries).toHaveLength(PAGES + 1);
  }, 180_000);
});
