import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * The Code rail in the production reader (SPEC-008 §182–§183): default
 * examples, language switching, environment/body/auth selection through
 * the URL, copy, SDK examples, operations without an SDK, keyboard use,
 * the no-JavaScript fallback, and the no-network canary: the fake target
 * API on the fixture's "local" environment (started by the Playwright
 * config for SPEC-009) records every request and must receive nothing
 * from the Code rail.
 */

const OPERATION = "/api/inboxes/create-inbox";
const CANARY = "http://127.0.0.1:47391";

async function readyRail(page: Page) {
  const rail = page.getByRole("complementary", { name: "Code" });
  await expect(rail).toBeVisible();
  // The language control exists only after hydration.
  await expect(rail.getByRole("combobox", { name: "Language" })).toBeVisible();
  return rail;
}

function visibleExample(rail: ReturnType<Page["getByRole"]>) {
  return rail.locator(".code-switcher__panel:not([hidden]) pre");
}

// One worker: the canary list is shared for the whole file.
test.describe.configure({ mode: "serial" });

test.describe("code rail", () => {
  // Every request any page of this file makes to the fake target API. The
  // API's own log is shared with the playground suite, so the page is the
  // witness here.
  const hits: string[] = [];

  test.beforeEach(({ page }) => {
    page.on("request", (request) => {
      if (request.url().startsWith(CANARY)) hits.push(request.url());
    });
  });

  test.afterAll(() => {
    expect(hits, "the target API must never be called").toEqual([]);
  });

  test("shows cURL by default and switches between all six protocol languages", async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (!request.url().startsWith("http://127.0.0.1:3100"))
        requests.push(request.url());
    });
    await page.goto(OPERATION);
    const rail = await readyRail(page);
    await expect(visibleExample(rail)).toContainText("curl --request POST");
    await expect(visibleExample(rail)).toContainText(
      "https://api.testinbox.email/v1/inboxes",
    );
    const language = rail.getByRole("combobox", { name: "Language" });
    const expectations: Record<string, string> = {
      HTTP: "POST /v1/inboxes HTTP/1.1",
      Java: "HttpClient.newHttpClient()",
      JavaScript: 'await fetch("https://api.testinbox.email/v1/inboxes"',
      Python: "requests.post(",
      TypeScript: "const init: RequestInit",
    };
    for (const [label, snippet] of Object.entries(expectations)) {
      await language.focus();
      await language.selectOption({ label });
      await expect(visibleExample(rail)).toContainText(snippet);
      // Switching never moves focus into the code.
      await expect(language).toBeFocused();
    }
    // Only one example is visible at a time; the placeholder never leaks a key.
    expect(
      await rail.locator(".code-switcher__panel:not([hidden])").count(),
    ).toBe(1);
    await expect(visibleExample(rail)).toContainText("<YOUR_API_KEY>");
    expect(requests).toEqual([]);
  });

  test("switches environment, body format, and authentication through the URL without leaving the page", async ({
    page,
  }) => {
    await page.goto(OPERATION);
    const rail = await readyRail(page);
    const environment = rail.getByRole("combobox", { name: "Environment" });
    await environment.focus();
    await environment.selectOption({ label: "Sandbox" });
    await expect(page).toHaveURL(/\?env=sandbox#code$/);
    await expect(visibleExample(rail)).toContainText(
      "https://sandbox.testinbox.email/v1/inboxes",
    );
    await expect(environment).toBeFocused();
    await rail
      .getByRole("combobox", { name: "Body format" })
      .selectOption("application/x-www-form-urlencoded");
    await expect(page).toHaveURL(
      /env=sandbox&body=application%2Fx-www-form-urlencoded#code$/,
    );
    await expect(visibleExample(rail)).toContainText(
      "Content-Type: application/x-www-form-urlencoded",
    );
    await expect(visibleExample(rail)).toContainText("--data 'ttl=3600");
    await rail
      .getByRole("combobox", { name: "Authentication" })
      .selectOption({ label: "Bearer token" });
    await expect(visibleExample(rail)).toContainText(
      "Authorization: Bearer <YOUR_ACCESS_TOKEN>",
    );
    await expect(visibleExample(rail)).not.toContainText("X-Api-Key");
    // Non-default selections are not indexed twice; the canonical stays.
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://docs.example.test/api/inboxes/create-inbox",
    );
    // The local environment points at the canary; selecting it sends nothing.
    await environment.selectOption({ label: "Local" });
    await expect(visibleExample(rail)).toContainText(
      "http://127.0.0.1:47391/v1/inboxes",
    );
    await rail
      .getByRole("combobox", { name: "Language" })
      .selectOption({ label: "JavaScript" });
    await expect(visibleExample(rail)).toContainText(
      'fetch("http://127.0.0.1:47391/v1/inboxes"',
    );
  });

  test("copies exactly the visible example", async ({
    browserName,
    context,
    page,
  }) => {
    test.skip(
      browserName !== "chromium",
      "clipboard permissions are Chromium-only in this suite",
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(OPERATION);
    const rail = await readyRail(page);
    await rail
      .getByRole("combobox", { name: "Language" })
      .selectOption({ label: "Python" });
    const copy = rail.getByRole("button", { name: "Copy Python example" });
    await copy.click();
    await expect(copy).toHaveText(/Copied/);
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard.startsWith("import requests")).toBe(true);
    expect(clipboard).toContain('"X-Api-Key": "<YOUR_API_KEY>"');
    expect(clipboard).not.toContain("Copy");
    expect(clipboard).not.toContain("Python\n");
    await expect(
      rail.getByRole("status").filter({ hasText: "Copied" }),
    ).toHaveCount(1);
  });

  test("offers authored SDK examples only where the consumer mapped them", async ({
    page,
  }) => {
    await page.goto(OPERATION);
    const rail = await readyRail(page);
    const language = rail.getByRole("combobox", { name: "Language" });
    await expect(language.locator("optgroup")).toHaveCount(2);
    await language.selectOption({ label: "TypeScript SDK" });
    await expect(visibleExample(rail)).toContainText(
      'import { TestInbox } from "@testinbox/sdk"',
    );
    await expect(
      rail.locator(".code-switcher__panel:not([hidden])"),
    ).toContainText("@testinbox/sdk");
    await expect(
      rail.locator(".code-switcher__panel:not([hidden])"),
    ).toContainText("Create an inbox");
    // The choice follows the reader to the next operation when it exists there.
    await page.goto("/api/inboxes/wait-for-message");
    const next = await readyRail(page);
    await expect(next.getByRole("combobox", { name: "Language" })).toHaveValue(
      "sdk-typescript",
    );
    await expect(visibleExample(next)).toContainText("waitForMessage");
    // An operation without a mapping has no SDK group at all, and the
    // remembered SDK choice falls back to the default protocol example.
    await page.goto("/api/inboxes/delete-inbox");
    const none = await readyRail(page);
    await expect(
      none.getByRole("combobox", { name: "Language" }).locator("optgroup"),
    ).toHaveCount(1);
    await expect(none.locator("optgroup")).toHaveAttribute("label", "Protocol");
    await expect(visibleExample(none)).toContainText("curl --request DELETE");
    await expect(none).not.toContainText("SDK example");
  });

  test("is operable from the keyboard and passes axe", async ({ page }) => {
    await page.goto(OPERATION);
    const rail = await readyRail(page);
    const language = rail.getByRole("combobox", { name: "Language" });
    await language.focus();
    // Type-ahead on the closed native select: "H" selects HTTP on every platform.
    await page.keyboard.type("H");
    await expect(visibleExample(rail)).toContainText("HTTP/1.1");
    // Reading order: the copy control, then the scrollable code region.
    await page.keyboard.press("Tab");
    await expect(
      rail.getByRole("button", { name: "Copy HTTP example" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      rail.getByRole("group", { name: "HTTP example" }),
    ).toBeFocused();
    const results = await new AxeBuilder({ page })
      .include(".code-rail")
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test("keeps the endpoint page within the HTML budget with the rail", async ({
    request,
  }) => {
    const response = await request.get(OPERATION);
    const html = await response.text();
    expect(html.length).toBeLessThan(200 * 1_024);
    // SPEC-009: the Try it tab needs script and is never in the server HTML;
    // the mobile bar link is, hidden by the layout's noscript rule.
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Coming soon");
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("shows cURL, the other languages behind a disclosure, and a working Apply form", async ({
      page,
    }) => {
      await page.goto(OPERATION);
      const rail = page.getByRole("complementary", { name: "Code" });
      await expect(
        rail.getByRole("group", { name: "cURL example" }),
      ).toBeVisible();
      await expect(
        rail.getByRole("group", { name: "Python example" }),
      ).toBeHidden();
      await rail.getByText(/Other languages \(/).click();
      await expect(
        rail.getByRole("group", { name: "Python example" }),
      ).toBeVisible();
      await expect(
        rail.getByRole("group", { name: "TypeScript SDK example" }),
      ).toBeVisible();
      await rail
        .getByRole("combobox", { name: "Environment" })
        .selectOption({ label: "Sandbox" });
      await rail.getByRole("button", { name: "Apply" }).click();
      await expect(page).toHaveURL(/\?env=sandbox/);
      await expect(
        rail.getByRole("group", { name: "cURL example" }),
      ).toContainText("https://sandbox.testinbox.email/v1/inboxes");
    });
  });
});
