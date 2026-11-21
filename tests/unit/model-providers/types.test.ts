/**
 * Tests for provider types and capabilities.
 *
 * Tests:
 * - Provider configuration validation
 * - Capability states
 * - Provider identity matching
 */

import { describe, it, expect } from 'vitest';
import {
  createUnknownCapabilities,
  isValidProviderKeyName,
  providerIdentitiesMatch,
  BUILT_IN_PROVIDER_KEY_NAMES,
  CUSTOM_PROVIDER_KEY_PATTERN,
  type ProviderConfig,
  type DeclaredCapabilities,
  type ProviderIdentity,
} from '../../../src/model-providers/index.js';

describe('createUnknownCapabilities', () => {
  it('creates capabilities with all states unknown', () => {
    const caps = createUnknownCapabilities();

    expect(caps.toolCalling).toBe('unknown');
    expect(caps.strictJsonSchema).toBe('unknown');
    expect(caps.usageReporting).toBe('unknown');
    expect(caps.reasoning).toBe('unknown');
    expect(caps.continuationRequired).toBe('unknown');
    expect(caps.streaming).toBe('unknown');
    expect(caps.imageInput).toBe('unknown');
  });

  it('creates schema keyword support with all unknown', () => {
    const caps = createUnknownCapabilities();

    expect(caps.schemaKeywords.baseTypes).toBe('unknown');
    expect(caps.schemaKeywords.objectKeywords).toBe('unknown');
    expect(caps.schemaKeywords.arrayKeywords).toBe('unknown');
    expect(caps.schemaKeywords.stringValidation).toBe('unknown');
    expect(caps.schemaKeywords.numericValidation).toBe('unknown');
    expect(caps.schemaKeywords.compositionKeywords).toBe('unknown');
    expect(caps.schemaKeywords.referenceKeywords).toBe('unknown');
  });

  it('creates independent instances', () => {
    const caps1 = createUnknownCapabilities();
    const caps2 = createUnknownCapabilities();

    // Modify one, ensure the other is not affected
    (caps1 as { toolCalling: string }).toolCalling = 'supported';

    expect(caps2.toolCalling).toBe('unknown');
  });
});

describe('isValidProviderKeyName', () => {
  describe('built-in provider keys', () => {
    it('accepts OPENAI_API_KEY', () => {
      expect(isValidProviderKeyName('OPENAI_API_KEY')).toBe(true);
    });

    it('accepts ANTHROPIC_API_KEY', () => {
      expect(isValidProviderKeyName('ANTHROPIC_API_KEY')).toBe(true);
    });

    it('accepts GEMINI_API_KEY', () => {
      expect(isValidProviderKeyName('GEMINI_API_KEY')).toBe(true);
    });
  });

  describe('custom provider keys', () => {
    it('accepts valid AI_PROVIDER_*_API_KEY pattern', () => {
      expect(isValidProviderKeyName('AI_PROVIDER_CUSTOM_API_KEY')).toBe(true);
      expect(isValidProviderKeyName('AI_PROVIDER_MYCOMPANY_API_KEY')).toBe(true);
      expect(isValidProviderKeyName('AI_PROVIDER_TEST123_API_KEY')).toBe(true);
    });

    it('accepts pattern with underscores in provider name', () => {
      expect(isValidProviderKeyName('AI_PROVIDER_MY_CUSTOM_PROVIDER_API_KEY')).toBe(true);
    });

    it('rejects pattern starting with number', () => {
      expect(isValidProviderKeyName('AI_PROVIDER_123INVALID_API_KEY')).toBe(false);
    });
  });

  describe('invalid key names', () => {
    it('rejects lowercase', () => {
      expect(isValidProviderKeyName('openai_api_key')).toBe(false);
      expect(isValidProviderKeyName('ai_provider_custom_api_key')).toBe(false);
    });

    it('rejects arbitrary names', () => {
      expect(isValidProviderKeyName('MY_SECRET_KEY')).toBe(false);
      expect(isValidProviderKeyName('API_KEY')).toBe(false);
      expect(isValidProviderKeyName('PROVIDER_KEY')).toBe(false);
    });

    it('rejects partial matches', () => {
      expect(isValidProviderKeyName('OPENAI_API')).toBe(false);
      expect(isValidProviderKeyName('AI_PROVIDER_CUSTOM')).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidProviderKeyName('')).toBe(false);
    });
  });
});

