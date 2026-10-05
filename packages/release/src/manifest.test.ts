import { describe, expect, it } from "vitest";

import {
  findRelease,
  parseReleaseCatalog,
  selectorOrder,
  serializeReleaseCatalog,
  type ReleaseCatalog,
} from "./catalog.js";
import {
  computeReleaseDigest,
  createReleaseManifest,
  parseReleaseManifest,
  ReleaseContractError,
  serializeReleaseManifest,
  sha256Of,
  type ReleaseManifest,
} from "./manifest.js";

/**
 * SPEC-010 §12–§15, §17, §98–§101, §114–§115: the manifest identifies the
 * exact component set, equal content yields equal identity, and both the
 * manifest and the catalog fail closed on tampering, unknown formats, an
 * unknown current, duplicates, and traversal.
 */

const component = (file: string, text: string, format = 1) => ({
  bytes: Buffer.byteLength(text, "utf8"),
  file,
  format,
  sha256: sha256Of(text),
});

const manifest: ReleaseManifest = createReleaseManifest({
  assets: [
    { bytes: 3, path: "assets/0123456789abcdef.png", sha256: sha256Of("png") },
  ],
  components: {
    documentation: component("documentation.json", "{}"),
    manifest: component("manifest.json", "{}"),
    routes: component("routes.json", "[]"),
    search: component("search.json", "{}", 1),
  },
  project: { id: "testinbox", name: "TestInbox" },
  version: "v1",
});

function tampered(
  edit: (value: Record<string, unknown>) => void,
): () => ReleaseManifest {
  const value = JSON.parse(serializeReleaseManifest(manifest)) as Record<
    string,
    unknown
  >;
  edit(value);
  return () => parseReleaseManifest(JSON.stringify(value));
}

