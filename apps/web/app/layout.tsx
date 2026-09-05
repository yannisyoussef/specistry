import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";

import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/space-grotesk";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/reader.css";

import { Shell } from "../components/reader/shell";
import { loadReaderArtifact } from "../lib/reader/artifact";
import { siteName, siteUrl } from "../lib/reader/metadata";
import { THEME_COOKIE, readThemeMode } from "../lib/theme";

export async function generateMetadata(): Promise<Metadata> {
  const { index } = await loadReaderArtifact();
  const base = siteUrl(index);
  return {
    applicationName: siteName(index),
    ...(base === undefined ? {} : { metadataBase: base }),
    title: siteName(index),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const [{ index }, cookieStore, requestHeaders] = await Promise.all([
    loadReaderArtifact(),
    cookies(),
    headers(),
  ]);
  const mode = readThemeMode(cookieStore.get(THEME_COOKIE)?.value);
  const currentPath = requestHeaders.get("x-specra-pathname") ?? "/";
  return (
    <html
      data-theme="glass"
      lang="en"
      {...(mode === "system" ? {} : { "data-mode": mode })}
    >
      <body>
        <Shell currentPath={currentPath} index={index} mode={mode}>
          {children}
        </Shell>
      </body>
    </html>
  );
}
