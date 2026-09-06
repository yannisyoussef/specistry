import type { ContentPage } from "@specra/content";

import {
  pageBreadcrumbs,
  pageNeighbours,
  pageOutline,
  type ReaderContent,
} from "../../../lib/reader/content";
import { Breadcrumb } from "../primitives";
import { ContentBlocks } from "./content-renderer";

/**
 * An authored page: breadcrumbs derived from the navigation, the frontmatter
 * title as the only H1, the description as lede, an "On this page" outline
 * from the normalized headings, the body, and previous/next links from the
 * composed reading order. The homepage uses the display type scale.
 */
export function DocsPage({
  content,
  page,
}: Readonly<{ content: ReaderContent; page: ContentPage }>) {
  const home = page.route === "/";
  const breadcrumbs = pageBreadcrumbs(content, page);
  const outline = pageOutline(page);
  const { next, previous } = pageNeighbours(content, page.route);
  return (
    <article className="document__column prose-page">
      <div className={`page-header${home ? " page-header--home" : ""}`}>
        {breadcrumbs.length === 0 ? null : <Breadcrumb items={breadcrumbs} />}
        <h1 className={home ? "display" : "page-title"}>{page.title}</h1>
        {page.description === undefined ? null : (
          <p className="lede">{page.description}</p>
        )}
      </div>
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
        <ContentBlocks blocks={page.body} />
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
