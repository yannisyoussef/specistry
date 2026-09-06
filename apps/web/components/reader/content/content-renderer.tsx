import type {
  BlockNode,
  CalloutType,
  CodeBlock,
  InlineNode,
} from "@specra/content";
import type { ReactNode } from "react";

import { CopyButton } from "../copy-button";
import { Tabs } from "./tabs";

/**
 * Renders the Specra content model as HTML. Every node kind is explicit;
 * there is no HTML pass-through and no attribute is spread from authored
 * data. Text, code, links, and image sources come from the validated
 * artifact, which the build already bounded and classified.
 */

export function ContentBlocks({
  blocks,
}: Readonly<{ blocks: readonly BlockNode[] }>) {
  return (
    <>
      {blocks.map((block, index) => (
        <Block block={block} key={index} />
      ))}
    </>
  );
}

function Block({ block }: Readonly<{ block: BlockNode }>) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p className="prose__paragraph">
          <Inlines nodes={block.children} />
        </p>
      );
    case "heading": {
      const Tag = `h${block.depth}` as const;
      return (
        <Tag
          className={`prose__heading prose__heading--${block.depth}`}
          id={block.id}
        >
          <a className="prose__anchor" href={`#${block.id}`}>
            <Inlines nodes={block.children} />
          </a>
        </Tag>
      );
    }
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          className={`prose__list${block.items.some((item) => item.checked !== undefined) ? " prose__list--tasks" : ""}`}
          {...(block.start === undefined ? {} : { start: block.start })}
        >
          {block.items.map((item, index) => (
            <li className="prose__item" key={index}>
              {item.checked === undefined ? null : (
                <span aria-hidden="true" className="prose__check">
                  {item.checked ? "☑" : "☐"}
                </span>
              )}
              {item.checked === undefined ? null : (
                <span className="visually-hidden">
                  {item.checked ? "Done: " : "To do: "}
                </span>
              )}
              <ContentBlocks blocks={item.children} />
            </li>
          ))}
        </Tag>
      );
    }
    case "blockquote":
      return (
        <blockquote className="prose__quote">
          <ContentBlocks blocks={block.children} />
        </blockquote>
      );
    case "code":
      return <Code block={block} />;
    case "table":
      return (
        <div className="prose__table-scroll" tabIndex={0}>
          <table className="prose__table">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    scope="col"
                    {...alignment(block.align[index] ?? null)}
                  >
                    <Inlines nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} {...alignment(block.align[index] ?? null)}>
                      <Inlines nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "thematicBreak":
      return <hr className="prose__rule" />;
    case "image":
      return (
        <figure className="prose__figure">
          {/* Assets are served verbatim from the build artifact; the reader
              ships no image optimizer (docs/adr/012). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={block.alt}
            className="prose__image"
            loading="lazy"
            src={`/${block.src}`}
          />
        </figure>
      );
    case "callout":
      return <Callout block={block} />;
    case "steps":
      return (
        <ol className="steps">
          {block.steps.map((step, index) => (
            <li className="steps__step" key={index}>
              <div className="steps__number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="steps__body">
                <h3 className="steps__title">{step.title}</h3>
                <ContentBlocks blocks={step.children} />
              </div>
            </li>
          ))}
        </ol>
      );
    case "cards":
      return (
        <ul className="cards">
          {block.cards.map((card, index) => (
            <li className="cards__item" key={index}>
              <a
                className="card"
                href={card.href}
                {...(card.target === "external"
                  ? { rel: "noopener noreferrer" }
                  : {})}
              >
                <span className="card__title">{card.title}</span>
                {card.description === undefined ? null : (
                  <span className="card__description">{card.description}</span>
                )}
                <span aria-hidden="true" className="card__arrow">
                  →
                </span>
              </a>
            </li>
          ))}
        </ul>
      );
    case "tabs":
      return (
        <Tabs
          label="Options"
          labels={block.tabs.map((tab) => tab.label)}
          panels={block.tabs.map((tab, index) => (
            <ContentBlocks blocks={tab.children} key={index} />
          ))}
        />
      );
    case "codeGroup":
      return (
        <Tabs
          label="Code examples"
          labels={block.blocks.map(codeLabel)}
          panels={block.blocks.map((code, index) => (
            <Code block={code} inGroup key={index} />
          ))}
        />
      );
  }
}

function codeLabel(block: CodeBlock): string {
  return block.title ?? block.language ?? "text";
}

function alignment(align: "center" | "left" | "right" | null): {
  readonly className?: string;
} {
  return align === null ? {} : { className: `prose__cell--${align}` };
}

const CALLOUT_GLYPH: Readonly<Record<CalloutType, string>> = {
  danger: "!",
  note: "i",
  tip: "✓",
  warning: "!",
};

const CALLOUT_WORD: Readonly<Record<CalloutType, string>> = {
  danger: "Danger",
  note: "Note",
  tip: "Tip",
  warning: "Warning",
};

function Callout({
  block,
}: Readonly<{ block: Extract<BlockNode, { kind: "callout" }> }>) {
  return (
    <aside className={`callout callout--${block.type}`}>
      <span aria-hidden="true" className="callout__glyph">
        {CALLOUT_GLYPH[block.type]}
      </span>
      <div className="callout__body">
        <p className="callout__title">
          <span className="callout__kind">{CALLOUT_WORD[block.type]}</span>
          {block.title === undefined ? null : (
            <>
              <span aria-hidden="true"> · </span>
              <span>{block.title}</span>
            </>
          )}
        </p>
        <ContentBlocks blocks={block.children} />
      </div>
    </aside>
  );
}

function Code({
  block,
  inGroup = false,
}: Readonly<{ block: CodeBlock; inGroup?: boolean }>) {
  const language = block.language ?? "text";
  return (
    <figure className={`code-block${inGroup ? " code-block--grouped" : ""}`}>
      <figcaption className="code-block__header">
        <span className="code-block__title">
          {block.title ?? language}
          <span className="visually-hidden">, {language} code</span>
        </span>
        <CopyButton label="Copy" name="Copy code" value={block.value} />
      </figcaption>
      <pre className="code-surface code-block__pre" data-language={language}>
        <code className="code-block__code">
          {block.lines.map((line, index) => (
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

export function Inlines({ nodes }: Readonly<{ nodes: readonly InlineNode[] }>) {
  return (
    <>
      {nodes.map((node, index) => (
        <Inline key={index} node={node} />
      ))}
    </>
  );
}

function Inline({ node }: Readonly<{ node: InlineNode }>): ReactNode {
  switch (node.kind) {
    case "text":
      return node.value;
    case "emphasis":
      return (
        <em>
          <Inlines nodes={node.children} />
        </em>
      );
    case "strong":
      return (
        <strong>
          <Inlines nodes={node.children} />
        </strong>
      );
    case "delete":
      return (
        <del>
          <Inlines nodes={node.children} />
        </del>
      );
    case "code":
      return <code className="prose__code">{node.value}</code>;
    case "break":
      return <br />;
    case "link":
      return (
        <a
          className={`prose__link prose__link--${node.target}`}
          href={node.href}
          {...(node.target === "external"
            ? { rel: "noopener noreferrer" }
            : {})}
        >
          <Inlines nodes={node.children} />
          {node.target === "external" ? (
            <span className="visually-hidden"> (external link)</span>
          ) : null}
        </a>
      );
  }
}
