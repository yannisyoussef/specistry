import type { VersionSwitchTarget } from "../../lib/reader/release";
import type { ReaderVersion } from "../../lib/reader/scope";

/**
 * Version chrome (SPEC-010 §47–§52, design 06h): a native disclosure menu
 * in the header listing every retained release, newest first, with its
 * state as text; and a restrained banner on historical or deprecated
 * pages. Both are plain HTML: no script is needed to switch versions, and
 * every destination is a validated route of the target release (its
 * counterpart of the current page, or its home).
 */

export function VersionMenu({
  targets,
  version,
}: Readonly<{
  targets: readonly VersionSwitchTarget[];
  version: ReaderVersion;
}>) {
  if (version.catalog.length < 2) {
    return (
      <span className="version-chip" title="Documentation version">
        <span className="visually-hidden">Documentation version </span>
        {version.label}
      </span>
    );
  }
  return (
    <details className="version-menu">
      <summary
        aria-label={`Documentation version: ${version.label}${version.current ? ", current" : version.state === "deprecated" ? ", deprecated" : ""}. Change version`}
        className="version-menu__summary"
      >
        <span className="version-menu__label">{version.label}</span>
        <span aria-hidden="true" className="version-menu__chevron">
          ▾
        </span>
      </summary>
      <ul aria-label="Documentation versions" className="version-menu__list">
        {version.catalog.map((release) => {
          const target = targets.find((entry) => entry.id === release.id);
          const selected = release.id === version.id;
          return (
            <li className="version-menu__item" key={release.id}>
              <a
                aria-current={selected ? "page" : undefined}
                className="version-menu__link"
                href={target?.href ?? `/docs/${release.id}`}
              >
                <span className="version-menu__name">{release.label}</span>
                <span className="version-menu__state">
                  {release.current
                    ? "Current"
                    : release.state === "deprecated"
                      ? "Deprecated"
                      : "Supported"}
                  {target !== undefined && !target.counterpart && !selected
                    ? " · opens the release home"
                    : ""}
                </span>
                {release.state === "deprecated" ? (
                  <span className="version-badge version-badge--deprecated">
                    Deprecated
                  </span>
                ) : release.current ? (
                  <span className="version-badge version-badge--current">
                    Current
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

export function VersionBanner({
  currentHref,
  version,
}: Readonly<{ currentHref: string; version: ReaderVersion }>) {
  if (version.current) return null;
  const deprecated = version.state === "deprecated";
  return (
    <aside
      aria-label="Documentation version notice"
      className={`version-banner${deprecated ? " version-banner--deprecated" : ""}`}
    >
      <p className="version-banner__text">
        <strong>
          {deprecated
            ? `${version.label} is deprecated.`
            : `You’re viewing ${version.label}.`}
        </strong>{" "}
        The current documentation is {version.currentLabel}.{" "}
        <a className="version-banner__link" href={currentHref}>
          Open the current version
        </a>
        .
      </p>
    </aside>
  );
}
