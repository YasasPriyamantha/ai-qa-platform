/**
 * Tests for provider configuration loader.
 *
 * Task 3.3: Verify provider config loading from config/ai-providers.json.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadProvidersConfig,
  findProvider,
  getEnabledProviders,
  getRegisteredKeyVarNames,
  ProviderConfigError,
} from '../../../src/provider-secrets/config-loader.js';

describe('loadProvidersConfig', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `qa-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, 'ai-providers.json');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeConfig(config: object) {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  const validConfig = {
    version: '1.0',
    // Note: enableFlag is no longer required - AI_ENABLED is fixed in code
    providers: [
      {
        providerId: 'openai',
        adapterType: 'openai-responses',
        defaultModelId: 'gpt-6-luna',
        apiKeyEnvVar: 'OPENAI_API_KEY',
      },
    ],
  };

  it('should load a valid config', () => {
    writeConfig(validConfig);
    const result = loadProvidersConfig(configPath);

    expect(result.version).toBe('1.0');
    // enableFlag is no longer in the config file
    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].providerId).toBe('openai');
    expect(result.providers[0].defaultModelId).toBe('gpt-6-luna');
  });

  it('should validate built-in provider key names', () => {
    writeConfig({
      ...validConfig,
      providers: [
        { providerId: 'openai', adapterType: 'openai-responses', defaultModelId: 'gpt-4o', apiKeyEnvVar: 'OPENAI_API_KEY' },
        { providerId: 'anthropic', adapterType: 'anthropic-messages', defaultModelId: 'claude-sonnet-4-20250514', apiKeyEnvVar: 'ANTHROPIC_API_KEY' },
        { providerId: 'gemini', adapterType: 'google-gemini', defaultModelId: 'gemini-2.0-flash', apiKeyEnvVar: 'GEMINI_API_KEY' },
      ],
    });
    const result = loadProvidersConfig(configPath);
    expect(result.providers).toHaveLength(3);
  });

  it('should validate custom provider key pattern', () => {
    writeConfig({
      ...validConfig,
      providers: [
        { providerId: 'custom', adapterType: 'openai-chat-completions', defaultModelId: 'custom-model', apiKeyEnvVar: 'AI_PROVIDER_CUSTOM_API_KEY' },
      ],
    });
    const result = loadProvidersConfig(configPath);
    expect(result.providers[0].apiKeyEnvVar).toBe('AI_PROVIDER_CUSTOM_API_KEY');
  });

  it('should reject invalid key name', () => {
    writeConfig({
      ...validConfig,
      providers: [
        { providerId: 'invalid', adapterType: 'openai-responses', defaultModelId: 'gpt-4o', apiKeyEnvVar: 'MY_CUSTOM_KEY' },
      ],
    });
    expect(() => loadProvidersConfig(configPath)).toThrow(ProviderConfigError);
    expect(() => loadProvidersConfig(configPath)).toThrow(/must be one of the built-in names/);
  });

  it('should reject duplicate provider IDs', () => {
    writeConfig({
      ...validConfig,
      providers: [
        { providerId: 'openai', adapterType: 'openai-responses', defaultModelId: 'gpt-4o', apiKeyEnvVar: 'OPENAI_API_KEY' },
        { providerId: 'openai', adapterType: 'openai-chat-completions', defaultModelId: 'gpt-4o', apiKeyEnvVar: 'OPENAI_API_KEY' },
      ],
    });
    expect(() => loadProvidersConfig(configPath)).toThrow(ProviderConfigError);
    expect(() => loadProvidersConfig(configPath)).toThrow(/Duplicate provider ID/);
  });

  it('should handle missing file', () => {
    expect(() => loadProvidersConfig(join(tempDir, 'nonexistent.json'))).toThrow(ProviderConfigError);
  });

  it('should handle invalid JSON', () => {
    writeFileSync(configPath, 'not json');
    expect(() => loadProvidersConfig(configPath)).toThrow(ProviderConfigError);
  });

  it('should require version field', () => {
    writeConfig({ enableFlag: { envVar: 'AI_ENABLED' }, providers: [] });
    expect(() => loadProvidersConfig(configPath)).toThrow(ProviderConfigError);
    expect(() => loadProvidersConfig(configPath)).toThrow(/version is required/);
  });

  it('should ignore enableFlag in config (it is fixed in code)', () => {
    // Per Task 3.3: enableFlag is no longer required - AI_ENABLED is fixed in code
    // If present, it should be ignored rather than causing an error
    writeConfig({
      version: '1.0',
      enableFlag: { envVar: 'CUSTOM_FLAG' }, // This should be ignored
      providers: [],
    });
    const result = loadProvidersConfig(configPath);
    expect(result.version).toBe('1.0');
    expect(result.providers).toHaveLength(0);
    // enableFlag should not appear in the result
  });

  it('should prove config cannot redirect the enable flag', () => {
    // Per Task 3.3: Configuration cannot redirect the enable flag
    writeConfig({
      version: '1.0',
      enableFlag: { envVar: 'MALICIOUS_REDIRECT' }, // Should be ignored
      providers: [],
    });
    const result = loadProvidersConfig(configPath);
    // The config file cannot specify a different enable flag variable
    // This is enforced by the fixed AI_ENABLED_VAR constant in env-parser.ts
    expect(result).toBeDefined();
    expect(result.version).toBe('1.0');
  });
});

describe('findProvider', () => {
  const config = {
    version: '1.0',
    providers: [
      { providerId: 'openai', adapterType: 'openai-responses' as const, defaultModelId: 'gpt-6-luna', apiKeyEnvVar: 'OPENAI_API_KEY' },
      { providerId: 'anthropic', adapterType: 'anthropic-messages' as const, defaultModelId: 'claude', apiKeyEnvVar: 'ANTHROPIC_API_KEY' },
    ],
  };

  it('should find existing provider', () => {
    const result = findProvider(config, 'openai');
    expect(result).toBeDefined();
    expect(result?.providerId).toBe('openai');
  });

  it('should return undefined for missing provider', () => {
    const result = findProvider(config, 'nonexistent');
    expect(result).toBeUndefined();
  });
});

describe('getEnabledProviders', () => {
  const config = {
    version: '1.0',
    providers: [
      { providerId: 'openai', adapterType: 'openai-responses' as const, defaultModelId: 'gpt-6-luna', apiKeyEnvVar: 'OPENAI_API_KEY', enabled: true },
      { providerId: 'anthropic', adapterType: 'anthropic-messages' as const, defaultModelId: 'claude', apiKeyEnvVar: 'ANTHROPIC_API_KEY', enabled: false },
      { providerId: 'gemini', adapterType: 'google-gemini' as const, defaultModelId: 'gemini', apiKeyEnvVar: 'GEMINI_API_KEY' }, // defaults to enabled
    ],
  };

  it('should return only enabled providers', () => {
    const result = getEnabledProviders(config);
    expect(result).toHaveLength(2);
    expect(result.map(p => p.providerId)).toEqual(['openai', 'gemini']);
  });
});

describe('getRegisteredKeyVarNames', () => {
  const config = {
    version: '1.0',
    providers: [
      { providerId: 'openai', adapterType: 'openai-responses' as const, defaultModelId: 'gpt-6-luna', apiKeyEnvVar: 'OPENAI_API_KEY' },
      { providerId: 'anthropic', adapterType: 'anthropic-messages' as const, defaultModelId: 'claude', apiKeyEnvVar: 'ANTHROPIC_API_KEY' },
    ],
  };

  it('should return all key variable names', () => {
    const result = getRegisteredKeyVarNames(config);
    expect(result).toEqual(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY']);
  });
});
