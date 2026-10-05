import type { JsonValue } from "@specra/model";
import {
  encodeQueryValue,
  isToken,
  renderPathTemplate,
  serializeHeaderParameter,
  serializePathParameter,
  serializeQueryParameter,
  type Pair,
  type PathSerialization,
  type QuerySerialization,
} from "@specra/snippets/protocol";

import {
  isForbiddenRequestHeader,
  type AuthAlternativeForm,
  type BodyForm,
  type OperationForm,
  type ParameterField,
  type PlaygroundEnvironment,
  type PlaygroundLimits,
} from "../types.js";
import {
  schemeKey,
  type CredentialValue,
  type CredentialVault,
} from "./credentials.js";
import { composeDestination, DESTINATION_MESSAGES } from "./destination.js";
import { redactHeaders } from "./redact.js";

/**
 * Request builder (SPEC-009 §53–§68): user values plus the form projection
 * and the in-memory credentials become exactly one validated, executable
 * request through the shared SPEC-008 serializer. Every blocking condition
 * is returned as a field-addressed error; nothing is sent from here.
 */

export interface FormValues {
  /** Keyed `${location}:${name}`; arrays/objects/content-typed values are JSON text. */
  readonly parameters: Readonly<Record<string, string>>;
  readonly bodyMediaType?: string | undefined;
  readonly bodyText: string;
  readonly bodyFields: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, Blob | undefined>>;
  readonly authAlternative: number;
}

export interface ValidationError {
  /** `parameter:<location>:<name>`, `body`, `body:<field>`, `auth:<schemeKey>`, `destination`, `capability`. */
  readonly field: string;
  readonly message: string;
}

export type ExecutableBody =
  | {
      readonly kind: "text";
      readonly text: string;
      readonly contentType: string;
    }
  | {
      readonly kind: "form";
      readonly text: string;
      readonly contentType: string;
    }
  | { readonly kind: "multipart"; readonly entries: readonly MultipartEntry[] }
  | {
      readonly kind: "binary";
      readonly blob: Blob;
      readonly contentType: string;
    };

export interface MultipartEntry {
  readonly name: string;
  readonly value: string | Blob;
  readonly fileName?: string;
}

/** The immutable snapshot that is sent; the preview is derived from it. */
export interface ExecutableRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: readonly Pair[];
  readonly body?: ExecutableBody;
  readonly environmentId: string;
}

export interface RequestPreview {
  readonly method: string;
  readonly url: string;
  /** Credential headers masked. */
  readonly headers: readonly Pair[];
  readonly body: string;
}

export type BuildResult =
  | {
      readonly ok: true;
      readonly request: ExecutableRequest;
      readonly preview: RequestPreview;
    }
  | { readonly ok: false; readonly errors: readonly ValidationError[] };

export function parameterKey(
  field: Pick<ParameterField, "location" | "name">,
): string {
  return `${field.location}:${field.name}`;
}

/** Whether an alternative can execute with the credentials the vault holds. */
export function alternativeReady(
  alternative: AuthAlternativeForm,
  vault: CredentialVault,
  environmentId: string,
): boolean {
  return (
    alternative.supported &&
    alternative.schemes.every((scheme) =>
      credentialComplete(
        scheme.kind,
        vault.get(environmentId, schemeKey(scheme)),
      ),
    )
  );
}

function credentialComplete(
  kind: string,
  value: CredentialValue | undefined,
): boolean {
  switch (kind) {
    case "bearer":
    case "oauth2":
    case "openIdConnect":
      return value?.token !== undefined;
    case "apiKeyHeader":
      return value?.apiKey !== undefined;
    case "basic":
      return value?.username !== undefined && value.password !== undefined;
    default:
      return false;
  }
}

