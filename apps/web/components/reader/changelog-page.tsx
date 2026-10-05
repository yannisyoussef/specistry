import type { PublishedChangelog } from "@specra/release";

import {
  scopeHref,
  type ReaderRoots,
  type ReaderVersion,
} from "../../lib/reader/scope";
import { Breadcrumb, MethodLabel, PathText } from "./primitives";

/**
 * Published release notes (SPEC-010 §90–§92, design 06h): the author's
 * reviewed entries, dated, with categorized items that name an operation
 * (method and path, linking to that release's route) or a plain subject.
 * Everything is text from the changelog contract; nothing is generated
 * prose. A release-history list points at the other retained releases.
 */

const KIND_LABELS: Readonly<Record<string, string>> = {
  added: "Added",
  changed: "Changed",
  deprecated: "Deprecated",
  fixed: "Fixed",
  removed: "Removed",
};

export function ChangelogPage({
  changelog,
  roots,
  version,
}: Readonly<{
  changelog: PublishedChangelog;
  roots: ReaderRoots;
  version: ReaderVersion;
}>) {
  const history = version.catalog.filter((release) => release.changelog);
  return (
    <article className="document__column changelog">
      <div className="page-header">
        <Breadcrumb
          items={[
            { href: roots.home, label: "Guides" },
            { label: changelog.title },
          ]}
        />
        <h1 className="page-title">{changelog.title}</h1>
        <p className="lede">
          {changelog.summary ??
            `Changes published with ${version.label}${changelog.from === undefined ? "" : ` since ${changelog.from}`}.`}
        </p>
      </div>
      {changelog.entries.length === 0 ? (
        <p className="changelog__empty">
          No entries were published for this release.
        </p>
      ) : (
        <ol className="changelog__entries">
          {changelog.entries.map((entry, index) => (
            <li className="changelog__entry" key={index}>
              <div className="changelog__when">
                {entry.date === undefined ? (
                  <span className="changelog__date">{version.label}</span>
                ) : (
                  <time className="changelog__date" dateTime={entry.date}>
                    {formatDate(entry.date)}
                  </time>
                )}
                <span className="changelog__meta">{version.label}</span>
              </div>
              <ul className="changelog__items">
                {entry.items.map((item, itemIndex) => (
                  <li
                    className={`changelog__item changelog__item--${item.kind}`}
                    key={itemIndex}
                  >
                    <span
                      className={`eyebrow changelog__kind changelog__kind--${item.kind}`}
                    >
                      {KIND_LABELS[item.kind] ?? item.kind}
                    </span>
                    {item.operation === undefined ? (
                      item.target === undefined ? null : (
                        <code className="changelog__target">{item.target}</code>
                      )
                    ) : (
                      <span className="changelog__operation">
                        <MethodLabel
                          method={
                            item.operation.method as Parameters<
                              typeof MethodLabel
                            >[0]["method"]
                          }
                        />
                        {item.operation.route === undefined ? (
                          <PathText
                            className="changelog__path"
                            text={item.operation.path}
                          />
                        ) : (
                          <a
                            className="changelog__path-link"
                            href={scopeHref(item.operation.route, roots)}
                          >
                            <PathText
                              className="changelog__path"
                              text={item.operation.path}
                            />
                          </a>
                        )}
                      </span>
                    )}
                    <p className="changelog__text">{item.text}</p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {history.length > 1 ? (
        <nav aria-label="Release history" className="changelog__history">
          <h2 className="eyebrow changelog__history-title">Release history</h2>
          <ul className="changelog__history-list">
            {history.map((release) => (
              <li key={release.id}>
                {release.id === version.id ? (
                  <span
                    aria-current="page"
                    className="changelog__history-current"
                  >
                    {release.label}
                  </span>
                ) : (
                  <a href={`/docs/${release.id}/changelog`}>{release.label}</a>
                )}
                {release.current ? (
                  <span className="changelog__history-state"> · current</span>
                ) : null}
                {release.state === "deprecated" ? (
                  <span className="changelog__history-state">
                    {" "}
                    · deprecated
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </article>
  );
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `2026-09-05` → `September 5, 2026`, without any locale or timezone dependency. */
function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const name = MONTHS[(month ?? 1) - 1] ?? "";
  return `${name} ${day ?? 1}, ${year ?? ""}`.trim();
}
