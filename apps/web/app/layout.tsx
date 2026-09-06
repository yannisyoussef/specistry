import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/space-grotesk";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/reader.css";
import "./styles/schema.css";
import "./styles/content.css";
import "./styles/search.css";
import "./styles/code.css";

import { Shell } from "../components/reader/shell";
import { loadReaderArtifact } from "../lib/reader/artifact";
import { siteName, siteUrl } from "../lib/reader/metadata";
import { THEME_COOKIE, readThemeMode, safeReturnPath } from "../lib/theme";

export async function generateMetadata(): Promise<Metadata> {
  const { content, index } = await loadReaderArtifact();
  const base = siteUrl(index);
  const favicon = content?.branding?.favicon;
  return {
    applicationName: siteName(index),
    ...(favicon === undefined ? {} : { icons: { icon: `/${favicon}` } }),
    ...(base === undefined ? {} : { metadataBase: base }),
    title: siteName(index),
  };
}

/** The request nonce, read back from the policy the proxy set. */
function nonceFrom(policy: string | null): string | undefined {
  return /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy ?? "")?.[1];
}

/** Six-digit hex only; the config already validated it, this is defence in depth. */
function accentDeclaration(accent: string | undefined): string | undefined {
  return accent !== undefined && /^#[0-9a-f]{6}$/i.test(accent)
    ? `:root{--brand:${accent.toLowerCase()}}`
    : undefined;
}

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [{ content, index, search }, cookieStore, requestHeaders] =
    await Promise.all([loadReaderArtifact(), cookies(), headers()]);
  const mode = readThemeMode(cookieStore.get(THEME_COOKIE)?.value);
  const forwarded = requestHeaders.get("x-specra-pathname") ?? "/";
  const currentPath = safeReturnPath(forwarded);
  const nonce = nonceFrom(requestHeaders.get("content-security-policy"));
  const accent = accentDeclaration(content?.branding?.accent);
  return (
    <html
      data-theme="glass"
      lang="en"
      {...(mode === "system" ? {} : { "data-mode": mode })}
    >
      <head>
        {accent === undefined || nonce === undefined ? null : (
          // The consumer accent is one validated custom property; the nonce
          // keeps it inside the strict style-src policy.
          <style nonce={nonce}>{accent}</style>
        )}
        {nonce === undefined ? null : (
          // Search needs script; without it the trigger disappears rather
          // than sitting dead in the header (navigation still works).
          <noscript>
            <style nonce={nonce}>{".search-trigger{display:none}"}</style>
          </noscript>
        )}
      </head>
      <body>
        <Shell
          content={content}
          currentPath={currentPath}
          index={index}
          mode={mode}
          searchPath={search?.path}
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}
