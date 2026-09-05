import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Browser coverage for the API reference against the TestInbox fixture served
 * by `next start` (see playwright.config.ts). Assertions are semantic: roles,
 * names, headers, focus, and layout invariants rather than pixels.
 */

const OPERATION = "/api/inboxes/create-inbox";
const HTML_BUDGET_BYTES = 200 * 1_024;
const JS_BUDGET_BYTES = 150 * 1_024;

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test.describe("security headers", () => {
  test("serves a nonce-based CSP whose nonce matches every script and stylesheet", async ({
    page,
    request,
  }) => {
    const raw = await request.get(OPERATION);
    const csp = raw.headers()["content-security-policy"] ?? "";
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeDefined();
    // Every server-rendered script and stylesheet carries this request's nonce.
    const html = await raw.text();
    const tags = html.match(/<(?:script|link rel="stylesheet")[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(tag, tag).toContain(`nonce="${nonce}"`);
    }
    // Nothing is blocked when the browser enforces the policy.
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text()))
        violations.push(message.text());
    });
    const response = await page.goto(OPERATION);
    await page.waitForLoadState("networkidle");
    expect(violations).toEqual([]);
    expect(response?.headers()["x-frame-options"]).toBe("DENY");
    expect(response?.headers()["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response?.headers()["permissions-policy"]).toContain("camera=()");
    // The stylesheet actually applied: the page is not unstyled.
    await expect(page.locator("main")).toHaveCSS("border-radius", "16px");
  });
});

