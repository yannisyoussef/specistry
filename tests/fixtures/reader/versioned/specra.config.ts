// Multi-version reader fixture (SPEC-010). The root holds the v2 sources; the
// v1 sources live under history/v1. scripts/build-versioned-fixture.mjs builds
// both, promotes them into .specra/releases, and the drift guard reproduces it.
const config = {
  schemaVersion: 1,
  name: "Versioned",
  openapi: "./openapi.yaml",
  environments: {
    production: {
      label: "Production",
      baseUrl: "https://api.versioned.test/v2",
    },
    local: { label: "Local", baseUrl: "http://127.0.0.1:47393/v2" },
  },
  playground: { mode: "browser", environments: ["local"] },
  sdks: [
    {
      id: "typescript",
      label: "TypeScript SDK",
      language: "typescript",
      package: "@versioned/sdk",
      coverage: "partial",
      examples: "./sdk/typescript.json",
    },
  ],
  navigation: [
    { section: "Start", items: ["quickstart", "authentication"] },
    { api: true },
  ],
  redirects: [{ from: "/docs/getting-started", to: "/docs/quickstart" }],
};

export default config;
