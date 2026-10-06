/**
 * `@specistry/playground/client`: the browser half of the playground. No
 * React, no Node, no parser; only the form contract, the destination
 * assertion, the request builder, the memory-only credential vault, the
 * bounded executor, and presentation redaction.
 */
export {
  createCredentialVault,
  schemeKey,
  type CredentialValue,
  type CredentialVault,
} from "./credentials.js";
export {
  assertBasePath,
  assertExactOrigin,
  composeDestination,
  DESTINATION_MESSAGES,
  type DestinationFailure,
  type DestinationResult,
} from "./destination.js";
export {
  executeRequest,
  RESULT_MESSAGES,
  type ExecuteOptions,
  type PlaygroundResult,
  type ResponseBody,
  type ResultState,
} from "./execute.js";
export {
  isCredentialHeader,
  MASK,
  redactHeader,
  redactHeaders,
  sanitizeHeaderValue,
} from "./redact.js";
export {
  alternativeReady,
  buildRequest,
  encodeBase64,
  parameterKey,
  type BuildResult,
  type ExecutableBody,
  type ExecutableRequest,
  type FormValues,
  type MultipartEntry,
  type RequestPreview,
  type ValidationError,
} from "./request.js";
export {
  CAPABILITY_MESSAGES,
  PLAYGROUND_HARD_LIMITS,
  isForbiddenRequestHeader,
  type AuthAlternativeForm,
  type AuthSchemeForm,
  type BodyFieldForm,
  type BodyForm,
  type CapabilityReason,
  type CapabilityState,
  type OperationForm,
  type ParameterField,
  type PlaygroundEnvironment,
  type PlaygroundLimits,
} from "../types.js";
