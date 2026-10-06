import type { SnippetToken } from "@specistry/snippets";

import { CopyButton } from "../copy-button";

/**
 * One code example on the raised code surface: a header with the label and
 * the copy control (clipboard content is exactly the code), and the token
 * lines rendered as text nodes with the shared `tok-*` classes. Nothing is
 * ever injected as HTML.
 */
export function CodeFigure({
  code,
  copyName,
  detail,
  label,
  lines,
  id,
}: Readonly<{
  code: string;
  /** Accessible name of the copy control, e.g. "Copy cURL example". */
  copyName: string;
  detail?: string | undefined;
  id?: string | undefined;
  label: string;
  lines: readonly (readonly SnippetToken[])[];
}>) {
  return (
    <figure className="code-block code-figure" id={id}>
      <figcaption className="code-block__header">
        <span className="code-block__title">
          {label}
          {detail === undefined ? null : (
            <span className="code-figure__detail"> · {detail}</span>
          )}
        </span>
        <CopyButton label="Copy" name={copyName} value={code} />
      </figcaption>
      {/* Long lines scroll inside the block, so keyboard users can reach it. */}
      <pre
        aria-label={`${label} example`}
        className="code-surface code-block__pre"
        role="group"
        tabIndex={0}
      >
        <code className="code-block__code">
          {lines.map((line, index) => (
            <span className="code-block__line" key={index}>
              {line.map((token, tokenIndex) =>
                token.cls === undefined ? (
                  token.text
                ) : (
                  <span className={`tok-${token.cls}`} key={tokenIndex}>
                    {token.text}
                  </span>
                ),
              )}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}
