import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("guide, search, API, code, and playground stay operable", async ({
  page,
}) => {
  const guide = await page.goto("/docs/quickstart");
  expect(guide?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Quickstart",
  );

  const search = page.getByRole("button", { name: /Search…/ });
  await expect(search).toBeVisible();
  await search.click();
  const input = page.getByRole("combobox", { name: "Search documentation" });
  await input.fill("create inbox");
  await expect(page.getByRole("option").first()).toContainText("Create inbox");
  await page.keyboard.press("Escape");

  const operation = await page.goto("/api/inboxes/create-inbox");
  expect(operation?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Create inbox",
  );
  const rail = page.getByRole("complementary", { name: "Code" });
  const language = rail.getByRole("combobox", { name: "Language" });
  await expect(language).toBeVisible();
  await language.selectOption({ label: "HTTP" });
  await expect(
    rail.locator(".code-switcher__panel:not([hidden]) pre"),
  ).toContainText("POST /v1/inboxes HTTP/1.1");

  await rail.getByRole("tab", { name: "Try it" }).click();
  await expect(
    rail.getByRole("tabpanel", { name: "Try it" }).getByRole("button", {
      name: "Send POST request",
    }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("readiness and canonical metadata are production-safe", async ({
  page,
  request,
}) => {
  const ready = await request.get("/readyz");
  expect(ready.status()).toBe(200);
  expect(ready.headers()["cache-control"]).toBe("no-store");
  expect(await ready.json()).toMatchObject({ status: "ready" });

  await page.goto("/docs/quickstart");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://docs.example.test/docs/quickstart",
  );
  // Indexable pages omit a robots override; Next's default is index/follow.
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});
