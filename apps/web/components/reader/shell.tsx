import type { ReactNode } from "react";

import { API_ROOT, type ReaderIndex } from "../../lib/reader/projection";
import { THEME_LABELS, THEME_MODES, type ThemeMode } from "../../lib/theme";
import { MobileNav } from "./mobile-nav";
import { MethodLabel } from "./primitives";
import { SidebarScroll } from "./sidebar-scroll";

/**
 * Reader shell: glass header, API navigation, document panel, and footer.
 * Everything is server-rendered once; the mobile drawer clones the sidebar
 * navigation when it opens, and the sidebar scroll island only positions the
 * current item.
 */

export interface ShellProps {
  readonly index: ReaderIndex;
  readonly currentPath: string;
  readonly mode: ThemeMode;
  readonly children: ReactNode;
}

const NAVIGATION_ID = "api-navigation";
const SIDEBAR_ID = "api-sidebar";
const SIDEBAR_WRAPPER_ID = "api-sidebar-region";
/**
 * Above this many operations the sidebar lists every group but expands only
 * the current one, so a large contract stays scannable and the HTML stays
 * bounded by the number of groups rather than operations.
 */
export const COLLAPSE_NAVIGATION_ABOVE = 150;

export function Shell({ children, currentPath, index, mode }: ShellProps) {
  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="shell__header panel header">
        <div className="header__start">
          <MobileNav
            fallback={SIDEBAR_WRAPPER_ID}
            label="Navigation"
            source={NAVIGATION_ID}
          />
          <a className="wordmark" href="/">
            <span aria-hidden="true" className="wordmark__mark" />
            <span className="wordmark__name">{index.project.name}</span>
            <span className="wordmark__suffix">Docs</span>
          </a>
          <nav aria-label="Primary">
            <ul className="tabs">
              <li>
                <a
                  aria-current={
                    currentPath === API_ROOT ||
                    currentPath.startsWith(`${API_ROOT}/`)
                      ? "page"
                      : undefined
                  }
                  className="tab"
                  href={API_ROOT}
                >
                  API reference
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <aside
        aria-label="API navigation"
        className="shell__sidebar"
        id={SIDEBAR_WRAPPER_ID}
      >
        <div className="panel sidebar" id={SIDEBAR_ID}>
          <ApiNavigation currentPath={currentPath} index={index} />
        </div>
        <SidebarScroll target={SIDEBAR_ID} />
      </aside>
      <main className="shell__main panel document" id="content" tabIndex={-1}>
        {children}
      </main>
      <footer className="shell__footer panel footer">
        <span>
          {index.project.name}
          {isGenericVersion(index.version.label)
            ? ""
            : ` · ${index.version.label}`}
        </span>
        <ThemeForm currentPath={currentPath} mode={mode} />
      </footer>
    </div>
  );
}

/** The default single-version label carries no information for readers. */
export function isGenericVersion(label: string): boolean {
  return label.trim().toLowerCase() === "current";
}

function ApiNavigation({
  currentPath,
  index,
}: Readonly<{ currentPath: string; index: ReaderIndex }>) {
  const compact = index.operationCount > COLLAPSE_NAVIGATION_ABOVE;
  return (
    <nav aria-label="API reference" id={NAVIGATION_ID}>
      {index.services.map((service) => (
        <div className="nav-service" key={service.id}>
          {index.singleService ? null : (
            <span className="eyebrow nav-group__title">
              <a
                aria-current={currentPath === service.href ? "page" : undefined}
                href={service.href}
              >
                {service.name}
              </a>
            </span>
          )}
          {service.groups.map((group) => {
            const expanded =
              !compact ||
              currentPath === group.href ||
              group.listed.some((operation) => operation.href === currentPath);
            return (
              <div
                className={`nav-group${expanded ? "" : " nav-group--compact"}`}
                key={group.slug}
              >
                <span className="eyebrow nav-group__title">
                  <a
                    aria-current={
                      currentPath === group.href ? "page" : undefined
                    }
                    href={group.href}
                  >
                    {group.name}
                  </a>
                  {expanded ? null : (
                    <span className="nav-group__count">
                      {group.listed.length}
                    </span>
                  )}
                </span>
                {expanded ? (
                  <ul className="nav-list">
                    {group.listed.map((operation) => (
                      <li key={`${group.slug}-${operation.id}`}>
                        <a
                          aria-current={
                            currentPath === operation.href &&
                            operation.groupSlug === group.slug
                              ? "page"
                              : undefined
                          }
                          className={`nav-item${operation.deprecated ? " nav-item--deprecated" : ""}`}
                          href={operation.href}
                        >
                          <span className="nav-item__label">
                            {operation.title}
                            {operation.deprecated ? (
                              <span className="visually-hidden">
                                {" "}
                                (deprecated)
                              </span>
                            ) : null}
                          </span>
                          <MethodLabel compact method={operation.method} />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function ThemeForm({
  currentPath,
  mode,
}: Readonly<{ currentPath: string; mode: ThemeMode }>) {
  return (
    <form action="/theme" className="theme-form" method="post">
      <fieldset>
        <legend className="theme-form__legend">Theme</legend>
        <input name="return" type="hidden" value={currentPath} />
        {THEME_MODES.map((candidate) => (
          <button
            aria-pressed={candidate === mode}
            key={candidate}
            name="mode"
            type="submit"
            value={candidate}
          >
            {THEME_LABELS[candidate]}
          </button>
        ))}
      </fieldset>
    </form>
  );
}
