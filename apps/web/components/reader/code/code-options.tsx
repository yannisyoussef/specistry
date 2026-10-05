"use client";

import { useId, useSyncExternalStore } from "react";

import { useReplaceUrl } from "./navigation";

/**
 * Environment, body-format, and authentication selectors (SPEC-008 §34,
 * §38, §32). The selection is URL query state: the server renders the six
 * examples for it, so no generator ships to the browser and no request is
 * ever made to a consumer environment. With JavaScript a change replaces
 * the URL (a soft navigation that keeps scroll and focus); without it the
 * same form submits with the Apply control. Only environments validated at
 * build time are offered: there is no free-text destination.
 */

export interface OptionsField {
  readonly name: "auth" | "body" | "env";
  readonly label: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly selected: string;
}

function subscribeNever(): () => void {
  return () => {};
}

export function CodeOptions({
  action,
  fields,
}: Readonly<{ action: string; fields: readonly OptionsField[] }>) {
  const id = useId();
  const replace = useReplaceUrl();
  const enhanced = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const navigate = (name: string, value: string): void => {
    const parameters = new URLSearchParams();
    for (const field of fields) {
      const chosen = field.name === name ? value : field.selected;
      if (chosen !== field.options[0]?.id) parameters.set(field.name, chosen);
    }
    const query = parameters.toString();
    replace(`${action}${query.length === 0 ? "" : `?${query}`}#code`);
  };
  return (
    <form
      action={action}
      aria-label="Code example options"
      className="code-options"
      method="get"
    >
      {fields.map((field) => (
        <label className="code-options__field" key={field.name}>
          <span className="code-options__label">{field.label}</span>
          <select
            className="code-options__select"
            defaultValue={field.selected}
            id={`${id}-${field.name}`}
            name={field.name}
            onChange={(event) => {
              if (enhanced) navigate(field.name, event.target.value);
            }}
          >
            {field.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {enhanced ? null : (
        <button className="button code-options__apply" type="submit">
          Apply
        </button>
      )}
    </form>
  );
}
