const config = {
  schemaVersion: 1,
  name: "TestInbox",
  openapi: "./openapi.yaml",
  branding: {
    accent: "#2a6fdb",
    favicon: "./assets/favicon.png",
    logo: "./assets/logo.svg",
  },
  navigation: [
    {
      section: "Getting started",
      items: ["introduction", "quickstart", "authentication"],
    },
    {
      section: "Concepts",
      items: ["concepts/inbox-lifecycle"],
    },
    {
      section: "Guides",
      items: [
        "guides/waiting-for-email",
        "guides/attachments",
        "guides/ci-integration",
      ],
    },
    { api: true },
    {
      section: "Resources",
      items: [
        "troubleshooting",
        { label: "Status page", link: "https://status.testinbox.email" },
      ],
    },
  ],
};

export default config;
