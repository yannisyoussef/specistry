import type { HttpMethod } from "@specra/model";
import type { ReactNode } from "react";

/**
 * Small presentation primitives shared by every reader page. All text passes
 * through React's escaping; nothing here renders raw HTML.
 */

const METHOD_CLASSES: Readonly<Partial<Record<HttpMethod, string>>> = {
  DELETE: "method--delete",
  GET: "method--get",
  PATCH: "method--patch",
  POST: "method--post",
  PUT: "method--put",
};

export function MethodLabel({
  compact = false,
  method,
}: Readonly<{ compact?: boolean; method: HttpMethod }>) {
  const classes = [
    "method",
    METHOD_CLASSES[method] ?? "",
    compact ? "method--compact" : "",
  ]
    .filter((name) => name.length > 0)
    .join(" ");
  return <span className={classes}>{method}</span>;
}

export function Badge({
  children,
  tone = "neutral",
}: Readonly<{ children: ReactNode; tone?: "deprecated" | "neutral" }>) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function DeprecationCallout({
  children,
}: Readonly<{ children?: ReactNode }>) {
  return (
    <div className="callout" role="note">
      <span aria-hidden="true" className="callout__glyph">
        !
      </span>
      <p>
        <strong className="strong">Deprecated.</strong>{" "}
        {children ??
          "This operation is still documented but should not be used for new integrations."}
      </p>
    </div>
  );
}

/**
 * Untrusted text rendered as text. Paragraph breaks in the source are kept
 * as whitespace (`white-space: pre-line`) and paired backticks become inline
 * code; no other Markdown and no HTML is interpreted, so every character the
 * author wrote is shown literally.
 */
export function SafeText({
  as: Tag = "p",
  className,
  text,
}: Readonly<{ as?: "p" | "span"; className?: string; text: string }>) {
  const classes = ["prose", className]
    .filter((name) => name !== undefined)
    .join(" ");
  return (
    <Tag className={classes}>
      {inlineCode(text.replace(/\r\n?/g, "\n").trim())}
    </Tag>
  );
}

/** Splits `text` on paired backticks into text and `<code>` nodes. */
export function inlineCode(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /`([^`\n]+)`/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > last) nodes.push(text.slice(last, index));
    nodes.push(<code key={index}>{match[1]}</code>);
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Breadcrumb({
  items,
}: Readonly<{
  items: readonly { readonly href?: string; readonly label: string }[];
}>) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="breadcrumb">
        {items.map((item, index) => (
          <li key={`${index}-${item.label}`}>
            {item.href === undefined ? (
              <span aria-current="page">{item.label}</span>
            ) : (
              <a href={item.href}>{item.label}</a>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function StatusLabel({
  label,
  text,
  tone,
}: Readonly<{
  label: string;
  text?: string;
  tone: "danger" | "info" | "neutral" | "success" | "warning";
}>) {
  return (
    <span className={`status status--${tone}`}>
      {label}
      {text === undefined ? null : ` ${text}`}
    </span>
  );
}

export function SectionHeader({
  id,
  meta,
  title,
}: Readonly<{ id: string; meta?: ReactNode; title: string }>) {
  return (
    <div className="section__header">
      <h2 className="section-title" id={`${id}-heading`}>
        {title}
      </h2>
      {meta === undefined ? null : (
        <span className="section__meta">{meta}</span>
      )}
    </div>
  );
}
