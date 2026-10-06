// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  parseDocumentationArtifact,
  type DocumentationArtifact,
} from "@specistry/model";
import { parsePlaygroundArtifact } from "@specistry/playground";
import { parseSnippetsArtifact } from "@specistry/snippets";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { axe } from "jest-axe";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CodeRail } from "../../apps/web/components/reader/code/code-rail";
import { OperationPage } from "../../apps/web/components/reader/operation-page";
import { RailModes } from "../../apps/web/components/reader/playground/rail-modes";
import TryIt from "../../apps/web/components/reader/playground/try-it";
import type {
  ReaderPlayground,
  ReaderSnippets,
} from "../../apps/web/lib/reader/artifact";
import {
  createCodeView,
  resetCodeViewCache,
} from "../../apps/web/lib/reader/code-view";
import { createOperationView } from "../../apps/web/lib/reader/operation-view";
import {
  createPlaygroundView,
  type PlaygroundView,
} from "../../apps/web/lib/reader/playground-view";
import {
  createReaderIndex,
  resolveRoute,
} from "../../apps/web/lib/reader/projection";

vi.mock("../../apps/web/components/reader/code/navigation", () => ({
  useReplaceUrl: () => vi.fn(),
}));

/**
 * SPEC-009 §71–§82, §119–§127: the Try it island in jsdom. Credentials
 * never reach storage, the URL, or the preview; Send issues exactly one
 * hardened fetch to the approved origin; the response renders as escaped
 * text; environment switching isolates credentials and clears results;
 * unsupported operations explain themselves; the server-rendered shape has
 * no dead control.
 */

const directory = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "reader",
  "testinbox",
  ".specistry",
  "artifacts",
);
const artifact: DocumentationArtifact = parseDocumentationArtifact(
  readFileSync(path.join(directory, "documentation.json"), "utf8"),
);
const snippetsText = readFileSync(
  path.join(directory, "snippets.json"),
  "utf8",
);
const snippets: ReaderSnippets = {
  artifact: parseSnippetsArtifact(snippetsText),
  sha256: createHash("sha256").update(snippetsText).digest("hex"),
};
const playgroundText = readFileSync(
  path.join(directory, "playground.json"),
  "utf8",
);
const playground: ReaderPlayground = {
  artifact: parsePlaygroundArtifact(playgroundText),
  origins: ["http://127.0.0.1:47391", "http://127.0.0.1:47392"],
  sha256: createHash("sha256").update(playgroundText).digest("hex"),
};
const index = createReaderIndex(artifact);

function operation(segments: readonly string[]) {
  const target = resolveRoute(index, artifact, segments);
  if (target?.kind !== "operation")
    throw new Error(`expected operation at ${segments.join("/")}`);
  return createOperationView(target);
}

function viewFor(segments: readonly string[]): PlaygroundView {
  const view = createPlaygroundView(playground, operation(segments));
  if (view === undefined) throw new Error("expected a playground view");
  return view;
}

function jsonResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

const SECRET = "canary-secret-7f3a9c";

