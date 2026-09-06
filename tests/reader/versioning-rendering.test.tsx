// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import path from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChangelogPage } from "../../apps/web/components/reader/changelog-page";
import { DocsPage } from "../../apps/web/components/reader/content/docs-page";
import { OperationPage } from "../../apps/web/components/reader/operation-page";
import { Shell } from "../../apps/web/components/reader/shell";
import {
  VersionBanner,
  VersionMenu,
} from "../../apps/web/components/reader/versioning";
import { resetReaderArtifactCache } from "../../apps/web/lib/reader/artifact";
import { findPage } from "../../apps/web/lib/reader/content";
import {
  createCodeView,
  resetCodeViewCache,
} from "../../apps/web/lib/reader/code-view";
import { createOperationView } from "../../apps/web/lib/reader/operation-view";
import { createPlaygroundView } from "../../apps/web/lib/reader/playground-view";
import { resolveRoute } from "../../apps/web/lib/reader/projection";
import {
  loadReaderRelease,
  loadReleaseMetadata,
  resetReleaseCaches,
  versionSwitchTargets,
} from "../../apps/web/lib/reader/release";

vi.mock("../../apps/web/components/reader/code/navigation", () => ({
  useReplaceUrl: () => vi.fn(),
}));

/**
 * Version chrome and versioned pages in jsdom (SPEC-010 §29–§34, §40–§43,
 * §47–§52, §90–§92, §140–§142): the selector names every release with its
 * state as text and links to counterparts, the banner is text with a link,
 * historical pages keep their own navigation, examples, and SDK text with
 * no Try it, the changelog renders the author's entries, and the whole
 * shell stays axe-clean.
 */

const fixture = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "reader",
  "versioned",
);

beforeEach(() => {
  resetReleaseCaches();
  resetReaderArtifactCache();
  resetCodeViewCache();
});
afterEach(cleanup);

describe("version menu and banner", () => {
  it("lists releases newest first with text states and counterpart links", async () => {
    const v1 = await loadReaderRelease("v1", fixture);
    const targets = await versionSwitchTargets(
      "/docs/v1/authentication",
      "v1",
      fixture,
    );
    const { container } = render(
      <VersionMenu targets={targets} version={v1.version!} />,
    );
    const summary = screen
      .getByText("1.0", { selector: ".version-menu__label" })
      .closest("summary")!;
    expect(summary).toHaveAttribute(
      "aria-label",
      "Documentation version: 1.0, deprecated. Change version",
    );
    const links = within(container).getAllByRole("link");
    expect(
      links.map((link) => [link.getAttribute("href"), link.textContent]),
    ).toEqual([
      ["/docs/v2/authentication", "2.0CurrentCurrent"],
      ["/docs/v1/authentication", "1.0DeprecatedDeprecated"],
    ]);
    expect(links[1]).toHaveAttribute("aria-current", "page");
    expect(container.querySelector("script")).toBeNull();
  });

  it("says when a switch opens the release home instead of a counterpart", async () => {
    const v1 = await loadReaderRelease("v1", fixture);
    const targets = await versionSwitchTargets(
      "/api/v1/inboxes/get-raw-message",
      "v1",
      fixture,
    );
    render(<VersionMenu targets={targets} version={v1.version!} />);
    expect(screen.getByText(/opens the release home/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /2\.0/ })).toHaveAttribute(
      "href",
      "/docs/v2",
    );
  });

  it("renders a chip, not a menu, for a single release", async () => {
    const v2 = await loadReaderRelease("v2", fixture);
    const single = {
      ...v2.version!,
      catalog: v2.version!.catalog.filter((entry) => entry.id === "v2"),
    };
    const { container } = render(<VersionMenu targets={[]} version={single} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("2.0")).toHaveClass("version-chip");
  });

  it("explains a historical or deprecated version with a link and no alert role", async () => {
    const v1 = await loadReaderRelease("v1", fixture);
    const v2 = await loadReaderRelease("v2", fixture);
    const { container } = render(
      <VersionBanner
        currentHref="/docs/v2/authentication"
        version={v1.version!}
      />,
    );
    expect(container.querySelector("[role=alert]")).toBeNull();
    expect(
      screen.getByLabelText("Documentation version notice"),
    ).toHaveTextContent("1.0 is deprecated. The current documentation is 2.0.");
    expect(
      screen.getByRole("link", { name: "Open the current version" }),
    ).toHaveAttribute("href", "/docs/v2/authentication");
    cleanup();
    const supported = { ...v1.version!, state: "supported" as const };
    render(<VersionBanner currentHref="/docs/v2" version={supported} />);
    expect(
      screen.getByLabelText("Documentation version notice"),
    ).toHaveTextContent(
      "You’re viewing 1.0. The current documentation is 2.0.",
    );
    cleanup();
    expect(
      renderToStaticMarkup(
        <VersionBanner currentHref="/docs/v2" version={v2.version!} />,
      ),
    ).toBe("");
  });
});

