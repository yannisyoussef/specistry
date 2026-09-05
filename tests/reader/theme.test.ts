import { describe, expect, it } from "vitest";

import { readThemeMode, safeReturnPath } from "../../apps/web/lib/theme";

describe("theme helpers", () => {
  it("reads only the two explicit modes from the cookie", () => {
    expect(readThemeMode("light")).toBe("light");
    expect(readThemeMode("dark")).toBe("dark");
    expect(readThemeMode("system")).toBe("system");
    expect(readThemeMode("DARK")).toBe("system");
    expect(readThemeMode("")).toBe("system");
    expect(readThemeMode(undefined)).toBe("system");
  });

  it("accepts only same-origin absolute paths as the redirect target", () => {
    expect(safeReturnPath("/api/inboxes/create-inbox")).toBe(
      "/api/inboxes/create-inbox",
    );
    expect(safeReturnPath("/api?x=1#responses")).toBe("/api?x=1#responses");
    expect(safeReturnPath("/")).toBe("/");
    for (const hostile of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example/",
      "javascript:alert(1)",
      "api/inboxes",
      "/api/\r\nSet-Cookie: a=b",
      "/api/ünïcode",
      "/api/with space",
      `/${"a".repeat(2_049)}`,
      "",
      null,
      undefined,
      new File([], "form.txt"),
    ]) {
      expect(safeReturnPath(hostile), String(hostile)).toBe("/");
    }
  });
});
