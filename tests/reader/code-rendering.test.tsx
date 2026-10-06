// @vitest-environment jsdom
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  parseDocumentationArtifact,
  type DocumentationArtifact,
} from "@specistry/model";
import { parseSnippetsArtifact } from "@specistry/snippets";
import { cleanup, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OperationPage } from "../../apps/web/components/reader/operation-page";
import type { ReaderSnippets } from "../../apps/web/lib/reader/artifact";
import {
  createCodeView,
  resetCodeViewCache,
} from "../../apps/web/lib/reader/code-view";
import { createOperationView } from "../../apps/web/lib/reader/operation-view";
import {
  createReaderIndex,
  resolveRoute,
} from "../../apps/web/lib/reader/projection";

// The options island navigates through the App Router; outside Next the
// router is a stub that records the replacement URL.
const replace = vi.fn();
vi.mock("../../apps/web/components/reader/code/navigation", () => ({
  useReplaceUrl: () => replace,
}));

/**
 * Code rail rendering (SPEC-008 §77–§103, §124–§127): the server-rendered
 * rail carries six protocol examples and the authored SDK examples with
 * accessible names, the selectors are real form controls with the validated
 * selection, the no-JavaScript shape keeps cURL visible and the rest behind
 * a native disclosure, and nothing is rendered as HTML.
 */

const fixtureRoot = path.join(process.cwd(), "tests", "fixtures", "reader");

function load(name: string): {
  artifact: DocumentationArtifact;
  snippets: ReaderSnippets;
} {
  const directory = path.join(fixtureRoot, name, ".specistry", "artifacts");
  const snippetsText = readFileSync(
    path.join(directory, "snippets.json"),
    "utf8",
  );
  return {
    artifact: parseDocumentationArtifact(
      readFileSync(path.join(directory, "documentation.json"), "utf8"),
    ),
    snippets: {
      artifact: parseSnippetsArtifact(snippetsText),
      sha256: createHash("sha256").update(snippetsText).digest("hex"),
    },
  };
}

const testinbox = load("testinbox");
const edge = load("edge");
const index = createReaderIndex(testinbox.artifact);

function view(artifact: DocumentationArtifact, segments: readonly string[]) {
  const target = resolveRoute(createReaderIndex(artifact), artifact, segments);
  if (target?.kind !== "operation")
    throw new Error(`expected operation at ${segments.join("/")}`);
  return createOperationView(target);
}

beforeEach(resetCodeViewCache);
afterEach(cleanup);

describe("code view", () => {
  it("offers six protocol panels, the mapped SDK panels, and every selector", () => {
    const code = createCodeView(
      testinbox.snippets,
      view(testinbox.artifact, ["inboxes", "create-inbox"]),
      {},
    );
    expect(code).toBeDefined();
    if (code === undefined) return;
    expect(code.options.map((option) => option.id)).toEqual([
      "curl",
      "http",
      "javascript",
      "typescript",
      "java",
      "python",
      "sdk-typescript",
      "sdk-java",
    ]);
    expect(
      code.fields.map((field) => `${field.name}=${field.selected}`),
    ).toEqual(["env=production", "body=application/json", "auth=0"]);
    expect(code.customized).toBe(false);
    expect(code.query).toBe("");
    expect(code.response?.status).toBe("201");
    expect(code.panels[0]?.code).toContain(
      "--url 'https://api.testinbox.email/v1/inboxes'",
    );
    expect(code.panels[6]?.title).toBe("Create an inbox");
    expect(code.panels[6]?.code).toContain("client.inboxes.create");
  });

  it("applies validated selections and ignores unknown or malformed ones", () => {
    const operation = view(testinbox.artifact, ["inboxes", "create-inbox"]);
    const chosen = createCodeView(testinbox.snippets, operation, {
      auth: "1",
      body: "application/x-www-form-urlencoded",
      env: "sandbox",
    });
    expect(chosen?.customized).toBe(true);
    expect(chosen?.query).toBe(
      "env=sandbox&body=application%2Fx-www-form-urlencoded&auth=1",
    );
    expect(chosen?.panels[0]?.code).toContain(
      "https://sandbox.testinbox.email/v1/inboxes",
    );
    expect(chosen?.panels[0]?.code).toContain(
      "Authorization: Bearer <YOUR_ACCESS_TOKEN>",
    );
    const ignored = createCodeView(testinbox.snippets, operation, {
      auth: "99",
      body: "../../etc/passwd",
      env: ["sandbox"],
    });
    expect(ignored?.customized).toBe(false);
    expect(ignored?.panels[0]?.code).toContain(
      "https://api.testinbox.email/v1/inboxes",
    );
    expect(ignored?.panels[0]?.code).not.toContain("passwd");
  });

  it("omits SDK panels and single-choice selectors honestly", () => {
    const code = createCodeView(
      testinbox.snippets,
      view(testinbox.artifact, ["inboxes", "delete-inbox"]),
      {},
    );
    expect(code?.options.every((option) => option.group === "protocol")).toBe(
      true,
    );
    expect(code?.fields.map((field) => field.name)).toEqual(["env", "auth"]);
    expect(code?.response).toBeUndefined();
  });

  it("memoizes per artifact digest and selection", () => {
    const operation = view(testinbox.artifact, ["inboxes", "create-inbox"]);
    const first = createCodeView(testinbox.snippets, operation, {});
    expect(createCodeView(testinbox.snippets, operation, {})).toBe(first);
    expect(
      createCodeView(testinbox.snippets, operation, { env: "sandbox" }),
    ).not.toBe(first);
    expect(
      createCodeView({ ...testinbox.snippets, sha256: "other" }, operation, {}),
    ).not.toBe(first);
  });
});

