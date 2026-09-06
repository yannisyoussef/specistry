"use client";

import {
  buildRequest,
  createCredentialVault,
  executeRequest,
  parameterKey,
  RESULT_MESSAGES,
  schemeKey,
  type BuildResult,
  type CredentialValue,
  type FormValues,
  type ParameterField,
  type PlaygroundResult,
  type ValidationError,
} from "@specra/playground/client";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";

import type { PlaygroundView } from "../../../lib/reader/playground-view";
import { CopyButton } from "../copy-button";

/**
 * Try it (SPEC-009): one explicit Send per request against the selected
 * approved environment. Credentials live in a memory-only vault keyed by
 * environment and scheme; parameters and bodies are React state; the only
 * persisted value is the non-secret environment id (sessionStorage). A
 * request is snapshotted before fetch, carries an id so a late result
 * cannot overwrite a newer one, and can be cancelled with the same
 * controller the timeout uses.
 */

const ENVIRONMENT_KEY = "specra:playground-environment";

type Phase =
  | { readonly kind: "idle" }
  | {
      readonly kind: "sending";
      readonly id: number;
      readonly controller: AbortController;
      readonly startedAt: number;
    }
  | {
      readonly kind: "done";
      readonly id: number;
      readonly result: PlaygroundResult;
      readonly method: string;
    };

function readEnvironment(view: PlaygroundView): string {
  try {
    const stored = window.sessionStorage.getItem(ENVIRONMENT_KEY);
    if (
      stored !== null &&
      view.environments.some((environment) => environment.id === stored)
    ) {
      return stored;
    }
  } catch {
    // Storage may be unavailable.
  }
  return view.environments[0]?.id ?? "";
}

function storeEnvironment(id: string): void {
  try {
    window.sessionStorage.setItem(ENVIRONMENT_KEY, id);
  } catch {
    // Storage may be unavailable; the choice then lasts for the page only.
  }
}

function initialParameters(
  fields: readonly ParameterField[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields) values[parameterKey(field)] = field.initial;
  return values;
}

