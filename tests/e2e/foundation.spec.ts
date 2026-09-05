import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("serves indexable, keyboard-accessible foundation HTML with security headers", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response).not.toBeNull();
  expect(response?.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(response?.headers()["permissions-policy"]).toContain("camera=()");
  expect(response?.headers()["referrer-policy"]).toBe(
    "strict-origin-when-cross-origin",
  );
  expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await page.title()).toBe("Specra");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /self-hosted, product-agnostic/i,
  );

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("does not create horizontal page overflow at a 320px viewport", async ({
  page,
}) => {
  await page.setViewportSize({ height: 640, width: 320 });
  await page.goto("/");
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});
