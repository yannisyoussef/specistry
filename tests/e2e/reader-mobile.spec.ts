import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Mobile reader coverage, run by the `chromium-mobile` project (Pixel 5
 * profile: touch, mobile user agent). The drawer, reflow at 320 CSS px, and
 * the no-script fallback are the behaviours that differ from desktop.
 */

const OPERATION = "/api/inboxes/create-inbox";

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test.describe("mobile reader", () => {
  test.use({ viewport: { height: 812, width: 375 } });

  test("opens the navigation drawer with focus management and no horizontal overflow", async ({
    page,
  }) => {
    await page.goto(OPERATION);
    expect(await horizontalOverflow(page)).toBe(0);
    await expect(
      page.getByRole("complementary", { name: "Documentation navigation" }),
    ).toBeHidden();
    const menu = page.getByRole("link", { name: "Navigation" });
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
    await page.getByRole("link", { name: "Navigation" }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("keeps the theme buttons at touch size and the endpoint copy control labelled", async ({
    page,
  }) => {
    await page.goto(OPERATION);
    const dark = page.getByRole("button", { name: "Dark" });
    const box = await dark.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(
      page.getByRole("button", { name: "Copy POST /inboxes" }),
    ).toBeVisible();
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("falls back to an in-page link that reveals the navigation", async ({
      page,
    }) => {
      await page.goto(OPERATION);
      const sidebar = page.getByRole("complementary", {
        name: "Documentation navigation",
      });
      await expect(sidebar).toBeHidden();
      const menu = page.getByRole("link", { name: "Navigation" });
      await expect(menu).toHaveAttribute("href", "#api-sidebar-region");
      await menu.click();
      await expect(page).toHaveURL(/#api-sidebar-region$/);
      await expect(sidebar).toBeVisible();
      await expect(
        sidebar.getByRole("link", { name: /Create inbox/ }),
      ).toBeVisible();
      expect(await horizontalOverflow(page)).toBe(0);
    });
  });

  test("opens the drawer on an authored page with sections, the current item, and touch-sized tabs", async ({
    page,
  }) => {
    await page.goto("/docs/quickstart");
    expect(await horizontalOverflow(page)).toBe(0);
    await page.getByRole("link", { name: "Navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[aria-current="page"]')).toHaveText(
      "Quickstart",
    );
    await expect(drawer.getByText("Getting started")).toBeVisible();
    await expect(
      drawer.getByRole("link", { name: /Create inbox/ }),
    ).toBeVisible();
    await drawer.getByRole("link", { name: "CI integration" }).click();
    await expect(page).toHaveURL(/\/docs\/guides\/ci-integration$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "CI integration",
    );
    // Tabs are touch targets; cards stack; code scrolls inside its block.
    await page.goto("/docs/quickstart");
    const tab = page.getByRole("tab", { name: "Python" });
    const box = await tab.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await tab.tap();
    await expect(page.getByRole("tabpanel")).toContainText(
      "from testinbox import",
    );
    const cards = page.locator(".cards__item");
    const first = await cards.first().boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(first?.x).toBe(second?.x);
    expect(await horizontalOverflow(page)).toBe(0);
    await page.setViewportSize({ height: 640, width: 320 });
    await page.goto("/docs/troubleshooting");
    expect(await horizontalOverflow(page)).toBe(0);
    await page.goto("/");
    expect(await horizontalOverflow(page)).toBe(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("searches from the header on a phone with a full-screen sheet and touch targets", async ({
    page,
  }) => {
    await page.goto("/docs/quickstart");
    const trigger = page.locator(".search-trigger");
    const box = await trigger.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await trigger.tap();
    const dialog = page.getByRole("dialog", { name: "Search documentation" });
    await expect(dialog).toBeVisible();
    const input = page.getByRole("combobox", { name: "Search documentation" });
    await expect(input).toBeFocused();
    const panel = await page.locator(".search__panel").boundingBox();
    expect(Math.round(panel?.width ?? 0)).toBe(375);
    await input.fill("attachments");
    const first = page.getByRole("option").first();
    const row = await first.boundingBox();
    expect(row?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await horizontalOverflow(page)).toBe(0);
    await page.getByRole("button", { name: /Close search/ }).tap();
    await expect(dialog).toBeHidden();
    await trigger.tap();
    await input.fill("create inbox");
    await page.getByRole("option").first().tap();
    await expect(page).toHaveURL(/\/api\/inboxes\/create-inbox$/);
    await page.setViewportSize({ height: 640, width: 320 });
    await page.locator(".search-trigger").tap();
    await page
      .getByRole("combobox", { name: "Search documentation" })
      .fill("download attachment");
    await expect(page.getByRole("option").first()).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("offers the Code section inline with a bottom bar link and touch-sized controls", async ({
    page,
  }) => {
    await page.goto(OPERATION);
    const rail = page.getByRole("complementary", { name: "Code" });
    await expect(rail).toBeVisible();
    // The rail sits inline after the header, before the sections.
    const railBox = await rail.boundingBox();
    const authBox = await page
      .getByRole("region", { name: "Authentication" })
      .boundingBox();
    expect((railBox?.y ?? 0) < (authBox?.y ?? 0)).toBe(true);
    const bar = page.getByRole("navigation", { name: "Code" });
    const link = bar.getByRole("link", { name: "Code" });
    await expect(link).toBeVisible();
    const linkBox = await link.boundingBox();
    expect(linkBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    // The bar stays fixed at the bottom of the viewport while scrolling.
    await page
      .getByRole("region", { name: "Responses" })
      .scrollIntoViewIfNeeded();
    const viewport = page.viewportSize();
    const barBox = await bar.boundingBox();
    expect((barBox?.y ?? 0) + (barBox?.height ?? 0)).toBeLessThanOrEqual(
      viewport?.height ?? 0,
    );
    await link.click();
    await expect(rail).toBeInViewport();
    const language = rail.getByRole("combobox", { name: "Language" });
    await expect(language).toBeVisible();
    expect((await language.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
      44,
    );
    await language.selectOption({ label: "Python" });
    await expect(
      rail.locator(".code-switcher__panel:not([hidden]) pre"),
    ).toContainText("requests.post(");
    expect(await horizontalOverflow(page)).toBe(0);
    await page.setViewportSize({ height: 640, width: 320 });
    await page.goto(OPERATION);
    await expect(rail).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
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

test.describe("schema renderer on mobile", () => {
  test("keeps complex schemas readable at 375 and 320 CSS px with touch-sized disclosures", async ({
    page,
  }) => {
    await page.goto("/api/messages/get-message");
    expect(await horizontalOverflow(page)).toBe(0);
    const summary = page.locator("#response-200-application-json summary", {
      hasText: "3 variants",
    });
    const box = await summary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await summary.tap();
    await page.locator("summary", { hasText: "MultipartContent" }).tap();
    await page.locator("summary", { hasText: /^items of parts$/ }).tap();
    await expect(page.getByText("recursive").first()).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    await page.setViewportSize({ height: 640, width: 320 });
    await page.goto("http://127.0.0.1:3101/api/operations/schema-shapes");
    expect(await horizontalOverflow(page)).toBe(0);
    const big = page.locator(".schema-row", { hasText: /^bigObject/ }).first();
    await big.locator("summary", { hasText: "250 properties" }).tap();
    await big.getByText("Show 170 more properties").tap();
    expect(await horizontalOverflow(page)).toBe(0);
    // Nested indentation stays bounded: the deepest guide is still on screen.
    const deep = page.locator(".schema-row", { hasText: /^deepTree/ }).first();
    await deep.locator("summary").first().tap();
    const guides = deep.locator(".schema-children");
    const last = await guides.last().boundingBox();
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(320);
    expect(last?.width ?? 0).toBeGreaterThan(180);
  });
});
