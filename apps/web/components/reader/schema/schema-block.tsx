import type { ReactNode } from "react";

import type {
  PropertyView,
  SchemaContext,
  SchemaView,
} from "../../../lib/reader/schema-view";
import { countLabel, SafeText } from "../primitives";

/**
 * Server-rendered schema renderer (SPEC-005). The projection decides what is
 * shown; this component only lays it out: property rows in the reader's
 * 160/1fr grid, native `<details>` disclosures for nested structure (no
 * client script, no ARIA tree), variants as a disclosure list, discriminator
 * mappings, recursion markers, and links into a focused view for anything the
 * budget left out. Every string is rendered as text.
 */

export interface SchemaBlockProps {
  readonly view: SchemaView;
  readonly context: SchemaContext;
  /** Builds the href of the focused view for a locator (`""` is the root). */
  readonly focusHref: (locator: string) => string;
  /** Prefix for the ids of variant disclosures (discriminator links). */
  readonly idPrefix: string;
}

const CONTEXT_LABEL: Readonly<Record<SchemaContext, string>> = {
  request: "Request schema",
  response: "Response schema",
};

export function contextLabel(context: SchemaContext): string {
  return CONTEXT_LABEL[context];
}

/** A schema block: the root line, its notes, and its first level open. */
export function SchemaBlock({
  context,
  focusHref,
  idPrefix,
  view,
}: SchemaBlockProps) {
  const frame: Frame = { context, focusHref, idPrefix };
  return (
    <div className="schema" data-context={context}>
      <SchemaLine frame={frame} view={view} />
      <Children frame={frame} view={view} />
    </div>
  );
}

/**
 * The compact form for a parameter or header row: nested structure, when
 * present, sits behind one disclosure below the row.
 */
export function SchemaDisclosure({
  context,
  focusHref,
  idPrefix,
  label,
  view,
}: SchemaBlockProps & { readonly label: string }) {
  const frame: Frame = { context, focusHref, idPrefix };
  if (!hasChildren(view)) return null;
  return (
    <details className="schema schema-disclosure">
      <summary className="schema-disclosure__summary">
        {disclosureLabel(view)}
        <span className="visually-hidden"> of {label}</span>
      </summary>
      <div className="schema-children">
        <Notes frame={frame} view={view} />
        <Children frame={frame} view={view} />
      </div>
    </details>
  );
}

interface Frame {
  readonly context: SchemaContext;
  readonly focusHref: (locator: string) => string;
  readonly idPrefix: string;
}

/** The type line of a node: phrase, flags, constraints, description, enum. */
function SchemaLine({
  frame,
  view,
}: Readonly<{ frame: Frame; view: SchemaView }>) {
  return (
    <div className="schema-line">
      <TypePhrase frame={frame} view={view} />
      <Flags view={view} />
      {view.description === undefined ? null : (
        <SafeText
          className="schema-line__description"
          text={view.description}
        />
      )}
      <Details view={view} />
      <Notes frame={frame} view={view} />
    </div>
  );
}

function TypePhrase({
  frame,
  view,
}: Readonly<{ frame: Frame; view: SchemaView }>) {
  const named = view.name !== undefined && view.name !== view.label;
  return (
    <span className="schema-type">
      {view.kind === "cycle" ? (
        <span aria-hidden="true" className="schema-type__glyph">
          ↻{" "}
        </span>
      ) : null}
      <code className="schema-type__label">{view.label}</code>
      {named ? <span className="schema-type__name">{view.name}</span> : null}
      {view.kind === "cycle" ? (
        <>
          <span className="schema-type__note">recursive</span>
          <a className="schema-open" href={frame.focusHref(view.locator)}>
            Open {view.name ?? view.label}
            <span aria-hidden="true"> ↗</span>
          </a>
        </>
      ) : null}
      {view.kind === "truncated" ? (
        <>
          <span className="schema-type__note">
            {view.reason === "depth"
              ? "nested deeper than shown"
              : "more than shown here"}
          </span>
          <a className="schema-open" href={frame.focusHref(view.locator)}>
            Open {view.name ?? view.label}
            <span aria-hidden="true"> ↗</span>
          </a>
        </>
      ) : null}
      {view.reference !== undefined &&
      view.locator !== "" &&
      isOpenable(view) ? (
        <a className="schema-open" href={frame.focusHref(view.locator)}>
          Open {view.name ?? view.label}
          <span aria-hidden="true"> ↗</span>
        </a>
      ) : null}
    </span>
  );
}

function Flags({ view }: Readonly<{ view: SchemaView }>) {
  const flags = view.flags.filter((flag) => flag !== "nullable");
  if (flags.length === 0) return null;
  return (
    <span className="schema-flags">
      {flags.map((flag) => (
        <span
          className={`row__flag${flag === "deprecated" ? " row__flag--deprecated" : ""}`}
          key={flag}
        >
          {flag}
        </span>
      ))}
    </span>
  );
}

