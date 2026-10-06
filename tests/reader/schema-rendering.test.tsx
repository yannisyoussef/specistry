// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import {
  SchemaBlock,
  SchemaDisclosure,
} from "../../apps/web/components/reader/schema/schema-block";
import {
  countViewNodes,
  createSchemaView,
  type SchemaContext,
  type SchemaView,
} from "../../apps/web/lib/reader/schema-view";
import { corpus, hostileNames, roots } from "../fixtures/schemas/corpus";

afterEach(cleanup);

function block(
  name: keyof typeof roots,
  context: SchemaContext = "response",
  budget?: Parameters<typeof createSchemaView>[1]["budget"],
) {
  const view = createSchemaView(roots[name], {
    context,
    registry: corpus,
    ...(budget === undefined ? {} : { budget }),
  });
  return {
    element: (
      <SchemaBlock
        context={context}
        focusHref={(locator) =>
          `/op?schema=body${locator === "" ? "" : `&at=${locator}`}`
        }
        idPrefix="body"
        view={view}
      />
    ),
    view,
  };
}

function markup(view: SchemaView, context: SchemaContext = "response"): string {
  return renderToStaticMarkup(
    <SchemaBlock
      context={context}
      focusHref={(locator) => `/op?schema=body&at=${locator}`}
      idPrefix="body"
      view={view}
    />,
  );
}

describe("schema renderer: rows and disclosures", () => {
  it("renders property rows with names, type phrases, required words, and native disclosures", async () => {
    const { element } = block("directRecursion");
    const { container } = render(element);
    expect(container.querySelector('[role="tree"]')).toBeNull();
    const value = container.querySelector(".schema-row");
    expect(value?.textContent).toContain("value");
    expect(value?.textContent).toContain("string");
    expect(value?.textContent).toContain("required");
    const disclosures = container.querySelectorAll("details");
    expect(disclosures.length).toBeGreaterThan(0);
    // Every disclosure is a native details/summary pair with a concise label
    // that names its property for screen readers.
    const summary = screen.getByText("items", { selector: "summary" });
    expect(summary.textContent).toBe("items of children");
    expect(summary.closest("details")?.open).toBe(false);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("marks recursion with text and a link instead of expanding it", () => {
    const { element } = block("directRecursion");
    const { container } = render(element);
    const marker = within(container).getAllByText("recursive");
    expect(marker.length).toBeGreaterThan(0);
    const links = screen.getAllByRole("link", { name: /Open Node/ });
    expect(links[0]?.getAttribute("href")).toBe("/op?schema=body&at=p1.i");
    // The marker row has no nested disclosure: recursion never renders inline.
    const row = marker[0]?.closest(".schema-row");
    expect(row?.querySelector("details")).toBeNull();
  });

  it("shows large property sets behind a disclosure and links the remainder", () => {
    const { element } = block("twoHundred", "response", { maxProperties: 60 });
    const { container } = render(element);
    expect(
      container.querySelectorAll(
        ":scope > .schema > .schema-rows > .schema-row",
      ),
    ).toHaveLength(30);
    const more = screen.getByText("Show 30 more properties", {
      selector: "summary",
    });
    expect(more.closest("details")?.open).toBe(false);
    expect(
      screen.getByText(/140 further properties not shown here/),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: /Open all 200 properties/ }),
    ).toBeDefined();
  });

  it("presents variants as a disclosure list with discriminator values and anchors", async () => {
    const { element } = block("discriminated");
    const { container } = render(element);
    expect(screen.getByText("Exactly one of the following:")).toBeDefined();
    const discriminator = container.querySelector(".schema-discriminator");
    expect(discriminator?.textContent).toContain("Selected by method");
    expect(discriminator?.textContent).toContain("card");
    const cardLink = within(discriminator as HTMLElement).getByRole("link", {
      name: "CardPayment",
    });
    expect(cardLink.getAttribute("href")).toBe("#body--v0");
    expect(container.querySelector("#body--v0")).not.toBeNull();
    const variants = container.querySelectorAll(".schema-variant__details");
    expect(variants).toHaveLength(3);
    for (const variant of variants)
      expect((variant as HTMLDetailsElement).open).toBe(false);
    expect(
      variants[0]?.querySelector(".schema-variant__values")?.textContent,
    ).toBe("card");
    expect((await axe(container)).violations).toEqual([]);
  });

  it("keeps anyOf wording distinct from oneOf and allOf as combined parts", () => {
    const { element: anyOf } = block("anyOfLoose");
    render(anyOf);
    expect(
      screen.getByText("One or more of the following (any combination):"),
    ).toBeDefined();
    cleanup();
    const { element: allOf } = block("tagged");
    const { container } = render(allOf);
    expect(screen.getByText("All of the following, combined:")).toBeDefined();
    const parts = container.querySelectorAll(".schema-variant__details");
    expect(parts).toHaveLength(3);
    for (const part of parts)
      expect((part as HTMLDetailsElement).open).toBe(true);
    expect(parts[0]?.textContent).toContain("Base");
    expect(parts[0]?.textContent).toContain("id");
  });

  it("renders not as an exclusion, tuples slot by slot, and dictionaries as maps", () => {
    const { container: not } = render(block("not").element);
    expect(not.textContent).toContain("must not match");
    expect(not.textContent).toContain("not string");
    cleanup();
    const { container: tuple } = render(block("tuple").element);
    expect(tuple.textContent).toContain("item 0");
    expect(tuple.textContent).toContain("item 2");
    cleanup();
    const { container: dictionary } = render(block("dictionary").element);
    expect(dictionary.textContent).toContain("additional properties");
    expect(dictionary.textContent).toContain("Address");
  });
});

