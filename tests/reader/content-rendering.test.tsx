// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  parseContentArtifact,
  parseNavigationArtifact,
  type ContentPage,
} from "@specra/content";
import {
  parseArtifactManifest,
  parseDocumentationArtifact,
} from "@specra/model";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { axe } from "jest-axe";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { ContentBlocks } from "../../apps/web/components/reader/content/content-renderer";
import { DocsPage } from "../../apps/web/components/reader/content/docs-page";
import { Tabs } from "../../apps/web/components/reader/content/tabs";
import { Shell } from "../../apps/web/components/reader/shell";
import {
  createReaderContent,
  pageBreadcrumbs,
  pageNeighbours,
  pageOutline,
  sidebarNodes,
} from "../../apps/web/lib/reader/content";
import {
  indexablePaths,
  pageMetadata,
} from "../../apps/web/lib/reader/metadata";
import { createReaderIndex } from "../../apps/web/lib/reader/projection";

/**
 * Authored content rendering (SPEC-006) against the committed TestInbox
 * artifacts: the page frame (breadcrumbs, outline, pager), every component,
 * the composed navigation, and the no-JavaScript shape of tabs. Assertions
 * are semantic and every rendered tree passes axe.
 */

const fixture = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "reader",
  "testinbox",
  ".specra",
  "artifacts",
);
const read = (name: string) => readFileSync(path.join(fixture, name), "utf8");
const manifest = parseArtifactManifest(read("manifest.json"));
const artifact = parseDocumentationArtifact(read("documentation.json"));
const content = createReaderContent(
  parseContentArtifact(read("content.json")).pages,
  parseNavigationArtifact(read("navigation.json")),
  manifest.branding,
);
const index = createReaderIndex(artifact);

function page(route: string): ContentPage {
  const found = content.pages.get(route);
  if (found === undefined) throw new Error(`missing fixture page ${route}`);
  return found;
}

afterEach(cleanup);

