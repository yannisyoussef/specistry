import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  ARTIFACT_ASSETS_DIRECTORY,
  buildApiRouteTree,
  CONTENT_FORMAT_VERSION,
  NAVIGATION_FORMAT_VERSION,
  parseContentArtifact,
  parseNavigationArtifact,
  type ContentArtifact,
  type NavigationArtifact,
} from "@specra/content";
import {
  ARTIFACT_MANIFEST_FILENAME,
  ARTIFACT_MANIFEST_FORMAT,
  DOCUMENT_MODEL_VERSION,
  parseArtifactManifest,
  parseDocumentationArtifact,
  type ArtifactManifest,
  type DocumentationArtifact,
} from "@specra/model";
import {
  CANDIDATES_DIRECTORY,
  CATALOG_FILENAME,
  CHANGELOG_FILENAME,
  CHANGELOG_FORMAT_VERSION,
  CHANGELOG_SOURCE_DIRECTORY,
  createReleaseManifest,
  deriveRouteTable,
  DIFF_CANDIDATES_FILENAME,
  diffArtifacts,
  findRelease,
  MAX_RETAINED_RELEASES,
  parseChangelogSource,
  parseReleaseCatalog,
  parseReleaseManifest,
  REDIRECTS_FILENAME,
  REDIRECTS_FORMAT_VERSION,
  RELEASE_MANIFEST_FILENAME,
  RELEASES_DIRECTORY,
  ReleaseContractError,
  ROUTES_FILENAME,
  ROUTES_FORMAT_VERSION,
  serializeChangelog,
  serializeContractDiff,
  serializeRedirectTable,
  serializeReleaseCatalog,
  serializeReleaseManifest,
  serializeRouteTable,
  validateChangelog,
  validateRedirects,
  validateVersionId,
  versionKey,
  type CatalogRelease,
  type ContractDiff,
  type OperationLookup,
  type ReleaseCatalog,
  type ReleaseComponent,
  type ReleaseComponentName,
  type ReleaseManifest,
} from "@specra/release";

import {
  ARTIFACT_DIRECTORY,
  type BuildContext,
  type CatalogResult,
  type CatalogSummary,
  type Diagnostic,
  type FailureResult,
  type ReleaseOptions,
  type ReleaseResult,
  type ReleaseSummary,
  type ValidationOptions,
} from "./contracts.js";
import {
  artifactPath,
  cliPath,
  configPath,
  createDiagnostic,
  sortDiagnostics,
  sourcePath,
} from "./diagnostics.js";
import { createBuildContext } from "./orchestrator.js";
import { isPathWithin, resolveFutureProjectPath } from "./path-policy.js";

/**
 * Immutable release promotion (SPEC-010 §6–§7, §11–§17, §96–§98, §114).
 * `specra release <version>` freezes the exact candidate under
 * `.specra/artifacts` into `.specra/releases/<version>`: every candidate
 * file is verified against its manifest, the route table, redirects, and
 * the reviewed changelog are derived, the set is staged, fsynced, verified
 * again, and promoted with one atomic rename. A version that already
 * exists is an idempotent no-op when the bytes are identical and a hard
 * failure otherwise. The catalog, the only mutable file, is rewritten under
 * a lock; changing `current` never touches a release directory.
 */

const LOCK_FILENAME = ".lock";
const LOCK_STALE_MS = 60_000;
const LOCK_WAIT_MS = 10_000;
const LOCK_RETRY_MS = 50;
const CANDIDATE_VERSION = "candidate";

export interface CandidateFile {
  readonly name: string;
  readonly text: string;
  readonly format: number;
}

export interface Candidate {
  readonly manifest: ArtifactManifest;
  readonly manifestText: string;
  readonly artifact: DocumentationArtifact;
  readonly files: readonly CandidateFile[];
  readonly content?: ContentArtifact;
  readonly navigation?: NavigationArtifact;
  readonly assets: readonly {
    readonly name: string;
    readonly bytes: Buffer;
    readonly sha256: string;
  }[];
}

export type CandidateResult =
  | { readonly ok: true; readonly candidate: Candidate }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

