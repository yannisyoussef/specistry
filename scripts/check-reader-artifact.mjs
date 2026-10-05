// Build-time gate for the reader: `next build` does not touch the canonical
// artifact because every documentation route renders on demand, so this
// script validates `.specra/artifacts` for the configured project before the
// build starts and fails with the same actionable message the server uses.
// Usage: node scripts/check-reader-artifact.mjs (honours SPECRA_PROJECT_ROOT)
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  parseContentArtifact,
  parseNavigationArtifact,
} from "../packages/content/dist/index.js";
import {
  parseArtifactManifest,
  parseDocumentationArtifact,
} from "../packages/model/dist/index.js";

const ARTIFACT_DIRECTORY = ".specra/artifacts";
const root = path.resolve(
  process.env.SPECRA_PROJECT_ROOT && process.env.SPECRA_PROJECT_ROOT.length > 0
    ? process.env.SPECRA_PROJECT_ROOT
    : process.cwd(),
);
const hint =
  "Run `specra build` in the project and point SPECRA_PROJECT_ROOT at it before building the reader.";

function fail(message) {
  process.stderr.write(`[reader] ${message} ${hint}\n`);
  process.exit(1);
}

function read(name) {
  try {
    return readFileSync(path.join(root, ARTIFACT_DIRECTORY, name), "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? error.code
        : "unknown";
    fail(
      code === "ENOENT"
        ? `No canonical artifact was found at ${ARTIFACT_DIRECTORY}/${name}.`
        : `The canonical artifact ${ARTIFACT_DIRECTORY}/${name} could not be read (${code}).`,
    );
  }
}

let manifest;
try {
  manifest = parseArtifactManifest(read("manifest.json"));
} catch (error) {
  fail(
    `The artifact manifest is not a supported Specra manifest (${error.message}).`,
  );
}
let artifact;
try {
  artifact = parseDocumentationArtifact(read(manifest.files.documentation));
} catch (error) {
  fail(
    `The canonical artifact failed model validation (${String(error.message).slice(0, 200)}).`,
  );
}
if (artifact.model.project.id !== manifest.project.id) {
  fail(
    `The artifact manifest describes project "${manifest.project.id}" but the canonical artifact belongs to "${artifact.model.project.id}".`,
  );
}
const operations = artifact.model.versions.reduce(
  (total, version) =>
    total +
    version.services.reduce(
      (count, service) => count + service.operations.length,
      0,
    ),
  0,
);
if (operations !== manifest.statistics.operations) {
  fail(
    `The artifact manifest reports ${manifest.statistics.operations} operations but the canonical artifact contains ${operations}.`,
  );
}
// Authored content (SPEC-006) is optional; when the manifest lists it both
// artifacts must parse and agree with the page count and the asset records.
if (manifest.files.content !== undefined) {
  let content;
  let navigation;
  try {
    content = parseContentArtifact(read(manifest.files.content));
    navigation = parseNavigationArtifact(read(manifest.files.navigation));
  } catch (error) {
    fail(
      `The authored content artifacts failed validation (${String(error.message).slice(0, 200)}).`,
    );
  }
  if (content.pages.length !== (manifest.statistics.pages ?? 0)) {
    fail(
      `The artifact manifest reports ${manifest.statistics.pages ?? 0} pages but content.json contains ${content.pages.length}.`,
    );
  }
  const routes = new Set(content.pages.map((page) => page.route));
  const missing = [];
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.kind === "page" && !routes.has(node.route))
        missing.push(node.route);
      if (node.kind === "section") visit(node.items);
    }
  };
  visit(navigation.items);
  if (missing.length > 0) {
    fail(
      `navigation.json links to pages missing from content.json: ${missing.join(", ")}.`,
    );
  }
  for (const asset of manifest.assets ?? []) {
    try {
      readFileSync(path.join(root, ARTIFACT_DIRECTORY, asset.path));
    } catch {
      fail(`The manifest lists asset ${asset.path} but the file is missing.`);
    }
  }
}
process.stdout.write(
  `[reader] artifact ok: ${manifest.project.name}, ${operations} operations\n`,
);
