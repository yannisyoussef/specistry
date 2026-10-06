import type {
  BlockNode,
  CalloutType,
  CodeBlock,
  InlineNode,
  MediaNode,
} from "@specistry/content";
import type { ReactNode } from "react";

import { CopyButton } from "../copy-button";
import { Tabs } from "./tabs";

/**
 * Renders the Specistry content model as HTML. Every node kind is explicit;
 * there is no HTML pass-through and no attribute is spread from authored
 * data. Text, code, links, and image sources come from the validated
 * artifact, which the build already bounded and classified.
 */

/**
 * Renders blocks in order while tracking the current heading depth, so
 * component titles (steps, static tab headings) continue the outline
 * rather than skipping levels. `level` is the depth of the nearest heading
 * above this list of blocks; the page title is level 1.
 */
export function ContentBlocks({
  blocks,
  level = 1,
}: Readonly<{ blocks: readonly BlockNode[]; level?: HeadingLevel }>) {
  const levels: HeadingLevel[] = [];
  let current = level;
  for (const block of blocks) {
    if (block.kind === "heading") current = block.depth;
    levels.push(current);
  }
  return (
    <>
      {blocks.map((block, index) => (
        <Block block={block} key={index} level={levels[index] ?? level} />
      ))}
    </>
  );
}

type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
type SubheadingLevel = Exclude<HeadingLevel, 1>;

function deeper(level: HeadingLevel): SubheadingLevel {
  return level >= 6 ? 6 : ((level + 1) as SubheadingLevel);
}

