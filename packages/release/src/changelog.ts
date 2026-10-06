import {
  hasOnlyKeys,
  isRecord,
  ReleaseContractError,
  sortKeys,
} from "./manifest.js";
import type { RouteTable } from "./routes.js";
import { validateVersionId } from "./version.js";

/**
 * Human-reviewed changelog (SPEC-010 §86–§93). The source is a controlled
 * JSON document the author writes (`changelog/<version>.json`): a title,
 * a summary, dated entries with categorized items, and an explicit
 * disposition of every structured diff candidate (`included` through an
 * item's `candidates`, or `omitted`). Item text is plain text rendered as
 * text. Nothing here is generated prose: Specistry validates and publishes
 * exactly what the author wrote, and a candidate the author never
 * dispositioned blocks the release.
 */

export const CHANGELOG_FORMAT_VERSION = 1 as const;
export const CHANGELOG_FILENAME = "changelog.json";
export const CHANGELOG_SOURCE_DIRECTORY = "changelog";
export const MAX_CHANGELOG_ENTRIES = 500;
export const MAX_CHANGELOG_ITEMS = 200;
export const MAX_CHANGELOG_SOURCE_BYTES = 512 * 1_024;
const MAX_TEXT = 1_000;
const MAX_TITLE = 200;
const MAX_TARGET = 200;

export const CHANGELOG_ITEM_KINDS = [
  "added",
  "changed",
  "deprecated",
  "fixed",
  "removed",
] as const;
export type ChangelogItemKind = (typeof CHANGELOG_ITEM_KINDS)[number];

export interface ChangelogSourceItem {
  readonly kind: ChangelogItemKind;
  readonly text: string;
  /** `service~operation` canonical identity in this release (or the compared one for removals). */
  readonly operation?: string;
  /** Free-form subject (a schema field, an SDK method) shown in mono text. */
  readonly target?: string;
  /** Diff candidate ids this item describes. */
  readonly candidates?: readonly string[];
}

export interface ChangelogSourceEntry {
  readonly date?: string;
  readonly items: readonly ChangelogSourceItem[];
}

export interface ChangelogSource {
  readonly title: string;
  readonly summary?: string;
  /** The release these notes describe changes from. */
  readonly from?: string;
  readonly entries: readonly ChangelogSourceEntry[];
  /** Candidate ids reviewed and intentionally not described, or `"all"`. */
  readonly omitted?: readonly string[] | "all";
}

export interface ChangelogItem {
  readonly kind: ChangelogItemKind;
  readonly text: string;
  readonly target?: string;
  readonly operation?: {
    readonly identity: string;
    readonly method: string;
    readonly path: string;
    /** Unversioned route (`/api/...`), scoped by the reader; absent for removed operations. */
    readonly route?: string;
  };
  readonly candidates: readonly string[];
}

export interface ChangelogEntry {
  readonly date?: string;
  readonly items: readonly ChangelogItem[];
}

export interface PublishedChangelog {
  readonly changelogFormat: typeof CHANGELOG_FORMAT_VERSION;
  readonly version: string;
  readonly from?: string;
  readonly title: string;
  readonly summary?: string;
  readonly entries: readonly ChangelogEntry[];
  readonly reviewed: {
    readonly included: readonly string[];
    readonly omitted: readonly string[];
  };
}

export type ChangelogDiagnosticCode =
  | "CHANGELOG_CANDIDATE_UNKNOWN"
  | "CHANGELOG_CANDIDATE_UNREVIEWED"
  | "CHANGELOG_INVALID"
  | "CHANGELOG_OPERATION_NOT_FOUND";

export interface ChangelogDiagnostic {
  readonly code: ChangelogDiagnosticCode;
  /** JSON pointer into the source document. */
  readonly path: string;
}

export const CHANGELOG_MESSAGES: Readonly<
  Record<ChangelogDiagnosticCode, string>
> = {
  CHANGELOG_CANDIDATE_UNKNOWN:
    "The changelog references a diff candidate that does not exist.",
  CHANGELOG_CANDIDATE_UNREVIEWED:
    "A structured diff candidate is neither described by an item nor listed as omitted.",
  CHANGELOG_INVALID:
    "The changelog source does not match the changelog contract.",
  CHANGELOG_OPERATION_NOT_FOUND:
    "The changelog item names an operation this release does not contain.",
};

const DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const CANDIDATE_ID =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}:[a-z-]+:[^\s]{1,300}$/;

export interface OperationLookup {
  readonly identity: string;
  readonly method: string;
  readonly path: string;
  readonly route?: string;
}

