/**
 * Browser-safe protocol entry (SPEC-009 §30): the shared serializer,
 * URL composition, sanitizer, and request resolution without any language
 * generator. The playground island imports this entry; the architecture
 * gate forbids client islands from importing the package root.
 */
export {
  isSensitiveName,
  looksLikeSecret,
  placeholderFor,
  sanitizeLine,
  sanitizeText,
  secretPlaceholderFor,
  isToken,
} from "./sanitize.js";
export {
  joinDelimited,
  primitiveText,
  renderPathTemplate,
  serializeCookieParameter,
  serializeHeaderParameter,
  serializePathParameter,
  serializeQueryParameter,
  type PathSerialization,
  type QuerySerialization,
} from "./serialize.js";
export {
  composeUrl,
  encodePathValue,
  encodeQueryValue,
  queryString,
  validateBaseUrl,
} from "./url.js";
export { PLACEHOLDERS } from "./types.js";
export type {
  AuthAlternative,
  AuthSchemeKind,
  AuthSchemeProjection,
  BodyKind,
  BodyProjection,
  EnvironmentProjection,
  FormField,
  Pair,
  RequestProjection,
} from "./types.js";
