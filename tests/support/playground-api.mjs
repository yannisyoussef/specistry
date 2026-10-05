// Fake target API for the playground browser suites (SPEC-009 §184–§186).
// It is the only process the Try it island is allowed to reach in tests; it
// records every request it receives so the suites can prove that the
// credential the user typed arrived here, and nowhere else, exactly once.
//
// Usage: node tests/support/playground-api.mjs <port> <allow|deny>
//   allow  – answers CORS preflights and reflects the requesting origin
//   deny   – never emits CORS headers, so the browser refuses every response
import { createServer } from "node:http";
import process from "node:process";

const port = Number(process.argv[2] ?? "47391");
const cors = process.argv[3] === "deny" ? "deny" : "allow";
const requests = [];
const MAX_RECORDED = 200;

function corsHeaders(request) {
  if (cors === "deny") return {};
  const origin = request.headers.origin;
  if (origin === undefined) return {};
  return {
    "access-control-allow-headers":
      request.headers["access-control-request-headers"] ??
      "authorization, content-type, x-api-key",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "access-control-allow-origin": origin,
    "access-control-expose-headers":
      "content-type, x-request-id, x-ratelimit-remaining, set-cookie",
    "access-control-max-age": "0",
    vary: "origin",
  };
}

function send(response, status, headers, body) {
  response.writeHead(status, headers);
  response.end(body);
}

function json(response, status, extra, value) {
  send(
    response,
    status,
    { "content-type": "application/json; charset=utf-8", ...extra },
    JSON.stringify(value, null, 2),
  );
}

const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks);
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    const record = {
      body: body.toString("utf8").slice(0, 4096),
      headers: request.headers,
      method: request.method,
      path: url.pathname,
      search: url.search,
    };
    if (!url.pathname.startsWith("/__")) {
      requests.push(record);
      if (requests.length > MAX_RECORDED) requests.shift();
    }
    const base = corsHeaders(request);

    // Control surface (never CORS-exposed; used by the test runner only).
    if (url.pathname === "/__health")
      return json(response, 200, {}, { ok: true, cors });
    if (url.pathname === "/__requests") {
      if (request.method === "DELETE") {
        requests.length = 0;
        return json(response, 200, {}, { cleared: true });
      }
      return json(response, 200, {}, requests);
    }

    if (request.method === "OPTIONS") {
      if (cors === "deny") return send(response, 403, {}, "");
      return send(response, 204, base, "");
    }

    const special = handleSpecial(url, request, response, base, record);
    if (special) return;

    // The TestInbox contract, minimally. Magic inbox ids select behaviours
    // so the suites can drive every result state through a real operation.
    const inbox = url.pathname.match(/^\/v1\/inboxes\/([^/]+)$/);
    if (inbox !== null && inbox[1].startsWith("__")) {
      const behaviour = inbox[1].slice(2);
      if (behaviour === "delay") {
        setTimeout(() => json(response, 200, base, { delayed: true }), 20_000);
        return;
      }
      if (behaviour === "huge") {
        url.pathname = "/v1/__huge";
      } else if (behaviour === "redirect") {
        url.pathname = "/v1/__redirect";
      } else if (behaviour === "html") {
        url.pathname = "/v1/__html";
      } else if (behaviour === "binary") {
        url.pathname = "/v1/__binary";
      } else if (behaviour === "headers") {
        url.pathname = "/v1/__headers";
      } else if (behaviour === "echo") {
        url.pathname = "/v1/__echo";
      } else if (/^status-\d{3}$/.test(behaviour)) {
        url.pathname = `/v1/__status/${behaviour.slice(7)}`;
      }
      if (handleSpecial(url, request, response, base, record)) return;
      return json(response, 404, base, { title: "Unknown behaviour" });
    }
    if (url.pathname === "/v1/inboxes" && request.method === "GET") {
      return json(
        response,
        200,
        { ...base, "x-request-id": "req_fake_list" },
        {
          data: [
            {
              id: "inb_1",
              address: "one@sandbox.testinbox.email",
              createdAt: "2026-09-01T00:00:00Z",
            },
          ],
          nextCursor: null,
        },
      );
    }
    if (url.pathname === "/v1/inboxes" && request.method === "POST") {
      let parsed;
      try {
        parsed = JSON.parse(body.toString("utf8") || "{}");
      } catch {
        return json(
          response,
          400,
          { ...base, "content-type": "application/problem+json" },
          { title: "Body is not JSON" },
        );
      }
      return json(response, 201, base, {
        id: "inb_created",
        address: "created@sandbox.testinbox.email",
        label: parsed.label ?? null,
      });
    }
    if (inbox !== null && request.method === "GET") {
      if (inbox[1] === "missing") {
        return json(
          response,
          404,
          { ...base, "content-type": "application/problem+json" },
          { title: "Inbox not found", status: 404 },
        );
      }
      return json(response, 200, base, {
        id: inbox[1],
        address: `${inbox[1]}@sandbox.testinbox.email`,
      });
    }
    if (inbox !== null && request.method === "DELETE")
      return send(response, 204, base, "");
    return json(response, 200, base, {
      method: request.method,
      ok: true,
      path: url.pathname,
    });
  });
});

