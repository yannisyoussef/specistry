import type { NextConfig } from "next";
import path from "node:path";

// The Content-Security-Policy is set per request with a nonce in `proxy.ts`;
// the fixed headers below apply to every response, static assets included.
const securityHeaders = [
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=()",
  },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

const nextConfig: NextConfig = {
  // Dependency-written agent instructions are a supply-chain channel; the
  // tracked AGENTS.md is reviewed like any other change instead.
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  async headers() {
    return [{ headers: [...securityHeaders], source: "/(.*)" }];
  },
};

export default nextConfig;
