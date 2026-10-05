"use client";

import { useEffect, useRef, useState } from "react";

const COPIED_REVERT_MS = 1_200;

type CopyState = "failed" | "copied" | "idle";

/**
 * Copies a short value (the method and path) to the clipboard. The visible
 * label becomes "Copied" for 1.2 s; a polite status region announces success
 * or failure without renaming the control.
 */
export function CopyButton({
  label,
  name,
  value,
}: Readonly<{
  label: string;
  /** Accessible name; defaults to "Copy <value>" for short values. */
  name?: string;
  value: string;
}>) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <button
        aria-label={name ?? `Copy ${value}`}
        className={`button button--ghost${state === "copied" ? " button--success" : ""}`}
        onClick={async () => {
          clearTimeout(timer.current);
          try {
            await navigator.clipboard.writeText(value);
            setState("copied");
          } catch {
            setState("failed");
          }
          timer.current = setTimeout(() => setState("idle"), COPIED_REVERT_MS);
        }}
        type="button"
      >
        {state === "copied" ? (
          <>
            <span aria-hidden="true">✓ </span>Copied
          </>
        ) : state === "failed" ? (
          "Copy failed"
        ) : (
          label
        )}
      </button>
      <span className="visually-hidden" role="status">
        {state === "copied"
          ? `Copied ${name === undefined ? value : "to the clipboard"}`
          : state === "failed"
            ? "Copy failed; select the text to copy it."
            : ""}
      </span>
    </>
  );
}