/** Behaviours the suites exercise; returns true when the request was answered. */
function handleSpecial(url, request, response, base, record) {
  if (url.pathname === "/v1/__delay") {
    const ms = Math.min(60_000, Number(url.searchParams.get("ms") ?? "1000"));
    setTimeout(() => json(response, 200, base, { delayed: ms }), ms);
    return true;
  }
  if (url.pathname === "/v1/__huge") {
    const bytes = Math.min(
      64 * 1024 * 1024,
      Number(url.searchParams.get("bytes") ?? String(2 * 1024 * 1024)),
    );
    response.writeHead(200, {
      ...base,
      "content-type": "text/plain; charset=utf-8",
    });
    const chunk = Buffer.alloc(64 * 1024, "x");
    let written = 0;
    const pump = () => {
      while (written < bytes) {
        const slice = chunk.subarray(
          0,
          Math.min(chunk.length, bytes - written),
        );
        written += slice.length;
        if (!response.write(slice)) {
          response.once("drain", pump);
          return;
        }
      }
      response.end();
    };
    pump();
    return true;
  }
  if (url.pathname === "/v1/__redirect") {
    send(
      response,
      302,
      { ...base, location: `http://127.0.0.1:${port}/v1/__echo` },
      "",
    );
    return true;
  }
  if (url.pathname.startsWith("/v1/__status/")) {
    const status = Number(url.pathname.slice("/v1/__status/".length));
    if (status === 204) send(response, 204, base, "");
    else json(response, status, base, { status });
    return true;
  }
  if (url.pathname === "/v1/__html") {
    send(
      response,
      200,
      { ...base, "content-type": "text/html; charset=utf-8" },
      '<!doctype html><html><body><script>document.title="pwned";window.__pwned=true</script><img src=x onerror="window.__pwned=true"><h1>injected</h1></body></html>',
    );
    return true;
  }
  if (url.pathname === "/v1/__binary") {
    send(
      response,
      200,
      { ...base, "content-type": "application/octet-stream" },
      Buffer.from([0, 1, 2, 3, 255]),
    );
    return true;
  }
  if (url.pathname === "/v1/__headers") {
    const many = {};
    for (let index = 0; index < 80; index += 1)
      many[`x-many-${index}`] = `value-${index}`;
    json(
      response,
      200,
      {
        ...base,
        ...many,
        "set-cookie": "session=secret-cookie; Path=/; HttpOnly",
        "x-ratelimit-remaining": "41",
        "x-request-id": "req_fake_0001",
      },
      { ok: true },
    );
    return true;
  }
  if (url.pathname === "/v1/__echo") {
    json(response, 200, base, record);
    return true;
  }
  return false;
}

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `playground fake API (${cors}) on http://127.0.0.1:${port}\n`,
  );
});
