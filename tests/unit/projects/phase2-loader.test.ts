/**
 * Tests for Phase 2 project configuration loader
 *
 * Task 2.9: Role profiles and safe authentication/credential references
 *
 * Verifies:
 * - Legacy Phase 1 config compatibility
 * - Valid Phase 2 config with new fields
 * - Invalid new fields rejection
 * - Secret-value rejection in credentials
 * - Role ID format validation
 * - Environment variable name format validation
 * - storageStatePath path containment validation
 * - Credential presence check (separate from loading)
 * - Project loading when referenced variables are absent
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPhase2ProjectConfig,
  looksLikeSecret,
  isValidEnvVarName,
  validateEnvVarName,
  validateRoleIdFormat,
  checkCredentialPresence,
  checkRoleCredentialPresence,
  isAiProviderCredential,
  ROLE_ID_PATTERN,
  ROLE_ID_MAX_LENGTH,
} from '../../../src/projects/phase2-loader.js';
import { ConfigValidationError } from '../../../src/projects/config.js';
import type { RoleProfile } from '../../../src/projects/phase2-config.js';

describe('loadPhase2ProjectConfig', () => {
  let tempDir: string;
  let configPath: string;
  let testDir: string;
  let artifactDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `qa-phase2-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  const validPhase1Config = {
    projectId: 'test-project',
    name: 'Test Project',
    baseUrl: 'https://example.com/',
    environment: 'demo',
    allowedDomains: ['example.com'],
    testDirectory: 'tests/approved',
    artifactDirectory: 'artifacts',
  };

  describe('Phase 1 backward compatibility', () => {
    it('should load a Phase 1 config without changes', () => {
      writeConfig(validPhase1Config);
      const result = loadPhase2ProjectConfig(configPath);

      expect(result.projectId).toBe('test-project');
      expect(result.name).toBe('Test Project');
      expect(result.baseUrl).toBe('https://example.com/');
      expect(result.environment).toBe('demo');
      expect(result.allowedDomains).toEqual(['example.com']);
      expect(result.testDirectory).toBe('tests/approved');
      expect(result.artifactDirectory).toBe('artifacts');
      expect(result.roles).toBeUndefined();
      expect(result.documents).toBeUndefined();
      expect(result.description).toBeUndefined();
    });

    it('should load existing SauceDemo-style config', () => {
      const saucedemoConfig = {
        projectId: 'saucedemo',
        name: 'SauceDemo Demo',
        baseUrl: 'https://www.saucedemo.com/',
        environment: 'demo',
        allowedDomains: ['www.saucedemo.com'],
        testDirectory: 'tests/approved',
        artifactDirectory: 'artifacts',
      };
      writeConfig(saucedemoConfig);
      const result = loadPhase2ProjectConfig(configPath);

      expect(result.projectId).toBe('saucedemo');
      expect(result.roles).toBeUndefined();
      expect(result.documents).toBeUndefined();
    });

    it('should load local fixture-style config', () => {
      const fixtureConfig = {
        projectId: 'fixture-passing',
        name: 'Passing Fixture',
        baseUrl: 'http://localhost',
        environment: 'local',
        allowedDomains: ['localhost'],
        testDirectory: 'tests/approved',
        artifactDirectory: 'artifacts',
      };
      writeConfig(fixtureConfig);
      const result = loadPhase2ProjectConfig(configPath);

      expect(result.projectId).toBe('fixture-passing');
      expect(result.baseUrl).toBe('http://localhost');
      expect(result.environment).toBe('local');
    });
  });

  describe('valid Phase 2 config', () => {
    it('should accept config with optional description', () => {
      writeConfig({
        ...validPhase1Config,
        description: 'A test project for Phase 2',
      });
      const result = loadPhase2ProjectConfig(configPath);

      expect(result.description).toBe('A test project for Phase 2');
    });

    it('should accept config with role profiles', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Administrator',
            description: 'Admin user with full access',
            credentials: {
              username: 'ADMIN_USERNAME',
              password: 'ADMIN_PASSWORD',
            },
          },
          {
            roleId: 'customer',
            name: 'Customer',
            credentials: {
              username: 'CUSTOMER_USERNAME',
              password: 'CUSTOMER_PASSWORD',
            },
          },
        ],
      });
      const result = loadPhase2ProjectConfig(configPath);

      expect(result.roles).toHaveLength(2);
      expect(result.roles![0].roleId).toBe('admin');
      expect(result.roles![0].name).toBe('Administrator');
      expect(result.roles![0].description).toBe('Admin user with full access');
      expect(result.roles![0].credentials).toEqual({
        username: 'ADMIN_USERNAME',
        password: 'ADMIN_PASSWORD',
      });
      expect(result.roles![1].roleId).toBe('customer');
      expect(result.roles![1].storageStatePath).toBeUndefined();
    });

    it('should accept config with storageStatePath', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Administrator',
            credentials: {
              username: 'ADMIN_USER',
            },
            storageStatePath: '.auth/admin-state.json',
          },
        ],
      });
      const result = loadPhase2ProjectConfig(configPath);

      expect(result.roles![0].storageStatePath).toBe('.auth/admin-state.json');
    });

    it('should accept config with document references', () => {
      writeConfig({
        ...validPhase1Config,
        documents: [
          {
            documentId: 'login-workflow',
            sourcePath: 'docs/login-workflow.md',
            format: 'markdown',
          },
          {
            documentId: 'readme',
            sourcePath: 'docs/readme.txt',
            format: 'text',
          },
        ],
      });
      const result = loadPhase2ProjectConfig(configPath);

      expect(result.documents).toHaveLength(2);
      expect(result.documents![0].documentId).toBe('login-workflow');
      expect(result.documents![0].sourcePath).toBe('docs/login-workflow.md');
      expect(result.documents![0].format).toBe('markdown');
      expect(result.documents![1].format).toBe('text');
    });

    it('should accept full Phase 2 config with all optional fields', () => {
      writeConfig({
        ...validPhase1Config,
        description: 'Full Phase 2 project',
        roles: [
          {
            roleId: 'user',
            name: 'Standard User',
            credentials: { username: 'USER_NAME', password: 'USER_PASS' },
          },
        ],
        documents: [
          {
            documentId: 'spec',
            sourcePath: 'requirements.md',
            format: 'markdown',
          },
        ],
      });
      const result = loadPhase2ProjectConfig(configPath);

      expect(result.description).toBe('Full Phase 2 project');
      expect(result.roles).toHaveLength(1);
      expect(result.documents).toHaveLength(1);
    });

    it('should treat empty roles array as undefined', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [],
      });
      const result = loadPhase2ProjectConfig(configPath);

      expect(result.roles).toBeUndefined();
    });

    it('should treat empty documents array as undefined', () => {
      writeConfig({
        ...validPhase1Config,
        documents: [],
      });
      const result = loadPhase2ProjectConfig(configPath);

      expect(result.documents).toBeUndefined();
    });
  });

  describe('invalid role profiles', () => {
    it('should reject roles that is not an array', () => {
      writeConfig({
        ...validPhase1Config,
        roles: 'not-an-array',
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('roles');
        expect((err as ConfigValidationError).message).toContain('array');
      }
    });

    it('should reject role without roleId', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('roles[0].roleId');
      }
    });

    it('should reject role without name', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            credentials: { username: 'ADMIN_USER' },
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('roles[0].name');
      }
    });

    it('should reject role without credentials', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('roles[0].credentials');
      }
    });

    it('should reject duplicate role IDs', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          { roleId: 'admin', name: 'Admin 1', credentials: { u: 'U1' } },
          { roleId: 'admin', name: 'Admin 2', credentials: { u: 'U2' } },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('Duplicate role ID');
      }
    });

    it('should reject non-object role entries', () => {
      writeConfig({
        ...validPhase1Config,
        roles: ['not-an-object'],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('object');
      }
    });

    it('should reject non-string credential values', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 123 },
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('roles[0].credentials.username');
      }
    });

    it('should reject empty credential value strings', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: '' },
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('cannot be empty');
      }
    });
  });

  describe('invalid document references', () => {
    it('should reject documents that is not an array', () => {
      writeConfig({
        ...validPhase1Config,
        documents: 'not-an-array',
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('documents');
      }
    });

    it('should reject document without documentId', () => {
      writeConfig({
        ...validPhase1Config,
        documents: [
          {
            sourcePath: 'docs/test.md',
            format: 'markdown',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('documents[0].documentId');
      }
    });

    it('should reject document without sourcePath', () => {
      writeConfig({
        ...validPhase1Config,
        documents: [
          {
            documentId: 'doc1',
            format: 'markdown',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('documents[0].sourcePath');
      }
    });

    it('should reject document without format', () => {
      writeConfig({
        ...validPhase1Config,
        documents: [
          {
            documentId: 'doc1',
            sourcePath: 'docs/test.md',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('documents[0].format');
      }
    });

    it('should reject invalid document format', () => {
      writeConfig({
        ...validPhase1Config,
        documents: [
          {
            documentId: 'doc1',
            sourcePath: 'docs/test.pdf',
            format: 'pdf',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('"markdown" or "text"');
      }
    });

    it('should reject duplicate document IDs', () => {
      writeConfig({
        ...validPhase1Config,
        documents: [
          { documentId: 'doc1', sourcePath: 'a.md', format: 'markdown' },
          { documentId: 'doc1', sourcePath: 'b.md', format: 'markdown' },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('Duplicate document ID');
      }
    });
  });

  describe('secret-value rejection', () => {
    it('should reject JWT tokens in credentials', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: {
              token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
            },
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('actual secret');
        // Value should be redacted
        expect((err as ConfigValidationError).value).toBe('[REDACTED]');
      }
    });

    it('should reject UUID-like tokens', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: {
              apiKey: '550e8400-e29b-41d4-a716-446655440000',
            },
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('actual secret');
      }
    });

    it('should reject values starting with common API key prefixes', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: {
              key: 'sk-1234567890abcdef',
            },
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('actual secret');
      }
    });

    it('should accept valid environment variable names', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: {
              username: 'SAUCEDEMO_ADMIN_USERNAME',
              password: 'SAUCEDEMO_ADMIN_PASSWORD',
              token: 'SAUCEDEMO_AUTH_TOKEN',
            },
          },
        ],
      });

      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].credentials.username).toBe('SAUCEDEMO_ADMIN_USERNAME');
      expect(result.roles![0].credentials.password).toBe('SAUCEDEMO_ADMIN_PASSWORD');
    });

    it('should reject lowercase environment variable names', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: {
              username: 'my_username_var',
            },
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('uppercase');
      }
    });

    it('should reject mixed-case environment variable names', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: {
              username: 'My_Username',
            },
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    });

    it('should reject standard_user as a credential value (looks like actual value)', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: {
              username: 'standard_user',
            },
          },
        ],
      });

      // standard_user is lowercase, so it should be rejected as not a valid env var name
      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        // Error should not contain the rejected value
        expect((err as ConfigValidationError).message).not.toContain('standard_user');
        expect((err as ConfigValidationError).message).toContain('uppercase');
      }
    });

    it('should reject secret_sauce as a credential value (looks like actual value)', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: {
              password: 'secret_sauce',
            },
          },
        ],
      });

      // secret_sauce is lowercase, so it should be rejected as not a valid env var name
      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        // Error should not contain the rejected value
        expect((err as ConfigValidationError).message).not.toContain('secret_sauce');
      }
    });
  });
});

describe('looksLikeSecret', () => {
  it('should detect JWT tokens', () => {
    expect(looksLikeSecret('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.rTCH8cLoGxAm')).toBe(true);
  });

  it('should detect UUID-format tokens', () => {
    expect(looksLikeSecret('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(looksLikeSecret('A50E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('should detect API key prefixes', () => {
    expect(looksLikeSecret('sk-1234567890')).toBe(true);
    expect(looksLikeSecret('pk-abcdefghij')).toBe(true);
    expect(looksLikeSecret('api_key_12345')).toBe(true);
    expect(looksLikeSecret('token_abcdef')).toBe(true);
    expect(looksLikeSecret('secret_value')).toBe(true);
    expect(looksLikeSecret('Bearer abc123')).toBe(true);
  });

  it('should not flag common field name words', () => {
    // These are field names, not actual secrets
    expect(looksLikeSecret('password')).toBe(false);
    expect(looksLikeSecret('token')).toBe(false);
    expect(looksLikeSecret('apikey')).toBe(false);
  });

  it('should not flag valid environment variable names', () => {
    expect(looksLikeSecret('MY_PASSWORD')).toBe(false);
    expect(looksLikeSecret('ADMIN_TOKEN')).toBe(false);
    expect(looksLikeSecret('DB_CONNECTION_STRING')).toBe(false);
    expect(looksLikeSecret('SAUCEDEMO_USER')).toBe(false);
  });

  it('should not flag short strings', () => {
    expect(looksLikeSecret('abc')).toBe(false);
    expect(looksLikeSecret('TEST')).toBe(false);
  });
});

describe('isAiProviderCredential', () => {
  it('should detect AI_PROVIDER_API_KEY', () => {
    expect(isAiProviderCredential('AI_PROVIDER_API_KEY')).toBe(true);
  });

  it('should detect AI_PROVIDER_TOKEN', () => {
    expect(isAiProviderCredential('AI_PROVIDER_TOKEN')).toBe(true);
  });

  it('should detect lowercase ai_provider_ prefix', () => {
    // Case-insensitive check
    expect(isAiProviderCredential('ai_provider_key')).toBe(true);
  });

  it('should not flag API_TOKEN', () => {
    expect(isAiProviderCredential('API_TOKEN')).toBe(false);
  });

  it('should not flag API_SECRET', () => {
    expect(isAiProviderCredential('API_SECRET')).toBe(false);
  });

  it('should not flag SAUCEDEMO_PASSWORD', () => {
    expect(isAiProviderCredential('SAUCEDEMO_PASSWORD')).toBe(false);
  });

  it('should not flag MY_AI_PROVIDER_VAR (not at start)', () => {
    // The prefix check is at the start only
    expect(isAiProviderCredential('MY_AI_PROVIDER_VAR')).toBe(false);
  });
});

describe('isValidEnvVarName', () => {
  it('should accept standard uppercase env var names', () => {
    expect(isValidEnvVarName('MY_VAR')).toBe(true);
    expect(isValidEnvVarName('DATABASE_URL')).toBe(true);
    expect(isValidEnvVarName('NODE_ENV')).toBe(true);
    expect(isValidEnvVarName('A')).toBe(true);
    expect(isValidEnvVarName('_PRIVATE')).toBe(true);
    expect(isValidEnvVarName('VAR123')).toBe(true);
  });

  it('should reject lowercase names', () => {
    expect(isValidEnvVarName('my_var')).toBe(false);
    expect(isValidEnvVarName('myVar')).toBe(false);
  });

  it('should reject names starting with digits', () => {
    expect(isValidEnvVarName('123VAR')).toBe(false);
    expect(isValidEnvVarName('1_VAR')).toBe(false);
  });

  it('should reject names with special characters', () => {
    expect(isValidEnvVarName('MY-VAR')).toBe(false);
    expect(isValidEnvVarName('MY.VAR')).toBe(false);
    expect(isValidEnvVarName('MY VAR')).toBe(false);
  });

  it('should reject empty string', () => {
    expect(isValidEnvVarName('')).toBe(false);
  });
});

describe('validateEnvVarName', () => {
  it('should accept standard uppercase env var names', () => {
    expect(validateEnvVarName('MY_VAR').valid).toBe(true);
    expect(validateEnvVarName('API_TOKEN').valid).toBe(true);
    expect(validateEnvVarName('SAUCEDEMO_STANDARD_USER').valid).toBe(true);
    expect(validateEnvVarName('SAUCEDEMO_STANDARD_PASSWORD').valid).toBe(true);
  });

  it('should accept API_TOKEN, SAUCEDEMO_PASSWORD, SAUCEDEMO_USERNAME', () => {
    // These specific names must be accepted per requirements
    expect(validateEnvVarName('API_TOKEN').valid).toBe(true);
    expect(validateEnvVarName('SAUCEDEMO_PASSWORD').valid).toBe(true);
    expect(validateEnvVarName('SAUCEDEMO_USERNAME').valid).toBe(true);
  });

  it('should accept env var names containing PASSWORD, TOKEN, SECRET', () => {
    // These are valid env var names, not actual secrets
    expect(validateEnvVarName('DB_PASSWORD').valid).toBe(true);
    expect(validateEnvVarName('AUTH_TOKEN').valid).toBe(true);
    expect(validateEnvVarName('API_SECRET').valid).toBe(true);
  });

  it('should reject lowercase env var names', () => {
    // Lowercase names are rejected
    const result1 = validateEnvVarName('my_var');
    expect(result1.valid).toBe(false);
    expect(result1.error).toContain('uppercase');

    const result2 = validateEnvVarName('database_url');
    expect(result2.valid).toBe(false);
    expect(result2.error).toContain('uppercase');
  });

  it('should reject mixed-case env var names', () => {
    const result = validateEnvVarName('My_Variable');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('uppercase');
  });

  it('should reject standard_user (lowercase looks like actual value)', () => {
    const result = validateEnvVarName('standard_user');
    expect(result.valid).toBe(false);
    // Error message should not contain the rejected value
    expect(result.error).not.toContain('standard_user');
  });

  it('should reject secret_sauce (lowercase looks like actual value)', () => {
    const result = validateEnvVarName('secret_sauce');
    expect(result.valid).toBe(false);
    // Error message should not contain the rejected value
    expect(result.error).not.toContain('secret_sauce');
  });

  it('should reject empty names', () => {
    const result = validateEnvVarName('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('should reject names starting with digits', () => {
    const result = validateEnvVarName('123VAR');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('digit');
  });

  it('should reject names with whitespace', () => {
    const result = validateEnvVarName('MY VAR');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('whitespace');
  });

  it('should reject names with special characters', () => {
    expect(validateEnvVarName('MY-VAR').valid).toBe(false);
    expect(validateEnvVarName('MY.VAR').valid).toBe(false);
    expect(validateEnvVarName('MY@VAR').valid).toBe(false);
  });
});

describe('validateRoleIdFormat', () => {
  it('should accept valid lowercase role IDs', () => {
    expect(validateRoleIdFormat('admin').valid).toBe(true);
    expect(validateRoleIdFormat('standard_user').valid).toBe(true);
    expect(validateRoleIdFormat('power-user').valid).toBe(true);
    expect(validateRoleIdFormat('_internal').valid).toBe(true);
    expect(validateRoleIdFormat('a').valid).toBe(true);
    expect(validateRoleIdFormat('user123').valid).toBe(true);
  });

  it('should accept standard_user (existing role ID must remain valid)', () => {
    // Per requirements: standard_user must remain valid
    expect(validateRoleIdFormat('standard_user').valid).toBe(true);
  });

  it('should accept lowercase hyphenated role IDs', () => {
    expect(validateRoleIdFormat('power-user').valid).toBe(true);
    expect(validateRoleIdFormat('admin-role').valid).toBe(true);
    expect(validateRoleIdFormat('test-user-1').valid).toBe(true);
  });

  it('should reject uppercase role IDs', () => {
    const result = validateRoleIdFormat('Admin');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('lowercase');
  });

  it('should reject mixed-case role IDs', () => {
    expect(validateRoleIdFormat('standardUser').valid).toBe(false);
    expect(validateRoleIdFormat('PowerUser').valid).toBe(false);
    expect(validateRoleIdFormat('User1').valid).toBe(false);
  });

  it('should reject empty role IDs', () => {
    const result = validateRoleIdFormat('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('should reject role IDs starting with digits', () => {
    const result = validateRoleIdFormat('123user');
    expect(result.valid).toBe(false);
  });

  it('should reject role IDs with invalid separators and whitespace', () => {
    expect(validateRoleIdFormat('user@admin').valid).toBe(false);
    expect(validateRoleIdFormat('user.admin').valid).toBe(false);
    expect(validateRoleIdFormat('user admin').valid).toBe(false);
    expect(validateRoleIdFormat('user/admin').valid).toBe(false);
    expect(validateRoleIdFormat('user\\admin').valid).toBe(false);
  });

  it('should reject Windows reserved device names', () => {
    expect(validateRoleIdFormat('con').valid).toBe(false);
    expect(validateRoleIdFormat('prn').valid).toBe(false);
    expect(validateRoleIdFormat('aux').valid).toBe(false);
    expect(validateRoleIdFormat('nul').valid).toBe(false);
    expect(validateRoleIdFormat('com1').valid).toBe(false);
    expect(validateRoleIdFormat('lpt1').valid).toBe(false);
    // Case-insensitive check
    expect(validateRoleIdFormat('CON').valid).toBe(false);
    expect(validateRoleIdFormat('Con').valid).toBe(false);
  });

  it('should reject role IDs that are too long', () => {
    const longId = 'a'.repeat(ROLE_ID_MAX_LENGTH + 1);
    const result = validateRoleIdFormat(longId);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too long');
  });

  it('should accept role IDs at max length', () => {
    const maxId = 'a'.repeat(ROLE_ID_MAX_LENGTH);
    expect(validateRoleIdFormat(maxId).valid).toBe(true);
  });

  it('should preserve case-insensitive duplicate detection (tested via loader)', () => {
    // This test verifies the design, actual duplicate detection is in loader tests
    // Role IDs are lowercased before uniqueness check
    expect(validateRoleIdFormat('admin').valid).toBe(true);
    // Admin would be rejected for being uppercase, not for being a duplicate
    expect(validateRoleIdFormat('Admin').valid).toBe(false);
  });
});

describe('checkCredentialPresence', () => {
  it('should report all present when all env vars exist', () => {
    const roles: RoleProfile[] = [
      {
        roleId: 'admin',
        name: 'Admin',
        credentials: {
          username: 'ADMIN_USER',
          password: 'ADMIN_PASS',
        },
      },
    ];

    const env = {
      ADMIN_USER: 'actual_username',
      ADMIN_PASS: 'actual_password',
    };

    const result = checkCredentialPresence(roles, env);
    expect(result.allPresent).toBe(true);
    expect(result.missingVariables).toEqual([]);
    expect(result.byRole['admin'].missing).toEqual([]);
    expect(result.byRole['admin'].present).toContain('ADMIN_USER');
    expect(result.byRole['admin'].present).toContain('ADMIN_PASS');
  });

  it('should report missing variables when env vars are absent', () => {
    const roles: RoleProfile[] = [
      {
        roleId: 'admin',
        name: 'Admin',
        credentials: {
          username: 'ADMIN_USER',
          password: 'ADMIN_PASS',
        },
      },
    ];

    const env = {
      ADMIN_USER: 'actual_username',
      // ADMIN_PASS is missing
    };

    const result = checkCredentialPresence(roles, env);
    expect(result.allPresent).toBe(false);
    expect(result.missingVariables).toContain('ADMIN_PASS');
    expect(result.byRole['admin'].missing).toContain('ADMIN_PASS');
    expect(result.byRole['admin'].present).toContain('ADMIN_USER');
  });

  it('should handle multiple roles with different missing variables', () => {
    const roles: RoleProfile[] = [
      {
        roleId: 'admin',
        name: 'Admin',
        credentials: {
          username: 'ADMIN_USER',
          password: 'ADMIN_PASS',
        },
      },
      {
        roleId: 'customer',
        name: 'Customer',
        credentials: {
          username: 'CUSTOMER_USER',
          password: 'CUSTOMER_PASS',
        },
      },
    ];

    const env = {
      ADMIN_USER: 'admin',
      // ADMIN_PASS missing
      CUSTOMER_USER: 'customer',
      CUSTOMER_PASS: 'secret',
    };

    const result = checkCredentialPresence(roles, env);
    expect(result.allPresent).toBe(false);
    expect(result.missingVariables).toEqual(['ADMIN_PASS']);
    expect(result.byRole['admin'].missing).toEqual(['ADMIN_PASS']);
    expect(result.byRole['customer'].missing).toEqual([]);
    expect(result.byRole['customer'].present.length).toBeGreaterThan(0);
  });

  it('should handle empty roles array', () => {
    const result = checkCredentialPresence([], {});
    expect(result.allPresent).toBe(true);
    expect(result.missingVariables).toEqual([]);
  });

  it('should handle undefined roles', () => {
    const result = checkCredentialPresence(undefined, {});
    expect(result.allPresent).toBe(true);
    expect(result.missingVariables).toEqual([]);
  });

  it('should not include duplicate missing variables', () => {
    const roles: RoleProfile[] = [
      {
        roleId: 'admin',
        name: 'Admin',
        credentials: { password: 'SHARED_PASS' },
      },
      {
        roleId: 'user',
        name: 'User',
        credentials: { password: 'SHARED_PASS' },
      },
    ];

    const result = checkCredentialPresence(roles, {});
    expect(result.missingVariables).toEqual(['SHARED_PASS']);
  });

  it('should treat empty string env vars as missing', () => {
    const roles: RoleProfile[] = [
      {
        roleId: 'admin',
        name: 'Admin',
        credentials: {
          username: 'ADMIN_USER',
          password: 'ADMIN_PASS',
        },
      },
    ];

    const env = {
      ADMIN_USER: 'actual_username',
      ADMIN_PASS: '', // Empty string should be treated as missing
    };

    const result = checkCredentialPresence(roles, env);
    expect(result.allPresent).toBe(false);
    expect(result.missingVariables).toContain('ADMIN_PASS');
    expect(result.byRole['admin'].missing).toContain('ADMIN_PASS');
  });

  it('should treat whitespace-only env vars as missing', () => {
    const roles: RoleProfile[] = [
      {
        roleId: 'admin',
        name: 'Admin',
        credentials: {
          username: 'ADMIN_USER',
          password: 'ADMIN_PASS',
        },
      },
    ];

    const env = {
      ADMIN_USER: 'actual_username',
      ADMIN_PASS: '   ', // Whitespace-only should be treated as missing
    };

    const result = checkCredentialPresence(roles, env);
    expect(result.allPresent).toBe(false);
    expect(result.missingVariables).toContain('ADMIN_PASS');
    expect(result.byRole['admin'].missing).toContain('ADMIN_PASS');
  });

  it('should not include empty/whitespace values in the result', () => {
    const roles: RoleProfile[] = [
      {
        roleId: 'admin',
        name: 'Admin',
        credentials: {
          username: 'ADMIN_USER',
        },
      },
    ];

    const env = {
      ADMIN_USER: '', // Empty string
    };

    const result = checkCredentialPresence(roles, env);

    // Result should report as missing without exposing any value
    expect(result.allPresent).toBe(false);
    // No values should be in the result, not even empty strings
    // The result only contains variable names
    expect(result.missingVariables).toEqual(['ADMIN_USER']);
  });

  it('should never include secret values in the result', () => {
    const roles: RoleProfile[] = [
      {
        roleId: 'admin',
        name: 'Admin',
        credentials: {
          username: 'ADMIN_USER',
          password: 'ADMIN_PASS',
        },
      },
    ];

    const env = {
      ADMIN_USER: 'secret_username_value',
      ADMIN_PASS: 'super_secret_password_123',
    };

    const result = checkCredentialPresence(roles, env);

    // Result should only contain variable names, not values
    const resultString = JSON.stringify(result);
    expect(resultString).not.toContain('secret_username_value');
    expect(resultString).not.toContain('super_secret_password_123');
  });
});

describe('checkRoleCredentialPresence', () => {
  it('should check a single role credentials', () => {
    const role: RoleProfile = {
      roleId: 'admin',
      name: 'Admin',
      credentials: {
        username: 'ADMIN_USER',
        password: 'ADMIN_PASS',
      },
    };

    const env = { ADMIN_USER: 'value' };
    const result = checkRoleCredentialPresence(role, env);

    expect(result.roleId).toBe('admin');
    expect(result.allPresent).toBe(false);
    expect(result.missing).toEqual(['ADMIN_PASS']);
  });
});

describe('loadPhase2ProjectConfig - project loading without credentials', () => {
  let tempDir: string;
  let configPath: string;
  let testDir: string;
  let artifactDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `qa-phase2-cred-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  const validPhase1Config = {
    projectId: 'test-project',
    name: 'Test Project',
    baseUrl: 'https://example.com/',
    environment: 'demo',
    allowedDomains: ['example.com'],
    testDirectory: 'tests/approved',
    artifactDirectory: 'artifacts',
  };

  it('should load project config when referenced env vars are absent', () => {
    // This tests requirement 9: Loading/validating project configuration
    // must not require referenced credential environment variables to be present.
    writeConfig({
      ...validPhase1Config,
      roles: [
        {
          roleId: 'admin',
          name: 'Admin',
          credentials: {
            username: 'NON_EXISTENT_ENV_VAR_1',
            password: 'NON_EXISTENT_ENV_VAR_2',
          },
        },
      ],
    });

    // Should not throw even though the env vars don't exist
    const result = loadPhase2ProjectConfig(configPath);
    expect(result.roles).toHaveLength(1);
    expect(result.roles![0].credentials.username).toBe('NON_EXISTENT_ENV_VAR_1');
    expect(result.roles![0].credentials.password).toBe('NON_EXISTENT_ENV_VAR_2');
  });

  it('should validate role ID format', () => {
    writeConfig({
      ...validPhase1Config,
      roles: [
        {
          roleId: '123invalid', // Invalid: starts with digit
          name: 'Admin',
          credentials: { username: 'ADMIN_USER' },
        },
      ],
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
  });

  it('should reject uppercase role IDs', () => {
    writeConfig({
      ...validPhase1Config,
      roles: [
        { roleId: 'Admin', name: 'Admin', credentials: { username: 'ADMIN_USER' } },
      ],
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('lowercase');
    }
  });

  it('should reject duplicate role IDs (case-insensitive)', () => {
    // Both lowercase - actual duplicate
    writeConfig({
      ...validPhase1Config,
      roles: [
        { roleId: 'admin', name: 'Admin 1', credentials: { u: 'USER_1' } },
        { roleId: 'admin', name: 'Admin 2', credentials: { u: 'USER_2' } },
      ],
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('Duplicate role ID');
    }
  });

  it('should validate environment variable name format', () => {
    writeConfig({
      ...validPhase1Config,
      roles: [
        {
          roleId: 'admin',
          name: 'Admin',
          credentials: {
            username: 'INVALID-ENV-NAME', // Invalid: contains hyphen
          },
        },
      ],
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
  });

  it('should reject env var names with whitespace', () => {
    writeConfig({
      ...validPhase1Config,
      roles: [
        {
          roleId: 'admin',
          name: 'Admin',
          credentials: {
            username: 'MY VAR', // Invalid: contains space
          },
        },
      ],
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('whitespace');
    }
  });

  it('should accept valid multiple roles', () => {
    writeConfig({
      ...validPhase1Config,
      roles: [
        {
          roleId: 'admin',
          name: 'Administrator',
          description: 'Full access admin',
          credentials: {
            username: 'ADMIN_USER',
            password: 'ADMIN_PASS',
          },
        },
        {
          roleId: 'standard_user',
          name: 'Standard User',
          credentials: {
            username: 'STANDARD_USER',
            password: 'STANDARD_PASS',
          },
        },
        {
          roleId: 'guest',
          name: 'Guest User',
          credentials: {
            session_token: 'GUEST_TOKEN',
          },
        },
      ],
    });

    const result = loadPhase2ProjectConfig(configPath);
    expect(result.roles).toHaveLength(3);
    expect(result.roles![0].roleId).toBe('admin');
    expect(result.roles![1].roleId).toBe('standard_user');
    expect(result.roles![2].roleId).toBe('guest');
  });

  it('should validate storageStatePath is within project workspace', () => {
    writeConfig({
      ...validPhase1Config,
      roles: [
        {
          roleId: 'admin',
          name: 'Admin',
          credentials: { username: 'ADMIN_USER' },
          storageStatePath: '../outside-workspace/state.json', // Escapes workspace
        },
      ],
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      // Now rejected for path traversal (..) before the escape check
      expect((err as ConfigValidationError).message).toContain('..');
    }
  });

  it('should accept valid storageStatePath within workspace', () => {
    writeConfig({
      ...validPhase1Config,
      roles: [
        {
          roleId: 'admin',
          name: 'Admin',
          credentials: { username: 'ADMIN_USER' },
          storageStatePath: '.auth/admin-state.json',
        },
      ],
    });

    const result = loadPhase2ProjectConfig(configPath);
    expect(result.roles![0].storageStatePath).toBe('.auth/admin-state.json');
  });

  describe('storageStatePath .auth/ convention enforcement', () => {
    it('should accept .auth/standard_user.json', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'standard_user',
            name: 'Standard User',
            credentials: { username: 'USER' },
            storageStatePath: '.auth/standard_user.json',
          },
        ],
      });

      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].storageStatePath).toBe('.auth/standard_user.json');
    });

    it('should reject tests/approved/state.json (not in .auth/)', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
            storageStatePath: 'tests/approved/state.json',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('.auth/');
      }
    });

    it('should reject .auth/sub/state.json (must be direct child of .auth/)', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
            storageStatePath: '.auth/sub/state.json',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('direct child');
        expect((err as ConfigValidationError).message).toContain('no subdirectories');
      }
    });

    it('should reject .auth/../x.json (path traversal)', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
            storageStatePath: '.auth/../x.json',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('..');
      }
    });

    it('should reject absolute POSIX path', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
            storageStatePath: '/etc/secrets/state.json',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('absolute');
      }
    });

    it('should reject Windows drive-absolute path', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
            storageStatePath: 'C:/Users/secrets/state.json',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('Windows absolute');
      }
    });

    it('should reject UNC path', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
            storageStatePath: '//server/share/state.json',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('UNC');
      }
    });

    it('should reject backslash path that bypasses .auth check', () => {
      // Backslashes should be normalized and checked
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
            storageStatePath: 'tests\\approved\\state.json',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('.auth/');
      }
    });

    it('should reject non-.json extension', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
            storageStatePath: '.auth/admin.txt',
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('.json');
      }
    });
  });

  describe('AI_PROVIDER_ prefix rejection in credentials', () => {
    it('should reject AI_PROVIDER_API_KEY as credential reference', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { apiKey: 'AI_PROVIDER_API_KEY' },
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('AI_PROVIDER_');
        // Value should be redacted
        expect((err as ConfigValidationError).value).toBe('[REDACTED]');
      }
    });

    it('should reject AI_PROVIDER_TOKEN as credential reference', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { token: 'AI_PROVIDER_TOKEN' },
          },
        ],
      });

      expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadPhase2ProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('AI_PROVIDER_');
      }
    });

    it('should accept API_TOKEN (valid env var, not AI_PROVIDER_ prefix)', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { token: 'API_TOKEN' },
          },
        ],
      });

      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].credentials.token).toBe('API_TOKEN');
    });

    it('should accept API_SECRET (valid env var, not AI_PROVIDER_ prefix)', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { secret: 'API_SECRET' },
          },
        ],
      });

      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].credentials.secret).toBe('API_SECRET');
    });

    it('should accept SAUCEDEMO_PASSWORD (valid project credential)', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { password: 'SAUCEDEMO_PASSWORD' },
          },
        ],
      });

      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].credentials.password).toBe('SAUCEDEMO_PASSWORD');
    });
  });

  describe('valid uppercase env var names must not be rejected by secret detection', () => {
    // Regression tests: valid env var names that might look like secrets
    // but must be accepted because they match ^[A-Z_][A-Z0-9_]*$

    it('should accept SECRET_KEY', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { key: 'SECRET_KEY' },
          },
        ],
      });

      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].credentials.key).toBe('SECRET_KEY');
    });

    it('should accept TOKEN_ADMIN', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { token: 'TOKEN_ADMIN' },
          },
        ],
      });

      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].credentials.token).toBe('TOKEN_ADMIN');
    });

    it('should accept BEARER_TOKEN', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { token: 'BEARER_TOKEN' },
          },
        ],
      });

      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].credentials.token).toBe('BEARER_TOKEN');
    });

    it('should accept API_KEY', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { key: 'API_KEY' },
          },
        ],
      });

      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].credentials.key).toBe('API_KEY');
    });

    it('should accept SK_LIVE_KEY', () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { key: 'SK_LIVE_KEY' },
          },
        ],
      });

      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].credentials.key).toBe('SK_LIVE_KEY');
    });
  });
});

describe('ROLE_ID_PATTERN', () => {
  it('should match valid lowercase role IDs', () => {
    expect(ROLE_ID_PATTERN.test('admin')).toBe(true);
    expect(ROLE_ID_PATTERN.test('standard_user')).toBe(true);
    expect(ROLE_ID_PATTERN.test('power-user')).toBe(true);
    expect(ROLE_ID_PATTERN.test('_internal')).toBe(true);
    expect(ROLE_ID_PATTERN.test('user123')).toBe(true);
  });

  it('should not match uppercase role IDs', () => {
    expect(ROLE_ID_PATTERN.test('Admin')).toBe(false);
    expect(ROLE_ID_PATTERN.test('ADMIN')).toBe(false);
    expect(ROLE_ID_PATTERN.test('standardUser')).toBe(false);
    expect(ROLE_ID_PATTERN.test('User1')).toBe(false);
  });

  it('should not match invalid role IDs', () => {
    expect(ROLE_ID_PATTERN.test('123user')).toBe(false);
    expect(ROLE_ID_PATTERN.test('')).toBe(false);
    expect(ROLE_ID_PATTERN.test('user@domain')).toBe(false);
    expect(ROLE_ID_PATTERN.test('user.admin')).toBe(false);
  });
});

// ============================================================================
// Task 2.12: Enhanced sensitive property detection tests
// ============================================================================

describe('sensitive property detection - compound names (Task 2.12)', () => {
  let tempDir: string;
  let configPath: string;

  const validPhase1Config = {
    projectId: 'test-project',
    name: 'Test Project',
    baseUrl: 'https://example.com',
    environment: 'development' as const,
    allowedDomains: ['example.com'],
    testDirectory: 'tests',
    artifactDirectory: 'artifacts',
  };

  function writeConfig(config: Record<string, unknown>): void {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  beforeEach(() => {
    tempDir = join(tmpdir(), `sens-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(join(tempDir, 'tests'), { recursive: true });
    mkdirSync(join(tempDir, 'artifacts'), { recursive: true });
    configPath = join(tempDir, 'project.config.json');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should reject userPassword at top level', () => {
    writeConfig({
      ...validPhase1Config,
      userPassword: 'some_value',
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('userPassword');
      expect((err as ConfigValidationError).message).toContain('sensitive');
    }
  });

  it('should reject db_password at top level', () => {
    writeConfig({
      ...validPhase1Config,
      db_password: 'some_value',
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('db_password');
    }
  });

  it('should reject authToken at top level', () => {
    writeConfig({
      ...validPhase1Config,
      authToken: 'some_value',
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('authToken');
    }
  });

  it('should reject sessionCookie at top level', () => {
    writeConfig({
      ...validPhase1Config,
      sessionCookie: 'some_value',
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('sessionCookie');
    }
  });

  it('should reject client_secret at top level', () => {
    writeConfig({
      ...validPhase1Config,
      client_secret: 'some_value',
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('client_secret');
    }
  });

  it('should accept credentials.password with valid env var name', () => {
    writeConfig({
      ...validPhase1Config,
      roles: [
        {
          roleId: 'admin',
          name: 'Admin',
          credentials: { password: 'ADMIN_PASSWORD' },
        },
      ],
    });

    const result = loadPhase2ProjectConfig(configPath);
    expect(result.roles![0].credentials.password).toBe('ADMIN_PASSWORD');
  });
});

describe('sensitive property detection - nested objects (Task 2.12)', () => {
  let tempDir: string;
  let configPath: string;

  const validPhase1Config = {
    projectId: 'test-project',
    name: 'Test Project',
    baseUrl: 'https://example.com',
    environment: 'development' as const,
    allowedDomains: ['example.com'],
    testDirectory: 'tests',
    artifactDirectory: 'artifacts',
  };

  function writeConfig(config: Record<string, unknown>): void {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  beforeEach(() => {
    tempDir = join(tmpdir(), `nest-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(join(tempDir, 'tests'), { recursive: true });
    mkdirSync(join(tempDir, 'artifacts'), { recursive: true });
    configPath = join(tempDir, 'project.config.json');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should reject unknown object with nested password field', () => {
    // Use a non-sensitive parent name so we test nested detection
    writeConfig({
      ...validPhase1Config,
      dbConfig: { password: 'my_secret_value' },
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('nested');
      expect((err as ConfigValidationError).message).toContain('password');
    }
  });

  it('should reject unknown object with nested secret field', () => {
    writeConfig({
      ...validPhase1Config,
      serviceConfig: { secret: 'db_secret_value' },
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('nested');
      expect((err as ConfigValidationError).message).toContain('secret');
    }
  });

  it('should reject unknown object with nested token field', () => {
    writeConfig({
      ...validPhase1Config,
      serviceConfig: { token: 'api_token_value' },
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('nested');
      expect((err as ConfigValidationError).message).toContain('token');
    }
  });

  it('should reject unknown object with nested cookie field', () => {
    writeConfig({
      ...validPhase1Config,
      sessionConfig: { cookie: 'session_cookie_value' },
    });

    expect(() => loadPhase2ProjectConfig(configPath)).toThrow(ConfigValidationError);
    try {
      loadPhase2ProjectConfig(configPath);
    } catch (err) {
      expect((err as ConfigValidationError).message).toContain('nested');
      expect((err as ConfigValidationError).message).toContain('cookie');
    }
  });

  it('should allow unknown object without sensitive nested fields', () => {
    writeConfig({
      ...validPhase1Config,
      metadata: { version: '1.0', author: 'Test' },
    });

    // Should not throw - unknown object with non-sensitive fields is allowed
    const result = loadPhase2ProjectConfig(configPath);
    expect(result.projectId).toBe('test-project');
  });
});

describe('sensitive property detection - false positive prevention (Task 2.12)', () => {
  let tempDir: string;
  let configPath: string;

  const validPhase1Config = {
    projectId: 'test-project',
    name: 'Test Project',
    baseUrl: 'https://example.com',
    environment: 'development' as const,
    allowedDomains: ['example.com'],
    testDirectory: 'tests',
    artifactDirectory: 'artifacts',
  };

  function writeConfig(config: Record<string, unknown>): void {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  beforeEach(() => {
    tempDir = join(tmpdir(), `fp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(join(tempDir, 'tests'), { recursive: true });
    mkdirSync(join(tempDir, 'artifacts'), { recursive: true });
    configPath = join(tempDir, 'project.config.json');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should accept keyboardLayout (no sensitive substring match)', () => {
    // keyboardLayout does not contain password, secret, token, cookie, or credential
    writeConfig({
      ...validPhase1Config,
      keyboardLayout: 'us-international',
    });

    // Should not throw - harmless property
    const result = loadPhase2ProjectConfig(configPath);
    expect(result.projectId).toBe('test-project');
  });

  it('should accept displaySettings (no sensitive substring match)', () => {
    writeConfig({
      ...validPhase1Config,
      displaySettings: { theme: 'dark', fontSize: 14 },
    });

    // Should not throw
    const result = loadPhase2ProjectConfig(configPath);
    expect(result.projectId).toBe('test-project');
  });

  it('should accept networkTimeout (no sensitive substring match)', () => {
    // 'timeout' is not 'token' - verify no accidental partial match
    writeConfig({
      ...validPhase1Config,
      networkTimeout: 30000,
    });

    // Should not throw
    const result = loadPhase2ProjectConfig(configPath);
    expect(result.projectId).toBe('test-project');
  });
});
