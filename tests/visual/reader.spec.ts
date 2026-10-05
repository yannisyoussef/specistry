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
/** The two-release fixture served in release mode (SPEC-010) on port 3102. */
const VERSIONED_URL = "http://127.0.0.1:3102";

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

/**
 * Authored content states (SPEC-006): the homepage, a guide with every
 * component, tables and hostile text, a folder page with an image, the
 * composed drawer, and the authored 404, across modes and viewports.
 */
test.describe("authored content", () => {
  test("homepage · desktop light and dark, mobile light", async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/", "light");
    await expect(page).toHaveScreenshot("docs-home-desktop-light.png");
    await settle(page, "/", "dark");
    await expect(page).toHaveScreenshot("docs-home-desktop-dark.png");
    await page.setViewportSize(viewports.mobile);
    await settle(page, "/", "light");
    await expect(page).toHaveScreenshot("docs-home-mobile-light.png", {
      fullPage: true,
    });
  });

  test("quickstart guide · callout, steps, tabs, cards, pager", async ({
    page,
  }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/docs/quickstart", "light");
    await expect(page).toHaveScreenshot("docs-quickstart-desktop-light.png");
    await settle(page, "/docs/quickstart#choose-your-client", "dark");
    await expect(page).toHaveScreenshot(
      "docs-quickstart-tabs-desktop-dark.png",
    );
    await page.setViewportSize(viewports.laptop);
    await settle(page, "/docs/quickstart#where-next", "light");
    await expect(page).toHaveScreenshot(
      "docs-quickstart-cards-laptop-light.png",
    );
    await page.setViewportSize(viewports.mobile);
    await settle(page, "/docs/quickstart", "dark");
    await expect(page).toHaveScreenshot("docs-quickstart-mobile-dark.png", {
      fullPage: true,
    });
  });

  test("tables, hostile text, code with a title, and an image", async ({
    page,
  }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/docs/troubleshooting", "light");
    await expect(page).toHaveScreenshot("docs-table-desktop-light.png", {
      fullPage: true,
    });
    await settle(page, "/docs/guides/ci-integration", "dark");
    await expect(page).toHaveScreenshot("docs-code-desktop-dark.png");
    await page.setViewportSize(viewports.mobile);
    await settle(page, "/docs/concepts/inbox-lifecycle", "light");
    await expect(page).toHaveScreenshot("docs-image-mobile-light.png", {
      fullPage: true,
    });
  });

  test("composed drawer and the authored 404", async ({ page }) => {
    await page.setViewportSize(viewports.mobile);
    await settle(page, "/docs/guides/attachments", "dark");
    await page.getByRole("link", { name: "Navigation" }).click();
    await expect(
      page.getByRole("dialog", { name: "Navigation" }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("docs-drawer-mobile-dark.png");
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/docs/missing-page", "light");
    await expect(page).toHaveScreenshot("docs-not-found-desktop-light.png");
  });
});

/**
 * Search states (SPEC-007 §113): the header trigger is part of every page
 * baseline; these capture the palette itself.
 */
test.describe("search", () => {
  const open = async (
    page: Page,
    query: string,
    down = 0,
    expectResults = true,
  ) => {
    await expect(page.locator(".search-trigger kbd")).toBeVisible();
    await page.keyboard.press("Control+k");
    await expect(
      page.getByRole("dialog", { name: "Search documentation" }),
    ).toBeVisible();
    if (query.length > 0) {
      await page
        .getByRole("combobox", { name: "Search documentation" })
        .fill(query);
      if (expectResults) {
        await expect(page.getByRole("option").first()).toBeVisible();
      }
    }
    for (let index = 0; index < down; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await page.evaluate(() => document.fonts.ready);
  };

  test("desktop · empty, results, dark, exact endpoint, keyboard selection", async ({
    page,
  }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/docs/quickstart", "light");
    await open(page, "");
    await expect(page).toHaveScreenshot("search-empty-desktop-light.png");
    await page.keyboard.press("Escape");
    await open(page, "create inbox");
    await expect(page).toHaveScreenshot("search-results-desktop-light.png");
    await page.keyboard.press("Escape");
    await open(page, "POST /inboxes");
    await expect(page).toHaveScreenshot("search-exact-desktop-light.png");
    await page.keyboard.press("Escape");
    await open(page, "authentication", 2);
    await expect(page).toHaveScreenshot("search-selected-desktop-light.png");
    await settle(page, "/docs/quickstart", "dark");
    await open(page, "create inbox");
    await expect(page).toHaveScreenshot("search-results-desktop-dark.png");
  });

  test("desktop · no results and long results", async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/", "light");
    await open(page, "zzzzqq", 0, false);
    await expect(page.getByText(/No results for “zzzzqq”/)).toBeVisible();
    await expect(page).toHaveScreenshot("search-no-results-desktop-light.png");
    await settle(page, "/api", "light", EDGE_URL);
    await open(page, "long");
    await expect(page).toHaveScreenshot("search-long-desktop-light.png");
  });

  test("mobile · 375 and 320", async ({ page }) => {
    await page.setViewportSize(viewports.mobile);
    await settle(page, "/docs/quickstart", "light");
    await page.locator(".search-trigger").click();
    await page
      .getByRole("combobox", { name: "Search documentation" })
      .fill("create inbox");
    await expect(page.getByRole("option").first()).toBeVisible();
    await expect(page).toHaveScreenshot("search-mobile-375-light.png");
    await page.setViewportSize({ height: 640, width: 320 });
    await settle(page, "/docs/quickstart", "dark");
    await page.locator(".search-trigger").click();
    await page
      .getByRole("combobox", { name: "Search documentation" })
      .fill("attachments");
    await expect(page.getByRole("option").first()).toBeVisible();
    await expect(page).toHaveScreenshot("search-mobile-320-dark.png");
  });
});

/**
 * Code rail states (SPEC-008 §143): the endpoint with the rail on desktop
 * in both modes, each protocol language, a JSON and a multipart body, an
 * auth alternative, an operation with and without SDK mappings, the laptop
 * width, the folded tablet section, mobile 375 and 320, and a long snippet.
 * Language panels are selected through the real control after hydration.
 */
test.describe("code rail", () => {
  const rail = (page: Page) =>
    page.getByRole("complementary", { name: "Code" });

  async function selectLanguage(page: Page, label: string): Promise<void> {
    const control = rail(page).getByRole("combobox", { name: "Language" });
    await expect(control).toBeVisible();
    await control.selectOption({ label });
    await expect(
      rail(page).locator(".code-switcher__panel:not([hidden])"),
    ).toBeVisible();
  }

  test("endpoint with rail · desktop light and dark", async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, OPERATION, "light");
    await selectLanguage(page, "cURL");
    await expect(page).toHaveScreenshot("code-rail-desktop-light.png");
    await settle(page, OPERATION, "dark");
    await selectLanguage(page, "cURL");
    await expect(page).toHaveScreenshot("code-rail-desktop-dark.png");
  });

  test("every protocol language on the rail", async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, OPERATION, "light");
    for (const [label, name] of [
      ["HTTP", "http"],
      ["JavaScript", "javascript"],
      ["TypeScript", "typescript"],
      ["Java", "java"],
      ["Python", "python"],
    ] as const) {
      await selectLanguage(page, label);
      await expect(rail(page)).toHaveScreenshot(`code-language-${name}.png`);
    }
  });

  test("multipart body, bearer alternative, SDK example, and no SDK", async ({
    page,
  }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/api/domains/upload-domain-logo", "light");
    await selectLanguage(page, "cURL");
    await expect(rail(page)).toHaveScreenshot("code-multipart-curl.png");
    await settle(page, `${OPERATION}?auth=1`, "dark");
    await selectLanguage(page, "HTTP");
    await expect(rail(page)).toHaveScreenshot("code-auth-bearer-http.png");
    await settle(page, OPERATION, "light");
    await selectLanguage(page, "TypeScript SDK");
    await expect(rail(page)).toHaveScreenshot("code-sdk-typescript.png");
    await settle(page, "/api/inboxes/delete-inbox", "light");
    await selectLanguage(page, "cURL");
    await expect(rail(page)).toHaveScreenshot("code-no-sdk.png");
  });

  test("laptop 1366, tablet 1024 inline section, mobile 375 and 320", async ({
    page,
  }) => {
    await page.setViewportSize(viewports.laptop);
    await settle(page, OPERATION, "light");
    await selectLanguage(page, "cURL");
    await expect(page).toHaveScreenshot("code-rail-laptop-light.png");
    await page.setViewportSize({ height: 768, width: 1024 });
    await settle(page, OPERATION, "light");
    await selectLanguage(page, "cURL");
    await expect(page).toHaveScreenshot("code-inline-tablet-light.png");
    await page.setViewportSize(viewports.mobile);
    await settle(page, OPERATION, "dark");
    await selectLanguage(page, "cURL");
    await expect(page).toHaveScreenshot("code-mobile-375-dark.png");
    await page.setViewportSize({ height: 640, width: 320 });
    await settle(page, OPERATION, "light");
    await selectLanguage(page, "Java");
    await expect(page).toHaveScreenshot("code-mobile-320-light.png");
  });

  test("long snippet scrolls inside its surface", async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/api/webhooks/create-webhook", "dark");
    await selectLanguage(page, "Java");
    await expect(rail(page)).toHaveScreenshot("code-long-java-dark.png");
  });
});