describe("versioned shell", () => {
  it("keeps tabs, sidebar, banner, and changelog link inside the release", async () => {
    const v1 = await loadReaderRelease("v1", fixture);
    const v2 = await loadReaderRelease("v2", fixture);
    const targets = await versionSwitchTargets(
      "/docs/v1/getting-started",
      "v1",
      fixture,
    );
    const { container } = render(
      <Shell
        content={v1.content}
        currentPath="/docs/v1/getting-started"
        index={v1.index}
        mode="system"
        roots={v1.roots}
        searchPath={v1.search?.path}
        version={v1.version}
        versionTargets={targets}
      >
        <p>page</p>
      </Shell>,
    );
    const tabs = within(
      screen.getByRole("navigation", { name: "Primary" }),
    ).getAllByRole("link");
    expect(
      tabs.map((tab) => [tab.textContent, tab.getAttribute("href")]),
    ).toEqual([
      ["Guides", "/docs/v1"],
      ["API reference", "/api/v1"],
    ]);
    const sidebar = screen.getByRole("navigation", { name: "Documentation" });
    expect(
      within(sidebar)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/docs/v1/getting-started",
      "/docs/v1/authentication",
      "/api/v1",
      "/api/v1/inboxes",
      "/api/v1/inboxes/list-inboxes",
      "/api/v1/inboxes/create-inbox",
      "/api/v1/inboxes/get-raw-message",
    ]);
    expect(
      within(sidebar).getByRole("link", { name: "Getting started" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByLabelText("Documentation version notice"),
    ).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(
      /href="\/docs\/v2\/getting-started"|href="\/api\/v2/,
    );
    expect(container.innerHTML).toContain('href="/docs/v2"');
    expect(await axe(container)).toHaveProperty("violations", []);
    cleanup();

    const currentTargets = await versionSwitchTargets(
      "/docs/v2/quickstart",
      "v2",
      fixture,
    );
    render(
      <Shell
        content={v2.content}
        currentPath="/docs/v2/quickstart"
        index={v2.index}
        mode="system"
        roots={v2.roots}
        searchPath={v2.search?.path}
        version={v2.version}
        versionTargets={currentTargets}
      >
        <p>page</p>
      </Shell>,
    );
    const currentTabs = within(
      screen.getByRole("navigation", { name: "Primary" }),
    ).getAllByRole("link");
    expect(
      currentTabs.map((tab) => [tab.textContent, tab.getAttribute("href")]),
    ).toEqual([
      ["Guides", "/docs/v2"],
      ["API reference", "/api/v2"],
      ["Changelog", "/docs/v2/changelog"],
    ]);
    expect(screen.queryByLabelText("Documentation version notice")).toBeNull();
  });

  it("renders an unversioned candidate shell exactly as before", async () => {
    const testinbox = path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "reader",
      "testinbox",
    );
    const { loadReaderArtifact } =
      await import("../../apps/web/lib/reader/artifact");
    const reader = await loadReaderArtifact(testinbox);
    render(
      <Shell
        content={reader.content}
        currentPath="/docs/authentication"
        index={reader.index}
        mode="system"
        searchPath={reader.search?.path}
      >
        <p>page</p>
      </Shell>,
    );
    const tabs = within(
      screen.getByRole("navigation", { name: "Primary" }),
    ).getAllByRole("link");
    expect(tabs.map((tab) => tab.getAttribute("href"))).toEqual(["/", "/api"]);
    expect(screen.queryByText("Change version")).toBeNull();
    expect(
      document.querySelector(".version-chip, .version-menu, .version-banner"),
    ).toBeNull();
  });
});