export interface ChangelogValidationInput {
  readonly version: string;
  /** Operations of this release by `service~operation`. */
  readonly operations: ReadonlyMap<string, OperationLookup>;
  /** Operations of the compared release, for removals. */
  readonly previousOperations?:
    ReadonlyMap<string, OperationLookup> | undefined;
  /** Every candidate id of the structured diff, when one exists. */
  readonly candidateIds?: ReadonlySet<string> | undefined;
  readonly routes?: RouteTable | undefined;
}

export interface ChangelogValidation {
  readonly changelog?: PublishedChangelog;
  readonly diagnostics: readonly ChangelogDiagnostic[];
}

/** Parses the author's JSON; throws `ReleaseContractError` on shape violations. */
export function parseChangelogSource(text: string): ChangelogSource {
  if (Buffer.byteLength(text, "utf8") > MAX_CHANGELOG_SOURCE_BYTES) {
    throw new ReleaseContractError(
      "Changelog source exceeds the size limit.",
      "/",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReleaseContractError("Changelog source is not valid JSON.", "/");
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["entries", "from", "omitted", "summary", "title"])
  ) {
    throw new ReleaseContractError(
      "Changelog source shape is not recognized.",
      "/",
    );
  }
  const title = text_(value.title, MAX_TITLE, "/title");
  const summary =
    value.summary === undefined
      ? undefined
      : text_(value.summary, MAX_TEXT, "/summary");
  if (
    value.from !== undefined &&
    (typeof value.from !== "string" || validateVersionId(value.from))
  ) {
    throw new ReleaseContractError(
      "Changelog `from` is not a version id.",
      "/from",
    );
  }
  if (
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_CHANGELOG_ENTRIES
  ) {
    throw new ReleaseContractError(
      "Changelog entries must be a bounded list.",
      "/entries",
    );
  }
  const entries: ChangelogSourceEntry[] = value.entries.map((entry, index) => {
    const path = `/entries/${index}`;
    if (!isRecord(entry) || !hasOnlyKeys(entry, ["date", "items"])) {
      throw new ReleaseContractError("Changelog entry shape is invalid.", path);
    }
    if (
      entry.date !== undefined &&
      (typeof entry.date !== "string" || !DATE.test(entry.date))
    ) {
      throw new ReleaseContractError(
        "Changelog entry date must be YYYY-MM-DD.",
        `${path}/date`,
      );
    }
    if (
      !Array.isArray(entry.items) ||
      entry.items.length === 0 ||
      entry.items.length > MAX_CHANGELOG_ITEMS
    ) {
      throw new ReleaseContractError(
        "Changelog entry items must be a bounded, non-empty list.",
        `${path}/items`,
      );
    }
    const items: ChangelogSourceItem[] = entry.items.map((item, itemIndex) => {
      const itemPath = `${path}/items/${itemIndex}`;
      if (
        !isRecord(item) ||
        !hasOnlyKeys(item, [
          "candidates",
          "kind",
          "operation",
          "target",
          "text",
        ])
      ) {
        throw new ReleaseContractError(
          "Changelog item shape is invalid.",
          itemPath,
        );
      }
      if (
        typeof item.kind !== "string" ||
        !(CHANGELOG_ITEM_KINDS as readonly string[]).includes(item.kind)
      ) {
        throw new ReleaseContractError(
          "Changelog item kind is invalid.",
          `${itemPath}/kind`,
        );
      }
      const itemText = text_(item.text, MAX_TEXT, `${itemPath}/text`);
      const operation =
        item.operation === undefined
          ? undefined
          : text_(item.operation, 300, `${itemPath}/operation`);
      const target =
        item.target === undefined
          ? undefined
          : text_(item.target, MAX_TARGET, `${itemPath}/target`);
      let candidates: string[] | undefined;
      if (item.candidates !== undefined) {
        if (!Array.isArray(item.candidates) || item.candidates.length > 50) {
          throw new ReleaseContractError(
            "Changelog item candidates must be a bounded list.",
            `${itemPath}/candidates`,
          );
        }
        candidates = item.candidates.map((candidate, candidateIndex) => {
          if (typeof candidate !== "string" || !CANDIDATE_ID.test(candidate)) {
            throw new ReleaseContractError(
              "Changelog candidate id is invalid.",
              `${itemPath}/candidates/${candidateIndex}`,
            );
          }
          return candidate;
        });
      }
      return {
        ...(candidates === undefined ? {} : { candidates }),
        kind: item.kind as ChangelogItemKind,
        ...(operation === undefined ? {} : { operation }),
        ...(target === undefined ? {} : { target }),
        text: itemText,
      };
    });
    return {
      ...(entry.date === undefined ? {} : { date: entry.date as string }),
      items,
    };
  });
  let omitted: readonly string[] | "all" | undefined;
  if (value.omitted !== undefined) {
    if (value.omitted === "all") omitted = "all";
    else if (
      Array.isArray(value.omitted) &&
      value.omitted.length <= MAX_DIFF_REFERENCES
    ) {
      omitted = value.omitted.map((candidate, index) => {
        if (typeof candidate !== "string" || !CANDIDATE_ID.test(candidate)) {
          throw new ReleaseContractError(
            "Omitted candidate id is invalid.",
            `/omitted/${index}`,
          );
        }
        return candidate;
      });
    } else {
      throw new ReleaseContractError(
        'Changelog `omitted` must be a candidate list or "all".',
        "/omitted",
      );
    }
  }
  return {
    entries,
    ...(value.from === undefined ? {} : { from: value.from as string }),
    ...(omitted === undefined ? {} : { omitted }),
    ...(summary === undefined ? {} : { summary }),
    title,
  };
}

