/**
 * Tests for provider adapter interface.
 *
 * Task 3.3a: Test adapter interface, fake adapters, and registry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createFakeAdapter,
  isAdapterSuccess,
  isAdapterError,
  AdapterRegistry,
  globalAdapterRegistry,
  type AdapterContext,
  type AdapterResult,
} from '../../../src/model-providers/adapter-interface.js';
import {
  ProviderErrors,
} from '../../../src/model-providers/errors.js';
import {
  createObservedUsage,
  createUnknownObservedUsage,
} from '../../../src/model-providers/usage.js';
import type { ModelRequest } from '../../../src/model-providers/request.js';
import type { ModelResponse } from '../../../src/model-providers/response.js';
import type { ProviderConfig, DeclaredCapabilities } from '../../../src/model-providers/types.js';

// Test fixtures
function createTestRequest(): ModelRequest {
  return {
    providerId: 'test-provider',
    modelId: 'test-model',
    messages: [
      { role: 'user', content: 'Hello' },
    ],
  };
}

function createTestContext(overrides?: Partial<AdapterContext>): AdapterContext {
  return {
    providerConfig: createTestProviderConfig(),
    apiKey: 'test-key-never-log',
    signal: new AbortController().signal,
    isCancellation: false,
    options: { timeoutMs: 30000 },
    platformRequestId: 'req-123',
    attemptNumber: 1,
    ...overrides,
  };
}

function createTestProviderConfig(): ProviderConfig {
  return {
    providerId: 'test-provider',
    adapterType: 'openai-responses',
    defaultModelId: 'test-model',
    apiKeyEnvVar: 'TEST_API_KEY',
    capabilities: createTestCapabilities(),
  };
}

function createTestCapabilities(): DeclaredCapabilities {
  return {
    toolCalling: 'supported',
    strictJsonSchema: 'unknown',
    schemaKeywords: {
      baseTypes: 'supported',
      objectKeywords: 'supported',
      arrayKeywords: 'supported',
      stringValidation: 'supported',
      numericValidation: 'supported',
      compositionKeywords: 'unknown',
      referenceKeywords: 'unknown',
    },
    usageReporting: 'supported',
    reasoning: 'unknown',
    continuationRequired: 'unknown',
    streaming: 'supported',
    imageInput: 'unsupported',
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

describe('AdapterResult type guards', () => {
  describe('isAdapterSuccess', () => {
    it('returns true for success result', () => {
      const result: AdapterResult = {
        success: true,
        response: createTestResponse(),
        observedUsage: createUnknownObservedUsage(),
        sdkRetriesDisabled: true,
      };

      expect(isAdapterSuccess(result)).toBe(true);
    });

    it('returns false for error result', () => {
      const result: AdapterResult = {
        success: false,
        error: ProviderErrors.timeout(5000),
        sdkRetriesDisabled: true,
      };

      expect(isAdapterSuccess(result)).toBe(false);
    });
  });

  describe('isAdapterError', () => {
    it('returns true for error result', () => {
      const result: AdapterResult = {
        success: false,
        error: ProviderErrors.timeout(5000),
        sdkRetriesDisabled: true,
      };

      expect(isAdapterError(result)).toBe(true);
    });

    it('returns false for success result', () => {
      const result: AdapterResult = {
        success: true,
        response: createTestResponse(),
        observedUsage: createUnknownObservedUsage(),
        sdkRetriesDisabled: true,
      };

      expect(isAdapterError(result)).toBe(false);
    });
  });
});

describe('createFakeAdapter', () => {
  it('creates adapter with specified type', () => {
    const adapter = createFakeAdapter('openai-responses', {});

    expect(adapter.adapterType).toBe('openai-responses');
    expect(adapter.displayName).toBe('Fake openai-responses');
  });

  describe('behavior: response', () => {
    it('returns configured response on success', async () => {
      const response = createTestResponse();
      const adapter = createFakeAdapter('openai-responses', { response });

      const result = await adapter.execute(createTestRequest(), createTestContext());

      expect(isAdapterSuccess(result)).toBe(true);
      if (isAdapterSuccess(result)) {
        expect(result.response).toBe(response);
        expect(result.sdkRetriesDisabled).toBe(true);
      }
    });

    it('includes observed usage if provided', async () => {
      const response = createTestResponse();
      const observedUsage = createObservedUsage({
        inputTokens: 100,
        outputTokens: 50,
      });
      const adapter = createFakeAdapter('openai-responses', { response, observedUsage });

      const result = await adapter.execute(createTestRequest(), createTestContext());

      expect(isAdapterSuccess(result)).toBe(true);
      if (isAdapterSuccess(result)) {
        expect(result.observedUsage).toBe(observedUsage);
      }
    });

    it('defaults to unknown usage if not provided', async () => {
      const response = createTestResponse();
      const adapter = createFakeAdapter('openai-responses', { response });

      const result = await adapter.execute(createTestRequest(), createTestContext());

      expect(isAdapterSuccess(result)).toBe(true);
      if (isAdapterSuccess(result)) {
        expect(result.observedUsage).toBeDefined();
        expect(result.observedUsage.inputTokens.known).toBe(false);
      }
    });
  });

  describe('behavior: error', () => {
    it('returns configured error on failure', async () => {
      const error = ProviderErrors.rateLimited(5000);
      const adapter = createFakeAdapter('anthropic-messages', { error });

      const result = await adapter.execute(createTestRequest(), createTestContext());

      expect(isAdapterError(result)).toBe(true);
      if (isAdapterError(result)) {
        expect(result.error).toBe(error);
        expect(result.sdkRetriesDisabled).toBe(true);
      }
    });
  });

  describe('behavior: delay', () => {
    it('delays before returning', async () => {
      const response = createTestResponse();
      const adapter = createFakeAdapter('openai-responses', {
        response,
        delayMs: 50,
      });

      const start = Date.now();
      await adapter.execute(createTestRequest(), createTestContext());
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some timing variance
    });

    it('respects abort signal when configured', async () => {
      const response = createTestResponse();
      const adapter = createFakeAdapter('openai-responses', {
        response,
        delayMs: 1000,
        respectAbortSignal: true,
      });

      const controller = new AbortController();
      const context = createTestContext({ signal: controller.signal });

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50);

      const result = await adapter.execute(createTestRequest(), context);

      expect(isAdapterError(result)).toBe(true);
      if (isAdapterError(result)) {
        expect(result.error.code).toBe('CANCELLED');
      }
    });
  });

  describe('behavior: handler', () => {
    it('uses custom handler when provided', async () => {
      const customHandler = vi.fn().mockResolvedValue({
        success: true,
        response: createTestResponse(),
        observedUsage: createUnknownObservedUsage(),
        sdkRetriesDisabled: true,
      } as AdapterResult);

      const adapter = createFakeAdapter('google-gemini', {
        handler: customHandler,
        response: createTestResponse(), // Should be ignored
      });

      const request = createTestRequest();
      const context = createTestContext();
      await adapter.execute(request, context);

      expect(customHandler).toHaveBeenCalledWith(request, context);
    });
  });

  describe('behavior: no behavior', () => {
    it('returns error when no behavior configured', async () => {
      const adapter = createFakeAdapter('openai-responses', {});

      const result = await adapter.execute(createTestRequest(), createTestContext());

      expect(isAdapterError(result)).toBe(true);
      if (isAdapterError(result)) {
        expect(result.error.code).toBe('UNKNOWN_ERROR');
        expect(result.error.message).toContain('no behavior configured');
      }
    });
  });
});

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  it('registers and retrieves adapters', () => {
    const adapter = createFakeAdapter('openai-responses', {});
    registry.register(adapter);

    expect(registry.get('openai-responses')).toBe(adapter);
  });

  it('returns undefined for unregistered types', () => {
    expect(registry.get('anthropic-messages')).toBeUndefined();
  });

  it('checks if adapter type is registered', () => {
    const adapter = createFakeAdapter('openai-responses', {});
    registry.register(adapter);

    expect(registry.has('openai-responses')).toBe(true);
    expect(registry.has('anthropic-messages')).toBe(false);
  });

  it('lists all registered types', () => {
    registry.register(createFakeAdapter('openai-responses', {}));
    registry.register(createFakeAdapter('anthropic-messages', {}));

    const types = registry.types();

    expect(types).toContain('openai-responses');
    expect(types).toContain('anthropic-messages');
    expect(types).toHaveLength(2);
  });

  it('overwrites existing adapter on re-register', () => {
    const adapter1 = createFakeAdapter('openai-responses', {});
    const adapter2 = createFakeAdapter('openai-responses', {});

    registry.register(adapter1);
    registry.register(adapter2);

    expect(registry.get('openai-responses')).toBe(adapter2);
    expect(registry.types()).toHaveLength(1);
  });

  it('clears all adapters', () => {
    registry.register(createFakeAdapter('openai-responses', {}));
    registry.register(createFakeAdapter('anthropic-messages', {}));

    registry.clear();

    expect(registry.types()).toHaveLength(0);
    expect(registry.has('openai-responses')).toBe(false);
  });
});

describe('globalAdapterRegistry', () => {
  beforeEach(() => {
    globalAdapterRegistry.clear();
  });

  it('is an instance of AdapterRegistry', () => {
    expect(globalAdapterRegistry).toBeInstanceOf(AdapterRegistry);
  });

  it('can register and retrieve adapters', () => {
    const adapter = createFakeAdapter('google-gemini', {});
    globalAdapterRegistry.register(adapter);

    expect(globalAdapterRegistry.get('google-gemini')).toBe(adapter);
  });
});

describe('Adapter contract compliance', () => {
  it('adapter must always report sdkRetriesDisabled: true', async () => {
    // Success case
    const successAdapter = createFakeAdapter('openai-responses', {
      response: createTestResponse(),
    });
    const successResult = await successAdapter.execute(createTestRequest(), createTestContext());
    expect(successResult.sdkRetriesDisabled).toBe(true);

    // Error case
    const errorAdapter = createFakeAdapter('openai-responses', {
      error: ProviderErrors.rateLimited(),
    });
    const errorResult = await errorAdapter.execute(createTestRequest(), createTestContext());
    expect(errorResult.sdkRetriesDisabled).toBe(true);
  });

  it('context includes all required fields for adapter', () => {
    const context = createTestContext();

    // All these fields must be present for adapter to work
    expect(context.providerConfig).toBeDefined();
    expect(context.apiKey).toBeDefined();
    expect(context.signal).toBeDefined();
    expect(typeof context.isCancellation).toBe('boolean');
    expect(context.options).toBeDefined();
    expect(context.platformRequestId).toBeDefined();
    expect(typeof context.attemptNumber).toBe('number');
  });

  it('error result may include partial usage and provider request ID', async () => {
    const adapter = createFakeAdapter('openai-responses', {
      handler: async () => ({
        success: false,
        error: ProviderErrors.timeout(5000),
        partialUsage: {
          inputTokens: { known: true, value: 100 },
        },
        providerRequestId: 'provider-req-456',
        sdkRetriesDisabled: true,
      }),
    });

    const result = await adapter.execute(createTestRequest(), createTestContext());

    expect(isAdapterError(result)).toBe(true);
    if (isAdapterError(result)) {
      expect(result.partialUsage).toBeDefined();
      expect(result.providerRequestId).toBe('provider-req-456');
    }
  });
});
