"use client";

import { useEffect, useRef, useState } from "react";

const COPIED_REVERT_MS = 1_200;

/**
 * Copies a short value (the method and path) to the clipboard. The label
 * becomes "Copied" for 1.2 s, and the change is announced politely.
 */
export function CopyButton({
  label,
  value,
}: Readonly<{ label: string; value: string }>) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      aria-live="polite"
      className="button button--ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), COPIED_REVERT_MS);
        } catch {
          setCopied(false);
        }
      }}
      type="button"
    >
      {copied ? "✓ Copied" : label}
    </button>
  );
}