export function buildRequest(
  form: OperationForm,
  environment: PlaygroundEnvironment | undefined,
  values: FormValues,
  vault: CredentialVault,
  limits: PlaygroundLimits,
): BuildResult {
  const errors: ValidationError[] = [];
  if (environment === undefined) {
    errors.push({
      field: "destination",
      message: "No live playground environment is configured.",
    });
  }
  if (form.capability.state === "unsupported") {
    errors.push({
      field: "capability",
      message: "This operation cannot be executed from the browser.",
    });
  }
  if (errors.length > 0 || environment === undefined)
    return { errors, ok: false };

  const pathValues = new Map<string, string>();
  const query: Pair[] = [];
  const headers: Pair[] = [];
  for (const field of form.parameters) {
    const raw = (values.parameters[parameterKey(field)] ?? "").trim();
    const key = `parameter:${parameterKey(field)}`;
    if (raw.length > limits.parameterLength) {
      errors.push({
        field: key,
        message: `${field.label} exceeds ${limits.parameterLength} characters.`,
      });
      continue;
    }
    if (raw === "") {
      if (field.required)
        errors.push({ field: key, message: `${field.label} is required.` });
      continue;
    }
    if (field.capability === "unsupported") {
      errors.push({
        field: key,
        message: `${field.label} cannot be sent from the browser.`,
      });
      continue;
    }
    const value = parseFieldValue(field, raw);
    if (value === undefined) {
      errors.push({
        field: key,
        message: `${field.label} must be valid ${field.kind === "json" || field.array ? "JSON" : field.kind}.`,
      });
      continue;
    }
    switch (field.location) {
      case "path":
        pathValues.set(
          field.name,
          serializePathParameter(
            field.name,
            value,
            field.serialization as PathSerialization,
          ),
        );
        break;
      case "query":
        query.push(
          ...serializeQueryParameter(
            field.name,
            value,
            field.serialization as QuerySerialization,
            field.contentTyped,
          ),
        );
        break;
      case "header": {
        const text = serializeHeaderParameter(
          value,
          field.serialization.explode,
        );
        if (!isToken(field.name) || isForbiddenRequestHeader(field.name)) {
          errors.push({
            field: key,
            message: `${field.label} is a header browsers do not allow scripts to set.`,
          });
        } else if (text.length > limits.headerValueLength) {
          errors.push({
            field: key,
            message: `${field.label} exceeds ${limits.headerValueLength} characters.`,
          });
        } else {
          headers.push({ name: field.name, value: text });
        }
        break;
      }
      case "cookie":
        errors.push({
          field: key,
          message: `${field.label} is a cookie, which browser JavaScript cannot set.`,
        });
        break;
    }
  }

  // Authentication: every scheme of the chosen alternative applies.
  const alternative = form.auth[values.authAlternative];
  if (form.auth.length > 0) {
    if (alternative === undefined || !alternative.supported) {
      errors.push({
        field: "auth",
        message: "Choose an authentication method the browser can use.",
      });
    } else {
      for (const scheme of alternative.schemes) {
        const credential = vault.get(environment.id, schemeKey(scheme));
        const field = `auth:${schemeKey(scheme)}`;
        switch (scheme.kind) {
          case "bearer":
          case "oauth2":
          case "openIdConnect":
            if (credential?.token === undefined)
              errors.push({ field, message: `${scheme.label} is required.` });
            else
              setHeader(headers, "Authorization", `Bearer ${credential.token}`);
            break;
          case "apiKeyHeader":
            if (credential?.apiKey === undefined)
              errors.push({ field, message: `${scheme.label} is required.` });
            else
              setHeader(headers, scheme.name ?? "X-API-Key", credential.apiKey);
            break;
          case "basic":
            if (
              credential?.username === undefined ||
              credential.password === undefined
            ) {
              errors.push({
                field,
                message: "Username and password are required.",
              });
            } else {
              setHeader(
                headers,
                "Authorization",
                `Basic ${encodeBase64(`${credential.username}:${credential.password}`)}`,
              );
            }
            break;
          default:
            errors.push({
              field,
              message: `${scheme.label} cannot be used from the browser.`,
            });
        }
      }
    }
  }

  // Body.
  let body: ExecutableBody | undefined;
  let bodySummary = "No body";
  const bodyForm =
    form.bodies.find(
      (candidate) => candidate.mediaType === values.bodyMediaType,
    ) ?? form.bodies[0];
  if (bodyForm !== undefined) {
    const built = buildBody(
      bodyForm,
      values,
      form.bodyRequired,
      limits,
      errors,
    );
    body = built.body;
    bodySummary = built.summary;
    if (body !== undefined && body.kind !== "multipart") {
      setHeader(headers, "Content-Type", body.contentType);
    }
  }

  if (headers.length > limits.headerCount) {
    errors.push({
      field: "headers",
      message: `At most ${limits.headerCount} headers can be sent.`,
    });
  }
  for (const header of headers) {
    if (
      /[\r\n\0]/.test(header.value) ||
      header.value.length > limits.headerValueLength
    ) {
      errors.push({
        field: "headers",
        message: `The ${header.name} header value is not allowed.`,
      });
    }
  }

  const path = renderPathTemplate(form.pathTemplate, pathValues);
  const destination = composeDestination(
    environment,
    path,
    query,
    limits.urlLength,
  );
  if (!destination.ok && destination.failure !== undefined) {
    errors.push({
      field: "destination",
      message: DESTINATION_MESSAGES[destination.failure],
    });
  }
  if (errors.length > 0) return { errors, ok: false };

  const request: ExecutableRequest = {
    ...(body === undefined ? {} : { body }),
    environmentId: environment.id,
    headers,
    method: form.method,
    url: destination.url,
  };
  return {
    ok: true,
    preview: {
      body: bodySummary,
      headers: redactHeaders(headers),
      method: form.method,
      url: destination.url,
    },
    request,
  };
}

