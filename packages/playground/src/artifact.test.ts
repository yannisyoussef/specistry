import { describe, expect, it } from "vitest";

import {
  isLoopbackOrigin,
  originOf,
  parsePlaygroundArtifact,
  parsePlaygroundArtifactValue,
  PlaygroundArtifactError,
  serializePlaygroundArtifact,
} from "./artifact.js";
import {
  PLAYGROUND_HARD_LIMITS,
  type OperationForm,
  type PlaygroundArtifact,
} from "./types.js";

/**
 * SPEC-009 §19, §52, §136: the reader trusts only what this parser admits.
 * A tampered artifact cannot widen an origin, raise a limit, or mark a
 * browser-incapable scheme executable.
 */

const operation: OperationForm = {
  auth: [
    {
      label: "Bearer token",
      schemes: [
        { kind: "bearer", label: "Bearer token", scopes: [], supported: true },
      ],
      supported: true,
    },
  ],
  bodies: [
    { fields: [], initial: "{}", kind: "json", mediaType: "application/json" },
  ],
  bodyRequired: true,
  capability: { reasons: [], state: "executable" },
  method: "POST",
  parameters: [
    {
      array: false,
      capability: "supported",
      contentTyped: false,
      deprecated: false,
      initial: "inb_1",
      kind: "string",
      label: "inboxId",
      location: "path",
      name: "inboxId",
      required: true,
      serialization: { explode: false, style: "simple" },
    },
  ],
  pathTemplate: "/inboxes/{inboxId}",
  responseKind: "json",
};

const artifact: PlaygroundArtifact = {
  enabled: true,
  environments: [
    {
      baseUrl: "https://api.example.com/v1",
      id: "production",
      label: "Production",
      loopback: false,
      origin: "https://api.example.com",
    },
    {
      baseUrl: "http://127.0.0.1:47391/v1",
      id: "local",
      label: "Local",
      loopback: true,
      origin: "http://127.0.0.1:47391",
    },
  ],
  limits: {
    ...PLAYGROUND_HARD_LIMITS,
    responseBytes: 1_048_576,
    timeoutMs: 30_000,
  },
  operations: { "svc~op": operation },
  playgroundVersion: 1,
};

function mutate(edit: (value: Record<string, unknown>) => void): unknown {
  const value = JSON.parse(serializePlaygroundArtifact(artifact)) as Record<
    string,
    unknown
  >;
  edit(value);
  return value;
}

