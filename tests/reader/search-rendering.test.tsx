// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SearchPalette from "../../apps/web/components/reader/search/search-palette";
import { SearchTrigger } from "../../apps/web/components/reader/search/search-trigger";

/**
 * Search UI (SPEC-007 §72–82, §117): the trigger, the lazily loaded palette,
 * combobox semantics, keyboard selection, status announcements, empty and
 * failure states, and inert rendering of hostile indexed text, rendered with
 * Testing Library against the committed TestInbox search artifact.
 */

const artifactJson = readFileSync(
  path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "reader",
    "testinbox",
    ".specra",
    "artifacts",
    "search.json",
  ),
  "utf8",
);
const SEARCH_PATH = "/search/index.0123456789abcdef.json";

beforeEach(() => {
  // jsdom has no native dialog support; the palette only needs the open flag.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) =>
      input === SEARCH_PATH
        ? new Response(artifactJson, {
            headers: { "content-type": "application/json" },
          })
        : new Response(null, { status: 404 }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openPalette() {
  const onClose = vi.fn();
  const { container } = render(
    <SearchPalette onClose={onClose} path={SEARCH_PATH} />,
  );
  const input = await screen.findByRole("combobox", {
    name: "Search documentation",
  });
  await waitFor(() =>
    expect(screen.getByText(/Type to search guides/)).toBeDefined(),
  );
  return { container, input, onClose };
}

describe("search trigger", () => {
  it("renders a labelled button with the shortcut and opens the palette lazily", async () => {
    const { container } = render(<SearchTrigger path={SEARCH_PATH} />);
    const button = screen.getByRole("button", { name: /Search…/ });
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+K Control+K");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(button);
    expect(
      await screen.findByRole("combobox", { name: "Search documentation" }),
    ).toBeDefined();
    expect((await axe(container)).violations).toEqual([]);
  });

  it("toggles with Control+K and Meta+K and returns focus on close", async () => {
    render(<SearchTrigger path={SEARCH_PATH} />);
    const button = screen.getByRole("button", { name: /Search…/ });
    fireEvent.keyDown(document, { ctrlKey: true, key: "k" });
    const input = await screen.findByRole("combobox", {
      name: "Search documentation",
    });
    expect(input).toBeDefined();
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(document.activeElement).toBe(button);
    // Plain "k" and Shift+Control+K are not the shortcut.
    fireEvent.keyDown(document, { key: "k" });
    fireEvent.keyDown(document, { ctrlKey: true, key: "k", shiftKey: true });
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("search palette", () => {
  it("implements the combobox pattern with grouped options and keyboard selection", async () => {
    const { container, input } = await openPalette();
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    const listbox = screen.getByRole("listbox", { name: "Search results" });
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    fireEvent.change(input, { target: { value: "create inbox" } });
    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThan(3);
    expect(options.length).toBeLessThanOrEqual(12);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    // The first option is active, announced through aria-activedescendant,
    // and reads its kind, method, title, and path as text.
    const first = options[0] as HTMLElement;
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(first.id);
    expect(first.textContent).toContain("API,");
    expect(first.textContent).toContain("POST");
    expect(first.textContent).toContain("Create inbox");
    expect(first.textContent).toContain("POST /inboxes");
    expect(
      within(first).getByText("Create", { selector: "mark" }),
    ).toBeDefined();
    // Groups are labelled; the API reference group leads for an API query.
    const groups = screen.getAllByRole("group");
    expect(groups[0]?.getAttribute("aria-label")).toBe("API reference");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1]?.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    fireEvent.keyDown(input, { key: "End" });
    expect(input.getAttribute("aria-activedescendant")).toBe(
      options[options.length - 1]?.id,
    );
    fireEvent.keyDown(input, { key: "Home" });
    expect(input.getAttribute("aria-activedescendant")).toBe(first.id);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(first.id);
    expect((await axe(container)).violations).toEqual([]);
  });

  it("navigates to the active result's validated route on Enter and on click", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    const { input } = await openPalette();
    fireEvent.change(input, { target: { value: "bearer token" } });
    const options = await screen.findAllByRole("option");
    expect(options[0]?.textContent).toContain("Bearer tokens");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(assign).toHaveBeenCalledWith("/docs/authentication#bearer-tokens");
    fireEvent.click(options[1] as HTMLElement);
    expect(assign).toHaveBeenCalledTimes(2);
    expect(String(assign.mock.calls[1]?.[0]).startsWith("/")).toBe(true);
  });

  it("announces counts politely after typing pauses, and the no-results state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { input } = await openPalette();
      const status = screen.getByRole("status");
      fireEvent.change(input, { target: { value: "webhook" } });
      expect(status.textContent).toBe("");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(450);
      });
      expect(status.textContent).toMatch(/^\d+ results?\.$/);
      fireEvent.change(input, { target: { value: "zzzzqq" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(450);
      });
      expect(status.textContent).toBe("No results for “zzzzqq”.");
      expect(
        screen.getAllByText(/No results for “zzzzqq”/).length,
      ).toBeGreaterThan(0);
      expect(screen.queryAllByRole("option")).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps hostile indexed text and queries inert", async () => {
    const { container, input } = await openPalette();
    fireEvent.change(input, { target: { value: "<script>alert(1)</script>" } });
    const options = await screen.findAllByRole("option");
    const hostile = options.find((option) =>
      option.textContent?.includes("Reading raw content safely"),
    );
    expect(hostile).toBeDefined();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    for (const query of ["__proto__", "constructor", "x".repeat(10_000)]) {
      fireEvent.change(input, { target: { value: query } });
    }
    expect(input.getAttribute("maxlength")).toBe("200");
    expect((await axe(container)).violations).toEqual([]);
  });

  it("shows a restrained failure state when the index cannot load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    const onClose = vi.fn();
    render(
      <SearchPalette
        onClose={onClose}
        path="/search/index.ffffffffffffffff.json"
      />,
    );
    expect(await screen.findByText(/Search is unavailable/)).toBeDefined();
    const input = screen.getByRole("combobox", {
      name: "Search documentation",
    });
    fireEvent.change(input, { target: { value: "inbox" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Close search/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
