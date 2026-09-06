import type { CodeView } from "../../../lib/reader/code-view";
import { SafeText } from "../primitives";
import { CodeFigure } from "./code-figure";
import { CodeOptions } from "./code-options";
import { CodeSwitcher } from "./code-switcher";

/**
 * The endpoint context rail in Code mode (SPEC-008 §77–§79; design screens
 * 5d/5e). On wide viewports it is the third glass panel beside the
 * document; below the rail breakpoint it renders inline after the page
 * header. Protocol examples are generated on the server; SDK examples are
 * the consumer's authored code. There is no Try it control: execution is
 * SPEC-009 and a dead control would be dishonest.
 */
export function CodeRail({
  action,
  view,
}: Readonly<{ action: string; view: CodeView }>) {
  return (
    <aside aria-labelledby="code-heading" className="code-rail" id="code">
      <div className="code-rail__bar">
        <h2 className="code-rail__title" id="code-heading">
          Code
        </h2>
        <span className="code-rail__mode eyebrow">
          {view.sdks.length > 0 &&
          view.panels.some((panel) => panel.option.group === "sdk")
            ? "Protocol · SDK"
            : "Protocol"}
        </span>
      </div>
      {view.fields.length === 0 ? null : (
        <CodeOptions action={action} fields={view.fields} />
      )}
      <CodeSwitcher
        options={view.options}
        panels={view.panels.map((panel) => (
          <div className="code-rail__example" key={panel.option.id}>
            {panel.title === undefined ? null : (
              <p className="code-rail__example-title">{panel.title}</p>
            )}
            <CodeFigure
              code={panel.code}
              copyName={`Copy ${panel.option.label} example`}
              detail={
                panel.option.group === "sdk"
                  ? (panel.option.detail ?? "SDK")
                  : undefined
              }
              id={`code-${panel.option.id}`}
              label={panel.option.label}
              lines={panel.lines}
            />
            {panel.description === undefined ? null : (
              <SafeText
                className="code-rail__example-note"
                text={panel.description}
              />
            )}
          </div>
        ))}
      />
      {view.response === undefined ? null : (
        <CodeFigure
          code={view.response.lines
            .map((line) => line.map((token) => token.text).join(""))
            .join("\n")}
          copyName={`Copy response ${view.response.status} example`}
          id="code-response"
          label={`Response · ${view.response.status}`}
          lines={view.response.lines}
        />
      )}
      {view.response?.truncated ? (
        <p className="code-rail__note">
          The response example is longer than shown.
        </p>
      ) : null}
      <p className="code-rail__note">
        Request examples use placeholders such as{" "}
        <code>&lt;YOUR_API_KEY&gt;</code>; nothing is sent from this page.
      </p>
    </aside>
  );
}