describe("authored page frame", () => {
  it("renders the homepage hero, install block, start-here list, and workflow strip", async () => {
    const home = page("/");
    const { container } = render(<DocsPage content={content} page={home} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Email testing built for automation.");
    expect(heading.className).toContain("display");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).toBeNull();
    expect(
      screen.queryByRole("navigation", { name: "On this page" }),
    ).toBeNull();
    // Hero: eyebrow, lede, ink + outline actions, media beside the copy.
    const hero = container.querySelector("header.hero--media");
    expect(hero?.querySelector(".hero__eyebrow")?.textContent).toBe(
      "TestInbox · v1",
    );
    expect(hero?.querySelector(".hero__lede")?.textContent).toContain(
      "Create disposable inboxes",
    );
    const primary = within(hero as HTMLElement).getByRole("link", {
      name: "Get started",
    });
    expect(primary.getAttribute("href")).toBe("/docs/quickstart");
    expect(primary.className).toContain("button--primary");
    const secondary = within(hero as HTMLElement).getByRole("link", {
      name: "API reference",
    });
    expect(secondary.getAttribute("href")).toBe("/api");
    expect(secondary.className).toContain("button--secondary");
    const media = hero?.querySelector("figure.media");
    expect(
      media?.querySelector("img.media__poster")?.getAttribute("src"),
    ).toMatch(/^\/assets\/[a-f0-9]{16}\.png$/);
    expect(media?.querySelector("img")?.getAttribute("alt")).toContain(
      "sign-up email",
    );
    expect(media?.querySelector(".media__duration")?.textContent).toBe("0:42");
    expect(
      within(media as HTMLElement)
        .getByRole("link", { name: "Show as steps" })
        .getAttribute("href"),
    ).toBe("/docs/quickstart");
    // No fake video control: the play chrome is decorative.
    expect(media?.querySelectorAll("button, video")).toHaveLength(0);
    // Install: chips (hydrated tabs) over a command line and a sample.
    const install = screen.getByRole("tablist", { name: "Install" });
    expect(
      within(install)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["TypeScript", "Python", "cURL"]);
    expect(container.querySelector(".command-line__code")?.textContent).toBe(
      "$ npm install @testinbox/client",
    );
    expect(
      screen.getByRole("button", { name: "Copy install command" }),
    ).toBeDefined();
    expect(container.querySelector(".code-block--bare")).not.toBeNull();
    fireEvent.click(within(install).getByRole("tab", { name: "Python" }));
    expect(
      within(screen.getByRole("tabpanel", { name: "Python" })).getByText(
        /pip install testinbox/,
      ),
    ).toBeDefined();
    // Start here: rows with title, description, and meta.
    const start = container.querySelector(".start-here");
    const rows = within(start as HTMLElement).getAllByRole("link");
    expect(rows.map((row) => row.getAttribute("href"))).toEqual([
      "/docs/quickstart",
      "/docs/authentication",
      "/docs/guides/waiting-for-email",
      "/api",
    ]);
    expect(rows[3]?.textContent).toContain("25 endpoints");
    // Workflow strip: eyebrow heading, four columns with step headings below it.
    expect(
      screen.getByRole("heading", { level: 2, name: "The workflow" }),
    ).toBeDefined();
    const strip = container.querySelector("ol.steps--strip");
    expect(strip?.querySelectorAll("li.steps__step")).toHaveLength(4);
    expect(
      within(strip as HTMLElement).getByRole("heading", {
        level: 3,
        name: "Wait for an email",
      }),
    ).toBeDefined();
    // Install and Start here share one two-column row.
    expect(container.querySelectorAll(".home-grid")).toHaveLength(1);
    // Previous is absent on the first page; next follows the navigation.
    const pager = screen.getByRole("navigation", {
      name: "Previous and next pages",
    });
    expect(within(pager).queryByText("Previous")).toBeNull();
    expect(
      within(pager).getByRole("link", { name: /Next/ }).getAttribute("href"),
    ).toBe("/docs/introduction");
    expect((await axe(container)).violations).toEqual([]);
  });

  it("renders breadcrumbs, the outline, callouts, steps, tabs, and the pager for a guide", async () => {
    const quickstart = page("/docs/quickstart");
    const { container } = render(
      <DocsPage content={content} page={quickstart} />,
    );
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb.textContent?.replace(/\s+/g, " ")).toContain("Guides");
    expect(breadcrumb.textContent).toContain("Getting started");
    expect(
      within(breadcrumb)
        .getByRole("link", { name: "Guides" })
        .getAttribute("href"),
    ).toBe("/");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Quickstart",
    );
    const outline = screen.getByRole("navigation", { name: "On this page" });
    expect(
      within(outline)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["#choose-your-client", "#where-next"]);
    // Headings carry the same ids the outline points at.
    expect(container.querySelector("h2#choose-your-client")).not.toBeNull();
    // Callout: kind and title are text, the glyph is decorative.
    const callout = container.querySelector(".callout--note");
    expect(callout?.textContent).toContain("Note");
    expect(callout?.textContent).toContain("Before you start");
    expect(callout?.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // Enhanced tabs (jsdom renders as a hydrated client): a tablist with
    // roving tabindex and one visible panel.
    const tablist = screen.getByRole("tablist", { name: "Options" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "TypeScript",
      "Python",
      "cURL",
    ]);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.getAttribute("tabindex")).toBe("-1");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: "ArrowRight" });
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toContain(
      "from testinbox import",
    );
    fireEvent.keyDown(tabs[1] as HTMLElement, { key: "End" });
    expect(tabs[2]?.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(tabs[0] as HTMLElement);
    expect(screen.getByRole("tabpanel").textContent).toContain(
      "@testinbox/client",
    );
    // Pager links follow the configured order.
    const pager = screen.getByRole("navigation", {
      name: "Previous and next pages",
    });
    expect(
      within(pager)
        .getByRole("link", { name: /Previous/ })
        .getAttribute("href"),
    ).toBe("/docs/introduction");
    expect(
      within(pager).getByRole("link", { name: /Next/ }).getAttribute("href"),
    ).toBe("/docs/authentication");
    expect((await axe(container)).violations).toEqual([]);
  });

  it("renders tables, images, and hostile text as inert data", async () => {
    const troubleshooting = page("/docs/troubleshooting");
    const { container } = render(
      <DocsPage content={content} page={troubleshooting} />,
    );
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["Status", "Meaning", "What to do"]);
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(table.parentElement?.getAttribute("tabindex")).toBe("0");
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(0);
    // Entities stay literal, bidi controls survive as characters.
    // Entities decode to text (Markdown semantics) but never to elements.
    expect(container.textContent).toContain("<b>bold</b>");
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("‮");
    expect(
      screen
        .getByRole("link", { name: /support@testinbox.email/ })
        .getAttribute("href"),
    ).toBe("mailto:support@testinbox.email");
    expect((await axe(container)).violations).toEqual([]);

    cleanup();
    const lifecycle = page("/docs/concepts/inbox-lifecycle");
    const rendered = render(<DocsPage content={content} page={lifecycle} />);
    const image = rendered.container.querySelector("img.prose__image");
    expect(image?.getAttribute("src")).toMatch(/^\/assets\/[a-f0-9]{16}\.png$/);
    expect(image?.getAttribute("alt")).toBeTruthy();
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect((await axe(rendered.container)).violations).toEqual([]);
  });

  it("serves tabs as complete static sections without JavaScript", () => {
    const html = renderToStaticMarkup(
      <Tabs
        label="Options"
        labels={["One", "Two"]}
        panels={["first", "second"]}
      />,
    );
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("<button");
    expect(html).toContain('<h4 class="tabs-block__heading">One</h4>');
    expect(html).toContain('<h4 class="tabs-block__heading">Two</h4>');
    // Static headings continue the outline of the surrounding page.
    expect(
      renderToStaticMarkup(
        <Tabs
          headingLevel={3}
          label="Options"
          labels={["One"]}
          panels={["x"]}
        />,
      ),
    ).toContain('<h3 class="tabs-block__heading">One</h3>');
    expect(html).not.toContain("hidden");
    expect(html).toContain("first");
    expect(html).toContain("second");
  });

  it("renders every block kind through the model, never through markup", () => {
    const html = renderToStaticMarkup(
      <ContentBlocks
        blocks={[
          {
            children: [{ kind: "text", value: "<b>bold</b>" }],
            kind: "paragraph",
          },
          {
            children: [{ kind: "text", value: "Heading <i>" }],
            depth: 2,
            id: "heading-i",
            kind: "heading",
          },
          {
            items: [
              {
                checked: true,
                children: [
                  {
                    children: [{ kind: "text", value: "done" }],
                    kind: "paragraph",
                  },
                ],
              },
              {
                checked: false,
                children: [
                  {
                    children: [{ kind: "text", value: "todo" }],
                    kind: "paragraph",
                  },
                ],
              },
            ],
            kind: "list",
            ordered: false,
          },
          {
            children: [
              {
                children: [{ kind: "text", value: "quoted" }],
                kind: "paragraph",
              },
            ],
            kind: "blockquote",
          },
          { kind: "thematicBreak" },
          {
            children: [
              {
                children: [{ kind: "text", value: "external" }],
                href: "https://example.test/x",
                kind: "link",
                target: "external",
              },
              { kind: "break" },
              { children: [{ kind: "text", value: "em" }], kind: "emphasis" },
              { children: [{ kind: "text", value: "strong" }], kind: "strong" },
              { children: [{ kind: "text", value: "gone" }], kind: "delete" },
              { kind: "code", value: "<code/>" },
            ],
            kind: "paragraph",
          },
        ]}
      />,
    );
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(html).toContain(
      '<h2 class="prose__heading prose__heading--2" id="heading-i">',
    );
    expect(html).toContain("Done: ");
    expect(html).toContain("To do: ");
    expect(html).toContain("<blockquote");
    expect(html).toContain("<hr");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("(external link)");
    expect(html).toContain("<br/>");
    expect(html).toContain("<em>em</em>");
    expect(html).toContain("<strong>strong</strong>");
    expect(html).toContain("<del>gone</del>");
    expect(html).toContain("&lt;code/&gt;");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<i>");
  });
});

