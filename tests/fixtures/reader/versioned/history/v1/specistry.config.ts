const config = {
  schemaVersion: 1,
  name: "Versioned",
  openapi: "./openapi.yaml",
  environments: {
    production: {
      label: "Production",
      baseUrl: "https://api.versioned.test/v1",
    },
    local: { label: "Local", baseUrl: "http://127.0.0.1:47391/v1" },
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
    { section: "Start", items: ["getting-started", "authentication"] },
    { api: true },
  ],
};

export default config;
