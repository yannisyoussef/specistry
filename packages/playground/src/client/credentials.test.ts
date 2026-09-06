import { describe, expect, it } from "vitest";

import { createCredentialVault, schemeKey } from "./credentials.js";

/** SPEC-009 §45–§50, §79: memory-only, per-environment, per-scheme isolation. */
describe("credential vault", () => {
  it("isolates values by environment and scheme", () => {
    const vault = createCredentialVault();
    vault.set("sandbox", "bearer", { token: "sandbox-token" });
    vault.set("production", "bearer", { token: "production-token" });
    vault.set("sandbox", "apiKeyHeader:X-Api-Key", { apiKey: "key" });
    expect(vault.get("sandbox", "bearer")).toEqual({ token: "sandbox-token" });
    expect(vault.get("production", "bearer")).toEqual({
      token: "production-token",
    });
    expect(vault.get("production", "apiKeyHeader:X-Api-Key")).toBeUndefined();
    expect(vault.size()).toBe(3);
  });

  it("drops empty fields and removes entries that become empty", () => {
    const vault = createCredentialVault();
    vault.set("e", "basic", { password: "", username: "alice" });
    expect(vault.get("e", "basic")).toEqual({ username: "alice" });
    vault.set("e", "basic", { username: "" });
    expect(vault.get("e", "basic")).toBeUndefined();
    expect(vault.size()).toBe(0);
  });

  it("clears one environment or everything", () => {
    const vault = createCredentialVault();
    vault.set("a", "bearer", { token: "1" });
    vault.set("b", "bearer", { token: "2" });
    vault.clear("a");
    expect(vault.get("a", "bearer")).toBeUndefined();
    expect(vault.get("b", "bearer")).toEqual({ token: "2" });
    vault.clear();
    expect(vault.size()).toBe(0);
  });

  it("cannot be confused by an environment id that contains the other id", () => {
    const vault = createCredentialVault();
    vault.set("prod", "bearer", { token: "1" });
    vault.set("prod-eu", "bearer", { token: "2" });
    vault.clear("prod");
    expect(vault.get("prod-eu", "bearer")).toEqual({ token: "2" });
  });

  it("does not expose its entries through JSON or enumeration", () => {
    const vault = createCredentialVault();
    vault.set("e", "bearer", { token: "hidden-token" });
    expect(JSON.stringify(vault)).not.toContain("hidden-token");
    expect(Object.keys(vault)).toEqual(["clear", "get", "set", "size"]);
  });

  it("derives a scheme key from kind and name", () => {
    expect(schemeKey({ kind: "bearer" })).toBe("bearer");
    expect(schemeKey({ kind: "apiKeyHeader", name: "X-Api-Key" })).toBe(
      "apiKeyHeader:X-Api-Key",
    );
  });
});
