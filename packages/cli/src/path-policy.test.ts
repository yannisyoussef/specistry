import { describe, expect, it } from "vitest";

import { classifyProjectPath, isPathWithin } from "./path-policy.js";

describe("project path semantics", () => {
  it.each([
    ["./docs", "relative"],
    ["docs/reference", "relative"],
    ["docs/./reference", "relative"],
    ["../outside", "traversal"],
    ["docs\\..\\outside", "traversal"],
    ["/etc/passwd", "absolute"],
    ["C:\\Windows\\system.ini", "absolute"],
    ["\\\\server\\share\\file", "absolute"],
    ["file:///etc/passwd", "absolute"],
    ["", "invalid"],
    ["docs\0secret", "invalid"],
  ] as const)("classifies %s as %s", (value, expected) => {
    expect(classifyProjectPath(value)).toBe(expected);
  });

  it("uses POSIX ancestry rather than string prefixes", () => {
    expect(isPathWithin("/project", "/project/docs", "posix")).toBe(true);
    expect(isPathWithin("/project", "/project", "posix")).toBe(true);
    expect(isPathWithin("/project", "/project-sibling", "posix")).toBe(false);
    expect(
      isPathWithin("/project", "/project/docs/../../secret", "posix"),
    ).toBe(false);
  });

  it("models Windows drives, separators, and case semantics deterministically", () => {
    expect(isPathWithin("C:\\Project", "c:\\project\\docs", "win32")).toBe(
      true,
    );
    expect(isPathWithin("C:\\Project", "C:\\ProjectSibling", "win32")).toBe(
      false,
    );
    expect(isPathWithin("C:\\Project", "D:\\Project\\docs", "win32")).toBe(
      false,
    );
    expect(
      isPathWithin("C:\\Project", "C:\\Project\\docs\\..\\..\\secret", "win32"),
    ).toBe(false);
  });
});