describe("schema renderer: special forms and context", () => {
  it("states free-form, explicit boolean, type-less, and unrepresented meanings in words", () => {
    expect(
      markup(
        createSchemaView(roots.freeForm, {
          context: "response",
          registry: corpus,
        }),
      ),
    ).toContain("Free-form: no constraints are declared.");
    expect(markup(block("booleanTrue").view)).toContain(
      "schema: any value is allowed.",
    );
    expect(markup(block("booleanFalse").view)).toContain(
      "schema: no value is allowed.",
    );
    expect(markup(block("typeLess").view)).toContain(
      "the constraints apply to integer, number, or string values",
    );
    expect(markup(block("unknown").view)).toContain(
      "vocabulary Specistry does not represent yet",
    );
  });

  it("says which fields are omitted for the context and keeps the others", () => {
    const request = markup(block("mixedContext", "request").view, "request");
    expect(request).toContain("Not sent in requests (read-only): ");
    expect(request).toContain("<code>id</code>");
    expect(request).toContain("password");
    expect(request).not.toContain("createdAt</code>, <code>name");
    const response = markup(block("mixedContext", "response").view, "response");
    expect(response).toContain("Not returned in responses (write-only): ");
    expect(response).toContain("<code>password</code>");
    expect(response).toContain("createdAt");
  });

  it("bounds enumerations and keeps values as text", () => {
    const { container } = render(block("largeEnum").element);
    expect(
      container.querySelectorAll(".schema-enum__values")[0]?.children,
    ).toHaveLength(8);
    expect(
      screen.getByText("Show 192 more values", { selector: "summary" }),
    ).toBeDefined();
    expect(
      screen.getByText(/100 further values not listed here/),
    ).toBeDefined();
  });
});