describe("release manifest", () => {
  it("round-trips deterministically and derives identity from the component set", () => {
    const text = serializeReleaseManifest(manifest);
    expect(text.endsWith("\n")).toBe(true);
    expect(parseReleaseManifest(text)).toEqual(manifest);
    expect(serializeReleaseManifest(parseReleaseManifest(text))).toBe(text);
    const reordered = createReleaseManifest({
      assets: manifest.assets,
      components: {
        search: manifest.components.search!,
        routes: manifest.components.routes!,
        manifest: manifest.components.manifest!,
        documentation: manifest.components.documentation!,
      },
      project: manifest.project,
      version: "v2",
    });
    // Equal content, another id: same aggregate identity.
    expect(reordered.digest).toBe(manifest.digest);
    expect(computeReleaseDigest(manifest)).toBe(manifest.digest);
    expect(text).not.toMatch(/\/Users|C:\\|\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects a manifest whose digest does not match its components", () => {
    expect(
      tampered((value) => {
        (
          value.components as Record<string, Record<string, unknown>>
        ).documentation!.sha256 = "0".repeat(64);
      }),
    ).toThrow(/digest does not match/);
    expect(
      tampered((value) => {
        value.digest = "f".repeat(64);
      }),
    ).toThrow(/digest does not match/);
    expect(
      tampered((value) => {
        (value.assets as unknown[]).pop();
      }),
    ).toThrow(/digest does not match/);
  });

  it("rejects unknown shapes, formats, components, files, and traversal", () => {
    expect(
      tampered((value) => {
        value.releaseFormat = 2;
      }),
    ).toThrow(ReleaseContractError);
    expect(
      tampered((value) => {
        value.proxy = "https://relay.example";
      }),
    ).toThrow(/not recognized/);
    expect(
      tampered((value) => {
        (value.components as Record<string, unknown>).secrets = {
          bytes: 1,
          file: "secrets.json",
          format: 1,
          sha256: "a".repeat(64),
        };
      }),
    ).toThrow(/unknown/);
    expect(
      tampered((value) => {
        (
          value.components as Record<string, Record<string, unknown>>
        ).routes!.file = "../catalog.json";
      }),
    ).toThrow(/record is invalid/);
    expect(
      tampered((value) => {
        (
          value.components as Record<string, Record<string, unknown>>
        ).routes!.file = "documentation.json";
      }),
    ).toThrow(/same file/);
    expect(
      tampered((value) => {
        delete (value.components as Record<string, unknown>).routes;
      }),
    ).toThrow(/needs documentation/);
    expect(
      tampered((value) => {
        (value.components as Record<string, unknown>).content = {
          bytes: 1,
          file: "content.json",
          format: 1,
          sha256: "a".repeat(64),
        };
      }),
    ).toThrow(/come together/);
    expect(
      tampered((value) => {
        value.version = "current";
      }),
    ).toThrow(/version id/);
    expect(
      tampered((value) => {
        value.version = "../v1";
      }),
    ).toThrow(/version id/);
    expect(
      tampered((value) => {
        (value.assets as Record<string, unknown>[])[0]!.path =
          "../../etc/passwd";
      }),
    ).toThrow(/asset record/);
    expect(() => parseReleaseManifest("{")).toThrow(/valid JSON/);
    expect(() => parseReleaseManifest("[]")).toThrow(/not recognized/);
  });
});

const catalog: ReleaseCatalog = {
  catalogFormat: 1,
  current: "v2",
  releases: [
    {
      changelog: false,
      digest: "a".repeat(64),
      state: "deprecated",
      version: "v1",
    },
    {
      changelog: true,
      date: "2026-09-06",
      digest: "b".repeat(64),
      label: "2.0",
      state: "supported",
      version: "v2",
    },
  ],
};

function catalogTampered(
  edit: (value: Record<string, unknown>) => void,
): () => ReleaseCatalog {
  const value = JSON.parse(serializeReleaseCatalog(catalog)) as Record<
    string,
    unknown
  >;
  edit(value);
  return () => parseReleaseCatalog(JSON.stringify(value));
}

describe("release catalog", () => {
  it("round-trips and keeps explicit order", () => {
    const text = serializeReleaseCatalog(catalog);
    expect(parseReleaseCatalog(text)).toEqual(catalog);
    expect(selectorOrder(catalog).map((release) => release.version)).toEqual([
      "v2",
      "v1",
    ]);
    expect(findRelease(catalog, "v1")?.state).toBe("deprecated");
    expect(findRelease(catalog, "V1")).toBeUndefined();
    expect(findRelease(catalog, "v999")).toBeUndefined();
  });

  it("refuses an unknown current instead of inferring latest", () => {
    expect(
      catalogTampered((value) => {
        value.current = "v999";
      }),
    ).toThrow(/current version is not a retained release/);
    expect(
      catalogTampered((value) => {
        value.current = "latest";
      }),
    ).toThrow(/current/);
    expect(
      catalogTampered((value) => {
        delete value.current;
      }),
    ).toThrow(/current/);
    expect(
      catalogTampered((value) => {
        value.releases = [];
      }),
    ).toThrow(/at least one/);
  });

  it("refuses duplicates, invalid ids, traversal, prototype keys, and unsupported formats", () => {
    expect(
      catalogTampered((value) => {
        (value.releases as Record<string, unknown>[]).push({
          changelog: false,
          digest: "c".repeat(64),
          state: "supported",
          version: "V2",
        });
      }),
    ).toThrow(/case-insensitively/);
    expect(
      catalogTampered((value) => {
        (value.releases as Record<string, unknown>[])[0]!.version = "../v1";
      }),
    ).toThrow(/version id/);
    expect(
      catalogTampered((value) => {
        (value.releases as Record<string, unknown>[])[0]!.version = "__proto__";
      }),
    ).toThrow(/version id/);
    expect(
      catalogTampered((value) => {
        (value.releases as Record<string, unknown>[])[0]!.digest = "zz";
      }),
    ).toThrow(/digest/);
    expect(
      catalogTampered((value) => {
        (value.releases as Record<string, unknown>[])[0]!.state = "beta";
      }),
    ).toThrow(/state/);
    expect(
      catalogTampered((value) => {
        (value.releases as Record<string, unknown>[])[1]!.date = "yesterday";
      }),
    ).toThrow(/date/);
    expect(
      catalogTampered((value) => {
        (value.releases as Record<string, unknown>[])[1]!.path = "/tmp/x";
      }),
    ).toThrow(/record is invalid/);
    expect(
      catalogTampered((value) => {
        value.catalogFormat = 9;
      }),
    ).toThrow(/unsupported/);
    expect(() =>
      parseReleaseCatalog(
        JSON.stringify({
          __proto__: { polluted: true },
          catalogFormat: 1,
          current: "v1",
          releases: [],
        }),
      ),
    ).toThrow(ReleaseContractError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
