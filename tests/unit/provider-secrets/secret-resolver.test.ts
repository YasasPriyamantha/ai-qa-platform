/**
 * Tests for provider secret resolution.
 *
 * Task 3.3: Verify secret resolution without process.env mutation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createSecretResolutionContext,
  resolveProviderSecret,
  isAiProviderEnabled,
  getAvailableProviderIds,
  getResolutionWarnings,
} from '../../../src/provider-secrets/secret-resolver.js';

describe('createSecretResolutionContext', () => {
  let tempDir: string;
  let envPath: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `qa-secret-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    envPath = join(tempDir, '.env');
    configPath = join(tempDir, 'ai-providers.json');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeEnv(content: string) {
    writeFileSync(envPath, content);
  }

  function writeConfig(config: object) {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  const validProviderConfig = {
    version: '1.0',
    // Note: enableFlag is no longer in config - AI_ENABLED is fixed in code
    providers: [
      { providerId: 'openai', adapterType: 'openai-responses', defaultModelId: 'gpt-6-luna', apiKeyEnvVar: 'OPENAI_API_KEY', enabled: true },
      { providerId: 'anthropic', adapterType: 'anthropic-messages', defaultModelId: 'claude', apiKeyEnvVar: 'ANTHROPIC_API_KEY', enabled: true },
      { providerId: 'gemini', adapterType: 'google-gemini', defaultModelId: 'gemini', apiKeyEnvVar: 'GEMINI_API_KEY', enabled: true },
    ],
  };

  describe('AI disabled by default', () => {
    it('should be disabled when AI_ENABLED is missing', () => {
      writeEnv('OPENAI_API_KEY=sk-test');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.enablement.enabled).toBe(false);
      expect(context.enablement.reason).toBe('disabled-missing-flag');
    });

    it('should be disabled when AI_ENABLED is false', () => {
      writeEnv('AI_ENABLED=false\nOPENAI_API_KEY=sk-test');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.enablement.enabled).toBe(false);
      expect(context.enablement.reason).toBe('disabled-explicitly');
    });

    it('should be disabled when AI_ENABLED is malformed', () => {
      writeEnv('AI_ENABLED=maybe\nOPENAI_API_KEY=sk-test');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.enablement.enabled).toBe(false);
      expect(context.enablement.reason).toBe('disabled-malformed-flag');
    });

    it('should be disabled when .env is missing', () => {
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: join(tempDir, 'missing.env'), providerConfigPath: configPath });

      expect(context.enablement.enabled).toBe(false);
      expect(context.enablement.reason).toBe('disabled-env-missing');
    });
  });

  describe('AI enabled', () => {
    it('should be enabled when AI_ENABLED is true', () => {
      writeEnv('AI_ENABLED=true\nOPENAI_API_KEY=sk-test');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.enablement.enabled).toBe(true);
      expect(context.enablement.reason).toBe('enabled-explicitly');
    });

    it('should resolve secrets when enabled', () => {
      writeEnv('AI_ENABLED=true\nOPENAI_API_KEY=sk-test-openai\nANTHROPIC_API_KEY=sk-test-anthropic');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.secrets.size).toBe(2);
      expect(context.secrets.get('openai')?.apiKey).toBe('sk-test-openai');
      expect(context.secrets.get('anthropic')?.apiKey).toBe('sk-test-anthropic');
    });

    it('should not resolve secrets when disabled', () => {
      writeEnv('AI_ENABLED=false\nOPENAI_API_KEY=sk-test');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.secrets.size).toBe(0);
    });
  });

  describe('multiple providers', () => {
    it('should resolve multiple provider secrets independently', () => {
      writeEnv('AI_ENABLED=true\nOPENAI_API_KEY=sk-openai\nANTHROPIC_API_KEY=sk-anthropic\nGEMINI_API_KEY=sk-gemini');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.secrets.size).toBe(3);
      expect(context.secrets.get('openai')?.apiKey).toBe('sk-openai');
      expect(context.secrets.get('anthropic')?.apiKey).toBe('sk-anthropic');
      expect(context.secrets.get('gemini')?.apiKey).toBe('sk-gemini');
    });

    it('should only resolve providers with keys present', () => {
      writeEnv('AI_ENABLED=true\nOPENAI_API_KEY=sk-openai');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.secrets.size).toBe(1);
      expect(context.secrets.has('openai')).toBe(true);
      expect(context.secrets.has('anthropic')).toBe(false);
    });

    it('selecting provider A should not resolve provider B key', () => {
      writeEnv('AI_ENABLED=true\nOPENAI_API_KEY=sk-openai\nANTHROPIC_API_KEY=sk-anthropic');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      // Resolve OpenAI
      const openaiResult = resolveProviderSecret(context, 'openai');
      expect(openaiResult.success).toBe(true);
      expect(openaiResult.secret?.apiKey).toBe('sk-openai');

      // This should NOT contain Anthropic key
      expect(openaiResult.secret?.providerId).toBe('openai');
      expect(openaiResult.secret?.envVarName).toBe('OPENAI_API_KEY');
    });
  });

  describe('legacy key warning', () => {
    it('should warn about deprecated AI_PROVIDER_API_KEY', () => {
      writeEnv('AI_ENABLED=true\nAI_PROVIDER_API_KEY=legacy-key\nOPENAI_API_KEY=sk-test');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.warnings.length).toBeGreaterThan(0);
      expect(context.warnings[0]).toContain('Deprecated');
      expect(context.warnings[0]).toContain('AI_PROVIDER_API_KEY');
    });

    it('should not warn when legacy key is absent', () => {
      writeEnv('AI_ENABLED=true\nOPENAI_API_KEY=sk-test');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.warnings.length).toBe(0);
    });
  });

  describe('registered key variables', () => {
    it('should track all registered key variable names', () => {
      writeEnv('AI_ENABLED=true');
      writeConfig(validProviderConfig);
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.registeredKeyVars).toContain('OPENAI_API_KEY');
      expect(context.registeredKeyVars).toContain('ANTHROPIC_API_KEY');
      expect(context.registeredKeyVars).toContain('GEMINI_API_KEY');
    });
  });
});

describe('resolveProviderSecret', () => {
  let tempDir: string;
  let envPath: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `qa-resolve-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    envPath = join(tempDir, '.env');
    configPath = join(tempDir, 'ai-providers.json');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const validProviderConfig = {
    version: '1.0',
    providers: [
      { providerId: 'openai', adapterType: 'openai-responses', defaultModelId: 'gpt-6-luna', apiKeyEnvVar: 'OPENAI_API_KEY', enabled: true },
      { providerId: 'disabled-provider', adapterType: 'openai-chat-completions', defaultModelId: 'model', apiKeyEnvVar: 'AI_PROVIDER_DISABLED_API_KEY', enabled: false },
    ],
  };

  it('should fail when AI is not enabled', () => {
    writeFileSync(envPath, 'AI_ENABLED=false\nOPENAI_API_KEY=sk-test');
    writeFileSync(configPath, JSON.stringify(validProviderConfig));
    const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });
    const result = resolveProviderSecret(context, 'openai');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ai-not-enabled');
  });

  it('should fail for unknown provider', () => {
    writeFileSync(envPath, 'AI_ENABLED=true\nOPENAI_API_KEY=sk-test');
    writeFileSync(configPath, JSON.stringify(validProviderConfig));
    const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });
    const result = resolveProviderSecret(context, 'unknown');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('provider-not-found');
  });

  it('should fail for disabled provider', () => {
    writeFileSync(envPath, 'AI_ENABLED=true\nAI_PROVIDER_DISABLED_API_KEY=sk-test');
    writeFileSync(configPath, JSON.stringify(validProviderConfig));
    const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });
    const result = resolveProviderSecret(context, 'disabled-provider');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('provider-disabled');
  });

  it('should fail when key is missing', () => {
    writeFileSync(envPath, 'AI_ENABLED=true');
    writeFileSync(configPath, JSON.stringify(validProviderConfig));
    const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });
    const result = resolveProviderSecret(context, 'openai');

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('env-var-missing');
  });

  it('should succeed for valid provider with key', () => {
    writeFileSync(envPath, 'AI_ENABLED=true\nOPENAI_API_KEY=sk-test');
    writeFileSync(configPath, JSON.stringify(validProviderConfig));
    const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });
    const result = resolveProviderSecret(context, 'openai');

    expect(result.success).toBe(true);
    expect(result.secret?.apiKey).toBe('sk-test');
    expect(result.secret?.providerId).toBe('openai');
  });
});

describe('environment source precedence (Task 3.3 requirement 8)', () => {
  let tempDir: string;
  let envPath: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `qa-env-precedence-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    envPath = join(tempDir, '.env');
    configPath = join(tempDir, 'ai-providers.json');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const validProviderConfig = {
    version: '1.0',
    providers: [
      { providerId: 'openai', adapterType: 'openai-responses', defaultModelId: 'gpt-6-luna', apiKeyEnvVar: 'OPENAI_API_KEY', enabled: true },
    ],
  };

  describe('OS-level AI_ENABLED does not enable inference', () => {
    it('should not enable inference when OS env has AI_ENABLED=true but .env has AI_ENABLED=false', () => {
      // Simulate OS-level env by writing to process.env (we can't truly set OS env in test)
      // The key point is that the resolver uses the parsed .env file, not process.env
      writeFileSync(envPath, 'AI_ENABLED=false\nOPENAI_API_KEY=sk-valid');
      writeFileSync(configPath, JSON.stringify(validProviderConfig));

      // Even if process.env had AI_ENABLED=true (which we can't reliably set in this test),
      // the resolver should read from the .env file
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.enablement.enabled).toBe(false);
      expect(context.enablement.reason).toBe('disabled-explicitly');
    });

    it('should not enable inference when .env flag is missing even if OS might have it', () => {
      // Write .env without AI_ENABLED
      writeFileSync(envPath, 'OPENAI_API_KEY=sk-valid');
      writeFileSync(configPath, JSON.stringify(validProviderConfig));

      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.enablement.enabled).toBe(false);
      expect(context.enablement.reason).toBe('disabled-missing-flag');
    });

    // Test B: OS enable flag must NOT enable inference when .env flag is missing
    it('Test B: OS process.env.AI_ENABLED=true must NOT enable inference when .env flag is missing', () => {
      // Save original process.env values
      const originalAiEnabled = process.env.AI_ENABLED;

      try {
        // Set OS-level AI_ENABLED to true
        process.env.AI_ENABLED = 'true';

        // Create .env WITHOUT any AI_ENABLED entry
        writeFileSync(envPath, 'OPENAI_API_KEY=sk-valid-key');
        writeFileSync(configPath, JSON.stringify(validProviderConfig));

        // The resolver should use the .env file, NOT process.env
        const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

        // Inference MUST remain disabled because the authoritative .env flag is missing
        expect(context.enablement.enabled).toBe(false);
        expect(context.enablement.reason).toBe('disabled-missing-flag');
      } finally {
        // Restore original process.env value
        if (originalAiEnabled === undefined) {
          delete process.env.AI_ENABLED;
        } else {
          process.env.AI_ENABLED = originalAiEnabled;
        }
      }
    });
  });

  describe('OS-level provider keys are not used as fallback', () => {
    it('should not resolve secret when .env key is missing even if OS might have it', () => {
      // Write .env with AI_ENABLED but without the provider key
      writeFileSync(envPath, 'AI_ENABLED=true');
      writeFileSync(configPath, JSON.stringify(validProviderConfig));

      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      // AI is enabled, but no secret should be resolved
      expect(context.enablement.enabled).toBe(true);
      expect(context.secrets.has('openai')).toBe(false);

      // Explicitly resolve should fail
      const result = resolveProviderSecret(context, 'openai');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('env-var-missing');
    });

    // Test A: OS provider key must NOT be used as fallback
    it('Test A: OS process.env.OPENAI_API_KEY must NOT be used when .env key is missing', () => {
      // Sentinel value that must NEVER be returned
      const OS_SENTINEL = 'OS_SENTINEL_OPENAI_KEY_12345';

      // Save original process.env value
      const originalOpenAiKey = process.env.OPENAI_API_KEY;

      try {
        // Set OS-level OPENAI_API_KEY to sentinel value
        process.env.OPENAI_API_KEY = OS_SENTINEL;

        // Create .env that does NOT contain OPENAI_API_KEY
        writeFileSync(envPath, 'AI_ENABLED=true\nSOME_OTHER_VAR=value');
        writeFileSync(configPath, JSON.stringify(validProviderConfig));

        // Resolve the OpenAI provider secret
        const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });
        const result = resolveProviderSecret(context, 'openai');

        // The result MUST be missing/undefined - sentinel must NOT be returned
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('env-var-missing');

        // Double-check: the sentinel value was NEVER returned
        if (result.secret) {
          // Fail without printing the actual value
          expect(result.secret.apiKey).not.toBe(OS_SENTINEL);
        }
      } finally {
        // Restore original process.env value
        if (originalOpenAiKey === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = originalOpenAiKey;
        }
      }
    });
  });

  describe('.env values are authoritative', () => {
    it('should use the separately parsed .env values when valid', () => {
      writeFileSync(envPath, 'AI_ENABLED=true\nOPENAI_API_KEY=sk-from-env-file');
      writeFileSync(configPath, JSON.stringify(validProviderConfig));

      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      expect(context.enablement.enabled).toBe(true);
      expect(context.secrets.has('openai')).toBe(true);

      const secret = context.secrets.get('openai');
      expect(secret?.apiKey).toBe('sk-from-env-file');
    });
  });

  describe('no mutation to process.env', () => {
    it('should not copy any provider secret into process.env', () => {
      const originalProcessEnv = { ...process.env };

      writeFileSync(envPath, 'AI_ENABLED=true\nOPENAI_API_KEY=sk-secret-value\nTEST_MARKER=test123');
      writeFileSync(configPath, JSON.stringify(validProviderConfig));

      createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });

      // process.env should not have been modified
      expect(process.env.OPENAI_API_KEY).toBeUndefined();
      expect(process.env.TEST_MARKER).toBeUndefined();
      expect(process.env.AI_ENABLED).toEqual(originalProcessEnv.AI_ENABLED);
    });
  });
});

describe('helper functions', () => {
  let tempDir: string;
  let envPath: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `qa-helper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    envPath = join(tempDir, '.env');
    configPath = join(tempDir, 'ai-providers.json');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const validProviderConfig = {
    version: '1.0',
    providers: [
      { providerId: 'openai', adapterType: 'openai-responses', defaultModelId: 'gpt-6-luna', apiKeyEnvVar: 'OPENAI_API_KEY', enabled: true },
      { providerId: 'anthropic', adapterType: 'anthropic-messages', defaultModelId: 'claude', apiKeyEnvVar: 'ANTHROPIC_API_KEY', enabled: true },
    ],
  };

  describe('isAiProviderEnabled', () => {
    it('should return true when enabled', () => {
      writeFileSync(envPath, 'AI_ENABLED=true');
      writeFileSync(configPath, JSON.stringify(validProviderConfig));
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });
      expect(isAiProviderEnabled(context)).toBe(true);
    });

    it('should return false when disabled', () => {
      writeFileSync(envPath, 'AI_ENABLED=false');
      writeFileSync(configPath, JSON.stringify(validProviderConfig));
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });
      expect(isAiProviderEnabled(context)).toBe(false);
    });
  });

  describe('getAvailableProviderIds', () => {
    it('should return providers with keys when enabled', () => {
      writeFileSync(envPath, 'AI_ENABLED=true\nOPENAI_API_KEY=sk-test');
      writeFileSync(configPath, JSON.stringify(validProviderConfig));
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });
      const ids = getAvailableProviderIds(context);

      expect(ids).toContain('openai');
      expect(ids).not.toContain('anthropic');
    });

    it('should return empty when disabled', () => {
      writeFileSync(envPath, 'AI_ENABLED=false\nOPENAI_API_KEY=sk-test');
      writeFileSync(configPath, JSON.stringify(validProviderConfig));
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });
      const ids = getAvailableProviderIds(context);

      expect(ids).toHaveLength(0);
    });
  });

  describe('getResolutionWarnings', () => {
    it('should return warnings from context', () => {
      writeFileSync(envPath, 'AI_ENABLED=true\nAI_PROVIDER_API_KEY=legacy');
      writeFileSync(configPath, JSON.stringify(validProviderConfig));
      const context = createSecretResolutionContext({ envFilePath: envPath, providerConfigPath: configPath });
      const warnings = getResolutionWarnings(context);

      expect(warnings.length).toBeGreaterThan(0);
    });
  });
});
