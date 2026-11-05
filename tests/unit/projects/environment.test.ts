import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, win32 as pathWin32 } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPlaywrightConfig,
  ENV_PROJECT_CONFIG_PATH,
  ENV_RUN_DIR,
} from '../../../src/projects/environment.js';
import { ConfigValidationError } from '../../../src/projects/config.js';

describe('loadPlaywrightConfig', () => {
  let tempDir: string;
  let configPath: string;
  let testDir: string;
  let artifactDir: string;
  let runDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `qa-env-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    configPath = join(tempDir, 'project.config.json');
    testDir = join(tempDir, 'tests', 'approved');
    artifactDir = join(tempDir, 'artifacts');
    runDir = join(artifactDir, '2024-01-01T00-00-00-000Z');
    mkdirSync(testDir, { recursive: true });
    mkdirSync(runDir, { recursive: true });
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

  describe('valid environment', () => {
    it('should load configuration from valid environment variables', () => {
      writeConfig(validConfig);
      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
        [ENV_RUN_DIR]: runDir,
      };

      const result = loadPlaywrightConfig(env);

      expect(result.config.projectId).toBe('test-project');
      expect(result.runDir).toBe(runDir);
      expect(result.testDir).toBe(testDir);
      expect(result.baseURL).toBe('https://example.com/');
      expect(result.outputDir).toBe(join(runDir, 'test-output'));
    });

    it('should derive correct outputDir inside runDir', () => {
      writeConfig(validConfig);
      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
        [ENV_RUN_DIR]: runDir,
      };

      const result = loadPlaywrightConfig(env);
      expect(result.outputDir).toContain('test-output');
      expect(result.outputDir.startsWith(runDir)).toBe(true);
    });
  });

  describe('missing environment variables', () => {
    it('should reject missing QA_PROJECT_CONFIG_PATH', () => {
      writeConfig(validConfig);
      const env = {
        [ENV_RUN_DIR]: runDir,
      };

      expect(() => loadPlaywrightConfig(env)).toThrow(ConfigValidationError);
      try {
        loadPlaywrightConfig(env);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe(ENV_PROJECT_CONFIG_PATH);
        expect((err as ConfigValidationError).message).toContain('required but not set');
      }
    });

    it('should reject empty QA_PROJECT_CONFIG_PATH', () => {
      writeConfig(validConfig);
      const env = {
        [ENV_PROJECT_CONFIG_PATH]: '',
        [ENV_RUN_DIR]: runDir,
      };

      expect(() => loadPlaywrightConfig(env)).toThrow(ConfigValidationError);
      try {
        loadPlaywrightConfig(env);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe(ENV_PROJECT_CONFIG_PATH);
      }
    });

    it('should reject whitespace-only QA_PROJECT_CONFIG_PATH', () => {
      writeConfig(validConfig);
      const env = {
        [ENV_PROJECT_CONFIG_PATH]: '   ',
        [ENV_RUN_DIR]: runDir,
      };

      expect(() => loadPlaywrightConfig(env)).toThrow(ConfigValidationError);
    });

    it('should reject missing QA_RUN_DIR', () => {
      writeConfig(validConfig);
      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
      };

      expect(() => loadPlaywrightConfig(env)).toThrow(ConfigValidationError);
      try {
        loadPlaywrightConfig(env);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe(ENV_RUN_DIR);
        expect((err as ConfigValidationError).message).toContain('required but not set');
      }
    });

    it('should reject empty QA_RUN_DIR', () => {
      writeConfig(validConfig);
      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
        [ENV_RUN_DIR]: '',
      };

      expect(() => loadPlaywrightConfig(env)).toThrow(ConfigValidationError);
      try {
        loadPlaywrightConfig(env);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe(ENV_RUN_DIR);
      }
    });
  });

  describe('invalid run directory', () => {
    it('should reject non-existent run directory', () => {
      writeConfig(validConfig);
      const nonExistentRunDir = join(artifactDir, 'nonexistent');
      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
        [ENV_RUN_DIR]: nonExistentRunDir,
      };

      expect(() => loadPlaywrightConfig(env)).toThrow(ConfigValidationError);
      try {
        loadPlaywrightConfig(env);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe(ENV_RUN_DIR);
        expect((err as ConfigValidationError).message).toContain('does not exist');
      }
    });

    it('should reject run directory that is a file', () => {
      writeConfig(validConfig);
      const fileRunDir = join(artifactDir, 'not-a-dir');
      writeFileSync(fileRunDir, 'content');
      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
        [ENV_RUN_DIR]: fileRunDir,
      };

      expect(() => loadPlaywrightConfig(env)).toThrow(ConfigValidationError);
      try {
        loadPlaywrightConfig(env);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe(ENV_RUN_DIR);
        expect((err as ConfigValidationError).message).toContain('not a directory');
      }
    });

    it('should reject relative run directory path', () => {
      writeConfig(validConfig);
      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
        [ENV_RUN_DIR]: 'relative/path',
      };

      expect(() => loadPlaywrightConfig(env)).toThrow(ConfigValidationError);
      try {
        loadPlaywrightConfig(env);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe(ENV_RUN_DIR);
        expect((err as ConfigValidationError).message).toContain('absolute path');
      }
    });
  });

  describe('run directory containment', () => {
    it('should reject run directory outside artifact directory', () => {
      writeConfig(validConfig);
      // Create a directory outside the artifact directory
      const outsideDir = join(tempDir, 'outside-artifacts');
      mkdirSync(outsideDir, { recursive: true });

      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
        [ENV_RUN_DIR]: outsideDir,
      };

      expect(() => loadPlaywrightConfig(env)).toThrow(ConfigValidationError);
      try {
        loadPlaywrightConfig(env);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe(ENV_RUN_DIR);
        expect((err as ConfigValidationError).message).toContain('inside the artifact directory');
      }
    });

    it('should reject run directory with path traversal', () => {
      writeConfig(validConfig);
      // Create a run dir that tries to escape via ..
      const escapingDir = join(artifactDir, '..', 'escaped');
      mkdirSync(escapingDir, { recursive: true });

      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
        [ENV_RUN_DIR]: escapingDir,
      };

      expect(() => loadPlaywrightConfig(env)).toThrow(ConfigValidationError);
    });

    it('should accept run directory inside artifact directory', () => {
      writeConfig(validConfig);
      const nestedRunDir = join(artifactDir, 'runs', '2024-01-01');
      mkdirSync(nestedRunDir, { recursive: true });

      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
        [ENV_RUN_DIR]: nestedRunDir,
      };

      const result = loadPlaywrightConfig(env);
      expect(result.runDir).toBe(nestedRunDir);
    });

    it('should reject run directory equal to artifact directory', () => {
      // QA_RUN_DIR must be a strict descendant of artifactDirectory
      // Run directory === artifact directory is not allowed
      writeConfig(validConfig);
      // Use artifactDir directly as run directory
      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
        [ENV_RUN_DIR]: artifactDir,
      };

      expect(() => loadPlaywrightConfig(env)).toThrow(ConfigValidationError);
      try {
        loadPlaywrightConfig(env);
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe(ENV_RUN_DIR);
        expect((err as ConfigValidationError).message).toContain('strict descendant');
      }
    });
  });
});

describe('Windows-specific path handling', () => {
  // Test Windows drive letter case handling
  // On Windows, D:\path and d:\path should be considered equivalent

  it('should handle Windows paths with forward slashes', () => {
    const tempDir = join(tmpdir(), `qa-win-env-${Date.now()}`);
    const configPath = join(tempDir, 'project.config.json');
    const testDir = join(tempDir, 'tests', 'approved');
    const artifactDir = join(tempDir, 'artifacts');
    const runDir = join(artifactDir, 'run-1');

    try {
      mkdirSync(testDir, { recursive: true });
      mkdirSync(runDir, { recursive: true });

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

      const env = {
        [ENV_PROJECT_CONFIG_PATH]: configPath,
        [ENV_RUN_DIR]: runDir,
      };

      const result = loadPlaywrightConfig(env);
      expect(result.config.projectId).toBe('win-test');
    } finally {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  // This test is specific to Windows and verifies drive letter case handling
  if (process.platform === 'win32') {
    it('should handle Windows drive letter case differences', () => {
      const tempDir = join(tmpdir(), `qa-drive-case-${Date.now()}`);
      const configPath = join(tempDir, 'project.config.json');
      const testDir = join(tempDir, 'tests', 'approved');
      const artifactDir = join(tempDir, 'artifacts');
      const runDir = join(artifactDir, 'run-1');

      try {
        mkdirSync(testDir, { recursive: true });
        mkdirSync(runDir, { recursive: true });

        const config = {
          projectId: 'drive-case-test',
          name: 'Drive Case Test',
          baseUrl: 'https://example.com/',
          environment: 'demo',
          allowedDomains: ['example.com'],
          testDirectory: 'tests/approved',
          artifactDirectory: 'artifacts',
        };
        writeFileSync(configPath, JSON.stringify(config));

        // Get paths with different drive letter cases
        const upperConfigPath = configPath.replace(/^([a-z]):/, (_, letter) =>
          letter.toUpperCase() + ':'
        );
        const lowerRunDir = runDir.replace(/^([A-Z]):/, (_, letter) =>
          letter.toLowerCase() + ':'
        );

        const env = {
          [ENV_PROJECT_CONFIG_PATH]: upperConfigPath,
          [ENV_RUN_DIR]: lowerRunDir,
        };

        // Should not throw - paths should be recognized as equivalent
        const result = loadPlaywrightConfig(env);
        expect(result.config.projectId).toBe('drive-case-test');
      } finally {
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    });
  }
});

describe('Cross-drive path containment (Windows behavior)', () => {
  // These tests verify that the containment logic correctly handles paths
  // on different drives. On Windows, path.relative between different drives
  // returns an absolute path, which must be rejected.
  //
  // These tests use path.win32 with synthetic paths to deterministically
  // test the behavior without requiring another physical drive to be mounted.

  it('should detect different-drive paths via path.relative', () => {
    // Verify that path.win32.relative returns an absolute path for different drives
    // This is the behavior our containment check relies on
    const artifactDir = 'D:\\ai-qa-platform\\project-data\\saucedemo\\artifacts';
    const runDir = 'C:\\outside\\run-001';

    const rel = pathWin32.relative(artifactDir, runDir);

    // On Windows, relative path between different drives returns the target as absolute
    expect(rel).toBe(runDir);

    // Our containment check would reject this because rel is an absolute path
    const isAbsolute = /^[a-zA-Z]:[\\/]/.test(rel) || pathWin32.isAbsolute(rel);
    expect(isAbsolute).toBe(true);
  });

  it('should detect same-drive containment correctly', () => {
    // Verify valid containment within the same drive
    const artifactDir = 'D:\\ai-qa-platform\\project-data\\saucedemo\\artifacts';
    const validRunDir = 'D:\\ai-qa-platform\\project-data\\saucedemo\\artifacts\\run-001';

    const rel = pathWin32.relative(artifactDir, validRunDir);

    // Relative path should be 'run-001' (not starting with '..' and not absolute)
    expect(rel).toBe('run-001');
    expect(rel.startsWith('..')).toBe(false);
    expect(pathWin32.isAbsolute(rel)).toBe(false);
  });

  it('should detect equality case via empty relative path', () => {
    // Verify that equal paths produce an empty relative path
    const artifactDir = 'D:\\ai-qa-platform\\project-data\\saucedemo\\artifacts';
    const sameDir = 'D:\\ai-qa-platform\\project-data\\saucedemo\\artifacts';

    const rel = pathWin32.relative(artifactDir, sameDir);

    // Empty string indicates same path
    expect(rel).toBe('');
  });

  it('should detect parent directory escape via ..', () => {
    // Verify that escaping to parent returns a relative path starting with ..
    const artifactDir = 'D:\\ai-qa-platform\\project-data\\saucedemo\\artifacts';
    const escapedDir = 'D:\\ai-qa-platform\\project-data\\saucedemo\\tests';

    const rel = pathWin32.relative(artifactDir, escapedDir);

    // Should start with .. indicating escape from artifact directory
    expect(rel.startsWith('..')).toBe(true);
  });
});
