import type { ReactNode } from "react";

import { API_ROOT, type ReaderIndex } from "../../lib/reader/projection";
import { THEME_LABELS, THEME_MODES, type ThemeMode } from "../../lib/theme";
import { MobileNav } from "./mobile-nav";
import { MethodLabel } from "./primitives";

/**
 * Reader shell: glass header, API navigation, document panel, and footer.
 * Everything is server-rendered; the only client island is the mobile drawer
 * control, which receives the same server-rendered navigation as children.
 */

export interface ShellProps {
  readonly index: ReaderIndex;
  readonly currentPath: string;
  readonly mode: ThemeMode;
  readonly children: ReactNode;
}

export function Shell({ children, currentPath, index, mode }: ShellProps) {
  const navigation = <ApiNavigation currentPath={currentPath} index={index} />;
  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="shell__header panel header">
        <div className="header__start">
          <MobileNav label="Navigation">{navigation}</MobileNav>
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
      <aside aria-label="API navigation" className="shell__sidebar">
        <div className="panel sidebar">{navigation}</div>
      </aside>
      <main className="shell__main panel document" id="content" tabIndex={-1}>
        {children}
      </main>
      <footer className="shell__footer panel footer">
        <span>
          {index.project.name} · {index.version.label}
        </span>
        <ThemeForm currentPath={currentPath} mode={mode} />
      </footer>
    </div>
  );
}

function ApiNavigation({
  currentPath,
  index,
}: Readonly<{ currentPath: string; index: ReaderIndex }>) {
  return (
    <nav aria-label="API reference">
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
          {service.groups.map((group) => (
            <div className="nav-group" key={group.slug}>
              <span className="eyebrow nav-group__title">
                <a
                  aria-current={currentPath === group.href ? "page" : undefined}
                  href={group.href}
                >
                  {group.name}
                </a>
              </span>
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
                      <span className="nav-item__label">{operation.title}</span>
                      <MethodLabel compact method={operation.method} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
