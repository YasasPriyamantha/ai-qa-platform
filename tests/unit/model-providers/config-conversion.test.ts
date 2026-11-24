/**
 * Tests for provider configuration conversion.
 *
 * Task 3.3a: Test explicit conversion from ProviderConfigEntry to ProviderConfig.
 * Key principle: Capabilities not declared must become 'unknown', not 'supported'.
 */

import { describe, it, expect } from 'vitest';
import {
  convertProviderConfigEntry,
  convertProviderConfigEntries,
  getSuccessfulConfigs,
  isCapabilitySupported,
  isCapabilityUnsupported,
  isCapabilityUnknown,
  requireCapability,
  categorizeSchemaKeywords,
} from '../../../src/model-providers/config-conversion.js';
import type { ProviderConfigEntry } from '../../../src/provider-secrets/types.js';
import type { ProviderConfig, DeclaredCapabilities } from '../../../src/model-providers/types.js';

// Test fixtures
function createMinimalEntry(): ProviderConfigEntry {
  return {
    providerId: 'test-provider',
    adapterType: 'openai-responses',
    defaultModelId: 'gpt-4o',
    apiKeyEnvVar: 'OPENAI_API_KEY',
  };
}

function createFullEntry(): ProviderConfigEntry {
  return {
    providerId: 'openai',
    adapterType: 'openai-responses',
    defaultModelId: 'gpt-4o',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    displayName: 'OpenAI',
    enabled: true,
    capabilities: {
      toolCalling: 'supported',
      strictJsonSchema: 'supported',
      usageReporting: 'supported',
      reasoning: 'unsupported',
      streaming: 'supported',
      imageInput: 'supported',
    },
  };
}

describe('convertProviderConfigEntry', () => {
  describe('successful conversion', () => {
    it('converts minimal entry with all unknown capabilities', () => {
      const entry = createMinimalEntry();
      const result = convertProviderConfigEntry(entry);

      expect(result.success).toBe(true);
      expect(result.config).toBeDefined();
      expect(result.errors).toHaveLength(0);

      const config = result.config!;
      expect(config.providerId).toBe('test-provider');
      expect(config.adapterType).toBe('openai-responses');
      expect(config.defaultModelId).toBe('gpt-4o');
      expect(config.apiKeyEnvVar).toBe('OPENAI_API_KEY');
    });

    it('sets undeclared capabilities to unknown', () => {
      const entry = createMinimalEntry();
      const result = convertProviderConfigEntry(entry);
      const config = result.config!;

      // All capabilities should be 'unknown' when not declared
      expect(config.capabilities.toolCalling).toBe('unknown');
      expect(config.capabilities.strictJsonSchema).toBe('unknown');
      expect(config.capabilities.usageReporting).toBe('unknown');
      expect(config.capabilities.reasoning).toBe('unknown');
      expect(config.capabilities.continuationRequired).toBe('unknown');
      expect(config.capabilities.streaming).toBe('unknown');
      expect(config.capabilities.imageInput).toBe('unknown');
    });

    it('sets schema keywords to unknown (never inferred)', () => {
      const entry = createMinimalEntry();
      const result = convertProviderConfigEntry(entry);
      const config = result.config!;

      // Schema keywords are ALWAYS unknown because simplified config
      // doesn't include them - this is intentional
      expect(config.capabilities.schemaKeywords.baseTypes).toBe('unknown');
      expect(config.capabilities.schemaKeywords.objectKeywords).toBe('unknown');
      expect(config.capabilities.schemaKeywords.arrayKeywords).toBe('unknown');
      expect(config.capabilities.schemaKeywords.stringValidation).toBe('unknown');
      expect(config.capabilities.schemaKeywords.numericValidation).toBe('unknown');
      expect(config.capabilities.schemaKeywords.compositionKeywords).toBe('unknown');
      expect(config.capabilities.schemaKeywords.referenceKeywords).toBe('unknown');
    });

    it('converts entry with explicit capabilities', () => {
      const entry = createFullEntry();
      const result = convertProviderConfigEntry(entry);
      const config = result.config!;

      expect(config.capabilities.toolCalling).toBe('supported');
      expect(config.capabilities.strictJsonSchema).toBe('supported');
      expect(config.capabilities.usageReporting).toBe('supported');
      expect(config.capabilities.reasoning).toBe('unsupported');
      expect(config.capabilities.streaming).toBe('supported');
      expect(config.capabilities.imageInput).toBe('supported');
    });

    it('preserves optional fields', () => {
      const entry = createFullEntry();
      const result = convertProviderConfigEntry(entry);
      const config = result.config!;

      expect(config.baseUrl).toBe('https://api.openai.com/v1');
      expect(config.displayName).toBe('OpenAI');
      expect(config.enabled).toBe(true);
    });

    it('generates warning when no capabilities declared', () => {
      const entry = createMinimalEntry();
      const result = convertProviderConfigEntry(entry);

      expect(result.warnings).toContain('No capabilities declared - all capabilities set to unknown');
    });
  });

  describe('partial capabilities', () => {
    it('handles partial capability declarations', () => {
      const entry: ProviderConfigEntry = {
        ...createMinimalEntry(),
        capabilities: {
          toolCalling: 'supported',
          // Other capabilities not declared
        },
      };

      const result = convertProviderConfigEntry(entry);
      const config = result.config!;

      // Declared capability is preserved
      expect(config.capabilities.toolCalling).toBe('supported');

      // Undeclared capabilities default to 'unknown', NOT 'supported'
      expect(config.capabilities.strictJsonSchema).toBe('unknown');
      expect(config.capabilities.usageReporting).toBe('unknown');
      expect(config.capabilities.reasoning).toBe('unknown');
      expect(config.capabilities.streaming).toBe('unknown');
      expect(config.capabilities.imageInput).toBe('unknown');
    });

    it('does NOT infer support from partial declarations', () => {
      // This is the key principle: declaring one capability does not
      // imply support for related capabilities

      const entry: ProviderConfigEntry = {
        ...createMinimalEntry(),
        capabilities: {
          toolCalling: 'supported',
        },
      };

      const result = convertProviderConfigEntry(entry);
      const config = result.config!;

      // Having tool calling does NOT imply strict JSON schema support
      expect(config.capabilities.strictJsonSchema).toBe('unknown');

      // Schema keywords remain unknown
      expect(config.capabilities.schemaKeywords.baseTypes).toBe('unknown');
    });
  });

  describe('validation errors', () => {
    it('fails when providerId is missing', () => {
      const entry: ProviderConfigEntry = {
        ...createMinimalEntry(),
        providerId: '',
      };

      const result = convertProviderConfigEntry(entry);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('providerId is required');
      expect(result.config).toBeUndefined();
    });

    it('fails when adapterType is missing', () => {
      const entry = {
        ...createMinimalEntry(),
        adapterType: '',
      } as unknown as ProviderConfigEntry;

      const result = convertProviderConfigEntry(entry);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('adapterType is required');
    });

    it('fails when defaultModelId is missing', () => {
      const entry: ProviderConfigEntry = {
        ...createMinimalEntry(),
        defaultModelId: '',
      };

      const result = convertProviderConfigEntry(entry);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('defaultModelId is required');
    });

    it('fails when apiKeyEnvVar is missing', () => {
      const entry: ProviderConfigEntry = {
        ...createMinimalEntry(),
        apiKeyEnvVar: '',
      };

      const result = convertProviderConfigEntry(entry);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('apiKeyEnvVar is required');
    });

    it('collects multiple errors', () => {
      const entry: ProviderConfigEntry = {
        providerId: '',
        adapterType: '' as 'openai-responses',
        defaultModelId: '',
        apiKeyEnvVar: '',
      };

      const result = convertProviderConfigEntry(entry);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(4);
    });
  });
});

