import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Search in the production reader (SPEC-007 §115–121): the header trigger,
 * the shortcut, the lazily loaded palette, exact/prefix/fuzzy queries,
 * keyboard selection, navigation to validated destinations, Escape and focus
 * restoration, status announcements, hostile text, artifact caching, CSP,
 * and the no-JavaScript fallback.
 */

const EDGE_URL = "http://127.0.0.1:3101";

async function openSearch(page: Page): Promise<void> {
  // The shortcut listener exists only after hydration; the key cap in the
  // trigger renders at the same moment, so it is the readiness signal.
  await expect(page.locator(".search-trigger kbd")).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Search documentation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Search documentation" }),
  ).toBeFocused();
}

async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

test.describe("search", () => {
  test("opens by click and by shortcut, loads the index lazily, and closes with focus restored", async ({
    page,
  }) => {
    const scripts: string[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "script")
        scripts.push(response.url());
    });
    const violations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text()))
        violations.push(message.text());
    });
    await page.goto("/docs/quickstart");
    await page.waitForLoadState("networkidle");
    const before = scripts.length;
    const trigger = page.getByRole("button", { name: /Search…/ });
    await expect(trigger).toBeVisible();
    await expect(trigger.locator("kbd")).toHaveText(/⌘K|Ctrl K/);
    // No index or palette code before the first open.
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((entry) => entry.name.includes("/search/index.")),
      ),
    ).toBe(false);
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Search documentation" });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Search documentation" }),
    ).toBeFocused();
    await expect(page.getByText(/Type to search guides/)).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(scripts.length).toBeGreaterThan(before);
    const index = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/search/index."))
        .map((entry) => entry.name),
    );
    expect(index).toHaveLength(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await openSearch(page);
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(violations).toEqual([]);
  });

  test("finds exact endpoints, prefixes, and typos, and navigates on Enter", async ({
    page,
  }) => {
    await page.goto("/");
    await openSearch(page);
    const input = page.getByRole("combobox", { name: "Search documentation" });
    await input.fill("create inbox");
    const options = page.getByRole("option");
    await expect(options.first()).toContainText("Create inbox");
    await expect(options.first()).toContainText("POST /inboxes");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await expect(input).toHaveAttribute(
      "aria-activedescendant",
      (await options.first().getAttribute("id")) ?? "",
    );
    await expect(
      page.getByRole("group", { name: "API reference" }),
    ).toBeVisible();
    await expect(page.locator(".search__footer")).toContainText(
      /\d+ results · \d+ ms/,
    );
    await expect(page.locator(".search__match").first()).toHaveText("Create");
    await input.fill("auth");
    await expect(options.first()).toContainText("Authentication");
    await input.fill("authentcation");
    await expect(options.first()).toContainText("Authentication");
    await input.fill("POST /v1/inboxes");
    await expect(options.first()).toContainText("Create inbox");
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await expect(options.first()).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/api\/inboxes\/create-inbox$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Create inbox",
    );
  });

  test("returns guide sections with their heading anchor and announces counts", async ({
    page,
  }) => {
    await page.goto("/api/inboxes");
    await openSearch(page);
    const input = page.getByRole("combobox", { name: "Search documentation" });
    await input.fill("bearer token");
    const first = page.getByRole("option").first();
    await expect(first).toContainText("Bearer tokens");
    await expect(first).toContainText(
      "Guides › Getting started › Authentication",
    );
    await expect(
      page
        .getByRole("dialog", { name: "Search documentation" })
        .getByRole("status"),
    ).toHaveText(/\d+ results?\./, { timeout: 2_000 });
    await first.click();
    await expect(page).toHaveURL(/\/docs\/authentication#bearer-tokens$/);
    await expect(page.locator("#bearer-tokens")).toBeVisible();
    const top = await page
      .locator("#bearer-tokens")
      .evaluate((node) => node.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(52);
  });

  test("shows the no-results state, keeps hostile text inert, and bounds the query", async ({
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
    await openSearch(page);
    const input = page.getByRole("combobox", { name: "Search documentation" });
    await input.fill("zzzzqq");
    await expect(page.getByText(/No results for “zzzzqq”/)).toBeVisible();
    const dialog = page.getByRole("dialog", { name: "Search documentation" });
    await expect(dialog.getByRole("status")).toHaveText(
      "No results for “zzzzqq”.",
      { timeout: 2_000 },
    );
    await input.fill("<script>alert(1)</script>");
    await expect(dialog.getByRole("option").first()).toBeVisible();
    expect(await dialog.locator("script, img").count()).toBe(0);
    await input.fill("__proto__ constructor prototype");
    await input.fill("x".repeat(5_000));
    expect((await input.inputValue()).length).toBeLessThanOrEqual(200);
    await page.keyboard.press("Escape");
    expect(alerts).toEqual([]);
    expect(errors).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("renders long results without overflow in light, dark, and forced colours", async ({
    page,
  }) => {
    await page.goto(`${EDGE_URL}/api`);
    await openSearch(page);
    const input = page.getByRole("combobox", { name: "Search documentation" });
    await input.fill("long");
    await expect(page.getByRole("option").first()).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    const panel = page.locator(".search__panel");
    const box = await panel.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(641);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.emulateMedia({ colorScheme: "dark" });
    const background = await panel.evaluate(
      (node) => getComputedStyle(node).backgroundColor,
    );
    expect(background).not.toBe("rgba(0, 0, 0, 0)");
    await page.emulateMedia({ forcedColors: "active" });
    const outline = await page
      .locator(".search__result--active")
      .evaluate((node) => getComputedStyle(node).outlineStyle);
    expect(outline).toBe("solid");
  });

  test("serves the index only under its content-addressed name with immutable caching", async ({
    page,
    request,
  }) => {
    const html = await (await request.get("/")).text();
    expect(html).not.toContain("searchVersion");
    const build = await request.get("/docs/quickstart");
    expect(build.status()).toBe(200);
    await page.goto("/");
    await openSearch(page);
    const indexUrl = await page.evaluate(
      () =>
        performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((name) => name.includes("/search/index.")) ?? "",
    );
    expect(indexUrl).toMatch(/\/search\/index\.[a-f0-9]{16}\.json$/);
    const artifact = await request.get(indexUrl);
    expect(artifact.status()).toBe(200);
    expect(artifact.headers()["cache-control"]).toContain("immutable");
    expect(artifact.headers()["content-type"]).toContain("application/json");
    expect((await artifact.json()) as { searchVersion: number }).toMatchObject({
      searchVersion: 1,
    });
    for (const path of [
      "/search/index.0000000000000000.json",
      "/search/index.json",
      "/search/..%2fmanifest.json",
      "/search/search.json",
    ]) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("hides the search trigger and keeps navigation usable", async ({
      page,
    }) => {
      await page.goto("/docs/quickstart");
      await expect(page.locator(".search-trigger")).toBeHidden();
      await expect(
        page.getByRole("complementary", { name: "Documentation navigation" }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Quickstart",
      );
    });
  });
});
