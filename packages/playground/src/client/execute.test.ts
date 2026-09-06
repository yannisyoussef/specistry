import { describe, expect, it, vi } from "vitest";

import { PLAYGROUND_HARD_LIMITS, type PlaygroundLimits } from "../types.js";
import { executeRequest, RESULT_MESSAGES } from "./execute.js";
import type { ExecutableRequest } from "./request.js";

/**
 * SPEC-009 §22–§28, §83–§85, §99–§118: the executor issues one hardened
 * fetch, never follows a redirect, never retries, is bounded by the limit
 * and the timeout, can be cancelled, and returns plain data.
 */

const limits: PlaygroundLimits = {
  ...PLAYGROUND_HARD_LIMITS,
  responseBytes: 1_024,
  timeoutMs: 200,
};

const request: ExecutableRequest = {
  environmentId: "local",
  headers: [
    { name: "Authorization", value: "Bearer secret-token" },
    { name: "Accept", value: "application/json" },
  ],
  method: "GET",
  url: "http://127.0.0.1:47391/v1/inboxes",
};

function stream(
  chunks: readonly string[],
  chunkBytes?: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        if (chunkBytes === undefined) controller.enqueue(encoder.encode(chunk));
        else controller.enqueue(new Uint8Array(chunkBytes).fill(120));
      }
      controller.close();
    },
  });
}

