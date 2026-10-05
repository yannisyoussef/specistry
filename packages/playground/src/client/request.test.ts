import { describe, expect, it } from "vitest";

import {
  PLAYGROUND_HARD_LIMITS,
  type OperationForm,
  type ParameterField,
  type PlaygroundEnvironment,
} from "../types.js";
import { createCredentialVault } from "./credentials.js";
import { MASK } from "./redact.js";
import {
  buildRequest,
  encodeBase64,
  parameterKey,
  type FormValues,
} from "./request.js";

/**
 * SPEC-009 §53–§68, §81, §127: the builder turns the form, the user's
 * values, and the vault into one validated request through the shared
 * serializer, addresses every blocking condition to a field, and never
 * shows a credential in the preview.
 */

const limits = PLAYGROUND_HARD_LIMITS;
const environment: PlaygroundEnvironment = {
  baseUrl: "https://api.example.com/v1",
  id: "production",
  label: "Production",
  loopback: false,
  origin: "https://api.example.com",
};

function field(
  overrides: Partial<ParameterField> &
    Pick<ParameterField, "name" | "location">,
): ParameterField {
  return {
    array: false,
    capability: "supported",
    contentTyped: false,
    deprecated: false,
    initial: "",
    kind: "string",
    label: overrides.name,
    required: false,
    serialization:
      overrides.location === "query"
        ? { allowReserved: false, explode: true, style: "form" }
        : overrides.location === "path"
          ? { explode: false, style: "simple" }
          : { explode: false },
    ...overrides,
  };
}

const form: OperationForm = {
  auth: [
    {
      label: "X-Api-Key header",
      schemes: [
        {
          kind: "apiKeyHeader",
          label: "X-Api-Key header",
          name: "X-Api-Key",
          scopes: [],
          supported: true,
        },
      ],
      supported: true,
    },
    {
      label: "Bearer token",
      schemes: [
        { kind: "bearer", label: "Bearer token", scopes: [], supported: true },
      ],
      supported: true,
    },
    {
      label: "Basic + tenant",
      schemes: [
        {
          kind: "basic",
          label: "Basic authentication",
          scopes: [],
          supported: true,
        },
        {
          kind: "apiKeyHeader",
          label: "X-Tenant header",
          name: "X-Tenant",
          scopes: [],
          supported: true,
        },
      ],
      supported: true,
    },
    {
      label: "Cookie",
      schemes: [
        {
          kind: "apiKeyCookie",
          label: "session cookie",
          name: "session",
          reason: "auth-cookie-api-key",
          scopes: [],
          supported: false,
        },
      ],
      supported: false,
    },
  ],
  bodies: [
    { fields: [], initial: "{}", kind: "json", mediaType: "application/json" },
    {
      fields: [
        { file: false, initial: "", name: "label", required: true },
        { file: false, initial: "", name: "note", required: false },
      ],
      initial: "",
      kind: "form",
      mediaType: "application/x-www-form-urlencoded",
    },
    {
      fields: [
        { file: true, initial: "", name: "logo", required: true },
        { file: false, initial: "", name: "alt", required: false },
      ],
      initial: "",
      kind: "multipart",
      mediaType: "multipart/form-data",
    },
    { fields: [], initial: "", kind: "binary", mediaType: "image/png" },
    { fields: [], initial: "", kind: "text", mediaType: "text/plain" },
  ],
  bodyRequired: true,
  capability: { reasons: [], state: "executable" },
  method: "POST",
  parameters: [
    field({ location: "path", name: "inboxId", required: true }),
    field({ kind: "integer", location: "query", name: "limit" }),
    field({ array: true, kind: "json", location: "query", name: "tags" }),
    field({ kind: "boolean", location: "query", name: "unread" }),
    field({
      kind: "enum",
      location: "query",
      name: "sort",
      options: ["asc", "desc"],
    }),
    field({ location: "header", name: "X-Request-Id" }),
    field({
      capability: "unsupported",
      location: "header",
      name: "Cookie",
      reason: "forbidden-header",
    }),
    field({
      capability: "unsupported",
      location: "cookie",
      name: "session",
      reason: "cookie-parameter",
    }),
  ],
  pathTemplate: "/inboxes/{inboxId}",
  responseKind: "json",
};