export default function TryIt({ view }: Readonly<{ view: PlaygroundView }>) {
  const id = useId();
  const { form, limits } = view;
  // State, not a ref: the vault object is stable and read during render.
  const [vault] = useState(() => createCredentialVault());
  const [files] = useState(() => new Map<string, File>());
  const nextId = useRef(0);
  const [vaultVersion, setVaultVersion] = useState(0);
  const [environmentId, setEnvironmentId] = useState(() =>
    readEnvironment(view),
  );
  const [parameters, setParameters] = useState(() =>
    initialParameters(form.parameters),
  );
  const [bodyMediaType, setBodyMediaType] = useState(form.bodies[0]?.mediaType);
  const [bodyText, setBodyText] = useState(form.bodies[0]?.initial ?? "");
  const [bodyFields, setBodyFields] = useState<Record<string, string>>(() => {
    const values: Record<string, string> = {};
    for (const field of form.bodies[0]?.fields ?? [])
      values[field.name] = field.initial;
    return values;
  });
  const [filesVersion, setFilesVersion] = useState(0);
  const [authAlternative, setAuthAlternative] = useState(() =>
    Math.max(
      0,
      form.auth.findIndex((alternative) => alternative.supported),
    ),
  );
  const [submitted, setSubmitted] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [announcement, setAnnouncement] = useState("");

  const environment = view.environments.find(
    (candidate) => candidate.id === environmentId,
  );
  const body =
    form.bodies.find((candidate) => candidate.mediaType === bodyMediaType) ??
    form.bodies[0];
  const values: FormValues = useMemo(
    () => ({
      authAlternative,
      bodyFields,
      bodyMediaType,
      bodyText,
      files: Object.fromEntries(files),
      parameters,
    }),
    // filesVersion and vaultVersion invalidate the memo when refs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      authAlternative,
      bodyFields,
      bodyMediaType,
      bodyText,
      parameters,
      filesVersion,
      vaultVersion,
    ],
  );
  const built: BuildResult = useMemo(
    () => buildRequest(form, environment, values, vault, limits),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, environment, values, limits, vaultVersion],
  );
  const errors: readonly ValidationError[] = built.ok ? [] : built.errors;
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;
  const sending = phase.kind === "sending";

  const send = () => {
    setSubmitted(true);
    if (!built.ok || sending) {
      const first = document.querySelector<HTMLElement>(
        `[data-playground-error]`,
      );
      first?.focus();
      return;
    }
    const requestId = (nextId.current += 1);
    const controller = new AbortController();
    const snapshot = built.request;
    setPhase({
      controller,
      id: requestId,
      kind: "sending",
      startedAt: performance.now(),
    });
    setAnnouncement("Sending request.");
    void executeRequest(snapshot, { limits, signal: controller.signal }).then(
      (result) => {
        // A cancelled or superseded request never overwrites a newer one.
        setPhase((current) =>
          current.kind === "sending" && current.id === requestId
            ? { id: requestId, kind: "done", method: snapshot.method, result }
            : current,
        );
        if (nextId.current === requestId && !controller.signal.aborted) {
          setAnnouncement(
            result.state === "ok"
              ? `Request complete. ${[result.status, result.statusText].filter((part) => part !== undefined && part !== "").join(" ")}.`
              : (result.message ?? "Request finished."),
          );
        }
      },
    );
  };

  const cancel = () => {
    if (phase.kind !== "sending") return;
    phase.controller.abort();
    // Immediate feedback: the executor's eventual result carries this id
    // but the phase is no longer "sending", so it is discarded.
    setPhase({
      id: phase.id,
      kind: "done",
      method: form.method,
      result: {
        durationMs: performance.now() - phase.startedAt,
        headers: [],
        message: RESULT_MESSAGES.cancelled,
        state: "cancelled",
      },
    });
    setAnnouncement(RESULT_MESSAGES.cancelled);
  };

  const setCredential = (schemeKeyValue: string, patch: CredentialValue) => {
    const current = vault.get(environmentId, schemeKeyValue) ?? {};
    vault.set(environmentId, schemeKeyValue, { ...current, ...patch });
    setVaultVersion((version) => version + 1);
  };

  const clearCredentials = () => {
    vault.clear();
    setVaultVersion((version) => version + 1);
    setAnnouncement("Credentials cleared.");
  };

  if (form.capability.state === "unsupported") {
    return (
      <div className="try-it try-it--unsupported">
        <p className="try-it__lead">
          This operation cannot be executed from the browser.
        </p>
        <ul className="try-it__reasons">
          {view.unsupported.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p className="code-rail__note">The code examples remain available.</p>
      </div>
    );
  }

  const alternative = form.auth[authAlternative];
  return (
    <form
      aria-labelledby={`${id}-title`}
      className="try-it"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <h3 className="visually-hidden" id={`${id}-title`}>
        Try it
      </h3>

      <div className="try-it__row">
        <label className="try-it__field" htmlFor={`${id}-environment`}>
          <span className="try-it__label">Environment</span>
          <select
            className="try-it__select"
            id={`${id}-environment`}
            onChange={(event) => {
              // A response belongs to the environment it came from: switching
              // clears it, and an in-flight request is cancelled.
              if (phase.kind === "sending") phase.controller.abort();
              setPhase({ kind: "idle" });
              setEnvironmentId(event.target.value);
              storeEnvironment(event.target.value);
              setSubmitted(false);
            }}
            value={environmentId}
          >
            {view.environments.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        {environment === undefined ? null : (
          <p className="try-it__destination">
            <span className="visually-hidden">Destination </span>
            <code>{environment.origin}</code>
            {environment.loopback ? (
              <span className="try-it__flag"> local</span>
            ) : null}
          </p>
        )}
      </div>

      {form.auth.length === 0 ? null : (
        <fieldset className="try-it__group">
          <legend className="try-it__label">Authentication</legend>
          {form.auth.filter((candidate) => candidate.supported).length > 1 ? (
            <select
              aria-label="Authentication method"
              className="try-it__select"
              onChange={(event) =>
                setAuthAlternative(Number(event.target.value))
              }
              value={authAlternative}
            >
              {form.auth.map((candidate, index) =>
                candidate.supported ? (
                  <option key={candidate.label} value={index}>
                    {candidate.label}
                  </option>
                ) : null,
              )}
            </select>
          ) : null}
          {alternative === undefined || !alternative.supported ? (
            <p className="try-it__hint">
              No browser-usable authentication method is available.
            </p>
          ) : (
            alternative.schemes.map((scheme) => {
              const key = schemeKey(scheme);
              const stored = vault.get(environmentId, key) ?? {};
              const error = submitted ? errorFor(`auth:${key}`) : undefined;
              const secretProps = {
                autoCapitalize: "off",
                autoComplete: "off",
                autoCorrect: "off",
                className: "try-it__input try-it__input--secret",
                spellCheck: false,
                type: revealed[key] ? "text" : "password",
              } as const;
              if (scheme.kind === "basic") {
                return (
                  <div className="try-it__credential" key={key}>
                    <label
                      className="try-it__field"
                      htmlFor={`${id}-${key}-user`}
                    >
                      <span className="try-it__name">Username</span>
                      <input
                        autoComplete="off"
                        className="try-it__input"
                        id={`${id}-${key}-user`}
                        onChange={(event) =>
                          setCredential(key, { username: event.target.value })
                        }
                        type="text"
                        value={stored.username ?? ""}
                      />
                    </label>
                    <label
                      className="try-it__field"
                      htmlFor={`${id}-${key}-password`}
                    >
                      <span className="try-it__name">Password</span>
                      <input
                        {...secretProps}
                        aria-describedby={
                          error === undefined ? undefined : `${id}-${key}-error`
                        }
                        aria-invalid={error !== undefined}
                        id={`${id}-${key}-password`}
                        onChange={(event) =>
                          setCredential(key, { password: event.target.value })
                        }
                        value={stored.password ?? ""}
                      />
                    </label>
                    <RevealToggle
                      onToggle={() =>
                        setRevealed((current) => ({
                          ...current,
                          [key]: !current[key],
                        }))
                      }
                      revealed={revealed[key] ?? false}
                    />
                    <FieldError id={`${id}-${key}-error`} message={error} />
                  </div>
                );
              }
              const isToken = scheme.kind !== "apiKeyHeader";
              return (
                <div className="try-it__credential" key={key}>
                  <label className="try-it__field" htmlFor={`${id}-${key}`}>
                    <span className="try-it__name">{scheme.label}</span>
                    <input
                      {...secretProps}
                      aria-describedby={
                        error === undefined ? undefined : `${id}-${key}-error`
                      }
                      aria-invalid={error !== undefined}
                      id={`${id}-${key}`}
                      onChange={(event) =>
                        setCredential(
                          key,
                          isToken
                            ? { token: event.target.value }
                            : { apiKey: event.target.value },
                        )
                      }
                      value={(isToken ? stored.token : stored.apiKey) ?? ""}
                    />
                  </label>
                  <RevealToggle
                    onToggle={() =>
                      setRevealed((current) => ({
                        ...current,
                        [key]: !current[key],
                      }))
                    }
                    revealed={revealed[key] ?? false}
                  />
                  {scheme.scopes.length > 0 ? (
                    <p className="try-it__hint">
                      Scopes: {scheme.scopes.join(", ")}
                    </p>
                  ) : null}
                  <FieldError id={`${id}-${key}-error`} message={error} />
                </div>
              );
            })
          )}
          {view.unavailableAuth.length > 0 ? (
            <ul className="try-it__reasons">
              {view.unavailableAuth.map((entry) => (
                <li key={entry.label}>
                  <span className="try-it__unavailable">{entry.label}</span>{" "}
                  {entry.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {vault.size() > 0 ? (
            <button
              className="button button--ghost try-it__clear"
              onClick={clearCredentials}
              type="button"
            >
              Clear credentials
            </button>
          ) : null}
        </fieldset>
      )}

      {(["path", "query", "header"] as const).map((location) => {
        const fields = form.parameters.filter(
          (field) => field.location === location,
        );
        if (fields.length === 0) return null;
        return (
          <fieldset className="try-it__group" key={location}>
            <legend className="try-it__label">
              {location === "path"
                ? "Path parameters"
                : location === "query"
                  ? "Query parameters"
                  : "Header parameters"}
            </legend>
            {fields.map((field) => (
              <ParameterInput
                error={
                  submitted
                    ? errorFor(`parameter:${parameterKey(field)}`)
                    : undefined
                }
                field={field}
                id={`${id}-${location}-${field.name}`}
                key={field.name}
                onChange={(value) =>
                  setParameters((current) => ({
                    ...current,
                    [parameterKey(field)]: value,
                  }))
                }
                value={parameters[parameterKey(field)] ?? ""}
              />
            ))}
          </fieldset>
        );
      })}
      {form.parameters.some((field) => field.location === "cookie") ? (
        <p className="try-it__hint">
          Cookie parameters cannot be set from browser JavaScript and are not
          sent.
        </p>
      ) : null}

      {body === undefined ? null : (
        <fieldset className="try-it__group">
          <legend className="try-it__label">Request body</legend>
          {form.bodies.length > 1 ? (
            <select
              aria-label="Body format"
              className="try-it__select"
              onChange={(event) => {
                const next = form.bodies.find(
                  (candidate) => candidate.mediaType === event.target.value,
                );
                setBodyMediaType(event.target.value);
                setBodyText(next?.initial ?? "");
                const nextFields: Record<string, string> = {};
                for (const field of next?.fields ?? [])
                  nextFields[field.name] = field.initial;
                setBodyFields(nextFields);
              }}
              value={body.mediaType}
            >
              {form.bodies.map((candidate) => (
                <option key={candidate.mediaType} value={candidate.mediaType}>
                  {candidate.mediaType}
                </option>
              ))}
            </select>
          ) : (
            <p className="try-it__hint">
              <code>{body.mediaType}</code>
            </p>
          )}
          {body.kind === "json" ||
          body.kind === "text" ||
          body.kind === "opaque" ? (
            <div className="try-it__field">
              <label className="visually-hidden" htmlFor={`${id}-body`}>
                Body
              </label>
              <textarea
                aria-describedby={
                  submitted && errorFor("body") !== undefined
                    ? `${id}-body-error`
                    : undefined
                }
                aria-invalid={submitted && errorFor("body") !== undefined}
                className="try-it__textarea"
                id={`${id}-body`}
                onChange={(event) => setBodyText(event.target.value)}
                rows={Math.min(
                  14,
                  Math.max(4, bodyText.split("\n").length + 1),
                )}
                spellCheck={false}
                value={bodyText}
              />
              <FieldError
                id={`${id}-body-error`}
                message={submitted ? errorFor("body") : undefined}
              />
            </div>
          ) : null}
          {body.kind === "form" || body.kind === "multipart"
            ? body.fields.map((field) => {
                const fieldError = submitted
                  ? errorFor(`body:${field.name}`)
                  : undefined;
                const errorProps = {
                  "aria-describedby":
                    fieldError === undefined
                      ? undefined
                      : `${id}-field-${field.name}-error`,
                  "aria-invalid": fieldError !== undefined,
                } as const;
                return (
                  <label
                    className="try-it__field"
                    htmlFor={`${id}-field-${field.name}`}
                    key={field.name}
                  >
                    <span className="try-it__name">
                      {field.name}
                      {field.required ? (
                        <span className="try-it__required"> required</span>
                      ) : null}
                    </span>
                    {field.file ? (
                      <input
                        {...errorProps}
                        className="try-it__input"
                        id={`${id}-field-${field.name}`}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file === undefined) files.delete(field.name);
                          else files.set(field.name, file);
                          setFilesVersion((version) => version + 1);
                        }}
                        type="file"
                      />
                    ) : (
                      <input
                        {...errorProps}
                        className="try-it__input"
                        id={`${id}-field-${field.name}`}
                        onChange={(event) =>
                          setBodyFields((current) => ({
                            ...current,
                            [field.name]: event.target.value,
                          }))
                        }
                        type="text"
                        value={bodyFields[field.name] ?? ""}
                      />
                    )}
                    <FieldError
                      id={`${id}-field-${field.name}-error`}
                      message={fieldError}
                    />
                  </label>
                );
              })
            : null}
          {body.kind === "binary" ? (
            <label className="try-it__field" htmlFor={`${id}-body-file`}>
              <span className="try-it__label">File</span>
              <input
                className="try-it__input"
                id={`${id}-body-file`}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file === undefined) files.delete("body");
                  else files.set("body", file);
                  setFilesVersion((version) => version + 1);
                }}
                type="file"
              />
              <FieldError
                id={`${id}-body-error`}
                message={submitted ? errorFor("body") : undefined}
              />
            </label>
          ) : null}
        </fieldset>
      )}

      <section
        aria-labelledby={`${id}-preview-title`}
        className="try-it__preview"
      >
        <h4 className="try-it__label" id={`${id}-preview-title`}>
          Request preview
        </h4>
        {built.ok ? (
          <pre className="code-surface try-it__pre" tabIndex={0}>
            <code>
              {`${built.preview.method} ${built.preview.url}\n`}
              {built.preview.headers
                .map((header) => `${header.name}: ${header.value}\n`)
                .join("")}
              {`\n${built.preview.body}`}
            </code>
          </pre>
        ) : (
          <p className="try-it__hint">
            Complete the form to preview the request.
          </p>
        )}
        {submitted &&
        errors.some(
          (error) =>
            error.field === "destination" ||
            error.field === "auth" ||
            error.field === "headers" ||
            error.field === "capability",
        ) ? (
          <ul className="try-it__errors" data-playground-error tabIndex={-1}>
            {errors
              .filter(
                (error) =>
                  error.field === "destination" ||
                  error.field === "auth" ||
                  error.field === "headers" ||
                  error.field === "capability",
              )
              .map((error) => (
                <li key={`${error.field}:${error.message}`}>{error.message}</li>
              ))}
          </ul>
        ) : null}
      </section>

      <div className="try-it__actions">
        <button
          className="button button--primary try-it__send"
          disabled={sending}
          type="submit"
        >
          {sending ? "Sending…" : `Send ${form.method} request`}
        </button>
        {sending ? (
          <button
            className="button try-it__cancel"
            onClick={cancel}
            type="button"
          >
            Cancel
          </button>
        ) : null}
        {environment !== undefined &&
        !environment.loopback &&
        /^(?:POST|PUT|PATCH|DELETE)$/.test(form.method) ? (
          <span className="try-it__hint">
            Sends a real {form.method} to {environment.label}.
          </span>
        ) : null}
      </div>
      <p
        aria-live="polite"
        className="visually-hidden try-it__announcer"
        role="status"
      >
        {announcement}
      </p>

      {phase.kind === "sending" ? (
        <div className="try-it__response try-it__response--pending">
          <p className="try-it__status">Sending request…</p>
          <div aria-hidden="true" className="try-it__sweep" />
        </div>
      ) : null}
      {phase.kind === "done" ? (
        <ResponseView id={id} result={phase.result} />
      ) : null}
      <p className="code-rail__note">
        Requests go directly from your browser to the selected environment;
        Specra does not proxy them, and credentials stay in this page&apos;s
        memory. Cancelling stops waiting for the response; it does not undo a
        request the API already received.
      </p>
    </form>
  );
}

function RevealToggle({
  onToggle,
  revealed,
}: Readonly<{ onToggle: () => void; revealed: boolean }>) {
  return (
    <button
      aria-pressed={revealed}
      className="button button--ghost try-it__reveal"
      onClick={onToggle}
      type="button"
    >
      {revealed ? "Hide" : "Show"}
    </button>
  );
}

function FieldError({
  id,
  message,
}: Readonly<{ id: string; message: string | undefined }>) {
  if (message === undefined) return null;
  return (
    <span className="try-it__error" data-playground-error id={id} tabIndex={-1}>
      {message}
    </span>
  );
}

function ParameterInput({
  error,
  field,
  id,
  onChange,
  value,
}: Readonly<{
  error: string | undefined;
  field: ParameterField;
  id: string;
  onChange: (value: string) => void;
  value: string;
}>) {
  const describedBy = [
    field.description === undefined ? undefined : `${id}-description`,
    error === undefined ? undefined : `${id}-error`,
  ]
    .filter((entry) => entry !== undefined)
    .join(" ");
  const unsupported = field.capability === "unsupported";
  const shared = {
    "aria-describedby": describedBy === "" ? undefined : describedBy,
    "aria-invalid": error !== undefined,
    "aria-required": field.required,
    disabled: unsupported,
    id,
  } as const;
  let control: ReactNode;
  if (field.kind === "enum" && field.options !== undefined) {
    control = (
      <select
        {...shared}
        className="try-it__select"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {field.required ? null : <option value="">(omit)</option>}
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (field.kind === "boolean") {
    control = (
      <select
        {...shared}
        className="try-it__select"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {field.required ? null : <option value="">(omit)</option>}
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  } else if (field.kind === "json" || field.array) {
    control = (
      <textarea
        {...shared}
        className="try-it__textarea"
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        spellCheck={false}
        value={value}
      />
    );
  } else {
    control = (
      <input
        {...shared}
        className="try-it__input"
        inputMode={
          field.kind === "integer" || field.kind === "number"
            ? "decimal"
            : undefined
        }
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={value}
      />
    );
  }
  return (
    <div className="try-it__field">
      <label className="try-it__name" htmlFor={id}>
        {field.label}
        <span className="try-it__meta">
          {" "}
          {field.kind === "json" || field.array ? "JSON" : field.kind}
        </span>
        {field.required ? (
          <span className="try-it__required"> required</span>
        ) : null}
      </label>
      {control}
      {field.description === undefined ? null : (
        <span className="try-it__hint" id={`${id}-description`}>
          {field.description}
        </span>
      )}
      {unsupported ? (
        <span className="try-it__hint">
          Browsers cannot set this header; it is not sent.
        </span>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function ResponseView({
  id,
  result,
}: Readonly<{ id: string; result: PlaygroundResult }>) {
  const duration = `${Math.round(result.durationMs)} ms`;
  if (result.state !== "ok") {
    return (
      <section
        aria-labelledby={`${id}-response-title`}
        className="try-it__response try-it__response--error"
      >
        <h4 className="try-it__label" id={`${id}-response-title`}>
          Response
        </h4>
        <p className="try-it__status">
          <span aria-hidden="true">✕ </span>
          {result.state === "timeout"
            ? "Timed out"
            : result.state === "cancelled"
              ? "Cancelled"
              : result.state === "redirect-blocked"
                ? "Redirect blocked"
                : "Request failed"}
          <span className="try-it__meta"> · {duration}</span>
        </p>
        <p className="try-it__hint">{result.message}</p>
        {result.state === "network-failure" ? (
          <p className="try-it__hint">
            The API must allow this documentation origin with CORS (
            <code>Access-Control-Allow-Origin</code>, and
            <code> Access-Control-Allow-Headers</code> for custom headers);
            browsers report CORS refusals as a generic failure.
          </p>
        ) : null}
      </section>
    );
  }
  const body = result.body;
  const status = `${result.status ?? ""} ${result.statusText ?? ""}`.trim();
  const tone =
    (result.status ?? 0) >= 500
      ? "danger"
      : (result.status ?? 0) >= 400
        ? "warning"
        : (result.status ?? 0) >= 300
          ? "info"
          : "success";
  const bytes = body === undefined ? 0 : body.bytes;
  const showBody =
    body !== undefined &&
    (body.kind === "json" || body.kind === "text") &&
    body.text.length > 0;
  return (
    <section
      aria-labelledby={`${id}-response-title`}
      className="try-it__response"
    >
      <h4 className="visually-hidden" id={`${id}-response-title`}>
        Response
      </h4>
      <p className="try-it__status">
        <span className={`try-it__code try-it__code--${tone}`}>{status}</span>
        <span className="try-it__meta">
          {" "}
          · {duration} · {bytes} B
        </span>
      </p>
      {result.headers.length > 0 ? (
        <details className="try-it__headers">
          <summary>Headers ({result.headers.length})</summary>
          <dl className="try-it__header-list">
            {result.headers.map((header) => (
              <div className="try-it__header" key={header.name}>
                <dt>{header.name}</dt>
                <dd>{header.value}</dd>
              </div>
            ))}
          </dl>
          <p className="try-it__hint">
            Only headers the API exposes to browsers (
            <code>Access-Control-Expose-Headers</code>) are listed.
          </p>
        </details>
      ) : null}
      {body === undefined || body.kind === "empty" ? (
        <p className="try-it__hint">Empty body — the status is the content.</p>
      ) : body.kind === "binary" ? (
        <p className="try-it__hint">
          Binary response · <code>{body.contentType || "unknown type"}</code> ·{" "}
          {body.bytes} bytes received · preview omitted
        </p>
      ) : showBody ? (
        <div className="try-it__body">
          <div className="code-block__header">
            <span className="code-block__title">
              {body.kind === "json" ? "JSON" : body.contentType || "text"}
              {body.truncated ? " · partial" : ""}
            </span>
            <CopyButton
              label="Copy"
              name={
                body.truncated
                  ? "Copy partial response body"
                  : "Copy response body"
              }
              value={body.text}
            />
          </div>
          <pre
            aria-label="Response body"
            className="code-surface try-it__pre"
            role="group"
            tabIndex={0}
          >
            <code>{body.text}</code>
          </pre>
        </div>
      ) : null}
      {body?.truncated ? (
        <p className="try-it__limit" role="note">
          Response body exceeded the playground display limit; only the first{" "}
          {body.bytes} bytes are shown.
        </p>
      ) : null}
    </section>
  );
}
