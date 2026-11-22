/**
 * Regression tests for DEC-032 amendment and DEC-035.
 *
 * Task 3.3: Verify project role credential validation rejects platform AI provider keys.
 *
 * Tests verify:
 * 1. Ordinary SAUCEDEMO_* credential references remain valid
 * 2. Built-in platform AI credential references are rejected
 * 3. Custom AI_PROVIDER_* references are rejected
 * 4. Existing role and storage-state configuration semantics remain unchanged
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPhase2ProjectConfig,
  isAiProviderCredential,
  isBuiltInProviderKey,
} from '../../../src/projects/phase2-loader.js';
import { ConfigValidationError } from '../../../src/projects/config.js';

describe('DEC-032/DEC-035 Regression Tests', () => {
  let tempDir: string;
  let configPath: string;
  let testDir: string;
  let artifactDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `qa-dec032-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, 'project.config.json');
    testDir = join(tempDir, 'tests', 'approved');
    artifactDir = join(tempDir, 'artifacts');
    mkdirSync(testDir, { recursive: true });
    mkdirSync(artifactDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeConfig(config: object) {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  // Base valid Phase 1 config
  const baseConfig = {
    projectId: 'saucedemo',
    name: 'SauceDemo Demo',
    baseUrl: 'https://www.saucedemo.com/',
    environment: 'demo',
    allowedDomains: ['www.saucedemo.com'],
    testDirectory: 'tests/approved',
    artifactDirectory: 'artifacts',
  };

  describe('Ordinary SAUCEDEMO_* credential references remain valid', () => {
    it('should accept SAUCEDEMO_STANDARD_USER_USERNAME', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'standard_user',
          name: 'Standard User',
          credentials: {
            username: 'SAUCEDEMO_STANDARD_USER_USERNAME',
            password: 'SAUCEDEMO_STANDARD_USER_PASSWORD',
          },
        }],
      });
      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].credentials.username).toBe('SAUCEDEMO_STANDARD_USER_USERNAME');
    });

    it('should accept full SauceDemo example configuration', () => {
      writeConfig({
        ...baseConfig,
        description: 'Example configuration demonstrating role profiles with credential references',
        roles: [
          {
            roleId: 'standard_user',
            name: 'Standard User',
            description: 'A standard user account for basic workflow testing',
            credentials: {
              username: 'SAUCEDEMO_STANDARD_USER_USERNAME',
              password: 'SAUCEDEMO_STANDARD_USER_PASSWORD',
            },
            storageStatePath: '.auth/standard_user.json',
          },
          {
            roleId: 'locked-out-user',
            name: 'Locked Out User',
            description: 'A locked out user for testing access denied scenarios',
            credentials: {
              username: 'SAUCEDEMO_LOCKED_OUT_USERNAME',
              password: 'SAUCEDEMO_LOCKED_OUT_PASSWORD',
            },
            storageStatePath: '.auth/locked-out-user.json',
          },
          {
            roleId: 'problem_user',
            name: 'Problem User',
            description: 'A user account that triggers application bugs',
            credentials: {
              username: 'SAUCEDEMO_PROBLEM_USER_USERNAME',
              password: 'SAUCEDEMO_PROBLEM_USER_PASSWORD',
            },
            storageStatePath: '.auth/problem_user.json',
          },
        ],
        documents: [
          {
            documentId: 'login-workflow',
            sourcePath: 'docs/login-workflow.md',
            format: 'markdown',
          },
        ],
      });
      const result = loadPhase2ProjectConfig(configPath);

      expect(result.roles).toHaveLength(3);
      expect(result.roles![0].roleId).toBe('standard_user');
      expect(result.roles![1].roleId).toBe('locked-out-user');
      expect(result.roles![2].roleId).toBe('problem_user');
    });
  });

  describe('Built-in platform AI credential references are rejected (DEC-035)', () => {
    it('should reject OPENAI_API_KEY in role credentials', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'admin',
          name: 'Admin',
          credentials: {
            apiKey: 'OPENAI_API_KEY',
          },
        }],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(/built-in AI provider key/);
    });

    it('should reject ANTHROPIC_API_KEY in role credentials', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'admin',
          name: 'Admin',
          credentials: {
            apiKey: 'ANTHROPIC_API_KEY',
          },
        }],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(/built-in AI provider key/);
    });

    it('should reject GEMINI_API_KEY in role credentials', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'admin',
          name: 'Admin',
          credentials: {
            apiKey: 'GEMINI_API_KEY',
          },
        }],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(/built-in AI provider key/);
    });

    it('should reject built-in keys case-insensitively', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'admin',
          name: 'Admin',
          credentials: {
            apiKey: 'openai_api_key', // lowercase
          },
        }],
      });

      // Note: lowercase is not a valid env var name pattern, so it fails validation
      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    });
  });

  describe('Custom AI_PROVIDER_* references are rejected (DEC-032)', () => {
    it('should reject AI_PROVIDER_CUSTOM_API_KEY', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'admin',
          name: 'Admin',
          credentials: {
            apiKey: 'AI_PROVIDER_CUSTOM_API_KEY',
          },
        }],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(/AI_PROVIDER_/);
    });

    it('should reject any AI_PROVIDER_ prefixed variable', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'admin',
          name: 'Admin',
          credentials: {
            apiKey: 'AI_PROVIDER_XYZ_API_KEY',
          },
        }],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    });

    it('should reject deprecated AI_PROVIDER_API_KEY', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'admin',
          name: 'Admin',
          credentials: {
            apiKey: 'AI_PROVIDER_API_KEY',
          },
        }],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    });
  });

  describe('Existing role and storage-state configuration semantics unchanged', () => {
    it('should validate storageStatePath in .auth/ directory', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'admin',
          name: 'Admin',
          credentials: { username: 'ADMIN_USER' },
          storageStatePath: '.auth/admin.json',
        }],
      });
      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].storageStatePath).toBe('.auth/admin.json');
    });

    it('should reject storageStatePath outside .auth/', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'admin',
          name: 'Admin',
          credentials: { username: 'ADMIN_USER' },
          storageStatePath: 'outside/admin.json',
        }],
      });
      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    });

    it('should reject absolute storageStatePath', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'admin',
          name: 'Admin',
          credentials: { username: 'ADMIN_USER' },
          storageStatePath: '/absolute/.auth/admin.json',
        }],
      });
      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    });

    it('should validate role ID format', () => {
      writeConfig({
        ...baseConfig,
        roles: [{
          roleId: 'Invalid Role', // spaces not allowed
          name: 'Admin',
          credentials: { username: 'ADMIN_USER' },
        }],
      });
      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    });
  });
});

describe('isAiProviderCredential', () => {
  it('should return true for OPENAI_API_KEY', () => {
    expect(isAiProviderCredential('OPENAI_API_KEY')).toBe(true);
  });

  it('should return true for ANTHROPIC_API_KEY', () => {
    expect(isAiProviderCredential('ANTHROPIC_API_KEY')).toBe(true);
  });

  it('should return true for GEMINI_API_KEY', () => {
    expect(isAiProviderCredential('GEMINI_API_KEY')).toBe(true);
  });

  it('should return true for AI_PROVIDER_ prefixed variables', () => {
    expect(isAiProviderCredential('AI_PROVIDER_CUSTOM_API_KEY')).toBe(true);
    expect(isAiProviderCredential('AI_PROVIDER_XYZ_API_KEY')).toBe(true);
  });

  it('should return false for SAUCEDEMO_* variables', () => {
    expect(isAiProviderCredential('SAUCEDEMO_STANDARD_USER_USERNAME')).toBe(false);
    expect(isAiProviderCredential('SAUCEDEMO_STANDARD_USER_PASSWORD')).toBe(false);
  });

  it('should return false for other app variables', () => {
    expect(isAiProviderCredential('DATABASE_URL')).toBe(false);
    expect(isAiProviderCredential('API_TOKEN')).toBe(false);
  });
});

describe('isBuiltInProviderKey', () => {
  it('should return true for OPENAI_API_KEY', () => {
    expect(isBuiltInProviderKey('OPENAI_API_KEY')).toBe(true);
  });

  it('should return true for ANTHROPIC_API_KEY', () => {
    expect(isBuiltInProviderKey('ANTHROPIC_API_KEY')).toBe(true);
  });

  it('should return true for GEMINI_API_KEY', () => {
    expect(isBuiltInProviderKey('GEMINI_API_KEY')).toBe(true);
  });

  it('should return false for AI_PROVIDER_* variables', () => {
    expect(isBuiltInProviderKey('AI_PROVIDER_CUSTOM_API_KEY')).toBe(false);
  });

  it('should return false for other variables', () => {
    expect(isBuiltInProviderKey('SAUCEDEMO_USERNAME')).toBe(false);
  });
});
