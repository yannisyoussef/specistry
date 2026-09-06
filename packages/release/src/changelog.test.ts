import { describe, expect, it } from "vitest";

import {
  CHANGELOG_MESSAGES,
  parseChangelog,
  parseChangelogSource,
  serializeChangelog,
  validateChangelog,
  type OperationLookup,
} from "./changelog.js";
import { ReleaseContractError } from "./manifest.js";

/**
 * SPEC-010 §86–§93, §161: the author's controlled source, the explicit
 * candidate disposition, and the published document. Nothing is generated;
 * an undispositioned candidate blocks publication.
 */

const operations = new Map<string, OperationLookup>([
  [
    "svc~waitForMessage",
    {
      identity: "svc~waitForMessage",
      method: "POST",
      path: "/inboxes/{id}/messages/wait",
      route: "/api/inboxes/wait-for-message",
    },
  ],
  [
    "svc~getInbox",
    {
      identity: "svc~getInbox",
      method: "GET",
      path: "/inboxes/{id}",
      route: "/api/inboxes/get-inbox",
    },
  ],
]);
const previous = new Map<string, OperationLookup>([
  [
    "svc~getRawMessage",
    {
      identity: "svc~getRawMessage",
      method: "GET",
      path: "/inboxes/{id}/raw",
      route: "/api/messages/get-raw-message",
    },
  ],
]);
const candidateIds = new Set([
  "v1..v2:operation-added:svc~waitForMessage",
  "v1..v2:operation-removed:svc~getRawMessage",
  "v1..v2:schema-changed:svc~Inbox",
]);

const source = JSON.stringify({
  entries: [
    {
      date: "2026-09-05",
      items: [
        {
          candidates: ["v1..v2:operation-added:svc~waitForMessage"],
          kind: "added",
          operation: "svc~waitForMessage",
          text: "Wait synchronously for an incoming message.",
        },
        {
          candidates: ["v1..v2:operation-removed:svc~getRawMessage"],
          kind: "removed",
          operation: "svc~getRawMessage",
          text: "Use Message.headers and content instead.",
        },
        {
          kind: "changed",
          target: "Inbox.expiresAt",
          text: "Now uses RFC 3339 with a Z suffix.",
        },
      ],
    },
  ],
  from: "v1",
  omitted: ["v1..v2:schema-changed:svc~Inbox"],
  summary: "API and SDK changes for v2.",
  title: "Changelog",
});

