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
import "./styles/playground.css";
import "./styles/versioning.css";

import { Shell } from "../components/reader/shell";
import { loadReaderFor, versionSwitchTargets } from "../lib/reader/release";
import { siteName, siteUrl } from "../lib/reader/metadata";
import { THEME_COOKIE, readThemeMode, safeReturnPath } from "../lib/theme";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const { content, index } = await loadReaderFor(
    safeReturnPath(requestHeaders.get("x-specistry-pathname") ?? "/"),
  );
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
  const [cookieStore, requestHeaders] = await Promise.all([
    cookies(),
    headers(),
  ]);
  const forwarded = requestHeaders.get("x-specistry-pathname") ?? "/";
  const currentPath = safeReturnPath(forwarded);
  const { content, index, roots, search, version } =
    await loadReaderFor(currentPath);
  const versionTargets =
    version === undefined
      ? []
      : await versionSwitchTargets(currentPath, version.id);
  const mode = readThemeMode(cookieStore.get(THEME_COOKIE)?.value);
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
          // Search and the mobile Try it link need script; without it they
          // disappear rather than sitting dead (navigation still works).
          <noscript>
            <style nonce={nonce}>
              {".search-trigger,.code-bar__try{display:none}"}
            </style>
          </noscript>
        )}
      </head>
      <body>
        <Shell
          content={content}
          currentPath={currentPath}
          index={index}
          mode={mode}
          roots={roots}
          searchPath={search?.path}
          version={version}
          versionTargets={versionTargets}
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}
