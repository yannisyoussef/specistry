import type { CodeView } from "../../lib/reader/code-view";
import type { PlaygroundView } from "../../lib/reader/playground-view";
import {
  schemaFocusHref,
  type ExampleView,
  type MediaTypeView,
  type OperationView,
  type ParameterGroupView,
  type ResponseView,
  type SecurityAlternativeView,
} from "../../lib/reader/operation-view";
import { CodeRail } from "./code/code-rail";
import { CopyButton } from "./copy-button";
import {
  Badge,
  Breadcrumb,
  countLabel,
  DeprecationCallout,
  MethodLabel,
  PathText,
  SafeText,
  SectionHeader,
  StatusLabel,
} from "./primitives";
import {
  contextLabel,
  SchemaBlock,
  SchemaDisclosure,
} from "./schema/schema-block";

/**
 * The operation page: the highest-priority SPEC-004 surface. With code
 * samples (SPEC-008) it renders as three siblings, header, Code rail, and
 * sections, so the rail can sit beside the document on wide viewports and
 * inline after the header everywhere else without duplicating markup.
 */
export function OperationPage({
  apiRoot,
  code,
  historical,
  playground,
  view,
}: Readonly<{
  /** Root of the reference routes for breadcrumbs (`/api` or `/api/<version>`). */
  apiRoot: string;
  code?: CodeView | undefined;
  /** Historical release: Try it is disabled; link to the current counterpart. */
  historical?:
    { readonly currentHref: string; readonly currentLabel: string } | undefined;
  playground?: PlaygroundView | undefined;
  view: OperationView;
}>) {
  const singleService = view.service.href === apiRoot;
  return (
    <article
      className={`document__column operation${code === undefined ? "" : " operation--with-code"}`}
    >
      <div className="page-header operation__header">
        <Breadcrumb
          items={[
            { href: apiRoot, label: "API reference" },
            ...(singleService
              ? []
              : [{ href: view.service.href, label: view.service.name }]),
            { href: view.group.href, label: view.group.name },
          ]}
        />
        <div className="page-header__title">
          <h1 className="page-title">{view.title}</h1>
          {view.deprecated ? <Badge tone="deprecated">Deprecated</Badge> : null}
        </div>
        <div className="endpoint-line">
          <MethodLabel method={view.method} />
          <PathText
            className={`endpoint-line__path${view.deprecated ? " endpoint-line__path--deprecated" : ""}`}
            text={view.path}
          />
          {view.deprecated ? (
            <span className="visually-hidden">(deprecated)</span>
          ) : null}
          <CopyButton label="Copy" value={`${view.method} ${view.path}`} />
        </div>
        {view.description === undefined ? null : (
          <SafeText className="lede" text={view.description} />
        )}
        {view.deprecated ? <DeprecationCallout /> : null}
      </div>

      {code === undefined ? null : (
        <CodeRail
          action={view.summary.href}
          historical={historical}
          playground={playground}
          view={code}
        />
      )}

      <div className="operation__body">
        <section
          aria-labelledby="authentication-heading"
          className="section"
          id="authentication"
        >
          <SectionHeader id="authentication" title="Authentication" />
          <Authentication alternatives={view.security} />
        </section>

        {view.parameterGroups.length === 0 ? null : (
          <section
            aria-labelledby="parameters-heading"
            className="section"
            id="parameters"
          >
            <SectionHeader
              id="parameters"
              meta={countLabel(
                view.parameterGroups.reduce(
                  (total, group) => total + group.rows.length,
                  0,
                ),
                "parameter",
              )}
              title="Parameters"
            />
            {view.parameterGroups.map((group) => (
              <ParameterGroup
                group={group}
                key={group.location}
                operationHref={view.summary.href}
              />
            ))}
          </section>
        )}

        {view.requestBody === undefined ? null : (
          <section
            aria-labelledby="request-body-heading"
            className="section"
            id="request-body"
          >
            <SectionHeader
              id="request-body"
              meta={view.requestBody.required ? "required" : "optional"}
              title="Request body"
            />
            {view.requestBody.description === undefined ? null : (
              <SafeText
                className="section__note"
                text={view.requestBody.description}
              />
            )}
            <MediaBlocks
              media={view.requestBody.media}
              operationHref={view.summary.href}
            />
          </section>
        )}

        <section
          aria-labelledby="responses-heading"
          className="section"
          id="responses"
        >
          <SectionHeader
            id="responses"
            meta={countLabel(view.responses.length, "response")}
            title="Responses"
          />
          {view.responses.map((response) => (
            <Response
              key={response.anchor}
              operationHref={view.summary.href}
              response={response}
            />
          ))}
        </section>

        {view.servers.length === 0 ? null : (
          <section
            aria-labelledby="servers-heading"
            className="section"
            id="servers"
          >
            <SectionHeader id="servers" title="Servers" />
            <ul className="rows">
              {view.servers.map((server) => (
                <li className="row row--stacked" key={server.url}>
                  <div className="row__key">
                    <PathText className="row__name" text={server.url} />
                  </div>
                  <div className="row__value">
                    {server.label === server.url ? null : (
                      <SafeText
                        className="row__description"
                        text={server.label}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {/* Mobile only (design 6n): a sticky bar at the end of the article
          that follows the viewport bottom and jumps to the inline Code
          section. Sticky, not fixed, so the panel's blur and containment
          cannot anchor it to the panel. */}
      {code === undefined ? null : (
        <nav aria-label="Code" className="code-bar">
          <a className="button button--primary code-bar__action" href="#code">
            Code
          </a>
          {playground === undefined ? null : (
            // Needs script (it opens the Try it tab); a noscript rule in the
            // layout hides it so it is never a dead control.
            <a className="button code-bar__action code-bar__try" href="#try-it">
              Try it
            </a>
          )}
        </nav>
      )}
    </article>
  );
}

function Authentication({
  alternatives,
}: Readonly<{ alternatives: readonly SecurityAlternativeView[] | undefined }>) {
  if (alternatives === undefined) {
    return (
      <p className="section__note">
        No authentication is declared for this operation.
      </p>
    );
  }
  return (
    <ol className="auth-list">
      {alternatives.map((alternative, index) => (
        <li className="auth-alternative" key={index}>
          {index > 0 ? (
            <span className="auth-alternative__joiner">or</span>
          ) : null}
          {alternative.schemes.length === 0 ? (
            <p className="body-small">
              No authentication (anonymous access is allowed).
            </p>
          ) : (
            <ul className="rows auth-schemes">
              {alternative.schemes.map((scheme, position) => (
                <li className="auth-scheme" key={scheme.key}>
                  {position > 0 ? (
                    <span className="auth-scheme__joiner">and</span>
                  ) : null}
                  <div className="row auth-scheme__row">
                    <div className="row__key">
                      <span className="auth-scheme__name">{scheme.label}</span>
                      <span className="auth-scheme__detail">
                        {scheme.detail}
                      </span>
                    </div>
                    <div className="row__value">
                      {scheme.description === undefined ? null : (
                        <SafeText
                          className="row__description"
                          text={scheme.description}
                        />
                      )}
                      {scheme.scopes.length === 0 ? null : (
                        <ul aria-label="Required scopes" className="scopes">
                          {scheme.scopes.map((scope) => (
                            <li className="scope" key={scope}>
                              {scope}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function ParameterGroup({
  group,
  operationHref,
}: Readonly<{ group: ParameterGroupView; operationHref: string }>) {
  return (
    <div className="subsection" id={group.anchor}>
      <h3 className="subsection__title">{group.label}</h3>
      <ul className="rows">
        {group.rows.map((row) => (
          <li className="row row--schema" id={row.anchor} key={row.name}>
            <div className="row__key">
              <code
                className={`row__name${row.deprecated ? " row__name--deprecated" : ""}`}
              >
                {row.name}
              </code>
              <span className="row__type">
                {row.type}
                {row.mediaType === undefined ? null : ` · ${row.mediaType}`}
              </span>
              <span
                className={`row__flag${row.required ? " row__flag--required" : ""}`}
              >
                {row.required ? "required" : "optional"}
              </span>
              {row.deprecated ? (
                <span className="row__flag row__flag--deprecated">
                  deprecated
                </span>
              ) : null}
            </div>
            <div className="row__value">
              {row.description === undefined ? null : (
                <SafeText className="row__description" text={row.description} />
              )}
              {row.constraints === undefined ? null : (
                <span className="row__constraints">{row.constraints}</span>
              )}
              {row.schema === undefined ? null : (
                <SchemaDisclosure
                  context="request"
                  focusHref={(locator) =>
                    schemaFocusHref(operationHref, row.anchor, locator)
                  }
                  idPrefix={row.anchor}
                  label={row.name}
                  view={row.schema}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Media types that share one schema are shown as a single block titled with
 * every media type, so a JSON and form body of the same shape are not
 * documented twice.
 */
function MediaBlocks({
  media,
  operationHref,
}: Readonly<{ media: readonly MediaTypeView[]; operationHref: string }>) {
  const groups: { readonly key: string; readonly members: MediaTypeView[] }[] =
    [];
  for (const entry of media) {
    const key = JSON.stringify([
      entry.schema ?? null,
      entry.encodings,
      entry.examples,
    ]);
    const existing = groups.find((group) => group.key === key);
    if (existing === undefined) groups.push({ key, members: [entry] });
    else existing.members.push(entry);
  }
  return (
    <>
      {groups.map((group) => (
        <MediaBlock
          key={group.key}
          members={group.members}
          operationHref={operationHref}
        />
      ))}
    </>
  );
}

function MediaBlock({
  members,
  operationHref,
}: Readonly<{ members: readonly MediaTypeView[]; operationHref: string }>) {
  const primary = members[0];
  if (primary === undefined) return null;
  return (
    <div className="media-block" id={primary.anchor}>
      {members.slice(1).map((member) => (
        <span hidden id={member.anchor} key={member.anchor} />
      ))}
      <div className="media-block__header">
        <span className="media-block__types">
          {members.map((member) => (
            <code className="media-block__type" key={member.mediaType}>
              {member.mediaType}
            </code>
          ))}
        </span>
        <span className="media-block__context">
          {contextLabel(primary.context)}
        </span>
      </div>
      {primary.schema === undefined ? (
        <p className="schema-note">
          No schema is declared for this media type.
        </p>
      ) : (
        <SchemaBlock
          context={primary.context}
          focusHref={(locator) =>
            schemaFocusHref(operationHref, primary.anchor, locator)
          }
          idPrefix={primary.anchor}
          view={primary.schema}
        />
      )}
      {primary.encodings.length === 0 ? null : (
        <ul className="rows" aria-label="Encodings">
          {primary.encodings.map((encoding) => (
            <li className="row" key={encoding.propertyName}>
              <div className="row__key">
                <code className="row__name">{encoding.propertyName}</code>
                <span className="row__type">encoding</span>
              </div>
              <div className="row__value">
                <span className="row__constraints">{encoding.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {primary.examples.map((example) => (
        <Example example={example} key={example.name} />
      ))}
    </div>
  );
}

/** Contract examples are artifact data and are shown verbatim as JSON. */
function Example({ example }: Readonly<{ example: ExampleView }>) {
  return (
    <figure className="example">
      <figcaption className="example__caption">
        <span className="example__name">{example.name}</span>
        {example.summary === undefined ? null : (
          <SafeText
            as="span"
            className="example__summary"
            text={example.summary}
          />
        )}
      </figcaption>
      {example.json === undefined ? null : (
        <pre className="code-surface example__code">
          <code>{example.json}</code>
        </pre>
      )}
      {example.truncated ? (
        <p className="section__note">The example is longer than shown.</p>
      ) : null}
      {example.externalValue === undefined ? null : (
        <p className="schema-line">
          External example: <code>{example.externalValue}</code>
        </p>
      )}
    </figure>
  );
}

function Response({
  operationHref,
  response,
}: Readonly<{ operationHref: string; response: ResponseView }>) {
  return (
    <div className="response" id={response.anchor}>
      <div className="response__header">
        <h3>
          <StatusLabel
            label={response.statusLabel}
            tone={response.tone}
            {...(response.statusText === undefined
              ? {}
              : { text: response.statusText })}
          />
        </h3>
        <SafeText
          as="span"
          className="response__description"
          text={response.description}
        />
      </div>
      {response.headers.length === 0 ? null : (
        <ul aria-label="Response headers" className="rows">
          {response.headers.map((header) => (
            <li
              className="row row--schema"
              id={header.anchor}
              key={header.name}
            >
              <div className="row__key">
                <code
                  className={`row__name${header.deprecated ? " row__name--deprecated" : ""}`}
                >
                  {header.name}
                </code>
                <span className="row__type">{header.type} · header</span>
                {header.deprecated ? (
                  <span className="row__flag row__flag--deprecated">
                    deprecated
                  </span>
                ) : null}
              </div>
              <div className="row__value">
                {header.description === undefined ? null : (
                  <SafeText
                    className="row__description"
                    text={header.description}
                  />
                )}
                {header.constraints === undefined ? null : (
                  <span className="row__constraints">{header.constraints}</span>
                )}
                {header.schema === undefined ? null : (
                  <SchemaDisclosure
                    context="response"
                    focusHref={(locator) =>
                      schemaFocusHref(operationHref, header.anchor, locator)
                    }
                    idPrefix={header.anchor}
                    label={header.name}
                    view={header.schema}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {response.media.length === 0 ? (
        <p className="response__empty">No response body</p>
      ) : (
        <MediaBlocks media={response.media} operationHref={operationHref} />
      )}
    </div>
  );
}
