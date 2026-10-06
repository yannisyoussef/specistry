"use client";

import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Language selection for the Code rail (SPEC-008 §85, §101). The server
 * renders every panel; after hydration a native `<select>` grouped into
 * Protocol and SDK options shows one panel at a time and remembers the
 * choice for the browser session (sessionStorage only: nothing leaves the
 * browser, nothing is a cookie). Without JavaScript the first panel (cURL)
 * stays visible and the rest sit behind a native disclosure, so every
 * example remains reachable in reading order.
 */

export interface SwitcherOption {
  readonly id: string;
  readonly label: string;
  readonly group: "protocol" | "sdk";
}

const STORAGE_KEY = "specistry:code-language";
const GROUP_LABELS = { protocol: "Protocol", sdk: "SDK" } as const;

function subscribeNever(): () => void {
  return () => {};
}

function readStored(): string | undefined {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function store(value: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage may be unavailable; the choice then lasts for the page only.
  }
}

export function CodeSwitcher({
  options,
  panels,
}: Readonly<{
  options: readonly SwitcherOption[];
  panels: readonly ReactNode[];
}>) {
  const id = useId();
  const enhanced = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const [selected, setSelected] = useState(options[0]?.id ?? "");
  useEffect(() => {
    const stored = readStored();
    if (
      stored !== undefined &&
      options.some((option) => option.id === stored)
    ) {
      // The stored preference is applied after hydration; the server cannot
      // know it, so the first paint shows the default language.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- session preference is external state read once after mount
      setSelected(stored);
    }
  }, [options]);

  const groups = (["protocol", "sdk"] as const).filter((group) =>
    options.some((option) => option.group === group),
  );
  const [first, ...rest] = panels;

  if (!enhanced) {
    return (
      <div className="code-switcher" data-enhanced="false">
        {first}
        {rest.length === 0 ? null : (
          <details className="code-switcher__more">
            <summary className="code-switcher__summary">
              Other languages ({rest.length})
            </summary>
            {rest}
          </details>
        )}
      </div>
    );
  }
  return (
    <div className="code-switcher" data-enhanced="true">
      <label className="code-switcher__label" htmlFor={`${id}-select`}>
        <span className="visually-hidden">Language</span>
        <select
          className="code-switcher__select"
          id={`${id}-select`}
          onChange={(event) => {
            setSelected(event.target.value);
            store(event.target.value);
          }}
          value={selected}
        >
          {groups.map((group) => (
            <optgroup key={group} label={GROUP_LABELS[group]}>
              {options
                .filter((option) => option.group === group)
                .map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {panels.map((panel, index) => {
        const option = options[index];
        if (option === undefined) return null;
        return (
          <div
            className="code-switcher__panel"
            data-code-option={option.id}
            hidden={option.id !== selected}
            key={option.id}
          >
            {panel}
          </div>
        );
      })}
    </div>
  );
}
