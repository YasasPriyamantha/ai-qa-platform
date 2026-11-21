/**
 * Tests for opaque continuation state.
 *
 * Tests:
 * - Continuation state creation and preservation
 * - Provider/model mismatch detection
 * - Continuation registry operations
 * - Serialization security (JSON.stringify, util.inspect, String)
 * - Payload access control via identity verification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { inspect } from 'node:util';
import {
  createContinuationState,
  checkContinuationCompatibility,
  generateContinuationRef,
  ContinuationStateRegistry,
  describeContinuationState,
  SecureContinuationState,
  type ProviderIdentity,
} from '../../../src/model-providers/index.js';

describe('createContinuationState', () => {
  const identity: ProviderIdentity = {
    providerId: 'openai-prod',
    adapterType: 'openai-responses',
    modelId: 'gpt-4o',
  };

  it('creates state with identity', () => {
    const payload = { reasoning: ['step1', 'step2'], encrypted: 'abc123' };
    const state = createContinuationState(identity, payload);

    expect(state.identity).toEqual(identity);
    expect(state.createdAt).toBeDefined();
    expect(state.version).toBeUndefined();
  });

  it('creates state with version marker', () => {
    const state = createContinuationState(identity, { data: 'test' }, 2);

    expect(state.version).toBe(2);
  });

  it('freezes the identity object', () => {
    const state = createContinuationState(identity, {});

    expect(Object.isFrozen(state.identity)).toBe(true);
  });

  it('protects identity from external mutation of original object', () => {
    // Create a mutable identity object
    const mutableIdentity: ProviderIdentity = {
      providerId: 'original-provider',
      adapterType: 'openai-responses',
      modelId: 'original-model',
    };

    // Create state with the mutable identity
    const state = createContinuationState(mutableIdentity, { secret: 'payload' });

    // Verify initial identity
    expect(state.identity.providerId).toBe('original-provider');
    expect(state.identity.modelId).toBe('original-model');

    // Mutate the original identity object (TypeScript allows this at runtime)
    (mutableIdentity as { providerId: string }).providerId = 'mutated-provider';
    (mutableIdentity as { modelId: string }).modelId = 'mutated-model';

    // State identity must NOT be affected by external mutation
    expect(state.identity.providerId).toBe('original-provider');
    expect(state.identity.modelId).toBe('original-model');

    // Payload access must still work with original identity values
    const access = state.getPayload({
      providerId: 'original-provider',
      adapterType: 'openai-responses',
      modelId: 'original-model',
    });
    expect(access.granted).toBe(true);
  });

  it('returns SecureContinuationState instance', () => {
    const state = createContinuationState(identity, { data: 'test' });

    expect(state).toBeInstanceOf(SecureContinuationState);
  });
});

describe('SecureContinuationState.getPayload', () => {
  const identity: ProviderIdentity = {
    providerId: 'openai-prod',
    adapterType: 'openai-responses',
    modelId: 'gpt-4o',
  };

  it('grants access with matching identity', () => {
    const payload = { reasoning: ['step1', 'step2'], encrypted: 'abc123' };
    const state = createContinuationState(identity, payload);

    const result = state.getPayload(identity);

    expect(result.granted).toBe(true);
    expect(result.payload).toBe(payload);
    expect(result.reason).toBeUndefined();
  });

  it('preserves opaque payload exactly', () => {
    // Test with various payload types
    const stringPayload = 'raw-encrypted-bytes';
    const objectPayload = { nested: { deep: { value: [1, 2, 3] } } };
    const arrayPayload = [1, 'two', { three: 3 }];
    const nullPayload = null;

    expect(createContinuationState(identity, stringPayload).getPayload(identity).payload).toBe(stringPayload);
    expect(createContinuationState(identity, objectPayload).getPayload(identity).payload).toEqual(objectPayload);
    expect(createContinuationState(identity, arrayPayload).getPayload(identity).payload).toEqual(arrayPayload);
    expect(createContinuationState(identity, nullPayload).getPayload(identity).payload).toBe(nullPayload);
  });

  it('denies access with mismatched provider ID', () => {
    const payload = { secret: 'data' };
    const state = createContinuationState(identity, payload);
    const wrongIdentity: ProviderIdentity = {
      ...identity,
      providerId: 'anthropic-prod',
    };

    const result = state.getPayload(wrongIdentity);

    expect(result.granted).toBe(false);
    expect(result.payload).toBeUndefined();
    expect(result.reason).toBe('provider_mismatch');
  });

  it('denies access with mismatched adapter type', () => {
    const payload = { secret: 'data' };
    const state = createContinuationState(identity, payload);
    const wrongIdentity: ProviderIdentity = {
      ...identity,
      adapterType: 'openai-chat-completions',
    };

    const result = state.getPayload(wrongIdentity);

    expect(result.granted).toBe(false);
    expect(result.payload).toBeUndefined();
    expect(result.reason).toBe('adapter_mismatch');
  });

  it('denies access with mismatched model ID', () => {
    const payload = { secret: 'data' };
    const state = createContinuationState(identity, payload);
    const wrongIdentity: ProviderIdentity = {
      ...identity,
      modelId: 'gpt-4o-mini',
    };

    const result = state.getPayload(wrongIdentity);

    expect(result.granted).toBe(false);
    expect(result.payload).toBeUndefined();
    expect(result.reason).toBe('model_mismatch');
  });

  it('denial reason does not expose payload', () => {
    const payload = { secret_key: 'SUPER_SECRET_VALUE_12345' };
    const state = createContinuationState(identity, payload);
    const wrongIdentity: ProviderIdentity = {
      providerId: 'different',
      adapterType: 'anthropic-messages',
      modelId: 'claude',
    };

    const result = state.getPayload(wrongIdentity);

    expect(result.granted).toBe(false);
    expect(String(result.reason)).not.toContain('secret');
    expect(String(result.reason)).not.toContain('SUPER_SECRET');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('SUPER_SECRET');
  });
});

describe('checkContinuationCompatibility', () => {
  const baseIdentity: ProviderIdentity = {
    providerId: 'openai-prod',
    adapterType: 'openai-responses',
    modelId: 'gpt-4o',
  };

  it('returns compatible for exact match', () => {
    const state = createContinuationState(baseIdentity, { test: 'data' });
    const result = checkContinuationCompatibility(state, baseIdentity);

    expect(result.compatible).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('detects provider mismatch', () => {
    const state = createContinuationState(baseIdentity, { test: 'data' });
    const differentProvider: ProviderIdentity = {
      ...baseIdentity,
      providerId: 'openai-dev',
    };
    const result = checkContinuationCompatibility(state, differentProvider);

    expect(result.compatible).toBe(false);
    expect(result.reason).toBe('provider_mismatch');
  });

  it('detects adapter mismatch', () => {
    const state = createContinuationState(baseIdentity, { test: 'data' });
    const differentAdapter: ProviderIdentity = {
      ...baseIdentity,
      adapterType: 'openai-chat-completions',
    };
    const result = checkContinuationCompatibility(state, differentAdapter);

    expect(result.compatible).toBe(false);
    expect(result.reason).toBe('adapter_mismatch');
  });

  it('detects model mismatch', () => {
    const state = createContinuationState(baseIdentity, { test: 'data' });
    const differentModel: ProviderIdentity = {
      ...baseIdentity,
      modelId: 'gpt-4o-mini',
    };
    const result = checkContinuationCompatibility(state, differentModel);

    expect(result.compatible).toBe(false);
    expect(result.reason).toBe('model_mismatch');
  });

  it('checks all fields for compatibility', () => {
    const state = createContinuationState(baseIdentity, { test: 'data' });
    const completelyDifferent: ProviderIdentity = {
      providerId: 'anthropic-prod',
      adapterType: 'anthropic-messages',
      modelId: 'claude-3-opus',
    };
    const result = checkContinuationCompatibility(state, completelyDifferent);

    expect(result.compatible).toBe(false);
    // Should fail on first check (provider)
    expect(result.reason).toBe('provider_mismatch');
  });
});

describe('generateContinuationRef', () => {
  it('generates unique references', () => {
    const refs = new Set<string>();
    for (let i = 0; i < 100; i++) {
      refs.add(generateContinuationRef());
    }
    // All should be unique
    expect(refs.size).toBe(100);
  });

  it('generates refs starting with cont_', () => {
    const ref = generateContinuationRef();
    expect(ref.startsWith('cont_')).toBe(true);
  });
});

describe('ContinuationStateRegistry', () => {
  let registry: ContinuationStateRegistry;
  const identity: ProviderIdentity = {
    providerId: 'test-provider',
    adapterType: 'openai-responses',
    modelId: 'test-model',
  };

  beforeEach(() => {
    registry = new ContinuationStateRegistry();
  });

  it('starts empty', () => {
    expect(registry.size).toBe(0);
  });

  describe('register', () => {
    it('registers state and returns reference', () => {
      const state = createContinuationState(identity, { data: 'test' });
      const ref = registry.register(state);

      expect(ref).toBeDefined();
      expect(typeof ref).toBe('string');
      expect(registry.size).toBe(1);
    });

    it('generates unique references for each registration', () => {
      const state1 = createContinuationState(identity, { data: '1' });
      const state2 = createContinuationState(identity, { data: '2' });

      const ref1 = registry.register(state1);
      const ref2 = registry.register(state2);

      expect(ref1).not.toBe(ref2);
      expect(registry.size).toBe(2);
    });
  });

  describe('get', () => {
    it('retrieves registered state by reference', () => {
      const payload = { important: 'payload' };
      const state = createContinuationState(identity, payload);
      const ref = registry.register(state);

      const retrieved = registry.get(ref);

      expect(retrieved).toBe(state);
      // Payload is accessible via getPayload with correct identity
      expect(retrieved?.getPayload(identity).payload).toEqual(payload);
    });

    it('returns undefined for unknown reference', () => {
      const result = registry.get('nonexistent_ref');
      expect(result).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true for registered reference', () => {
      const state = createContinuationState(identity, {});
      const ref = registry.register(state);

      expect(registry.has(ref)).toBe(true);
    });

    it('returns false for unknown reference', () => {
      expect(registry.has('unknown')).toBe(false);
    });
  });

  describe('remove', () => {
    it('removes registered state', () => {
      const state = createContinuationState(identity, {});
      const ref = registry.register(state);

      expect(registry.has(ref)).toBe(true);

      const removed = registry.remove(ref);

      expect(removed).toBe(true);
      expect(registry.has(ref)).toBe(false);
      expect(registry.size).toBe(0);
    });

    it('returns false when removing unknown reference', () => {
      const removed = registry.remove('unknown');
      expect(removed).toBe(false);
    });
  });

  describe('clear', () => {
    it('removes all states', () => {
      registry.register(createContinuationState(identity, { data: '1' }));
      registry.register(createContinuationState(identity, { data: '2' }));
      registry.register(createContinuationState(identity, { data: '3' }));

      expect(registry.size).toBe(3);

      registry.clear();

      expect(registry.size).toBe(0);
    });
  });

  describe('clearIncompatible', () => {
    const openaiIdentity: ProviderIdentity = {
      providerId: 'openai',
      adapterType: 'openai-responses',
      modelId: 'gpt-4o',
    };

    const anthropicIdentity: ProviderIdentity = {
      providerId: 'anthropic',
      adapterType: 'anthropic-messages',
      modelId: 'claude-3-opus',
    };

    it('clears states that do not match target identity', () => {
      const openaiState = createContinuationState(openaiIdentity, { openai: true });
      const anthropicState = createContinuationState(anthropicIdentity, { anthropic: true });

      const openaiRef = registry.register(openaiState);
      const anthropicRef = registry.register(anthropicState);

      expect(registry.size).toBe(2);

      const cleared = registry.clearIncompatible(openaiIdentity);

      expect(cleared).toBe(1);
      expect(registry.size).toBe(1);
      expect(registry.has(openaiRef)).toBe(true);
      expect(registry.has(anthropicRef)).toBe(false);
    });

    it('keeps all states when all match', () => {
      registry.register(createContinuationState(openaiIdentity, { v: 1 }));
      registry.register(createContinuationState(openaiIdentity, { v: 2 }));

      const cleared = registry.clearIncompatible(openaiIdentity);

      expect(cleared).toBe(0);
      expect(registry.size).toBe(2);
    });

    it('clears all states when none match', () => {
      registry.register(createContinuationState(openaiIdentity, { v: 1 }));
      registry.register(createContinuationState(openaiIdentity, { v: 2 }));

      const cleared = registry.clearIncompatible(anthropicIdentity);

      expect(cleared).toBe(2);
      expect(registry.size).toBe(0);
    });
  });
});

describe('describeContinuationState', () => {
  it('describes state without exposing payload', () => {
    const state = createContinuationState(
      {
        providerId: 'openai-prod',
        adapterType: 'openai-responses',
        modelId: 'gpt-4o',
      },
      { secret: 'sensitive-data', encrypted: 'more-secrets' }
    );

    const description = describeContinuationState(state);

    expect(description).toContain('provider=openai-prod');
    expect(description).toContain('adapter=openai-responses');
    expect(description).toContain('model=gpt-4o');
    expect(description).toContain('created=');
    // Must NOT contain payload data
    expect(description).not.toContain('secret');
    expect(description).not.toContain('sensitive-data');
    expect(description).not.toContain('encrypted');
  });

  it('includes version when present', () => {
    const state = createContinuationState(
      { providerId: 'test', adapterType: 'openai-responses', modelId: 'model' },
      {},
      3
    );

    const description = describeContinuationState(state);

    expect(description).toContain('version=3');
  });
});

describe('Continuation state serialization security', () => {
  const sensitivePayload = {
    encrypted_reasoning: 'AES256_ENCRYPTED_CONTENT_abc123xyz',
    thinking_blocks: ['internal thought 1', 'internal thought 2'],
    redacted_thinking: 'REDACTED_CONTENT_should_never_appear',
    api_internal_state: { token: 'secret_token_12345' },
  };

  const identity: ProviderIdentity = {
    providerId: 'test',
    adapterType: 'openai-responses',
    modelId: 'model',
  };

  describe('JSON.stringify security', () => {
    it('JSON.stringify(state) does not expose payload', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const json = JSON.stringify(state);

      // Must NOT contain any payload content
      expect(json).not.toContain('encrypted_reasoning');
      expect(json).not.toContain('AES256_ENCRYPTED_CONTENT');
      expect(json).not.toContain('thinking_blocks');
      expect(json).not.toContain('internal thought');
      expect(json).not.toContain('redacted_thinking');
      expect(json).not.toContain('REDACTED_CONTENT');
      expect(json).not.toContain('api_internal_state');
      expect(json).not.toContain('secret_token');

      // Should contain safe metadata
      expect(json).toContain('_redacted');
      expect(json).toContain('identity');
    });

    it('JSON.stringify(message with continuationRef) does not expose payload', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const registry = new ContinuationStateRegistry();
      const ref = registry.register(state);

      // Simulate an assistant message with continuation reference
      const message = {
        role: 'assistant',
        content: 'Some response',
        continuationRef: ref,
      };

      const json = JSON.stringify(message);

      expect(json).not.toContain('encrypted_reasoning');
      expect(json).not.toContain('secret_token');
    });

    it('JSON.stringify(request with continuation state) does not expose payload', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const registry = new ContinuationStateRegistry();
      const ref = registry.register(state);

      // Simulate a model request
      const request = {
        providerId: 'test',
        messages: [{ role: 'user', content: 'Hello' }],
        continuationRef: ref,
        // Include the state directly to verify it's safe
        _testState: state,
      };

      const json = JSON.stringify(request);

      expect(json).not.toContain('encrypted_reasoning');
      expect(json).not.toContain('secret_token');
    });
  });

  describe('util.inspect security', () => {
    it('util.inspect(state) does not expose payload', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const inspected = inspect(state);

      expect(inspected).not.toContain('encrypted_reasoning');
      expect(inspected).not.toContain('AES256_ENCRYPTED_CONTENT');
      expect(inspected).not.toContain('thinking_blocks');
      expect(inspected).not.toContain('secret_token');

      // Should contain safe identity info
      expect(inspected).toContain('ContinuationState');
      expect(inspected).toContain('provider=test');
    });

    it('util.inspect(request with state) does not expose payload', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const request = {
        providerId: 'test',
        messages: [],
        _testState: state,
      };

      const inspected = inspect(request, { depth: 10 });

      expect(inspected).not.toContain('encrypted_reasoning');
      expect(inspected).not.toContain('secret_token');
    });

    it('util.inspect with depth does not expose payload', () => {
      const state = createContinuationState(identity, sensitivePayload);

      // Try various depths
      for (const depth of [0, 1, 5, 10, Infinity]) {
        const inspected = inspect(state, { depth });
        expect(inspected).not.toContain('encrypted_reasoning');
        expect(inspected).not.toContain('secret_token');
      }
    });
  });

  describe('String() security', () => {
    it('String(state) does not expose payload', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const str = String(state);

      expect(str).not.toContain('encrypted_reasoning');
      expect(str).not.toContain('secret_token');
      expect(str).toContain('ContinuationState');
    });

    it('state.toString() does not expose payload', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const str = state.toString();

      expect(str).not.toContain('encrypted_reasoning');
      expect(str).not.toContain('secret_token');
      expect(str).toContain('ContinuationState');
    });

    it('template literal does not expose payload', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const str = `State: ${state}`;

      expect(str).not.toContain('encrypted_reasoning');
      expect(str).not.toContain('secret_token');
    });
  });

  describe('Error message security', () => {
    it('checkContinuationCompatibility result does not expose payload', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const differentIdentity: ProviderIdentity = {
        providerId: 'different',
        adapterType: 'anthropic-messages',
        modelId: 'claude',
      };

      const result = checkContinuationCompatibility(state, differentIdentity);

      expect(result.compatible).toBe(false);
      expect(String(result.reason)).not.toContain('encrypted');
      expect(String(result.reason)).not.toContain('secret_token');
      expect(JSON.stringify(result)).not.toContain('encrypted');
    });

    it('getPayload denial does not expose payload', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const wrongIdentity: ProviderIdentity = {
        providerId: 'wrong',
        adapterType: 'anthropic-messages',
        modelId: 'wrong',
      };

      const result = state.getPayload(wrongIdentity);

      expect(result.granted).toBe(false);
      expect(String(result.reason)).not.toContain('encrypted');
      expect(String(result.reason)).not.toContain('secret_token');
    });

    it('describeContinuationState never exposes payload', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const description = describeContinuationState(state);

      expect(description).not.toContain('encrypted_reasoning');
      expect(description).not.toContain('AES256');
      expect(description).not.toContain('thinking_blocks');
      expect(description).not.toContain('internal thought');
      expect(description).not.toContain('redacted_thinking');
      expect(description).not.toContain('REDACTED_CONTENT');
      expect(description).not.toContain('api_internal_state');
      expect(description).not.toContain('secret_token');
    });
  });

  describe('Authorized payload access', () => {
    it('returns original payload unchanged with matching identity', () => {
      const state = createContinuationState(identity, sensitivePayload);
      const result = state.getPayload(identity);

      expect(result.granted).toBe(true);
      // Exact same object reference
      expect(result.payload).toBe(sensitivePayload);
      // Deep equality
      expect(result.payload).toEqual(sensitivePayload);
    });

    it('preserves payload across multiple access attempts', () => {
      const state = createContinuationState(identity, sensitivePayload);

      // Multiple accesses should return the same payload
      const result1 = state.getPayload(identity);
      const result2 = state.getPayload(identity);
      const result3 = state.getPayload(identity);

      expect(result1.payload).toBe(result2.payload);
      expect(result2.payload).toBe(result3.payload);
      expect(result1.payload).toBe(sensitivePayload);
    });
  });

  describe('Registry security', () => {
    it('registry is in-memory only (no disk persistence by default)', () => {
      const registry = new ContinuationStateRegistry();

      // Registry uses a Map internally - verify it's not serialized to disk
      // by checking that the registry has no file I/O methods
      expect(typeof (registry as unknown as Record<string, unknown>).save).toBe('undefined');
      expect(typeof (registry as unknown as Record<string, unknown>).load).toBe('undefined');
      expect(typeof (registry as unknown as Record<string, unknown>).persist).toBe('undefined');
    });
  });
});

describe('Provider/model mismatch verification', () => {
  const openaiIdentity: ProviderIdentity = {
    providerId: 'openai',
    adapterType: 'openai-responses',
    modelId: 'gpt-4o',
  };

  const anthropicIdentity: ProviderIdentity = {
    providerId: 'anthropic',
    adapterType: 'anthropic-messages',
    modelId: 'claude-3-opus',
  };

  const geminiIdentity: ProviderIdentity = {
    providerId: 'google',
    adapterType: 'google-gemini',
    modelId: 'gemini-1.5-pro',
  };

  describe('state acceptance', () => {
    it('state created by provider A is accepted for provider A', () => {
      const state = createContinuationState(openaiIdentity, { data: 'openai' });

      // Via checkContinuationCompatibility
      const compat = checkContinuationCompatibility(state, openaiIdentity);
      expect(compat.compatible).toBe(true);

      // Via getPayload
      const access = state.getPayload(openaiIdentity);
      expect(access.granted).toBe(true);
      expect(access.payload).toEqual({ data: 'openai' });
    });

    it('state created by provider A is rejected for provider B', () => {
      const state = createContinuationState(openaiIdentity, { data: 'openai' });

      // Via checkContinuationCompatibility
      const compat = checkContinuationCompatibility(state, anthropicIdentity);
      expect(compat.compatible).toBe(false);
      expect(compat.reason).toBe('provider_mismatch');

      // Via getPayload
      const access = state.getPayload(anthropicIdentity);
      expect(access.granted).toBe(false);
      expect(access.reason).toBe('provider_mismatch');
      expect(access.payload).toBeUndefined();
    });
  });

  describe('adapter type switching', () => {
    const openaiChatIdentity: ProviderIdentity = {
      providerId: 'openai',
      adapterType: 'openai-chat-completions',
      modelId: 'gpt-4o',
    };

    it('state is rejected when adapter type changes', () => {
      const state = createContinuationState(openaiIdentity, { data: 'responses-api' });

      // Switching from openai-responses to openai-chat-completions
      const compat = checkContinuationCompatibility(state, openaiChatIdentity);
      expect(compat.compatible).toBe(false);
      expect(compat.reason).toBe('adapter_mismatch');

      const access = state.getPayload(openaiChatIdentity);
      expect(access.granted).toBe(false);
      expect(access.reason).toBe('adapter_mismatch');
    });
  });

  describe('model switching', () => {
    const openaiMiniIdentity: ProviderIdentity = {
      providerId: 'openai',
      adapterType: 'openai-responses',
      modelId: 'gpt-4o-mini',
    };

    it('state is rejected when model changes', () => {
      const state = createContinuationState(openaiIdentity, { data: 'gpt-4o' });

      const compat = checkContinuationCompatibility(state, openaiMiniIdentity);
      expect(compat.compatible).toBe(false);
      expect(compat.reason).toBe('model_mismatch');

      const access = state.getPayload(openaiMiniIdentity);
      expect(access.granted).toBe(false);
      expect(access.reason).toBe('model_mismatch');
    });
  });

  describe('registry clearIncompatible', () => {
    it('clears incompatible states when switching provider', () => {
      const registry = new ContinuationStateRegistry();
      const sensitivePayload = { secret: 'TOP_SECRET_DATA' };

      // Register states from multiple providers
      const openaiState = createContinuationState(openaiIdentity, sensitivePayload);
      const anthropicState = createContinuationState(anthropicIdentity, sensitivePayload);
      const geminiState = createContinuationState(geminiIdentity, sensitivePayload);

      const openaiRef = registry.register(openaiState);
      const anthropicRef = registry.register(anthropicState);
      const geminiRef = registry.register(geminiState);

      expect(registry.size).toBe(3);

      // Switch to anthropic - should clear openai and gemini states
      const cleared = registry.clearIncompatible(anthropicIdentity);

      expect(cleared).toBe(2);
      expect(registry.size).toBe(1);
      expect(registry.has(openaiRef)).toBe(false);
      expect(registry.has(anthropicRef)).toBe(true);
      expect(registry.has(geminiRef)).toBe(false);
    });
  });

  describe('rejection does not expose payload', () => {
    it('provider mismatch rejection is safe', () => {
      const sensitivePayload = {
        secret: 'SUPER_SECRET',
        api_key: 'sk-12345',
        encrypted_data: 'AES256_ENCRYPTED'
      };
      const state = createContinuationState(openaiIdentity, sensitivePayload);

      const access = state.getPayload(anthropicIdentity);

      expect(access.granted).toBe(false);
      expect(access.payload).toBeUndefined();
      expect(String(access.reason)).not.toContain('SUPER_SECRET');
      expect(String(access.reason)).not.toContain('sk-12345');
      expect(JSON.stringify(access)).not.toContain('SUPER_SECRET');
    });

    it('adapter mismatch rejection is safe', () => {
      const sensitivePayload = { thinking: 'secret thoughts' };
      const state = createContinuationState(openaiIdentity, sensitivePayload);
      const chatIdentity: ProviderIdentity = {
        ...openaiIdentity,
        adapterType: 'openai-chat-completions',
      };

      const access = state.getPayload(chatIdentity);

      expect(access.granted).toBe(false);
      expect(JSON.stringify(access)).not.toContain('secret thoughts');
    });

    it('model mismatch rejection is safe', () => {
      const sensitivePayload = { reasoning: 'internal reasoning steps' };
      const state = createContinuationState(openaiIdentity, sensitivePayload);
      const miniIdentity: ProviderIdentity = {
        ...openaiIdentity,
        modelId: 'gpt-4o-mini',
      };

      const access = state.getPayload(miniIdentity);

      expect(access.granted).toBe(false);
      expect(JSON.stringify(access)).not.toContain('internal reasoning');
    });
  });
});
