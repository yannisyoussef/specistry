const config = {
  schemaVersion: 1,
  name: "Navigation",
  openapi: "./openapi.yaml",
  branding: { accent: "#0f766e" },
  navigation: [
    "introduction",
    {
      section: "Guides",
      items: [
        { page: "guides/first-steps", label: "First steps (renamed)" },
        { section: "Advanced", items: ["guides/advanced/tuning"] },
      ],
    },
    { api: true, label: "Widgets API" },
    {
      section: "Reference",
      items: [
        "reference",
        { label: "Changelog", link: "https://example.test/changelog" },
      ],
    },
  ],
};

export default config;