export async function releaseProject(
  options: ReleaseOptions,
): Promise<ReleaseResult> {
  const contextResult = await createBuildContext(options);
  if (!contextResult.ok) return contextResult;
  const { context } = contextResult;
  const version = options.version;
  const issue = validateVersionId(version);
  if (issue !== undefined) {
    return failure("validation-failure", [
      createDiagnostic("VERSION_ID_INVALID", cliPath("/version")),
    ]);
  }
  if (options.from !== undefined && validateVersionId(options.from)) {
    return failure("validation-failure", [
      createDiagnostic("VERSION_ID_INVALID", cliPath("/from")),
    ]);
  }
  const store = await releaseStore(context);
  if (store === undefined) {
    return failure("validation-failure", [
      createDiagnostic("CONFIG_PATH_OUTSIDE_ROOT", configPath("releases")),
    ]);
  }
  const catalogResult = await readCatalog(store);
  if (!catalogResult.ok) return catalogResult;
  const catalog = catalogResult.catalog;
  if (catalog !== undefined) {
    const existing = catalog.releases.find(
      (release) =>
        versionKey(release.version) === versionKey(version) &&
        release.version !== version,
    );
    if (existing !== undefined) {
      return failure("validation-failure", [
        createDiagnostic("VERSION_ALREADY_EXISTS", cliPath("/version")),
      ]);
    }
    if (
      catalog.releases.length >= MAX_RETAINED_RELEASES &&
      findRelease(catalog, version) === undefined
    ) {
      return failure("validation-failure", [
        createDiagnostic("RELEASE_LIMIT_EXCEEDED", cliPath("/version")),
      ]);
    }
  }
  const candidateResult = await readCandidate(context);
  if (!candidateResult.ok)
    return failure("validation-failure", candidateResult.diagnostics);
  const { candidate } = candidateResult;
  if (context.signal.aborted) return cancelled();

  // Comparison base: explicit, else the current release, else none.
  const diagnostics: Diagnostic[] = [];
  let diff: ContractDiff | undefined;
  let previous:
    { artifact: DocumentationArtifact; version: string } | undefined;
  const from = options.noDiff ? undefined : (options.from ?? catalog?.current);
  if (from !== undefined) {
    if (catalog === undefined || findRelease(catalog, from) === undefined) {
      return failure("validation-failure", [
        createDiagnostic("VERSION_NOT_FOUND", cliPath("/from")),
      ]);
    }
    const base = await readReleaseDocumentation(store, from);
    if (!base.ok) return base;
    previous = { artifact: base.artifact, version: from };
    diff = diffArtifacts(
      {
        artifact: base.artifact,
        routes: operationRoutes(base.artifact),
        version: from,
      },
      {
        artifact: candidate.artifact,
        routes: operationRoutes(candidate.artifact),
        version,
      },
    );
    if (diff.truncated) {
      diagnostics.push(createDiagnostic("DIFF_TRUNCATED", cliPath("/from")));
    }
  }

  // Changelog: the author's reviewed notes, required once candidates exist.
  const changelogResult = await readChangelog(
    context,
    version,
    candidate,
    previous,
    diff,
  );
  if (!changelogResult.ok) {
    return failure(
      "validation-failure",
      sortDiagnostics([...diagnostics, ...changelogResult.diagnostics]),
    );
  }
  const changelogJson = changelogResult.json;

  // Route table and frozen redirects.
  const routes = deriveRouteTable({
    artifact: candidate.artifact,
    changelog: changelogJson !== undefined,
    content: candidate.content,
    navigation: candidate.navigation,
    version,
  });
  const redirects = validateRedirects(context.config.redirects, routes);
  for (const diagnostic of redirects.diagnostics) {
    diagnostics.push(
      createDiagnostic(
        diagnostic.code,
        configPath(`redirects.${diagnostic.index}`),
      ),
    );
  }
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return failure("validation-failure", sortDiagnostics(diagnostics));
  }
  if (context.signal.aborted) return cancelled();

  // The frozen component set.
  const generated: CandidateFile[] = [
    {
      format: ROUTES_FORMAT_VERSION,
      name: ROUTES_FILENAME,
      text: serializeRouteTable(routes),
    },
    {
      format: REDIRECTS_FORMAT_VERSION,
      name: REDIRECTS_FILENAME,
      text: serializeRedirectTable(redirects.table),
    },
    ...(changelogJson === undefined
      ? []
      : [
          {
            format: CHANGELOG_FORMAT_VERSION,
            name: CHANGELOG_FILENAME,
            text: changelogJson,
          },
        ]),
  ];
  const files = [...candidate.files, ...generated];
  const components: Partial<Record<ReleaseComponentName, ReleaseComponent>> =
    {};
  for (const file of files) {
    components[componentNameOf(file.name)] = {
      bytes: Buffer.byteLength(file.text, "utf8"),
      file: file.name,
      format: file.format,
      sha256: sha256(file.text),
    };
  }
  const manifest = createReleaseManifest({
    assets: candidate.assets.map((asset) => ({
      bytes: asset.bytes.byteLength,
      path: `${ARTIFACT_ASSETS_DIRECTORY}/${asset.name}`,
      sha256: asset.sha256,
    })),
    components,
    project: candidate.manifest.project,
    version,
  });
  const manifestText = serializeReleaseManifest(manifest);
  const bytes =
    files.reduce(
      (total, file) => total + Buffer.byteLength(file.text, "utf8"),
      0,
    ) +
    candidate.assets.reduce(
      (total, asset) => total + asset.bytes.byteLength,
      0,
    ) +
    Buffer.byteLength(manifestText, "utf8");

  // Immutability: identical bytes are an idempotent no-op; anything else fails.
  const final = path.join(store, version);
  const existing = await readExistingRelease(final);
  let unchanged = false;
  if (existing === "invalid") {
    return failure("validation-failure", [
      createDiagnostic("RELEASE_MANIFEST_INVALID", cliPath("/version")),
    ]);
  }
  if (existing !== undefined) {
    if (existing.digest !== manifest.digest) {
      return failure("validation-failure", [
        createDiagnostic("VERSION_ALREADY_EXISTS", cliPath("/version")),
      ]);
    }
    unchanged = true;
  } else {
    const promoted = await stageAndPromote(
      store,
      version,
      final,
      files,
      candidate.assets,
      manifestText,
      manifest.digest,
    );
    if (promoted === "conflict") {
      return failure("validation-failure", [
        createDiagnostic("VERSION_ALREADY_EXISTS", cliPath("/version")),
      ]);
    }
    if (promoted === "converged") unchanged = true;
    if (promoted === "failed") {
      return failure("internal-failure", [
        createDiagnostic("RELEASE_WRITE_FAILED", cliPath("/version")),
      ]);
    }
  }

  // Catalog update under the lock: append (idempotently) and select current.
  const updated = await updateCatalog(store, (current) => {
    const releases = current?.releases ?? [];
    const known = releases.find((release) => release.version === version);
    const entry: CatalogRelease = known ?? {
      changelog: changelogJson !== undefined,
      ...(options.date === undefined ? {} : { date: options.date }),
      digest: manifest.digest,
      ...(options.label === undefined ? {} : { label: options.label }),
      state: "supported",
      version,
    };
    if (known !== undefined && known.digest !== manifest.digest)
      return undefined;
    return {
      catalogFormat: 1,
      current:
        current === undefined || options.current ? version : current.current,
      releases: known === undefined ? [...releases, entry] : releases,
    };
  });
  if (!updated.ok) return updated;
  const summary: ReleaseSummary = {
    bytes,
    ...(diff === undefined
      ? {}
      : { candidates: diff.candidates.length, from: diff.from }),
    changelog: changelogJson !== undefined,
    components: Object.keys(components).sort(),
    current: updated.catalog.current,
    digest: manifest.digest,
    directory: `${RELEASES_DIRECTORY}/${version}`,
    unchanged,
    version,
  };
  return {
    context,
    diagnostics: sortDiagnostics(diagnostics),
    ok: true,
    outcome: "success",
    release: summary,
  };
}

