"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * Header search control (SPEC-007 §69–70). It is the only search code every
 * page ships: a button, the platform shortcut, and a lazy import of the
 * palette chunk (engine + dialog) on first open. Focus returns here when the
 * palette closes. Without JavaScript the layout hides it.
 */

const SearchPalette = lazy(() => import("./search-palette"));

function subscribeNever(): () => void {
  return () => {};
}

export function SearchTrigger({ path }: Readonly<{ path: string }>) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const apple =
    hydrated &&
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);

  // Focus can only return once the modal dialog has left the DOM: while it
  // is open everything outside it is inert, so the restore runs after the
  // close has rendered.
  const restore = useRef(false);
  const close = useCallback(() => {
    restore.current = true;
    setOpen(false);
  }, []);
  useEffect(() => {
    if (!open && restore.current) {
      restore.current = false;
      button.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      event.preventDefault();
      if (open) {
        restore.current = true;
        setOpen(false);
      } else {
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className="search-trigger"
        onClick={() => setOpen(true)}
        ref={button}
        type="button"
      >
        <SearchIcon />
        <span className="search-trigger__label">Search…</span>
        {hydrated ? (
          <kbd aria-hidden="true" className="search-trigger__kbd">
            {apple ? "⌘K" : "Ctrl K"}
          </kbd>
        ) : null}
        <span className="visually-hidden">
          {apple ? " (Command K)" : " (Control K)"}
        </span>
      </button>
      {open ? (
        <Suspense fallback={null}>
          <SearchPalette onClose={close} path={path} />
        </Suspense>
      ) : null}
    </>
  );
}

export function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
      width="18"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