function Block({
  block,
  level,
}: Readonly<{ block: BlockNode; level: HeadingLevel }>) {
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
              <ContentBlocks blocks={item.children} level={level} />
            </li>
          ))}
        </Tag>
      );
    }
    case "blockquote":
      return (
        <blockquote className="prose__quote">
          <ContentBlocks blocks={block.children} level={level} />
        </blockquote>
      );
    case "code":
      return <Code block={block} />;
    case "table":
      return (
        <div
          aria-label="Table"
          className="prose__table-scroll"
          role="group"
          tabIndex={0}
        >
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
      return <Callout block={block} level={level} />;
    case "steps": {
      // A titled block owns a heading of its own; its steps sit below it.
      const stepLevel =
        block.title === undefined ? deeper(level) : deeper(deeper(level));
      const Title = `h${stepLevel}` as const;
      const strip = block.variant === "strip";
      const list = (
        <ol className={`steps${strip ? " steps--strip" : ""}`}>
          {block.steps.map((step, index) => (
            <li className="steps__step" key={index}>
              <div aria-hidden="true" className="steps__number">
                {String(index + 1).padStart(2, "0")}
              </div>
              <div className="steps__body">
                <Title className="steps__title">{step.title}</Title>
                <ContentBlocks blocks={step.children} level={stepLevel} />
              </div>
            </li>
          ))}
        </ol>
      );
      if (block.title === undefined) return list;
      // A titled block is a section of its own; the eyebrow is its heading.
      const Heading = `h${deeper(level)}` as const;
      return (
        <section className="steps-section">
          <Heading className="eyebrow steps-section__title">
            {block.title}
          </Heading>
          {list}
        </section>
      );
    }
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
          headingLevel={deeper(level)}
          label="Options"
          labels={block.tabs.map((tab) => tab.label)}
          panels={block.tabs.map((tab, index) => (
            <ContentBlocks
              blocks={tab.children}
              key={index}
              level={deeper(level)}
            />
          ))}
        />
      );
    case "codeGroup":
      return (
        <Tabs
          headingLevel={deeper(level)}
          label="Code examples"
          labels={block.blocks.map(codeLabel)}
          panels={block.blocks.map((code, index) => (
            <Code block={code} inGroup key={index} />
          ))}
        />
      );
    case "hero":
      // The page frame renders the hero (it owns the H1); a hero that is
      // not the first block of the homepage never reaches the artifact.
      return null;
    case "media":
      return <Media block={block} />;
    case "install": {
      const Heading = `h${deeper(level)}` as const;
      return (
        <section className="install">
          <Heading className="eyebrow install__title">Install</Heading>
          <Tabs
            headingLevel={deeper(deeper(level))}
            label="Install"
            labels={block.options.map((option) => option.label)}
            panels={block.options.map((option, index) => (
              <div className="install__option" key={index}>
                <CommandLine block={option.command} />
                {option.sample === undefined ? null : (
                  <Code bare block={option.sample} />
                )}
              </div>
            ))}
            variant="chips"
          />
        </section>
      );
    }
    case "startHere": {
      const Heading = `h${deeper(level)}` as const;
      return (
        <section className="start-here">
          <Heading className="eyebrow start-here__title">Start here</Heading>
          <ul className="start-here__list">
            {block.entries.map((entry, index) => (
              <li className="start-here__item" key={index}>
                <a
                  className="start-here__link"
                  href={entry.href}
                  {...(entry.target === "external"
                    ? { rel: "noopener noreferrer" }
                    : {})}
                >
                  <span className="start-here__text">
                    <span className="start-here__name">{entry.title}</span>
                    {entry.description === undefined ? null : (
                      <span className="start-here__description">
                        {entry.description}
                      </span>
                    )}
                  </span>
                  {entry.meta === undefined ? null : (
                    <span className="start-here__meta">{entry.meta}</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </section>
      );
    }
  }
}

/**
 * Media placeholder: the poster is a real image, the play chrome and progress
 * bar are decorative (the reader embeds no video), and the caption may link
 * to a written alternative such as the quickstart steps.
 */
export function Media({ block }: Readonly<{ block: MediaNode }>) {
  return (
    <figure className="media">
      <div className="media__frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- poster is a validated artifact asset */}
        <img
          alt={block.alt}
          className="media__poster"
          loading="lazy"
          src={`/${block.poster}`}
        />
        <span aria-hidden="true" className="media__glow" />
        <span aria-hidden="true" className="media__play">
          <span className="media__play-glyph" />
        </span>
        <span aria-hidden="true" className="media__bar">
          <span className="media__track" />
          {block.duration === undefined ? null : (
            <span className="media__duration">{block.duration}</span>
          )}
        </span>
      </div>
      {block.caption === undefined && block.link === undefined ? null : (
        <figcaption className="media__caption">
          <span>{block.caption}</span>
          {block.link === undefined ? null : (
            <a
              className="media__link"
              href={block.link.href}
              {...(block.link.target === "external"
                ? { rel: "noopener noreferrer" }
                : {})}
            >
              {block.link.label}
            </a>
          )}
        </figcaption>
      )}
    </figure>
  );
}

/** A one-line install command on the code surface with a prompt and copy. */
function CommandLine({ block }: Readonly<{ block: CodeBlock }>) {
  const command = block.value.trim();
  return (
    <div className="code-surface command-line">
      <code className="command-line__code">
        <span aria-hidden="true" className="command-line__prompt">
          ${" "}
        </span>
        {command}
      </code>
      <CopyButton label="Copy" name="Copy install command" value={command} />
    </div>
  );
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
  level,
}: Readonly<{
  block: Extract<BlockNode, { kind: "callout" }>;
  level: HeadingLevel;
}>) {
  return (
    <div
      aria-label={
        block.title === undefined
          ? CALLOUT_WORD[block.type]
          : `${CALLOUT_WORD[block.type]}: ${block.title}`
      }
      className={`callout callout--${block.type}`}
      role="note"
    >
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
        <ContentBlocks blocks={block.children} level={level} />
      </div>
    </div>
  );
}

function Code({
  bare = false,
  block,
  inGroup = false,
}: Readonly<{ bare?: boolean; block: CodeBlock; inGroup?: boolean }>) {
  const language = block.language ?? "text";
  return (
    <figure
      className={`code-block${inGroup ? " code-block--grouped" : ""}${bare ? " code-block--bare" : ""}`}
    >
      <figcaption
        className={`code-block__header${bare ? " visually-hidden" : ""}`}
      >
        <span className="code-block__title">
          {block.title ?? language}
          <span className="visually-hidden">, {language} code</span>
        </span>
        <CopyButton label="Copy" name="Copy code" value={block.value} />
      </figcaption>
      {/* Long lines scroll inside the block, so keyboard users can reach it. */}
      <pre
        aria-label={`${block.title ?? language} code`}
        className="code-surface code-block__pre"
        data-language={language}
        role="group"
        tabIndex={0}
      >
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
