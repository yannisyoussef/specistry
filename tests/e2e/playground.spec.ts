import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * The browser-direct playground in the production reader (SPEC-009
 * §184–§186). Requests go from the page to the fake target API on the
 * fixture's approved loopback environments and nowhere else: the reader
 * server on 3100 never sees a credential, the fake API records exactly one
 * request per Send, redirects are blocked, timeouts and cancellation end a
 * request, oversized bodies are cut at the limit, a hostile HTML response
 * stays text, the CORS-refusing environment fails cleanly, credentials are
 * isolated per environment and gone after a reload, and without JavaScript
 * there is no dead control.
 *
 * Both browser projects share the fake APIs, so every assertion on the
 * recorded log filters by a value unique to the test, and the page's own
 * request log (`targetRequests`) proves what the browser sent.
 */

const OPERATION = "/api/inboxes/get-inbox";
const TARGET = "http://127.0.0.1:47391";
const STRICT = "http://127.0.0.1:47392";
const SECRET = "canary-key-e2e-9c1f";

interface Recorded {
  body: string;
  headers: Record<string, string>;
  method: string;
  path: string;
}

function unique(prefix: string): string {
  return `${prefix}_${test.info().project.name.replace(/[^a-z]/g, "")}_${Date.now().toString(36)}`;
}

async function recorded(
  request: Parameters<Parameters<typeof test>[2]>[0]["request"],
  origin: string,
  marker: string,
): Promise<Recorded[]> {
  const hits = (await (
    await request.get(`${origin}/__requests`)
  ).json()) as Recorded[];
  return hits.filter(
    (hit) =>
      hit.method !== "OPTIONS" &&
      (hit.path.includes(marker) || hit.body.includes(marker)),
  );
}

async function openTryIt(page: Page, path = OPERATION) {
  await page.goto(path);
  const rail = page.getByRole("complementary", { name: "Code" });
  await rail.getByRole("tab", { name: "Try it" }).click();
  const panel = rail.getByRole("tabpanel", { name: "Try it" });
  await expect(panel.getByRole("button", { name: /^Send / })).toBeVisible();
  return panel;
}

async function fill(
  panel: ReturnType<Page["getByRole"]>,
  inboxId: string,
  environment = "Local",
) {
  await panel.getByLabel("Environment").selectOption({ label: environment });
  await panel.getByLabel("X-Api-Key header").fill(SECRET);
  await panel.getByLabel(/inboxId/).fill(inboxId);
}

/** Every request the page issues to either fake API, plus any credential leak elsewhere. */
function targetRequests(page: Page): { targets: Request[]; leaks: Request[] } {
  const targets: Request[] = [];
  const leaks: Request[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.startsWith(TARGET) || url.startsWith(STRICT)) {
      targets.push(request);
      if (url.includes(SECRET)) leaks.push(request);
      return;
    }
    const headers = JSON.stringify(request.headers());
    if (
      url.includes(SECRET) ||
      (request.postData() ?? "").includes(SECRET) ||
      headers.includes(SECRET)
    ) {
      leaks.push(request);
    }
  });
  return { leaks, targets };
}