/** Constraints line and enumeration values. */
function Details({ view }: Readonly<{ view: SchemaView }>) {
  return (
    <>
      {view.constraints === undefined ? null : (
        <span className="row__constraints">{view.constraints}</span>
      )}
      {view.enumeration === undefined ? null : (
        <Enumeration enumeration={view.enumeration} />
      )}
    </>
  );
}

function Enumeration({
  enumeration,
}: Readonly<{ enumeration: NonNullable<SchemaView["enumeration"]> }>) {
  const total =
    enumeration.values.length + enumeration.more.length + enumeration.dropped;
  return (
    <div className="schema-enum">
      <span className="schema-enum__label">{countLabel(total, "value")}:</span>
      <ul aria-label="Allowed values" className="schema-enum__values">
        {enumeration.values.map((value, index) => (
          <li className="schema-enum__value" key={index}>
            {value}
          </li>
        ))}
      </ul>
      {enumeration.more.length === 0 ? null : (
        <details className="schema-enum__more">
          <summary>
            Show {countLabel(enumeration.more.length, "more value")}
          </summary>
          <ul aria-label="More allowed values" className="schema-enum__values">
            {enumeration.more.map((value, index) => (
              <li className="schema-enum__value" key={index}>
                {value}
              </li>
            ))}
          </ul>
        </details>
      )}
      {enumeration.dropped === 0 ? null : (
        <span className="schema-note">
          {countLabel(enumeration.dropped, "further value")} not listed here.
        </span>
      )}
    </div>
  );
}

/** Semantic notes: special forms, omitted fields, additional properties. */
function Notes({ frame, view }: Readonly<{ frame: Frame; view: SchemaView }>) {
  const notes: ReactNode[] = [];
  if (view.kind === "value") {
    const note = valueNote(view);
    if (note !== undefined) notes.push(<span key="value">{note}</span>);
  }
  if (view.kind === "object") {
    if (view.typeLess) {
      notes.push(
        <span key="type-less">
          No type is declared; these keywords apply only when the value is an
          object.
        </span>,
      );
    }
    if (view.omitted !== undefined) {
      notes.push(
        <span key="omitted">
          {frame.context === "request"
            ? "Not sent in requests"
            : "Not returned in responses"}{" "}
          ({view.omitted.reason}):{" "}
          {view.omitted.names.map((name, index) => (
            <span key={index}>
              {index > 0 ? ", " : ""}
              <code>{name}</code>
            </span>
          ))}
        </span>,
      );
    }
    // OpenAPI's default is permissive, so "allowed" is only worth saying when
    // there are no declared properties at all; "forbidden" is always said.
    if (view.additional === "none") {
      notes.push(
        <span key="closed">No additional properties are allowed.</span>,
      );
    } else if (
      view.additional === "any" &&
      view.properties.length + view.hidden.length + view.more === 0
    ) {
      notes.push(
        <span key="open">Any properties are allowed; none are declared.</span>,
      );
    }
  }
  if (view.kind === "array" && view.typeLess) {
    notes.push(
      <span key="type-less">
        No type is declared; these keywords apply only when the value is an
        array.
      </span>,
    );
  }
  if (
    view.kind === "tuple" &&
    view.rest !== "none" &&
    typeof view.rest !== "object"
  ) {
    notes.push(<span key="rest">Further items of any type are allowed.</span>);
  }
  if (notes.length === 0) return null;
  return (
    <p className="schema-note">
      {notes.map((note, index) => (
        <span key={index}>
          {index > 0 ? " " : ""}
          {note}
        </span>
      ))}
    </p>
  );
}

function valueNote(
  view: SchemaView & { readonly kind: "value" },
): ReactNode | undefined {
  switch (view.valueKind) {
    case "any":
      return "Free-form: no constraints are declared.";
    case "true":
      return (
        <>
          Explicit <code>true</code> schema: any value is allowed.
        </>
      );
    case "false":
      return (
        <>
          Explicit <code>false</code> schema: no value is allowed.
        </>
      );
    case "type-less":
      // A bare `const` or `enum` already says everything; only keyword-only
      // constraint sets need the applicability note.
      if (view.enumeration !== undefined || view.label === "constant") {
        return undefined;
      }
      return view.applicableTypes === undefined ||
        view.applicableTypes.length === 0
        ? "No type is declared."
        : `No type is declared; the constraints apply to ${listPhrase(view.applicableTypes)} values.`;
    case "unknown":
      return view.reason === "unresolved"
        ? "The reference could not be resolved; see the build diagnostics."
        : view.reason === "invalid"
          ? "The source schema is invalid; see the build diagnostics."
          : "This schema uses vocabulary Specra does not represent yet; see the build diagnostics.";
    default:
      return undefined;
  }
}

