import { describe, expect, it } from "vitest";

import { exampleFor, sanitizeExample } from "./example.js";
import { findOperation, HOSTILE, SERVICE } from "./fixtures.test-helper.js";
import { projectOperation } from "./projection.js";
import { resolveRequest } from "./resolve.js";
import {
  isSensitiveName,
  placeholderFor,
  sanitizeLine,
  secretPlaceholderFor,
} from "./sanitize.js";
import { serverEnvironment, validateBaseUrl } from "./url.js";

const project = (contractId: string) =>
  projectOperation(SERVICE, findOperation(contractId));

describe("parameter serialization", () => {
  const { projection, diagnostics } = project("getWithPathAndQuery");

  it("serializes path styles: simple, exploded label array, exploded matrix object", () => {
    expect(projection.path).toBe("/inboxes/<INBOX_ID>/messages/.a.b/;x=1;y=2");
  });

  it("serializes query styles and keeps parameter order", () => {
    expect(projection.query).toEqual([
      { name: "limit", value: "20" },
      { name: "tags", value: "a" },
      { name: "tags", value: "b%20c" },
      { name: "csv", value: "a,b" },
      { name: "space", value: "a%20b" },
      { name: "pipe", value: "a|b" },
      { name: "filter[x]", value: "1" },
      { name: "filter[y]", value: "2" },
      { name: "obj", value: "x,1,y,2" },
      { name: "path", value: "/a/b?c=d%26e" },
    ]);
  });

  it("omits deprecated optional parameters", () => {
    expect(projection.query.some((pair) => pair.name === "ignored")).toBe(
      false,
    );
  });

  it("serializes header arrays and exploded objects, skipping invalid names", () => {
    expect(projection.headers).toEqual([
      { name: "X-Trace", value: "t1,t2" },
      { name: "X-Point", value: "x=1,y=2" },
    ]);
    expect(diagnostics).toContainEqual({
      code: "SNIPPET_HEADER_SKIPPED",
      detail: "Bad Header",
      operationId: "getWithPathAndQuery",
    });
  });

  it("percent-encodes cookie values", () => {
    expect(projection.cookies).toEqual([
      { name: "prefs", value: "compact%20mode" },
    ]);
  });

  it("projects the first success response as the response kind", () => {
    expect(projection.responseKind).toBe("json");
    expect(project("postJson").projection.responseKind).toBe("none");
    expect(project("uploadBinary").projection.responseKind).toBe("text");
  });
});

