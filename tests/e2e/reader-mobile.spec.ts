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
      page.getByRole("complementary", { name: "API navigation" }),
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
        name: "API navigation",
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
