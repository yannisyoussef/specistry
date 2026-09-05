// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  parseDocumentationArtifact,
  type DocumentationArtifact,
} from "@specra/model";
import { cleanup, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  GroupPage,
  HomePage,
  ReferencePage,
  ServicePage,
} from "../../apps/web/components/reader/list-pages";
import { OperationPage } from "../../apps/web/components/reader/operation-page";
import { Shell } from "../../apps/web/components/reader/shell";
import { createOperationView } from "../../apps/web/lib/reader/operation-view";
import {
  createReaderIndex,
  resolveRoute,
  type ReaderIndex,
} from "../../apps/web/lib/reader/projection";

// jsdom rewrites `import.meta.url`, so resolve fixtures from the repository root.
const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "reader");

function loadArtifact(name: string): DocumentationArtifact {
  return parseDocumentationArtifact(
    readFileSync(
      path.join(
        fixtureRoot,
        name,
        ".specra",
        "artifacts",
        "documentation.json",
      ),
      "utf8",
    ),
  );
}

const testinbox = loadArtifact("testinbox");
const edge = loadArtifact("edge");
const multi = loadArtifact("multi");

afterEach(cleanup);

function operationView(
  artifact: DocumentationArtifact,
  index: ReaderIndex,
  segments: readonly string[],
) {
  const target = resolveRoute(index, artifact, segments);
  if (target?.kind !== "operation")
    throw new Error(`expected operation at ${segments.join("/")}`);
  return createOperationView(target);
}

