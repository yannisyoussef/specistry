"use client";

import {
  createSearchClient,
  parseSearchArtifactValue,
  type SearchClient,
  type SearchDocument,
  type SearchHit,
  type TextSegment,
} from "@specra/search/client";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { SearchIcon } from "./search-trigger";

/**
 * The ⌘K command palette (design contract, screen 6e): a native modal
 * `<dialog>` over a scrim, a combobox input, results grouped by source in
 * rank order with the active option announced through
 * `aria-activedescendant`, a polite debounced status, and a footer with key
 * hints and the engine's own timing. Queries run in this tab only; the index
 * is fetched once from the reader's content-addressed route and cached for
 * the session.
 */

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly client: SearchClient }
  | { readonly state: "failed" };

const cached = new Map<string, Promise<SearchClient>>();

function loadClient(path: string): Promise<SearchClient> {
  const existing = cached.get(path);
  if (existing !== undefined) return existing;
  const loading = fetch(path, { credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok)
        throw new Error(`Search index responded ${response.status}.`);
      return createSearchClient(
        parseSearchArtifactValue(await response.json()),
        () => performance.now(),
      );
    })
    .catch((error: unknown) => {
      cached.delete(path);
      throw error;
    });
  cached.set(path, loading);
  return loading;
}

const GROUPS: readonly {
  readonly label: string;
  readonly kinds: readonly SearchDocument["kind"][];
}[] = [
  { kinds: ["operation", "group", "service"], label: "API reference" },
  { kinds: ["page", "section"], label: "Guides" },
];

const KIND_TAGS: Readonly<Record<SearchDocument["kind"], string>> = {
  group: "GROUP",
  operation: "",
  page: "GUIDE",
  section: "GUIDE",
  service: "SERVICE",
};

const KIND_WORDS: Readonly<Record<SearchDocument["kind"], string>> = {
  group: "API group",
  operation: "API",
  page: "Guide",
  section: "Guide section",
  service: "API service",
};

/** Route roots of the release being read; result routes are scoped into them. */
export interface SearchRoots {
  readonly home: string;
  readonly docs: string;
  readonly api: string;
}

/** Search records store unversioned routes; the served release scopes them (SPEC-010 §37). */
function scopeResultRoute(
  route: string,
  roots: SearchRoots | undefined,
): string {
  if (roots === undefined) return route;
  const hashIndex = route.indexOf("#");
  const pathPart = hashIndex === -1 ? route : route.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : route.slice(hashIndex);
  if (pathPart === "/" || pathPart === "/docs") return `${roots.home}${hash}`;
  if (pathPart.startsWith("/docs/"))
    return `${roots.docs}${pathPart.slice(5)}${hash}`;
  if (pathPart === "/api") return `${roots.api}${hash}`;
  if (pathPart.startsWith("/api/"))
    return `${roots.api}${pathPart.slice(4)}${hash}`;
  return route;
}

