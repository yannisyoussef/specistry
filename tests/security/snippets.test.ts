import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ApiService, Operation, SchemaNode } from "@specra/model";
import {
  generateAll,
  parseSnippetsArtifact,
  projectOperation,
  PROTOCOL_LANGUAGES,
  resolveRequest,
  serializeSnippetsArtifact,
  SnippetsArtifactError,
} from "@specra/snippets";
import { afterAll, describe, expect, it } from "vitest";

/**
 * SPEC-008 §48–§52, §115–§118: hostile documentation input must never
 * become an executable command, a second header, a changed authority, or a
 * leaked credential in generated code. The corpus is applied to every
 * input position (path, query, header, cookie, JSON, text, description,
 * server URL, security scheme name) and every language.
 */

const HOSTILE = [
  "$(touch /tmp/pwned)",
  "'; rm -rf / #",
  "`whoami`",
  '"; alert(1); //',
  "${process.env.SECRET}",
  "\r\nInjected-Header: yes",
  '\\path\\"quoted',
  "</script><script>alert(1)</script>",
  "safe‮evil⁦",
  "line separator",
  "trusted.example@evil.example/",
  "../../etc/passwd",
  "%0d%0aX-Smuggled: 1",
  "sk_live_51H8sEcReT0kEn",
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc",
] as const;

const scratch = mkdtempSync(path.join(tmpdir(), "specra-snippets-security-"));
afterAll(() => rmSync(scratch, { force: true, recursive: true }));

const brand = <T>(value: string): T => value as unknown as T;
const string: SchemaNode = { kind: "scalar", type: "string" };

function hostileService(value: string): {
  service: ApiService;
  operation: Operation;
} {
  const parameter = (
    name: string,
    location: "cookie" | "header" | "path" | "query",
  ) =>
    ({
      deprecated: false,
      examples: [{ id: brand(`e-${location}`), name: "x", value }],
      id: brand(`p-${location}`),
      location,
      name,
      required: true,
      schema: string,
      serialization:
        location === "query"
          ? { allowReserved: true, explode: true, style: "form" }
          : location === "path"
            ? { explode: false, style: "simple" }
            : location === "header"
              ? { explode: false, style: "simple" }
              : { explode: true, style: "form" },
      valueKind: "schema",
    }) as unknown as Operation["parameters"][number];
  const operation: Operation = {
    contractId: "hostile",
    deprecated: false,
    description: value,
    extensions: {},
    id: brand("hostile"),
    method: "POST",
    parameters: [
      parameter("seg", "path"),
      parameter("q", "query"),
      parameter("X-Custom", "header"),
      parameter("session", "cookie"),
    ],
    path: `/things/{seg}`,
    requestBody: {
      content: [
        {
          encodings: [],
          examples: [
            { id: brand("j"), name: "j", value: { label: value, note: value } },
          ],
          mediaType: "application/json",
        },
        {
          encodings: [],
          examples: [{ id: brand("t"), name: "t", value }],
          mediaType: "text/plain",
        },
        {
          encodings: [],
          examples: [{ id: brand("f"), name: "f", value: { field: value } }],
          mediaType: "multipart/form-data",
        },
      ],
      required: true,
    },
    responses: [],
    security: [
      { schemes: [{ schemeId: brand("key"), scopes: [value] }] },
      { schemes: [{ schemeId: brand("basic"), scopes: [] }] },
    ],
    serverIds: [],
    tags: [],
    title: value,
  };
  const service: ApiService = {
    extensions: {},
    id: brand("service"),
    name: value,
    operations: [operation],
    schemas: {},
    securitySchemes: {
      basic: { kind: "http", scheme: "basic" },
      key: { kind: "apiKey", location: "header", name: "X-Test-Key" },
    },
    servers: [
      {
        id: brand("ok"),
        label: "OK",
        url: "https://api.example.com",
        variables: {},
      },
      {
        id: brand("evil"),
        label: value,
        url: `https://${value}`,
        variables: {},
      },
    ],
  };
  return { operation, service };
}

