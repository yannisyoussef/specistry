import { defineConfig } from "@specistry/config";

export default defineConfig({
  schemaVersion: 1,
  name: "Specistry Documentation",
  branding: { accent: "#4f46e5" },
  navigation: [
    { section: "Start", items: ["introduction", "installation", "quickstart"] },
    {
      section: "Author",
      items: [
        "configuration",
        "openapi",
        "content-navigation",
        "schemas-search",
        "code-sdks",
        "playground",
      ],
    },
    {
      section: "Operate",
      items: [
        "versions-quality",
        "cli",
        "deployment",
        "security",
        "compatibility-support",
      ],
    },
  ],
  quality: { failOn: "error" },
});
