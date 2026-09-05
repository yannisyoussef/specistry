"use client";

import { useEffect } from "react";

import { scrollCurrentIntoView } from "./mobile-nav";

/**
 * Scrolls the sidebar so the current operation is visible on load, as the
 * design contract requires, without touching the page scroll position. It
 * renders nothing and is the only client code the desktop sidebar carries.
 */
export function SidebarScroll({ target }: Readonly<{ target: string }>) {
  useEffect(() => {
    const container = document.getElementById(target);
    if (container !== null) scrollCurrentIntoView(container);
  }, [target]);
  return null;
}
