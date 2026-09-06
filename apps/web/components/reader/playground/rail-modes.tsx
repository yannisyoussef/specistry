"use client";

import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { PlaygroundView } from "../../../lib/reader/playground-view";

/**
 * The rail's `Code | Try it` control (design 5d/5e; SPEC-009 §71–§72).
 * Code is server-rendered and always present; Try it is a real tab only
 * when the build approved at least one live environment, and its island
 * loads on first activation so ordinary pages pay nothing for it. Without
 * JavaScript only the Code heading renders: no dead control. `#try-it`
 * opens the tab on load and from the mobile bar.
 */

const TryIt = lazy(() => import("./try-it"));

function subscribeNever(): () => void {
  return () => {};
}

export function RailModes({
  code,
  eyebrow,
  playground,
}: Readonly<{
  code: ReactNode;
  eyebrow: string;
  playground?: PlaygroundView | undefined;
}>) {
  const id = useId();
  const enhanced = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [mode, setMode] = useState<"code" | "try">("code");
  const [opened, setOpened] = useState(false);
  const canTry = enhanced && playground !== undefined;

  useEffect(() => {
    if (playground === undefined) return;
    const apply = (navigated: boolean) => {
      if (window.location.hash !== "#try-it") return;
      setMode("try");
      setOpened(true);
      if (!navigated) return;
      // From the mobile bar (or any in-page link): bring the rail into view
      // and hand focus to the tab, so keyboard and screen-reader users land
      // where the change happened.
      document.getElementById("code")?.scrollIntoView({ block: "start" });
      document.getElementById(`${id}-tab-try`)?.focus();
    };
    apply(false);
    const onHashChange = () => apply(true);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [id, playground]);

  const select = (next: "code" | "try") => {
    setMode(next);
    if (next === "try") setOpened(true);
  };

  return (
    <>
      <div className="code-rail__bar">
        {canTry ? (
          <div aria-label="Rail mode" className="rail-modes" role="tablist">
            {(["code", "try"] as const).map((candidate) => (
              <button
                aria-controls={`${id}-${candidate}`}
                aria-selected={mode === candidate}
                className="rail-modes__tab"
                id={`${id}-tab-${candidate}`}
                key={candidate}
                onClick={() => select(candidate)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                    event.preventDefault();
                    const next = candidate === "code" ? "try" : "code";
                    select(next);
                    document.getElementById(`${id}-tab-${next}`)?.focus();
                  }
                }}
                role="tab"
                tabIndex={mode === candidate ? 0 : -1}
                type="button"
              >
                {candidate === "code" ? "Code" : "Try it"}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="code-rail__title" id="code-heading">
            Code
          </h2>
        )}
        <span className="code-rail__mode eyebrow">{eyebrow}</span>
      </div>
      {canTry ? (
        <h2 className="visually-hidden" id="code-heading">
          Code
        </h2>
      ) : null}
      <div
        aria-labelledby={canTry ? `${id}-tab-code` : undefined}
        className="rail-modes__panel"
        hidden={mode === "try"}
        id={`${id}-code`}
        role={canTry ? "tabpanel" : undefined}
      >
        {code}
      </div>
      {canTry && opened ? (
        <div
          aria-labelledby={`${id}-tab-try`}
          className="rail-modes__panel"
          hidden={mode === "code"}
          id={`${id}-try`}
          role="tabpanel"
        >
          <Suspense
            fallback={
              <p className="code-rail__note">Loading the playground…</p>
            }
          >
            <TryIt view={playground} />
          </Suspense>
        </div>
      ) : null}
    </>
  );
}
