import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { VERSIONED_URL } from "../../playwright.config";

/**
 * Immutable documentation releases in the production reader (SPEC-010
 * §162–§169): v1 and v2 render their own content, navigation, API,
 * examples, SDK text, search, and playground policy; aliases redirect
 * non-permanently; frozen redirects are permanent; unknown versions and
 * routes are real 404s; the version menu switches to counterparts without
 * JavaScript; the CSP never unions origins; credentials do not cross
 * releases; the sitemap lists canonical versioned URLs only; unreviewed
 * candidates are never served.
 */

const base = VERSIONED_URL;

test.describe("versioned reader", () => {
  test("serves v1 and v2 with their own content and navigation", async ({
    page,
  }) => {
    await page.goto(`${base}/docs/v1/getting-started`);
    await expect(page).toHaveTitle(/Getting started/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Getting started",
    );
    await expect(page.getByText("glacier")).toBeVisible();
    await expect(page.getByLabel("Documentation version notice")).toContainText(
      "1.0 is deprecated. The current documentation is 2.0.",
    );
    // The sidebar is in the DOM on every viewport (a drawer clones it on phones).
    const sidebar = page.locator('nav[aria-label="Documentation"]').first();
    await expect(
      sidebar.locator("a", { hasText: "Get raw message" }),
    ).toHaveAttribute("href", "/api/v1/inboxes/get-raw-message");
    await expect(
      sidebar.locator("a", { hasText: "Wait for message" }),
    ).toHaveCount(0);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://versioned.example.test/docs/v1/getting-started",
    );
    const hrefs = await page
      .locator("main a[href^='/'], nav a[href^='/']")
      .evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.getAttribute("href")),
      );
    expect(
      hrefs.filter(
        (href) => href?.startsWith("/docs/v2") || href?.startsWith("/api/v2"),
      ),
    ).toEqual(["/docs/v2"]);

    await page.goto(`${base}/docs/v2/quickstart`);
    await expect(page.getByText("waterfall")).toBeVisible();
    await expect(page.getByLabel("Documentation version notice")).toHaveCount(
      0,
    );
    await expect(
      page
        .locator('nav[aria-label="Documentation"]')
        .first()
        .locator("a", { hasText: "Wait for message" }),
    ).toHaveAttribute("href", "/api/v2/inboxes/wait-for-message");
    // The header tabs collapse on phones; the link is still in the DOM.
    await expect(
      page.locator('nav[aria-label="Primary"] a', { hasText: "Changelog" }),
    ).toHaveAttribute("href", "/docs/v2/changelog");
  });

  test("the same operation shows each release's contract, examples, SDK text, and version UI", async ({
    page,
  }) => {
    await page.goto(`${base}/api/v1/inboxes/create-inbox`);
    await expect(
      page.getByRole("complementary", { name: "Code" }),
    ).toContainText("https://api.versioned.test/v1/inboxes");
    await expect(
      page.getByRole("complementary", { name: "Code" }),
    ).toContainText("X-Api-Key");
    await expect(page.getByRole("tab", { name: "Try it" })).toHaveCount(0);
    await expect(
      page.getByText("Try it is available on the current version only."),
    ).toBeVisible();
    await page
      .getByRole("complementary", { name: "Code" })
      .getByRole("combobox", { name: "Language" })
      .selectOption({ label: "TypeScript SDK" });
    await expect(
      page.getByRole("complementary", { name: "Code" }),
    ).toContainText("VERSIONED_API_KEY");

    await page.goto(`${base}/api/v2/inboxes/create-inbox`);
    await expect(
      page.getByRole("complementary", { name: "Code" }),
    ).toContainText("https://api.versioned.test/v2/inboxes");
    await expect(
      page.getByRole("complementary", { name: "Code" }),
    ).toContainText("Authorization: Bearer");
    await expect(page.getByRole("tab", { name: "Try it" })).toBeVisible();
    await page
      .getByRole("complementary", { name: "Code" })
      .getByRole("combobox", { name: "Language" })
      .selectOption({ label: "TypeScript SDK" });
    await expect(
      page.getByRole("complementary", { name: "Code" }),
    ).toContainText("VERSIONED_TOKEN");
    await expect(
      page.getByRole("complementary", { name: "Code" }),
    ).not.toContainText("VERSIONED_API_KEY");
  });

  test("redirects aliases non-permanently, frozen migrations permanently, and 404s the unknown", async ({
    request,
  }) => {
    const redirect = async (path: string) => {
      const response = await request.get(`${base}${path}`, { maxRedirects: 0 });
      return {
        location: response.headers().location ?? "",
        status: response.status(),
      };
    };
    expect(await redirect("/")).toEqual({ location: "/docs/v2", status: 307 });
    expect(await redirect("/docs")).toEqual({
      location: "/docs/v2",
      status: 307,
    });
    expect(await redirect("/api")).toEqual({
      location: "/api/v2",
      status: 307,
    });
    expect(await redirect("/docs/authentication")).toEqual({
      location: "/docs/v2/authentication",
      status: 307,
    });
    expect(await redirect("/api/inboxes/create-inbox?env=local")).toEqual({
      location: "/api/v2/inboxes/create-inbox?env=local",
      status: 307,
    });
    expect(await redirect("/docs/getting-started")).toEqual({
      location: "/docs/v2/quickstart",
      status: 307,
    });
    expect(await redirect("/docs/v2/getting-started")).toEqual({
      location: "/docs/v2/quickstart",
      status: 308,
    });
    for (const path of [
      "/docs/v3",
      "/docs/does-not-exist",
      "/docs/v1/quickstart",
      "/docs/v1/changelog",
      "/api/v2/inboxes/get-raw-message",
      "/api/v1/inboxes/wait-for-message",
      "/docs/V2",
      "/api/v9/inboxes",
    ]) {
      const response = await request.get(`${base}${path}`, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
      expect(await response.text(), path).toContain("Page not found");
    }
    // Historical canonical pages never redirect to current.
    const historical = await request.get(`${base}/docs/v1/getting-started`, {
      maxRedirects: 0,
    });
    expect(historical.status()).toBe(200);
    expect(historical.headers()["cache-control"] ?? "").not.toContain(
      "immutable",
    );
  });

  test("never redirects off the site for hostile paths", async ({
    request,
  }) => {
    for (const path of [
      "//evil.example",
      "/docs/%2f%2fevil.example",
      "/docs/@evil.example",
      "/docs/\\evil.example",
      "/docs/%0d%0aLocation:%20https://evil.example",
      "/api/..%2fv2",
      "/docs/v2/%2e%2e/v1",
    ]) {
      const response = await request.get(`${base}${path}`, { maxRedirects: 0 });
      const location = response.headers().location ?? "";
      // Any redirect stays on this host as a single-slash path; the reader
      // never emits a scheme, a host, a protocol-relative location, or a
      // raw line break (an encoded one stays inert inside the path).
      if (response.status() >= 300 && response.status() < 400) {
        expect(location, path).toMatch(/^\/(?!\/)/);
        expect(location, path).not.toMatch(/^https?:|^\/\/|\\|[\r\n]/i);
      } else {
        expect([200, 404], path).toContain(response.status());
      }
    }
  });

  test("switches versions to the semantic counterpart without JavaScript", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${base}/docs/v1/authentication`);
    const menu = page.locator(".version-menu");
    await menu.locator("summary").click();
    const links = menu.getByRole("link");
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveAttribute(
      "href",
      "/docs/v2/authentication",
    );
    await expect(links.nth(0)).toContainText("Current");
    await expect(links.nth(1)).toHaveAttribute(
      "href",
      "/docs/v1/authentication",
    );
    await expect(links.nth(1)).toContainText("Deprecated");
    await links.nth(0).click();
    await expect(page).toHaveURL(`${base}/docs/v2/authentication`);
    await expect(page.getByRole("heading", { name: "Tokens" })).toBeVisible();
    // A page without a counterpart lands on the target release home.
    await page.goto(`${base}/docs/v2/quickstart`);
    await page.locator(".version-menu summary").click();
    await expect(
      page.locator(".version-menu").getByRole("link", { name: /1\.0/ }),
    ).toHaveAttribute("href", "/docs/v1");
    await expect(
      page.locator(".version-menu").getByRole("link", { name: /1\.0/ }),
    ).toContainText("opens the release home");
    await context.close();
  });

  test("scopes the CSP and the playground to the current release only", async ({
    request,
  }) => {
    const v1 = await request.get(`${base}/api/v1/inboxes/create-inbox`);
    const v1Policy = v1.headers()["content-security-policy"] ?? "";
    expect(v1Policy).toMatch(/connect-src 'self';/);
    expect(v1Policy).not.toContain("47391");
    expect(v1Policy).not.toContain("47393");
    const v2 = await request.get(`${base}/api/v2/inboxes/create-inbox`);
    const v2Policy = v2.headers()["content-security-policy"] ?? "";
    expect(v2Policy).toContain("connect-src 'self' http://127.0.0.1:47393");
    expect(v2Policy).not.toContain("47391");
    const guide = await request.get(`${base}/docs/v2/quickstart`);
    expect(guide.headers()["content-security-policy"] ?? "").toMatch(
      /connect-src 'self';/,
    );
  });

  test("keeps credentials inside one release", async ({ page }) => {
    await page.goto(`${base}/api/v2/inboxes/create-inbox`);
    await page.getByRole("tab", { name: "Try it" }).click();
    const panel = page.getByRole("tabpanel", { name: "Try it" });
    await panel.getByLabel("Bearer token").fill("v2-secret-token");
    await page.locator(".version-menu summary").click();
    await page
      .locator(".version-menu")
      .getByRole("link", { name: /1\.0/ })
      .click();
    await expect(page).toHaveURL(`${base}/api/v1/inboxes/create-inbox`);
    await expect(page.getByRole("tab", { name: "Try it" })).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.outerHTML),
    ).not.toContain("v2-secret-token");
    expect(
      await page.evaluate(() =>
        JSON.stringify({ ...sessionStorage, ...localStorage }),
      ),
    ).not.toContain("v2-secret-token");
    await page.goBack();
    await page.getByRole("tab", { name: "Try it" }).click();
    await expect(
      page.getByRole("tabpanel", { name: "Try it" }).getByLabel("Bearer token"),
    ).toHaveValue("");
  });

  test("searches each release separately with versioned result routes", async ({
    page,
  }) => {
    await page.goto(`${base}/docs/v1`);
    await page.locator(".search-trigger").click();
    await page
      .getByRole("combobox", { name: "Search documentation" })
      .fill("glacier");
    await expect(page.getByRole("option").first()).toContainText(
      "Getting started",
    );
    await page
      .getByRole("combobox", { name: "Search documentation" })
      .fill("waterfall");
    await expect(page.getByText(/No results/)).toBeVisible();
    await page
      .getByRole("combobox", { name: "Search documentation" })
      .fill("glacier");
    await page.getByRole("option").first().click();
    await expect(page).toHaveURL(/\/docs\/v1\/getting-started/);

    await page.goto(`${base}/docs/v2`);
    await page.locator(".search-trigger").click();
    await page
      .getByRole("combobox", { name: "Search documentation" })
      .fill("waterfall");
    await expect(page.getByRole("option").first()).toContainText("Quickstart");
    await page
      .getByRole("combobox", { name: "Search documentation" })
      .fill("glacier");
    await expect(page.getByText(/No results/)).toBeVisible();
    await page
      .getByRole("combobox", { name: "Search documentation" })
      .fill("wait for message");
    await page.getByRole("option").first().click();
    await expect(page).toHaveURL(/\/(docs|api)\/v2\//);
  });

  test("publishes only the reviewed changelog and keeps candidates private", async ({
    page,
    request,
  }) => {
    await page.goto(`${base}/docs/v2/changelog`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Changelog",
    );
    await expect(
      page.getByText("Wait synchronously for an incoming message", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /\/inboxes\/\{id\}\/messages\/wait/ }),
    ).toHaveAttribute("href", "/api/v2/inboxes/wait-for-message");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://versioned.example.test/docs/v2/changelog",
    );
    const html = await page.content();
    expect(html).not.toContain("operation-changed:openapi.yaml~createInbox");
    expect(html).not.toContain("schema-changed");
    for (const path of [
      "/.specra/candidates/diff.json",
      "/docs/v1/changelog",
      "/candidates/diff.json",
      "/.specra/releases/catalog.json",
      "/.specra/releases/v2/release.json",
    ]) {
      expect((await request.get(`${base}${path}`)).status(), path).toBe(404);
    }
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
  });

  test("lists canonical versioned URLs in a sitemap index and no aliases", async ({
    request,
  }) => {
    const index = await (await request.get(`${base}/sitemap.xml`)).text();
    expect(index).toContain("<sitemapindex");
    expect(index).toContain("https://versioned.example.test/sitemaps/v1.xml");
    expect(index).toContain("https://versioned.example.test/sitemaps/v2.xml");
    const v2 = await (await request.get(`${base}/sitemaps/v2.xml`)).text();
    expect(v2).toContain("<loc>https://versioned.example.test/docs/v2</loc>");
    expect(v2).toContain(
      "<loc>https://versioned.example.test/docs/v2/changelog</loc>",
    );
    expect(v2).not.toContain("<loc>https://versioned.example.test/docs</loc>");
    expect(v2).not.toContain("<loc>https://versioned.example.test/</loc>");
    expect(v2).not.toContain("<loc>https://versioned.example.test/api</loc>");
    expect(v2).not.toContain("/docs/v1");
    expect((await request.get(`${base}/sitemaps/v3.xml`)).status()).toBe(404);
    const robots = await (await request.get(`${base}/robots.txt`)).text();
    expect(robots).toContain("https://versioned.example.test/sitemap.xml");
  });

  test("works on a phone and passes axe with the version menu open", async ({
    isMobile,
    page,
  }) => {
    await page.goto(`${base}/docs/v1/authentication`);
    const summary = page.locator(".version-menu summary");
    const box = await summary.boundingBox();
    if (isMobile) expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await summary.click();
    await expect(
      page.locator(".version-menu").getByRole("link").first(),
    ).toBeVisible();
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    const viewport = page.viewportSize();
    expect(width).toBeLessThanOrEqual((viewport?.width ?? width) + 1);
  });
});