function listPhrase(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")}, or ${items.at(-1)}`;
}

/** The first level of a node, rendered open. */
function Children({
  frame,
  view,
}: Readonly<{ frame: Frame; view: SchemaView }>) {
  switch (view.kind) {
    case "object":
      return <ObjectChildren frame={frame} view={view} />;
    case "array":
      return (
        <ul className="schema-rows">
          <Row frame={frame} label="items" view={view.items} />
          {view.contains === undefined ? null : (
            <Row frame={frame} label="contains" view={view.contains} />
          )}
        </ul>
      );
    case "tuple":
      return (
        <ul className="schema-rows">
          {view.slots.map((slot, index) => (
            <Row
              frame={frame}
              key={slot.locator}
              label={`item ${index}`}
              view={slot}
            />
          ))}
          {typeof view.rest === "object" ? (
            <Row frame={frame} label="further items" view={view.rest} />
          ) : null}
        </ul>
      );
    case "composition":
      return <CompositionChildren frame={frame} view={view} />;
    case "not":
      return (
        <ul className="schema-rows">
          <Row frame={frame} label="must not match" view={view.schema} />
        </ul>
      );
    default:
      return null;
  }
}

function ObjectChildren({
  frame,
  view,
}: Readonly<{ frame: Frame; view: SchemaView & { readonly kind: "object" } }>) {
  const total = view.properties.length + view.hidden.length + view.more;
  // An empty object is explained by its notes ("Any properties are allowed;
  // none are declared." or the omission sentence), not by an extra line.
  if (total === 0 && typeof view.additional !== "object") return null;
  return (
    <>
      {view.properties.length === 0 ? null : (
        <ul className="schema-rows">
          {view.properties.map((property) => (
            <PropertyRow
              frame={frame}
              key={property.schema.locator}
              property={property}
            />
          ))}
        </ul>
      )}
      {view.hidden.length === 0 ? null : (
        <details className="schema-more">
          <summary className="schema-more__summary">
            Show {plural(view.hidden.length, "more property")}
          </summary>
          <ul className="schema-rows">
            {view.hidden.map((property) => (
              <PropertyRow
                frame={frame}
                key={property.schema.locator}
                property={property}
              />
            ))}
          </ul>
        </details>
      )}
      {view.more === 0 ? null : (
        <p className="schema-note">
          {plural(view.more, "further property")} not shown here.{" "}
          <a className="schema-open" href={frame.focusHref(view.locator)}>
            Open all {plural(total, "property")}
            <span aria-hidden="true"> ↗</span>
          </a>
        </p>
      )}
      {typeof view.additional === "object" ? (
        <ul className="schema-rows">
          <Row
            frame={frame}
            label="additional properties"
            view={view.additional}
          />
        </ul>
      ) : null}
    </>
  );
}

function CompositionChildren({
  frame,
  view,
}: Readonly<{
  frame: Frame;
  view: SchemaView & { readonly kind: "composition" };
}>) {
  const intro =
    view.mode === "oneOf"
      ? "Exactly one of the following:"
      : view.mode === "anyOf"
        ? "One or more of the following (any combination):"
        : "All of the following, combined:";
  const noun =
    view.mode === "allOf"
      ? "part"
      : view.mode === "oneOf"
        ? "variant"
        : "option";
  return (
    <div className="schema-composition" data-mode={view.mode}>
      <p className="schema-composition__intro">{intro}</p>
      {view.discriminator === undefined ? null : (
        <p className="schema-discriminator">
          Selected by <code>{view.discriminator.propertyName}</code>:{" "}
          {view.discriminator.mapping.map((entry, index) => (
            <span className="schema-discriminator__entry" key={entry.value}>
              {index > 0 ? ", " : ""}
              <code>{entry.value}</code>
              <span aria-hidden="true"> → </span>
              <span className="visually-hidden"> selects </span>
              {entry.locator === undefined ? (
                entry.label
              ) : (
                <a href={`#${variantId(frame, entry.locator)}`}>
                  {entry.label}
                </a>
              )}
            </span>
          ))}
        </p>
      )}
      <ol className="schema-variants">
        {view.variants.map((variant, index) => (
          <li className="schema-variant" key={variant.schema.locator}>
            <details
              className="schema-variant__details"
              id={variantId(frame, variant.schema.locator)}
              {...(view.mode === "allOf" ? { open: true } : {})}
            >
              <summary className="schema-variant__summary">
                <span className="schema-variant__index">
                  {noun} {index + 1}
                </span>
                <code className="schema-variant__label">{variant.label}</code>
                {variant.label === variant.schema.label ? null : (
                  <span className="row__type">{variant.schema.label}</span>
                )}
                {variant.values.length === 0 ? null : (
                  <span className="schema-variant__values">
                    {variant.values.map((value) => (
                      <code key={value}>{value}</code>
                    ))}
                  </span>
                )}
              </summary>
              <div className="schema-children">
                {variant.schema.description === undefined ? null : (
                  <SafeText
                    className="schema-line__description"
                    text={variant.schema.description}
                  />
                )}
                <Details view={variant.schema} />
                <Notes frame={frame} view={variant.schema} />
                <Children frame={frame} view={variant.schema} />
              </div>
            </details>
          </li>
        ))}
      </ol>
      {view.more === 0 ? null : (
        <p className="schema-note">
          {countLabel(view.more, `further ${noun}`)} not shown here.{" "}
          <a className="schema-open" href={frame.focusHref(view.locator)}>
            Open all {countLabel(view.variants.length + view.more, noun)}
            <span aria-hidden="true"> ↗</span>
          </a>
        </p>
      )}
    </div>
  );
}