describe("operation page", () => {
  const index = createReaderIndex(testinbox);

  it("renders method, path, auth alternatives, grouped parameters, bodies, and responses", async () => {
    const view = operationView(testinbox, index, ["inboxes", "create-inbox"]);
    const { container } = render(<OperationPage view={view} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Create inbox" }),
    ).toBeDefined();
    const endpoint = container.querySelector(".endpoint-line");
    expect(endpoint?.textContent).toContain("POST");
    expect(endpoint?.textContent).toContain("/inboxes");
    expect(
      screen.getByRole("button", { name: "Copy POST /inboxes" }),
    ).toBeDefined();

    const auth = screen.getByRole("region", { name: "Authentication" });
    expect(auth.textContent).toContain("API key (apiKey)");
    expect(within(auth).getByText("or")).toBeDefined();
    expect(auth.textContent).toContain("Bearer token (bearer)");

    const parameters = screen.getByRole("region", { name: "Parameters" });
    expect(
      within(parameters).getByRole("heading", {
        level: 3,
        name: "Header parameters",
      }),
    ).toBeDefined();
    expect(parameters.textContent).toContain("Idempotency-Key");
    expect(parameters.textContent).toContain("optional");
    expect(parameters.textContent).toContain("max 64 chars");

    const body = screen.getByRole("region", { name: "Request body" });
    expect(body.textContent).toContain("application/json");
    expect(body.textContent).toContain("application/x-www-form-urlencoded");
    expect(body.textContent).toContain("default 3600 · min 60 · max 86400");
    expect(within(body).getAllByRole("figure")).toHaveLength(2);
    expect(body.querySelector(".example__code")?.textContent).toContain("{");

    const responses = screen.getByRole("region", { name: "Responses" });
    expect(responses.textContent).toContain("201 Created");
    expect(responses.textContent).toContain("409 Conflict");
    expect(
      within(responses).getAllByRole("list", { name: "Response headers" })[0]
        ?.textContent,
    ).toContain("Location");
    expect(container.querySelector("#response-201")).not.toBeNull();
    expect(
      container.querySelector("#request-body-application-json"),
    ).not.toBeNull();
    expect(container.querySelector("#parameters-header")).not.toBeNull();
    expect((await axe(container)).violations).toEqual([]);
  });

  it("shows AND requirements, scopes, and body-less responses honestly", () => {
    const view = operationView(testinbox, index, [
      "webhooks",
      "create-webhook",
    ]);
    render(<OperationPage view={view} />);
    const auth = screen.getByRole("region", { name: "Authentication" });
    expect(within(auth).getByText("and")).toBeDefined();
    expect(auth.textContent).toContain("Mutual TLS (mtls)");
    expect(
      within(auth).getByRole("list", { name: "Required scopes" }).textContent,
    ).toContain("webhooks:write");

    cleanup();
    const remove = operationView(testinbox, index, [
      "webhooks",
      "delete-webhook",
    ]);
    const { container } = render(<OperationPage view={remove} />);
    expect(container.querySelector("#response-204")?.textContent).toContain(
      "No response body",
    );
    expect(container.querySelector("#response-204")?.textContent).not.toContain(
      "{}",
    );
  });

  it("renders every hostile string as inert text", () => {
    const edgeIndex = createReaderIndex(edge);
    const view = operationView(edge, edgeIndex, [
      "operations",
      "legacy-lookup",
    ]);
    const html = renderToStaticMarkup(<OperationPage view={view} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>bold?</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/href="javascript:/);
    expect(html).toContain("javascript:alert(1)");
    const { container } = render(<OperationPage view={view} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("a[href^='javascript']")).toBeNull();
    expect(screen.getByText("Deprecated")).toBeDefined();
    expect(
      container.querySelector(".endpoint-line__path--deprecated"),
    ).not.toBeNull();
    expect(screen.getByRole("note").textContent).toContain("Deprecated.");
  });

  it("keeps section deep links and response order deterministic on the edge fixture", () => {
    const edgeIndex = createReaderIndex(edge);
    const view = operationView(edge, edgeIndex, [
      "operations",
      "many-responses",
    ]);
    const { container } = render(<OperationPage view={view} />);
    const anchors = [...container.querySelectorAll(".response")].map(
      (node) => node.id,
    );
    expect(anchors).toEqual([
      "response-102",
      "response-200",
      "response-204",
      "response-301",
      "response-404",
      "response-500",
      "response-1xx",
      "response-2xx",
      "response-5xx",
      "response-default",
    ]);
    cleanup();
    const anonymous = operationView(edge, edgeIndex, [
      "operations",
      "auth-alternatives",
    ]);
    render(<OperationPage view={anonymous} />);
    expect(
      screen.getByText("No authentication (anonymous access is allowed)."),
    ).toBeDefined();
  });
});

describe("shell and list pages", () => {
  const index = createReaderIndex(testinbox);

  it("renders landmarks, skip link, primary tabs, and the current operation once", async () => {
    const view = operationView(testinbox, index, ["inboxes", "create-inbox"]);
    const { container } = render(
      <Shell currentPath={view.summary.href} index={index} mode="system">
        <OperationPage view={view} />
      </Shell>,
    );
    expect(
      screen
        .getByRole("link", { name: "Skip to content" })
        .getAttribute("href"),
    ).toBe("#content");
    expect(screen.getByRole("banner")).toBeDefined();
    expect(screen.getByRole("main")).toBeDefined();
    expect(screen.getByRole("contentinfo")).toBeDefined();
    expect(
      screen.getByRole("complementary", { name: "API navigation" }),
    ).toBeDefined();
    expect(
      screen.getByRole("navigation", { name: "Primary" }).textContent,
    ).toContain("API reference");
    // The navigation is rendered exactly once, in the sidebar; the mobile
    // drawer clones it on open. Exactly one item is current.
    const aside = screen.getByRole("complementary", { name: "API navigation" });
    const current = aside.querySelectorAll('.nav-item[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain("Create inbox");
    expect(
      container.querySelectorAll('.nav-item[aria-current="page"]'),
    ).toHaveLength(1);
    expect(container.querySelectorAll("#api-navigation")).toHaveLength(1);
    // Without JavaScript the menu control links to the sidebar region.
    expect(
      screen.getByRole("link", { name: "Navigation" }).getAttribute("href"),
    ).toBe("#api-sidebar-region");
    expect(screen.getByRole("group", { name: "Theme" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "System", pressed: true }),
    ).toBeDefined();
    expect((await axe(container)).violations).toEqual([]);
  });

  it("renders home, reference, and group pages from the index without axe violations", async () => {
    const home = render(<HomePage index={index} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "TestInbox API" }),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "API reference" }).getAttribute("href"),
    ).toBe("/api");
    expect((await axe(home.container)).violations).toEqual([]);
    home.unmount();

    const reference = render(<ReferencePage index={index} />);
    expect(
      screen.getByRole("heading", { level: 1, name: "API reference" }),
    ).toBeDefined();
    expect(screen.getAllByRole("link", { name: /Create inbox/ })).toHaveLength(
      1,
    );
    expect((await axe(reference.container)).violations).toEqual([]);
    reference.unmount();

    const service = index.services[0];
    const group = service?.groups.find((entry) => entry.slug === "messages");
    if (service === undefined || group === undefined) throw new Error("group");
    const page = render(
      <GroupPage group={group} service={service} singleService />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Messages" }),
    ).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: /Wait for message/ })
        .getAttribute("href"),
    ).toBe("/api/inboxes/wait-for-message");
    expect((await axe(page.container)).violations).toEqual([]);
  });

  it("keeps the navigation static and compact for hundreds of operations", () => {
    const large = syntheticIndex(600, 30);
    const html = renderToStaticMarkup(
      <Shell currentPath="/api" index={large} mode="system">
        <ReferencePage index={large} />
      </Shell>,
    );
    // Above the collapse threshold only the current group lists operations;
    // on the index no group is current, so the sidebar is groups only.
    expect(html.match(/class="nav-item[" ]/g)).toBeNull();
    expect(html.match(/nav-group--compact/g)?.length).toBe(30);
    expect(html).not.toContain("onclick");
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(600 * 400 + 60_000);
    const first = large.services[0]?.groups[0]?.operations[0];
    if (first === undefined) throw new Error("operation");
    const onOperation = renderToStaticMarkup(
      <Shell currentPath={first.href} index={large} mode="system">
        <ReferencePage index={large} />
      </Shell>,
    );
    expect(onOperation.match(/class="nav-item[" ]/g)?.length).toBe(20);
    expect(onOperation.match(/nav-group--compact/g)?.length).toBe(29);
  });

  it("renders service headings and service-prefixed routes for a multi-service contract", async () => {
    const multiIndex = createReaderIndex(multi);
    const target = resolveRoute(multiIndex, multi, ["billing-api"]);
    if (target?.kind !== "service") throw new Error("service");
    const { container } = render(
      <Shell currentPath={target.service.href} index={multiIndex} mode="dark">
        <ServicePage
          operationCount={multiIndex.operationCount}
          service={target.service}
        />
      </Shell>,
    );
    const aside = screen.getByRole("complementary", { name: "API navigation" });
    expect(
      within(aside)
        .getAllByRole("link", { name: "Users" })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/api/accounts-api/users", "/api/billing-api/users"]);
    expect(
      within(aside)
        .getByRole("link", { name: "Billing API" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("heading", { level: 1, name: "Billing API" }),
    ).toBeDefined();
    expect(
      within(screen.getByRole("main"))
        .getByRole("link", { name: /List billing contacts/ })
        .getAttribute("href"),
    ).toBe("/api/billing-api/users/list-users");
    expect((await axe(container)).violations).toEqual([]);
  });
});

function syntheticIndex(count: number, groups: number): ReaderIndex {
  const base = testinbox.model.versions[0]?.services[0];
  if (base === undefined) throw new Error("service");
  return createReaderIndex({
    diagnostics: [],
    model: {
      ...testinbox.model,
      versions: [
        {
          ...testinbox.model.versions[0]!,
          services: [
            {
              ...base,
              operations: Array.from({ length: count }, (_, i) => ({
                deprecated: false,
                extensions: {},
                id: `op${i}` as (typeof base.operations)[number]["id"],
                method: "GET" as const,
                parameters: [],
                path: `/items/${i}`,
                responses: [
                  {
                    bodies: [],
                    description: "ok",
                    headers: [],
                    status: { code: 200, kind: "code" as const },
                  },
                ],
                security: [],
                serverIds: [],
                tags: [`Group ${i % groups}`],
                title: `Operation ${i}`,
              })),
            },
          ],
        },
      ],
    },
  });
}
