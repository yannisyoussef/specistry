import {
  API_ROOT,
  type ReaderGroup,
  type ReaderIndex,
  type ReaderOperationSummary,
  type ReaderService,
} from "../../lib/reader/projection";
import { Breadcrumb, MethodLabel, SafeText } from "./primitives";

/** Home, API reference index, service, and group pages. */

export function HomePage({ index }: Readonly<{ index: ReaderIndex }>) {
  const description =
    index.project.description ?? index.services[0]?.description;
  return (
    <article className="document__column">
      <div className="hero">
        <p className="eyebrow">
          {index.project.name} · {index.version.label}
        </p>
        <h1 className="display">{index.project.name} API</h1>
        {description === undefined ? null : (
          <SafeText className="lede" text={description} />
        )}
        <div className="hero__actions">
          <a className="button button--primary" href={API_ROOT}>
            API reference
          </a>
        </div>
      </div>
      <section aria-labelledby="start-heading" className="section">
        <div className="section__header">
          <h2 className="section-title" id="start-heading">
            Start here
          </h2>
          <span className="section__meta">
            {index.operationCount}{" "}
            {index.operationCount === 1 ? "endpoint" : "endpoints"}
          </span>
        </div>
        <ul className="start-list">
          {index.services.flatMap((service) =>
            service.groups.map((group) => (
              <li
                className="start-list__item"
                key={`${service.slug}-${group.slug}`}
              >
                <a className="start-list__link" href={group.href}>
                  <span>
                    {index.singleService
                      ? group.name
                      : `${service.name} · ${group.name}`}
                  </span>
                  <span className="start-list__meta">
                    {group.listed.length}{" "}
                    {group.listed.length === 1 ? "endpoint" : "endpoints"}
                  </span>
                </a>
              </li>
            )),
          )}
        </ul>
      </section>
    </article>
  );
}

export function ReferencePage({ index }: Readonly<{ index: ReaderIndex }>) {
  return (
    <article className="document__column">
      <div className="page-header">
        <h1 className="page-title">API reference</h1>
        <p className="lede">
          {index.operationCount} operations across{" "}
          {index.services.reduce(
            (total, service) => total + service.groups.length,
            0,
          )}{" "}
          groups
          {index.singleService ? "" : ` in ${index.services.length} services`}.
        </p>
      </div>
      {index.services.map((service) => (
        <section
          aria-labelledby={`service-${service.slug}-heading`}
          className="section"
          key={service.slug}
        >
          <div className="section__header">
            <h2
              className="section-title"
              id={`service-${service.slug}-heading`}
            >
              {index.singleService ? (
                service.name
              ) : (
                <a href={service.href}>{service.name}</a>
              )}
            </h2>
            <span className="section__meta">
              {service.operationCount} operations
            </span>
          </div>
          {service.description === undefined ? null : (
            <SafeText className="section__note" text={service.description} />
          )}
          <GroupCards service={service} />
        </section>
      ))}
    </article>
  );
}

export function ServicePage({ service }: Readonly<{ service: ReaderService }>) {
  return (
    <article className="document__column">
      <div className="page-header">
        <Breadcrumb
          items={[
            { href: API_ROOT, label: "API reference" },
            { label: service.name },
          ]}
        />
        <h1 className="page-title">{service.name}</h1>
        {service.description === undefined ? null : (
          <SafeText className="lede" text={service.description} />
        )}
      </div>
      <section aria-labelledby="groups-heading" className="section">
        <div className="section__header">
          <h2 className="section-title" id="groups-heading">
            Groups
          </h2>
          <span className="section__meta">
            {service.operationCount} operations
          </span>
        </div>
        <GroupCards service={service} />
      </section>
    </article>
  );
}

export function GroupPage({
  group,
  service,
  singleService,
}: Readonly<{
  group: ReaderGroup;
  service: ReaderService;
  singleService: boolean;
}>) {
  return (
    <article className="document__column">
      <div className="page-header">
        <Breadcrumb
          items={[
            { href: API_ROOT, label: "API reference" },
            ...(singleService
              ? []
              : [{ href: service.href, label: service.name }]),
            { label: group.name },
          ]}
        />
        <h1 className="page-title">{group.name}</h1>
      </div>
      <section aria-labelledby="operations-heading" className="section">
        <div className="section__header">
          <h2 className="section-title" id="operations-heading">
            Operations
          </h2>
          <span className="section__meta">{group.listed.length}</span>
        </div>
        <OperationList operations={group.listed} />
      </section>
    </article>
  );
}

function GroupCards({ service }: Readonly<{ service: ReaderService }>) {
  return (
    <div className="group-grid">
      {service.groups.map((group) => (
        <div className="group-card" key={group.slug}>
          <h2>
            <a href={group.href}>{group.name}</a>
          </h2>
          <OperationList operations={group.listed} />
        </div>
      ))}
    </div>
  );
}

function OperationList({
  operations,
}: Readonly<{ operations: readonly ReaderOperationSummary[] }>) {
  return (
    <ul className="operation-list">
      {operations.map((operation) => (
        <li className="operation-list__item" key={operation.id}>
          <a className="operation-link" href={operation.href}>
            <MethodLabel method={operation.method} />
            <span>
              <span className="operation-link__title">{operation.title}</span>
              {operation.deprecated ? (
                <>
                  {" "}
                  <span className="badge badge--deprecated">Deprecated</span>
                </>
              ) : null}
              <br />
              <code className="operation-link__path">{operation.path}</code>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
