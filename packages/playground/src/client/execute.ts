import type { Pair } from "@specra/snippets/protocol";

import type { PlaygroundLimits } from "../types.js";
import { redactHeaders, sanitizeHeaderValue } from "./redact.js";
import type { ExecutableRequest } from "./request.js";

/**
 * Bounded browser execution (SPEC-009 §22–§28, §83–§85, §99–§118). One
 * hardened `fetch` per explicit user action: `mode: "cors"`,
 * `credentials: "omit"` (no ambient cookies), `redirect: "error"` (the
 * browser refuses redirects before requesting their targets), `cache: "no-store"`,
 * `referrerPolicy: "no-referrer"`, and an `AbortController` shared by the
 * timeout and the Cancel control. The body is read as a stream and stops
 * at the configured limit. The result model is plain data: no `Response`
 * leaves this module.
 */

export type ResultState =
  "cancelled" | "network-failure" | "ok" | "redirect-blocked" | "timeout";

export interface ResponseBody {
  readonly kind: "binary" | "empty" | "json" | "text";
  /** Bounded text for json/text kinds (pretty JSON when parsable). */
  readonly text: string;
  readonly bytes: number;
  /** The limit stopped the read; `text` is a prefix. */
  readonly truncated: boolean;
  readonly contentType: string;
}

export interface PlaygroundResult {
  readonly state: ResultState;
  readonly status?: number;
  readonly statusText?: string;
  /** Headers the browser exposes, bounded, sanitized, and redacted. */
  readonly headers: readonly Pair[];
  readonly body?: ResponseBody;
  readonly durationMs: number;
  /** Stable, credential-free explanation for non-`ok` states. */
  readonly message?: string;
}

export interface ExecuteOptions {
  readonly limits: PlaygroundLimits;
  readonly signal?: AbortSignal | undefined;
  readonly fetchImplementation?: typeof fetch;
  readonly now?: () => number;
}

export const RESULT_MESSAGES: Readonly<
  Record<Exclude<ResultState, "ok">, string>
> = {
  cancelled:
    "Cancelled. Specra stopped waiting for the response; a request that was already transmitted may still have been processed by the API.",
  "network-failure":
    "The browser could not complete this request. Common causes include CORS policy, a blocked redirect, network or TLS failure, DNS, or private-network restrictions.",
  "redirect-blocked":
    "The target returned a redirect. Specra does not automatically follow redirects in the playground. Configure the final approved environment URL.",
  timeout: "Timed out. The API did not respond within the playground timeout.",
};

const TEXT_TYPES =
  /^(?:text\/|application\/(?:json|[\w.+-]+\+json|xml|[\w.+-]+\+xml|x-www-form-urlencoded|javascript|yaml|x-yaml|problem\+json)|multipart\/form-data)/i;
const JSON_TYPES = /^application\/(?:json|[\w.+-]+\+json)/i;

export async function executeRequest(
  request: ExecutableRequest,
  options: ExecuteOptions,
): Promise<PlaygroundResult> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const now = options.now ?? (() => performance.now());
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.limits.timeoutMs);
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const started = now();
  const finish = (
    result: Omit<PlaygroundResult, "durationMs">,
  ): PlaygroundResult => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
    return { ...result, durationMs: Math.max(0, now() - started) };
  };
  try {
    const init = toBodyInit(request);
    const response = await fetchImplementation(request.url, {
      ...(init === undefined ? {} : { body: init }),
      cache: "no-store",
      credentials: "omit",
      headers: request.headers.map((header): [string, string] => [
        header.name,
        header.value,
      ]),
      method: request.method,
      mode: "cors",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (
      response.type === "opaqueredirect" ||
      (response.status >= 300 &&
        response.status < 400 &&
        response.status !== 304)
    ) {
      return finish({
        headers: [],
        message: RESULT_MESSAGES["redirect-blocked"],
        state: "redirect-blocked",
        ...(response.status === 0 ? {} : { status: response.status }),
      });
    }
    const headers = boundedHeaders(response.headers, options.limits);
    const contentType = response.headers.get("content-type") ?? "";
    const body = await readBody(
      response,
      contentType,
      options.limits.responseBytes,
      controller,
    );
    return finish({
      body,
      headers,
      state: "ok",
      status: response.status,
      statusText: response.statusText,
    });
  } catch {
    if (timedOut)
      return finish({
        headers: [],
        message: RESULT_MESSAGES.timeout,
        state: "timeout",
      });
    if (controller.signal.aborted)
      return finish({
        headers: [],
        message: RESULT_MESSAGES.cancelled,
        state: "cancelled",
      });
    return finish({
      headers: [],
      message: RESULT_MESSAGES["network-failure"],
      state: "network-failure",
    });
  }
}

function toBodyInit(request: ExecutableRequest): BodyInit | undefined {
  const body = request.body;
  if (body === undefined) return undefined;
  switch (body.kind) {
    case "text":
    case "form":
      return body.text;
    case "binary":
      return body.blob;
    case "multipart": {
      const data = new FormData();
      for (const entry of body.entries) {
        if (typeof entry.value === "string")
          data.append(entry.name, entry.value);
        else data.append(entry.name, entry.value, entry.fileName ?? "file");
      }
      return data;
    }
  }
}

function boundedHeaders(
  headers: Headers,
  limits: PlaygroundLimits,
): readonly Pair[] {
  const pairs: Pair[] = [];
  headers.forEach((value, name) => {
    if (pairs.length >= limits.responseHeaderCount) return;
    pairs.push({
      name: sanitizeHeaderValue(name, 128),
      value: sanitizeHeaderValue(value, limits.responseHeaderValueLength),
    });
  });
  pairs.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  return redactHeaders(pairs);
}

/** Streams at most `limit` bytes, then cancels the stream and marks truncation. */
async function readBody(
  response: Response,
  contentType: string,
  limit: number,
  controller: AbortController,
): Promise<ResponseBody> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  const stream = response.body;
  if (stream !== null) {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      const remaining = limit - received;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, Math.max(0, remaining)));
        received += Math.max(0, remaining);
        truncated = true;
        await reader.cancel().catch(() => undefined);
        controller.abort();
        break;
      }
      chunks.push(value);
      received += value.byteLength;
    }
  }
  const bytes = concatenate(chunks, received);
  const essence = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (received === 0)
    return {
      bytes: 0,
      contentType: essence,
      kind: "empty",
      text: "",
      truncated,
    };
  if (!TEXT_TYPES.test(essence) && essence !== "") {
    return {
      bytes: received,
      contentType: essence,
      kind: "binary",
      text: "",
      truncated,
    };
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (!truncated && JSON_TYPES.test(essence)) {
    try {
      return {
        bytes: received,
        contentType: essence,
        kind: "json",
        text: JSON.stringify(JSON.parse(text), null, 2),
        truncated,
      };
    } catch {
      // Labelled as text below: JSON content type with an unparsable body.
    }
  }
  return {
    bytes: received,
    contentType: essence,
    kind: "text",
    text,
    truncated,
  };
}

function concatenate(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