describe("servers and environments", () => {
  it("keeps only servers that pass the base URL policy, with variables substituted", () => {
    const { projection, diagnostics } = project("postJson");
    expect(projection.servers).toEqual([
      {
        baseUrl: "https://api.example.com/v1",
        id: "production",
        label: "Production",
      },
      { baseUrl: "http://localhost:8080/api", id: "local", label: "Local" },
    ]);
    expect(diagnostics.map((entry) => entry.detail)).toEqual([
      "relative",
      "insecure",
      "credentials",
    ]);
  });

  it("validates base URLs like configured environments", () => {
    expect(validateBaseUrl("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1",
    );
    expect(validateBaseUrl("http://127.0.0.1:3000")).toBe(
      "http://127.0.0.1:3000",
    );
    expect(validateBaseUrl("http://api.example.com")).toBeUndefined();
    expect(validateBaseUrl("https://user:pw@api.example.com")).toBeUndefined();
    expect(validateBaseUrl("https://api.example.com/?x=1")).toBeUndefined();
    expect(validateBaseUrl("https://api.example.com/#frag")).toBeUndefined();
    expect(validateBaseUrl("not a url")).toBeUndefined();
    expect(
      serverEnvironment({
        id: "s",
        label: "",
        url: "https://{host}/",
        variables: {},
      }),
    ).toBeUndefined();
  });

  it("prefers configured environments, then servers, then the placeholder", () => {
    const { projection } = project("postJson");
    const configured = [
      {
        baseUrl: "https://sandbox.example.com",
        id: "sandbox",
        label: "Sandbox",
      },
    ];
    expect(resolveRequest(projection, configured).request.url).toBe(
      "https://sandbox.example.com/inboxes",
    );
    expect(resolveRequest(projection, []).request.url).toBe(
      "https://api.example.com/v1/inboxes",
    );
    expect(
      resolveRequest(projection, [], { environment: "local" }).request.url,
    ).toBe("http://localhost:8080/api/inboxes");
    const noServers = { ...projection, servers: [] };
    expect(resolveRequest(noServers, []).request.url).toBe(
      "<BASE_URL>/inboxes",
    );
  });
});

describe("bodies", () => {
  it("projects a schema-shaped JSON body in request context with bounded recursion", () => {
    const { projection } = project("postJson");
    expect(projection.bodies[0]).toEqual({
      json: {
        children: [],
        email: "user@example.com",
        name: "string",
        parent: {},
        secretToken: "<YOUR_SECRET_TOKEN>",
        ttl: 3600,
      },
      kind: "json",
      mediaType: "application/json",
      truncated: false,
    });
  });

  it("prefers the first non-empty example and redacts sensitive keys", () => {
    const { projection } = project("patchJson");
    expect(projection.bodies[0]?.json).toEqual({
      name: "renamed",
      password: "<YOUR_PASSWORD>",
    });
  });

  it("projects multipart fields with file parts and part content types", () => {
    const { projection } = project("uploadMultipart");
    expect(projection.bodies[0]).toEqual({
      fields: [
        {
          contentType: "image/png",
          file: true,
          name: "file",
          value: "/path/to/file",
        },
        { file: false, name: "altText", value: "string" },
      ],
      kind: "multipart",
      mediaType: "multipart/form-data",
      truncated: false,
    });
  });

  it("projects form, binary, text, and opaque bodies", () => {
    expect(
      project("submitForm").projection.bodies.map((body) => body.kind),
    ).toEqual(["form", "json"]);
    expect(project("submitForm").projection.bodies[0]?.fields).toEqual([
      { file: false, name: "ttl", value: "0" },
      { file: false, name: "note", value: "string" },
    ]);
    expect(project("uploadBinary").projection.bodies[0]).toEqual({
      kind: "binary",
      mediaType: "application/octet-stream",
      truncated: false,
    });
    expect(project("postText").projection.bodies[0]?.text).toBe(
      "line one\nline two",
    );
    expect(project("postXml").projection.bodies[0]).toEqual({
      kind: "opaque",
      mediaType: "application/xml",
      text: '{\n  "x": 0,\n  "y": 0\n}',
      truncated: false,
    });
  });

  it("selects the first oneOf variant and sets the discriminator", () => {
    expect(project("postShape").projection.bodies[0]?.json).toEqual({
      kind: "circle",
      radius: 0,
    });
  });

  it("bounds pathological schemas", () => {
    const wide: Record<string, { kind: "scalar"; type: "string" }> = {};
    for (let index = 0; index < 500; index += 1)
      wide[`p${index}`] = { kind: "scalar", type: "string" };
    const value = exampleFor(
      {
        additionalProperties: false,
        kind: "object",
        properties: wide,
        propertyOrder: Object.keys(wide),
        required: [],
      },
      "body",
      {},
    );
    expect(Object.keys(value as object).length).toBeLessThanOrEqual(120);
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let depth = 0; depth < 40; depth += 1) {
      cursor.child = {};
      cursor = cursor.child as Record<string, unknown>;
    }
    const sanitized = sanitizeExample(deep as never) as Record<string, unknown>;
    let depth = 0;
    let node: unknown = sanitized;
    while (
      node !== null &&
      typeof node === "object" &&
      "child" in (node as object)
    ) {
      node = (node as Record<string, unknown>).child;
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(8);
  });
});

describe("authentication", () => {
  it("projects OR-of-AND alternatives faithfully", () => {
    const { projection } = project("compoundAuth");
    expect(projection.auth.map((alternative) => alternative.label)).toEqual([
      "X-Api-Key header + Client certificate (mTLS)",
      "OpenID Connect",
      "No authentication",
    ]);
    const first = resolveRequest(projection, []).request;
    expect(first.headers).toEqual([
      { name: "X-Api-Key", value: "<YOUR_API_KEY>" },
    ]);
    expect(first.mutualTls).toBe(true);
    const second = resolveRequest(projection, [], { auth: "1" }).request;
    expect(second.headers).toEqual([
      { name: "Authorization", value: "Bearer <YOUR_ACCESS_TOKEN>" },
    ]);
    const third = resolveRequest(projection, [], { auth: "2" }).request;
    expect(third.headers).toEqual([]);
  });

  it("represents every scheme kind with a placeholder and no credential", () => {
    const query = resolveRequest(project("submitForm").projection, []).request;
    expect(query.url).toBe(
      "https://api.example.com/v1/forms?api_key=<YOUR_API_KEY>",
    );
    const cookie = resolveRequest(
      project("uploadBinary").projection,
      [],
    ).request;
    expect(cookie.cookies).toEqual([{ name: "sid", value: "<YOUR_API_KEY>" }]);
    const basic = resolveRequest(project("patchJson").projection, []).request;
    expect(basic.basic).toEqual({
      password: "<PASSWORD>",
      username: "<USERNAME>",
    });
    expect(basic.headers).toContainEqual({
      name: "Authorization",
      value: "Basic <BASE64_CREDENTIALS>",
    });
    const digest = resolveRequest(project("postText").projection, []).request;
    expect(digest.headers).toContainEqual({
      name: "Authorization",
      value: "Digest <CREDENTIALS>",
    });
    const oauth = resolveRequest(
      project("uploadMultipart").projection,
      [],
    ).request;
    expect(oauth.auth.schemes[0]?.scopes).toEqual(["team:read"]);
  });

  it("lets the security scheme and media type win header collisions", () => {
    const { projection } = project("postJson");
    const collided = {
      ...projection,
      headers: [
        { name: "content-type", value: "text/plain" },
        { name: "x-api-key", value: "from-parameter" },
      ],
    };
    const { request } = resolveRequest(collided, []);
    expect(request.headers).toEqual([
      { name: "X-Api-Key", value: "<YOUR_API_KEY>" },
      { name: "Content-Type", value: "application/json" },
    ]);
  });
});

describe("sanitization and placeholders", () => {
  it("derives readable placeholders and recognises sensitive names", () => {
    expect(placeholderFor("inboxId")).toBe("<INBOX_ID>");
    expect(placeholderFor("X-Request-ID")).toBe("<X_REQUEST_ID>");
    expect(placeholderFor("")).toBe("<VALUE>");
    expect(secretPlaceholderFor("api_key")).toBe("<YOUR_API_KEY>");
    for (const name of [
      "apiKey",
      "X-Auth-Token",
      "password",
      "sessionId",
      "client_secret",
      "api_key",
    ]) {
      expect(isSensitiveName(name), name).toBe(true);
    }
    for (const name of ["description", "keyword", "name", "monkey"]) {
      expect(isSensitiveName(name), name).toBe(false);
    }
  });

  it("removes control, line, and bidi characters from values", () => {
    expect(sanitizeLine(HOSTILE.crlf)).toBe("value Injected-Header: yes");
    expect(sanitizeLine(HOSTILE.bidi)).toBe("safeevil");
    expect(sanitizeLine("a b c")).toBe("abc");
  });

  it("never emits a header line break from hostile examples", () => {
    const { request } = resolveRequest(project("hostile").projection, []);
    for (const header of request.headers) {
      expect(header.value).not.toMatch(/[\r\n]/);
    }
    expect(request.headers).toContainEqual({
      name: "X-Evil",
      value: "value Injected-Header: yes",
    });
  });
});
