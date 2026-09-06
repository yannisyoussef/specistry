"use client";

import { useRouter } from "next/navigation";

/**
 * The one App Router dependency of the Code rail, isolated so tests outside
 * Next can stub it. A soft replace keeps scroll position and focus while the
 * server renders the examples for the new selection.
 */
export function useReplaceUrl(): (url: string) => void {
  const router = useRouter();
  return (url) => router.replace(url, { scroll: false });
}