describe("schema renderer: safety and budgets", () => {
  it("renders hostile names and descriptions as inert text", () => {
    const html = markup(block("hostile").view);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain(hostileNames.long);
    expect(html).toContain("__proto__");
    expect(html).toContain("a/b#c");
    expect(html).not.toContain("dangerouslySetInnerHTML");
    // The attack string survives only as escaped text, never inside a tag.
    expect(html).not.toMatch(/<[^>]*onerror=/);
  });

  it("keeps the DOM bounded for large and deep schemas", () => {
    const large = block("twoHundred").view;
    const largeHtml = markup(large);
    const elements = (largeHtml.match(/<[a-z]/g) ?? []).length;
    expect(countViewNodes(large)).toBe(201);
    expect(elements).toBeLessThan(2_600);
    const deep = block("deep").view;
    const deepHtml = markup(deep);
    expect((deepHtml.match(/<details/g) ?? []).length).toBeLessThanOrEqual(7);
    expect(deepHtml).toContain("nested deeper than shown");
    const many = block("oneOfTwenty").view;
    expect((markup(many).match(/<details/g) ?? []).length).toBe(20);
  });

  it("renders the compact disclosure for parameter-style rows only when there is structure", () => {
    const flat = createSchemaView(roots.primitive, {
      context: "request",
      registry: corpus,
    });
    const flatHtml = renderToStaticMarkup(
      <SchemaDisclosure
        context="request"
        focusHref={() => "/x"}
        idPrefix="p"
        label="limit"
        view={flat}
      />,
    );
    expect(flatHtml).toBe("");
    const nested = createSchemaView(roots.twenty, {
      context: "request",
      registry: corpus,
    });
    render(
      <SchemaDisclosure
        context="request"
        focusHref={() => "/x"}
        idPrefix="p"
        label="filter"
        view={nested}
      />,
    );
    const summary = screen.getByText("20 properties", { selector: "summary" });
    expect(summary.textContent).toBe("20 properties of filter");
  });
});

describe("schema focus page", () => {
  it("renders the trail, the focused node as root, and a way back", async () => {
    const { SchemaFocusPage } =
      await import("../../apps/web/components/reader/schema/schema-focus-page");
    const { parseDocumentationArtifact } = await import("@specistry/model");
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { createReaderIndex, resolveRoute } =
      await import("../../apps/web/lib/reader/projection");
    const { createOperationView } =
      await import("../../apps/web/lib/reader/operation-view");
    const { resolveLocator } =
      await import("../../apps/web/lib/reader/schema-view");
    const artifact = parseDocumentationArtifact(
      readFileSync(
        path.join(
          process.cwd(),
          "tests",
          "fixtures",
          "reader",
          "testinbox",
          ".specistry",
          "artifacts",
          "documentation.json",
        ),
        "utf8",
      ),
    );
    const index = createReaderIndex(artifact);
    const target = resolveRoute(index, artifact, ["messages", "get-message"]);
    if (target?.kind !== "operation") throw new Error("operation");
    const operation = createOperationView(target);
    const block = operation.schemaBlocks.find(
      (entry) => entry.anchor === "response-200-application-json",
    );
    if (block === undefined) throw new Error("block");
    const contentIndex =
      block.node.kind === "ref"
        ? (
            target.model.schemas[block.node.schemaId] as {
              propertyOrder: string[];
            }
          ).propertyOrder.indexOf("content")
        : -1;
    const located = resolveLocator(
      block.node,
      target.model.schemas,
      `p${contentIndex}`,
    );
    if (located === undefined) throw new Error("locator");
    const view = createSchemaView(located.node, {
      ancestors: located.ancestors,
      context: block.context,
      locator: `p${contentIndex}`,
      registry: target.model.schemas,
    });
    const { container } = render(
      <SchemaFocusPage
        block={block}
        context={block.context}
        operation={operation}
        trail={located.trail}
        view={view}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "content",
    );
    const trail = screen.getByRole("navigation", { name: "Schema position" });
    expect(trail.textContent).toContain("Response 200 · application/json");
    expect(
      within(trail).getByText("content").getAttribute("aria-current"),
    ).toBe("location");
    expect(screen.getByText("Exactly one of the following:")).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: /Back to Get message/ })
        .getAttribute("href"),
    ).toBe("/api/messages/get-message#response-200-application-json");
    expect((await axe(container)).violations).toEqual([]);
  });
});