describe("code rail", () => {
  it("renders the rail with labelled examples, copy controls, and selectors", async () => {
    const operation = view(testinbox.artifact, ["inboxes", "create-inbox"]);
    const code = createCodeView(testinbox.snippets, operation, {});
    const { container } = render(
      <OperationPage code={code} view={operation} />,
    );
    const rail = screen.getByRole("complementary", { name: "Code" });
    expect(
      within(rail).getByRole("heading", { level: 2, name: "Code" }),
    ).toBeDefined();
    // After hydration only the selected panel is shown; the rest are hidden.
    for (const label of [
      "cURL",
      "HTTP",
      "JavaScript",
      "TypeScript",
      "Java",
      "Python",
      "TypeScript SDK",
      "Java SDK",
    ]) {
      expect(
        within(rail).getByRole("button", {
          hidden: true,
          name: `Copy ${label} example`,
        }),
      ).toBeDefined();
      expect(
        within(rail).getByRole("group", {
          hidden: true,
          name: `${label} example`,
        }),
      ).toBeDefined();
    }
    expect(
      within(rail)
        .getAllByRole("group", { name: /example$/ })
        .map((group) => group.getAttribute("aria-label")),
    ).toEqual(["cURL example", "Response · 201 example"]);
    expect(
      within(rail).getByRole("button", { name: "Copy response 201 example" }),
    ).toBeDefined();
    const form = within(rail).getByRole("form", {
      name: "Code example options",
    });
    expect(
      within(form).getByRole("combobox", { name: "Environment" }),
    ).toHaveProperty("value", "production");
    expect(
      within(form).getByRole("combobox", { name: "Body format" }),
    ).toHaveProperty("value", "application/json");
    expect(
      within(form).getByRole("combobox", { name: "Authentication" }),
    ).toHaveProperty("value", "0");
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/api/inboxes/create-inbox");
    // The hydrated language control groups protocol and SDK options.
    const language = within(rail).getByRole("combobox", { name: "Language" });
    expect(
      within(language)
        .getAllByRole("group")
        .map((group) => group.getAttribute("label")),
    ).toEqual(["Protocol", "SDK"]);
    // SDK panels carry their package and never a protocol label.
    expect(
      within(rail).getAllByText("@testinbox/sdk", { exact: false }).length,
    ).toBeGreaterThan(0);
    expect(
      screen
        .getByRole("navigation", { name: "Code" })
        .querySelector("a")
        ?.getAttribute("href"),
    ).toBe("#code");
    expect((await axe(container)).violations).toEqual([]);
  });

  it("keeps cURL visible and the other examples behind a disclosure without JavaScript", () => {
    const operation = view(testinbox.artifact, ["inboxes", "create-inbox"]);
    const code = createCodeView(testinbox.snippets, operation, {});
    const html = renderToStaticMarkup(
      <OperationPage code={code} view={operation} />,
    );
    expect(html).toContain('data-enhanced="false"');
    expect(html).toContain("Other languages (");
    expect(html).toContain('class="button code-options__apply"');
    expect(html).not.toContain("code-switcher__select");
    // The first panel (cURL) precedes the disclosure in reading order.
    expect(html.indexOf("Copy cURL example")).toBeLessThan(
      html.indexOf("<details"),
    );
    expect(html.indexOf("<details")).toBeLessThan(
      html.indexOf("Copy HTTP example"),
    );
  });

  it("renders hostile artifact text as inert text", () => {
    const operation = view(edge.artifact, ["operations", "auth-alternatives"]);
    const code = createCodeView(edge.snippets, operation, {});
    expect(code).toBeDefined();
    if (code === undefined) return;
    const html = renderToStaticMarkup(
      <OperationPage code={code} view={operation} />,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("onerror=");
    const { container } = render(
      <OperationPage code={code} view={operation} />,
    );
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    // Every auth alternative of the edge operation is offered by label.
    const auth = screen.getByRole("combobox", { name: "Authentication" });
    expect(within(auth).getAllByRole("option").length).toBeGreaterThan(1);
  });

  it("replaces the URL with the validated selection when an option changes", async () => {
    const operation = view(testinbox.artifact, ["inboxes", "create-inbox"]);
    const code = createCodeView(testinbox.snippets, operation, {});
    render(<OperationPage code={code} view={operation} />);
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByRole("combobox", { name: "Environment" }), {
      target: { value: "sandbox" },
    });
    expect(replace).toHaveBeenCalledWith(
      "/api/inboxes/create-inbox?env=sandbox#code",
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), {
      target: { value: "python" },
    });
    expect(screen.getByRole("group", { name: "Python example" })).toBeDefined();
    expect(screen.queryByRole("group", { name: "cURL example" })).toBeNull();
    expect(window.sessionStorage.getItem("specistry:code-language")).toBe(
      "python",
    );
  });

  it("renders no rail when the artifact has no snippets", () => {
    const operation = view(testinbox.artifact, ["inboxes", "create-inbox"]);
    render(<OperationPage view={operation} />);
    expect(screen.queryByRole("complementary", { name: "Code" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Code" })).toBeNull();
    expect(index.operationCount).toBe(25);
  });
});
