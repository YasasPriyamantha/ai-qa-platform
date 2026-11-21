/**
 * Normalized provider error types.
 *
 * Implements Task 3.2 requirement 8: Normalized errors for all provider conditions.
 *
 * Key error categories:
 * - Credential errors (missing/invalid)
 * - Unsupported features (provider/model/capability)
 * - Rate limiting and quota
 * - Context limits
 * - Provider availability
 * - Timeout and cancellation
 * - Response quality (refusal, incomplete, malformed)
 * - Unknown errors
 */

/**
 * Error code for normalized provider errors.
 */
export type ProviderErrorCode =
  // Credential errors
  | 'CREDENTIALS_MISSING'
  | 'CREDENTIALS_INVALID'
  | 'CREDENTIALS_EXPIRED'

  // Unsupported errors
  | 'PROVIDER_NOT_FOUND'
  | 'MODEL_NOT_FOUND'
  | 'FEATURE_UNSUPPORTED'
  | 'TOOL_NOT_SUPPORTED'
  | 'STRUCTURED_OUTPUT_NOT_SUPPORTED'

  // Rate and quota errors
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'BILLING_ERROR'

  // Context errors
  | 'CONTEXT_LENGTH_EXCEEDED'
  | 'MAX_TOKENS_EXCEEDED'

  // Availability errors
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_OVERLOADED'
  | 'PROVIDER_MAINTENANCE'

  // Request lifecycle errors
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'CONNECTION_ERROR'
  | 'NETWORK_ERROR'

  // Response quality errors
  | 'REFUSAL'
  | 'CONTENT_FILTERED'
  | 'RESPONSE_INCOMPLETE'
  | 'RESPONSE_TRUNCATED'
  | 'RESPONSE_MALFORMED'
  | 'TOOL_CALL_MALFORMED'
  | 'STRUCTURED_OUTPUT_INVALID'

  // Unknown errors
  | 'UNKNOWN_ERROR'
  | 'PROVIDER_ERROR';

/**
 * Error severity levels.
 */
export type ErrorSeverity = 'error' | 'warning' | 'info';

/**
 * Retry safety classification for normalized errors.
 *
 * IMPORTANT: This is descriptive metadata, not an executable retry policy.
 * The actual retry decision belongs to Task 3.3a's shared request lifecycle,
 * which must account for provider response evidence, request acceptance
 * ambiguity, Retry-After headers, usage budgets, and attempt limits.
 *
 * Provider adapters must not independently implement retry policy.
 */
export type RetrySafety =
  | 'not_retryable' // Definitely unsafe: config error, unsupported feature, refusal
  | 'retryable_safe' // Definitely safe: request was not accepted/processed
  | 'retryable_with_delay' // Safe after delay: rate limit with Retry-After
  | 'retryable_ambiguous' // Unknown: timeout, connection error - request may have been accepted
  | 'unknown'; // Cannot determine safety - requires investigation

/**
 * Base provider error interface.
 */
export interface ProviderError {
  /**
   * Normalized error code.
   */
  readonly code: ProviderErrorCode;

  /**
   * Human-readable error message.
   */
  readonly message: string;

  /**
   * Error severity.
   */
  readonly severity: ErrorSeverity;

  /**
   * Retry safety classification.
   * Descriptive metadata for the shared lifecycle (Task 3.3a) to consider.
   * This does NOT authorize automatic retries by adapters.
   */
  readonly retrySafety: RetrySafety;

  /**
   * Delay in milliseconds before retry (for rate limits).
   */
  readonly retryAfterMs?: number;

  /**
   * Provider-specific error code (for debugging).
   */
  readonly providerCode?: string;

  /**
   * Provider-specific error type/name.
   */
  readonly providerType?: string;

  /**
   * HTTP status code if applicable.
   */
  readonly httpStatus?: number;

  /**
   * Original error from the provider SDK.
   * Never log or expose this directly; use for debugging only.
   */
  readonly cause?: Error;

  /**
   * Request ID for correlation with provider logs.
   */
  readonly requestId?: string;

  /**
   * Timestamp when the error occurred.
   */
  readonly timestamp: string;
}

/**
 * Error with additional rate limit information.
 */
export interface RateLimitError extends ProviderError {
  readonly code: 'RATE_LIMITED';

  /**
   * When the rate limit resets.
   */
  readonly resetAt?: string;

  /**
   * Limit type (requests, tokens, etc.).
   */
  readonly limitType?: 'requests' | 'tokens' | 'requests_per_minute' | 'tokens_per_minute';

  /**
   * Current limit value.
   */
  readonly limit?: number;

