import { expect, test, type Page } from "@playwright/test";

/**
 * Visual baselines for the approved reader design. Screenshots use the
 * self-hosted fonts, a fixed viewport, disabled animations, and the committed
 * TestInbox fixture, so they are deterministic per platform. Baselines are
 * generated on Linux (the CI platform) through the Playwright container; see
 * `docs/development/testing.md` for the update procedure and difference policy.
 */

const OPERATION = "/api/inboxes/create-inbox";
const TESTINBOX_URL = "http://127.0.0.1:3100";
/** The edge fixture (long names, many responses, hostile text) on port 3101. */
const EDGE_URL = "http://127.0.0.1:3101";

async function settle(
  page: Page,
  path: string,
  mode: "dark" | "light",
  origin = TESTINBOX_URL,
): Promise<void> {
  await page
    .context()
    .addCookies([{ name: "specra-mode", url: origin, value: mode }]);
  await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
}

const viewports = {
  desktop: { height: 900, width: 1440 },
  laptop: { height: 768, width: 1366 },
  mobile: { height: 812, width: 375 },
} as const;

for (const [name, viewport] of Object.entries(viewports)) {
  for (const mode of ["light", "dark"] as const) {
    test(`operation page · ${name} · ${mode}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await settle(page, OPERATION, mode);
      await expect(page).toHaveScreenshot(`operation-${name}-${mode}.png`, {
        fullPage: name === "mobile",
      });
    });
  }
}

test("operation states · deprecated, body-less, long names, multiple responses", async ({
  page,
}) => {
  await page.setViewportSize(viewports.desktop);
  await settle(page, "/api/messages/mark-message-read", "light");
  await expect(page).toHaveScreenshot("operation-deprecated-desktop-light.png");
  await settle(page, "/api/webhooks/delete-webhook", "light");
  await expect(page).toHaveScreenshot("operation-bodyless-desktop-light.png");
  await settle(page, "/api/attachments/download-attachment", "dark");
  await expect(page).toHaveScreenshot("operation-long-names-desktop-dark.png", {
    fullPage: true,
  });
});

test("edge fixture · long identifiers, many responses, hostile text", async ({
  page,
}) => {
  await page.setViewportSize(viewports.desktop);
  await settle(
    page,
    "/api/operations/extremely-long-path-operation-name-that-should-wrap-gracefully-on-narrow",
    "light",
    EDGE_URL,
  );
  await expect(page).toHaveScreenshot("edge-long-path-desktop-light.png", {
    fullPage: true,
  });
  await settle(page, "/api/operations/many-responses", "dark", EDGE_URL);
  await expect(page).toHaveScreenshot("edge-many-responses-desktop-dark.png", {
    fullPage: true,
  });
  await page.setViewportSize({ height: 640, width: 320 });
  await settle(page, "/api/operations/schema-shapes", "light", EDGE_URL);
  await expect(page).toHaveScreenshot("edge-schema-shapes-narrow-light.png", {
    fullPage: true,
  });
});

test("navigation · long sidebar and reference index", async ({ page }) => {
  await page.setViewportSize(viewports.laptop);
  await settle(page, "/api", "light");
  await expect(page).toHaveScreenshot("reference-laptop-light.png");
  await page.setViewportSize(viewports.mobile);
  await settle(page, OPERATION, "light");
  await page.getByRole("link", { name: "Navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  await expect(page).toHaveScreenshot("drawer-mobile-light.png");
});

/**
 * Schema renderer states (SPEC-005): the same fixtures the browser suite
 * asserts semantically, captured for the approved Glass design.
 */
test.describe("schema renderer", () => {
  test("simple object · desktop light and dark", async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/api/inboxes/create-inbox#request-body", "light");
    await expect(page).toHaveScreenshot("schema-object-desktop-light.png");
    await settle(page, "/api/inboxes/create-inbox#request-body", "dark");
    await expect(page).toHaveScreenshot("schema-object-desktop-dark.png");
  });

  test("oneOf with discriminator, expanded variant, and recursion marker", async ({
    page,
  }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/api/messages/get-message#responses", "light");
    const response = page.locator("#response-200-application-json");
    await response.locator("summary", { hasText: "3 variants" }).click();
    await response.locator("summary", { hasText: "MultipartContent" }).click();
    await response.locator("summary", { hasText: /^items of parts$/ }).click();
    await response.scrollIntoViewIfNeeded();
    await expect(page).toHaveScreenshot("schema-variants-desktop-light.png", {
      fullPage: true,
    });
  });

  test("composed allOf and deep nesting · dark", async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/api/webhooks/create-webhook#responses", "dark");
    const response = page.locator("#response-201-application-json");
    await response.scrollIntoViewIfNeeded();
    await expect(page).toHaveScreenshot("schema-allof-desktop-dark.png", {
      fullPage: true,
    });
    await settle(page, "/api/operations/schema-shapes", "dark", EDGE_URL);
    const deep = page.locator(".schema-row", { hasText: /^deepTree/ }).first();
    await deep.locator("summary").first().click();
    await deep.scrollIntoViewIfNeeded();
    await expect(page).toHaveScreenshot("schema-deep-desktop-dark.png");
  });

  test("large schema bounded state and focused view", async ({ page }) => {
    await page.setViewportSize(viewports.laptop);
    await settle(
      page,
      "/api/operations/schema-shapes?schema=response-200-application-json&at=p22",
      "light",
      EDGE_URL,
    );
    await expect(page).toHaveScreenshot("schema-large-focus-laptop-light.png");
  });

  test("read and write context difference", async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/api/operations/replace-profile", "light", EDGE_URL);
    await page.locator("#request-body").scrollIntoViewIfNeeded();
    await expect(page).toHaveScreenshot("schema-context-desktop-light.png", {
      fullPage: true,
    });
  });

  test("complex schema on mobile · 375 and 320", async ({ page }) => {
    // Disclosure state is set directly: this captures the open layout, while
    // the mobile browser suite proves the taps themselves.
    const openVariants = async () => {
      const response = page.locator("#response-200-application-json");
      await response
        .locator("details")
        .filter({ has: page.locator("summary", { hasText: "3 variants" }) })
        .first()
        .evaluate((node) => {
          (node as HTMLDetailsElement).open = true;
        });
      await response
        .locator("details.schema-variant__details")
        .nth(1)
        .evaluate((node) => {
          (node as HTMLDetailsElement).open = true;
        });
    };
    await page.setViewportSize(viewports.mobile);
    await settle(page, "/api/messages/get-message#responses", "light");
    await openVariants();
    await expect(page).toHaveScreenshot("schema-mobile-375-light.png", {
      fullPage: true,
    });
    await page.setViewportSize({ height: 640, width: 320 });
    await settle(page, "/api/messages/get-message#responses", "dark");
    await openVariants();
    await expect(page).toHaveScreenshot("schema-mobile-320-dark.png", {
      fullPage: true,
    });
  });
});
