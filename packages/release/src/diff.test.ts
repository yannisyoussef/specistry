import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseDocumentationArtifact,
  serializeDocumentationArtifact,
  type DocumentationArtifact,
  type Operation,
} from "@specra/model";
import { describe, expect, it } from "vitest";

import { diffArtifacts, serializeContractDiff } from "./diff.js";

/**
 * SPEC-010 §76–§85, §160: structured candidates are deterministic, identity
 * based, conservative (removed + added, never renamed), value-free, bounded,
 * and carry no breaking-change label. The golden is committed.
 */

const fixture = fileURLToPath(
  new URL(
    "../../../tests/fixtures/reader/testinbox/.specra/artifacts/documentation.json",
    import.meta.url,
  ),
);
const goldenPath = fileURLToPath(
  new URL("../goldens/testinbox-mutations.json", import.meta.url),
);
const base = parseDocumentationArtifact(readFileSync(fixture, "utf8"));

/** Deep-clones the artifact and applies a mutation to the first service. */
function mutate(
  edit: (service: {
    operations: Operation[];
    schemas: Record<string, unknown>;
    tags?: { name: string; description?: string }[];
  }) => void,
): DocumentationArtifact {
  const clone = JSON.parse(serializeDocumentationArtifact(base)) as unknown as {
    model: {
      versions: {
        services: {
          operations: Operation[];
          schemas: Record<string, unknown>;
          tags?: { name: string }[];
        }[];
      }[];
    };
  };
  edit(clone.model.versions[0]!.services[0]!);
  return parseDocumentationArtifact(JSON.stringify(clone));
}

const next = mutate((service) => {
  // Remove one operation, add one, change several aspects of another,
  // deprecate one, change a schema, and remove a tag entirely.
  service.operations = service.operations.filter(
    (operation) => operation.contractId !== "deleteMessage",
  );
  const template = service.operations.find(
    (operation) => operation.contractId === "getInbox",
  )!;
  service.operations.push({
    ...template,
    contractId: "archiveInbox",
    id: "archiveInbox" as Operation["id"],
    method: "POST",
    path: "/inboxes/{inboxId}/archive",
    title: "Archive an inbox",
  });
  const changed = service.operations.find(
    (operation) => operation.contractId === "listInboxes",
  )! as unknown as {
    parameters: unknown[];
    title: string;
    deprecated: boolean;
    security: unknown[];
    responses: { status: unknown }[];
  };
  changed.title = "List all inboxes";
  changed.deprecated = true;
  changed.parameters = changed.parameters.filter(
    (parameter) => (parameter as { name: string }).name !== "cursor",
  );
  changed.responses = changed.responses.filter(
    (response) =>
      JSON.stringify(response.status) !==
      JSON.stringify({ code: 401, kind: "code" }),
  );
  const moved = service.operations.find(
    (operation) => operation.contractId === "createInbox",
  )! as { path: string };
  moved.path = "/inboxes/create";
  const [schemaId] = Object.keys(service.schemas).sort();
  const schema = service.schemas[schemaId!] as { description?: string };
  schema.description = "Changed in v2.";
});

describe("structured contract diff", () => {
  it("produces the committed golden byte for byte", () => {
    const diff = diffArtifacts(
      { artifact: base, version: "v1" },
      { artifact: next, version: "v2" },
    );
    const text = serializeContractDiff(diff);
    if (process.env.UPDATE_RELEASE_GOLDENS === "1" || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, text);
    }
    expect(text).toBe(readFileSync(goldenPath, "utf8"));
    expect(
      serializeContractDiff(
        diffArtifacts(
          { artifact: base, version: "v1" },
          { artifact: next, version: "v2" },
        ),
      ),
    ).toBe(text);
  });

  it("reports removed plus added rather than a rename, and describes changes by aspect", () => {
    const diff = diffArtifacts(
      { artifact: base, version: "v1" },
      { artifact: next, version: "v2" },
    );
    const kinds = Object.fromEntries(
      diff.candidates.map((candidate) => [candidate.id, candidate]),
    );
    expect(
      kinds["v1..v2:operation-removed:openapi.yaml~deleteMessage"],
    ).toMatchObject({
      label: "DELETE /inboxes/{inboxId}/messages/{messageId}",
      service: "openapi.yaml",
    });
    expect(
      kinds["v1..v2:operation-added:openapi.yaml~archiveInbox"],
    ).toMatchObject({ label: "POST /inboxes/{inboxId}/archive" });
    expect(
      diff.candidates.some((candidate) => candidate.kind.includes("renamed")),
    ).toBe(false);
    const changed = kinds["v1..v2:operation-changed:openapi.yaml~listInboxes"]!;
    expect(
      changed.changes?.map(
        (change) =>
          `${change.aspect}${change.detail === undefined ? "" : `:${change.detail}`}`,
      ),
    ).toEqual([
      "title",
      "deprecated:deprecated",
      "parameter-removed:query:cursor",
      "response-removed:401",
    ]);
    expect(
      kinds["v1..v2:operation-changed:openapi.yaml~createInbox"]?.changes,
    ).toEqual([{ aspect: "path", detail: "/inboxes -> /inboxes/create" }]);
    expect(
      diff.candidates.filter(
        (candidate) => candidate.kind === "schema-changed",
      ),
    ).toHaveLength(1);
    expect(diff.counts["operation-changed"]).toBeGreaterThanOrEqual(3);
    expect(diff.truncated).toBe(false);
    const text = serializeContractDiff(diff);
    expect(text).not.toMatch(/breaking|score|percent/i);
    expect(text).not.toMatch(/"value"|sk_live|@sandbox\.testinbox\.email/);
  });

  it("carries route candidates from the route maps without publishing them", () => {
    const routes = new Map([
      ["openapi.yaml~createInbox", "/api/inboxes/create-inbox"],
      ["openapi.yaml~deleteMessage", "/api/messages/delete-message"],
    ]);
    const nextRoutes = new Map([
      ["openapi.yaml~createInbox", "/api/inboxes/create-inbox"],
      ["openapi.yaml~archiveInbox", "/api/inboxes/archive-inbox"],
    ]);
    const diff = diffArtifacts(
      { artifact: base, routes, version: "v1" },
      { artifact: next, routes: nextRoutes, version: "v2" },
    );
    const removed = diff.candidates.find((candidate) =>
      candidate.id.endsWith("deleteMessage"),
    );
    expect(removed?.route).toEqual({ from: "/api/messages/delete-message" });
    const added = diff.candidates.find((candidate) =>
      candidate.id.endsWith("archiveInbox"),
    );
    expect(added?.route).toEqual({ to: "/api/inboxes/archive-inbox" });
  });

  it("is empty for identical releases and bounded for enormous ones", () => {
    const same = diffArtifacts(
      { artifact: base, version: "v1" },
      { artifact: base, version: "v1" },
    );
    expect(same.candidates).toEqual([]);
    const many = mutate((service) => {
      const template = service.operations[0]!;
      for (let index = 0; index < 40; index += 1) {
        service.operations.push({
          ...template,
          contractId: `bulk${index}`,
          id: `bulk${index}` as Operation["id"],
          path: `/bulk/${index}`,
        });
      }
    });
    const bounded = diffArtifacts(
      { artifact: base, version: "v1" },
      { artifact: many, version: "v2" },
      { maxCandidates: 25 },
    );
    expect(bounded.truncated).toBe(true);
    expect(bounded.candidates).toHaveLength(25);
    expect(
      diffArtifacts(
        { artifact: base, version: "v1" },
        { artifact: many, version: "v2" },
      ).truncated,
    ).toBe(false);
  });
});
