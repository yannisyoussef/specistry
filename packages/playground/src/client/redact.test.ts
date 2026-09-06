import { describe, expect, it } from "vitest";

import {
  isCredentialHeader,
  MASK,
  redactHeader,
  redactHeaders,
  sanitizeHeaderValue,
} from "./redact.js";

/** SPEC-009 §69, §120–§122: presentation redaction is total for credentials. */
describe("redaction", () => {
  it("recognizes credential headers case-insensitively", () => {
    for (const name of [
      "Authorization",
      "AUTHORIZATION",
      "x-api-key",
      "X-Api-Key",
      "Proxy-Authorization",
      "X-Auth-Token",
      "Api-Key",
      "apikey",
      "X-Access-Token",
      "X-Secret-Thing",
      "password",
    ]) {
      expect(isCredentialHeader(name), name).toBe(true);
    }
    for (const name of [
      "Accept",
      "Content-Type",
      "X-Request-Id",
      "If-None-Match",
    ]) {
      expect(isCredentialHeader(name), name).toBe(false);
    }
  });

  it("masks credential values but keeps the scheme word", () => {
    expect(
      redactHeader({ name: "Authorization", value: "Bearer sk_live_abc" }),
    ).toEqual({ name: "Authorization", value: `Bearer ${MASK}` });
    expect(
      redactHeader({ name: "Authorization", value: "Basic dXNlcjpwYXNz" }),
    ).toEqual({ name: "Authorization", value: `Basic ${MASK}` });
    expect(redactHeader({ name: "X-API-Key", value: "plain-key" })).toEqual({
      name: "X-API-Key",
      value: MASK,
    });
  });

  it("masks secret-shaped values in ordinary headers and leaves plain values", () => {
    expect(
      redactHeader({
        name: "X-Trace",
        value: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc",
      }).value,
    ).toBe(MASK);
    expect(redactHeader({ name: "Accept", value: "application/json" })).toEqual(
      { name: "Accept", value: "application/json" },
    );
  });

  it("never leaks a credential through the list helper", () => {
    const secret = "sk_live_51H8sEcReT0kEn";
    const text = JSON.stringify(
      redactHeaders([
        { name: "Authorization", value: `Bearer ${secret}` },
        { name: "X-Api-Key", value: secret },
        { name: "Content-Type", value: "application/json" },
      ]),
    );
    expect(text).not.toContain(secret);
    expect(text).toContain("application/json");
  });

  it("strips control and bidi characters from response header text and bounds it", () => {
    expect(sanitizeHeaderValue("ok\u0000\u001f\u202e\u200b\ufeff", 64)).toBe(
      "ok",
    );
    expect(sanitizeHeaderValue("a\r\nb\tc", 64)).toBe("a b c");
    expect(sanitizeHeaderValue("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