const MAX_DIFF_REFERENCES = 20_000;

/** Validates the source against the release and publishes it; diagnostics block publication. */
export function validateChangelog(
  source: ChangelogSource,
  input: ChangelogValidationInput,
): ChangelogValidation {
  const diagnostics: ChangelogDiagnostic[] = [];
  const included = new Set<string>();
  const entries: ChangelogEntry[] = source.entries.map((entry, index) => ({
    ...(entry.date === undefined ? {} : { date: entry.date }),
    items: entry.items.map((item, itemIndex): ChangelogItem => {
      const path = `/entries/${index}/items/${itemIndex}`;
      let operation: ChangelogItem["operation"];
      if (item.operation !== undefined) {
        const found =
          item.kind === "removed"
            ? (input.previousOperations?.get(item.operation) ??
              input.operations.get(item.operation))
            : input.operations.get(item.operation);
        if (found === undefined) {
          diagnostics.push({
            code: "CHANGELOG_OPERATION_NOT_FOUND",
            path: `${path}/operation`,
          });
        } else {
          operation = {
            identity: found.identity,
            method: found.method,
            path: found.path,
            ...(found.route === undefined || item.kind === "removed"
              ? {}
              : { route: found.route }),
          };
        }
      }
      const candidates = item.candidates ?? [];
      candidates.forEach((candidate, candidateIndex) => {
        if (
          input.candidateIds !== undefined &&
          !input.candidateIds.has(candidate)
        ) {
          diagnostics.push({
            code: "CHANGELOG_CANDIDATE_UNKNOWN",
            path: `${path}/candidates/${candidateIndex}`,
          });
        }
        included.add(candidate);
      });
      return {
        candidates: [...candidates].sort(),
        kind: item.kind,
        ...(operation === undefined ? {} : { operation }),
        ...(item.target === undefined ? {} : { target: item.target }),
        text: item.text,
      };
    }),
  }));
  const omitted = new Set<string>();
  if (input.candidateIds !== undefined) {
    if (source.omitted === "all") {
      for (const id of input.candidateIds)
        if (!included.has(id)) omitted.add(id);
    } else {
      (source.omitted ?? []).forEach((candidate, index) => {
        if (!input.candidateIds?.has(candidate)) {
          diagnostics.push({
            code: "CHANGELOG_CANDIDATE_UNKNOWN",
            path: `/omitted/${index}`,
          });
        } else omitted.add(candidate);
      });
      for (const id of [...input.candidateIds].sort()) {
        if (!included.has(id) && !omitted.has(id)) {
          diagnostics.push({
            code: "CHANGELOG_CANDIDATE_UNREVIEWED",
            path: `/candidates/${encodePointer(id)}`,
          });
        }
      }
    }
  } else if (Array.isArray(source.omitted)) {
    source.omitted.forEach((_candidate, index) => {
      diagnostics.push({
        code: "CHANGELOG_CANDIDATE_UNKNOWN",
        path: `/omitted/${index}`,
      });
    });
  }
  if (diagnostics.length > 0) return { diagnostics };
  return {
    changelog: {
      changelogFormat: CHANGELOG_FORMAT_VERSION,
      entries,
      ...(source.from === undefined ? {} : { from: source.from }),
      reviewed: {
        included: [...included].sort(),
        omitted: [...omitted].sort(),
      },
      ...(source.summary === undefined ? {} : { summary: source.summary }),
      title: source.title,
      version: input.version,
    },
    diagnostics,
  };
}

export function serializeChangelog(changelog: PublishedChangelog): string {
  return `${JSON.stringify(sortKeys(changelog))}\n`;
}