/** `specra current <version>`: rewrites the catalog pointer only. */
export async function selectCurrentRelease(
  options: ValidationOptions & { readonly version: string },
): Promise<CatalogResult> {
  return await mutateCatalog(options, (catalog) => {
    if (findRelease(catalog, options.version) === undefined)
      return "VERSION_NOT_FOUND";
    return { ...catalog, current: options.version };
  });
}

/** `specra deprecate <version>`: lifecycle state only; the current release cannot be deprecated. */
export async function deprecateRelease(
  options: ValidationOptions & { readonly version: string },
): Promise<CatalogResult> {
  return await mutateCatalog(options, (catalog) => {
    if (findRelease(catalog, options.version) === undefined)
      return "VERSION_NOT_FOUND";
    if (catalog.current === options.version) return "VERSION_IS_CURRENT";
    return {
      ...catalog,
      releases: catalog.releases.map((release) =>
        release.version === options.version
          ? { ...release, state: "deprecated" }
          : release,
      ),
    };
  });
}

async function mutateCatalog(
  options: ValidationOptions & { readonly version: string },
  edit: (
    catalog: ReleaseCatalog,
  ) => ReleaseCatalog | "VERSION_IS_CURRENT" | "VERSION_NOT_FOUND",
): Promise<CatalogResult> {
  const contextResult = await createBuildContext(options);
  if (!contextResult.ok) return contextResult;
  const { context } = contextResult;
  if (validateVersionId(options.version)) {
    return failure("validation-failure", [
      createDiagnostic("VERSION_ID_INVALID", cliPath("/version")),
    ]);
  }
  const store = await releaseStore(context);
  if (store === undefined) {
    return failure("validation-failure", [
      createDiagnostic("CONFIG_PATH_OUTSIDE_ROOT", configPath("releases")),
    ]);
  }
  let code: "VERSION_IS_CURRENT" | "VERSION_NOT_FOUND" | undefined;
  const updated = await updateCatalog(store, (current) => {
    if (current === undefined) {
      code = "VERSION_NOT_FOUND";
      return undefined;
    }
    const next = edit(current);
    if (typeof next === "string") {
      code = next;
      return undefined;
    }
    return next;
  });
  if (!updated.ok) {
    if (code !== undefined) {
      return failure("validation-failure", [
        createDiagnostic(code, cliPath("/version")),
      ]);
    }
    return updated;
  }
  return {
    catalog: summarize(updated.catalog),
    context,
    diagnostics: [],
    ok: true,
    outcome: "success",
  };
}

