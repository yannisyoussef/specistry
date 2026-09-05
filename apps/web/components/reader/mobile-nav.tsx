"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Mobile navigation drawer. The API navigation is server-rendered once, in
 * the sidebar; when the drawer opens, that navigation is cloned into a native
 * modal `<dialog>`, which gives focus trapping, `Escape`, and an inert
 * background for free. Cloning keeps the HTML and RSC payload to a single
 * copy of the navigation and leaves React's own tree untouched. Focus returns
 * to the menu button when the drawer closes, and the current operation is
 * scrolled into view when it opens.
 */
export function MobileNav({
  fallback,
  label,
  source,
}: Readonly<{ fallback: string; label: string; source: string }>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    closeDrawer(dialog.current);
  }, [pathname]);

  const open = (): void => {
    const element = dialog.current;
    const container = body.current;
    if (
      element === null ||
      container === null ||
      typeof element.showModal !== "function" ||
      element.open
    ) {
      return;
    }
    if (container.childElementCount === 0) {
      const navigation = document.getElementById(source);
      if (navigation !== null) {
        const copy = navigation.cloneNode(true) as HTMLElement;
        copy.removeAttribute("id");
        container.append(copy);
      }
    }
    element.showModal();
    scrollCurrentIntoView(container);
  };

  return (
    <>
      <a
        aria-haspopup="dialog"
        className="menu-button"
        href={`#${fallback}`}
        onClick={(event) => {
          if (typeof dialog.current?.showModal !== "function") return;
          event.preventDefault();
          open();
        }}
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="20"
          stroke="currentColor"
          strokeWidth="1.75"
          viewBox="0 0 24 24"
          width="20"
        >
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        <span className="visually-hidden">{label}</span>
      </a>
      <dialog
        aria-label={label}
        className="drawer"
        onClick={(event) => {
          if (event.target === dialog.current) closeDrawer(dialog.current);
        }}
        ref={dialog}
      >
        <div className="drawer__header">
          <span className="eyebrow">{label}</span>
          <button
            className="menu-button"
            onClick={() => closeDrawer(dialog.current)}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="20"
              stroke="currentColor"
              strokeWidth="1.75"
              viewBox="0 0 24 24"
              width="20"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            <span className="visually-hidden">Close navigation</span>
          </button>
        </div>
        <div className="drawer__body" ref={body} />
      </dialog>
    </>
  );
}

function closeDrawer(element: HTMLDialogElement | null): void {
  if (element !== null && typeof element.close === "function" && element.open) {
    element.close();
  }
}

/** Centres the current item in a scrolling container without moving the page. */
export function scrollCurrentIntoView(container: HTMLElement): void {
  const current = container.querySelector<HTMLElement>('[aria-current="page"]');
  if (current === null) return;
  const offset =
    current.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop;
  container.scrollTop = Math.max(
    0,
    offset - container.clientHeight / 2 + current.offsetHeight / 2,
  );
}
