/**
 * Model provider contracts and types.
 *
 * This module defines provider-neutral interfaces for multi-turn
 * AI provider interactions per Task 3.2 and DEC-034/DEC-036.
 *
 * Key components:
 * - Provider configuration and capabilities
 * - Conversation message types
 * - Opaque continuation state
 * - Request/response contracts
 * - Normalized error types
 * - Message validation
 *
 * Adapters (Tasks 3.4-3.6) implement the contracts defined here.
 * Schema conversion (Task 3.2a) defines schema types.
 * Credentials and lifecycle (Task 3.3/3.3a) add runtime support.
 */

// Provider configuration and capabilities
export {
  type BuiltInAdapterType,
  type AdapterType,
  type ProviderConfigBase,
  type ProviderConfig,
  type CapabilityState,
  type DeclaredCapabilities,
  type SchemaKeywordSupport,
  type ProviderIdentity,
  createUnknownCapabilities,
  BUILT_IN_PROVIDER_KEY_NAMES,
  CUSTOM_PROVIDER_KEY_PATTERN,
  isValidProviderKeyName,
  providerIdentitiesMatch,
} from './types.js';

// Conversation messages
export {
  type MessageRole,
  type TextContent,
  type ImageContent,
  type ImageUrlContent,
  type ContentItem,
  type MessageContent,
  type SystemMessage,
  type UserMessage,
  type ToolCall,
  type AssistantTextContent,
  type AssistantToolCallContent,
  type AssistantRefusalContent,
  type AssistantContentItem,
  type AssistantMessage,
  type ToolResultContentItem,
  type ToolResultMessage,
  type ConversationMessage,
  type CacheControlHint,
  isSystemMessage,
  isUserMessage,
  isAssistantMessage,
  isToolResultMessage,
  extractToolCalls,
  hasToolCalls,
  getAssistantText,
  hasRefusal,
  getRefusalReason,
  userMessage,
  systemMessage,
  assistantTextMessage,
  toolResultMessage,
  assistantToolCallMessage,
} from './messages.js';

// Continuation state
export {
  type ContinuationState,
  type ContinuationCompatibility,
  type ContinuationIncompatibilityReason,
  type ContinuationRef,
  type ContinuationPolicy,
  type PayloadAccessResult,
  SecureContinuationState,
  checkContinuationCompatibility,
  createContinuationState,
  generateContinuationRef,
  ContinuationStateRegistry,
  describeContinuationState,
} from './continuation.js';

// Request types
export {
  type ToolDefinition,
  type ToolParameterSchema,
  type ExternalToolSchema,
  type ToolChoicePolicy,
  type StructuredOutputMode,
  type RequestOptions,
  type ModelRequest,
  type RequestMetadata,
  type RequestValidationResult,
  validateRequest,
  extractJsonSchema,
  isExternalToolSchema,
  validateExternalToolSchema,
  validateToolParameterSchema,
  DEFAULT_REQUEST_OPTIONS,
} from './request.js';

// Schema types (Task 3.2a / DEC-037)
export {
  type GeneratedJsonSchema,
  type CanonicalSchema,
  type JsonSchemaOptions,
  type JsonSchemaConversionResult,
  type JsonSchemaConversionSuccess,
  type JsonSchemaConversionUnsupported,
  type SchemaValidationResult,
  type SchemaValidationError,
  type StructuredOutputValidationResult,
  type StructuredOutputValid,
  type StructuredOutputInvalidJson,
  type StructuredOutputSchemaInvalid,
  type StructuredOutputRefusal,
  type StructuredOutputIncomplete,
  type SchemaConversionContext,
  type SchemaConversionResult,
  type SchemaConversionSuccess,
  type SchemaConversionUnsupported,
  SchemaRegistry,
  createCanonicalSchema,
  validateStructuredOutput,
  convertSchemaForProvider,
  isCanonicalSchema,
  isValidStructuredOutput,
  isInvalidJsonOutput,
  isSchemaInvalidOutput,
  isRefusalOutput,
  isIncompleteOutput,
  z,
} from './schema.js';

// Response types
export {
  type FinishReason,
  type TokenUsage,
  type ResponseTiming,
  type ModelResponse,
  type ContentFilterResult,
  type ModelErrorResponse,
  type ModelSuccessResponse,
  type ModelResult,
  isSuccessResponse,
  isErrorResponse,
  successResponse,
  errorResponse,
  ResponseBuilder,
} from './response.js';

// Error types
export {
  type ProviderErrorCode,
  type ErrorSeverity,
  type RetrySafety,
  type ProviderError,
  type RateLimitError,
  type QuotaError,
  type ContextLengthError,
  type MalformedResponseError,
  isRateLimitError,
  isQuotaError,
  isContextLengthError,
  isMalformedResponseError,
  isDefinitelyNotRetryable,
  isDefinitelySafeToRetry,
  hasAmbiguousRetrySafety,
  requiresRetryDelay,
  isRetryable,
  requiresBackoff,
  ProviderErrors,
  ProviderException,
} from './errors.js';

// Validation
export {
  type MessageValidationResult,
  type ToolCorrelationResult,
  validateSystemMessage,
  validateUserMessage,
  validateAssistantMessage,
  validateToolResultMessage,
  validateMessage,
  validateToolCorrelation,
  validateMessageSequence,
} from './validation.js';
