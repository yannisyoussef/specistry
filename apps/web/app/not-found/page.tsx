import type { Metadata } from "next";

import { NotFoundPage } from "../../components/reader/not-found-page";

/**
 * Server-rendered 404 target. `proxy.ts` rewrites unknown API reference
 * routes here with a 404 status so the not-found page is real HTML (a
 * `notFound()` thrown from a dynamic route renders only a client error shell).
 */
export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Page not found",
};

export default function NotFoundRoute() {
  return <NotFoundPage />;
}