function variantId(frame: Frame, locator: string): string {
  return `${frame.idPrefix}--${locator.replaceAll(".", "-")}`;
}

function PropertyRow({
  frame,
  property,
}: Readonly<{ frame: Frame; property: PropertyView }>) {
  return (
    <Row
      frame={frame}
      label={property.name}
      name
      required={property.required}
      view={property.schema}
    />
  );
}

/**
 * One row: key column (name, type phrase, flags), value column (description,
 * constraints, enumeration, notes), then a disclosure for nested structure.
 */
function Row({
  frame,
  label,
  name = false,
  required,
  view,
}: Readonly<{
  frame: Frame;
  label: string;
  /** True when `label` is a property name rather than a structural role. */
  name?: boolean;
  required?: boolean;
  view: SchemaView;
}>) {
  const deprecated = view.flags.includes("deprecated");
  const expandable = hasChildren(view);
  return (
    <li className="schema-row">
      <div className="row schema-row__grid">
        <div className="row__key">
          {name ? (
            <code
              className={`row__name${deprecated ? " row__name--deprecated" : ""}`}
            >
              {label}
            </code>
          ) : (
            <span className="row__name schema-row__role">{label}</span>
          )}
          <span className="row__type">
            <TypePhrase frame={frame} view={view} />
          </span>
          {required === undefined ? null : (
            <span
              className={`row__flag${required ? " row__flag--required" : ""}`}
            >
              {required ? "required" : "optional"}
            </span>
          )}
          <Flags view={view} />
        </div>
        <div className="row__value">
          {view.description === undefined ? null : (
            <SafeText className="row__description" text={view.description} />
          )}
          <Details view={view} />
          <Notes frame={frame} view={view} />
        </div>
      </div>
      {expandable ? (
        <details className="schema-disclosure">
          <summary className="schema-disclosure__summary">
            {disclosureLabel(view)}
            <span className="visually-hidden"> of {label}</span>
          </summary>
          <div className="schema-children">
            <Children frame={frame} view={view} />
          </div>
        </details>
      ) : null}
    </li>
  );
}

/** Whether a node has structure worth a disclosure below its row. */
export function hasChildren(view: SchemaView): boolean {
  switch (view.kind) {
    case "object":
      return (
        view.properties.length + view.hidden.length + view.more > 0 ||
        typeof view.additional === "object"
      );
    case "array":
      return (
        view.contains !== undefined ||
        hasChildren(view.items) ||
        view.items.description !== undefined ||
        view.items.constraints !== undefined ||
        view.items.enumeration !== undefined ||
        view.items.kind === "cycle" ||
        view.items.kind === "truncated"
      );
    case "tuple":
    case "composition":
    case "not":
      return true;
    default:
      return false;
  }
}

function isOpenable(view: SchemaView): boolean {
  return (
    view.kind === "object" ||
    view.kind === "array" ||
    view.kind === "tuple" ||
    view.kind === "composition" ||
    view.kind === "not"
  );
}

/** `countLabel` with the irregular plural the schema vocabulary needs. */
function plural(count: number, noun: string): string {
  return countLabel(count, noun).replace(/propertys$/, "properties");
}

/** Concise disclosure text; the property name is appended visually hidden. */
function disclosureLabel(view: SchemaView): string {
  switch (view.kind) {
    case "object": {
      const total = view.properties.length + view.hidden.length + view.more;
      return total === 0 ? "additional properties" : plural(total, "property");
    }
    case "array":
      return "items";
    case "tuple":
      return countLabel(view.slots.length, "item");
    case "composition":
      return countLabel(
        view.variants.length + view.more,
        view.mode === "allOf"
          ? "part"
          : view.mode === "oneOf"
            ? "variant"
            : "option",
      );
    case "not":
      return "excluded schema";
    default:
      return "details";
  }
}