function expectRejected(value: unknown, pathPrefix: string): void {
  let error: unknown;
  try {
    parsePlaygroundArtifactValue(value);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(PlaygroundArtifactError);
  expect(
    (error as PlaygroundArtifactError).path.startsWith(pathPrefix),
    `${(error as PlaygroundArtifactError).path} should start with ${pathPrefix}`,
  ).toBe(true);
}

describe("playground artifact", () => {
  it("round-trips through a sorted, newline-terminated document", () => {
    const text = serializePlaygroundArtifact(artifact);
    expect(text.endsWith("\n")).toBe(true);
    expect(parsePlaygroundArtifact(text)).toEqual(artifact);
    expect(serializePlaygroundArtifact(parsePlaygroundArtifact(text))).toBe(
      text,
    );
  });

  it("rejects malformed JSON and unknown top-level keys", () => {
    expect(() => parsePlaygroundArtifact("{")).toThrow(PlaygroundArtifactError);
    expectRejected(
      mutate((value) => {
        value.proxy = "https://relay.example";
      }),
      "/",
    );
    expectRejected(
      mutate((value) => {
        value.playgroundVersion = 2;
      }),
      "/playgroundVersion",
    );
    expectRejected(
      mutate((value) => {
        value.enabled = "yes";
      }),
      "/enabled",
    );
  });

  it.each([
    ["wildcard origin", "https://*.example.com", "https://*.example.com/v1"],
    [
      "origin with path",
      "https://api.example.com/v1",
      "https://api.example.com/v1",
    ],
    [
      "origin different from base URL",
      "https://evil.example",
      "https://api.example.com/v1",
    ],
    [
      "userinfo in base URL",
      "https://api.example.com",
      "https://user:pw@api.example.com/v1",
    ],
    [
      "plain HTTP off loopback",
      "http://api.example.com",
      "http://api.example.com/v1",
    ],
    [
      "query in base URL",
      "https://api.example.com",
      "https://api.example.com/v1?x=1",
    ],
    [
      "trailing slash",
      "https://api.example.com",
      "https://api.example.com/v1/",
    ],
    [
      "fragment in base URL",
      "https://api.example.com",
      "https://api.example.com/v1#x",
    ],
  ])("rejects an environment with %s", (_label, origin, baseUrl) => {
    const environments = [
      { baseUrl, id: "e", label: "E", loopback: false, origin },
    ];
    expectRejected(
      mutate((value) => {
        value.environments = environments;
      }),
      "/environments/0",
    );
  });

  it("rejects a lying loopback flag, duplicate ids, and too many environments", () => {
    expectRejected(
      mutate((value) => {
        (value.environments as Record<string, unknown>[])[1]!.loopback = false;
      }),
      "/environments/1/loopback",
    );
    expectRejected(
      mutate((value) => {
        (value.environments as Record<string, unknown>[])[1]!.id = "production";
      }),
      "/environments",
    );
    expectRejected(
      mutate((value) => {
        value.environments = Array.from({ length: 17 }, (_, index) => ({
          baseUrl: `https://api${index}.example.com`,
          id: `e${index}`,
          label: "E",
          loopback: false,
          origin: `https://api${index}.example.com`,
        }));
      }),
      "/environments",
    );
  });

  it("rejects limits above the hard bound, below one, missing, or extra", () => {
    expectRejected(
      mutate((value) => {
        (value.limits as Record<string, unknown>).responseBytes =
          PLAYGROUND_HARD_LIMITS.responseBytes + 1;
      }),
      "/limits/responseBytes",
    );
    expectRejected(
      mutate((value) => {
        (value.limits as Record<string, unknown>).timeoutMs = 0;
      }),
      "/limits/timeoutMs",
    );
    expectRejected(
      mutate((value) => {
        (value.limits as Record<string, unknown>).urlLength = 1.5;
      }),
      "/limits/urlLength",
    );
    expectRejected(
      mutate((value) => {
        delete (value.limits as Record<string, unknown>).headerCount;
      }),
      "/limits",
    );
    expectRejected(
      mutate((value) => {
        (value.limits as Record<string, unknown>).retries = 3;
      }),
      "/limits",
    );
  });

  it("rejects operations that claim more than the browser can do", () => {
    const op = () =>
      JSON.parse(JSON.stringify(operation)) as Record<string, unknown> & {
        auth: Record<string, unknown>[];
        parameters: Record<string, unknown>[];
        capability: Record<string, unknown>;
      };
    const withOperation = (edit: (value: ReturnType<typeof op>) => void) =>
      mutate((value) => {
        const copy = op();
        edit(copy);
        value.operations = { "svc~op": copy };
      });
    expectRejected(
      withOperation((value) => {
        value.auth[0]!.schemes = [
          {
            kind: "apiKeyQuery",
            label: "q",
            name: "k",
            scopes: [],
            supported: true,
          },
        ];
      }),
      "/operations/svc~op/auth/0/schemes/0/supported",
    );
    expectRejected(
      withOperation((value) => {
        value.auth[0]!.schemes = [
          { kind: "mutualTls", label: "m", scopes: [], supported: true },
        ];
      }),
      "/operations/svc~op/auth/0/schemes/0/supported",
    );
    expectRejected(
      withOperation((value) => {
        value.auth[0]!.schemes = [
          {
            kind: "apiKeyCookie",
            label: "c",
            name: "s",
            scopes: [],
            supported: true,
          },
        ];
      }),
      "/operations/svc~op/auth/0/schemes/0/supported",
    );
    expectRejected(
      withOperation((value) => {
        value.auth[0]!.supported = false;
      }),
      "/operations/svc~op/auth/0/supported",
    );
    expectRejected(
      withOperation((value) => {
        value.auth[0]!.schemes = [
          { kind: "digest", label: "d", scopes: [], supported: false },
        ];
      }),
      "/operations/svc~op/auth/0/schemes/0/kind",
    );
    expectRejected(
      withOperation((value) => {
        value.method = "CONNECT";
      }),
      "/operations/svc~op/method",
    );
    expectRejected(
      withOperation((value) => {
        value.pathTemplate = "/inboxes\r\nx";
      }),
      "/operations/svc~op/pathTemplate",
    );
    expectRejected(
      withOperation((value) => {
        value.pathTemplate = "/inboxes\u0000";
      }),
      "/operations/svc~op/pathTemplate",
    );
    expectRejected(
      withOperation((value) => {
        value.parameters[0]!.location = "body";
      }),
      "/operations/svc~op/parameters/0/location",
    );
    expectRejected(
      withOperation((value) => {
        value.parameters[0]!.kind = "script";
      }),
      "/operations/svc~op/parameters/0/kind",
    );
    expectRejected(
      withOperation((value) => {
        value.parameters[0]!.capability = "maybe";
      }),
      "/operations/svc~op/parameters/0/capability",
    );
    expectRejected(
      withOperation((value) => {
        value.parameters[0]!.name = "a\r\nb";
      }),
      "/operations/svc~op/parameters/0/name",
    );
    expectRejected(
      withOperation((value) => {
        value.parameters[0]!.serialization = { style: "form", url: "x" };
      }),
      "/operations/svc~op/parameters/0/serialization",
    );
    expectRejected(
      withOperation((value) => {
        value.capability.state = "maybe";
      }),
      "/operations/svc~op/capability/state",
    );
    expectRejected(
      withOperation((value) => {
        value.capability.reasons = ["because"];
      }),
      "/operations/svc~op/capability/reasons/0",
    );
    expectRejected(
      withOperation((value) => {
        value.responseKind = "html";
      }),
      "/operations/svc~op/responseKind",
    );
    expectRejected(
      withOperation((value) => {
        value.forwardTo = "https://relay.example";
      }),
      "/operations/svc~op",
    );
    expectRejected(
      withOperation((value) => {
        (value.bodies as Record<string, unknown>[])[0]!.kind = "stream";
      }),
      "/operations/svc~op/bodies/0/kind",
    );
    expectRejected(
      withOperation((value) => {
        (value.bodies as Record<string, unknown>[])[0]!.fields = [
          { file: "yes", initial: "", name: "f", required: false },
        ];
      }),
      "/operations/svc~op/bodies/0/fields/0",
    );
  });

  it("rejects invalid operation keys, oversized text, and non-plain objects", () => {
    expectRejected(
      mutate((value) => {
        value.operations = { "../x": operation };
      }),
      "/operations",
    );
    expectRejected(
      mutate((value) => {
        value.operations = {
          "svc~op": { ...operation, pathTemplate: "/".repeat(3_000) },
        };
      }),
      "/operations/svc~op/pathTemplate",
    );
    expectRejected(
      mutate((value) => {
        value.operations = [];
      }),
      "/operations",
    );
    expect(() => parsePlaygroundArtifactValue(Object.create(null))).toThrow(
      PlaygroundArtifactError,
    );
    expect(() => parsePlaygroundArtifactValue(null)).toThrow(
      PlaygroundArtifactError,
    );
  });

  it("derives exact origins only from allowed base URLs", () => {
    expect(originOf("https://api.example.com/v1/")).toBe(
      "https://api.example.com",
    );
    expect(originOf("https://api.example.com:8443")).toBe(
      "https://api.example.com:8443",
    );
    expect(originOf("http://localhost:3000/api")).toBe("http://localhost:3000");
    expect(originOf("http://api.example.com")).toBeUndefined();
    expect(originOf("https://user:pw@api.example.com")).toBeUndefined();
    expect(originOf("https://*.example.com")).toBeUndefined();
    expect(originOf("/relative")).toBeUndefined();
    expect(originOf("ftp://files.example.com")).toBeUndefined();
  });

  it("recognizes loopback origins", () => {
    expect(isLoopbackOrigin("http://127.0.0.1:47391")).toBe(true);
    expect(isLoopbackOrigin("http://localhost")).toBe(true);
    expect(isLoopbackOrigin("http://[::1]:8080")).toBe(true);
    expect(isLoopbackOrigin("https://api.example.com")).toBe(false);
    expect(isLoopbackOrigin("not an origin")).toBe(false);
  });
});
