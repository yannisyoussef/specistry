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
