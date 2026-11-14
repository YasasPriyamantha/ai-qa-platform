/**
 * Tests for Phase 2 project configuration loader
 *
 * Verifies:
 * - Legacy Phase 1 config compatibility
 * - Valid Phase 2 config with new fields
 * - Invalid new fields rejection
 * - Secret-value rejection in credentials
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPhase2ProjectConfig,
  looksLikeSecret,
  isValidEnvVarName,
} from '../../../src/projects/phase2-loader.js';
import { ConfigValidationError } from '../../../src/projects/config.js';

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

    it('should accept lowercase environment variable names (non-standard but allowed)', () => {
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

      const result = loadPhase2ProjectConfig(configPath);
      expect(result.roles![0].credentials.username).toBe('my_username_var');
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