describe('convertProviderConfigEntries', () => {
  it('converts multiple entries', () => {
    const entries: ProviderConfigEntry[] = [
      createMinimalEntry(),
      {
        ...createMinimalEntry(),
        providerId: 'provider-2',
      },
    ];

    const results = convertProviderConfigEntries(entries);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
  });

  it('handles mixed success and failure', () => {
    const entries: ProviderConfigEntry[] = [
      createMinimalEntry(),
      { ...createMinimalEntry(), providerId: '' }, // Invalid
    ];

    const results = convertProviderConfigEntries(entries);

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });
});

describe('getSuccessfulConfigs', () => {
  it('filters to successful conversions only', () => {
    const entries: ProviderConfigEntry[] = [
      createMinimalEntry(),
      { ...createMinimalEntry(), providerId: '' }, // Invalid
      { ...createMinimalEntry(), providerId: 'provider-3' },
    ];

    const results = convertProviderConfigEntries(entries);
    const configs = getSuccessfulConfigs(results);

    expect(configs).toHaveLength(2);
    expect(configs[0].providerId).toBe('test-provider');
    expect(configs[1].providerId).toBe('provider-3');
  });
});

describe('capability state helpers', () => {
  describe('isCapabilitySupported', () => {
    it('returns true only for supported', () => {
      expect(isCapabilitySupported('supported')).toBe(true);
      expect(isCapabilitySupported('unsupported')).toBe(false);
      expect(isCapabilitySupported('unknown')).toBe(false);
    });
  });

  describe('isCapabilityUnsupported', () => {
    it('returns true only for unsupported', () => {
      expect(isCapabilityUnsupported('unsupported')).toBe(true);
      expect(isCapabilityUnsupported('supported')).toBe(false);
      expect(isCapabilityUnsupported('unknown')).toBe(false);
    });
  });

  describe('isCapabilityUnknown', () => {
    it('returns true only for unknown', () => {
      expect(isCapabilityUnknown('unknown')).toBe(true);
      expect(isCapabilityUnknown('supported')).toBe(false);
      expect(isCapabilityUnknown('unsupported')).toBe(false);
    });
  });
});