beforeEach(() => {
  resetCodeViewCache();
  window.sessionStorage.clear();
  window.location.hash = "";
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("playground view", () => {
  it("is undefined when the policy is disabled or the operation is absent", () => {
    expect(
      createPlaygroundView(undefined, operation(["inboxes", "get-inbox"])),
    ).toBeUndefined();
    const disabled: ReaderPlayground = {
      ...playground,
      artifact: { ...playground.artifact, enabled: false },
    };
    expect(
      createPlaygroundView(disabled, operation(["inboxes", "get-inbox"])),
    ).toBeUndefined();
    const missing: ReaderPlayground = {
      ...playground,
      artifact: { ...playground.artifact, operations: {} },
    };
    expect(
      createPlaygroundView(missing, operation(["inboxes", "get-inbox"])),
    ).toBeUndefined();
  });

  it("carries the approved environments, the form, the limits, and explanations", () => {
    const view = viewFor(["webhooks", "create-webhook"]);
    expect(view.environments.map((environment) => environment.id)).toEqual([
      "local",
      "strict",
    ]);
    expect(view.form.method).toBe("POST");
    expect(view.limits.timeoutMs).toBe(5_000);
    expect(view.unsupported).toEqual([]);
    expect(view.unavailableAuth).toEqual([
      {
        label: "X-Api-Key header + Client certificate (mTLS)",
        reason:
          "This operation requires a client certificate (mutual TLS) that the Specistry playground does not manage.",
      },
    ]);
  });
});

describe("server-rendered shape", () => {
  it("renders only the Code heading without a playground and a tab control with one, and never a dead Try it", () => {
    const view = operation(["inboxes", "get-inbox"]);
    const code = createCodeView(snippets, view, {});
    if (code === undefined) throw new Error("code view expected");
    const without = renderToStaticMarkup(
      <OperationPage code={code} view={view} />,
    );
    expect(without).not.toContain("Try it");
    expect(without).toContain('id="code-heading"');
    const withPlayground = renderToStaticMarkup(
      <OperationPage
        code={code}
        playground={viewFor(["inboxes", "get-inbox"])}
        view={view}
      />,
    );
    // Server HTML: no tablist (it needs script), the mobile link is present
    // but hidden by the layout's noscript rule, and no credential field.
    expect(withPlayground).not.toContain('role="tablist"');
    expect(withPlayground).toContain(
      'class="button code-bar__action code-bar__try" href="#try-it"',
    );
    expect(withPlayground).not.toContain('type="password"');
    expect(withPlayground).not.toContain("47391");
  });

  it("renders the Code rail without a playground exactly as before", () => {
    const view = operation(["inboxes", "get-inbox"]);
    const code = createCodeView(snippets, view, {});
    if (code === undefined) throw new Error("code view expected");
    const markup = renderToStaticMarkup(
      <CodeRail action={view.summary.href} view={code} />,
    );
    expect(markup).toContain(
      '<h2 class="code-rail__title" id="code-heading">Code</h2>',
    );
    expect(markup).not.toContain('role="tablist"');
    expect(markup).not.toContain("Try it");
  });
});

describe("rail modes", () => {
  it("offers Code and Try it tabs, loads the island on first activation, and follows #try-it", async () => {
    const view = viewFor(["inboxes", "get-inbox"]);
    render(
      <RailModes
        code={<p>code panel</p>}
        eyebrow="Protocol"
        playground={view}
      />,
    );
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Code", "Try it"]);
    expect(screen.getByText("code panel")).toBeVisible();
    expect(screen.queryByRole("tabpanel", { name: "Try it" })).toBeNull();
    fireEvent.click(tabs[1]!);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("code panel")).not.toBeVisible();
    expect(
      await screen.findByRole("button", { name: "Send GET request" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(tabs[1]!, { key: "ArrowLeft" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("code panel")).toBeVisible();
    cleanup();

    window.location.hash = "#try-it";
    render(
      <RailModes
        code={<p>code panel</p>}
        eyebrow="Protocol"
        playground={view}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Try it" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
  });

  it("renders the plain heading without a playground", () => {
    render(<RailModes code={<p>code panel</p>} eyebrow="Protocol" />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("heading", { name: "Code" })).toBeInTheDocument();
  });
});

describe("Try it island", () => {
  it("sends one hardened request with the typed credential and renders the response as text", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        200,
        '{"id":"inb_42","html":"<img src=x onerror=alert(1)>"}',
        { "x-request-id": "req_1" },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <TryIt view={viewFor(["inboxes", "get-inbox"])} />,
    );
    const key = screen.getByLabelText("X-Api-Key header");
    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveAttribute("autocomplete", "off");
    fireEvent.change(key, { target: { value: SECRET } });
    fireEvent.change(screen.getByLabelText(/inboxId/), {
      target: { value: "inb_42" },
    });

    const preview = container.querySelector(".try-it__preview")!;
    expect(preview.textContent).toContain(
      "GET http://127.0.0.1:47391/v1/inboxes/inb_42",
    );
    expect(preview.textContent).toContain("X-Api-Key: ••••••••");
    expect(preview.textContent).not.toContain(SECRET);

    fireEvent.click(screen.getByRole("button", { name: "Send GET request" }));
    await screen.findByText(/^200\b/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://127.0.0.1:47391/v1/inboxes/inb_42");
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      method: "GET",
      mode: "cors",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(init.headers).toEqual([["X-Api-Key", SECRET]]);

    const response = container.querySelector(".try-it__response")!;
    expect(response.querySelector("img")).toBeNull();
    expect(response.textContent).toContain(
      '"html": "<img src=x onerror=alert(1)>"',
    );
    expect(
      within(response as HTMLElement).getByText("Headers (2)"),
    ).toBeInTheDocument();
    expect(response.textContent).not.toContain(SECRET);

    // The credential never reaches storage, the URL, or any element but its input.
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(SECRET);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(SECRET);
    expect(window.location.href).not.toContain(SECRET);
    expect(document.cookie).not.toContain(SECRET);
    expect(container.querySelector(".try-it__announcer")?.textContent).toMatch(
      /Request complete\. 200/,
    );
    expect((await axe(container)).violations).toEqual([]);
  });

  it("blocks Send on validation errors, addresses them to fields, and does not fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<TryIt view={viewFor(["inboxes", "get-inbox"])} />);
    fireEvent.click(screen.getByRole("button", { name: "Send GET request" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("X-Api-Key header is required."),
    ).toBeInTheDocument();
    expect(screen.getByText("inboxId is required.")).toBeInTheDocument();
    expect(screen.getByLabelText("X-Api-Key header")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("isolates credentials per environment, clears the result on switch, and remembers only the environment id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, "{}")),
    );
    const { container } = render(
      <TryIt view={viewFor(["inboxes", "get-inbox"])} />,
    );
    fireEvent.change(screen.getByLabelText("X-Api-Key header"), {
      target: { value: SECRET },
    });
    fireEvent.change(screen.getByLabelText(/inboxId/), {
      target: { value: "inb_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send GET request" }));
    await screen.findByText(/^200\b/);
    fireEvent.change(screen.getByLabelText("Environment"), {
      target: { value: "strict" },
    });
    expect(
      window.sessionStorage.getItem("specistry:playground-environment"),
    ).toBe("strict");
    expect(container.querySelector(".try-it__response")).toBeNull();
    expect(
      (screen.getByLabelText("X-Api-Key header") as HTMLInputElement).value,
    ).toBe("");
    expect(
      container.querySelector(".try-it__destination")?.textContent,
    ).toContain("http://127.0.0.1:47392");
    fireEvent.change(screen.getByLabelText("Environment"), {
      target: { value: "local" },
    });
    expect(
      (screen.getByLabelText("X-Api-Key header") as HTMLInputElement).value,
    ).toBe(SECRET);
    fireEvent.click(screen.getByRole("button", { name: "Clear credentials" }));
    expect(
      (screen.getByLabelText("X-Api-Key header") as HTMLInputElement).value,
    ).toBe("");
  });

  it("restores a remembered environment and ignores an unknown one", () => {
    window.sessionStorage.setItem("specistry:playground-environment", "strict");
    const first = render(<TryIt view={viewFor(["inboxes", "get-inbox"])} />);
    expect(
      (screen.getByLabelText("Environment") as HTMLSelectElement).value,
    ).toBe("strict");
    first.unmount();
    window.sessionStorage.setItem(
      "specistry:playground-environment",
      "production",
    );
    render(<TryIt view={viewFor(["inboxes", "get-inbox"])} />);
    expect(
      (screen.getByLabelText("Environment") as HTMLSelectElement).value,
    ).toBe("local");
  });

  it("shows the blocked redirect, timeout, cancel, network, and partial states", async () => {
    const view = viewFor(["inboxes", "get-inbox"]);
    const fill = () => {
      fireEvent.change(screen.getByLabelText("X-Api-Key header"), {
        target: { value: SECRET },
      });
      fireEvent.change(screen.getByLabelText(/inboxId/), {
        target: { value: "inb_1" },
      });
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            headers: new Headers(),
            status: 0,
            statusText: "",
            type: "opaqueredirect",
          }) as unknown as Response,
      ),
    );
    render(<TryIt view={view} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send GET request" }));
    expect(await screen.findByText("Redirect blocked")).toBeInTheDocument();
    cleanup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<TryIt view={view} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send GET request" }));
    expect(await screen.findByText("Request failed")).toBeInTheDocument();
    expect(screen.getAllByText(/CORS/).length).toBeGreaterThan(0);
    cleanup();

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            ),
          ),
      ),
    );
    render(<TryIt view={view} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send GET request" }));
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    cleanup();

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x".repeat(600_000), {
            headers: { "content-type": "text/plain" },
            status: 200,
          }),
      ),
    );
    render(<TryIt view={view} />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Send GET request" }));
    expect(
      await screen.findByText(/exceeded the playground display limit/),
    ).toBeInTheDocument();
    expect(screen.getByText("text/plain · partial")).toBeInTheDocument();
  });

  it("explains an unsupported operation instead of rendering a form", () => {
    const view = viewFor(["inboxes", "get-inbox"]);
    const unsupported: PlaygroundView = {
      ...view,
      form: {
        ...view.form,
        capability: { reasons: ["cookie-parameter"], state: "unsupported" },
      },
      unsupported: [
        "This request requires a Cookie header, which browser JavaScript cannot set.",
      ],
    };
    render(<TryIt view={unsupported} />);
    expect(
      screen.getByText("This operation cannot be executed from the browser."),
    ).toBeInTheDocument();
    expect(screen.getByText(/requires a Cookie header/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Send/ })).toBeNull();
  });

  it("offers only browser-usable alternatives and explains the rest", () => {
    render(<TryIt view={viewFor(["webhooks", "create-webhook"])} />);
    expect(screen.queryByLabelText("Authentication method")).toBeNull();
    expect(screen.getByLabelText("OAuth 2.0 access token")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.getByText(/client certificate \(mutual TLS\)/),
    ).toBeInTheDocument();
    expect(screen.getByText("Scopes: webhooks:write")).toBeInTheDocument();
  });

  it("edits JSON and form bodies and sends the chosen representation", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, '{"id":"inb_created"}'),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<TryIt view={viewFor(["inboxes", "create-inbox"])} />);
    fireEvent.change(screen.getByLabelText("X-Api-Key header"), {
      target: { value: SECRET },
    });
    const body = screen.getByLabelText("Body");
    fireEvent.change(body, { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Send POST request" }));
    expect(screen.getByText("The body is not valid JSON.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(body, { target: { value: '{"label":"ci"}' } });
    fireEvent.click(screen.getByRole("button", { name: "Send POST request" }));
    await screen.findByText(/^201\b/);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.body).toBe('{"label":"ci"}');
    expect(init.headers).toEqual([
      ["X-Api-Key", SECRET],
      ["Content-Type", "application/json"],
    ]);

    fireEvent.change(screen.getByLabelText("Body format"), {
      target: { value: "application/x-www-form-urlencoded" },
    });
    fireEvent.change(screen.getByLabelText(/^name/), {
      target: { value: "a b" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send POST request" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, second] = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(second.body).toContain("name=a%20b");
  });

  it("ignores a late result from a superseded request", async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(async () =>
        jsonResponse(200, '{"which":"second"}'),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <TryIt view={viewFor(["inboxes", "get-inbox"])} />,
    );
    fireEvent.change(screen.getByLabelText("X-Api-Key header"), {
      target: { value: SECRET },
    });
    fireEvent.change(screen.getByLabelText(/inboxId/), {
      target: { value: "inb_1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send GET request" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("Cancelled");
    fireEvent.click(screen.getByRole("button", { name: "Send GET request" }));
    await screen.findByText(/"which": "second"/);
    await act(async () => {
      resolveFirst?.(jsonResponse(200, '{"which":"first"}'));
    });
    expect(container.querySelector(".try-it__response")!.textContent).toContain(
      '"which": "second"',
    );
    expect(
      container.querySelector(".try-it__response")!.textContent,
    ).not.toContain("first");
  });
});
