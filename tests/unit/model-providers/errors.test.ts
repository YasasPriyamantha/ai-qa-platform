/**
 * Tests for normalized provider errors.
 *
 * Tests:
 * - Error factory functions
 * - Error type guards
 * - Retry safety classification (descriptive metadata)
 * - HTTP status mapping
 *
 * IMPORTANT: Retry safety is descriptive metadata, not an executable retry policy.
 * The actual retry decision belongs to Task 3.3a's shared request lifecycle.
 */

import { describe, it, expect } from 'vitest';
import {
  ProviderErrors,
  ProviderException,
  isRateLimitError,
  isQuotaError,
  isContextLengthError,
  isMalformedResponseError,
  isRetryable,
  requiresBackoff,
  isDefinitelyNotRetryable,
  isDefinitelySafeToRetry,
  hasAmbiguousRetrySafety,
  requiresRetryDelay,
  type RateLimitError,
  type QuotaError,
  type ContextLengthError,
  type MalformedResponseError,
} from '../../../src/model-providers/index.js';

describe('ProviderErrors factory', () => {
  describe('credential errors', () => {
    it('creates credentials missing error', () => {
      const error = ProviderErrors.credentialsMissing('openai', 'OPENAI_API_KEY');

      expect(error.code).toBe('CREDENTIALS_MISSING');
      expect(error.message).toContain('openai');
      expect(error.message).toContain('OPENAI_API_KEY');
      expect(error.retrySafety).toBe('not_retryable');
    });

    it('creates credentials invalid error', () => {
      const error = ProviderErrors.credentialsInvalid('anthropic', 'Key expired');

      expect(error.code).toBe('CREDENTIALS_INVALID');
      expect(error.message).toContain('anthropic');
      expect(error.message).toContain('Key expired');
      expect(error.retrySafety).toBe('not_retryable');
    });
  });

  describe('provider/model errors', () => {
    it('creates provider not found error', () => {
      const error = ProviderErrors.providerNotFound('unknown-provider');

      expect(error.code).toBe('PROVIDER_NOT_FOUND');
      expect(error.message).toContain('unknown-provider');
      expect(error.retrySafety).toBe('not_retryable');
    });

    it('creates model not found error', () => {
      const error = ProviderErrors.modelNotFound('gpt-5', 'openai');

      expect(error.code).toBe('MODEL_NOT_FOUND');
      expect(error.message).toContain('gpt-5');
      expect(error.message).toContain('openai');
    });

    it('creates feature unsupported error', () => {
      const error = ProviderErrors.featureUnsupported('structured_output', 'some-provider');

      expect(error.code).toBe('FEATURE_UNSUPPORTED');
      expect(error.message).toContain('structured_output');
    });
  });

  describe('rate limit and quota errors', () => {
    it('creates rate limited error with defaults', () => {
      const error = ProviderErrors.rateLimited();

      expect(error.code).toBe('RATE_LIMITED');
      expect(error.retrySafety).toBe('retryable_with_delay');
      expect(error.retryAfterMs).toBe(60000); // Default 1 minute
    });

    it('creates rate limited error with custom delay', () => {
      const error = ProviderErrors.rateLimited(5000);

      expect(error.retryAfterMs).toBe(5000);
    });

    it('creates rate limited error with details', () => {
      const error = ProviderErrors.rateLimited(30000, {
        resetAt: '2024-01-01T12:00:00Z',
        limitType: 'requests_per_minute',
        limit: 100,
      });

      expect((error as RateLimitError).resetAt).toBe('2024-01-01T12:00:00Z');
      expect((error as RateLimitError).limitType).toBe('requests_per_minute');
      expect((error as RateLimitError).limit).toBe(100);
    });

    it('creates quota exceeded error', () => {
      const error = ProviderErrors.quotaExceeded({ quotaType: 'monthly' });

      expect(error.code).toBe('QUOTA_EXCEEDED');
      expect(error.retrySafety).toBe('not_retryable');
      expect((error as QuotaError).quotaType).toBe('monthly');
    });

    it('creates billing error', () => {
      const error = ProviderErrors.billingError('Payment method declined');

      expect(error.code).toBe('BILLING_ERROR');
      expect(error.message).toContain('Payment method declined');
    });
  });

  describe('context limit errors', () => {
    it('creates context length exceeded error', () => {
      const error = ProviderErrors.contextLengthExceeded(128000, 150000);

      expect(error.code).toBe('CONTEXT_LENGTH_EXCEEDED');
      expect((error as ContextLengthError).maxTokens).toBe(128000);
      expect((error as ContextLengthError).requestedTokens).toBe(150000);
      expect(error.message).toContain('128000');
      expect(error.message).toContain('150000');
    });

    it('creates context length exceeded error without requested tokens', () => {
      const error = ProviderErrors.contextLengthExceeded(32000);

      expect(error.code).toBe('CONTEXT_LENGTH_EXCEEDED');
      expect((error as ContextLengthError).maxTokens).toBe(32000);
      expect((error as ContextLengthError).requestedTokens).toBeUndefined();
    });
  });

  describe('availability errors', () => {
    it('creates provider unavailable error with ambiguous retry safety', () => {
      const error = ProviderErrors.providerUnavailable('openai', 'Service maintenance');

      expect(error.code).toBe('PROVIDER_UNAVAILABLE');
      // Ambiguous: request may have been partially processed
      expect(error.retrySafety).toBe('retryable_ambiguous');
      expect(error.message).toContain('openai');
      expect(error.message).toContain('Service maintenance');
    });

    it('creates provider overloaded error with ambiguous retry safety', () => {
      const error = ProviderErrors.providerOverloaded('anthropic');

      expect(error.code).toBe('PROVIDER_OVERLOADED');
      expect(error.retrySafety).toBe('retryable_ambiguous');
    });
  });

  describe('request lifecycle errors', () => {
    it('creates timeout error with ambiguous retry safety', () => {
      const error = ProviderErrors.timeout(30000);

      expect(error.code).toBe('TIMEOUT');
      expect(error.message).toContain('30000');
      // IMPORTANT: Timeout is AMBIGUOUS - request may have been accepted
      expect(error.retrySafety).toBe('retryable_ambiguous');
    });

    it('creates cancelled error', () => {
      const error = ProviderErrors.cancelled();

      expect(error.code).toBe('CANCELLED');
      expect(error.severity).toBe('info');
      expect(error.retrySafety).toBe('not_retryable');
    });

    it('creates connection error with ambiguous retry safety', () => {
      const error = ProviderErrors.connectionError('DNS resolution failed');

      expect(error.code).toBe('CONNECTION_ERROR');
      expect(error.message).toContain('DNS resolution failed');
      // IMPORTANT: Connection error is AMBIGUOUS - request may have been accepted
      expect(error.retrySafety).toBe('retryable_ambiguous');
    });
  });

  describe('response quality errors', () => {
    it('creates refusal error', () => {
      const error = ProviderErrors.refusal('I cannot assist with that request');

      expect(error.code).toBe('REFUSAL');
      expect(error.message).toContain('I cannot assist');
      expect(error.retrySafety).toBe('not_retryable');
    });

    it('creates content filtered error', () => {
      const error = ProviderErrors.contentFiltered('hate_speech');

      expect(error.code).toBe('CONTENT_FILTERED');
      expect(error.message).toContain('hate_speech');
    });

    it('creates response incomplete error with safe retry', () => {
      const error = ProviderErrors.responseIncomplete('Stream interrupted');

      expect(error.code).toBe('RESPONSE_INCOMPLETE');
      // SAFE: We got a response, so request was definitely processed
      expect(error.retrySafety).toBe('retryable_safe');
    });

    it('creates response malformed error with safe retry', () => {
      const error = ProviderErrors.responseMalformed('JSON object', ['unexpected token']);

      expect(error.code).toBe('RESPONSE_MALFORMED');
      expect((error as MalformedResponseError).expected).toBe('JSON object');
      expect((error as MalformedResponseError).validationErrors).toContain('unexpected token');
      // SAFE: We got a response, so request was definitely processed
      expect(error.retrySafety).toBe('retryable_safe');
    });

    it('creates tool call malformed error with safe retry', () => {
      const error = ProviderErrors.toolCallMalformed('search', 'Invalid JSON');

      expect(error.code).toBe('TOOL_CALL_MALFORMED');
      expect(error.message).toContain('search');
      expect(error.message).toContain('Invalid JSON');
      // SAFE: We got a response with tool calls
      expect(error.retrySafety).toBe('retryable_safe');
    });

    it('creates structured output invalid error with safe retry', () => {
      const error = ProviderErrors.structuredOutputInvalid([
        'missing required field: name',
        'type must be string',
      ]);

      expect(error.code).toBe('STRUCTURED_OUTPUT_INVALID');
      expect((error as MalformedResponseError).validationErrors).toHaveLength(2);
      // SAFE: We got a response with structured output
      expect(error.retrySafety).toBe('retryable_safe');
    });
  });

  describe('unknown error', () => {
    it('creates unknown error with ambiguous retry safety', () => {
      const cause = new Error('Original error');
      const error = ProviderErrors.unknownError('Something went wrong', cause);

      expect(error.code).toBe('UNKNOWN_ERROR');
      expect(error.cause).toBe(cause);
      // Unknown errors are ambiguous
      expect(error.retrySafety).toBe('retryable_ambiguous');
    });
  });

  describe('fromHttpStatus', () => {
    it('maps 400 to response malformed', () => {
      const error = ProviderErrors.fromHttpStatus(400, 'openai');
      expect(error.code).toBe('RESPONSE_MALFORMED');
      expect(error.httpStatus).toBe(400);
    });

    it('maps 401 to credentials invalid', () => {
      const error = ProviderErrors.fromHttpStatus(401, 'anthropic');
      expect(error.code).toBe('CREDENTIALS_INVALID');
    });

    it('maps 403 to credentials invalid', () => {
      const error = ProviderErrors.fromHttpStatus(403, 'openai', 'Insufficient permissions');
      expect(error.code).toBe('CREDENTIALS_INVALID');
      expect(error.message).toContain('Insufficient permissions');
    });

    it('maps 404 to model not found', () => {
      const error = ProviderErrors.fromHttpStatus(404, 'openai');
      expect(error.code).toBe('MODEL_NOT_FOUND');
    });

    it('maps 429 to rate limited', () => {
      const error = ProviderErrors.fromHttpStatus(429, 'openai');
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.retrySafety).toBe('retryable_with_delay');
    });

    it('maps 500/502/503 to provider unavailable', () => {
      expect(ProviderErrors.fromHttpStatus(500, 'openai').code).toBe('PROVIDER_UNAVAILABLE');
      expect(ProviderErrors.fromHttpStatus(502, 'openai').code).toBe('PROVIDER_UNAVAILABLE');
      expect(ProviderErrors.fromHttpStatus(503, 'openai').code).toBe('PROVIDER_UNAVAILABLE');
    });

    it('maps 504 to timeout', () => {
      const error = ProviderErrors.fromHttpStatus(504, 'openai');
      expect(error.code).toBe('TIMEOUT');
    });

    it('maps unknown status to provider error', () => {
      const error = ProviderErrors.fromHttpStatus(418, 'openai');
      expect(error.code).toBe('PROVIDER_ERROR');
      expect(error.httpStatus).toBe(418);
    });
  });
});