  /**
   * Remaining requests/tokens (usually 0 when rate limited).
   */
  readonly remaining?: number;
}

/**
 * Error with additional quota information.
 */
export interface QuotaError extends ProviderError {
  readonly code: 'QUOTA_EXCEEDED' | 'BILLING_ERROR';

  /**
   * Quota type.
   */
  readonly quotaType?: 'monthly' | 'daily' | 'credits' | 'billing';

  /**
   * When the quota resets (if applicable).
   */
  readonly resetAt?: string;
}

/**
 * Error with context length information.
 */
export interface ContextLengthError extends ProviderError {
  readonly code: 'CONTEXT_LENGTH_EXCEEDED' | 'MAX_TOKENS_EXCEEDED';

  /**
   * Maximum allowed tokens.
   */
  readonly maxTokens?: number;

  /**
   * Tokens requested/used.
   */
  readonly requestedTokens?: number;
}

/**
 * Error with malformed response details.
 */
export interface MalformedResponseError extends ProviderError {
  readonly code:
    | 'RESPONSE_MALFORMED'
    | 'TOOL_CALL_MALFORMED'
    | 'STRUCTURED_OUTPUT_INVALID';

  /**
   * What was expected.
   */
  readonly expected?: string;

  /**
   * What was received (sanitized, never raw response).
   */
  readonly received?: string;

  /**
   * Validation errors if applicable.
   */
  readonly validationErrors?: readonly string[];
}

/**
 * Type guard for RateLimitError.
 */
export function isRateLimitError(error: ProviderError): error is RateLimitError {
  return error.code === 'RATE_LIMITED';
}

/**
 * Type guard for QuotaError.
 */
export function isQuotaError(error: ProviderError): error is QuotaError {
  return error.code === 'QUOTA_EXCEEDED' || error.code === 'BILLING_ERROR';
}

/**
 * Type guard for ContextLengthError.
 */
export function isContextLengthError(error: ProviderError): error is ContextLengthError {
  return error.code === 'CONTEXT_LENGTH_EXCEEDED' || error.code === 'MAX_TOKENS_EXCEEDED';
}

/**
 * Type guard for MalformedResponseError.
 */
export function isMalformedResponseError(
  error: ProviderError
): error is MalformedResponseError {
  return (
    error.code === 'RESPONSE_MALFORMED' ||
    error.code === 'TOOL_CALL_MALFORMED' ||
    error.code === 'STRUCTURED_OUTPUT_INVALID'
  );
}

/**
 * Check if an error is definitely not retryable.
 */
export function isDefinitelyNotRetryable(error: ProviderError): boolean {
  return error.retrySafety === 'not_retryable';
}

/**
 * Check if an error is definitely safe to retry.
 */
export function isDefinitelySafeToRetry(error: ProviderError): boolean {
  return error.retrySafety === 'retryable_safe';
}

/**
 * Check if an error has ambiguous retry safety (request may have been accepted).
 */
export function hasAmbiguousRetrySafety(error: ProviderError): boolean {
  return error.retrySafety === 'retryable_ambiguous' || error.retrySafety === 'unknown';
}

/**
 * Check if an error requires a delay before retry (rate limit).
 */
export function requiresRetryDelay(error: ProviderError): boolean {
  return error.retrySafety === 'retryable_with_delay';
}

/**
 * @deprecated Use isDefinitelyNotRetryable instead. Kept for compatibility.
 */
export function isRetryable(error: ProviderError): boolean {
  return error.retrySafety !== 'not_retryable';
}

/**
 * @deprecated Use requiresRetryDelay instead. Kept for compatibility.
 */
export function requiresBackoff(error: ProviderError): boolean {
  return error.retrySafety === 'retryable_with_delay' || error.retrySafety === 'retryable_ambiguous';
}

/**
 * Error factory for creating normalized errors.
 */