test.describe("desktop reader", () => {
  test("navigates from the reference index to an operation with unique metadata", async ({
    page,
  }) => {
    await page.goto("/api");
    await expect(page).toHaveTitle("API reference | TestInbox API");
    await page
      .getByRole("complementary", { name: "API navigation" })
      .getByRole("link", { name: /Create inbox/ })
      .click();
    await expect(page).toHaveTitle("Create inbox | TestInbox API");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      "Creates a disposable inbox that can immediately receive email.",
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/api\/inboxes\/create-inbox$/,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Create inbox",
    );
    const current = page
      .getByRole("complementary", { name: "API navigation" })
      .locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText("Create inbox");
    expect(await horizontalOverflow(page)).toBe(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("deep links land on the targeted section below the sticky header", async ({
    page,
  }) => {
    await page.goto(`${OPERATION}#response-409`);
    const target = page.locator("#response-409");
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    const header = await page.locator("header").boundingBox();
    expect(box).not.toBeNull();
    expect(header).not.toBeNull();
    expect((box?.y ?? 0) >= (header?.y ?? 0) + (header?.height ?? 0)).toBe(
      true,
    );
    await expect(target).toContainText("409 Conflict");
    await page.goto(`${OPERATION}#request-body`);
    await expect(page.locator("#request-body")).toBeInViewport();
  });

  test("keyboard users can skip navigation, reach the sidebar, and use disclosure-free sections", async ({
    page,
  }) => {
    await page.goto(OPERATION);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Skip to content" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "API reference" }).nth(1),
    ).toBeFocused();
    const copy = page.getByRole("button", { name: "Copy" });
    await copy.focus();
    await expect(copy).toBeFocused();
    const ring = await copy.evaluate(
      (node) => getComputedStyle(node).boxShadow,
    );
    expect(ring).not.toBe("none");
  });

  test("switches theme through the footer form without client script", async ({
    page,
  }) => {
    await page.goto(OPERATION);
    await expect(page.locator("html")).not.toHaveAttribute("data-mode", /./);
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page).toHaveURL(/\/api\/inboxes\/create-inbox$/);
    await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const background = await page
      .locator("main")
      .evaluate((node) => getComputedStyle(node).color);
    expect(background).toBe("rgb(196, 196, 201)");
    await page.getByRole("button", { name: "System" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-mode", /./);
  });

  test("marks deprecated operations visibly without hiding them", async ({
    page,
  }) => {
    await page.goto("/api/messages/mark-message-read");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Mark message read",
    );
    await expect(
      page.locator(".page-header__title .badge--deprecated"),
    ).toHaveText("Deprecated");
    await expect(page.getByRole("note")).toContainText("Deprecated.");
    await expect(page.locator(".endpoint-line__path--deprecated")).toHaveText(
      "/inboxes/{inboxId}/messages/{messageId}/read",
    );
    await expect(
      page
        .getByRole("complementary", { name: "API navigation" })
        .locator(".nav-item--deprecated"),
    ).toHaveCount(1);
  });

  test("keeps operation HTML and client JavaScript within budget", async ({
    page,
    request,
  }) => {
    const response = await request.get(OPERATION);
    expect(response.status()).toBe(200);
    const body = await response.body();
    expect(body.byteLength).toBeLessThan(HTML_BUDGET_BYTES);
    expect(body.toString("utf8")).toContain("Idempotency-Key");

    let scriptBytes = 0;
    page.on("response", async (scriptResponse) => {
      if (scriptResponse.request().resourceType() !== "script") return;
      const sizes = await scriptResponse
        .request()
        .sizes()
        .catch(() => undefined);
      scriptBytes += sizes?.responseBodySize ?? 0;
    });
    await page.goto(OPERATION);
    await page.waitForLoadState("networkidle");
    // The server-first reader hydrates two small islands; the budget is a
    // regression ceiling above the measured baseline, see performance docs.
    expect(scriptBytes).toBeLessThan(JS_BUDGET_BYTES);
    expect(scriptBytes).toBeGreaterThan(0);
  });

  test("returns a documentation 404 for unknown and malformed routes", async ({
    page,
  }) => {
    for (const path of [
      "/api/inboxes/nope",
      "/api/Inboxes",
      "/api/inboxes/create-inbox/extra",
      "/api/..%2f",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Page not found",
      );
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("publishes a sitemap and robots policy for the documented routes", async ({
    request,
  }) => {
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const xml = await sitemap.text();
    expect(xml).toContain(
      "<loc>https://docs.example.test/api/inboxes/create-inbox</loc>",
    );
    expect(xml).toContain("<loc>https://docs.example.test/api/inboxes</loc>");
    expect(xml).not.toContain(".specra");
    expect((xml.match(/<loc>/g) ?? []).length).toBe(2 + 6 + 25);
    const robots = await request.get("/robots.txt");
    expect(await robots.text()).toContain(
      "Sitemap: https://docs.example.test/sitemap.xml",
    );
    expect(await robots.text()).toContain("Disallow: /theme");
  });
});

test.describe("mobile reader", () => {
  test.use({
    viewport: { height: 812, width: 375 },
    hasTouch: true,
    isMobile: true,
  });

  test("opens the navigation drawer with focus management and no horizontal overflow", async ({
    page,
  }) => {
    await page.goto(OPERATION);
    expect(await horizontalOverflow(page)).toBe(0);
    await expect(
      page.getByRole("complementary", { name: "API navigation" }),
    ).toBeHidden();
    const menu = page.getByRole("button", { name: "Navigation" });
    await menu.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await expect(
      page.locator("dialog[open] .nav-item[aria-current='page']"),
    ).toContainText("Create inbox");
    const focusedInside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest("dialog[open]")),
    );
    expect(focusedInside).toBe(true);
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(menu).toBeFocused();
    await menu.click();
    await drawer.getByRole("link", { name: /Get inbox/ }).click();
    await expect(page).toHaveURL(/\/api\/inboxes\/get-inbox$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Get inbox",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Navigation" }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("reflows the longest paths and parameter lists at 320 CSS px", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 640, width: 320 });
    await page.goto("/api/attachments/download-attachment");
    expect(await horizontalOverflow(page)).toBe(0);
    await expect(page.locator(".endpoint-line__path")).toContainText(
      "/attachments/{attachmentId}",
    );
    await expect(
      page.getByRole("heading", { level: 3, name: "Query parameters" }),
    ).toBeVisible();
    await page.goto("/api");
    expect(await horizontalOverflow(page)).toBe(0);
  });
});
