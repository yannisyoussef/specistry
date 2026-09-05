import type {
  PropertySummary,
  SchemaSummary,
} from "../../lib/reader/schema-summary";
import type {
  MediaTypeView,
  OperationView,
  ParameterGroupView,
  ResponseView,
  SecurityAlternativeView,
} from "../../lib/reader/operation-view";
import { API_ROOT } from "../../lib/reader/projection";
import { CopyButton } from "./copy-button";
import {
  Badge,
  Breadcrumb,
  DeprecationCallout,
  MethodLabel,
  SafeText,
  SectionHeader,
  StatusLabel,
} from "./primitives";

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The operation page: the highest-priority SPEC-004 surface. */
export function OperationPage({ view }: Readonly<{ view: OperationView }>) {
  const singleService = view.service.href === API_ROOT;
  return (
    <article className="document__column">
      <div className="page-header">
        <Breadcrumb
          items={[
            { href: API_ROOT, label: "API reference" },
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
          <code
            className={`endpoint-line__path${view.deprecated ? " endpoint-line__path--deprecated" : ""}`}
          >
            {view.path}
          </code>
          <CopyButton label="Copy" value={`${view.method} ${view.path}`} />
        </div>
        {view.description === undefined ? null : (
          <SafeText className="lede" text={view.description} />
        )}
        {view.deprecated ? <DeprecationCallout /> : null}
      </div>

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
            <ParameterGroup group={group} key={group.location} />
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
          {view.requestBody.media.map((media) => (
            <MediaBlock key={media.anchor} media={media} />
          ))}
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
          <Response key={response.anchor} response={response} />
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
              <li className="row" key={server.url}>
                <div className="row__key">
                  <code className="row__name">{server.url}</code>
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
    </article>
  );
}

function Authentication({
  alternatives,
}: Readonly<{ alternatives: readonly SecurityAlternativeView[] | undefined }>) {
  if (alternatives === undefined) {
    return (
      <p className="section__note">
        This operation declares no authentication requirement.
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
            <ul className="rows">
              {alternative.schemes.map((scheme, position) => (
                <li className="auth-scheme" key={scheme.key}>
                  <span>
                    {position > 0 ? (
                      <span className="auth-alternative__joiner">and </span>
                    ) : null}
                    <span className="auth-scheme__name">{scheme.label}</span>
                  </span>
                  <span className="row__value">
                    <span className="auth-scheme__detail">{scheme.detail}</span>
                    {scheme.description === undefined ? null : (
                      <SafeText
                        className="body-small"
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
                  </span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function ParameterGroup({ group }: Readonly<{ group: ParameterGroupView }>) {
  return (
    <div className="subsection" id={group.anchor}>
      <h3 className="subsection__title">{group.label}</h3>
      <ul className="rows">
        {group.rows.map((row) => (
          <li className="row" id={`${group.anchor}-${row.name}`} key={row.name}>
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
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MediaBlock({ media }: Readonly<{ media: MediaTypeView }>) {
  return (
    <div className="media-block" id={media.anchor}>
      <div className="media-block__header">
        <code className="media-block__type">{media.mediaType}</code>
        {media.exampleCount > 0 ? (
          <span className="section__meta">
            {media.exampleCount}{" "}
            {media.exampleCount === 1 ? "example" : "examples"}
          </span>
        ) : null}
      </div>
      {media.schema === undefined ? (
        <p className="schema-line">
          No schema is declared for this media type.
        </p>
      ) : (
        <Schema schema={media.schema} />
      )}
      {media.encodings.length === 0 ? null : (
        <ul className="rows" aria-label="Encodings">
          {media.encodings.map((encoding) => (
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
    </div>
  );
}

function Schema({ schema }: Readonly<{ schema: SchemaSummary }>) {
  return (
    <>
      <p className="schema-line">
        <code>{schema.type}</code>
        {schema.constraints === undefined ? null : (
          <span className="row__constraints">{schema.constraints}</span>
        )}
        {schema.deprecated ? <Badge tone="deprecated">Deprecated</Badge> : null}
      </p>
      {schema.description === undefined ? null : (
        <SafeText className="body-small" text={schema.description} />
      )}
      {schema.properties === undefined ? null : (
        <PropertyRows properties={schema.properties} />
      )}
      {schema.truncated ? (
        <p className="section__note">
          Nested structure is not expanded in this version of the reader.
        </p>
      ) : null}
    </>
  );
}

function PropertyRows({
  properties,
}: Readonly<{ properties: readonly PropertySummary[] }>) {
  if (properties.length === 0) {
    return <p className="section__note">This object declares no properties.</p>;
  }
  return (
    <ul className="rows">
      {properties.map((property) => (
        <li className="row" key={property.name}>
          <div className="row__key">
            <code
              className={`row__name${property.deprecated ? " row__name--deprecated" : ""}`}
            >
              {property.name}
            </code>
            <span className="row__type">{property.type}</span>
            <span
              className={`row__flag${property.required ? " row__flag--required" : ""}`}
            >
              {property.required ? "required" : "optional"}
            </span>
            {property.deprecated ? (
              <span className="row__flag row__flag--deprecated">
                deprecated
              </span>
            ) : null}
            {property.readOnly ? (
              <span className="row__flag">read-only</span>
            ) : null}
            {property.writeOnly ? (
              <span className="row__flag">write-only</span>
            ) : null}
          </div>
          <div className="row__value">
            {property.description === undefined ? null : (
              <SafeText
                className="row__description"
                text={property.description}
              />
            )}
            {property.constraints === undefined ? null : (
              <span className="row__constraints">{property.constraints}</span>
            )}
            {property.nested ? (
              <span className="row__constraints">
                nested structure not expanded
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Response({ response }: Readonly<{ response: ResponseView }>) {
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
            <li className="row" key={header.name}>
              <div className="row__key">
                <code
                  className={`row__name${header.deprecated ? " row__name--deprecated" : ""}`}
                >
                  {header.name}
                </code>
                <span className="row__type">{header.type} · header</span>
              </div>
              <div className="row__value">
                {header.description === undefined ? null : (
                  <SafeText
                    className="row__description"
                    text={header.description}
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
        response.media.map((media) => (
          <MediaBlock key={media.anchor} media={media} />
        ))
      )}
    </div>
  );
}