export function parseChangelog(text: string): PublishedChangelog {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReleaseContractError(
      "Published changelog is not valid JSON.",
      "/",
    );
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "changelogFormat",
      "entries",
      "from",
      "reviewed",
      "summary",
      "title",
      "version",
    ]) ||
    value.changelogFormat !== CHANGELOG_FORMAT_VERSION ||
    typeof value.version !== "string" ||
    validateVersionId(value.version) ||
    (value.from !== undefined &&
      (typeof value.from !== "string" || validateVersionId(value.from))) ||
    !isRecord(value.reviewed) ||
    !hasOnlyKeys(value.reviewed, ["included", "omitted"]) ||
    !isStringList(value.reviewed.included, MAX_DIFF_REFERENCES) ||
    !isStringList(value.reviewed.omitted, MAX_DIFF_REFERENCES)
  ) {
    throw new ReleaseContractError(
      "Published changelog shape is not recognized.",
      "/",
    );
  }
  const title = text_(value.title, MAX_TITLE, "/title");
  const summary =
    value.summary === undefined
      ? undefined
      : text_(value.summary, MAX_TEXT, "/summary");
  if (
    !Array.isArray(value.entries) ||
    value.entries.length > MAX_CHANGELOG_ENTRIES
  ) {
    throw new ReleaseContractError(
      "Published changelog entries are invalid.",
      "/entries",
    );
  }
  const entries: ChangelogEntry[] = value.entries.map((entry, index) => {
    const path = `/entries/${index}`;
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["date", "items"]) ||
      !Array.isArray(entry.items) ||
      entry.items.length > MAX_CHANGELOG_ITEMS
    ) {
      throw new ReleaseContractError(
        "Published changelog entry is invalid.",
        path,
      );
    }
    if (
      entry.date !== undefined &&
      (typeof entry.date !== "string" || !DATE.test(entry.date))
    ) {
      throw new ReleaseContractError(
        "Published changelog date is invalid.",
        `${path}/date`,
      );
    }
    const items: ChangelogItem[] = entry.items.map((item, itemIndex) => {
      const itemPath = `${path}/items/${itemIndex}`;
      if (
        !isRecord(item) ||
        !hasOnlyKeys(item, [
          "candidates",
          "kind",
          "operation",
          "target",
          "text",
        ]) ||
        typeof item.kind !== "string" ||
        !(CHANGELOG_ITEM_KINDS as readonly string[]).includes(item.kind) ||
        !isStringList(item.candidates, 50)
      ) {
        throw new ReleaseContractError(
          "Published changelog item is invalid.",
          itemPath,
        );
      }
      let operation: ChangelogItem["operation"];
      if (item.operation !== undefined) {
        if (
          !isRecord(item.operation) ||
          !hasOnlyKeys(item.operation, [
            "identity",
            "method",
            "path",
            "route",
          ]) ||
          (item.operation.route !== undefined &&
            !/^\/api(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(
              String(item.operation.route),
            ))
        ) {
          throw new ReleaseContractError(
            "Published changelog operation is invalid.",
            `${itemPath}/operation`,
          );
        }
        operation = {
          identity: text_(
            item.operation.identity,
            300,
            `${itemPath}/operation/identity`,
          ),
          method: text_(
            item.operation.method,
            10,
            `${itemPath}/operation/method`,
          ),
          path: text_(item.operation.path, 2_048, `${itemPath}/operation/path`),
          ...(item.operation.route === undefined
            ? {}
            : { route: item.operation.route as string }),
        };
      }
      return {
        candidates: item.candidates as string[],
        kind: item.kind as ChangelogItemKind,
        ...(operation === undefined ? {} : { operation }),
        ...(item.target === undefined
          ? {}
          : { target: text_(item.target, MAX_TARGET, `${itemPath}/target`) }),
        text: text_(item.text, MAX_TEXT, `${itemPath}/text`),
      };
    });
    return {
      ...(entry.date === undefined ? {} : { date: entry.date as string }),
      items,
    };
  });
  return {
    changelogFormat: CHANGELOG_FORMAT_VERSION,
    entries,
    ...(value.from === undefined ? {} : { from: value.from as string }),
    reviewed: {
      included: value.reviewed.included as string[],
      omitted: value.reviewed.omitted as string[],
    },
    ...(summary === undefined ? {} : { summary }),
    title,
    version: value.version,
  };
}

function text_(value: unknown, max: number, path: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  ) {
    throw new ReleaseContractError(
      "Changelog text is missing, empty, too long, or contains control characters.",
      path,
    );
  }
  return value;
}

function isStringList(value: unknown, max: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= max &&
    value.every((item) => typeof item === "string" && item.length <= 400)
  );
}

function encodePointer(segment: string): string {
  return segment.replace(/\//g, "~1");
}