describe('Error type guards', () => {
  describe('isRateLimitError', () => {
    it('returns true for rate limit error', () => {
      const error = ProviderErrors.rateLimited(5000);
      expect(isRateLimitError(error)).toBe(true);
    });

    it('returns false for other errors', () => {
      const error = ProviderErrors.timeout(5000);
      expect(isRateLimitError(error)).toBe(false);
    });
  });

  describe('isQuotaError', () => {
    it('returns true for quota exceeded', () => {
      const error = ProviderErrors.quotaExceeded();
      expect(isQuotaError(error)).toBe(true);
    });

    it('returns true for billing error', () => {
      const error = ProviderErrors.billingError();
      expect(isQuotaError(error)).toBe(true);
    });

    it('returns false for other errors', () => {
      const error = ProviderErrors.rateLimited();
      expect(isQuotaError(error)).toBe(false);
    });
  });

  describe('isContextLengthError', () => {
    it('returns true for context length exceeded', () => {
      const error = ProviderErrors.contextLengthExceeded(128000);
      expect(isContextLengthError(error)).toBe(true);
    });

    it('returns false for other errors', () => {
      const error = ProviderErrors.quotaExceeded();
      expect(isContextLengthError(error)).toBe(false);
    });
  });

  describe('isMalformedResponseError', () => {
    it('returns true for response malformed', () => {
      const error = ProviderErrors.responseMalformed();
      expect(isMalformedResponseError(error)).toBe(true);
    });

    it('returns true for tool call malformed', () => {
      const error = ProviderErrors.toolCallMalformed('search');
      expect(isMalformedResponseError(error)).toBe(true);
    });

    it('returns true for structured output invalid', () => {
      const error = ProviderErrors.structuredOutputInvalid(['error']);
      expect(isMalformedResponseError(error)).toBe(true);
    });

    it('returns false for other errors', () => {
      const error = ProviderErrors.timeout(5000);
      expect(isMalformedResponseError(error)).toBe(false);
    });
  });
});