describe("composed navigation", () => {
  it("shows Docs and API tabs, authored sections, the API reference block, and one current item", async () => {
    const quickstart = page("/docs/quickstart");
    const { container } = render(
      <Shell
        content={content}
        currentPath="/docs/quickstart"
        index={index}
        mode="system"
      >
        <DocsPage content={content} page={quickstart} />
      </Shell>,
    );
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(primary)
        .getByRole("link", { name: "Guides" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(primary)
        .getByRole("link", { name: "API reference" })
        .getAttribute("aria-current"),
    ).toBeNull();
    const aside = screen.getByRole("complementary", {
      name: "Documentation navigation",
    });
    const groups = [...aside.querySelectorAll(".nav-group__title")].map(
      (node) => node.textContent?.trim(),
    );
    expect(groups.slice(0, 4)).toEqual([
      "Getting started",
      "Concepts",
      "Guides",
      "API reference",
    ]);
    expect(groups).toContain("Inboxes");
    expect(groups[groups.length - 1]).toBe("Resources");
    const current = aside.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe("Quickstart");
    const external = within(aside).getByRole("link", { name: /Status page/ });
    expect(external.getAttribute("href")).toBe(
      "https://status.testinbox.email",
    );
    expect(external.getAttribute("rel")).toBe("noopener noreferrer");
    expect(external.textContent).toContain("(external link)");
    // Branding: the logo replaces the mark and the accent is not inlined here
    // (the layout emits it with the request nonce).
    const logo = container.querySelector("img.wordmark__logo");
    expect(logo?.getAttribute("src")).toMatch(/^\/assets\/[a-f0-9]{16}\.svg$/);
    expect(logo?.getAttribute("alt")).toBe("");
    expect(container.querySelector("style")).toBeNull();
    expect((await axe(container)).violations).toEqual([]);
  });

  it("marks the API tab and the operation current on API routes while keeping authored sections", () => {
    render(
      <Shell
        content={content}
        currentPath="/api/inboxes/create-inbox"
        index={index}
        mode="system"
      >
        <p>operation</p>
      </Shell>,
    );
    const primary = screen.getByRole("navigation", { name: "Primary" });
    expect(
      within(primary)
        .getByRole("link", { name: "API reference" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      within(primary)
        .getByRole("link", { name: "Guides" })
        .getAttribute("aria-current"),
    ).toBeNull();
    const aside = screen.getByRole("complementary", {
      name: "Documentation navigation",
    });
    const current = aside.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute("href")).toBe("/api/inboxes/create-inbox");
    expect(
      within(aside).getByRole("link", { name: "Introduction" }),
    ).toBeDefined();
  });

  it("derives sidebar state, neighbours, breadcrumbs, outline, and metadata deterministically", () => {
    const nodes = sidebarNodes(
      content.navigation.items,
      "/docs/guides/attachments",
    );
    const guides = nodes.find(
      (node) => node.kind === "section" && node.label === "Guides",
    );
    expect(guides?.kind === "section" && guides.current).toBe(true);
    expect(nodes.find((node) => node.kind === "api")?.kind).toBe("api");

    expect(
      pageNeighbours(content, "/docs/guides/ci-integration"),
    ).toMatchObject({
      next: { kind: "api", label: "API reference", route: "/api" },
      previous: { label: "Attachments", route: "/docs/guides/attachments" },
    });
    expect(
      pageNeighbours(content, "/docs/troubleshooting").next,
    ).toBeUndefined();
    expect(
      pageNeighbours(content, "/docs/troubleshooting").previous,
    ).toMatchObject({
      label: "API reference",
      route: "/api",
    });
    expect(pageNeighbours(content, "/")).toMatchObject({
      next: { route: "/docs/introduction" },
    });
    expect(
      pageNeighbours(content, "/docs/introduction").previous,
    ).toMatchObject({
      route: "/",
    });
    expect(pageBreadcrumbs(content, page("/docs/guides/attachments"))).toEqual([
      { href: "/", label: "Guides" },
      { label: "Guides" },
      { label: "Attachments" },
    ]);
    expect(
      pageOutline(page("/docs/troubleshooting")).map((item) => item.id),
    ).toEqual(["errors", "reading-raw-content-safely", "getting-help"]);
    expect(pageMetadata(index, page("/docs/quickstart"))).toEqual({
      description:
        "Receive your first test email in under five minutes. You need an API key from the dashboard and a project that sends email.",
      path: "/docs/quickstart",
      title: "Quickstart | TestInbox API",
    });
    const paths = indexablePaths(index, [...content.pages.keys()]);
    expect(paths[0]).toBe("/");
    expect(paths.filter((entry) => entry === "/")).toHaveLength(1);
    expect(paths).toContain("/docs/quickstart");
    expect(paths.indexOf("/api")).toBeGreaterThan(
      paths.indexOf("/docs/troubleshooting"),
    );
  });
});
