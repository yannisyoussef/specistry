import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Authored content and navigation (SPEC-006) in the production reader against
 * the TestInbox fixture: the homepage, a guide with every component, authored
 * and API navigation in one sidebar, assets and branding, hostile text, 404s,
 * themes, budgets, and the no-JavaScript shape of tabs and copy controls.
 */

const QUICKSTART = "/docs/quickstart";
const HTML_BUDGET_BYTES = 200 * 1_024;
const JS_BUDGET_BYTES = 150 * 1_024;

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test.describe("authored pages", () => {
  test("serves the authored homepage with branding, tabs, and the composed sidebar", async ({
    page,
    request,
  }) => {
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text()))
        violations.push(message.text());
    });
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle(
      "Email testing built for automation | TestInbox API",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Email testing built for automation",
    );
    // Primary tabs: Docs is current on authored routes.
    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      primary.getByRole("link", { name: "API reference" }),
    ).not.toHaveAttribute("aria-current", /./);
    // Branding: accent through a nonce style, logo and favicon from assets.
    const brand = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--brand")
        .trim(),
    );
    expect(brand).toBe("#2a6fdb");
    const logo = page.locator("img.wordmark__logo");
    await expect(logo).toHaveAttribute("src", /^\/assets\/[a-f0-9]{16}\.svg$/);
    const logoSource = await logo.getAttribute("src");
    const svg = await request.get(logoSource ?? "");
    expect(svg.status()).toBe(200);
    expect(svg.headers()["content-type"]).toBe("image/svg+xml");
    expect(svg.headers()["content-security-policy"]).toContain("sandbox");
    expect(svg.headers()["cache-control"]).toContain("immutable");
    await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
      "href",
      /^\/assets\/[a-f0-9]{16}\.png$/,
    );
    // Cards link to authored and generated routes.
    await page
      .getByRole("link", { name: /API reference/ })
      .last()
      .click();
    await expect(page).toHaveURL(/\/api$/);
    await page.goBack();
    // Code group: switching tabs swaps the visible fence.
    const group = page.getByRole("tablist", { name: "Code examples" });
    await group.getByRole("tab", { name: "pnpm" }).click();
    await expect(page.getByRole("tabpanel")).toContainText(
      "pnpm add @testinbox/client",
    );
    expect(violations).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("renders a guide with breadcrumbs, outline, callout, steps, keyboard tabs, and copy", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(QUICKSTART);
    await expect(page).toHaveTitle("Quickstart | TestInbox API");
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toContainText("Getting started");
    const outline = page.getByRole("navigation", { name: "On this page" });
    await outline.getByRole("link", { name: "Choose your client" }).click();
    await expect(page).toHaveURL(/#choose-your-client$/);
    // The target heading sits below the sticky header, not under it.
    const top = await page
      .locator("#choose-your-client")
      .evaluate((node) => node.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(52);
    await expect(page.locator(".callout--note")).toContainText(
      "Before you start",
    );
    await expect(page.locator("ol.steps > li")).toHaveCount(4);
    // Tabs: roving focus with the arrow keys, Home/End, and a single panel.
    const tablist = page.getByRole("tablist", { name: "Options" });
    const first = tablist.getByRole("tab", { name: "TypeScript" });
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tablist.getByRole("tab", { name: "Python" })).toBeFocused();
    await expect(tablist.getByRole("tab", { name: "Python" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tabpanel")).toContainText(
      "from testinbox import",
    );
    await page.keyboard.press("End");
    await expect(tablist.getByRole("tab", { name: "cURL" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(first).toBeFocused();
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    // Copy: the first code block's control announces success politely.
    const copy = page.getByRole("button", { name: "Copy code" }).first();
    await copy.click();
    await expect(copy).toContainText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      "client.inboxes.create",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("moves between authored pages and the API reference through one sidebar", async ({
    page,
  }) => {
    await page.goto(QUICKSTART);
    const sidebar = page.getByRole("complementary", {
      name: "Documentation navigation",
    });
    await expect(sidebar.locator('[aria-current="page"]')).toHaveText(
      "Quickstart",
    );
    await sidebar.getByRole("link", { name: /Create inbox/ }).click();
    await expect(page).toHaveURL(/\/api\/inboxes\/create-inbox$/);
    await expect(
      page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: "API reference" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(
      sidebar.getByRole("link", { name: "Introduction" }),
    ).toBeVisible();
    await sidebar.getByRole("link", { name: "Attachments" }).first().click();
    await expect(page).toHaveURL(/\/docs\/guides\/attachments$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Attachments",
    );
    // Previous/next crosses into the generated reference and back.
    await page.goto("/docs/guides/ci-integration");
    await page
      .getByRole("navigation", { name: "Previous and next pages" })
      .getByRole("link", { name: /Next/ })
      .click();
    await expect(page).toHaveURL(/\/api$/);
    await page.goto("/docs/troubleshooting");
    await expect(
      page
        .getByRole("navigation", { name: "Previous and next pages" })
        .getByRole("link", { name: /Previous/ }),
    ).toHaveAttribute("href", "/api");
  });

  test("keeps hostile authored text inert and never serves markup, scripts, or images from it", async ({
    page,
  }) => {
    const alerts: string[] = [];
    page.on("dialog", (dialog) => {
      alerts.push(dialog.message());
      void dialog.dismiss();
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/docs/troubleshooting");
    const main = page.getByRole("main");
    await expect(main).toContainText("<script>alert(1)</script>");
    await expect(main).toContainText("<b>bold</b>");
    expect(await main.locator("b").count()).toBe(0);
    expect(await main.locator("script").count()).toBe(0);
    expect(await main.locator("img").count()).toBe(0);
    expect(await main.locator('a[href^="javascript"]').count()).toBe(0);
    await expect(
      main.getByRole("link", { name: /support@testinbox.email/ }),
    ).toHaveAttribute("href", "mailto:support@testinbox.email");
    // The table scrolls inside its own container; the page never does.
    expect(await horizontalOverflow(page)).toBe(0);
    expect(alerts).toEqual([]);
    expect(errors).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("redirects /docs, serves assets only by manifest name, and returns 404 for unknown routes", async ({
    page,
    request,
  }) => {
    const redirect = await request.get("/docs", { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    expect(redirect.headers()["location"]).toBe("/");
    await page.goto("/docs/concepts/inbox-lifecycle");
    const image = page.locator("img.prose__image");
    const source = await image.getAttribute("src");
    expect(source).toMatch(/^\/assets\/[a-f0-9]{16}\.png$/);
    const png = await request.get(source ?? "");
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toBe("image/png");
    expect(png.headers()["x-content-type-options"]).toBe("nosniff");
    for (const path of [
      "/assets/manifest.json",
      "/assets/..%2fmanifest.json",
      "/assets/0000000000000000.png",
      "/assets/5cb94515a1027e4c.js",
    ]) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
    for (const path of [
      "/docs/nope",
      "/docs/Quickstart",
      "/docs/a/b/c/d/e",
      "/docs/guides",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Page not found",
      );
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("switches theme on an authored page and keeps HTML and JavaScript within budget", async ({
    page,
    request,
  }) => {
    const raw = await request.get(QUICKSTART);
    const html = await raw.text();
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(HTML_BUDGET_BYTES);
    const nonce = /'nonce-([^']+)'/.exec(
      raw.headers()["content-security-policy"] ?? "",
    )?.[1];
    expect(html).toContain(
      `<style nonce="${nonce}">:root{--brand:#2a6fdb}</style>`,
    );
    // Transferred script bytes for the guide: the Tabs island is the only
    // addition to the framework bootstrap and the copy control.
    let bytes = 0;
    page.on("response", async (scriptResponse) => {
      if (scriptResponse.request().resourceType() !== "script") return;
      const sizes = await scriptResponse
        .request()
        .sizes()
        .catch(() => undefined);
      bytes += sizes?.responseBodySize ?? 0;
    });
    await page.goto(QUICKSTART);
    await page.waitForLoadState("networkidle");
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(JS_BUDGET_BYTES);
    const before = await page.evaluate(
      () => getComputedStyle(document.body).color,
    );
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    await expect(page).toHaveURL(/\/docs\/quickstart$/);
    const after = await page.evaluate(
      () => getComputedStyle(document.body).color,
    );
    expect(after).not.toBe(before);
    // Syntax colours resolve in both modes.
    const keyword = await page
      .locator(".tok-kw")
      .first()
      .evaluate((node) => getComputedStyle(node).color);
    expect(keyword).not.toBe(after);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("publishes authored routes in the sitemap with canonical URLs", async ({
    request,
  }) => {
    const sitemap = await request.get("/sitemap.xml");
    const xml = await sitemap.text();
    expect(xml).toContain("<loc>https://docs.example.test/</loc>");
    expect(xml).toContain(
      "<loc>https://docs.example.test/docs/quickstart</loc>",
    );
    expect(xml).toContain(
      "<loc>https://docs.example.test/docs/guides/ci-integration</loc>",
    );
    expect(xml).not.toContain("/docs/index");
    const html = await (await request.get(QUICKSTART)).text();
    expect(html).toContain(
      '<link rel="canonical" href="https://docs.example.test/docs/quickstart"',
    );
    expect(html).toContain(
      '<meta name="description" content="Receive your first test email',
    );
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("serves every tab panel as a section and keeps the page navigable", async ({
      page,
    }) => {
      await page.goto(QUICKSTART);
      expect(await page.getByRole("tablist").count()).toBe(0);
      const headings = page.locator(".tabs-block__heading");
      await expect(headings).toHaveText(["TypeScript", "Python", "cURL"]);
      for (const heading of await headings.all())
        await expect(heading).toBeVisible();
      await expect(page.locator(".tabs-block__panel")).toHaveCount(3);
      await expect(
        page.getByRole("navigation", { name: "On this page" }),
      ).toBeVisible();
      await page
        .getByRole("navigation", { name: "Previous and next pages" })
        .getByRole("link", { name: /Next/ })
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Authentication",
      );
      const sidebar = page.getByRole("complementary", {
        name: "Documentation navigation",
      });
      await expect(sidebar.locator('[aria-current="page"]')).toHaveText(
        "Authentication",
      );
    });
  });
});