export const ProviderErrors = {
  // Credential errors
  credentialsMissing(providerName: string, envVar: string): ProviderError {
    return {
      code: 'CREDENTIALS_MISSING',
      message: `API key not found for provider '${providerName}'. Set the ${envVar} environment variable.`,
      severity: 'error',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
    };
  },

  credentialsInvalid(providerName: string, details?: string): ProviderError {
    return {
      code: 'CREDENTIALS_INVALID',
      message: `Invalid API key for provider '${providerName}'${details ? `: ${details}` : ''}`,
      severity: 'error',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
    };
  },

  // Provider/model errors
  providerNotFound(providerId: string): ProviderError {
    return {
      code: 'PROVIDER_NOT_FOUND',
      message: `Provider '${providerId}' is not configured`,
      severity: 'error',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
    };
  },

  modelNotFound(modelId: string, providerId: string): ProviderError {
    return {
      code: 'MODEL_NOT_FOUND',
      message: `Model '${modelId}' is not available for provider '${providerId}'`,
      severity: 'error',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
    };
  },

  featureUnsupported(feature: string, providerId: string): ProviderError {
    return {
      code: 'FEATURE_UNSUPPORTED',
      message: `Feature '${feature}' is not supported by provider '${providerId}'`,
      severity: 'error',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
    };
  },

  // Rate limit and quota
  rateLimited(
    retryAfterMs?: number,
    details?: { resetAt?: string; limitType?: string; limit?: number }
  ): RateLimitError {
    return {
      code: 'RATE_LIMITED',
      message: 'Rate limit exceeded. Please try again later.',
      severity: 'warning',
      retrySafety: 'retryable_with_delay',
      retryAfterMs: retryAfterMs ?? 60000, // Default 1 minute
      timestamp: new Date().toISOString(),
      resetAt: details?.resetAt,
      limitType: details?.limitType as RateLimitError['limitType'],
      limit: details?.limit,
    };
  },

  quotaExceeded(details?: { quotaType?: string; resetAt?: string }): QuotaError {
    return {
      code: 'QUOTA_EXCEEDED',
      message: 'Usage quota exceeded. Check your account limits.',
      severity: 'error',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
      quotaType: details?.quotaType as QuotaError['quotaType'],
      resetAt: details?.resetAt,
    };
  },

  billingError(details?: string): QuotaError {
    return {
      code: 'BILLING_ERROR',
      message: `Billing error${details ? `: ${details}` : ''}. Check your payment method.`,
      severity: 'error',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
    };
  },

  // Context limits
  contextLengthExceeded(
    maxTokens: number,
    requestedTokens?: number
  ): ContextLengthError {
    const msg = requestedTokens
      ? `Context length exceeded: ${requestedTokens} tokens requested, ${maxTokens} maximum`
      : `Context length exceeded: maximum is ${maxTokens} tokens`;
    return {
      code: 'CONTEXT_LENGTH_EXCEEDED',
      message: msg,
      severity: 'error',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
      maxTokens,
      requestedTokens,
    };
  },

  // Availability
  providerUnavailable(providerId: string, details?: string): ProviderError {
    return {
      code: 'PROVIDER_UNAVAILABLE',
      message: `Provider '${providerId}' is currently unavailable${details ? `: ${details}` : ''}`,
      severity: 'error',
      retrySafety: 'retryable_ambiguous',
      timestamp: new Date().toISOString(),
    };
  },

  providerOverloaded(providerId: string): ProviderError {
    return {
      code: 'PROVIDER_OVERLOADED',
      message: `Provider '${providerId}' is overloaded. Please try again.`,
      severity: 'warning',
      retrySafety: 'retryable_ambiguous',
      timestamp: new Date().toISOString(),
    };
  },

  // Request lifecycle
  timeout(timeoutMs: number): ProviderError {
    return {
      code: 'TIMEOUT',
      message: `Request timed out after ${timeoutMs}ms`,
      severity: 'error',
      // AMBIGUOUS: The request may have been accepted by the provider.
      // The shared lifecycle (Task 3.3a) must decide whether to retry.
      retrySafety: 'retryable_ambiguous',
      timestamp: new Date().toISOString(),
    };
  },

  cancelled(): ProviderError {
    return {
      code: 'CANCELLED',
      message: 'Request was cancelled',
      severity: 'info',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
    };
  },

  connectionError(details?: string): ProviderError {
    return {
      code: 'CONNECTION_ERROR',
      message: `Connection error${details ? `: ${details}` : ''}`,
      severity: 'error',
      retrySafety: 'retryable_ambiguous',
      timestamp: new Date().toISOString(),
    };
  },

  // Response quality
  refusal(reason: string): ProviderError {
    return {
      code: 'REFUSAL',
      message: `Model refused to respond: ${reason}`,
      severity: 'warning',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
    };
  },

  contentFiltered(reason?: string): ProviderError {
    return {
      code: 'CONTENT_FILTERED',
      message: `Content was filtered${reason ? `: ${reason}` : ''}`,
      severity: 'warning',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
    };
  },

  responseIncomplete(reason?: string): ProviderError {
    return {
      code: 'RESPONSE_INCOMPLETE',
      message: `Response was incomplete${reason ? `: ${reason}` : ''}`,
      severity: 'warning',
      // SAFE: We received a response, so the request was processed.
      retrySafety: 'retryable_safe',
      timestamp: new Date().toISOString(),
    };
  },

  responseMalformed(expected?: string, validationErrors?: string[]): MalformedResponseError {
    return {
      code: 'RESPONSE_MALFORMED',
      message: 'Response from provider was malformed',
      severity: 'error',
      // SAFE: We received a response, so the request was processed.
      retrySafety: 'retryable_safe',
      timestamp: new Date().toISOString(),
      expected,
      validationErrors,
    };
  },

  toolCallMalformed(toolName: string, details?: string): MalformedResponseError {
    return {
      code: 'TOOL_CALL_MALFORMED',
      message: `Tool call for '${toolName}' has malformed arguments${details ? `: ${details}` : ''}`,
      severity: 'error',
      // SAFE: We received a response, so the request was processed.
      retrySafety: 'retryable_safe',
      timestamp: new Date().toISOString(),
    };
  },

  structuredOutputInvalid(validationErrors: string[]): MalformedResponseError {
    return {
      code: 'STRUCTURED_OUTPUT_INVALID',
      message: 'Structured output does not match schema',
      severity: 'error',
      // SAFE: We received a response, so the request was processed.
      retrySafety: 'retryable_safe',
      timestamp: new Date().toISOString(),
      validationErrors,
    };
  },

  // Unknown/generic
  unknownError(details?: string, cause?: Error): ProviderError {
    return {
      code: 'UNKNOWN_ERROR',
      message: `Unknown error${details ? `: ${details}` : ''}`,
      severity: 'error',
      retrySafety: 'retryable_ambiguous',
      timestamp: new Date().toISOString(),
      cause,
    };
  },

  /**
   * Create a provider error from an HTTP status code.
   */
  fromHttpStatus(
    status: number,
    providerId: string,
    details?: string
  ): ProviderError {
    switch (status) {
      case 400:
        return {
          code: 'RESPONSE_MALFORMED',
          message: `Bad request to provider '${providerId}'${details ? `: ${details}` : ''}`,
          severity: 'error',
          retrySafety: 'not_retryable',
          httpStatus: status,
          timestamp: new Date().toISOString(),
        };
      case 401:
        return {
          code: 'CREDENTIALS_INVALID',
          message: `Authentication failed for provider '${providerId}'`,
          severity: 'error',
          retrySafety: 'not_retryable',
          httpStatus: status,
          timestamp: new Date().toISOString(),
        };
      case 403:
        return {
          code: 'CREDENTIALS_INVALID',
          message: `Access denied for provider '${providerId}'${details ? `: ${details}` : ''}`,
          severity: 'error',
          retrySafety: 'not_retryable',
          httpStatus: status,
          timestamp: new Date().toISOString(),
        };
      case 404:
        return {
          code: 'MODEL_NOT_FOUND',
          message: `Resource not found for provider '${providerId}'${details ? `: ${details}` : ''}`,
          severity: 'error',
          retrySafety: 'not_retryable',
          httpStatus: status,
          timestamp: new Date().toISOString(),
        };
      case 429:
        return {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded',
          severity: 'warning',
          retrySafety: 'retryable_with_delay',
          retryAfterMs: 60000,
          httpStatus: status,
          timestamp: new Date().toISOString(),
        };
      case 500:
      case 502:
      case 503:
        return {
          code: 'PROVIDER_UNAVAILABLE',
          message: `Provider '${providerId}' is unavailable (HTTP ${status})`,
          severity: 'error',
          retrySafety: 'retryable_ambiguous',
          httpStatus: status,
          timestamp: new Date().toISOString(),
        };
      case 504:
        return {
          code: 'TIMEOUT',
          message: `Gateway timeout from provider '${providerId}'`,
          severity: 'error',
          retrySafety: 'retryable_ambiguous',
          httpStatus: status,
          timestamp: new Date().toISOString(),
        };
      default:
        return {
          code: 'PROVIDER_ERROR',
          message: `Provider '${providerId}' returned HTTP ${status}${details ? `: ${details}` : ''}`,
          severity: 'error',
          retrySafety: status >= 500 ? 'retryable_ambiguous' : 'not_retryable',
          httpStatus: status,
          timestamp: new Date().toISOString(),
        };
    }
  },
};

/**
 * ProviderException class for throwing provider errors.
 */
export class ProviderException extends Error {
  readonly providerError: ProviderError;

  constructor(error: ProviderError) {
    super(error.message);
    this.name = 'ProviderException';
    this.providerError = error;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProviderException);
    }
  }

  get code(): ProviderErrorCode {
    return this.providerError.code;
  }

  get isRetryable(): boolean {
    return isRetryable(this.providerError);
  }
}
