import {
  API_ROOT,
  type ReaderGroup,
  type ReaderIndex,
  type ReaderOperationSummary,
  type ReaderService,
} from "../../lib/reader/projection";
import {
  Breadcrumb,
  countLabel,
  MethodLabel,
  PathText,
  SafeText,
} from "./primitives";
import { COLLAPSE_NAVIGATION_ABOVE, isGenericVersion } from "./shell";

/** Home, API reference index, service, and group pages. */

/** Operations previewed per group on the index of a large contract. */
const INDEX_PREVIEW = 8;

export function HomePage({ index }: Readonly<{ index: ReaderIndex }>) {
  const description =
    index.project.description ?? index.services[0]?.description;
  return (
    <article className="document__column">
      <div className="hero">
        <p className="eyebrow">
          {index.project.name}
          {isGenericVersion(index.version.label)
            ? ""
            : ` · ${index.version.label}`}
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
            {countLabel(index.operationCount, "endpoint")}
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
                    {countLabel(group.listed.length, "endpoint")}
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
  const groups = index.services.reduce(
    (total, service) => total + service.groups.length,
    0,
  );
  return (
    <article className="document__column">
      <div className="page-header">
        <h1 className="page-title">API reference</h1>
        <p className="lede">
          {countLabel(index.operationCount, "operation")} across{" "}
          {countLabel(groups, "group")}
          {index.singleService
            ? ""
            : ` in ${countLabel(index.services.length, "service")}`}
          .
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
              {countLabel(service.operationCount, "operation")}
            </span>
          </div>
          {service.description === undefined ? null : (
            <SafeText className="section__note" text={service.description} />
          )}
          <GroupCards
            preview={index.operationCount > COLLAPSE_NAVIGATION_ABOVE}
            service={service}
          />
        </section>
      ))}
    </article>
  );
}

export function ServicePage({
  operationCount,
  service,
}: Readonly<{ operationCount: number; service: ReaderService }>) {
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
            {countLabel(service.operationCount, "operation")}
          </span>
        </div>
        <GroupCards
          preview={operationCount > COLLAPSE_NAVIGATION_ABOVE}
          service={service}
        />
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
        {group.description === undefined ? null : (
          <SafeText className="lede" text={group.description} />
        )}
      </div>
      <section aria-labelledby="operations-heading" className="section">
        <div className="section__header">
          <h2 className="section-title" id="operations-heading">
            Operations
          </h2>
          <span className="section__meta">
            {countLabel(group.listed.length, "operation")}
          </span>
        </div>
        <OperationList operations={group.listed} />
      </section>
    </article>
  );
}

/**
 * Group cards list every operation for ordinary contracts; large contracts
 * preview the first operations of each group and link to the group page so
 * the index stays bounded.
 */
function GroupCards({
  preview,
  service,
}: Readonly<{ preview: boolean; service: ReaderService }>) {
  return (
    <div className="group-grid">
      {service.groups.map((group) => {
        const shown = preview
          ? group.listed.slice(0, INDEX_PREVIEW)
          : group.listed;
        const rest = group.listed.length - shown.length;
        return (
          <div className="group-card" key={group.slug}>
            <h3>
              <a href={group.href}>{group.name}</a>
            </h3>
            {group.description === undefined ? null : (
              <SafeText
                className="group-card__description"
                text={group.description}
              />
            )}
            <OperationList operations={shown} />
            {rest > 0 ? (
              <a className="group-card__more" href={group.href}>
                View all {countLabel(group.listed.length, "operation")}
              </a>
            ) : null}
          </div>
        );
      })}
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
              <PathText
                className="operation-link__path"
                text={operation.path}
              />
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