function summarize(catalog: ReleaseCatalog): CatalogSummary {
  return {
    current: catalog.current,
    releases: catalog.releases.map((release) => ({
      changelog: release.changelog,
      digest: release.digest,
      state: release.state,
      version: release.version,
    })),
  };
}

/**
 * `specra build` companion: when a catalog exists, compare the candidate
 * with the comparison base and write the structured candidates to the
 * private candidates directory, which the reader never serves.
 */
export async function writeDiffCandidates(
  context: BuildContext,
  documentationJson: string,
  from: string | undefined,
): Promise<
  | {
      readonly ok: true;
      readonly candidates?: {
        readonly from: string;
        readonly count: number;
        readonly truncated: boolean;
      };
    }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }
> {
  const store = await releaseStore(context);
  if (store === undefined) return { ok: true };
  const catalogResult = await readCatalog(store);
  if (!catalogResult.ok)
    return { diagnostics: catalogResult.diagnostics, ok: false };
  const catalog = catalogResult.catalog;
  const base = from ?? catalog?.current;
  if (base === undefined) return { ok: true };
  if (
    validateVersionId(base) ||
    catalog === undefined ||
    findRelease(catalog, base) === undefined
  ) {
    return {
      diagnostics: [createDiagnostic("VERSION_NOT_FOUND", cliPath("/from"))],
      ok: false,
    };
  }
  const previous = await readReleaseDocumentation(store, base);
  if (!previous.ok) return { diagnostics: previous.diagnostics, ok: false };
  const artifact = parseDocumentationArtifact(documentationJson);
  const diff = diffArtifacts(
    {
      artifact: previous.artifact,
      routes: operationRoutes(previous.artifact),
      version: base,
    },
    { artifact, routes: operationRoutes(artifact), version: CANDIDATE_VERSION },
  );
  const directory = await resolveFutureProjectPath(
    context.projectRoot,
    CANDIDATES_DIRECTORY,
  );
  if (!directory.ok)
    return {
      diagnostics: [createDiagnostic("RELEASE_WRITE_FAILED", artifactPath(""))],
      ok: false,
    };
  try {
    await mkdir(directory.path, { recursive: true });
    const temporary = path.join(
      directory.path,
      `.${DIFF_CANDIDATES_FILENAME}.${randomBytes(4).toString("hex")}`,
    );
    await writeFile(temporary, serializeContractDiff(diff), "utf8");
    await rename(
      temporary,
      path.join(directory.path, DIFF_CANDIDATES_FILENAME),
    );
  } catch {
    return {
      diagnostics: [createDiagnostic("RELEASE_WRITE_FAILED", artifactPath(""))],
      ok: false,
    };
  }
  return {
    candidates: {
      count: diff.candidates.length,
      from: base,
      truncated: diff.truncated,
    },
    ok: true,
  };
}