function response(init: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: ReadableStream<Uint8Array> | null;
  type?: ResponseType;
}): Response {
  // A minimal Headers stand-in: the executor only iterates and reads
  // `content-type`, and a real Headers would refuse the hostile values the
  // tests inject.
  const entries = new Map(
    Object.entries(init.headers ?? {}).map(([name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  );
  const headers = {
    forEach(callback: (value: string, name: string) => void) {
      for (const [name, value] of entries) callback(value, name);
    },
    get(name: string) {
      return entries.get(name.toLowerCase()) ?? null;
    },
  };
  return {
    body: init.body ?? null,
    headers,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    type: init.type ?? "cors",
  } as unknown as Response;
}

describe("executeRequest", () => {
  it("issues exactly one hardened fetch and returns the bounded result", async () => {
    const fetchImplementation = vi.fn(async () =>
      response({
        body: stream(['{"id":"inb_1"}']),
        headers: { "content-type": "application/json", "x-request-id": "r1" },
      }),
    );
    const result = await executeRequest(request, {
      fetchImplementation,
      limits,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(request.url);
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      method: "GET",
      mode: "cors",
      redirect: "manual",
      referrerPolicy: "no-referrer",
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBeUndefined();
    expect(result.state).toBe("ok");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      bytes: 14,
      contentType: "application/json",
      kind: "json",
      text: '{\n  "id": "inb_1"\n}',
      truncated: false,
    });
    expect(result.headers).toEqual([
      { name: "content-type", value: "application/json" },
      { name: "x-request-id", value: "r1" },
    ]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sends text, form, binary, and multipart bodies as the matching BodyInit", async () => {
    const seen: unknown[] = [];
    const fetchImplementation = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init?.body);
        return response({ body: null });
      },
    );
    const base = { ...request, method: "POST" };
    await executeRequest(
      {
        ...base,
        body: { contentType: "application/json", kind: "text", text: "{}" },
      },
      { fetchImplementation, limits },
    );
    await executeRequest(
      {
        ...base,
        body: {
          contentType: "application/x-www-form-urlencoded",
          kind: "form",
          text: "a=1",
        },
      },
      { fetchImplementation, limits },
    );
    const blob = new Blob(["x"]);
    await executeRequest(
      {
        ...base,
        body: { blob, contentType: "application/octet-stream", kind: "binary" },
      },
      { fetchImplementation, limits },
    );
    await executeRequest(
      {
        ...base,
        body: {
          entries: [
            { name: "f", value: "v" },
            { fileName: "a.txt", name: "file", value: blob },
          ],
          kind: "multipart",
        },
      },
      { fetchImplementation, limits },
    );
    expect(seen[0]).toBe("{}");
    expect(seen[1]).toBe("a=1");
    expect(seen[2]).toBe(blob);
    expect(seen[3]).toBeInstanceOf(FormData);
    expect((seen[3] as FormData).get("f")).toBe("v");
    expect(((seen[3] as FormData).get("file") as File).name).toBe("a.txt");
  });

  it("reports an opaque redirect as blocked and never fetches again", async () => {
    const fetchImplementation = vi.fn(async () =>
      response({ status: 0, statusText: "", type: "opaqueredirect" }),
    );
    const result = await executeRequest(request, {
      fetchImplementation,
      limits,
    });
    expect(result.state).toBe("redirect-blocked");
    expect(result.message).toBe(RESULT_MESSAGES["redirect-blocked"]);
    expect(result.status).toBeUndefined();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("reports an exposed 3xx as blocked too", async () => {
    const fetchImplementation = vi.fn(async () =>
      response({
        status: 302,
        statusText: "Found",
        headers: { location: "https://elsewhere.example" },
      }),
    );
    const result = await executeRequest(request, {
      fetchImplementation,
      limits,
    });
    expect(result.state).toBe("redirect-blocked");
    expect(result.status).toBe(302);
    expect(result.headers).toEqual([]);
  });

  it("treats 304 as an ordinary response", async () => {
    const fetchImplementation = vi.fn(async () =>
      response({ status: 304, statusText: "Not Modified" }),
    );
    const result = await executeRequest(request, {
      fetchImplementation,
      limits,
    });
    expect(result.state).toBe("ok");
    expect(result.body).toEqual({
      bytes: 0,
      contentType: "",
      kind: "empty",
      text: "",
      truncated: false,
    });
  });

  it("stops reading at the response limit and marks the body partial", async () => {
    const fetchImplementation = vi.fn(async () =>
      response({
        body: stream(["", "", "", ""], 400),
        headers: { "content-type": "text/plain" },
      }),
    );
    const result = await executeRequest(request, {
      fetchImplementation,
      limits,
    });
    expect(result.state).toBe("ok");
    expect(result.body?.truncated).toBe(true);
    expect(result.body?.bytes).toBe(1_024);
    expect(result.body?.text.length).toBe(1_024);
    expect(result.body?.kind).toBe("text");
  });

  it("labels a truncated JSON body as text rather than pretty-printing a fragment", async () => {
    const fetchImplementation = vi.fn(async () =>
      response({
        body: stream(["", "", "", ""], 400),
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await executeRequest(request, {
      fetchImplementation,
      limits,
    });
    expect(result.body?.kind).toBe("text");
    expect(result.body?.truncated).toBe(true);
  });

  it("does not decode binary bodies", async () => {
    const fetchImplementation = vi.fn(async () =>
      response({
        body: stream(["\u0000\u0001"]),
        headers: { "content-type": "application/octet-stream" },
      }),
    );
    const result = await executeRequest(request, {
      fetchImplementation,
      limits,
    });
    expect(result.body).toMatchObject({ kind: "binary", text: "" });
  });

  it("keeps HTML as text and labels an unparsable JSON body as text", async () => {
    const html = vi.fn(async () =>
      response({
        body: stream(["<script>alert(1)</script>"]),
        headers: { "content-type": "text/html" },
      }),
    );
    expect(
      (await executeRequest(request, { fetchImplementation: html, limits }))
        .body,
    ).toMatchObject({ kind: "text", text: "<script>alert(1)</script>" });
    const bad = vi.fn(async () =>
      response({
        body: stream(["{not json"]),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(
      (await executeRequest(request, { fetchImplementation: bad, limits }))
        .body,
    ).toMatchObject({ kind: "text", text: "{not json" });
  });

  it("bounds, sanitizes, sorts, and redacts response headers", async () => {
    const headers: Record<string, string> = {};
    for (let index = 0; index < 80; index += 1)
      headers[`x-h-${String(index).padStart(2, "0")}`] = `v${index}`;
    headers.authorization = "Bearer leaked";
    headers["x-long"] = "y".repeat(5_000);
    headers["x-ctl"] = "a\u0000b\u202ec";
    const fetchImplementation = vi.fn(async () => response({ headers }));
    const result = await executeRequest(request, {
      fetchImplementation,
      limits: {
        ...limits,
        responseHeaderCount: 10,
        responseHeaderValueLength: 16,
      },
    });
    expect(result.headers.length).toBe(10);
    expect(result.headers.map((header) => header.name)).toEqual(
      [...result.headers.map((header) => header.name)].sort(),
    );
    const text = JSON.stringify(result.headers);
    expect(text).not.toContain("leaked");
    expect(text).not.toContain("\u0000");
    for (const header of result.headers)
      expect(header.value.length).toBeLessThanOrEqual(16);
  });

  it("times out through the shared controller", async () => {
    const fetchImplementation = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const result = await executeRequest(request, {
      fetchImplementation,
      limits: { ...limits, timeoutMs: 20 },
    });
    expect(result.state).toBe("timeout");
    expect(result.message).toBe(RESULT_MESSAGES.timeout);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("reports an external abort as cancelled", async () => {
    const controller = new AbortController();
    const fetchImplementation = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const pending = executeRequest(request, {
      fetchImplementation,
      limits: { ...limits, timeoutMs: 5_000 },
      signal: controller.signal,
    });
    controller.abort();
    const result = await pending;
    expect(result.state).toBe("cancelled");
    expect(result.message).toBe(RESULT_MESSAGES.cancelled);
  });

  it("reports a signal that was already aborted as cancelled without fetching a second time", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImplementation = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal?.aborted)
          throw new DOMException("aborted", "AbortError");
        return response({});
      },
    );
    const result = await executeRequest(request, {
      fetchImplementation,
      limits,
      signal: controller.signal,
    });
    expect(result.state).toBe("cancelled");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("maps any other failure to a credential-free network failure", async () => {
    const fetchImplementation = vi.fn(async () => {
      throw new TypeError("Failed to fetch Bearer secret-token");
    });
    const result = await executeRequest(request, {
      fetchImplementation,
      limits,
    });
    expect(result.state).toBe("network-failure");
    expect(result.message).toBe(RESULT_MESSAGES["network-failure"]);
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("measures duration with the injected clock", async () => {
    let tick = 0;
    const fetchImplementation = vi.fn(async () => response({}));
    const result = await executeRequest(request, {
      fetchImplementation,
      limits,
      now: () => (tick += 250),
    });
    expect(result.durationMs).toBe(250);
  });
});