test.describe("playground", () => {
  test("sends exactly one request to the approved origin with the typed credential, and only there", async ({
    page,
    request,
  }) => {
    const { leaks, targets } = targetRequests(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.text().includes(SECRET))
        errors.push(`console leak: ${message.text()}`);
    });
    const inboxId = unique("inb");
    const panel = await openTryIt(page);
    await fill(panel, inboxId);
    await expect(panel.locator(".try-it__preview")).toContainText(
      `GET http://127.0.0.1:47391/v1/inboxes/${inboxId}`,
    );
    await expect(panel.locator(".try-it__preview")).toContainText(
      "X-Api-Key: ••••••••",
    );
    await expect(panel.locator(".try-it__preview")).not.toContainText(SECRET);
    await panel.getByRole("button", { name: "Send GET request" }).click();
    const response = panel.locator(".try-it__response");
    await expect(response).toContainText("200 OK");
    await expect(response).toContainText(
      `"address": "${inboxId}@sandbox.testinbox.email"`,
    );
    await expect(response).not.toContainText(SECRET);

    const hits = await recorded(request, TARGET, inboxId);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      method: "GET",
      path: `/v1/inboxes/${inboxId}`,
    });
    expect(hits[0]?.headers["x-api-key"]).toBe(SECRET);
    expect(hits[0]?.headers.cookie).toBeUndefined();
    expect(hits[0]?.headers.referer).toBeUndefined();
    expect(hits[0]?.headers.origin).toBe("http://127.0.0.1:3100");
    // One preflight plus one request from this page; nothing anywhere else.
    expect(
      targets
        .filter((entry) => entry.method() === "GET")
        .map((entry) => entry.url()),
    ).toEqual([`${TARGET}/v1/inboxes/${inboxId}`]);
    expect(leaks.map((leak) => leak.url())).toEqual([]);
    expect(errors).toEqual([]);

    // Nothing persisted but the environment id.
    const stored = await page.evaluate(() => ({
      cookie: document.cookie,
      local: JSON.stringify({ ...localStorage }),
      session: JSON.stringify({ ...sessionStorage }),
      url: location.href,
    }));
    expect(stored.session).toBe('{"specra:playground-environment":"local"}');
    expect(stored.local).not.toContain(SECRET);
    expect(stored.cookie).not.toContain(SECRET);
    expect(stored.url).not.toContain(SECRET);

    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
  });

  test("clears credentials on reload and keeps the chosen environment", async ({
    page,
  }) => {
    const panel = await openTryIt(page);
    await fill(panel, "inb_1", "Strict local");
    await page.reload();
    const again = page
      .getByRole("complementary", { name: "Code" })
      .getByRole("tabpanel", { name: "Try it" });
    await page.getByRole("tab", { name: "Try it" }).click();
    await expect(again.getByLabel("Environment")).toHaveValue("strict");
    await expect(again.getByLabel("X-Api-Key header")).toHaveValue("");
    expect(
      await page.evaluate(() => document.documentElement.outerHTML),
    ).not.toContain(SECRET);
  });

  test("isolates credentials per environment and refuses to reuse them", async ({
    page,
  }) => {
    const { targets } = targetRequests(page);
    const panel = await openTryIt(page);
    await fill(panel, "inb_1", "Local");
    await panel
      .getByLabel("Environment")
      .selectOption({ label: "Strict local" });
    await expect(panel.getByLabel("X-Api-Key header")).toHaveValue("");
    await panel.getByRole("button", { name: "Send GET request" }).click();
    await expect(
      panel.getByText("X-Api-Key header is required."),
    ).toBeVisible();
    expect(targets).toEqual([]);
    await panel.getByLabel("Environment").selectOption({ label: "Local" });
    await expect(panel.getByLabel("X-Api-Key header")).toHaveValue(SECRET);
    await panel.getByRole("button", { name: "Clear credentials" }).click();
    await expect(panel.getByLabel("X-Api-Key header")).toHaveValue("");
  });

  test("shows a CORS refusal as a clean failure with guidance", async ({
    page,
    request,
  }) => {
    const inboxId = unique("inb");
    const panel = await openTryIt(page);
    await fill(panel, inboxId, "Strict local");
    await panel.getByRole("button", { name: "Send GET request" }).click();
    const response = panel.locator(".try-it__response");
    await expect(response).toContainText("Request failed");
    await expect(response).toContainText("Access-Control-Allow-Origin");
    // The preflight was refused, so the credentialed request never left the browser.
    expect(await recorded(request, STRICT, inboxId)).toEqual([]);
  });

  test("blocks redirects without following them", async ({ page }) => {
    const { targets } = targetRequests(page);
    const panel = await openTryIt(page);
    await fill(panel, "__redirect");
    await panel.getByRole("button", { name: "Send GET request" }).click();
    await expect(panel.locator(".try-it__response")).toContainText(
      "Redirect blocked",
    );
    expect(
      targets
        .filter((entry) => entry.method() === "GET")
        .map((entry) => entry.url()),
    ).toEqual([`${TARGET}/v1/inboxes/__redirect`]);
  });

  test("times out at the configured limit and can be cancelled before it", async ({
    page,
  }) => {
    const panel = await openTryIt(page);
    await fill(panel, "__delay");
    await panel.getByRole("button", { name: "Send GET request" }).click();
    await expect(
      panel.getByRole("button", { name: "Sending…" }),
    ).toBeDisabled();
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(panel.locator(".try-it__response")).toContainText("Cancelled");
    await expect(
      panel.getByRole("button", { name: "Send GET request" }),
    ).toBeEnabled();

    await panel.getByRole("button", { name: "Send GET request" }).click();
    await expect(panel.locator(".try-it__response")).toContainText(
      "Timed out",
      { timeout: 15_000 },
    );
  });

  test("cuts an oversized response at the limit and says so", async ({
    page,
  }) => {
    const panel = await openTryIt(page);
    await fill(panel, "__huge");
    await panel.getByRole("button", { name: "Send GET request" }).click();
    const response = panel.locator(".try-it__response");
    await expect(response).toContainText("200 OK");
    await expect(response).toContainText("partial");
    await expect(response).toContainText(
      "exceeded the playground display limit",
    );
    await expect(response).toContainText("262144 B");
  });

  test("renders a hostile HTML response as inert text and bounds headers", async ({
    page,
  }) => {
    const panel = await openTryIt(page);
    await fill(panel, "__html");
    await panel.getByRole("button", { name: "Send GET request" }).click();
    const response = panel.locator(".try-it__response");
    await expect(response).toContainText("<script>");
    expect(await response.locator("script, img, h1").count()).toBe(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __pwned?: boolean }).__pwned,
      ),
    ).toBeUndefined();
    await expect(page).toHaveTitle(/Get inbox/);

    await panel.getByLabel(/inboxId/).fill("__headers");
    await panel.getByRole("button", { name: "Send GET request" }).click();
    await response.getByText(/^Headers \(\d+\)$/).click();
    const shown = await response
      .locator(".try-it__header dt")
      .allTextContents();
    expect(shown.length).toBeLessThanOrEqual(64);
    expect(shown).toContain("x-request-id");
    await expect(response).not.toContainText("secret-cookie");
  });

  test("reports API errors and empty bodies honestly", async ({ page }) => {
    const panel = await openTryIt(page);
    await fill(panel, "missing");
    await panel.getByRole("button", { name: "Send GET request" }).click();
    const response = panel.locator(".try-it__response");
    await expect(response).toContainText("404 Not Found");
    await expect(response).toContainText('"title": "Inbox not found"');

    const del = await openTryIt(page, "/api/inboxes/delete-inbox");
    await fill(del, "inb_9");
    await del.getByRole("button", { name: "Send DELETE request" }).click();
    await expect(del.locator(".try-it__response")).toContainText(
      "204 No Content",
    );
    await expect(del.locator(".try-it__response")).toContainText("Empty body");
  });

  test("validates before sending and moves focus to the first error", async ({
    page,
  }) => {
    const { targets } = targetRequests(page);
    const panel = await openTryIt(page);
    await panel.getByRole("button", { name: "Send GET request" }).click();
    await expect(
      panel.getByText("X-Api-Key header is required."),
    ).toBeVisible();
    await expect(panel.getByText("inboxId is required.")).toBeVisible();
    await expect(panel.getByLabel("X-Api-Key header")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(targets).toEqual([]);
  });

  test("edits a JSON body and sends it with the content type", async ({
    page,
    request,
  }) => {
    const label = unique("label");
    const panel = await openTryIt(page, "/api/inboxes/create-inbox");
    await panel.getByLabel("X-Api-Key header").fill(SECRET);
    await panel
      .getByLabel("Body", { exact: true })
      .fill(`{"label": "${label}"}`);
    await panel.getByRole("button", { name: "Send POST request" }).click();
    await expect(panel.locator(".try-it__response")).toContainText(
      "201 Created",
    );
    await expect(panel.locator(".try-it__response")).toContainText(
      `"label": "${label}"`,
    );
    const hits = await recorded(request, TARGET, label);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.body).toBe(`{"label": "${label}"}`);
    expect(hits[0]?.headers["content-type"]).toBe("application/json");
  });

  test("explains alternatives the browser cannot use and keeps the usable one", async ({
    page,
  }) => {
    const panel = await openTryIt(page, "/api/webhooks/create-webhook");
    await expect(
      panel.getByText(/client certificate \(mutual TLS\)/),
    ).toBeVisible();
    await expect(panel.getByLabel("OAuth 2.0 access token")).toHaveAttribute(
      "type",
      "password",
    );
    await panel.getByRole("button", { name: "Show" }).click();
    await expect(panel.getByLabel("OAuth 2.0 access token")).toHaveAttribute(
      "type",
      "text",
    );
  });

  test("works from the keyboard: tab control, arrow keys, and Enter to send", async ({
    page,
  }) => {
    const { targets } = targetRequests(page);
    await page.goto(OPERATION);
    const rail = page.getByRole("complementary", { name: "Code" });
    const codeTab = rail.getByRole("tab", { name: "Code" });
    await codeTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(rail.getByRole("tab", { name: "Try it" })).toBeFocused();
    await expect(rail.getByRole("tab", { name: "Try it" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const panel = rail.getByRole("tabpanel", { name: "Try it" });
    await fill(panel, "inb_7");
    await panel.getByLabel(/inboxId/).press("Enter");
    await expect(panel.locator(".try-it__response")).toContainText("200 OK");
    expect(targets.filter((entry) => entry.method() === "GET")).toHaveLength(1);
  });

  test("opens from the #try-it hash and from the mobile bar", async ({
    isMobile,
    page,
  }) => {
    await page.goto(`${OPERATION}#try-it`);
    const rail = page.getByRole("complementary", { name: "Code" });
    await expect(rail.getByRole("tab", { name: "Try it" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    test.skip(!isMobile, "the bar is a phone-only control");
    await page.goto(OPERATION);
    const link = page
      .getByRole("navigation", { name: "Code" })
      .getByRole("link", { name: "Try it" });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(rail.getByRole("tab", { name: "Try it" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("shows no Try it control at all", async ({ page }) => {
      await page.goto(OPERATION);
      await expect(page.getByRole("tab")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Try it" })).toBeHidden();
      await expect(page.getByRole("heading", { name: "Code" })).toBeAttached();
      expect(await page.locator('input[type="password"]').count()).toBe(0);
    });
  });
});
