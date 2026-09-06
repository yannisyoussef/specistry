import { describe, expect, it } from "vitest";

import {
  parseSnippetsArtifact,
  parseSnippetsArtifactValue,
  serializeSnippetsArtifact,
  SnippetsArtifactError,
} from "./artifact.js";
import { OPERATIONS, SERVICE } from "./fixtures.test-helper.js";
import { projectOperation } from "./projection.js";
import { SNIPPETS_FORMAT_VERSION, type SnippetsArtifact } from "./types.js";

function artifact(): SnippetsArtifact {
  const operations: Record<
    string,
    ReturnType<typeof projectOperation>["projection"]
  > = {};
  for (const operation of OPERATIONS) {
    operations[`service~${operation.id}`] = projectOperation(
      SERVICE,
      operation,
    ).projection;
  }
  return {
    environments: [
      {
        baseUrl: "https://api.example.com/v1",
        id: "production",
        label: "Production",
      },
    ],
    operations,
    sdkExamples: {
      "service~postJson": [
        {
          code: "const inbox = await client.inboxes.create({ ttl: 3600 });",
          lines: [
            [
              { cls: "kw", text: "const" },
              { text: " inbox = await client.inboxes.create({ ttl: 3600 });" },
            ],
          ],
          sdk: "typescript",
          title: "Create an inbox",
        },
      ],
    },
    sdks: [
      {
        coverage: "partial",
        id: "typescript",
        label: "TypeScript SDK",
        language: "typescript",
        package: "@example/sdk",
      },
    ],
    snippetsVersion: SNIPPETS_FORMAT_VERSION,
  };
}

describe("snippets artifact", () => {
  it("round-trips deterministically with sorted keys", () => {
    const original = artifact();
    const text = serializeSnippetsArtifact(original);
    expect(text.endsWith("\n")).toBe(true);
    expect(serializeSnippetsArtifact(original)).toBe(text);
    const parsed = parseSnippetsArtifact(text);
    expect(parsed).toEqual(original);
    expect(serializeSnippetsArtifact(parsed)).toBe(text);
    // Key order in the input never changes the bytes.
    const shuffled = JSON.parse(JSON.stringify(original)) as SnippetsArtifact;
    expect(serializeSnippetsArtifact({ ...shuffled, snippetsVersion: 1 })).toBe(
      text,
    );
  });

  it("rejects malformed and tampered artifacts", () => {
    const base = JSON.parse(serializeSnippetsArtifact(artifact())) as Record<
      string,
      unknown
    >;
    const tampered = (
      mutate: (value: Record<string, unknown>) => void,
    ): string => {
      const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
      mutate(copy);
      return JSON.stringify(copy);
    };
    const cases: readonly [string, string][] = [
      ["not json", "{"],
      ["unknown key", tampered((value) => (value.extra = 1))],
      ["wrong version", tampered((value) => (value.snippetsVersion = 2))],
      [
        "insecure environment",
        tampered(
          (value) =>
            ((value.environments as Record<string, unknown>[])[0]!.baseUrl =
              "http://evil.example"),
        ),
      ],
      [
        "credentials in environment",
        tampered(
          (value) =>
            ((value.environments as Record<string, unknown>[])[0]!.baseUrl =
              "https://a:b@evil.example"),
        ),
      ],
      [
        "bad method",
        tampered(
          (value) =>
            ((value.operations as Record<string, Record<string, unknown>>)[
              "service~postJson"
            ]!.method = "HACK"),
        ),
      ],
      [
        "path with query",
        tampered(
          (value) =>
            ((value.operations as Record<string, Record<string, unknown>>)[
              "service~postJson"
            ]!.path = "/x?y"),
        ),
      ],
      [
        "header line break",
        tampered(
          (value) =>
            ((value.operations as Record<string, Record<string, unknown>>)[
              "service~postJson"
            ]!.headers = [{ name: "X", value: "a\r\nb" }]),
        ),
      ],
      [
        "unknown body kind",
        tampered(
          (value) =>
            ((
              value.operations as Record<
                string,
                Record<string, Record<string, unknown>[]>
              >
            )["service~postJson"]!.bodies![0]!.kind = "exec"),
        ),
      ],
      [
        "unknown auth kind",
        tampered(
          (value) =>
            ((
              value.operations as Record<
                string,
                Record<string, Record<string, Record<string, unknown>[]>[]>
              >
            )["service~postJson"]!.auth![0]!.schemes![0]!.kind = "magic"),
        ),
      ],
      [
        "sdk example for unknown operation",
        tampered(
          (value) => ((value.sdkExamples as Record<string, unknown>).nope = []),
        ),
      ],
      [
        "sdk example for undeclared sdk",
        tampered(
          (value) =>
            ((value.sdkExamples as Record<string, Record<string, unknown>[]>)[
              "service~postJson"
            ]![0]!.sdk = "java"),
        ),
      ],
      [
        "sdk tokens disagree with code",
        tampered(
          (value) =>
            ((value.sdkExamples as Record<string, Record<string, unknown>[]>)[
              "service~postJson"
            ]![0]!.code = "x"),
        ),
      ],
      [
        "bad token class",
        tampered(
          (value) =>
            ((
              value.sdkExamples as Record<
                string,
                Record<string, Record<string, unknown>[][]>[]
              >
            )["service~postJson"]![0]!.lines![0]![0]!.cls = "html"),
        ),
      ],
      [
        "duplicate sdk",
        tampered((value) =>
          (value.sdks as unknown[]).push((value.sdks as unknown[])[0]),
        ),
      ],
      [
        "prototype key",
        '{"__proto__":{},"snippetsVersion":1,"environments":[],"operations":{},"sdks":[],"sdkExamples":{}}',
      ],
    ];
    for (const [label, text] of cases) {
      expect(() => parseSnippetsArtifact(text), label).toThrow(
        SnippetsArtifactError,
      );
    }
    expect(() => parseSnippetsArtifactValue(Object.create(null))).toThrow(
      SnippetsArtifactError,
    );
    expect(() => parseSnippetsArtifact("x".repeat(129 * 1024 * 1024))).toThrow(
      /size/,
    );
  });

  it("accepts the base URL placeholder as an environment", () => {
    const text = serializeSnippetsArtifact({
      ...artifact(),
      environments: [
        { baseUrl: "<BASE_URL>", id: "base-url", label: "Base URL" },
      ],
    });
    expect(parseSnippetsArtifact(text).environments[0]?.baseUrl).toBe(
      "<BASE_URL>",
    );
  });
});