describe('Retry safety helpers', () => {
  describe('isDefinitelyNotRetryable', () => {
    it('returns true for not_retryable errors', () => {
      expect(isDefinitelyNotRetryable(ProviderErrors.credentialsInvalid('x'))).toBe(true);
      expect(isDefinitelyNotRetryable(ProviderErrors.refusal('reason'))).toBe(true);
      expect(isDefinitelyNotRetryable(ProviderErrors.cancelled())).toBe(true);
    });

    it('returns false for potentially retryable errors', () => {
      expect(isDefinitelyNotRetryable(ProviderErrors.timeout(5000))).toBe(false);
      expect(isDefinitelyNotRetryable(ProviderErrors.rateLimited())).toBe(false);
      expect(isDefinitelyNotRetryable(ProviderErrors.responseIncomplete())).toBe(false);
    });
  });

  describe('isDefinitelySafeToRetry', () => {
    it('returns true for retryable_safe errors (got a response)', () => {
      expect(isDefinitelySafeToRetry(ProviderErrors.responseIncomplete())).toBe(true);
      expect(isDefinitelySafeToRetry(ProviderErrors.responseMalformed())).toBe(true);
      expect(isDefinitelySafeToRetry(ProviderErrors.toolCallMalformed('x'))).toBe(true);
      expect(isDefinitelySafeToRetry(ProviderErrors.structuredOutputInvalid([]))).toBe(true);
    });

    it('returns false for ambiguous errors', () => {
      expect(isDefinitelySafeToRetry(ProviderErrors.timeout(5000))).toBe(false);
      expect(isDefinitelySafeToRetry(ProviderErrors.connectionError())).toBe(false);
      expect(isDefinitelySafeToRetry(ProviderErrors.providerUnavailable('x'))).toBe(false);
    });

    it('returns false for not_retryable errors', () => {
      expect(isDefinitelySafeToRetry(ProviderErrors.credentialsInvalid('x'))).toBe(false);
    });
  });

  describe('hasAmbiguousRetrySafety', () => {
    it('returns true for ambiguous errors (request may have been accepted)', () => {
      expect(hasAmbiguousRetrySafety(ProviderErrors.timeout(5000))).toBe(true);
      expect(hasAmbiguousRetrySafety(ProviderErrors.connectionError())).toBe(true);
      expect(hasAmbiguousRetrySafety(ProviderErrors.providerUnavailable('x'))).toBe(true);
      expect(hasAmbiguousRetrySafety(ProviderErrors.unknownError())).toBe(true);
    });

    it('returns false for definitely safe/unsafe errors', () => {
      expect(hasAmbiguousRetrySafety(ProviderErrors.responseIncomplete())).toBe(false);
      expect(hasAmbiguousRetrySafety(ProviderErrors.credentialsInvalid('x'))).toBe(false);
      expect(hasAmbiguousRetrySafety(ProviderErrors.rateLimited())).toBe(false);
    });
  });

  describe('requiresRetryDelay', () => {
    it('returns true for rate limit errors', () => {
      expect(requiresRetryDelay(ProviderErrors.rateLimited())).toBe(true);
    });

    it('returns false for other errors', () => {
      expect(requiresRetryDelay(ProviderErrors.timeout(5000))).toBe(false);
      expect(requiresRetryDelay(ProviderErrors.responseIncomplete())).toBe(false);
    });
  });

  describe('legacy isRetryable (deprecated)', () => {
    it('returns true for all non-not_retryable errors', () => {
      expect(isRetryable(ProviderErrors.timeout(5000))).toBe(true);
      expect(isRetryable(ProviderErrors.rateLimited())).toBe(true);
      expect(isRetryable(ProviderErrors.responseIncomplete())).toBe(true);
    });

    it('returns false for not_retryable', () => {
      expect(isRetryable(ProviderErrors.credentialsInvalid('openai'))).toBe(false);
    });
  });

  describe('legacy requiresBackoff (deprecated)', () => {
    it('returns true for delayed and ambiguous errors', () => {
      expect(requiresBackoff(ProviderErrors.rateLimited())).toBe(true);
      expect(requiresBackoff(ProviderErrors.timeout(5000))).toBe(true);
      expect(requiresBackoff(ProviderErrors.providerUnavailable('x'))).toBe(true);
    });

    it('returns false for safe and not_retryable errors', () => {
      expect(requiresBackoff(ProviderErrors.responseIncomplete())).toBe(false);
      expect(requiresBackoff(ProviderErrors.credentialsInvalid('x'))).toBe(false);
    });
  });
});

describe('ProviderException', () => {
  it('wraps provider error', () => {
    const error = ProviderErrors.timeout(5000);
    const exception = new ProviderException(error);

    expect(exception.name).toBe('ProviderException');
    expect(exception.message).toBe(error.message);
    expect(exception.providerError).toBe(error);
    expect(exception.code).toBe('TIMEOUT');
    expect(exception.isRetryable).toBe(true);
  });

  it('is an instance of Error', () => {
    const error = ProviderErrors.cancelled();
    const exception = new ProviderException(error);

    expect(exception instanceof Error).toBe(true);
    expect(exception instanceof ProviderException).toBe(true);
  });

  it('provides code accessor', () => {
    const error = ProviderErrors.rateLimited();
    const exception = new ProviderException(error);

    expect(exception.code).toBe('RATE_LIMITED');
  });

  it('provides isRetryable accessor', () => {
    const retryableException = new ProviderException(ProviderErrors.rateLimited());
    const nonRetryableException = new ProviderException(ProviderErrors.credentialsInvalid('x'));

    expect(retryableException.isRetryable).toBe(true);
    expect(nonRetryableException.isRetryable).toBe(false);
  });
});