// --- candidate ------------------------------------------------------------

export async function readCandidate(
  context: BuildContext,
): Promise<CandidateResult> {
  const directory = path.join(context.projectRoot, ARTIFACT_DIRECTORY);
  const missing = (pointer: string): CandidateResult => ({
    diagnostics: [createDiagnostic("CANDIDATE_MISSING", artifactPath(pointer))],
    ok: false,
  });
  const invalid = (pointer: string): CandidateResult => ({
    diagnostics: [createDiagnostic("CANDIDATE_INVALID", artifactPath(pointer))],
    ok: false,
  });
  let manifestText: string;
  try {
    manifestText = await readFile(
      path.join(directory, ARTIFACT_MANIFEST_FILENAME),
      "utf8",
    );
  } catch {
    return missing("");
  }
  let manifest: ArtifactManifest;
  try {
    manifest = parseArtifactManifest(manifestText);
  } catch {
    return invalid("/manifest");
  }
  const read = async (name: string): Promise<string | undefined> => {
    try {
      return await readFile(path.join(directory, name), "utf8");
    } catch {
      return undefined;
    }
  };
  const documentationText = await read(manifest.files.documentation);
  if (documentationText === undefined)
    return missing(`/${manifest.files.documentation}`);
  let artifact: DocumentationArtifact;
  try {
    artifact = parseDocumentationArtifact(documentationText);
  } catch {
    return invalid(`/${manifest.files.documentation}`);
  }
  if (artifact.model.project.id !== manifest.project.id)
    return invalid("/manifest");
  const files: CandidateFile[] = [
    {
      format: DOCUMENT_MODEL_VERSION,
      name: manifest.files.documentation,
      text: documentationText,
    },
    {
      format: ARTIFACT_MANIFEST_FORMAT,
      name: ARTIFACT_MANIFEST_FILENAME,
      text: manifestText,
    },
  ];
  let content: ContentArtifact | undefined;
  let navigation: NavigationArtifact | undefined;
  if (
    manifest.files.content !== undefined &&
    manifest.files.navigation !== undefined
  ) {
    const contentText = await read(manifest.files.content);
    const navigationText = await read(manifest.files.navigation);
    if (contentText === undefined || navigationText === undefined)
      return missing(`/${manifest.files.content}`);
    try {
      content = parseContentArtifact(contentText);
      navigation = parseNavigationArtifact(navigationText);
    } catch {
      return invalid(`/${manifest.files.content}`);
    }
    if (
      manifest.statistics.pages !== undefined &&
      manifest.statistics.pages !== content.pages.length
    ) {
      return invalid(`/${manifest.files.content}`);
    }
    files.push(
      {
        format: CONTENT_FORMAT_VERSION,
        name: manifest.files.content,
        text: contentText,
      },
      {
        format: NAVIGATION_FORMAT_VERSION,
        name: manifest.files.navigation,
        text: navigationText,
      },
    );
  }
  const digested: readonly [
    string | undefined,
    (
      | {
          readonly sha256: string;
          readonly bytes: number;
          readonly version: number;
        }
      | undefined
    ),
  ][] = [
    [manifest.files.search, manifest.search],
    [manifest.files.snippets, manifest.snippets],
    [manifest.files.playground, manifest.playground],
  ];
  for (const [name, record] of digested) {
    if (name === undefined || record === undefined) continue;
    const text = await read(name);
    if (text === undefined) return missing(`/${name}`);
    if (
      sha256(text) !== record.sha256 ||
      Buffer.byteLength(text, "utf8") !== record.bytes
    ) {
      return invalid(`/${name}`);
    }
    files.push({ format: record.version, name, text });
  }
  const assets: { name: string; bytes: Buffer; sha256: string }[] = [];
  for (const record of manifest.assets ?? []) {
    const name = record.path.slice(`${ARTIFACT_ASSETS_DIRECTORY}/`.length);
    let bytes: Buffer;
    try {
      bytes = await readFile(
        path.join(directory, ARTIFACT_ASSETS_DIRECTORY, name),
      );
    } catch {
      return missing(`/${record.path}`);
    }
    if (
      bytes.byteLength !== record.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== record.sha256
    ) {
      return invalid(`/${record.path}`);
    }
    assets.push({ bytes, name, sha256: record.sha256 });
  }
  return {
    candidate: {
      artifact,
      assets,
      ...(content === undefined ? {} : { content }),
      files,
      manifest,
      manifestText,
      ...(navigation === undefined ? {} : { navigation }),
    },
    ok: true,
  };
}

