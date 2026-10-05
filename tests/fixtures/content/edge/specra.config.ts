const config = {
  schemaVersion: 1,
  name: "Content edge cases",
  openapi: "./openapi.yaml",
  navigation: [
    { section: "Broken", items: ["missing-page", "nested/valid"] },
    { api: true },
  ],
};

export default config;
