import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadProjectConfig } from '../../../src/projects/loader.js';
import { ConfigValidationError } from '../../../src/projects/config.js';

describe('loadProjectConfig', () => {
  let tempDir: string;
  let configPath: string;
  let testDir: string;
  let artifactDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = join(tmpdir(), `qa-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  const validConfig = {
    projectId: 'test-project',
    name: 'Test Project',
    baseUrl: 'https://example.com/',
    environment: 'demo',
    allowedDomains: ['example.com'],
    testDirectory: 'tests/approved',
    artifactDirectory: 'artifacts',
  };

  describe('valid configuration', () => {
    it('should load a valid configuration', () => {
      writeConfig(validConfig);
      const result = loadProjectConfig(configPath);

      expect(result.projectId).toBe('test-project');
      expect(result.name).toBe('Test Project');
      expect(result.baseUrl).toBe('https://example.com/');
      expect(result.environment).toBe('demo');
      expect(result.allowedDomains).toEqual(['example.com']);
      expect(result.testDirectory).toBe('tests/approved');
      expect(result.artifactDirectory).toBe('artifacts');
      expect(result.projectWorkspace).toBe(tempDir);
      expect(result.resolvedTestDirectory).toBe(testDir);
      expect(result.resolvedArtifactDirectory).toBe(artifactDir);
      expect(result.configPath).toBe(configPath);
    });

    it('should accept all valid environments', () => {
      for (const env of ['local', 'development', 'demo', 'staging']) {
        writeConfig({ ...validConfig, environment: env });
        const result = loadProjectConfig(configPath);
        expect(result.environment).toBe(env);
      }
    });
  });

  describe('missing required fields', () => {
    const requiredFields = [
      'projectId',
      'name',
      'baseUrl',
      'environment',
      'allowedDomains',
      'testDirectory',
      'artifactDirectory',
    ];

    for (const field of requiredFields) {
      it(`should reject missing ${field}`, () => {
        const config = { ...validConfig };
        delete (config as Record<string, unknown>)[field];
        writeConfig(config);

        expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
        try {
          loadProjectConfig(configPath);
        } catch (err) {
          expect((err as ConfigValidationError).field).toBe(field);
          expect((err as ConfigValidationError).message).toContain('missing');
        }
      });
    }
  });

  describe('malformed JSON', () => {
    it('should reject invalid JSON syntax', () => {
      writeFileSync(configPath, '{ invalid json }');
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('Invalid JSON');
      }
    });

    it('should reject non-object JSON', () => {
      writeFileSync(configPath, '"just a string"');
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
    });

    it('should reject array JSON', () => {
      writeFileSync(configPath, '[]');
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
    });

    it('should reject null JSON', () => {
      writeFileSync(configPath, 'null');
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
    });
  });

  describe('invalid URL/domain', () => {
    it('should reject invalid URL syntax', () => {
      writeConfig({ ...validConfig, baseUrl: 'not-a-url' });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('baseUrl');
        expect((err as ConfigValidationError).message).toContain('Invalid URL');
      }
    });

    it('should reject URL hostname not in allowedDomains', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://other.com/',
        allowedDomains: ['example.com'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('baseUrl');
        expect((err as ConfigValidationError).message).toContain('not in allowedDomains');
      }
    });
  });

  describe('empty allowedDomains', () => {
    it('should reject empty allowedDomains array', () => {
      writeConfig({ ...validConfig, allowedDomains: [] });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('allowedDomains');
        expect((err as ConfigValidationError).message).toContain('at least one domain');
      }
    });

    it('should reject allowedDomains with empty strings', () => {
      writeConfig({ ...validConfig, allowedDomains: [''] });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
    });

    it('should reject non-array allowedDomains', () => {
      writeConfig({ ...validConfig, allowedDomains: 'example.com' });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('allowedDomains');
        expect((err as ConfigValidationError).message).toContain('Must be an array');
      }
    });
  });

  describe('allowedDomains format validation', () => {
    it('should reject URL-form entries with scheme (http://)', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://www.saucedemo.com/',
        allowedDomains: ['http://www.saucedemo.com'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('allowedDomains');
        expect((err as ConfigValidationError).message).toContain('contains scheme');
      }
    });

    it('should reject URL-form entries with scheme (https://)', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://example.com/',
        allowedDomains: ['https://example.com'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('allowedDomains');
        expect((err as ConfigValidationError).message).toContain('contains scheme');
      }
    });

    it('should reject entries containing paths', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://example.com/',
        allowedDomains: ['example.com/path'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('allowedDomains');
        expect((err as ConfigValidationError).message).toContain('contains "/"');
      }
    });

    it('should reject entries containing ports', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://example.com/',
        allowedDomains: ['example.com:8080'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('allowedDomains');
        expect((err as ConfigValidationError).message).toContain('contains ":"');
      }
    });

    it('should reject entries with consecutive dots', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://example.com/',
        allowedDomains: ['example..com'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('allowedDomains');
        expect((err as ConfigValidationError).message).toContain('consecutive dots');
      }
    });
  });

  describe('hostname exact match validation', () => {
    it('should accept exact hostname match', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://www.saucedemo.com/',
        allowedDomains: ['www.saucedemo.com'],
      });
      const result = loadProjectConfig(configPath);
      expect(result.baseUrl).toBe('https://www.saucedemo.com/');
    });

    it('should accept case-insensitive exact hostname match (lowercase domain, uppercase URL)', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://WWW.SAUCEDEMO.COM/',
        allowedDomains: ['www.saucedemo.com'],
      });
      const result = loadProjectConfig(configPath);
      // URL constructor normalizes hostname to lowercase
      expect(result.baseUrl).toBe('https://WWW.SAUCEDEMO.COM/');
    });

    it('should accept case-insensitive exact hostname match (uppercase domain, lowercase URL)', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://www.saucedemo.com/',
        allowedDomains: ['WWW.SAUCEDEMO.COM'],
      });
      const result = loadProjectConfig(configPath);
      expect(result.baseUrl).toBe('https://www.saucedemo.com/');
    });

    it('should accept case-insensitive exact hostname match (mixed case)', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://Www.SauceDemo.Com/',
        allowedDomains: ['wWw.sAuCeDeMo.cOm'],
      });
      const result = loadProjectConfig(configPath);
      expect(result.baseUrl).toBe('https://Www.SauceDemo.Com/');
    });

    it('should reject parent domain when subdomain is in URL', () => {
      // allowedDomains has parent, but baseUrl uses www subdomain
      writeConfig({
        ...validConfig,
        baseUrl: 'https://www.saucedemo.com/',
        allowedDomains: ['saucedemo.com'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('baseUrl');
        expect((err as ConfigValidationError).message).toContain('not in allowedDomains');
      }
    });

    it('should reject subdomain when parent domain is in URL', () => {
      // allowedDomains has subdomain, but baseUrl uses parent
      writeConfig({
        ...validConfig,
        baseUrl: 'https://saucedemo.com/',
        allowedDomains: ['www.saucedemo.com'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('baseUrl');
        expect((err as ConfigValidationError).message).toContain('not in allowedDomains');
      }
    });

    it('should reject lookalike domain (attacker domain containing target as prefix)', () => {
      // www.saucedemo.com.evil.test should NOT match www.saucedemo.com
      writeConfig({
        ...validConfig,
        baseUrl: 'https://www.saucedemo.com.evil.test/',
        allowedDomains: ['www.saucedemo.com'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('baseUrl');
        expect((err as ConfigValidationError).message).toContain('not in allowedDomains');
      }
    });

    it('should reject lookalike domain (target as suffix)', () => {
      // evil-www.saucedemo.com should NOT match www.saucedemo.com
      writeConfig({
        ...validConfig,
        baseUrl: 'https://evil-www.saucedemo.com/',
        allowedDomains: ['www.saucedemo.com'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('baseUrl');
        expect((err as ConfigValidationError).message).toContain('not in allowedDomains');
      }
    });

    it('should reject lookalike domain (target as substring)', () => {
      // evil.www.saucedemo.com.bad should NOT match www.saucedemo.com
      writeConfig({
        ...validConfig,
        baseUrl: 'https://evil.www.saucedemo.com.bad/',
        allowedDomains: ['www.saucedemo.com'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('baseUrl');
        expect((err as ConfigValidationError).message).toContain('not in allowedDomains');
      }
    });

    it('should accept multiple allowed domains with exact match', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://api.example.com/',
        allowedDomains: ['www.example.com', 'api.example.com', 'cdn.example.com'],
      });
      const result = loadProjectConfig(configPath);
      expect(result.baseUrl).toBe('https://api.example.com/');
    });
  });

  describe('environment validation', () => {
    it('should reject production environment', () => {
      writeConfig({ ...validConfig, environment: 'production' });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('environment');
        expect((err as ConfigValidationError).message).toContain('Production environment is not allowed');
      }
    });

    it('should reject unsupported environment values', () => {
      writeConfig({ ...validConfig, environment: 'testing' });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('environment');
        expect((err as ConfigValidationError).message).toContain('Must be one of');
      }
    });

    it('should reject non-string environment', () => {
      writeConfig({ ...validConfig, environment: 123 });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
    });
  });

  describe('HTTP/HTTPS validation', () => {
    it('should allow HTTP for localhost', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'http://localhost/',
        allowedDomains: ['localhost'],
      });
      const result = loadProjectConfig(configPath);
      expect(result.baseUrl).toBe('http://localhost/');
    });

    it('should reject HTTP for 127.0.0.1', () => {
      // HTTP is only allowed for hostname 'localhost', not for 127.0.0.1
      writeConfig({
        ...validConfig,
        baseUrl: 'http://127.0.0.1/',
        allowedDomains: ['127.0.0.1'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('baseUrl');
        expect((err as ConfigValidationError).message).toContain('HTTP is only allowed for localhost');
      }
    });

    it('should reject HTTP for non-localhost', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'http://example.com/',
        allowedDomains: ['example.com'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('baseUrl');
        expect((err as ConfigValidationError).message).toContain('HTTP is only allowed for localhost');
      }
    });

    it('should allow HTTPS for any domain', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'https://example.com/',
        allowedDomains: ['example.com'],
      });
      const result = loadProjectConfig(configPath);
      expect(result.baseUrl).toBe('https://example.com/');
    });

    it('should reject non-http/https protocols', () => {
      writeConfig({
        ...validConfig,
        baseUrl: 'ftp://example.com/',
        allowedDomains: ['example.com'],
      });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('baseUrl');
        expect((err as ConfigValidationError).message).toContain('http or https');
      }
    });
  });

  describe('missing test directory', () => {
    it('should reject non-existent test directory', () => {
      rmSync(testDir, { recursive: true });
      writeConfig(validConfig);
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('testDirectory');
        expect((err as ConfigValidationError).message).toContain('does not exist');
      }
    });

    it('should reject test directory that is a file', () => {
      rmSync(testDir, { recursive: true });
      mkdirSync(join(tempDir, 'tests'), { recursive: true });
      writeFileSync(testDir, 'not a directory');
      writeConfig(validConfig);
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('testDirectory');
        expect((err as ConfigValidationError).message).toContain('not a directory');
      }
    });
  });

  describe('path traversal outside workspace', () => {
    it('should reject testDirectory with ../', () => {
      writeConfig({ ...validConfig, testDirectory: '../outside' });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('testDirectory');
        expect((err as ConfigValidationError).message).toContain('escapes project workspace');
      }
    });

    it('should reject artifactDirectory with ../', () => {
      writeConfig({ ...validConfig, artifactDirectory: '../outside' });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
      try {
        loadProjectConfig(configPath);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe('artifactDirectory');
        expect((err as ConfigValidationError).message).toContain('escapes project workspace');
      }
    });

    it('should reject absolute paths outside workspace', () => {
      const outsidePath = join(tmpdir(), 'outside-workspace');
      writeConfig({ ...validConfig, testDirectory: outsidePath });
      expect(() => loadProjectConfig(configPath)).toThrow(ConfigValidationError);
    });
  });

  describe('config path validation', () => {
    it('should reject non-existent config file', () => {
      expect(() => loadProjectConfig('/nonexistent/path.json')).toThrow(
        ConfigValidationError
      );
    });

    it('should reject relative config path', () => {
      expect(() => loadProjectConfig('relative/path.json')).toThrow(
        ConfigValidationError
      );
      try {
        loadProjectConfig('relative/path.json');
      } catch (err) {
        expect((err as ConfigValidationError).message).toContain('must be absolute');
      }
    });
  });
});

describe('Windows path handling', () => {
  // These tests verify Windows-specific behavior
  // They should pass on Windows and be informative on other platforms

  it('should handle Windows path separators in testDirectory', () => {
    // This test creates a directory structure and validates path handling
    const tempDir = join(tmpdir(), `qa-win-test-${Date.now()}`);
    const configPath = join(tempDir, 'project.config.json');
    const testDir = join(tempDir, 'tests', 'approved');
    const artifactDir = join(tempDir, 'artifacts');

    try {
      mkdirSync(testDir, { recursive: true });
      mkdirSync(artifactDir, { recursive: true });

      // Use forward slashes in config (should work on all platforms)
      const config = {
        projectId: 'win-test',
        name: 'Windows Test',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
        testDirectory: 'tests/approved',
        artifactDirectory: 'artifacts',
      };
      writeFileSync(configPath, JSON.stringify(config));

      const result = loadProjectConfig(configPath);
      expect(result.projectId).toBe('win-test');
      expect(existsSync(result.resolvedTestDirectory)).toBe(true);
    } finally {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });
});