describe("changelog source", () => {
  it("publishes exactly what the author wrote with resolved operations and dispositions", () => {
    const parsed = parseChangelogSource(source);
    const { changelog, diagnostics } = validateChangelog(parsed, {
      candidateIds,
      operations,
      previousOperations: previous,
      version: "v2",
    });
    expect(diagnostics).toEqual([]);
    expect(changelog).toBeDefined();
    expect(changelog?.entries[0]?.items[0]?.operation).toEqual({
      identity: "svc~waitForMessage",
      method: "POST",
      path: "/inboxes/{id}/messages/wait",
      route: "/api/inboxes/wait-for-message",
    });
    // A removed operation keeps its method and path but no route in this release.
    expect(changelog?.entries[0]?.items[1]?.operation).toEqual({
      identity: "svc~getRawMessage",
      method: "GET",
      path: "/inboxes/{id}/raw",
    });
    expect(changelog?.reviewed).toEqual({
      included: [
        "v1..v2:operation-added:svc~waitForMessage",
        "v1..v2:operation-removed:svc~getRawMessage",
      ],
      omitted: ["v1..v2:schema-changed:svc~Inbox"],
    });
    const text = serializeChangelog(changelog!);
    expect(parseChangelog(text)).toEqual(changelog);
    expect(text).not.toMatch(/We've|streamlined/);
  });

  it("blocks publication when a candidate is neither described nor omitted", () => {
    const parsed = parseChangelogSource(
      source.replace('"omitted":["v1..v2:schema-changed:svc~Inbox"],', ""),
    );
    const { changelog, diagnostics } = validateChangelog(parsed, {
      candidateIds,
      operations,
      previousOperations: previous,
      version: "v2",
    });
    expect(changelog).toBeUndefined();
    expect(diagnostics).toEqual([
      {
        code: "CHANGELOG_CANDIDATE_UNREVIEWED",
        path: "/candidates/v1..v2:schema-changed:svc~Inbox",
      },
    ]);
    expect(CHANGELOG_MESSAGES.CHANGELOG_CANDIDATE_UNREVIEWED).toMatch(
      /omitted/,
    );
  });

  it('accepts "all" as an explicit blanket omission and records what it covered', () => {
    const parsed = parseChangelogSource(
      JSON.stringify({
        entries: [{ items: [{ kind: "fixed", text: "Typos." }] }],
        omitted: "all",
        title: "Notes",
      }),
    );
    const { changelog } = validateChangelog(parsed, {
      candidateIds,
      operations,
      version: "v2",
    });
    expect(changelog?.reviewed.omitted).toEqual([...candidateIds].sort());
  });

  it("reports unknown candidates and operations by pointer", () => {
    const parsed = parseChangelogSource(
      JSON.stringify({
        entries: [
          {
            items: [
              {
                candidates: ["v1..v2:operation-added:svc~nope"],
                kind: "added",
                operation: "svc~missing",
                text: "x",
              },
            ],
          },
        ],
        omitted: ["v1..v2:nope:svc~x"],
        title: "Notes",
      }),
    );
    const { diagnostics } = validateChangelog(parsed, {
      candidateIds,
      operations,
      version: "v2",
    });
    expect(
      diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.path}`),
    ).toEqual([
      "CHANGELOG_OPERATION_NOT_FOUND@/entries/0/items/0/operation",
      "CHANGELOG_CANDIDATE_UNKNOWN@/entries/0/items/0/candidates/0",
      "CHANGELOG_CANDIDATE_UNKNOWN@/omitted/0",
      "CHANGELOG_CANDIDATE_UNREVIEWED@/candidates/v1..v2:operation-added:svc~waitForMessage",
      "CHANGELOG_CANDIDATE_UNREVIEWED@/candidates/v1..v2:operation-removed:svc~getRawMessage",
      "CHANGELOG_CANDIDATE_UNREVIEWED@/candidates/v1..v2:schema-changed:svc~Inbox",
    ]);
  });

  it("rejects shapes outside the contract: scripts, unknown kinds, bad dates, oversize", () => {
    const reject = (value: unknown, pattern: RegExp) => {
      expect(() => parseChangelogSource(JSON.stringify(value))).toThrow(
        pattern,
      );
    };
    reject({ title: "x", entries: [], script: "<script>" }, /not recognized/);
    reject({ title: "", entries: [] }, /text/);
    reject(
      { title: "x", entries: [{ items: [{ kind: "breaking", text: "x" }] }] },
      /kind/,
    );
    reject(
      {
        title: "x",
        entries: [{ date: "5 Sept", items: [{ kind: "added", text: "x" }] }],
      },
      /YYYY-MM-DD/,
    );
    reject({ title: "x", entries: [{ items: [] }] }, /non-empty/);
    reject(
      {
        title: "x",
        entries: [{ items: [{ kind: "added", text: "x\u0000" }] }],
      },
      /control/,
    );
    reject(
      {
        title: "x",
        entries: [
          { items: [{ kind: "added", text: "x", candidates: ["not an id"] }] },
        ],
      },
      /candidate id/,
    );
    reject({ title: "x", entries: [], from: "../v1" }, /version id/);
    reject({ title: "x", entries: [], omitted: "some" }, /omitted/);
    expect(() => parseChangelogSource("x".repeat(600_000))).toThrow(
      ReleaseContractError,
    );
    // Text is data: markup stays text.
    const parsed = parseChangelogSource(
      JSON.stringify({
        title: "<b>x</b>",
        entries: [
          { items: [{ kind: "added", text: "<script>alert(1)</script>" }] },
        ],
      }),
    );
    expect(parsed.entries[0]?.items[0]?.text).toBe("<script>alert(1)</script>");
  });

  it("rejects a published document that names a route outside the reference", () => {
    const parsed = parseChangelogSource(source);
    const { changelog } = validateChangelog(parsed, {
      candidateIds,
      operations,
      previousOperations: previous,
      version: "v2",
    });
    const value = JSON.parse(serializeChangelog(changelog!)) as {
      entries: { items: { operation?: { route?: string } }[] }[];
    };
    value.entries[0]!.items[0]!.operation!.route = "https://evil.example";
    expect(() => parseChangelog(JSON.stringify(value))).toThrow(
      /operation is invalid/,
    );
  });
});