function parseFieldValue(
  field: ParameterField,
  raw: string,
): JsonValue | undefined {
  if (field.kind === "json" || field.array || field.contentTyped) {
    try {
      const parsed = JSON.parse(raw) as JsonValue;
      if (field.array && !Array.isArray(parsed)) return undefined;
      return parsed;
    } catch {
      return undefined;
    }
  }
  if (field.kind === "integer" || field.kind === "number") {
    const number = Number(raw);
    if (
      !Number.isFinite(number) ||
      (field.kind === "integer" && !Number.isInteger(number))
    )
      return undefined;
    return number;
  }
  if (field.kind === "boolean") {
    if (raw === "true" || raw === "false") return raw === "true";
    return undefined;
  }
  return raw;
}

function buildBody(
  bodyForm: BodyForm,
  values: FormValues,
  required: boolean,
  limits: PlaygroundLimits,
  errors: ValidationError[],
): { body?: ExecutableBody; summary: string } {
  const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
  switch (bodyForm.kind) {
    case "json": {
      const text = values.bodyText.trim();
      if (text === "") {
        if (required)
          errors.push({ field: "body", message: "A JSON body is required." });
        return { summary: "No body" };
      }
      try {
        JSON.parse(text);
      } catch {
        errors.push({ field: "body", message: "The body is not valid JSON." });
        return { summary: "Invalid JSON" };
      }
      if (bytes(text) > limits.bodyBytes) {
        errors.push({
          field: "body",
          message: `The body exceeds ${limits.bodyBytes} bytes.`,
        });
      }
      return {
        body: { contentType: bodyForm.mediaType, kind: "text", text },
        summary: `${bodyForm.mediaType} · ${bytes(text)} bytes`,
      };
    }
    case "text":
    case "opaque": {
      const text = values.bodyText;
      if (text === "") {
        if (required)
          errors.push({ field: "body", message: "A body is required." });
        return { summary: "No body" };
      }
      if (bytes(text) > limits.bodyBytes) {
        errors.push({
          field: "body",
          message: `The body exceeds ${limits.bodyBytes} bytes.`,
        });
      }
      return {
        body: { contentType: bodyForm.mediaType, kind: "text", text },
        summary: `${bodyForm.mediaType} · ${bytes(text)} bytes`,
      };
    }
    case "form": {
      const pairs: Pair[] = [];
      const before = errors.length;
      for (const field of bodyForm.fields) {
        const value = values.bodyFields[field.name] ?? "";
        if (value === "") {
          if (field.required)
            errors.push({
              field: `body:${field.name}`,
              message: `${field.name} is required.`,
            });
          continue;
        }
        pairs.push({
          name: encodeQueryValue(field.name),
          value: encodeQueryValue(value),
        });
      }
      if (pairs.length === 0) {
        if (required && errors.length === before) {
          errors.push({
            field: "body",
            message: "At least one form field is required.",
          });
        }
        return { summary: "No body" };
      }
      const text = pairs.map((pair) => `${pair.name}=${pair.value}`).join("&");
      if (bytes(text) > limits.bodyBytes) {
        errors.push({
          field: "body",
          message: `The body exceeds ${limits.bodyBytes} bytes.`,
        });
      }
      return {
        body: { contentType: bodyForm.mediaType, kind: "form", text },
        summary: `${bodyForm.mediaType} · ${pairs.length} field(s)`,
      };
    }
    case "multipart": {
      const entries: MultipartEntry[] = [];
      const before = errors.length;
      let total = 0;
      for (const field of bodyForm.fields) {
        if (field.file) {
          const file = values.files[field.name];
          if (file === undefined) {
            if (field.required)
              errors.push({
                field: `body:${field.name}`,
                message: `${field.name} needs a file.`,
              });
            continue;
          }
          if (file.size > limits.fileBytes) {
            errors.push({
              field: `body:${field.name}`,
              message: `${field.name} exceeds ${limits.fileBytes} bytes.`,
            });
            continue;
          }
          total += file.size;
          entries.push({
            fileName:
              "name" in file && typeof file.name === "string"
                ? file.name
                : "file",
            name: field.name,
            value: file,
          });
        } else {
          const value = values.bodyFields[field.name] ?? "";
          if (value === "") {
            if (field.required)
              errors.push({
                field: `body:${field.name}`,
                message: `${field.name} is required.`,
              });
            continue;
          }
          total += bytes(value);
          entries.push({ name: field.name, value });
        }
      }
      if (total > limits.bodyBytes) {
        errors.push({
          field: "body",
          message: `The multipart body exceeds ${limits.bodyBytes} bytes.`,
        });
      }
      if (entries.length === 0) {
        if (required && errors.length === before) {
          errors.push({
            field: "body",
            message: "At least one part is required.",
          });
        }
        return { summary: "No body" };
      }
      return {
        body: { entries, kind: "multipart" },
        summary: `multipart/form-data · ${entries.length} part(s)`,
      };
    }
    case "binary": {
      const file = values.files.body;
      if (file === undefined) {
        if (required)
          errors.push({ field: "body", message: "A file is required." });
        return { summary: "No body" };
      }
      if (file.size > limits.fileBytes) {
        errors.push({
          field: "body",
          message: `The file exceeds ${limits.fileBytes} bytes.`,
        });
      }
      return {
        body: { blob: file, contentType: bodyForm.mediaType, kind: "binary" },
        summary: `${bodyForm.mediaType} · ${file.size} bytes`,
      };
    }
  }
}

function setHeader(headers: Pair[], name: string, value: string): void {
  const lower = name.toLowerCase();
  for (let index = headers.length - 1; index >= 0; index -= 1) {
    if (headers[index]?.name.toLowerCase() === lower) headers.splice(index, 1);
  }
  headers.push({ name, value });
}

/** Base64 of UTF-8 text without depending on `btoa` (which is Latin-1 only). */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    const triple = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    output += alphabet[(triple >> 18) & 63];
    output += alphabet[(triple >> 12) & 63];
    output += b === undefined ? "=" : alphabet[(triple >> 6) & 63];
    output += c === undefined ? "=" : alphabet[triple & 63];
  }
  return output;
}
