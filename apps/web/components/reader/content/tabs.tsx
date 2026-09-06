"use client";

import {
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Accessible tabs (WAI-ARIA tabs pattern) for authored `<Tabs>` and
 * `<CodeGroup>`. The server renders every panel with a heading so the content
 * is complete without JavaScript; after hydration the heading row becomes a
 * tablist with roving focus (Left/Right/Home/End), `aria-selected`, and
 * `aria-controls`, and only the selected panel stays visible.
 */
function subscribeNever(): () => void {
  return () => {};
}

export function Tabs({
  headingLevel = 4,
  label,
  labels,
  panels,
}: Readonly<{
  /** Heading level of the static per-panel headings (no-JavaScript shape). */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Accessible name of the tab list, e.g. "Choose your client". */
  label: string;
  labels: readonly string[];
  panels: readonly ReactNode[];
}>) {
  const id = useId();
  const [selected, setSelected] = useState(0);
  // False during server rendering and hydration, true once the client has
  // taken over: the static headings become a real tablist only then.
  const enhanced = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const Heading = `h${headingLevel}` as const;

  const move = (from: number, delta: number): void => {
    const count = labels.length;
    const next = (from + delta + count) % count;
    setSelected(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="tabs-block" data-enhanced={enhanced ? "true" : "false"}>
      <div
        aria-label={label}
        className="tabs-block__list"
        role={enhanced ? "tablist" : undefined}
      >
        {labels.map((tab, index) => {
          const active = enhanced && index === selected;
          return enhanced ? (
            <button
              aria-controls={`${id}-panel-${index}`}
              aria-selected={active}
              className="tabs-block__tab"
              id={`${id}-tab-${index}`}
              key={tab}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => {
                switch (event.key) {
                  case "ArrowRight":
                  case "ArrowDown":
                    event.preventDefault();
                    move(index, 1);
                    break;
                  case "ArrowLeft":
                  case "ArrowUp":
                    event.preventDefault();
                    move(index, -1);
                    break;
                  case "Home":
                    event.preventDefault();
                    setSelected(0);
                    tabs.current[0]?.focus();
                    break;
                  case "End":
                    event.preventDefault();
                    setSelected(labels.length - 1);
                    tabs.current[labels.length - 1]?.focus();
                    break;
                  default:
                    break;
                }
              }}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              role="tab"
              tabIndex={active ? 0 : -1}
              type="button"
            >
              {tab}
            </button>
          ) : (
            <span className="tabs-block__tab tabs-block__tab--static" key={tab}>
              {tab}
            </span>
          );
        })}
      </div>
      {panels.map((panel, index) => (
        <section
          aria-labelledby={enhanced ? `${id}-tab-${index}` : undefined}
          className="tabs-block__panel"
          hidden={enhanced && index !== selected}
          id={`${id}-panel-${index}`}
          key={labels[index] ?? index}
          role={enhanced ? "tabpanel" : undefined}
          tabIndex={enhanced ? 0 : undefined}
        >
          {enhanced ? null : (
            <Heading className="tabs-block__heading">{labels[index]}</Heading>
          )}
          {panel}
        </section>
      ))}
    </div>
  );
}
