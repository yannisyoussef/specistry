import type { Metadata } from "next";

import { NotFoundPage } from "../components/reader/not-found-page";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Page not found",
};

export default function NotFound() {
  return <NotFoundPage />;
}