export default function SearchPalette({
  onClose,
  path,
  roots,
}: Readonly<{
  onClose: () => void;
  path: string;
  roots?: SearchRoots | undefined;
}>) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (element === null || element.open) return;
    element.showModal();
    input.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadClient(path)
      .then((client) => {
        if (!cancelled) setLoaded({ client, state: "ready" });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ state: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const response = useMemo(
    () =>
      loaded.state === "ready" && query.trim().length > 0
        ? loaded.client.search(query)
        : undefined,
    [loaded, query],
  );
  const hits = useMemo(() => response?.hits ?? [], [response]);
  const groups = useMemo(() => groupHits(hits), [hits]);
  const activeHit = hits[Math.min(active, Math.max(hits.length - 1, 0))];

  // Announce counts politely once typing pauses, never per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus(
        response === undefined
          ? ""
          : response.hits.length === 0
            ? `No results for “${response.query}”.`
            : `${response.hits.length} result${response.hits.length === 1 ? "" : "s"}.`,
      );
    }, 400);
    return () => clearTimeout(timer);
  }, [response]);

  const navigate = (hit: SearchHit | undefined) => {
    if (hit === undefined) return;
    // Routes come from the validated artifact, never from the query, and
    // stay inside the release being read.
    window.location.assign(scopeResultRoute(hit.document.route, roots));
  };

  const listboxId = `${id}-listbox`;
  const optionId = (hit: SearchHit) => `${id}-option-${hit.document.id}`;

  return (
    <dialog
      aria-label="Search documentation"
      className="search"
      onCancel={(event) => {
        // Escape: the element must not close itself; React unmounts it and
        // the trigger restores focus once it is gone.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      onClose={onClose}
      ref={dialog}
    >
      <div className="search__panel">
        <div className="search__field">
          <span className="search__icon">
            <SearchIcon />
          </span>
          <input
            aria-activedescendant={
              activeHit === undefined ? undefined : optionId(activeHit)
            }
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-describedby={`${id}-hint`}
            aria-expanded={hits.length > 0}
            aria-label="Search documentation"
            autoComplete="off"
            className="search__input"
            enterKeyHint="go"
            maxLength={200}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              switch (event.key) {
                case "ArrowDown":
                  event.preventDefault();
                  setActive((current) =>
                    Math.min(current + 1, Math.max(hits.length - 1, 0)),
                  );
                  break;
                case "ArrowUp":
                  event.preventDefault();
                  setActive((current) => Math.max(current - 1, 0));
                  break;
                case "Home":
                  if (hits.length > 0) {
                    event.preventDefault();
                    setActive(0);
                  }
                  break;
                case "End":
                  if (hits.length > 0) {
                    event.preventDefault();
                    setActive(hits.length - 1);
                  }
                  break;
                case "Enter":
                  event.preventDefault();
                  navigate(activeHit);
                  break;
                default:
                  break;
              }
            }}
            placeholder="Search guides and the API reference"
            ref={input}
            role="combobox"
            spellCheck={false}
            type="text"
            value={query}
          />
          <button className="search__cancel" onClick={onClose} type="button">
            <kbd aria-hidden="true" className="search__esc">
              esc
            </kbd>
            <span className="search__cancel-label">Cancel</span>
            <span className="visually-hidden">Close search</span>
          </button>
        </div>
        <p className="visually-hidden" id={`${id}-hint`}>
          Results update as you type. Use the arrow keys to move between results
          and Enter to open one.
        </p>
        <div
          aria-label="Search results"
          className="search__results"
          id={listboxId}
          role="listbox"
        >
          {groups.map((group) => (
            <div
              aria-label={group.label}
              className="search__group"
              key={group.label}
              role="group"
            >
              <span aria-hidden="true" className="search__group-title">
                {group.label}
              </span>
              {group.hits.map((hit) => {
                const selected = hit === activeHit;
                return (
                  <div
                    aria-selected={selected}
                    className={`search__result${selected ? " search__result--active" : ""}`}
                    id={optionId(hit)}
                    key={hit.document.id}
                    onClick={() => navigate(hit)}
                    onMouseMove={() => {
                      const index = hits.indexOf(hit);
                      if (index !== active) setActive(index);
                    }}
                    role="option"
                  >
                    <span className="visually-hidden">
                      {KIND_WORDS[hit.document.kind]},{" "}
                    </span>
                    <Tag document={hit.document} />
                    <span className="search__text">
                      <span className="search__title">
                        <Segments segments={hit.title} />
                        {hit.document.deprecated === true ? (
                          <span className="search__deprecated">
                            {" "}
                            deprecated
                          </span>
                        ) : null}
                      </span>
                      <span className="search__subtitle">
                        {subtitle(hit.document)}
                      </span>
                    </span>
                    <kbd aria-hidden="true" className="search__enter">
                      {selected ? "⏎" : ""}
                    </kbd>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <EmptyState loaded={loaded} query={query} response={response} />
        <p className="visually-hidden" role="status">
          {status}
        </p>
        <div className="search__footer">
          <span>
            <span aria-hidden="true">↑↓</span> move ·{" "}
            <span aria-hidden="true">⏎</span> open ·{" "}
            <span aria-hidden="true">esc</span> close
          </span>
          <span>
            {response === undefined
              ? ""
              : `${response.hits.length} result${response.hits.length === 1 ? "" : "s"} · ${Math.max(1, Math.round(response.elapsedMs))} ms`}
          </span>
        </div>
      </div>
    </dialog>
  );
}

function EmptyState({
  loaded,
  query,
  response,
}: Readonly<{
  loaded: Loaded;
  query: string;
  response:
    { readonly hits: readonly SearchHit[]; readonly query: string } | undefined;
}>) {
  if (loaded.state === "failed") {
    return (
      <p className="search__empty">
        Search is unavailable right now. The navigation still works.
      </p>
    );
  }
  if (loaded.state === "loading") {
    return <p className="search__empty">Loading search…</p>;
  }
  if (query.trim().length === 0) {
    return (
      <p className="search__empty">
        Type to search guides, sections, and API operations.
      </p>
    );
  }
  if (response !== undefined && response.hits.length === 0) {
    return (
      <p className="search__empty">
        No results for “{response.query}”. Try another term, or browse the
        navigation.
      </p>
    );
  }
  return null;
}

function Tag({ document }: Readonly<{ document: SearchDocument }>) {
  if (document.kind === "operation" && document.method !== undefined) {
    return (
      <span
        aria-hidden="true"
        className="search__tag search__tag--method"
        data-method={document.method}
      >
        {document.method}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="search__tag">
      {KIND_TAGS[document.kind]}
    </span>
  );
}

function Segments({
  segments,
}: Readonly<{ segments: readonly TextSegment[] }>) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark className="search__match" key={index}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function subtitle(document: SearchDocument): string {
  switch (document.kind) {
    case "operation":
      return document.subtitle ?? document.path ?? "";
    case "section":
      return [...document.context, document.subtitle ?? ""]
        .filter(Boolean)
        .join(" › ");
    default:
      return document.context.join(" › ");
  }
}

function groupHits(hits: readonly SearchHit[]) {
  const buckets = GROUPS.map((group) => ({
    hits: hits.filter((hit) => group.kinds.includes(hit.document.kind)),
    label: group.label,
    rank: Number.POSITIVE_INFINITY,
  }));
  for (const bucket of buckets) {
    const first = bucket.hits[0];
    if (first !== undefined) bucket.rank = hits.indexOf(first);
  }
  // The group holding the best hit comes first; empty groups are omitted.
  return buckets
    .filter((bucket) => bucket.hits.length > 0)
    .sort((left, right) => left.rank - right.rank);
}