describe('providerIdentitiesMatch', () => {
  const baseIdentity: ProviderIdentity = {
    providerId: 'openai-prod',
    adapterType: 'openai-responses',
    modelId: 'gpt-4o',
  };

  it('returns true for exact match', () => {
    const a = { ...baseIdentity };
    const b = { ...baseIdentity };

    expect(providerIdentitiesMatch(a, b)).toBe(true);
  });

  it('returns false when providerId differs', () => {
    const a = baseIdentity;
    const b = { ...baseIdentity, providerId: 'openai-dev' };

    expect(providerIdentitiesMatch(a, b)).toBe(false);
  });

  it('returns false when adapterType differs', () => {
    const a = baseIdentity;
    const b = { ...baseIdentity, adapterType: 'openai-chat-completions' as const };

    expect(providerIdentitiesMatch(a, b)).toBe(false);
  });

  it('returns false when modelId differs', () => {
    const a = baseIdentity;
    const b = { ...baseIdentity, modelId: 'gpt-4o-mini' };

    expect(providerIdentitiesMatch(a, b)).toBe(false);
  });
});

describe('BUILT_IN_PROVIDER_KEY_NAMES', () => {
  it('contains expected provider key names', () => {
    expect(BUILT_IN_PROVIDER_KEY_NAMES).toContain('OPENAI_API_KEY');
    expect(BUILT_IN_PROVIDER_KEY_NAMES).toContain('ANTHROPIC_API_KEY');
    expect(BUILT_IN_PROVIDER_KEY_NAMES).toContain('GEMINI_API_KEY');
  });

  it('has exactly 3 entries', () => {
    expect(BUILT_IN_PROVIDER_KEY_NAMES).toHaveLength(3);
  });
});

describe('CUSTOM_PROVIDER_KEY_PATTERN', () => {
  it('matches valid patterns', () => {
    expect(CUSTOM_PROVIDER_KEY_PATTERN.test('AI_PROVIDER_CUSTOM_API_KEY')).toBe(true);
    expect(CUSTOM_PROVIDER_KEY_PATTERN.test('AI_PROVIDER_MY_PROVIDER_API_KEY')).toBe(true);
    expect(CUSTOM_PROVIDER_KEY_PATTERN.test('AI_PROVIDER_TEST123_API_KEY')).toBe(true);
  });

  it('rejects invalid patterns', () => {
    expect(CUSTOM_PROVIDER_KEY_PATTERN.test('AI_PROVIDER__API_KEY')).toBe(false);
    expect(CUSTOM_PROVIDER_KEY_PATTERN.test('AI_PROVIDER_123_API_KEY')).toBe(false);
    expect(CUSTOM_PROVIDER_KEY_PATTERN.test('AI_PROVIDER_API_KEY')).toBe(false);
  });
});

describe('ProviderConfig type structure', () => {
  it('allows valid provider configuration', () => {
    const config: ProviderConfig = {
      providerId: 'openai-prod',
      adapterType: 'openai-responses',
      defaultModelId: 'gpt-4o',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      capabilities: createUnknownCapabilities(),
    };

    expect(config.providerId).toBe('openai-prod');
    expect(config.adapterType).toBe('openai-responses');
  });

  it('allows optional fields', () => {
    const config: ProviderConfig = {
      providerId: 'custom',
      adapterType: 'openai-chat-completions',
      defaultModelId: 'custom-model',
      baseUrl: 'https://api.custom.com/v1',
      apiKeyEnvVar: 'AI_PROVIDER_CUSTOM_API_KEY',
      capabilities: createUnknownCapabilities(),
      displayName: 'Custom Provider',
      enabled: true,
    };

    expect(config.baseUrl).toBe('https://api.custom.com/v1');
    expect(config.displayName).toBe('Custom Provider');
    expect(config.enabled).toBe(true);
  });
});

describe('DeclaredCapabilities type structure', () => {
  it('allows explicit capability states', () => {
    const caps: DeclaredCapabilities = {
      toolCalling: 'supported',
      strictJsonSchema: 'supported',
      schemaKeywords: {
        baseTypes: 'supported',
        objectKeywords: 'supported',
        arrayKeywords: 'supported',
        stringValidation: 'supported',
        numericValidation: 'unsupported',
        compositionKeywords: 'unknown',
        referenceKeywords: 'unsupported',
      },
      usageReporting: 'supported',
      reasoning: 'supported',
      continuationRequired: 'supported',
      maxContextTokens: 128000,
      maxOutputTokens: 16384,
      streaming: 'supported',
      imageInput: 'supported',
    };

    expect(caps.toolCalling).toBe('supported');
    expect(caps.maxContextTokens).toBe(128000);
  });
});