function componentNameOf(file: string): ReleaseComponentName {
  switch (file) {
    case "documentation.json":
      return "documentation";
    case ARTIFACT_MANIFEST_FILENAME:
      return "manifest";
    case "content.json":
      return "content";
    case "navigation.json":
      return "navigation";
    case "search.json":
      return "search";
    case "snippets.json":
      return "snippets";
    case "playground.json":
      return "playground";
    case ROUTES_FILENAME:
      return "routes";
    case REDIRECTS_FILENAME:
      return "redirects";
    case CHANGELOG_FILENAME:
      return "changelog";
    default:
      throw new Error(`Unknown release component file ${file}.`);
  }
}

/** Unversioned operation hrefs by `service~operation`, for diff route candidates. */
export function operationRoutes(
  artifact: DocumentationArtifact,
): ReadonlyMap<string, string> {
  const routes = new Map<string, string>();
  const tree = buildApiRouteTree(artifact);
  for (const service of tree.services) {
    for (const group of service.groups) {
      for (const operation of group.operations) {
        routes.set(`${service.id}~${operation.id}`, operation.href);
      }
    }
  }
  return routes;
}

function operationLookup(
  artifact: DocumentationArtifact,
): ReadonlyMap<string, OperationLookup> {
  const routes = operationRoutes(artifact);
  const lookup = new Map<string, OperationLookup>();
  const version =
    artifact.model.versions.find((entry) => entry.status === "current") ??
    artifact.model.versions[0];
  for (const service of version?.services ?? []) {
    for (const operation of service.operations) {
      const identity = `${service.id}~${operation.id}`;
      const route = routes.get(identity);
      lookup.set(identity, {
        identity,
        method: operation.method,
        path: operation.path,
        ...(route === undefined ? {} : { route }),
      });
    }
  }
  return lookup;
}

// --- changelog ------------------------------------------------------------

async function readChangelog(
  context: BuildContext,
  version: string,
  candidate: Candidate,
  previous: { artifact: DocumentationArtifact; version: string } | undefined,
  diff: ContractDiff | undefined,
): Promise<
  | { readonly ok: true; readonly json?: string }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] }
> {
  const relative = `${CHANGELOG_SOURCE_DIRECTORY}/${version}.json`;
  const file = path.join(
    context.projectRoot,
    CHANGELOG_SOURCE_DIRECTORY,
    `${version}.json`,
  );
  if (!isPathWithin(context.projectRoot, file)) {
    return {
      diagnostics: [
        createDiagnostic("CONFIG_PATH_OUTSIDE_ROOT", sourcePath(relative, "")),
      ],
      ok: false,
    };
  }
  let text: string | undefined;
  try {
    const entry = await lstat(file);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      return {
        diagnostics: [
          createDiagnostic("CHANGELOG_INVALID", sourcePath(relative, "")),
        ],
        ok: false,
      };
    }
    text = await readFile(file, "utf8");
  } catch {
    text = undefined;
  }
  const candidateIds =
    diff === undefined
      ? undefined
      : new Set(diff.candidates.map((entry) => entry.id));
  if (text === undefined) {
    if (candidateIds !== undefined && candidateIds.size > 0) {
      return {
        diagnostics: [
          createDiagnostic(
            "CHANGELOG_CANDIDATE_UNREVIEWED",
            sourcePath(relative, ""),
          ),
        ],
        ok: false,
      };
    }
    return { ok: true };
  }
  let source;
  try {
    source = parseChangelogSource(text);
  } catch (error) {
    const pointer = error instanceof ReleaseContractError ? error.path : "";
    return {
      diagnostics: [
        createDiagnostic("CHANGELOG_INVALID", sourcePath(relative, pointer)),
      ],
      ok: false,
    };
  }
  const validation = validateChangelog(source, {
    candidateIds,
    operations: operationLookup(candidate.artifact),
    previousOperations:
      previous === undefined ? undefined : operationLookup(previous.artifact),
    version,
  });
  if (validation.changelog === undefined) {
    return {
      diagnostics: validation.diagnostics.map((diagnostic) =>
        createDiagnostic(
          diagnostic.code,
          sourcePath(relative, diagnostic.path),
        ),
      ),
      ok: false,
    };
  }
  return { json: serializeChangelog(validation.changelog), ok: true };
}

