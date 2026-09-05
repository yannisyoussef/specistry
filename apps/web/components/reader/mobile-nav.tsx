"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/* Feature-detected so environments without the dialog API degrade to inert. */
function openDrawer(element: HTMLDialogElement | null): void {
  if (
    element !== null &&
    typeof element.showModal === "function" &&
    !element.open
  ) {
    element.showModal();
  }
}

function closeDrawer(element: HTMLDialogElement | null): void {
  if (element !== null && typeof element.close === "function" && element.open) {
    element.close();
  }
}

/**
 * Mobile navigation drawer. The navigation itself is server-rendered and
 * passed as children; this island only opens and closes a native modal
 * `<dialog>`, which gives focus trapping, `Escape`, and inert background for
 * free. Focus returns to the menu button when the drawer closes.
 */
export function MobileNav({
  children,
  label,
}: Readonly<{ children: ReactNode; label: string }>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    closeDrawer(dialog.current);
  }, [pathname]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        className="menu-button"
        onClick={() => openDrawer(dialog.current)}
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
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        <span className="visually-hidden">{label}</span>
      </button>
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
        <div className="drawer__body">{children}</div>
      </dialog>
    </>
  );
}
