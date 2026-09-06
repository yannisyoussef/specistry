import type { ReactNode } from "react";

import {
  apiLabel,
  hasDocs,
  sidebarNodes,
  type ReaderContent,
  type SidebarNode,
} from "../../lib/reader/content";
import { API_ROOT, type ReaderIndex } from "../../lib/reader/projection";
import { THEME_LABELS, THEME_MODES, type ThemeMode } from "../../lib/theme";
import { MobileNav } from "./mobile-nav";
import { MethodLabel } from "./primitives";
import { SearchTrigger } from "./search/search-trigger";
import { SidebarScroll } from "./sidebar-scroll";

/**
 * Reader shell: glass header, one composed navigation (authored sections and
 * the generated API reference in the configured order), document panel, and
 * footer. Everything is server-rendered once; the mobile drawer clones the
 * navigation when it opens, and the sidebar scroll island only positions the
 * current item.
 */

export interface ShellProps {
  readonly index: ReaderIndex;
  readonly content?: ReaderContent | undefined;
  /** Content-addressed path of the search artifact; absent when the build made none. */
  readonly searchPath?: string | undefined;
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

export function Shell({
  children,
  content,
  currentPath,
  index,
  mode,
  searchPath,
}: ShellProps) {
  const docs = hasDocs(content);
  const inApi =
    currentPath === API_ROOT || currentPath.startsWith(`${API_ROOT}/`);
  const logo = content?.branding?.logo;
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
            {logo === undefined ? (
              <span aria-hidden="true" className="wordmark__mark" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- logo is a validated artifact asset
              <img
                alt=""
                className="wordmark__logo"
                height="20"
                src={`/${logo}`}
                width="20"
              />
            )}
            <span className="wordmark__name">{index.project.name}</span>
            <span className="wordmark__suffix">Docs</span>
          </a>
          <nav aria-label="Primary">
            <ul className="tabs">
              {docs ? (
                <li>
                  <a
                    aria-current={inApi ? undefined : "page"}
                    className="tab"
                    href="/"
                  >
                    Guides
                  </a>
                </li>
              ) : null}
              <li>
                <a
                  aria-current={inApi ? "page" : undefined}
                  className="tab"
                  href={API_ROOT}
                >
                  {apiLabel(index, content)}
                </a>
              </li>
            </ul>
          </nav>
        </div>
        {searchPath === undefined ? null : (
          <div className="header__end">
            <SearchTrigger path={searchPath} />
          </div>
        )}
      </header>
      <aside
        aria-label={docs ? "Documentation navigation" : "API navigation"}
        className="shell__sidebar"
        id={SIDEBAR_WRAPPER_ID}
      >
        <div className="panel sidebar" id={SIDEBAR_ID}>
          <ComposedNavigation
            content={content}
            currentPath={currentPath}
            index={index}
          />
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

/**
 * Authored sections and the API reference in configured order. Without
 * authored content the API groups render alone, exactly as before.
 */
function ComposedNavigation({
  content,
  currentPath,
  index,
}: Readonly<{
  content: ReaderContent | undefined;
  currentPath: string;
  index: ReaderIndex;
}>) {
  if (!hasDocs(content) || content === undefined) {
    return (
      <nav aria-label="API reference" id={NAVIGATION_ID}>
        <ApiGroups currentPath={currentPath} index={index} />
      </nav>
    );
  }
  const nodes = sidebarNodes(content.navigation.items, currentPath);
  return (
    <nav aria-label="Documentation" className="nav-docs" id={NAVIGATION_ID}>
      <DocsNodes currentPath={currentPath} index={index} nodes={nodes} />
    </nav>
  );
}

function DocsNodes({
  currentPath,
  index,
  nodes,
  depth = 0,
}: Readonly<{
  currentPath: string;
  index: ReaderIndex;
  nodes: readonly SidebarNode[];
  depth?: number;
}>) {
  return (
    <>
      {nodes.map((node, position) => {
        switch (node.kind) {
          case "section":
            return (
              <div
                className={`nav-group${depth > 0 ? " nav-group--nested" : ""}`}
                key={`${node.label}-${position}`}
              >
                <span className="eyebrow nav-group__title">{node.label}</span>
                {node.items.some((item) => item.kind === "section") ? (
                  <DocsNodes
                    currentPath={currentPath}
                    depth={depth + 1}
                    index={index}
                    nodes={node.items}
                  />
                ) : (
                  <ul className="nav-list">
                    {node.items.map((item, itemPosition) => (
                      <DocsLeaf
                        currentPath={currentPath}
                        index={index}
                        key={`${item.kind}-${itemPosition}`}
                        node={item}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          case "api":
            return (
              <div className="nav-api" key="api">
                <span className="eyebrow nav-group__title nav-api__title">
                  <a
                    aria-current={currentPath === API_ROOT ? "page" : undefined}
                    href={API_ROOT}
                  >
                    {node.label}
                  </a>
                </span>
                <ApiGroups currentPath={currentPath} index={index} />
              </div>
            );
          default:
            return (
              <ul className="nav-list" key={`${node.kind}-${position}`}>
                <DocsLeaf currentPath={currentPath} index={index} node={node} />
              </ul>
            );
        }
      })}
    </>
  );
}

function DocsLeaf({
  currentPath,
  index,
  node,
}: Readonly<{
  currentPath: string;
  index: ReaderIndex;
  node: SidebarNode;
}>) {
  switch (node.kind) {
    case "page":
      return (
        <li>
          <a
            aria-current={node.current ? "page" : undefined}
            className="nav-item"
            href={node.href}
          >
            <span className="nav-item__label">{node.label}</span>
          </a>
        </li>
      );
    case "link":
      return (
        <li>
          <a
            className="nav-item nav-item--external"
            href={node.href}
            rel="noopener noreferrer"
          >
            <span className="nav-item__label">{node.label}</span>
            <span aria-hidden="true" className="nav-item__external">
              ↗
            </span>
            <span className="visually-hidden"> (external link)</span>
          </a>
        </li>
      );
    case "api":
      return (
        <li>
          <ApiGroups currentPath={currentPath} index={index} />
        </li>
      );
    case "section":
      return (
        <li className="nav-group nav-group--nested">
          <span className="eyebrow nav-group__title">{node.label}</span>
          <ul className="nav-list">
            {node.items.map((item, position) => (
              <DocsLeaf
                currentPath={currentPath}
                index={index}
                key={`${item.kind}-${position}`}
                node={item}
              />
            ))}
          </ul>
        </li>
      );
  }
}

function ApiGroups({
  currentPath,
  index,
}: Readonly<{ currentPath: string; index: ReaderIndex }>) {
  const compact = index.operationCount > COLLAPSE_NAVIGATION_ABOVE;
  return (
    <>
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
    </>
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