/**
 * Playground states (SPEC-009 §145): the Try it form on the rail in both
 * modes, a completed response, a failure, the partial-capability
 * explanation, the mobile bar with its Try it action, and the folded tablet
 * section. The fake target API answers from the fixture's local environment.
 */
test.describe("playground", () => {
  const rail = (page: Page) =>
    page.getByRole("complementary", { name: "Code" });

  async function openTryIt(page: Page, path: string, mode: "dark" | "light") {
    await settle(page, path, mode);
    await rail(page).getByRole("tab", { name: "Try it" }).click();
    const panel = rail(page).getByRole("tabpanel", { name: "Try it" });
    await expect(panel.getByRole("button", { name: /^Send / })).toBeVisible();
    return panel;
  }

  test("form on the rail · desktop light and dark", async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    await openTryIt(page, "/api/inboxes/get-inbox", "light");
    await expect(page).toHaveScreenshot("playground-form-desktop-light.png");
    await openTryIt(page, "/api/inboxes/get-inbox", "dark");
    await expect(page).toHaveScreenshot("playground-form-desktop-dark.png");
  });

  test("response, failure, and validation states", async ({ page }) => {
    await page.setViewportSize(viewports.desktop);
    const panel = await openTryIt(page, "/api/inboxes/get-inbox", "light");
    await panel.getByLabel("Environment").selectOption({ label: "Local" });
    await panel.getByLabel("X-Api-Key header").fill("visual-key");
    await panel.getByLabel(/inboxId/).fill("inb_42");
    await panel.getByRole("button", { name: "Send GET request" }).click();
    await expect(panel.locator(".try-it__response")).toContainText("200 OK");
    await expect(rail(page)).toHaveScreenshot("playground-response-light.png");
    await panel.getByLabel(/inboxId/).fill("__redirect");
    await panel.getByRole("button", { name: "Send GET request" }).click();
    await expect(panel.locator(".try-it__response")).toContainText(
      "Request failed",
    );
    await expect(rail(page)).toHaveScreenshot("playground-blocked-light.png");
    const invalid = await openTryIt(page, "/api/inboxes/get-inbox", "dark");
    await invalid.getByRole("button", { name: "Send GET request" }).click();
    await expect(invalid.getByText("inboxId is required.")).toBeVisible();
    await expect(rail(page)).toHaveScreenshot("playground-invalid-dark.png");
  });

  test("JSON body editor and a partially supported operation", async ({
    page,
  }) => {
    await page.setViewportSize(viewports.desktop);
    await openTryIt(page, "/api/inboxes/create-inbox", "light");
    await expect(rail(page)).toHaveScreenshot("playground-json-body-light.png");
    await openTryIt(page, "/api/webhooks/create-webhook", "dark");
    await expect(rail(page)).toHaveScreenshot(
      "playground-partial-auth-dark.png",
    );
  });

  test("tablet inline section and mobile bar with Try it", async ({ page }) => {
    await page.setViewportSize({ height: 768, width: 1024 });
    await openTryIt(page, "/api/inboxes/get-inbox", "light");
    await expect(page).toHaveScreenshot("playground-tablet-light.png");
    await page.setViewportSize(viewports.mobile);
    await settle(page, "/api/inboxes/get-inbox", "dark");
    await page
      .getByRole("navigation", { name: "Code" })
      .getByRole("link", { name: "Try it" })
      .click();
    await expect(
      rail(page)
        .getByRole("tabpanel", { name: "Try it" })
        .getByRole("button", {
          name: /^Send /,
        }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("playground-mobile-375-dark.png");
  });
});

/**
 * Versioning states (SPEC-010 §197): the header version menu open on the
 * current release, a deprecated historical page with its banner, the
 * published changelog, and a historical operation page whose rail keeps
 * Code but explains where Try it lives, on desktop and on a phone.
 */
test.describe("versioning", () => {
  test("version menu open and historical banner · desktop", async ({
    page,
  }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/docs/v2/quickstart", "light", VERSIONED_URL);
    await page.locator(".version-menu summary").click();
    await expect(
      page.getByRole("list", { name: "Documentation versions" }),
    ).toBeVisible();
    await expect(page).toHaveScreenshot("versioning-menu-desktop-light.png");
    await settle(page, "/docs/v1/getting-started", "dark", VERSIONED_URL);
    await expect(page).toHaveScreenshot(
      "versioning-deprecated-desktop-dark.png",
    );
  });

  test("changelog page and historical operation · desktop", async ({
    page,
  }) => {
    await page.setViewportSize(viewports.desktop);
    await settle(page, "/docs/v2/changelog", "light", VERSIONED_URL);
    await expect(page).toHaveScreenshot(
      "versioning-changelog-desktop-light.png",
      {
        fullPage: true,
      },
    );
    await settle(
      page,
      "/api/v1/inboxes/get-raw-message",
      "light",
      VERSIONED_URL,
    );
    await expect(page).toHaveScreenshot(
      "versioning-historical-operation-desktop-light.png",
    );
  });

  test("deprecated page and changelog · mobile", async ({ page }) => {
    await page.setViewportSize(viewports.mobile);
    await settle(page, "/docs/v1/getting-started", "light", VERSIONED_URL);
    await expect(page).toHaveScreenshot(
      "versioning-deprecated-mobile-light.png",
    );
    await settle(page, "/docs/v2/changelog", "dark", VERSIONED_URL);
    await expect(page).toHaveScreenshot(
      "versioning-changelog-mobile-dark.png",
      {
        fullPage: true,
      },
    );
  });
});