// --- store ----------------------------------------------------------------

export async function releaseStore(
  context: BuildContext,
): Promise<string | undefined> {
  const resolved = await resolveFutureProjectPath(
    context.projectRoot,
    RELEASES_DIRECTORY,
  );
  return resolved.ok ? resolved.path : undefined;
}

export async function readCatalog(
  store: string,
): Promise<
  { readonly ok: true; readonly catalog?: ReleaseCatalog } | FailureResult
> {
  let text: string;
  try {
    text = await readFile(path.join(store, CATALOG_FILENAME), "utf8");
  } catch (error) {
    if (isMissing(error)) return { ok: true };
    return failure("validation-failure", [
      createDiagnostic("CATALOG_INVALID", cliPath("/catalog")),
    ]);
  }
  try {
    return { catalog: parseReleaseCatalog(text), ok: true };
  } catch {
    return failure("validation-failure", [
      createDiagnostic("CATALOG_INVALID", cliPath("/catalog")),
    ]);
  }
}

async function readReleaseDocumentation(
  store: string,
  version: string,
): Promise<
  | { readonly ok: true; readonly artifact: DocumentationArtifact }
  | FailureResult
> {
  const invalid = () =>
    failure("validation-failure", [
      createDiagnostic("RELEASE_MANIFEST_INVALID", cliPath("/from")),
    ]);
  const directory = path.join(store, version);
  if (!isPathWithin(store, directory)) return invalid();
  let manifest: ReleaseManifest;
  try {
    manifest = parseReleaseManifest(
      await readFile(path.join(directory, RELEASE_MANIFEST_FILENAME), "utf8"),
    );
  } catch {
    return invalid();
  }
  const component = manifest.components.documentation;
  if (component === undefined || manifest.version !== version) return invalid();
  let text: string;
  try {
    text = await readFile(path.join(directory, component.file), "utf8");
  } catch {
    return invalid();
  }
  if (
    sha256(text) !== component.sha256 ||
    Buffer.byteLength(text, "utf8") !== component.bytes
  )
    return invalid();
  try {
    return { artifact: parseDocumentationArtifact(text), ok: true };
  } catch {
    return invalid();
  }
}

async function readExistingRelease(
  final: string,
): Promise<ReleaseManifest | "invalid" | undefined> {
  let entry;
  try {
    entry = await lstat(final);
  } catch (error) {
    return isMissing(error) ? undefined : "invalid";
  }
  if (!entry.isDirectory()) return "invalid";
  try {
    return parseReleaseManifest(
      await readFile(path.join(final, RELEASE_MANIFEST_FILENAME), "utf8"),
    );
  } catch {
    return "invalid";
  }
}

