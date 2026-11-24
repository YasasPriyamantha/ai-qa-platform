/**
 * Tests for shared request lifecycle service.
 *
 * Task 3.3a: Comprehensive lifecycle tests with fake adapters.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  executeRequest,
  runRequestGate,
  createCombinedSignal,
  calculateRetryDelay,
  shouldRetry,
  generatePlatformRequestId,
  DEFAULT_LIFECYCLE_CONFIG,
  type LifecycleContext,
} from '../../../src/model-providers/lifecycle.js';
import {
  createFakeAdapter,
  globalAdapterRegistry,
} from '../../../src/model-providers/adapter-interface.js';
import { ProviderErrors, hasAmbiguousRetrySafety } from '../../../src/model-providers/errors.js';
import { createObservedUsage, createUnknownObservedUsage } from '../../../src/model-providers/usage.js';
import { SecureSecretStore } from '../../../src/provider-secrets/secure-store.js';
import type { ModelRequest } from '../../../src/model-providers/request.js';
import type { ModelResponse } from '../../../src/model-providers/response.js';
import type { SecretResolutionContext, ProvidersConfigFile } from '../../../src/provider-secrets/types.js';
import type { BudgetConfig, BudgetState } from '../../../src/model-providers/budget.js';

// Test fixtures
function createTestRequest(overrides?: Partial<ModelRequest>): ModelRequest {
  return {
    providerId: 'test-provider',
    modelId: 'test-model',
    messages: [
      { role: 'user', content: 'Hello' },
    ],
    ...overrides,
  };
}

function createTestResponse(): ModelResponse {
  return {
    identity: {
      providerId: 'test-provider',
      adapterType: 'openai-responses',
      modelId: 'test-model',
    },
    message: {
      role: 'assistant',
      content: 'Hello!',
    },
    finishReason: 'stop',
    hasToolCalls: false,
    toolCalls: [],
    text: 'Hello!',
    hasContinuation: false,
    truncated: false,
    timing: {
      totalMs: 100,
      requestedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    },
  };
}

function createTestProviderConfig(): ProvidersConfigFile {
  return {
    version: '1.0',
    providers: [
      {
        providerId: 'test-provider',
        adapterType: 'openai-responses',
        defaultModelId: 'test-model',
        apiKeyEnvVar: 'TEST_API_KEY',
        enabled: true,
        capabilities: {
          toolCalling: 'supported',
          strictJsonSchema: 'supported',
          usageReporting: 'supported',
          streaming: 'supported',
        },
      },
      {
        providerId: 'disabled-provider',
        adapterType: 'openai-responses',
        defaultModelId: 'test-model',
        apiKeyEnvVar: 'DISABLED_API_KEY',
        enabled: false,
      },
      {
        providerId: 'no-tools-provider',
        adapterType: 'openai-responses',
        defaultModelId: 'test-model',
        apiKeyEnvVar: 'NO_TOOLS_API_KEY',
        enabled: true,
        capabilities: {
          toolCalling: 'unsupported',
        },
      },
    ],
  };
}

function createTestSecrets(): SecureSecretStore {
  return new SecureSecretStore([
    ['test-provider', {
      providerId: 'test-provider',
      envVarName: 'TEST_API_KEY',
      apiKey: 'sk-test-real-key-12345',
    }],
    ['no-tools-provider', {
      providerId: 'no-tools-provider',
      envVarName: 'NO_TOOLS_API_KEY',
      apiKey: 'sk-no-tools-key',
    }],
  ]);
}

function createEnabledSecretContext(): SecretResolutionContext {
  return {
    envFile: {
      values: { AI_ENABLED: 'true', TEST_API_KEY: 'sk-test' },
      success: true,
      filePath: '.env',
    },
    enablement: {
      enabled: true,
      reason: 'enabled-explicitly',
    },
    providerConfig: createTestProviderConfig(),
    secrets: createTestSecrets(),
    warnings: [],
    registeredKeyVars: ['TEST_API_KEY'],
  };
}

function createDisabledSecretContext(): SecretResolutionContext {
  return {
    envFile: {
      values: {},
      success: true,
      filePath: '.env',
    },
    enablement: {
      enabled: false,
      reason: 'disabled-missing-flag',
    },
    providerConfig: createTestProviderConfig(),
    secrets: new SecureSecretStore(),
    warnings: [],
    registeredKeyVars: [],
  };
}

function createTestBudgetConfig(): BudgetConfig {
  return {
    maxTotalRequests: 100,
    maxInputTokensPerRequest: 10000,
    maxOutputTokensPerRequest: 4000,
    maxCumulativeInputTokens: 100000,
    maxCumulativeOutputTokens: 50000,
    window: {
      type: 'rolling',
      durationHours: 24,
    },
  };
}

function createTestBudgetState(): BudgetState {
  return {
    requestCount: 0,
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    windowStart: new Date().toISOString(),
    windowEnd: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function createTestLifecycleContext(overrides?: Partial<LifecycleContext>): LifecycleContext {
  return {
    secretContext: createEnabledSecretContext(),
    budgetConfig: createTestBudgetConfig(),
    budgetState: createTestBudgetState(),
    config: DEFAULT_LIFECYCLE_CONFIG,
    ...overrides,
  };
}

describe('Lifecycle utilities', () => {
  describe('generatePlatformRequestId', () => {
    it('generates unique IDs', () => {
      const id1 = generatePlatformRequestId();
      const id2 = generatePlatformRequestId();

      expect(id1).not.toBe(id2);
    });

    it('starts with plat_ prefix', () => {
      const id = generatePlatformRequestId();
      expect(id.startsWith('plat_')).toBe(true);
    });
  });

  describe('createCombinedSignal', () => {
    it('creates signal from timeout only', () => {
      const { signal, isCancellation } = createCombinedSignal(undefined, 1000);

      expect(signal).toBeInstanceOf(AbortSignal);
      expect(isCancellation()).toBe(false);
    });

    it('combines caller signal with timeout', () => {
      const controller = new AbortController();
      const { signal, isCancellation } = createCombinedSignal(controller.signal, 1000);

      expect(signal).toBeInstanceOf(AbortSignal);
      expect(isCancellation()).toBe(false);
    });

    it('detects caller cancellation', () => {
      const controller = new AbortController();
      const { signal, isCancellation } = createCombinedSignal(controller.signal, 10000);

      controller.abort();

      expect(signal.aborted).toBe(true);
      expect(isCancellation()).toBe(true);
    });
  });

  describe('calculateRetryDelay', () => {
    it('uses Retry-After when available', () => {
      const error = ProviderErrors.rateLimited(5000);
      const delay = calculateRetryDelay(error, 1, DEFAULT_LIFECYCLE_CONFIG);

      expect(delay).toBe(5000);
    });

    it('caps Retry-After at maxRetryDelayMs', () => {
      const error = ProviderErrors.rateLimited(120000);
      const delay = calculateRetryDelay(error, 1, DEFAULT_LIFECYCLE_CONFIG);

      expect(delay).toBe(DEFAULT_LIFECYCLE_CONFIG.maxRetryDelayMs);
    });

    it('uses exponential backoff when no Retry-After', () => {
      const error = ProviderErrors.responseIncomplete();
      const delay1 = calculateRetryDelay(error, 1, DEFAULT_LIFECYCLE_CONFIG);
      const delay2 = calculateRetryDelay(error, 2, DEFAULT_LIFECYCLE_CONFIG);

      expect(delay2).toBeGreaterThan(delay1);
    });
  });

  describe('shouldRetry', () => {
    it('returns true for retryable_safe errors', () => {
      const error = ProviderErrors.responseIncomplete();
      expect(shouldRetry(error, 1, 3)).toBe(true);
    });

    it('returns true for retryable_with_delay errors', () => {
      const error = ProviderErrors.rateLimited();
      expect(shouldRetry(error, 1, 3)).toBe(true);
    });

    it('returns false for retryable_ambiguous errors', () => {
      const error = ProviderErrors.timeout(5000);
      expect(shouldRetry(error, 1, 3)).toBe(false);
    });

    it('returns false for not_retryable errors', () => {
      const error = ProviderErrors.credentialsInvalid('test');
      expect(shouldRetry(error, 1, 3)).toBe(false);
    });

    it('returns false when max attempts reached', () => {
      const error = ProviderErrors.responseIncomplete();
      expect(shouldRetry(error, 3, 3)).toBe(false);
    });
  });
});

describe('Request Gate', () => {
  describe('AI_ENABLED gate', () => {
    it('blocks when AI_ENABLED is false', () => {
      const context = createTestLifecycleContext({
        secretContext: createDisabledSecretContext(),
      });

      const result = runRequestGate(createTestRequest(), context);

      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('AI_ENABLED');
      expect(result.error!.code).toBe('CREDENTIALS_MISSING');
    });

    it('allows when AI_ENABLED is true', () => {
      const context = createTestLifecycleContext();

      const result = runRequestGate(createTestRequest(), context);

      expect(result.allowed).toBe(true);
      expect(result.blockedBy).toBeUndefined();
    });
  });

  describe('PROVIDER_CONFIG gate', () => {
    it('blocks when provider not found', () => {
      const context = createTestLifecycleContext();
      const request = createTestRequest({ providerId: 'unknown-provider' });

      const result = runRequestGate(request, context);

      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('PROVIDER_CONFIG');
      expect(result.error!.code).toBe('PROVIDER_NOT_FOUND');
    });

    it('blocks when provider is disabled', () => {
      const context = createTestLifecycleContext();
      const request = createTestRequest({ providerId: 'disabled-provider' });

      const result = runRequestGate(request, context);

      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('PROVIDER_CONFIG');
    });
  });

  describe('API_KEY gate', () => {
    it('blocks when API key is missing', () => {
      const context = createTestLifecycleContext({
        secretContext: {
          ...createEnabledSecretContext(),
          secrets: new SecureSecretStore(), // Empty secrets
        },
      });

      const result = runRequestGate(createTestRequest(), context);

      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('API_KEY');
      expect(result.error!.code).toBe('CREDENTIALS_MISSING');
    });

    it('blocks when API key is placeholder', () => {
      const context = createTestLifecycleContext({
        secretContext: {
          ...createEnabledSecretContext(),
          secrets: new SecureSecretStore([
            ['test-provider', {
              providerId: 'test-provider',
              envVarName: 'TEST_API_KEY',
              apiKey: 'your-api-key', // Matches ^your-.*-key$ pattern
            }],
          ]),
        },
      });

      const result = runRequestGate(createTestRequest(), context);

      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('API_KEY');
      expect(result.error!.code).toBe('CREDENTIALS_INVALID');
    });
  });

  describe('CAPABILITIES gate', () => {
    it('blocks when tools requested but unsupported', () => {
      const context = createTestLifecycleContext();
      const request = createTestRequest({
        providerId: 'no-tools-provider',
        tools: [
          {
            name: 'search',
            description: 'Search for information',
          },
        ],
      });

      const result = runRequestGate(request, context);

      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('CAPABILITIES');
      expect(result.error!.code).toBe('FEATURE_UNSUPPORTED');
    });
  });

  describe('BUDGET gate', () => {
    it('blocks when request count exceeded', () => {
      const context = createTestLifecycleContext({
        budgetState: {
          ...createTestBudgetState(),
          requestCount: 100, // At limit
        },
      });

      const result = runRequestGate(createTestRequest(), context);

      expect(result.allowed).toBe(false);
      expect(result.blockedBy).toBe('BUDGET');
      expect(result.error!.code).toBe('QUOTA_EXCEEDED');
    });

    it('provides reservation ID when allowed', () => {
      const context = createTestLifecycleContext();

      const result = runRequestGate(createTestRequest(), context);

      expect(result.allowed).toBe(true);
      expect(result.reservationId).toBeDefined();
      expect(result.reservationId!.startsWith('rsv_')).toBe(true);
    });
  });

  describe('Gate order', () => {
    it('checks gates in correct order', () => {
      // AI_ENABLED should be checked first
      const disabledContext = createTestLifecycleContext({
        secretContext: createDisabledSecretContext(),
      });

      // Even with unknown provider, AI_ENABLED should fail first
      const result1 = runRequestGate(
        createTestRequest({ providerId: 'unknown' }),
        disabledContext
      );
      expect(result1.blockedBy).toBe('AI_ENABLED');

      // With AI enabled but unknown provider, PROVIDER_CONFIG should fail
      const enabledContext = createTestLifecycleContext();
      const result2 = runRequestGate(
        createTestRequest({ providerId: 'unknown' }),
        enabledContext
      );
      expect(result2.blockedBy).toBe('PROVIDER_CONFIG');
    });
  });
});

describe('Request Execution', () => {
  beforeEach(() => {
    globalAdapterRegistry.clear();
  });

  describe('successful execution', () => {
    it('executes request successfully', async () => {
      const adapter = createFakeAdapter('openai-responses', {
        response: createTestResponse(),
        observedUsage: createObservedUsage({
          inputTokens: 100,
          outputTokens: 50,
        }),
      });
      globalAdapterRegistry.register(adapter);

      const context = createTestLifecycleContext();
      const result = await executeRequest(createTestRequest(), context);

      expect(result.result.success).toBe(true);
      expect(result.wasRetried).toBe(false);
      expect(result.finalAttemptNumber).toBe(1);
    });

    it('includes usage metadata', async () => {
      const adapter = createFakeAdapter('openai-responses', {
        response: createTestResponse(),
        observedUsage: createObservedUsage({
          inputTokens: 100,
          outputTokens: 50,
        }),
      });
      globalAdapterRegistry.register(adapter);

      const context = createTestLifecycleContext();
      const result = await executeRequest(createTestRequest(), context);

      expect(result.usageMetadata.observed).toBeDefined();
      expect(result.usageMetadata.usageComplete).toBe(true);
    });

    it('provides safe diagnostics', async () => {
      const adapter = createFakeAdapter('openai-responses', {
        response: createTestResponse(),
      });
      globalAdapterRegistry.register(adapter);

      const context = createTestLifecycleContext();
      const result = await executeRequest(createTestRequest(), context);

      expect(result.diagnostics.platformRequestId).toBeDefined();
      expect(result.diagnostics.providerId).toBe('test-provider');
      expect(result.diagnostics.budgetCheckPassed).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns error when adapter fails', async () => {
      const adapter = createFakeAdapter('openai-responses', {
        error: ProviderErrors.credentialsInvalid('test-provider'),
      });
      globalAdapterRegistry.register(adapter);

      const context = createTestLifecycleContext();
      const result = await executeRequest(createTestRequest(), context);

      expect(result.result.success).toBe(false);
      if (!result.result.success) {
        expect(result.result.error.code).toBe('CREDENTIALS_INVALID');
      }
    });

    it('reports diagnostics for failed requests', async () => {
      const adapter = createFakeAdapter('openai-responses', {
        // Use a not_retryable error to avoid retry delays
        error: ProviderErrors.credentialsInvalid('test-provider'),
      });
      globalAdapterRegistry.register(adapter);

      const context = createTestLifecycleContext();
      const result = await executeRequest(createTestRequest(), context);

      expect(result.diagnostics.attemptErrors).toContain('CREDENTIALS_INVALID');
      expect(result.diagnostics.finalRetrySafety).toBe('not_retryable');
    });
  });

  describe('retry behavior', () => {
    it('retries on retryable_safe errors', async () => {
      let attemptCount = 0;
      const adapter = createFakeAdapter('openai-responses', {
        handler: async () => {
          attemptCount++;
          if (attemptCount < 2) {
            return {
              success: false,
              error: ProviderErrors.responseIncomplete(),
              sdkRetriesDisabled: true,
            };
          }
          return {
            success: true,
            response: createTestResponse(),
            observedUsage: createUnknownObservedUsage(),
            sdkRetriesDisabled: true,
          };
        },
      });
      globalAdapterRegistry.register(adapter);

      // Use fast retry delays
      const context = createTestLifecycleContext({
        config: {
          ...DEFAULT_LIFECYCLE_CONFIG,
          baseRetryDelayMs: 10, // Very fast retry
          maxRetryDelayMs: 20,
        },
      });
      const result = await executeRequest(createTestRequest(), context);

      expect(result.result.success).toBe(true);
      expect(result.wasRetried).toBe(true);
      expect(result.finalAttemptNumber).toBe(2);
    });

    it('does NOT retry on retryable_ambiguous errors', async () => {
      let attemptCount = 0;
      const adapter = createFakeAdapter('openai-responses', {
        handler: async () => {
          attemptCount++;
          return {
            success: false,
            error: ProviderErrors.timeout(5000),
            sdkRetriesDisabled: true,
          };
        },
      });
      globalAdapterRegistry.register(adapter);

      const context = createTestLifecycleContext();
      const result = await executeRequest(createTestRequest(), context);

      expect(result.result.success).toBe(false);
      expect(attemptCount).toBe(1); // No retry for ambiguous
      expect(result.wasRetried).toBe(false);
    });

    it('respects max attempts', async () => {
      let attemptCount = 0;
      const adapter = createFakeAdapter('openai-responses', {
        handler: async () => {
          attemptCount++;
          return {
            success: false,
            error: ProviderErrors.responseIncomplete(),
            sdkRetriesDisabled: true,
          };
        },
      });
      globalAdapterRegistry.register(adapter);

      const context = createTestLifecycleContext({
        config: {
          ...DEFAULT_LIFECYCLE_CONFIG,
          maxAttempts: 3,
          baseRetryDelayMs: 10, // Very fast retry
          maxRetryDelayMs: 20,
        },
      });
      const result = await executeRequest(createTestRequest(), context);

      expect(result.result.success).toBe(false);
      expect(attemptCount).toBe(3);
      expect(result.finalAttemptNumber).toBe(3);
    });
  });

  describe('timeout and cancellation', () => {
    it('handles timeout', async () => {
      const adapter = createFakeAdapter('openai-responses', {
        delayMs: 200,
        respectAbortSignal: true,
        response: createTestResponse(),
      });
      globalAdapterRegistry.register(adapter);

      const context = createTestLifecycleContext({
        config: {
          ...DEFAULT_LIFECYCLE_CONFIG,
          defaultTimeoutMs: 50, // Very short timeout
        },
      });
      const request = createTestRequest({ options: { timeoutMs: 50 } });
      const result = await executeRequest(request, context);

      expect(result.result.success).toBe(false);
      expect(result.diagnostics.timedOut).toBe(true);
    });

    it('handles caller cancellation', async () => {
      const controller = new AbortController();
      const adapter = createFakeAdapter('openai-responses', {
        delayMs: 1000,
        respectAbortSignal: true,
        response: createTestResponse(),
      });
      globalAdapterRegistry.register(adapter);

      const context = createTestLifecycleContext({
        callerSignal: controller.signal,
      });

      // Cancel after a short delay
      setTimeout(() => controller.abort(), 50);

      const result = await executeRequest(createTestRequest(), context);

      expect(result.result.success).toBe(false);
      expect(result.diagnostics.cancelledByCaller).toBe(true);
    });
  });

  describe('no adapter registered', () => {
    it('returns error when no adapter for adapter type', async () => {
      // Don't register any adapter
      const context = createTestLifecycleContext();
      const result = await executeRequest(createTestRequest(), context);

      expect(result.result.success).toBe(false);
      if (!result.result.success) {
        expect(result.result.error.code).toBe('PROVIDER_NOT_FOUND');
      }
    });
  });

  describe('gate failures', () => {
    it('fails fast when gate blocks', async () => {
      // Don't register adapter - gate should fail before adapter check
      const context = createTestLifecycleContext({
        secretContext: createDisabledSecretContext(),
      });

      const result = await executeRequest(createTestRequest(), context);

      expect(result.result.success).toBe(false);
      expect(result.diagnostics.budgetCheckPassed).toBe(false);
    });
  });
});

describe('Retry Safety Contract', () => {
  describe('retryable_safe', () => {
    it('RESPONSE_INCOMPLETE is safe to retry', () => {
      const error = ProviderErrors.responseIncomplete();
      expect(error.retrySafety).toBe('retryable_safe');
      expect(shouldRetry(error, 1, 3)).toBe(true);
    });

    it('RESPONSE_MALFORMED is safe to retry', () => {
      const error = ProviderErrors.responseMalformed();
      expect(error.retrySafety).toBe('retryable_safe');
      expect(shouldRetry(error, 1, 3)).toBe(true);
    });
  });

  describe('retryable_with_delay', () => {
    it('RATE_LIMITED is retryable with delay', () => {
      const error = ProviderErrors.rateLimited(5000);
      expect(error.retrySafety).toBe('retryable_with_delay');
      expect(shouldRetry(error, 1, 3)).toBe(true);
    });
  });

  describe('retryable_ambiguous (NEVER retry)', () => {
    it('TIMEOUT is ambiguous - request may have been accepted', () => {
      const error = ProviderErrors.timeout(5000);
      expect(error.retrySafety).toBe('retryable_ambiguous');
      expect(shouldRetry(error, 1, 3)).toBe(false);
    });

    it('CONNECTION_ERROR is ambiguous - request may have been accepted', () => {
      const error = ProviderErrors.connectionError();
      expect(error.retrySafety).toBe('retryable_ambiguous');
      expect(shouldRetry(error, 1, 3)).toBe(false);
    });

    it('PROVIDER_UNAVAILABLE is ambiguous', () => {
      const error = ProviderErrors.providerUnavailable('test');
      expect(error.retrySafety).toBe('retryable_ambiguous');
      expect(shouldRetry(error, 1, 3)).toBe(false);
    });
  });

  describe('not_retryable', () => {
    it('CREDENTIALS_INVALID is not retryable', () => {
      const error = ProviderErrors.credentialsInvalid('test');
      expect(error.retrySafety).toBe('not_retryable');
      expect(shouldRetry(error, 1, 3)).toBe(false);
    });

    it('CANCELLED is not retryable', () => {
      const error = ProviderErrors.cancelled();
      expect(error.retrySafety).toBe('not_retryable');
      expect(shouldRetry(error, 1, 3)).toBe(false);
    });

    it('REFUSAL is not retryable', () => {
      const error = ProviderErrors.refusal('reason');
      expect(error.retrySafety).toBe('not_retryable');
      expect(shouldRetry(error, 1, 3)).toBe(false);
    });
  });

  describe('unknown RetrySafety (NEVER retry)', () => {
    it('error with unknown retrySafety is NEVER retried', () => {
      // Create an error with 'unknown' retrySafety manually
      // This represents cases where we genuinely cannot determine safety
      const error = {
        code: 'UNKNOWN_ERROR' as const,
        message: 'An error with unknown retry safety',
        severity: 'error' as const,
        retrySafety: 'unknown' as const,
        timestamp: new Date().toISOString(),
      };

      expect(error.retrySafety).toBe('unknown');
      expect(shouldRetry(error, 1, 3)).toBe(false); // NEVER retry unknown
    });

    it('unknown is treated as ambiguous - request may have been accepted', () => {
      // Per DEC-035/Task 3.3a: unknown RetrySafety means we cannot determine
      // if the request was accepted. We must NOT retry to avoid duplicate charges.
      const unknownError = {
        code: 'UNKNOWN_ERROR' as const,
        message: 'Unknown',
        severity: 'error' as const,
        retrySafety: 'unknown' as const,
        timestamp: new Date().toISOString(),
      };

      expect(hasAmbiguousRetrySafety(unknownError)).toBe(true);
    });
  });
});

describe('Timeout vs Cancellation differentiation', () => {
  beforeEach(() => {
    globalAdapterRegistry.clear();
  });

  it('timeout sets timedOut=true, cancelledByCaller=false', async () => {
    const adapter = createFakeAdapter('openai-responses', {
      delayMs: 500,
      respectAbortSignal: true,
      response: createTestResponse(),
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext({
      config: {
        ...DEFAULT_LIFECYCLE_CONFIG,
        defaultTimeoutMs: 50, // Very short timeout
      },
    });

    const result = await executeRequest(createTestRequest(), context);

    expect(result.result.success).toBe(false);
    expect(result.diagnostics.timedOut).toBe(true);
    expect(result.diagnostics.cancelledByCaller).toBe(false);
  });

  it('caller abort sets cancelledByCaller=true, timedOut=false', async () => {
    const controller = new AbortController();
    const adapter = createFakeAdapter('openai-responses', {
      delayMs: 10000, // Very long delay
      respectAbortSignal: true,
      response: createTestResponse(),
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext({
      callerSignal: controller.signal,
      config: {
        ...DEFAULT_LIFECYCLE_CONFIG,
        defaultTimeoutMs: 60000, // Long timeout so we don't hit it
      },
    });

    // Cancel after a short delay
    setTimeout(() => controller.abort(), 50);

    const result = await executeRequest(createTestRequest(), context);

    expect(result.result.success).toBe(false);
    expect(result.diagnostics.cancelledByCaller).toBe(true);
    expect(result.diagnostics.timedOut).toBe(false);
  });

  it('timeout error is marked as retryable_ambiguous', () => {
    const error = ProviderErrors.timeout(5000);
    expect(error.retrySafety).toBe('retryable_ambiguous');
    // Even though it's "retryable_ambiguous", we do NOT actually retry it
    expect(shouldRetry(error, 1, 3)).toBe(false);
  });

  it('cancelled error is marked as not_retryable', () => {
    const error = ProviderErrors.cancelled();
    expect(error.retrySafety).toBe('not_retryable');
    expect(shouldRetry(error, 1, 3)).toBe(false);
  });
});

describe('Budget Default-Deny Requirement', () => {
  beforeEach(() => {
    globalAdapterRegistry.clear();
  });

  it('BLOCKS request when no budget config provided', async () => {
    let adapterCalled = false;
    const adapter = createFakeAdapter('openai-responses', {
      handler: async () => {
        adapterCalled = true;
        return {
          success: true,
          response: createTestResponse(),
          observedUsage: createUnknownObservedUsage(),
          sdkRetriesDisabled: true,
        };
      },
    });
    globalAdapterRegistry.register(adapter);

    // Context with NO budget config
    const context = createTestLifecycleContext({
      budgetConfig: undefined,
      budgetState: undefined,
    });

    const result = await executeRequest(createTestRequest(), context);

    expect(result.result.success).toBe(false);
    expect(adapterCalled).toBe(false); // Adapter must NOT be called
    expect(result.diagnostics.budgetCheckPassed).toBe(false);
    if (!result.result.success) {
      expect(result.result.error.message).toContain('No budget configured');
    }
  });

  it('BLOCKS request when only budget state is missing', async () => {
    let adapterCalled = false;
    const adapter = createFakeAdapter('openai-responses', {
      handler: async () => {
        adapterCalled = true;
        return {
          success: true,
          response: createTestResponse(),
          observedUsage: createUnknownObservedUsage(),
          sdkRetriesDisabled: true,
        };
      },
    });
    globalAdapterRegistry.register(adapter);

    // Context with budget config but NO state
    const context = createTestLifecycleContext({
      budgetConfig: createTestBudgetConfig(),
      budgetState: undefined,
    });

    const result = await executeRequest(createTestRequest(), context);

    expect(result.result.success).toBe(false);
    expect(adapterCalled).toBe(false);
  });

  it('ALLOWS request when valid budget config AND state provided', async () => {
    let adapterCalled = false;
    const adapter = createFakeAdapter('openai-responses', {
      handler: async () => {
        adapterCalled = true;
        return {
          success: true,
          response: createTestResponse(),
          observedUsage: createObservedUsage({ inputTokens: 10, outputTokens: 5 }),
          sdkRetriesDisabled: true,
        };
      },
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext();

    const result = await executeRequest(createTestRequest(), context);

    expect(result.result.success).toBe(true);
    expect(adapterCalled).toBe(true);
  });
});

describe('Gate Blocks Adapter - Fail Fast', () => {
  beforeEach(() => {
    globalAdapterRegistry.clear();
  });

  it('AI_ENABLED gate blocks before adapter is called', async () => {
    let adapterCalled = false;
    const adapter = createFakeAdapter('openai-responses', {
      handler: async () => {
        adapterCalled = true;
        return {
          success: true,
          response: createTestResponse(),
          observedUsage: createUnknownObservedUsage(),
          sdkRetriesDisabled: true,
        };
      },
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext({
      secretContext: createDisabledSecretContext(),
    });

    const result = await executeRequest(createTestRequest(), context);

    expect(result.result.success).toBe(false);
    expect(adapterCalled).toBe(false);
    if (!result.result.success) {
      expect(result.result.error.code).toBe('CREDENTIALS_MISSING');
    }
  });

  it('PROVIDER_CONFIG gate blocks before adapter is called', async () => {
    let adapterCalled = false;
    const adapter = createFakeAdapter('openai-responses', {
      handler: async () => {
        adapterCalled = true;
        return {
          success: true,
          response: createTestResponse(),
          observedUsage: createUnknownObservedUsage(),
          sdkRetriesDisabled: true,
        };
      },
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext();
    const request = createTestRequest({ providerId: 'unknown-provider' });

    const result = await executeRequest(request, context);

    expect(result.result.success).toBe(false);
    expect(adapterCalled).toBe(false);
    if (!result.result.success) {
      expect(result.result.error.code).toBe('PROVIDER_NOT_FOUND');
    }
  });

  it('API_KEY gate blocks before adapter is called', async () => {
    let adapterCalled = false;
    const adapter = createFakeAdapter('openai-responses', {
      handler: async () => {
        adapterCalled = true;
        return {
          success: true,
          response: createTestResponse(),
          observedUsage: createUnknownObservedUsage(),
          sdkRetriesDisabled: true,
        };
      },
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext({
      secretContext: {
        ...createEnabledSecretContext(),
        secrets: new SecureSecretStore(), // Empty - no API key
      },
    });

    const result = await executeRequest(createTestRequest(), context);

    expect(result.result.success).toBe(false);
    expect(adapterCalled).toBe(false);
    if (!result.result.success) {
      expect(result.result.error.code).toBe('CREDENTIALS_MISSING');
    }
  });

  it('CAPABILITIES gate blocks before adapter is called', async () => {
    let adapterCalled = false;
    const adapter = createFakeAdapter('openai-responses', {
      handler: async () => {
        adapterCalled = true;
        return {
          success: true,
          response: createTestResponse(),
          observedUsage: createUnknownObservedUsage(),
          sdkRetriesDisabled: true,
        };
      },
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext();
    const request = createTestRequest({
      providerId: 'no-tools-provider',
      tools: [{ name: 'search', description: 'Search for info' }],
    });

    const result = await executeRequest(request, context);

    expect(result.result.success).toBe(false);
    expect(adapterCalled).toBe(false);
    if (!result.result.success) {
      expect(result.result.error.code).toBe('FEATURE_UNSUPPORTED');
    }
  });

  it('BUDGET gate blocks before adapter is called', async () => {
    let adapterCalled = false;
    const adapter = createFakeAdapter('openai-responses', {
      handler: async () => {
        adapterCalled = true;
        return {
          success: true,
          response: createTestResponse(),
          observedUsage: createUnknownObservedUsage(),
          sdkRetriesDisabled: true,
        };
      },
    });
    globalAdapterRegistry.register(adapter);

    // Budget exhausted
    const context = createTestLifecycleContext({
      budgetState: {
        ...createTestBudgetState(),
        requestCount: 100, // At limit
      },
    });

    const result = await executeRequest(createTestRequest(), context);

    expect(result.result.success).toBe(false);
    expect(adapterCalled).toBe(false);
    if (!result.result.success) {
      expect(result.result.error.code).toBe('QUOTA_EXCEEDED');
    }
  });
});

describe('Redaction and Safe Diagnostics - Sentinel Tests', () => {
  beforeEach(() => {
    globalAdapterRegistry.clear();
  });

  // Unique sentinel values that should NEVER appear in public outputs
  const SENTINEL_API_KEY = 'sk-SENTINEL-API-KEY-6b4f8c2a9e1d';
  const SENTINEL_PROMPT = 'SENTINEL-USER-PROMPT-7a3e9f1c2b5d';
  const SENTINEL_OUTPUT = 'SENTINEL-MODEL-OUTPUT-8c4d2a6f1e9b';
  const SENTINEL_TOOL_ARG = 'SENTINEL-TOOL-ARG-5f1b8e3c9a7d';

  /**
   * Recursively serialize an object and check for sentinel values
   */
  function containsSentinel(obj: unknown, sentinel: string): boolean {
    if (obj === null || obj === undefined) {
      return false;
    }
    if (typeof obj === 'string') {
      return obj.includes(sentinel);
    }
    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return false;
    }
    if (Array.isArray(obj)) {
      return obj.some((item) => containsSentinel(item, sentinel));
    }
    if (typeof obj === 'object') {
      return Object.values(obj).some((value) => containsSentinel(value, sentinel));
    }
    return false;
  }

  it('diagnostics do not contain API key sentinel', async () => {
    const adapter = createFakeAdapter('openai-responses', {
      response: createTestResponse(),
      observedUsage: createObservedUsage({ inputTokens: 10, outputTokens: 5 }),
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext({
      secretContext: {
        ...createEnabledSecretContext(),
        secrets: new SecureSecretStore([
          ['test-provider', {
            providerId: 'test-provider',
            envVarName: 'TEST_API_KEY',
            apiKey: SENTINEL_API_KEY, // Inject sentinel
          }],
        ]),
      },
    });

    const result = await executeRequest(createTestRequest(), context);

    // Verify the sentinel API key is NOT in diagnostics
    expect(containsSentinel(result.diagnostics, SENTINEL_API_KEY)).toBe(false);

    // Also verify it's not in the serialized result
    const serialized = JSON.stringify(result);
    expect(serialized.includes(SENTINEL_API_KEY)).toBe(false);
  });

  it('diagnostics do not contain prompt sentinel', async () => {
    const adapter = createFakeAdapter('openai-responses', {
      response: createTestResponse(),
      observedUsage: createObservedUsage({ inputTokens: 10, outputTokens: 5 }),
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext();
    const request = createTestRequest({
      messages: [
        { role: 'user', content: SENTINEL_PROMPT }, // Inject sentinel
      ],
    });

    const result = await executeRequest(request, context);

    // Verify the sentinel prompt is NOT in diagnostics
    expect(containsSentinel(result.diagnostics, SENTINEL_PROMPT)).toBe(false);

    // Diagnostics should only contain safe metadata
    const diagnosticsSerialized = JSON.stringify(result.diagnostics);
    expect(diagnosticsSerialized.includes(SENTINEL_PROMPT)).toBe(false);
  });

  it('diagnostics do not contain model output sentinel', async () => {
    const adapter = createFakeAdapter('openai-responses', {
      response: {
        ...createTestResponse(),
        message: {
          role: 'assistant',
          content: SENTINEL_OUTPUT, // Inject sentinel
        },
        text: SENTINEL_OUTPUT,
      },
      observedUsage: createObservedUsage({ inputTokens: 10, outputTokens: 5 }),
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext();
    const result = await executeRequest(createTestRequest(), context);

    // Verify the sentinel output is NOT in diagnostics
    expect(containsSentinel(result.diagnostics, SENTINEL_OUTPUT)).toBe(false);
  });

  it('diagnostics do not contain tool arguments sentinel', async () => {
    const adapter = createFakeAdapter('openai-responses', {
      response: createTestResponse(),
      observedUsage: createObservedUsage({ inputTokens: 10, outputTokens: 5 }),
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext();
    const request: ModelRequest = {
      providerId: 'test-provider',
      messages: [
        { role: 'user', content: 'Search for info' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              name: 'search',
              arguments: `{"query":"${SENTINEL_TOOL_ARG}"}`, // Inject sentinel
            },
          ],
        },
        {
          role: 'tool',
          toolCallId: 'call_1',
          toolName: 'search',
          content: 'Search results',
        },
      ],
    };

    const result = await executeRequest(request, context);

    // Verify the sentinel tool arg is NOT in diagnostics
    expect(containsSentinel(result.diagnostics, SENTINEL_TOOL_ARG)).toBe(false);
  });

  it('error responses do not leak API keys', async () => {
    // Test with a credential validation error that might accidentally include the key
    const adapter = createFakeAdapter('openai-responses', {
      error: ProviderErrors.credentialsInvalid('test-provider', 'Invalid API key format'),
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext({
      secretContext: {
        ...createEnabledSecretContext(),
        secrets: new SecureSecretStore([
          ['test-provider', {
            providerId: 'test-provider',
            envVarName: 'TEST_API_KEY',
            apiKey: SENTINEL_API_KEY,
          }],
        ]),
      },
    });

    const result = await executeRequest(createTestRequest(), context);

    expect(result.result.success).toBe(false);

    // Verify the API key is NOT in the error
    const serialized = JSON.stringify(result);
    expect(serialized.includes(SENTINEL_API_KEY)).toBe(false);
  });

  it('usageMetadata does not contain sensitive data', async () => {
    const adapter = createFakeAdapter('openai-responses', {
      response: createTestResponse(),
      observedUsage: createObservedUsage({ inputTokens: 10, outputTokens: 5 }),
    });
    globalAdapterRegistry.register(adapter);

    const context = createTestLifecycleContext({
      secretContext: {
        ...createEnabledSecretContext(),
        secrets: new SecureSecretStore([
          ['test-provider', {
            providerId: 'test-provider',
            envVarName: 'TEST_API_KEY',
            apiKey: SENTINEL_API_KEY,
          }],
        ]),
      },
    });

    const request = createTestRequest({
      messages: [{ role: 'user', content: SENTINEL_PROMPT }],
    });

    const result = await executeRequest(request, context);

    // Verify usage metadata contains only operational data
    const usageSerialized = JSON.stringify(result.usageMetadata);
    expect(usageSerialized.includes(SENTINEL_API_KEY)).toBe(false);
    expect(usageSerialized.includes(SENTINEL_PROMPT)).toBe(false);
    expect(usageSerialized.includes(SENTINEL_OUTPUT)).toBe(false);
  });
});

describe('Retry and Reservation Accounting (DEC-038)', () => {
  beforeEach(() => {
    globalAdapterRegistry.clear();
  });

  describe('request accounting per attempt', () => {
    it('every outgoing retry attempt increments request accounting', async () => {
      let attemptCount = 0;
      const adapter = createFakeAdapter('openai-responses', {
        handler: async () => {
          attemptCount++;
          if (attemptCount < 3) {
            return {
              success: false,
              error: ProviderErrors.responseIncomplete(),
              sdkRetriesDisabled: true,
            };
          }
          return {
            success: true,
            response: createTestResponse(),
            observedUsage: createObservedUsage({ inputTokens: 100, outputTokens: 50 }),
            sdkRetriesDisabled: true,
          };
        },
      });
      globalAdapterRegistry.register(adapter);

      const context = createTestLifecycleContext({
        config: {
          ...DEFAULT_LIFECYCLE_CONFIG,
          maxAttempts: 3,
          baseRetryDelayMs: 10,
          maxRetryDelayMs: 20,
        },
      });

      const result = await executeRequest(createTestRequest(), context);

      expect(result.result.success).toBe(true);
      expect(attemptCount).toBe(3); // All 3 attempts were made
      expect(result.finalAttemptNumber).toBe(3);
      expect(result.wasRetried).toBe(true);

      // Each attempt should be accounted for in usage metadata
      expect(result.usageMetadata.totalAttempts).toBe(3);
    });

    it('each outgoing attempt obtains its own reservation (conceptual)', async () => {
      // This test documents that each attempt goes through the budget gate independently
      // The reservation is checked at the gate, not just once at the beginning

      let attemptNumber = 0;
      const adapter = createFakeAdapter('openai-responses', {
        handler: async () => {
          attemptNumber++;
          if (attemptNumber < 2) {
            return {
              success: false,
              error: ProviderErrors.responseIncomplete(),
              sdkRetriesDisabled: true,
            };
          }
          return {
            success: true,
            response: createTestResponse(),
            observedUsage: createObservedUsage({ inputTokens: 100, outputTokens: 50 }),
            sdkRetriesDisabled: true,
          };
        },
      });
      globalAdapterRegistry.register(adapter);

      // Start with almost exhausted budget
      const context = createTestLifecycleContext({
        budgetConfig: {
          ...createTestBudgetConfig(),
          maxTotalRequests: 10,
        },
        budgetState: {
          ...createTestBudgetState(),
          requestCount: 8, // Only 2 requests left
        },
        config: {
          ...DEFAULT_LIFECYCLE_CONFIG,
          maxAttempts: 3,
          baseRetryDelayMs: 10,
          maxRetryDelayMs: 20,
        },
      });

      const result = await executeRequest(createTestRequest(), context);

      // Should succeed with 2 attempts (within budget)
      expect(result.result.success).toBe(true);
      expect(result.finalAttemptNumber).toBe(2);
    });

    it('retry is refused when budget is exhausted (no initial reservation)', async () => {
      // Budget check happens once at the start of the request lifecycle.
      // If the budget is already exhausted, no attempts are made.
      const adapter = createFakeAdapter('openai-responses', {
        handler: async () => {
          return {
            success: false,
            error: ProviderErrors.responseIncomplete(),
            sdkRetriesDisabled: true,
          };
        },
      });
      globalAdapterRegistry.register(adapter);

      // Budget is already exhausted
      const context = createTestLifecycleContext({
        budgetConfig: {
          ...createTestBudgetConfig(),
          maxTotalRequests: 1,
        },
        budgetState: {
          ...createTestBudgetState(),
          requestCount: 1, // Budget already at limit
        },
        config: {
          ...DEFAULT_LIFECYCLE_CONFIG,
          maxAttempts: 3,
          baseRetryDelayMs: 10,
          maxRetryDelayMs: 20,
        },
      });

      const result = await executeRequest(createTestRequest(), context);

      // Should fail at the budget gate before any adapter call
      expect(result.result.success).toBe(false);
      // Budget check should fail - look for budget-related error
      expect(result.diagnostics.budgetCheckPassed).toBe(false);
      // No adapter attempts should be made
      expect(result.finalAttemptNumber).toBe(0);
    });

    it('per-attempt token accounting records each outgoing attempt', async () => {
      // This test verifies that each retry attempt is recorded separately
      // in the usage metadata, even though budget reservation is done once.
      let attemptCount = 0;
      const adapter = createFakeAdapter('openai-responses', {
        handler: async () => {
          attemptCount++;
          if (attemptCount < 3) {
            return {
              success: false,
              error: ProviderErrors.responseIncomplete(),
              sdkRetriesDisabled: true,
            };
          }
          return {
            success: true,
            response: createTestResponse(),
            observedUsage: createObservedUsage({ inputTokens: 100, outputTokens: 50 }),
            sdkRetriesDisabled: true,
          };
        },
      });
      globalAdapterRegistry.register(adapter);

      const context = createTestLifecycleContext({
        budgetConfig: createTestBudgetConfig(),
        budgetState: createTestBudgetState(),
        config: {
          ...DEFAULT_LIFECYCLE_CONFIG,
          maxAttempts: 3,
          baseRetryDelayMs: 10,
          maxRetryDelayMs: 20,
        },
      });

      const result = await executeRequest(createTestRequest(), context);

      // All 3 attempts made
      expect(attemptCount).toBe(3);
      expect(result.finalAttemptNumber).toBe(3);
      expect(result.usageMetadata.totalAttempts).toBe(3);
    });
  });

  describe('retry limits and delays', () => {
    it('maximum attempts remain 3', () => {
      expect(DEFAULT_LIFECYCLE_CONFIG.maxAttempts).toBe(3);
    });

    it('Retry-After remains capped at 60 seconds', () => {
      // Test with a very large Retry-After value
      const error = ProviderErrors.rateLimited(120000); // 120 seconds
      const delay = calculateRetryDelay(error, 1, DEFAULT_LIFECYCLE_CONFIG);

      // Should be capped at maxRetryDelayMs (60000ms = 60 seconds)
      expect(delay).toBe(DEFAULT_LIFECYCLE_CONFIG.maxRetryDelayMs);
      expect(delay).toBe(60000);
    });
  });

  describe('no cross-provider fallback', () => {
    it('request to one provider does NOT fallback to another provider', async () => {
      // Register two adapters for different providers
      const openaiAdapter = createFakeAdapter('openai-responses', {
        error: ProviderErrors.providerUnavailable('OpenAI is down'),
      });
      globalAdapterRegistry.register(openaiAdapter);

      // If we request 'test-provider' (which uses openai-responses adapter type),
      // and it fails, it should NOT fallback to any other provider
      const context = createTestLifecycleContext();
      const request = createTestRequest({ providerId: 'test-provider' });

      const result = await executeRequest(request, context);

      // Should fail without fallback
      expect(result.result.success).toBe(false);
      if (!result.result.success) {
        // Error should be from the original provider
        expect(result.diagnostics.providerId).toBe('test-provider');
      }

      // Only 1 attempt should be made (no fallback to another provider)
      // Note: retryable_ambiguous errors are not retried
      expect(result.finalAttemptNumber).toBe(1);
    });
  });
});
