import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Browser coverage for the API reference against the TestInbox fixture served
 * by `next start` (see playwright.config.ts). Assertions are semantic: roles,
 * names, headers, focus, and layout invariants rather than pixels.
 */

const OPERATION = "/api/inboxes/create-inbox";
/** The adversarial fixture served by the second reader (playwright.config.ts). */
const EDGE_URL = "http://127.0.0.1:3101";
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
  test("applies the policy to prefetch-shaped requests and ignores spoofed internal headers", async ({
    request,
  }) => {
    for (const headers of [
      { purpose: "prefetch" },
      { "sec-purpose": "prefetch" },
      { "next-router-prefetch": "1" },
      { "x-specra-pathname": "/api/inboxes/get-inbox" },
    ]) {
      const response = await request.get(OPERATION, { headers });
      expect(response.status(), JSON.stringify(headers)).toBe(200);
      expect(response.headers()["content-security-policy"]).toMatch(
        /script-src 'self' 'nonce-/,
      );
      // The current item comes from the real URL, never from the header.
      const html = await response.text();
      expect(html).toContain(
        'aria-current="page" class="nav-item" href="/api/inboxes/create-inbox"',
      );
    }
  });

  test("accepts theme changes only from same-origin form posts", async ({
    request,
  }) => {
    const get = await request.get("/theme", { maxRedirects: 0 });
    expect(get.status()).toBe(405);
    const crossSite = await request.post("/theme", {
      form: { mode: "dark", return: "/api" },
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      maxRedirects: 0,
    });
    expect(crossSite.status()).toBe(403);
    expect(crossSite.headers()["set-cookie"]).toBeUndefined();
    const openRedirect = await request.post("/theme", {
      form: { mode: "dark", return: "//evil.example/phish" },
      headers: { "sec-fetch-site": "same-origin" },
      maxRedirects: 0,
    });
    expect(openRedirect.status()).toBe(303);
    expect(openRedirect.headers()["location"]).toBe("/");
    expect(openRedirect.headers()["set-cookie"]).toContain("specra-mode=dark");
    expect(openRedirect.headers()["set-cookie"]).toContain("HttpOnly");
    expect(openRedirect.headers()["set-cookie"]).toContain("SameSite=lax");
  });

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
    const copy = page.getByRole("button", { name: "Copy POST /inboxes" });
    await copy.focus();
    await expect(copy).toBeFocused();
    // The focus ring is an opaque outline, so it survives forced-colors mode.
    const ring = await copy.evaluate((node) => {
      const style = getComputedStyle(node);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    });
    expect(ring).toBe("solid 3px");
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await copy.click();
    await expect(copy).toHaveText("✓ Copied");
    await expect(page.getByRole("status")).toHaveText("Copied POST /inboxes");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "POST /inboxes",
    );
  });

  test("keeps a visible focus ring and panel borders in forced-colors mode", async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(OPERATION);
    const link = page
      .getByRole("complementary", { name: "API navigation" })
      .getByRole("link", { name: /Create inbox/ });
    await link.focus();
    const outline = await link.evaluate(
      (node) => getComputedStyle(node).outlineStyle,
    );
    expect(outline).toBe("solid");
    const border = await page
      .locator("main")
      .evaluate((node) => getComputedStyle(node).borderTopStyle);
    expect(border).toBe("solid");
  });

  test("renders the glass surfaces with a real backdrop blur", async ({
    page,
  }) => {
    await page.goto(OPERATION);
    const filter = await page
      .locator("header")
      .evaluate((node) => getComputedStyle(node).backdropFilter);
    expect(filter).toContain("blur(");
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
      "/not-found",
    ]) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Page not found",
      );
      await expect(page.locator("html")).not.toHaveAttribute("data-mode", /./);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("serves the 404 page, navigation, and the copy-free operation as HTML", async ({
      page,
    }) => {
      const missing = await page.goto("/api/inboxes/nope");
      expect(missing?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Page not found",
      );
      await expect(
        page.getByRole("main").getByRole("link", { name: "API reference" }),
      ).toHaveAttribute("href", "/api");
      await page.goto(OPERATION);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Create inbox",
      );
      await expect(
        page.getByRole("complementary", { name: "API navigation" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Dark" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
    });
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

  test("renders the adversarial fixture as inert text end to end", async ({
    page,
  }) => {
    const alerts: string[] = [];
    page.on("dialog", (dialog) => {
      alerts.push(dialog.message());
      void dialog.dismiss();
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${EDGE_URL}/api/operations/legacy-lookup`);
    await expect(page).toHaveTitle(
      "Legacy lookup <b>bold?</b> | Edge cases API",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Legacy lookup <b>bold?</b>",
    );
    await expect(page.locator("main")).toContainText(
      "<script>alert(1)</script>",
    );
    expect(await page.locator("main script").count()).toBe(0);
    expect(await page.locator("main img").count()).toBe(0);
    // Hostile server URLs are text, never links.
    await page.goto(`${EDGE_URL}/api/operations/plain-operation`);
    const servers = page.getByRole("region", { name: "Servers" });
    await expect(servers).toContainText("javascript:alert(1)");
    expect(await servers.locator('a[href^="javascript"]').count()).toBe(0);
    expect(alerts).toEqual([]);
    expect(errors).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
});

test.describe("schema renderer", () => {
  test("renders nested schemas as native disclosures that work with the keyboard", async ({
    page,
  }) => {
    await page.goto("/api/messages/get-message");
    const response = page.locator("#response-200-application-json");
    await expect(response.locator(".media-block__context")).toHaveText(
      "Response schema",
    );
    // Recursion is a marker, never inline expansion: MultipartContent parts
    // reference MessageContent, which is already open above.
    await expect(
      response.getByText("Exactly one of the following:"),
    ).toBeHidden();
    const summary = response.locator("summary", { hasText: "3 variants" });
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Enter");
    expect(
      await summary.evaluate(
        (node) => (node.parentElement as HTMLDetailsElement).open,
      ),
    ).toBe(true);
    await expect(summary).toBeFocused();
    await expect(
      response.getByText("Exactly one of the following:"),
    ).toBeVisible();
    const multipart = response.locator("summary", {
      hasText: "MultipartContent",
    });
    await multipart.focus();
    await page.keyboard.press("Space");
    await expect(
      response.getByText("Nested parts; a part may itself be multipart."),
    ).toBeVisible();
    await response.locator("summary", { hasText: /^items of parts$/ }).click();
    await expect(response.getByText("recursive").first()).toBeVisible();
    expect(
      await response.locator("[role='tree'], [role='treeitem']").count(),
    ).toBe(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("links discriminator values to their variants and opens a focused view with a trail", async ({
    page,
  }) => {
    await page.goto("/api/messages/get-message");
    const response = page.locator("#response-200-application-json");
    await response.locator("summary", { hasText: "3 variants" }).click();
    await response.getByRole("link", { name: "HtmlContent" }).first().click();
    await expect(page).toHaveURL(/#response-200-application-json--p\d+-v1$/);
    await expect(page.locator(".schema-variant__details:target")).toContainText(
      "HtmlContent",
    );
    await page
      .getByRole("link", { name: "Open MessageContent" })
      .first()
      .click();
    await expect(page).toHaveURL(
      /\/api\/messages\/get-message\?schema=response-200-application-json&at=p\d+$/,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("content");
    await expect(
      page.getByRole("navigation", { name: "Schema position" }),
    ).toContainText("Response 200 · application/json");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/api\/messages\/get-message$/,
    );
    await expect(page.getByText("Exactly one of the following:")).toBeVisible();
    await page.getByRole("link", { name: /Back to Get message/ }).click();
    await expect(page).toHaveURL(
      /\/api\/messages\/get-message#response-200-application-json$/,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("redirects malformed or unknown schema queries to the operation", async ({
    request,
  }) => {
    for (const query of [
      "schema=../../etc",
      "schema=response-200-application-json&at=p0/..",
      "schema=nope",
      "schema=response-200-application-json&at=p99",
      "schema=response-200-application-json&at=%3Cscript%3E",
    ]) {
      const response = await request.get(`/api/messages/get-message?${query}`, {
        maxRedirects: 0,
      });
      expect(response.status(), query).toBe(307);
      expect(response.headers()["location"], query).toMatch(
        /\/api\/messages\/get-message$/,
      );
    }
  });

  test("keeps request and response context apart for the same referenced schema", async ({
    page,
  }) => {
    await page.goto(`${EDGE_URL}/api/operations/replace-profile`);
    const request = page.locator("#request-body-application-json");
    const response = page.locator("#response-200-application-json");
    await expect(request).toContainText(
      "Not sent in requests (read-only): id, createdAt",
    );
    await expect(request).toContainText("password");
    await expect(
      request.locator(".row__name", { hasText: /^id$/ }),
    ).toHaveCount(0);
    await expect(response).toContainText(
      "Not returned in responses (write-only): password, recoveryEmail",
    );
    await expect(
      response.locator(".row__name", { hasText: /^password$/ }),
    ).toHaveCount(0);
    await expect(
      response.locator(".row__name", { hasText: /^id$/ }),
    ).toHaveCount(1);
  });

  test("bounds hostile and oversized schemas and keeps every string inert", async ({
    page,
    request,
  }) => {
    const raw = await request.get(`${EDGE_URL}/api/operations/schema-shapes`);
    const html = await raw.text();
    // Complex-page HTML budget: the largest fixture page (250-property object,
    // 300-value enum, 25 variants, deep chain, 2,000-character name) stays
    // under 512 KiB uncompressed; the TestInbox pages stay under 200 KiB.
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(512 * 1_024);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => void dialog.dismiss());
    await page.goto(`${EDGE_URL}/api/operations/schema-shapes`);
    const body = page.locator("#response-200-application-json");
    await expect(body).toContainText("<img src=x onerror=alert(1)>");
    expect(await body.locator("img").count()).toBe(0);
    await expect(
      body.locator(".row__name", { hasText: "__proto__" }),
    ).toHaveCount(1);
    await expect(
      body.locator(".row__name", { hasText: "x".repeat(200) }),
    ).toHaveCount(1);
    expect(await horizontalOverflow(page)).toBe(0);
    // Large enum: preview, disclosure, dropped count.
    const largeEnum = body.locator(".schema-row", { hasText: "largeEnum" });
    await expect(largeEnum.locator(".schema-enum__value:visible")).toHaveCount(
      8,
    );
    await largeEnum
      .locator("summary", { hasText: "Show 192 more values" })
      .click();
    await expect(largeEnum.locator(".schema-enum__value:visible")).toHaveCount(
      200,
    );
    await expect(
      largeEnum.getByText("100 further values not listed here."),
    ).toBeVisible();
    // 250 properties: 30 shown, 170 behind a disclosure, 50 via the focused view.
    const big = body.locator(".schema-row", { hasText: /^bigObject/ }).first();
    await big.locator("summary", { hasText: "250 properties" }).click();
    await expect(big.getByText("Show 170 more properties")).toBeVisible();
    await expect(
      big.getByText("50 further properties not shown here."),
    ).toBeVisible();
    await big.getByRole("link", { name: "Open all 250 properties" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "bigObject",
    );
    await expect(
      page.locator(".schema > .schema-rows > .schema-row"),
    ).toHaveCount(30);
    await expect(page.getByText("Show 170 more properties")).toBeVisible();
    expect(
      await page.evaluate(() => document.querySelectorAll("*").length),
    ).toBeLessThan(6_000);
    // Twenty-five variants render bounded, deep nesting stops with a link.
    await page.goto(`${EDGE_URL}/api/operations/schema-shapes`);
    await expect(
      body.locator(".schema-row", { hasText: /^manyVariants/ }).first(),
    ).toContainText("5 further variants not shown here");
    const deep = body.locator(".schema-row", { hasText: /^deepTree/ }).first();
    // Open every nested disclosure: the chain stops at the depth budget with a
    // link rather than growing without end.
    for (let level = 0; level < 12; level += 1) {
      const closed = deep.locator("details:not([open]) > summary").first();
      if ((await closed.count()) === 0) break;
      await closed.click();
    }
    await expect(
      deep.getByText("nested deeper than shown").first(),
    ).toBeVisible();
    expect(await deep.locator("details").count()).toBeLessThanOrEqual(7);
    expect(errors).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("keeps disclosure controls visible in forced colors and instant under reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({
      forcedColors: "active",
      reducedMotion: "reduce",
    });
    await page.goto("/api/messages/get-message");
    const summary = page.locator("#response-200-application-json summary", {
      hasText: "3 variants",
    });
    await summary.focus();
    expect(
      await summary.evaluate((node) => getComputedStyle(node).outlineStyle),
    ).toBe("solid");
    await summary.click();
    const guide = page
      .locator("#response-200-application-json .schema-children")
      .first();
    expect(
      await guide.evaluate((node) => getComputedStyle(node).borderLeftStyle),
    ).toBe("solid");
    expect(
      Number.parseFloat(
        await summary.evaluate(
          (node) => getComputedStyle(node, "::before").transitionDuration,
        ),
      ),
    ).toBeLessThan(0.001);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("expands schemas and opens focused views as plain HTML", async ({
      page,
    }) => {
      await page.goto("/api/messages/get-message");
      const response = page.locator("#response-200-application-json");
      await response.locator("summary", { hasText: "3 variants" }).click();
      await expect(
        response.getByText("Exactly one of the following:"),
      ).toBeVisible();
      await response
        .getByRole("link", { name: "Open MessageContent" })
        .first()
        .click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "content",
      );
      await expect(page.locator(".schema-variant__details")).toHaveCount(3);
    });
  });
});