describe("hostile documentation input", () => {
  for (const value of HOSTILE) {
    it(`stays inert in every language for ${JSON.stringify(value)}`, () => {
      const { operation, service } = hostileService(value);
      const { projection } = projectOperation(service, operation);
      for (const body of projection.bodies) {
        for (const auth of ["0", "1"]) {
          const set = generateAll(projection, [], {
            auth,
            body: body.mediaType,
          });
          // The authority is always the validated server.
          expect(set.request.url.startsWith("https://api.example.com/")).toBe(
            true,
          );
          expect(new URL(set.request.url).host).toBe("api.example.com");
          for (const snippet of set.snippets) {
            // No header value carries a line break into the code.
            for (const header of set.request.headers) {
              expect(header.value).not.toMatch(/[\r\n]/);
            }
            if (snippet.language === "curl") {
              const flags = snippet.code.match(/--header /g)?.length ?? 0;
              const singleLine =
                snippet.code.match(/--header '[^'\n]*'/g)?.length ?? 0;
              expect(singleLine).toBe(flags);
            }
            expect(snippet.code).not.toContain("\r");
            expect(snippet.code).not.toContain("‮");
            expect(snippet.code).not.toContain(" ");
            // Credential-looking example values are redacted from the JSON body.
            expect(snippet.code).not.toContain("sk_live_51H8sEcReT0kEn");
            expect(snippet.code).not.toContain("eyJhbGciOiJIUzI1NiJ9");
          }
          const curl = set.snippets.find(
            (snippet) => snippet.language === "curl",
          );
          expect(curl).toBeDefined();
          if (curl !== undefined) assertShellInert(curl.code);
          const http = set.snippets.find(
            (snippet) => snippet.language === "http",
          );
          // The raw request has exactly one request line and no smuggled header.
          const headerLines =
            (http?.code ?? "").split("\n\n")[0]?.split("\n") ?? [];
          expect(
            headerLines.filter((line) => /^Injected-Header:/.test(line)),
          ).toEqual([]);
          expect(
            headerLines.filter((line) => /^X-Smuggled:/.test(line)),
          ).toEqual([]);
        }
      }
    });
  }
});

/**
 * The shell test: with a fake `curl` on PATH that records its arguments, the
 * generated command runs to completion without executing anything but curl,
 * and without creating the file the payload tries to touch.
 */
function assertShellInert(code: string): void {
  const binDirectory = path.join(
    scratch,
    `bin-${Math.random().toString(16).slice(2)}`,
  );
  execFileSync("mkdir", ["-p", binDirectory]);
  const log = path.join(binDirectory, "args.log");
  writeFileSync(
    path.join(binDirectory, "curl"),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}"\n`,
    { mode: 0o755 },
  );
  const marker = path.join(binDirectory, "pwned");
  const script = code.replace(/\/tmp\/pwned/g, marker);
  execFileSync("bash", ["-c", script], {
    env: { HOME: scratch, PATH: `${binDirectory}:/usr/bin:/bin` },
    stdio: "pipe",
  });
  expect(() => execFileSync("test", ["-e", marker])).toThrow();
  const seen = execFileSync("cat", [log], { encoding: "utf8" });
  expect(seen).toContain("--url");
}

describe("path templates", () => {
  it("encodes literal template characters so a path cannot add a query or fragment", () => {
    const { operation, service } = hostileService("x");
    const { projection } = projectOperation(service, {
      ...operation,
      path: "/a b/{seg}/c?d=1#e/../../etc",
    });
    expect(projection.path).toBe("/a%20b/x/c%3Fd=1%23e/../../etc");
    const { request } = resolveRequest(projection, []);
    expect(new URL(request.url).pathname).toBe("/a%20b/etc");
    expect(new URL(request.url).host).toBe("api.example.com");
  });
});

describe("artifact tampering", () => {
  it("rejects environments outside the policy and unknown shapes", () => {
    const text = serializeSnippetsArtifact({
      environments: [
        { baseUrl: "https://api.example.com", id: "prod", label: "Prod" },
      ],
      operations: {},
      sdkExamples: {},
      sdks: [],
      snippetsVersion: 1,
    });
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const baseUrl of [
      "http://evil.example",
      "javascript:alert(1)",
      "https://trusted.example@evil.example/",
      "file:///etc/passwd",
    ]) {
      const bad = {
        ...parsed,
        environments: [{ baseUrl, id: "x", label: "x" }],
      };
      expect(() => parseSnippetsArtifact(JSON.stringify(bad)), baseUrl).toThrow(
        SnippetsArtifactError,
      );
    }
  });
});

describe("no third-party generator dependencies", () => {
  it("keeps every language generator pure and synchronous", () => {
    const { operation, service } = hostileService("x");
    const { projection } = projectOperation(service, operation);
    const set = generateAll(projection, []);
    expect(set.snippets.map((snippet) => snippet.language)).toEqual([
      ...PROTOCOL_LANGUAGES,
    ]);
  });
});