function values(overrides: Partial<FormValues> = {}): FormValues {
  return {
    authAlternative: 0,
    bodyFields: {},
    bodyMediaType: "application/json",
    bodyText: '{"label":"x"}',
    files: {},
    parameters: { "path:inboxId": "inb_1" },
    ...overrides,
  };
}

function readyVault() {
  const vault = createCredentialVault();
  vault.set(environment.id, "apiKeyHeader:X-Api-Key", {
    apiKey: "sk_live_secret",
  });
  return vault;
}

describe("buildRequest", () => {
  it("builds the request through the shared serializer and masks the preview", () => {
    const result = buildRequest(
      form,
      environment,
      values({
        parameters: {
          "header:X-Request-Id": "req-1",
          "path:inboxId": "inb 1/x",
          "query:limit": "5",
          "query:sort": "desc",
          "query:tags": '["a","b c"]',
          "query:unread": "true",
        },
      }),
      readyVault(),
      limits,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.url).toBe(
      "https://api.example.com/v1/inboxes/inb%201%2Fx?limit=5&tags=a&tags=b%20c&unread=true&sort=desc",
    );
    expect(result.request.headers).toEqual([
      { name: "X-Request-Id", value: "req-1" },
      { name: "X-Api-Key", value: "sk_live_secret" },
      { name: "Content-Type", value: "application/json" },
    ]);
    expect(result.request.body).toEqual({
      contentType: "application/json",
      kind: "text",
      text: '{"label":"x"}',
    });
    expect(result.request.environmentId).toBe("production");
    expect(
      result.preview.headers.find((header) => header.name === "X-Api-Key")
        ?.value,
    ).toBe(MASK);
    expect(JSON.stringify(result.preview)).not.toContain("sk_live_secret");
    expect(result.preview.body).toBe("application/json · 13 bytes");
  });

  it("blocks when no environment is approved or the operation is unsupported", () => {
    expect(
      buildRequest(form, undefined, values(), readyVault(), limits),
    ).toEqual({
      errors: [
        {
          field: "destination",
          message: "No live playground environment is configured.",
        },
      ],
      ok: false,
    });
    const unsupported: OperationForm = {
      ...form,
      capability: { reasons: ["cookie-parameter"], state: "unsupported" },
    };
    const result = buildRequest(
      unsupported,
      environment,
      values(),
      readyVault(),
      limits,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.field)).toEqual(["capability"]);
  });

  it("addresses missing required values, bad kinds, and oversize values to their fields", () => {
    const result = buildRequest(
      form,
      environment,
      values({
        parameters: {
          "query:limit": "1.5",
          "query:tags": "{}",
          "query:unread": "maybe",
          "header:X-Request-Id": "x".repeat(5_000),
          "path:inboxId": "",
        },
      }),
      readyVault(),
      limits,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.field).sort()).toEqual([
      "parameter:header:X-Request-Id",
      "parameter:path:inboxId",
      "parameter:query:limit",
      "parameter:query:tags",
      "parameter:query:unread",
    ]);
  });

  it("refuses values for cookie parameters and forbidden headers instead of dropping them silently", () => {
    const result = buildRequest(
      form,
      environment,
      values({
        parameters: {
          "cookie:session": "abc",
          "header:Cookie": "a=b",
          "path:inboxId": "inb_1",
        },
      }),
      readyVault(),
      limits,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((error) => error.field).sort()).toEqual([
      "parameter:cookie:session",
      "parameter:header:Cookie",
    ]);
  });

  it("requires every credential of the chosen alternative and applies them all", () => {
    const vault = createCredentialVault();
    const missing = buildRequest(
      form,
      environment,
      values({ authAlternative: 2 }),
      vault,
      limits,
    );
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors.map((error) => error.field)).toEqual([
      "auth:basic",
      "auth:apiKeyHeader:X-Tenant",
    ]);

    vault.set(environment.id, "basic", {
      password: "pässword",
      username: "alice",
    });
    vault.set(environment.id, "apiKeyHeader:X-Tenant", { apiKey: "acme" });
    const result = buildRequest(
      form,
      environment,
      values({ authAlternative: 2 }),
      vault,
      limits,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.headers).toContainEqual({
      name: "Authorization",
      value: `Basic ${encodeBase64("alice:pässword")}`,
    });
    expect(result.request.headers).toContainEqual({
      name: "X-Tenant",
      value: "acme",
    });
    expect(
      result.preview.headers.find((header) => header.name === "Authorization")
        ?.value,
    ).toBe(`Basic ${MASK}`);
    expect(JSON.stringify(result.preview)).not.toContain("pässword");
  });

  it("never uses a credential stored for another environment", () => {
    const vault = createCredentialVault();
    vault.set("sandbox", "apiKeyHeader:X-Api-Key", { apiKey: "sandbox-key" });
    const result = buildRequest(form, environment, values(), vault, limits);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      {
        field: "auth:apiKeyHeader:X-Api-Key",
        message: "X-Api-Key header is required.",
      },
    ]);
  });

  it("rejects an unsupported or out-of-range alternative", () => {
    for (const authAlternative of [3, 9, -1]) {
      const result = buildRequest(
        form,
        environment,
        values({ authAlternative }),
        readyVault(),
        limits,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.map((error) => error.field)).toEqual(["auth"]);
    }
  });

  it("sends a bearer token with the Bearer scheme", () => {
    const vault = createCredentialVault();
    vault.set(environment.id, "bearer", { token: "tok" });
    const result = buildRequest(
      form,
      environment,
      values({ authAlternative: 1 }),
      vault,
      limits,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.headers).toContainEqual({
      name: "Authorization",
      value: "Bearer tok",
    });
    expect(result.preview.headers).toContainEqual({
      name: "Authorization",
      value: `Bearer ${MASK}`,
    });
  });

  it("validates JSON bodies and requires one when the operation says so", () => {
    const invalid = buildRequest(
      form,
      environment,
      values({ bodyText: "{oops" }),
      readyVault(),
      limits,
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok)
      expect(invalid.errors).toEqual([
        { field: "body", message: "The body is not valid JSON." },
      ]);
    const empty = buildRequest(
      form,
      environment,
      values({ bodyText: "  " }),
      readyVault(),
      limits,
    );
    expect(empty.ok).toBe(false);
    if (!empty.ok)
      expect(empty.errors).toEqual([
        { field: "body", message: "A JSON body is required." },
      ]);
    const optional = buildRequest(
      { ...form, bodyRequired: false },
      environment,
      values({ bodyText: "" }),
      readyVault(),
      limits,
    );
    expect(optional.ok).toBe(true);
    if (optional.ok) {
      expect(optional.request.body).toBeUndefined();
      expect(
        optional.request.headers.some(
          (header) => header.name === "Content-Type",
        ),
      ).toBe(false);
    }
  });

  it("encodes form bodies and reports missing required fields", () => {
    const missing = buildRequest(
      form,
      environment,
      values({ bodyMediaType: "application/x-www-form-urlencoded" }),
      readyVault(),
      limits,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok)
      expect(missing.errors).toEqual([
        { field: "body:label", message: "label is required." },
      ]);
    const result = buildRequest(
      form,
      environment,
      values({
        bodyFields: { label: "a b&c", note: "ünï" },
        bodyMediaType: "application/x-www-form-urlencoded",
      }),
      readyVault(),
      limits,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.body).toEqual({
      contentType: "application/x-www-form-urlencoded",
      kind: "form",
      text: "label=a%20b%26c&note=%C3%BCn%C3%AF",
    });
  });

  it("assembles multipart parts with files and leaves the content type to the browser", () => {
    const logo = new Blob([new Uint8Array(3)], { type: "image/png" });
    const result = buildRequest(
      form,
      environment,
      values({
        bodyFields: { alt: "Logo" },
        bodyMediaType: "multipart/form-data",
        files: { logo },
      }),
      readyVault(),
      limits,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.body).toEqual({
      entries: [
        { fileName: "file", name: "logo", value: logo },
        { name: "alt", value: "Logo" },
      ],
      kind: "multipart",
    });
    expect(
      result.request.headers.some((header) => header.name === "Content-Type"),
    ).toBe(false);
    const oversized = buildRequest(
      form,
      environment,
      values({ bodyMediaType: "multipart/form-data", files: { logo } }),
      readyVault(),
      { ...limits, fileBytes: 2 },
    );
    expect(oversized.ok).toBe(false);
    if (!oversized.ok)
      expect(oversized.errors).toEqual([
        { field: "body:logo", message: "logo exceeds 2 bytes." },
      ]);
  });

  it("handles binary and text bodies with their limits", () => {
    const blob = new Blob(["png"]);
    const binary = buildRequest(
      form,
      environment,
      values({ bodyMediaType: "image/png", files: { body: blob } }),
      readyVault(),
      limits,
    );
    expect(binary.ok).toBe(true);
    if (binary.ok)
      expect(binary.request.body).toEqual({
        blob,
        contentType: "image/png",
        kind: "binary",
      });
    const noFile = buildRequest(
      form,
      environment,
      values({ bodyMediaType: "image/png" }),
      readyVault(),
      limits,
    );
    expect(noFile.ok).toBe(false);
    const text = buildRequest(
      form,
      environment,
      values({ bodyMediaType: "text/plain", bodyText: "hello" }),
      readyVault(),
      limits,
    );
    expect(text.ok).toBe(true);
    if (text.ok)
      expect(text.request.body).toEqual({
        contentType: "text/plain",
        kind: "text",
        text: "hello",
      });
    const big = buildRequest(
      form,
      environment,
      values({ bodyMediaType: "text/plain", bodyText: "hello" }),
      readyVault(),
      { ...limits, bodyBytes: 2 },
    );
    expect(big.ok).toBe(false);
  });

  it("bounds the header count and rejects header injection", () => {
    const many: OperationForm = {
      ...form,
      parameters: [
        field({ location: "path", name: "inboxId", required: true }),
        ...Array.from({ length: 40 }, (_, index) =>
          field({ location: "header", name: `X-H-${index}` }),
        ),
      ],
    };
    const parameters: Record<string, string> = { "path:inboxId": "inb_1" };
    for (let index = 0; index < 40; index += 1)
      parameters[`header:X-H-${index}`] = "v";
    const result = buildRequest(
      many,
      environment,
      values({ parameters }),
      readyVault(),
      limits,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.errors.some((error) => error.field === "headers")).toBe(
        true,
      );
    // The shared serializer strips line breaks; whichever way, no header
    // value may ever carry one.
    const injected = buildRequest(
      form,
      environment,
      values({
        parameters: {
          "header:X-Request-Id": "a\r\nX-Evil: 1",
          "path:inboxId": "inb_1",
        },
      }),
      readyVault(),
      limits,
    );
    if (injected.ok) {
      for (const header of injected.request.headers)
        expect(header.value).not.toMatch(/[\r\n]/);
      expect(
        injected.request.headers.some((header) => header.name === "X-Evil"),
      ).toBe(false);
    }
  });

  it("fails closed when the composed URL leaves the approved origin", () => {
    const hostile = buildRequest(
      form,
      environment,
      values({ parameters: { "path:inboxId": "..", "query:limit": "1" } }),
      readyVault(),
      { ...limits, urlLength: 10 },
    );
    expect(hostile.ok).toBe(false);
    if (!hostile.ok)
      expect(hostile.errors.map((error) => error.field)).toContain(
        "destination",
      );
  });

  it("percent-encodes reserved characters in literal path segments", () => {
    const odd: OperationForm = {
      ...form,
      auth: [],
      bodies: [],
      bodyRequired: false,
      parameters: [
        field({ location: "path", name: "inboxId", required: true }),
      ],
      pathTemplate: "/Inbox rules?/{inboxId}#x",
    };
    const result = buildRequest(
      odd,
      environment,
      values({ parameters: { "path:inboxId": "a" } }),
      createCredentialVault(),
      limits,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.url).toBe(
      "https://api.example.com/v1/Inbox%20rules%3F/a%23x",
    );
    expect(new URL(result.request.url).pathname.startsWith("/v1/")).toBe(true);
  });

  it("derives stable parameter keys and base64 for non-Latin text", () => {
    expect(parameterKey({ location: "query", name: "q" })).toBe("query:q");
    expect(encodeBase64("user:pass")).toBe("dXNlcjpwYXNz");
    expect(encodeBase64("ü")).toBe("w7w=");
    expect(encodeBase64("")).toBe("");
  });
});