describe("historical pages", () => {
  it("renders v1 examples, SDK text, and schemas with no Try it and a note", async () => {
    const v1 = await loadReaderRelease("v1", fixture);
    const target = resolveRoute(v1.index, v1.artifact, [
      "inboxes",
      "get-raw-message",
    ]);
    if (target?.kind !== "operation") throw new Error("expected operation");
    const view = createOperationView(target);
    const code = createCodeView(v1.snippets!, view, {});
    const markup = renderToStaticMarkup(
      <OperationPage
        apiRoot={v1.index.apiRoot}
        code={code}
        historical={{ currentHref: "/docs/v2", currentLabel: "2.0" }}
        playground={undefined}
        view={view}
      />,
    );
    expect(markup).toContain("https://api.versioned.test/v1/inboxes/");
    expect(markup).not.toContain("api.versioned.test/v2");
    expect(markup).toContain(
      "Try it is available on the current version only.",
    );
    expect(markup).not.toContain('role="tablist"');
    expect(markup).toContain('href="/api/v1"');
    // The current release keeps its policy and the Try it link.
    const v2 = await loadReaderRelease("v2", fixture);
    const created = resolveRoute(v2.index, v2.artifact, [
      "inboxes",
      "create-inbox",
    ]);
    if (created?.kind !== "operation") throw new Error("expected operation");
    const currentView = createOperationView(created);
    const playground = createPlaygroundView(v2.playground, currentView);
    expect(
      playground?.environments.map((environment) => environment.origin),
    ).toEqual(["http://127.0.0.1:47393"]);
    const currentMarkup = renderToStaticMarkup(
      <OperationPage
        apiRoot={v2.index.apiRoot}
        code={createCodeView(v2.snippets!, currentView, {})}
        playground={playground}
        view={currentView}
      />,
    );
    expect(currentMarkup).toContain('href="#try-it"');
    expect(currentMarkup).toContain("VERSIONED_TOKEN");
    expect(markup).not.toContain("VERSIONED_TOKEN");
  });

  it("renders a v1 page with v1 links, breadcrumbs, and neighbours", async () => {
    const v1 = await loadReaderRelease("v1", fixture);
    const page = findPage(v1.content, "/docs/v1/getting-started")!;
    const { container } = render(
      <DocsPage content={v1.content!} page={page} />,
    );
    const hrefs = [...container.querySelectorAll("a")].map((anchor) =>
      anchor.getAttribute("href"),
    );
    expect(hrefs).toContain("/api/v1/inboxes/create-inbox");
    expect(hrefs).toContain("/docs/v1/authentication");
    expect(hrefs).toContain("/docs/v1");
    expect(
      hrefs.some(
        (href) =>
          href?.startsWith("/docs/v2") ||
          href?.startsWith("/api/v2") ||
          href === "/" ||
          href?.startsWith("/api/inboxes"),
      ),
    ).toBe(false);
  });
});

describe("changelog page", () => {
  it("renders the author's entries as semantic lists with versioned operation links", async () => {
    const v2 = await loadReaderRelease("v2", fixture);
    const meta = await loadReleaseMetadata("v2", fixture);
    const { container } = render(
      <ChangelogPage
        changelog={meta.changelog!}
        roots={v2.roots}
        version={v2.version!}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Changelog",
    );
    expect(
      container.querySelectorAll("ol.changelog__entries > li"),
    ).toHaveLength(2);
    expect(screen.getByText("September 5, 2026")).toHaveAttribute(
      "datetime",
      "2026-09-05",
    );
    const added = screen.getByText(
      "Wait synchronously for an incoming message. Replaces client-side polling; available in all SDKs as messages.wait().",
    );
    const item = added.closest("li")!;
    expect(within(item).getByText("Added")).toBeInTheDocument();
    expect(within(item).getByRole("link")).toHaveAttribute(
      "href",
      "/api/v2/inboxes/wait-for-message",
    );
    const removed = screen
      .getByText("Use Message.headers and content instead. Removed in v2.")
      .closest("li")!;
    expect(within(removed).queryByRole("link")).toBeNull();
    expect(within(removed).getByText("Removed")).toBeInTheDocument();
    expect(screen.getByText("Inbox.expiresAt")).toHaveClass(
      "changelog__target",
    );
    expect(container.innerHTML).not.toMatch(/We've|streamlined/);
    expect(container.querySelector("script")).toBeNull();
    expect(await axe(container)).toHaveProperty("violations", []);
  });
});