describe('requireCapability', () => {
  function createConfig(overrides?: Partial<DeclaredCapabilities>): ProviderConfig {
    const result = convertProviderConfigEntry({
      ...createMinimalEntry(),
      capabilities: {
        toolCalling: overrides?.toolCalling || 'unknown',
        strictJsonSchema: overrides?.strictJsonSchema || 'unknown',
        usageReporting: overrides?.usageReporting || 'unknown',
        reasoning: overrides?.reasoning || 'unknown',
        streaming: overrides?.streaming || 'unknown',
        imageInput: overrides?.imageInput || 'unknown',
      },
    });
    return result.config!;
  }

  it('returns undefined when capability is supported', () => {
    const config = createConfig({ toolCalling: 'supported' });
    const error = requireCapability(config, 'toolCalling');

    expect(error).toBeUndefined();
  });

  it('returns error when capability is unsupported', () => {
    const config = createConfig({ toolCalling: 'unsupported' });
    const error = requireCapability(config, 'toolCalling');

    expect(error).toContain('does not support');
    expect(error).toContain('toolCalling');
  });

  it('returns error when capability is unknown', () => {
    const config = createConfig({ toolCalling: 'unknown' });
    const error = requireCapability(config, 'toolCalling');

    expect(error).toContain('unknown');
    expect(error).toContain('cannot verify');
  });

  it('returns error for composite capabilities (schemaKeywords)', () => {
    const config = createConfig();
    const error = requireCapability(config, 'schemaKeywords');

    expect(error).toContain('composite capability');
  });
});

describe('categorizeSchemaKeywords', () => {
  it('categorizes keywords by state', () => {
    const keywords = {
      baseTypes: 'supported' as const,
      objectKeywords: 'supported' as const,
      arrayKeywords: 'unsupported' as const,
      stringValidation: 'unknown' as const,
      numericValidation: 'unknown' as const,
      compositionKeywords: 'unsupported' as const,
      referenceKeywords: 'unknown' as const,
    };

    const result = categorizeSchemaKeywords(keywords);

    expect(result.supported).toContain('baseTypes');
    expect(result.supported).toContain('objectKeywords');
    expect(result.unsupported).toContain('arrayKeywords');
    expect(result.unsupported).toContain('compositionKeywords');
    expect(result.unknown).toContain('stringValidation');
    expect(result.unknown).toContain('numericValidation');
    expect(result.unknown).toContain('referenceKeywords');
  });

  it('handles all unknown', () => {
    const keywords = {
      baseTypes: 'unknown' as const,
      objectKeywords: 'unknown' as const,
      arrayKeywords: 'unknown' as const,
      stringValidation: 'unknown' as const,
      numericValidation: 'unknown' as const,
      compositionKeywords: 'unknown' as const,
      referenceKeywords: 'unknown' as const,
    };

    const result = categorizeSchemaKeywords(keywords);

    expect(result.supported).toHaveLength(0);
    expect(result.unsupported).toHaveLength(0);
    expect(result.unknown).toHaveLength(7);
  });
});

describe('Design principle: no inference from configuration', () => {
  it('configuring provider does not imply any capability support', () => {
    // This test documents the key design principle:
    // A provider being configured does NOT mean it supports any features

    const entry = createMinimalEntry();
    const result = convertProviderConfigEntry(entry);
    const config = result.config!;

    // Every capability must be 'unknown' when not explicitly declared
    expect(config.capabilities.toolCalling).toBe('unknown');
    expect(config.capabilities.strictJsonSchema).toBe('unknown');
    expect(config.capabilities.usageReporting).toBe('unknown');
    expect(config.capabilities.reasoning).toBe('unknown');
    expect(config.capabilities.continuationRequired).toBe('unknown');
    expect(config.capabilities.streaming).toBe('unknown');
    expect(config.capabilities.imageInput).toBe('unknown');

    // Schema keywords are never in simplified config, always unknown
    expect(config.capabilities.schemaKeywords.baseTypes).toBe('unknown');
    expect(config.capabilities.schemaKeywords.objectKeywords).toBe('unknown');
    expect(config.capabilities.schemaKeywords.arrayKeywords).toBe('unknown');
    expect(config.capabilities.schemaKeywords.stringValidation).toBe('unknown');
    expect(config.capabilities.schemaKeywords.numericValidation).toBe('unknown');
    expect(config.capabilities.schemaKeywords.compositionKeywords).toBe('unknown');
    expect(config.capabilities.schemaKeywords.referenceKeywords).toBe('unknown');
  });

  it('declaring one capability does not imply related capabilities', () => {
    // Declaring tool calling doesn't imply structured output support
    const entry: ProviderConfigEntry = {
      ...createMinimalEntry(),
      capabilities: {
        toolCalling: 'supported',
      },
    };

    const result = convertProviderConfigEntry(entry);
    const config = result.config!;

    expect(config.capabilities.toolCalling).toBe('supported');
    expect(config.capabilities.strictJsonSchema).toBe('unknown');
    expect(config.capabilities.schemaKeywords.objectKeywords).toBe('unknown');
  });
});
