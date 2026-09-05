import { describe, expect, it } from "vitest";

import {
  comparePointers,
  escapeSegment,
  joinPointer,
  parsePointer,
  resolvePointer,
} from "./pointer.js";
import { resolveDocumentId, splitReference } from "./references.js";

describe("JSON pointers", () => {
  it("escapes, joins, parses, and resolves RFC 6901 pointers", () => {
    expect(escapeSegment("a/b~c")).toBe("a~1b~0c");
    expect(joinPointer("", "paths", "/pets/{id}", "get")).toBe(
      "/paths/~1pets~1{id}/get",
    );
    expect(parsePointer("")).toEqual([]);
    expect(parsePointer("/paths/~1pets/get")).toEqual([
      "paths",
      "/pets",
      "get",
    ]);
    expect(parsePointer("paths")).toBeUndefined();
    expect(parsePointer("/bad~2escape")).toBeUndefined();
    const document = { list: [{ deep: true }], paths: { "/pets": { get: 1 } } };
    expect(resolvePointer(document, ["paths", "/pets", "get"])).toEqual({
      found: true,
      value: 1,
    });
    expect(resolvePointer(document, ["list", "0", "deep"])).toEqual({
      found: true,
      value: true,
    });
    expect(resolvePointer(document, ["list", "00"])).toEqual({ found: false });
    expect(resolvePointer(document, ["list", "1"])).toEqual({ found: false });
    expect(resolvePointer(document, ["paths", "constructor"])).toEqual({
      found: false,
    });
    expect(resolvePointer(document, ["paths", "/pets", "get", "x"])).toEqual({
      found: false,
    });
  });

  it("orders pointers segment-wise with numeric awareness", () => {
    const sorted = [
      "/paths/10",
      "/paths/2",
      "/paths",
      "/paths/2/get",
      "/a",
    ].sort(comparePointers);
    expect(sorted).toEqual([
      "/a",
      "/paths",
      "/paths/2",
      "/paths/2/get",
      "/paths/10",
    ]);
  });
});

describe("reference resolution", () => {
  it("splits and decodes references, rejecting hostile forms", () => {
    expect(splitReference("#/components/schemas/A")).toEqual({
      fragment: "/components/schemas/A",
      location: "",
    });
    expect(splitReference("./sch%20ema.yaml#/A")).toEqual({
      fragment: "/A",
      location: "./sch ema.yaml",
    });
    expect(splitReference("schemas/a.yaml")).toEqual({
      fragment: undefined,
      location: "schemas/a.yaml",
    });
    expect(splitReference("%zz")).toBeUndefined();
    expect(splitReference("a\\b.yaml")).toBeUndefined();
    expect(splitReference("a\u0000.yaml")).toBeUndefined();
  });

  it("confines document ids lexically to the project root", () => {
    expect(resolveDocumentId("openapi.yaml", "schemas/a.yaml")).toEqual({
      id: "schemas/a.yaml",
      ok: true,
    });
    expect(resolveDocumentId("openapi.yaml", "./schemas/./a.yaml")).toEqual({
      id: "schemas/a.yaml",
      ok: true,
    });
    expect(resolveDocumentId("schemas/a.yaml", "../b.yaml")).toEqual({
      id: "b.yaml",
      ok: true,
    });
    expect(resolveDocumentId("schemas/a.yaml", "b.yaml")).toEqual({
      id: "schemas/b.yaml",
      ok: true,
    });
    expect(resolveDocumentId("openapi.yaml", "")).toEqual({
      id: "openapi.yaml",
      ok: true,
    });
    expect(resolveDocumentId("openapi.yaml", "../b.yaml")).toEqual({
      ok: false,
      reason: "outside",
    });
    expect(resolveDocumentId("schemas/a.yaml", "../../b.yaml")).toEqual({
      ok: false,
      reason: "outside",
    });
    expect(resolveDocumentId("openapi.yaml", "/etc/passwd")).toEqual({
      ok: false,
      reason: "outside",
    });
    expect(resolveDocumentId("openapi.yaml", "c:/windows")).toEqual({
      ok: false,
      reason: "outside",
    });
    expect(resolveDocumentId("openapi.yaml", "./")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
