import type { BlockNode, ContentPage } from "@specistry/content";
import type { ReactNode } from "react";

import {
  pageBreadcrumbs,
  pageNeighbours,
  pageOutline,
  type ReaderContent,
} from "../../../lib/reader/content";
import { Breadcrumb } from "../primitives";
import { ContentBlocks, Media } from "./content-renderer";

/**
 * An authored page: breadcrumbs derived from the navigation, the frontmatter
 * title as the only H1, the description as lede, an "On this page" outline
 * from the normalized headings, the body, and previous/next links from the
 * composed reading order. The homepage uses the display type scale; when it
 * opens with a `<Hero>`, the hero renders the title, lede, actions, and the
 * optional media, and the following Install and Start-here blocks sit side by
 * side (design contract, screens 6a and 8c).
 */
export function DocsPage({
  content,
  page,
}: Readonly<{ content: ReaderContent; page: ContentPage }>) {
  const home = page.route === "/";
  const breadcrumbs = pageBreadcrumbs(content, page);
  const outline = pageOutline(page);
  const { next, previous } = pageNeighbours(content, page.route);
  const hero = page.body[0]?.kind === "hero" ? page.body[0] : undefined;
  const body = hero === undefined ? page.body : page.body.slice(1);
  return (
    <article
      className={`document__column prose-page${hero === undefined ? "" : " document__column--home"}`}
    >
      {hero === undefined ? (
        <div className={`page-header${home ? " page-header--home" : ""}`}>
          {breadcrumbs.length === 0 ? null : <Breadcrumb items={breadcrumbs} />}
          <h1 className={home ? "display" : "page-title"}>{page.title}</h1>
          {page.description === undefined ? null : (
            <p className="lede">{page.description}</p>
          )}
        </div>
      ) : (
        <header
          className={`hero${hero.media === undefined ? "" : " hero--media"}`}
        >
          <div className="hero__copy">
            {hero.eyebrow === undefined ? null : (
              <p className="eyebrow hero__eyebrow">{hero.eyebrow}</p>
            )}
            <h1 className="display hero__title">{page.title}</h1>
            {page.description === undefined ? null : (
              <p className="lede hero__lede">{page.description}</p>
            )}
            {hero.actions.length === 0 ? null : (
              <p className="hero__actions">
                {hero.actions.map((action) => (
                  <a
                    className={`button button--${action.variant}`}
                    href={action.href}
                    key={action.href + action.label}
                    {...(action.target === "external"
                      ? { rel: "noopener noreferrer" }
                      : {})}
                  >
                    {action.label}
                  </a>
                ))}
              </p>
            )}
          </div>
          {hero.media === undefined ? null : <Media block={hero.media} />}
        </header>
      )}
      {outline.length > 1 && !home ? (
        <nav aria-labelledby="outline-heading" className="outline" id="outline">
          <p className="outline__title eyebrow" id="outline-heading">
            On this page
          </p>
          <ol className="outline__list">
            {outline.slice(0, 12).map((item) => (
              <li
                className={`outline__item outline__item--${item.depth}`}
                key={item.id}
              >
                <a href={`#${item.id}`}>{item.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="authored">
        {hero === undefined ? (
          <ContentBlocks blocks={body} />
        ) : (
          <HomeBlocks blocks={body} />
        )}
      </div>
      {previous === undefined && next === undefined ? null : (
        <nav aria-label="Previous and next pages" className="pager">
          {previous === undefined ? (
            <span />
          ) : (
            <a
              className="pager__link pager__link--previous"
              href={previous.route}
            >
              <span className="pager__label">Previous</span>
              <span className="pager__title">{previous.label}</span>
            </a>
          )}
          {next === undefined ? null : (
            <a className="pager__link pager__link--next" href={next.route}>
              <span className="pager__label">Next</span>
              <span className="pager__title">{next.label}</span>
            </a>
          )}
        </nav>
      )}
    </article>
  );
}

/**
 * Homepage body: an Install block immediately followed by a Start-here block
 * (or the reverse) forms one two-column row; everything else renders in order.
 */
function HomeBlocks({ blocks }: Readonly<{ blocks: readonly BlockNode[] }>) {
  const rendered: ReactNode[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index] as BlockNode;
    const following = blocks[index + 1];
    if (
      following !== undefined &&
      isColumn(block.kind) &&
      isColumn(following.kind) &&
      block.kind !== following.kind
    ) {
      rendered.push(
        <div className="home-grid" key={index}>
          <ContentBlocks blocks={[block]} level={1} />
          <ContentBlocks blocks={[following]} level={1} />
        </div>,
      );
      index += 1;
      continue;
    }
    rendered.push(<ContentBlocks blocks={[block]} key={index} level={1} />);
  }
  return <>{rendered}</>;
}

function isColumn(kind: BlockNode["kind"]): boolean {
  return kind === "install" || kind === "startHere";
}
