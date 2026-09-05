import type {
  OperationView,
  SchemaBlockRef,
} from "../../../lib/reader/operation-view";
import { schemaFocusHref } from "../../../lib/reader/operation-view";
import { API_ROOT } from "../../../lib/reader/projection";
import type {
  SchemaContext,
  SchemaView,
  TrailEntry,
} from "../../../lib/reader/schema-view";
import { Breadcrumb, MethodLabel, PathText } from "../primitives";
import { contextLabel, SchemaBlock } from "./schema-block";

/**
 * Focused (drill-in) schema view: one block, or one node inside it, rendered
 * as the root with its own first level open. Reached by links the renderer
 * emits for recursion markers, budget cut-offs, and named references; it is
 * the no-script answer to "open this schema" and mirrors the approved
 * design's breadcrumb trail (`Message › content › HtmlContent`).
 */
export function SchemaFocusPage({
  block,
  context,
  operation,
  trail,
  view,
}: Readonly<{
  block: SchemaBlockRef;
  context: SchemaContext;
  operation: OperationView;
  trail: readonly TrailEntry[];
  view: SchemaView;
}>) {
  const singleService = operation.service.href === API_ROOT;
  const current = trail.at(-1);
  const heading = current?.label ?? view.name ?? view.label;
  const operationHref = operation.summary.href;
  return (
    <article className="document__column">
      <div className="page-header">
        <Breadcrumb
          items={[
            { href: API_ROOT, label: "API reference" },
            ...(singleService
              ? []
              : [
                  {
                    href: operation.service.href,
                    label: operation.service.name,
                  },
                ]),
            { href: operation.group.href, label: operation.group.name },
            { href: operationHref, label: operation.title },
          ]}
        />
        <p className="eyebrow">
          {contextLabel(context)} · {block.title}
        </p>
        <h1 className="page-title">{heading}</h1>
        <div className="endpoint-line">
          <MethodLabel method={operation.method} />
          <PathText className="endpoint-line__path" text={operation.path} />
        </div>
        <nav aria-label="Schema position">
          <ol className="schema-focus__trail">
            <li>
              {trail.length === 0 ? (
                <span className="schema-focus__current">{block.title}</span>
              ) : (
                <a href={schemaFocusHref(operationHref, block.anchor, "")}>
                  {block.title}
                </a>
              )}
            </li>
            {trail.map((entry, index) => (
              <li key={entry.locator}>
                {index === trail.length - 1 ? (
                  <span
                    aria-current="location"
                    className="schema-focus__current"
                  >
                    {entry.label}
                  </span>
                ) : (
                  <a
                    href={schemaFocusHref(
                      operationHref,
                      block.anchor,
                      entry.locator,
                    )}
                  >
                    {entry.label}
                  </a>
                )}
              </li>
            ))}
          </ol>
        </nav>
      </div>
      <section aria-labelledby="schema-heading" className="section">
        <h2 className="visually-hidden" id="schema-heading">
          Schema
        </h2>
        <SchemaBlock
          context={context}
          focusHref={(locator) =>
            schemaFocusHref(operationHref, block.anchor, locator)
          }
          idPrefix={block.anchor}
          view={view}
        />
      </section>
      <a
        className="button button--ghost schema-focus__back"
        href={`${operationHref}#${block.anchor}`}
      >
        <span aria-hidden="true">← </span>Back to {operation.title}
      </a>
    </article>
  );
}
