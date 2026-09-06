const config = {
  schemaVersion: 1,
  name: "TestInbox",
  openapi: "./openapi.yaml",
  branding: {
    accent: "#2a6fdb",
    favicon: "./assets/favicon.png",
    logo: "./assets/logo.svg",
  },
  environments: {
    production: {
      label: "Production",
      baseUrl: "https://api.testinbox.email/v1",
    },
    sandbox: {
      label: "Sandbox",
      baseUrl: "https://sandbox.testinbox.email/v1",
    },
    local: { label: "Local", baseUrl: "http://127.0.0.1:47391/v1" },
  },
  // Illustrative SDK mappings for the reader fixture: consumer-authored data
  // that Specra renders verbatim. They document the fixture's imaginary SDKs,
  // not a published TestInbox client.
  sdks: [
    {
      id: "typescript",
      label: "TypeScript SDK",
      language: "typescript",
      package: "@testinbox/sdk",
      coverage: "partial",
      examples: "./sdk/typescript.json",
    },
    {
      id: "java",
      label: "Java SDK",
      language: "java",
      package: "email.testinbox:sdk",
      coverage: "partial",
      examples: [
        {
          operation: "createInbox",
          title: "Create an inbox",
          file: "./sdk/java/CreateInbox.java",
        },
        {
          operation: { method: "POST", path: "/inboxes/{inboxId}/wait" },
          title: "Wait for a message",
          file: "./sdk/java/WaitForMessage.java",
        },
      ],
    },
  ],
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