/** Stage, fsync, verify, and promote with one rename; returns how it ended. */
async function stageAndPromote(
  store: string,
  version: string,
  final: string,
  files: readonly CandidateFile[],
  assets: readonly {
    readonly name: string;
    readonly bytes: Buffer;
    readonly sha256: string;
  }[],
  manifestText: string,
  digest: string,
): Promise<"conflict" | "converged" | "failed" | "promoted"> {
  const staging = path.join(
    store,
    `.staging-${version}-${randomBytes(6).toString("hex")}`,
  );
  try {
    await mkdir(store, { recursive: true });
    await mkdir(staging);
    for (const file of files)
      await writeSynced(path.join(staging, file.name), file.text);
    if (assets.length > 0) {
      await mkdir(path.join(staging, ARTIFACT_ASSETS_DIRECTORY));
      for (const asset of assets)
        await writeSynced(
          path.join(staging, ARTIFACT_ASSETS_DIRECTORY, asset.name),
          asset.bytes,
        );
    }
    await writeSynced(
      path.join(staging, RELEASE_MANIFEST_FILENAME),
      manifestText,
    );
    // Verify what landed on disk before anything becomes visible.
    for (const file of files) {
      if ((await readFile(path.join(staging, file.name), "utf8")) !== file.text)
        throw new Error("staged file mismatch");
    }
    for (const asset of assets) {
      const bytes = await readFile(
        path.join(staging, ARTIFACT_ASSETS_DIRECTORY, asset.name),
      );
      if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256)
        throw new Error("staged asset mismatch");
    }
    try {
      await rename(staging, final);
      return "promoted";
    } catch (error) {
      // Another process promoted first: converge when the bytes are identical.
      if (!isConflict(error)) throw error;
      const existing = await readExistingRelease(final);
      await rm(staging, { force: true, recursive: true });
      return existing !== undefined &&
        existing !== "invalid" &&
        existing.digest === digest
        ? "converged"
        : "conflict";
    }
  } catch {
    await rm(staging, { force: true, recursive: true }).catch(() => undefined);
    return "failed";
  }
}

async function writeSynced(file: string, data: string | Buffer): Promise<void> {
  const handle = await open(file, "wx");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Read-modify-write of the catalog under an exclusive lock file. */
async function updateCatalog(
  store: string,
  edit: (current: ReleaseCatalog | undefined) => ReleaseCatalog | undefined,
): Promise<
  { readonly ok: true; readonly catalog: ReleaseCatalog } | FailureResult
> {
  await mkdir(store, { recursive: true }).catch(() => undefined);
  const lock = path.join(store, LOCK_FILENAME);
  const acquired = await acquireLock(lock);
  if (!acquired)
    return failure("internal-failure", [
      createDiagnostic("RELEASE_LOCKED", cliPath("/catalog")),
    ]);
  try {
    const current = await readCatalog(store);
    if (!current.ok) return current;
    const next = edit(current.catalog);
    if (next === undefined) {
      return failure("validation-failure", [
        createDiagnostic("VERSION_ALREADY_EXISTS", cliPath("/version")),
      ]);
    }
    const text = serializeReleaseCatalog(next);
    parseReleaseCatalog(text);
    const temporary = path.join(
      store,
      `.${CATALOG_FILENAME}.${randomBytes(4).toString("hex")}`,
    );
    try {
      await writeSynced(temporary, text);
      await rename(temporary, path.join(store, CATALOG_FILENAME));
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined);
      return failure("internal-failure", [
        createDiagnostic("RELEASE_WRITE_FAILED", cliPath("/catalog")),
      ]);
    }
    return { catalog: next, ok: true };
  } catch {
    return failure("validation-failure", [
      createDiagnostic("CATALOG_INVALID", cliPath("/catalog")),
    ]);
  } finally {
    await rm(lock, { force: true }).catch(() => undefined);
  }
}

async function acquireLock(lock: string): Promise<boolean> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return true;
    } catch (error) {
      if (!isConflict(error)) return false;
      try {
        const entry = await lstat(lock);
        if (Date.now() - entry.mtimeMs > LOCK_STALE_MS) {
          await rm(lock, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }
}

// --- helpers --------------------------------------------------------------

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function isConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  const code = (error as { code?: string }).code;
  return (
    code === "EEXIST" ||
    code === "ENOTEMPTY" ||
    code === "EPERM" ||
    code === "EACCES"
  );
}

function cancelled(): FailureResult {
  return {
    diagnostics: [createDiagnostic("CANCELLED")],
    ok: false,
    outcome: "cancelled",
  };
}

function failure(
  outcome: "internal-failure" | "validation-failure",
  diagnostics: readonly Diagnostic[],
): FailureResult {
  return { diagnostics: sortDiagnostics(diagnostics), ok: false, outcome };
}
