/**
 * Unit tests for CLI run command
 *
 * Tests:
 * - Timeout wiring and exit code behavior using mocked runner
 * - Phase 2 configuration validation (DEC-032)
 * - Phase 1 backward compatibility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the runner module before importing run-command
vi.mock('../../../src/test-execution/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/test-execution/index.js')>();
  return {
    ...actual,
    runPlaywrightTests: vi.fn(),
  };
});

// Mock console methods to capture output
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

/**
 * Create a valid Playwright JSON report.
 */
function createValidJsonReport(overrides: {
  expected?: number;
  unexpected?: number;
  skipped?: number;
  duration?: number;
} = {}): string {
  return JSON.stringify({
    stats: {
      expected: overrides.expected ?? 1,
      unexpected: overrides.unexpected ?? 0,
      flaky: 0,
      skipped: overrides.skipped ?? 0,
      duration: overrides.duration ?? 1000,
    },
    errors: [],
    suites: [],
  });
}

describe('executeRunCommand - timeout wiring', () => {
  let tempDir: string;
  let configPath: string;
  let capturedTimeoutMs: number | undefined;

  beforeEach(async () => {
    // Create temporary project directory
    tempDir = join(tmpdir(), `qa-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const testDir = join(tempDir, 'tests', 'approved');
    const artifactDir = join(tempDir, 'artifacts');
    configPath = join(tempDir, 'project.config.json');

    mkdirSync(testDir, { recursive: true });
    mkdirSync(artifactDir, { recursive: true });

    // Create minimal valid config
    const config = {
      projectId: 'cli-test',
      name: 'CLI Test Project',
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Suppress console output during tests
    console.log = vi.fn();
    console.error = vi.fn();
    process.stdout.write = vi.fn() as typeof process.stdout.write;
    process.stderr.write = vi.fn() as typeof process.stderr.write;

    // Reset captured timeout
    capturedTimeoutMs = undefined;
  });

  afterEach(() => {
    vi.resetAllMocks();
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should pass exactly 30 * 60 * 1000 ms timeout to the runner', async () => {
    const { runPlaywrightTests } = await import('../../../src/test-execution/index.js');
    const mockedRunner = vi.mocked(runPlaywrightTests);

    // Capture the options passed to runPlaywrightTests
    mockedRunner.mockImplementation(async (_config, options) => {
      capturedTimeoutMs = options?.timeoutMs;
      const runDir = join(tempDir, 'artifacts', '2026-01-01T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });

      // Create report files
      writeFileSync(join(runDir, 'results.json'), createValidJsonReport());
      mkdirSync(join(runDir, 'html-report'), { recursive: true });
      writeFileSync(join(runDir, 'html-report', 'index.html'), '<html></html>');

      return {
        runId: '2026-01-01T00-00-00-000Z',
        runDirectory: runDir,
        projectConfigPath: configPath,
        projectId: 'cli-test',
        processResult: {
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          startTime: '2026-01-01T00:00:00.000Z',
          endTime: '2026-01-01T00:00:01.000Z',
          duration: 1000,
          timedOut: false,
        },
      };
    });

    const { executeRunCommand } = await import('../../../src/cli/run-command.js');
    await executeRunCommand(configPath);

    // Verify exact timeout value: 30 minutes in milliseconds
    expect(capturedTimeoutMs).toBe(30 * 60 * 1000);
    expect(capturedTimeoutMs).toBe(1800000);
  });

  it('should return non-zero exit code when runner times out', async () => {
    const { runPlaywrightTests } = await import('../../../src/test-execution/index.js');
    const mockedRunner = vi.mocked(runPlaywrightTests);

    // Mock runner to return a timed-out result
    mockedRunner.mockResolvedValue({
      runId: '2026-01-01T00-00-00-000Z',
      runDirectory: join(tempDir, 'artifacts', '2026-01-01T00-00-00-000Z'),
      projectConfigPath: configPath,
      projectId: 'cli-test',
      processResult: {
        exitCode: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: '',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-01T00:30:00.000Z',
        duration: 1800000,
        timedOut: true,
        cleanup: {
          requested: true,
          success: true,
          method: 'taskkill',
          duration: 100,
        },
      },
    });

    // Create run directory (even though no reports, simulating timeout)
    const runDir = join(tempDir, 'artifacts', '2026-01-01T00-00-00-000Z');
    mkdirSync(runDir, { recursive: true });

    const { executeRunCommand } = await import('../../../src/cli/run-command.js');
    const exitCode = await executeRunCommand(configPath);

    // Timeout should result in non-zero exit code
    expect(exitCode).not.toBe(0);
    expect(exitCode).toBe(1);
  });
});

describe('executeRunCommand - exit codes', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `qa-exit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const testDir = join(tempDir, 'tests', 'approved');
    const artifactDir = join(tempDir, 'artifacts');
    configPath = join(tempDir, 'project.config.json');

    mkdirSync(testDir, { recursive: true });
    mkdirSync(artifactDir, { recursive: true });

    const config = {
      projectId: 'exit-test',
      name: 'Exit Test Project',
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log = vi.fn();
    console.error = vi.fn();
    process.stdout.write = vi.fn() as typeof process.stdout.write;
    process.stderr.write = vi.fn() as typeof process.stderr.write;
  });

  afterEach(() => {
    vi.resetAllMocks();
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should return exit code 0 for successful run with complete report', async () => {
    const { runPlaywrightTests } = await import('../../../src/test-execution/index.js');
    const mockedRunner = vi.mocked(runPlaywrightTests);

    const runDir = join(tempDir, 'artifacts', '2026-01-01T00-00-00-000Z');

    mockedRunner.mockImplementation(async () => {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'results.json'), createValidJsonReport());
      mkdirSync(join(runDir, 'html-report'), { recursive: true });
      writeFileSync(join(runDir, 'html-report', 'index.html'), '<html></html>');

      return {
        runId: '2026-01-01T00-00-00-000Z',
        runDirectory: runDir,
        projectConfigPath: configPath,
        projectId: 'exit-test',
        processResult: {
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          startTime: '2026-01-01T00:00:00.000Z',
          endTime: '2026-01-01T00:00:10.000Z',
          duration: 10000,
          timedOut: false,
        },
      };
    });

    const { executeRunCommand } = await import('../../../src/cli/run-command.js');
    const exitCode = await executeRunCommand(configPath);

    expect(exitCode).toBe(0);
  });

  it('should return exit code 1 for test failure', async () => {
    const { runPlaywrightTests } = await import('../../../src/test-execution/index.js');
    const mockedRunner = vi.mocked(runPlaywrightTests);

    const runDir = join(tempDir, 'artifacts', '2026-01-01T00-00-00-000Z');

    mockedRunner.mockImplementation(async () => {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'results.json'), createValidJsonReport({ expected: 0, unexpected: 1 }));
      mkdirSync(join(runDir, 'html-report'), { recursive: true });
      writeFileSync(join(runDir, 'html-report', 'index.html'), '<html></html>');

      return {
        runId: '2026-01-01T00-00-00-000Z',
        runDirectory: runDir,
        projectConfigPath: configPath,
        projectId: 'exit-test',
        processResult: {
          exitCode: 1,
          signal: null,
          stdout: '',
          stderr: '',
          startTime: '2026-01-01T00:00:00.000Z',
          endTime: '2026-01-01T00:00:10.000Z',
          duration: 10000,
          timedOut: false,
        },
      };
    });

    const { executeRunCommand } = await import('../../../src/cli/run-command.js');
    const exitCode = await executeRunCommand(configPath);

    expect(exitCode).toBe(1);
  });

  it('should return exit code 1 for cleanup failure', async () => {
    const { runPlaywrightTests } = await import('../../../src/test-execution/index.js');
    const mockedRunner = vi.mocked(runPlaywrightTests);

    const runDir = join(tempDir, 'artifacts', '2026-01-01T00-00-00-000Z');

    mockedRunner.mockImplementation(async () => {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'results.json'), createValidJsonReport());
      mkdirSync(join(runDir, 'html-report'), { recursive: true });
      writeFileSync(join(runDir, 'html-report', 'index.html'), '<html></html>');

      return {
        runId: '2026-01-01T00-00-00-000Z',
        runDirectory: runDir,
        projectConfigPath: configPath,
        projectId: 'exit-test',
        processResult: {
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          startTime: '2026-01-01T00:00:00.000Z',
          endTime: '2026-01-01T00:00:10.000Z',
          duration: 10000,
          timedOut: false,
          cleanup: {
            requested: true,
            success: false,
            method: 'taskkill',
            duration: 100,
            error: 'Cleanup failed',
          },
        },
      };
    });

    const { executeRunCommand } = await import('../../../src/cli/run-command.js');
    const exitCode = await executeRunCommand(configPath);

    expect(exitCode).toBe(1);
  });

  it('should return exit code 1 for partial report (missing HTML)', async () => {
    const { runPlaywrightTests } = await import('../../../src/test-execution/index.js');
    const mockedRunner = vi.mocked(runPlaywrightTests);

    const runDir = join(tempDir, 'artifacts', '2026-01-01T00-00-00-000Z');

    mockedRunner.mockImplementation(async () => {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'results.json'), createValidJsonReport());
      // Do NOT create html-report

      return {
        runId: '2026-01-01T00-00-00-000Z',
        runDirectory: runDir,
        projectConfigPath: configPath,
        projectId: 'exit-test',
        processResult: {
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          startTime: '2026-01-01T00:00:00.000Z',
          endTime: '2026-01-01T00:00:10.000Z',
          duration: 10000,
          timedOut: false,
        },
      };
    });

    const { executeRunCommand } = await import('../../../src/cli/run-command.js');
    const exitCode = await executeRunCommand(configPath);

    expect(exitCode).toBe(1);
  });

  it('should return exit code 1 for output incomplete', async () => {
    const { runPlaywrightTests } = await import('../../../src/test-execution/index.js');
    const mockedRunner = vi.mocked(runPlaywrightTests);

    const runDir = join(tempDir, 'artifacts', '2026-01-01T00-00-00-000Z');

    mockedRunner.mockImplementation(async () => {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'results.json'), createValidJsonReport());
      mkdirSync(join(runDir, 'html-report'), { recursive: true });
      writeFileSync(join(runDir, 'html-report', 'index.html'), '<html></html>');

      return {
        runId: '2026-01-01T00-00-00-000Z',
        runDirectory: runDir,
        projectConfigPath: configPath,
        projectId: 'exit-test',
        processResult: {
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          startTime: '2026-01-01T00:00:00.000Z',
          endTime: '2026-01-01T00:00:10.000Z',
          duration: 10000,
          timedOut: false,
          outputIncomplete: true,
        },
      };
    });

    const { executeRunCommand } = await import('../../../src/cli/run-command.js');
    const exitCode = await executeRunCommand(configPath);

    expect(exitCode).toBe(1);
  });
});

/**
 * Phase 2 configuration validation tests (DEC-032)
 *
 * These tests verify that the CLI rejects invalid Phase 2 configuration
 * before Playwright starts, and accepts valid configurations.
 */
describe('executeRunCommand - Phase 2 configuration validation (DEC-032)', () => {
  let tempDir: string;
  let configPath: string;
  let runnerWasCalled: boolean;
  let capturedErrorMessages: string[];

  // Base valid Phase 1 config
  const validPhase1Config = {
    projectId: 'phase2-test',
    name: 'Phase 2 Test Project',
    baseUrl: 'http://localhost',
    environment: 'local',
    allowedDomains: ['localhost'],
    testDirectory: 'tests/approved',
    artifactDirectory: 'artifacts',
  };

  beforeEach(async () => {
    tempDir = join(tmpdir(), `qa-phase2-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const testDir = join(tempDir, 'tests', 'approved');
    const artifactDir = join(tempDir, 'artifacts');
    configPath = join(tempDir, 'project.config.json');

    mkdirSync(testDir, { recursive: true });
    mkdirSync(artifactDir, { recursive: true });

    runnerWasCalled = false;
    capturedErrorMessages = [];

    // Suppress console output but capture error messages
    console.log = vi.fn();
    console.error = vi.fn((msg: string) => {
      capturedErrorMessages.push(String(msg));
    });
    process.stdout.write = vi.fn() as typeof process.stdout.write;
    process.stderr.write = vi.fn() as typeof process.stderr.write;

    // Mock runner to track if it was called
    const { runPlaywrightTests } = await import('../../../src/test-execution/index.js');
    vi.mocked(runPlaywrightTests).mockImplementation(async () => {
      runnerWasCalled = true;
      const runDir = join(tempDir, 'artifacts', '2026-01-01T00-00-00-000Z');
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'results.json'), JSON.stringify({
        stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, duration: 1000 },
        errors: [],
        suites: [],
      }));
      mkdirSync(join(runDir, 'html-report'), { recursive: true });
      writeFileSync(join(runDir, 'html-report', 'index.html'), '<html></html>');

      return {
        runId: '2026-01-01T00-00-00-000Z',
        runDirectory: runDir,
        projectConfigPath: configPath,
        projectId: 'phase2-test',
        processResult: {
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          startTime: '2026-01-01T00:00:00.000Z',
          endTime: '2026-01-01T00:00:01.000Z',
          duration: 1000,
          timedOut: false,
        },
      };
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeConfig(config: object) {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  describe('rejects invalid Phase 2 configuration before Playwright starts', () => {
    it('should reject invalid role identifier (uppercase)', async () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'Admin', // Invalid: uppercase
            name: 'Administrator',
            credentials: { username: 'ADMIN_USER' },
          },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(exitCode).toBe(1);
      expect(runnerWasCalled).toBe(false);
      expect(capturedErrorMessages.some(m => m.includes('Role ID'))).toBe(true);
    });

    it('should reject duplicate role identifier', async () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          { roleId: 'admin', name: 'Admin 1', credentials: { u: 'USER1' } },
          { roleId: 'admin', name: 'Admin 2', credentials: { u: 'USER2' } },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(exitCode).toBe(1);
      expect(runnerWasCalled).toBe(false);
      expect(capturedErrorMessages.some(m => m.includes('Duplicate'))).toBe(true);
    });

    it('should reject case-insensitive duplicate role identifier', async () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          { roleId: 'admin', name: 'Admin 1', credentials: { u: 'USER1' } },
          { roleId: 'ADMIN', name: 'Admin 2', credentials: { u: 'USER2' } }, // Invalid: uppercase and duplicate
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(exitCode).toBe(1);
      expect(runnerWasCalled).toBe(false);
      // Rejects either because of uppercase format or duplicate
    });

    it('should reject lowercase credential-variable reference', async () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { password: 'my_password_var' }, // Invalid: lowercase (not uppercase convention)
          },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(exitCode).toBe(1);
      expect(runnerWasCalled).toBe(false);
      // Error message mentions uppercase requirement
      expect(capturedErrorMessages.some(m => m.includes('uppercase'))).toBe(true);
    });

    it('should reject AI_PROVIDER_* credential reference', async () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { apiKey: 'AI_PROVIDER_API_KEY' }, // Invalid: reserved prefix
          },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(exitCode).toBe(1);
      expect(runnerWasCalled).toBe(false);
      expect(capturedErrorMessages.some(m => m.includes('AI_PROVIDER'))).toBe(true);
    });

    it('should reject storageStatePath outside .auth/ convention', async () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
            storageStatePath: 'state/admin.json', // Invalid: not in .auth/
          },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(exitCode).toBe(1);
      expect(runnerWasCalled).toBe(false);
      expect(capturedErrorMessages.some(m => m.includes('.auth/'))).toBe(true);
    });

    it('should reject storageStatePath that escapes workspace', async () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
            storageStatePath: '../.auth/admin.json', // Invalid: traversal
          },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(exitCode).toBe(1);
      expect(runnerWasCalled).toBe(false);
      expect(capturedErrorMessages.some(m =>
        m.includes('traversal') || m.includes('.auth/')
      )).toBe(true);
    });

    it('should reject raw secret value in credentials and redact in error', async () => {
      const secretValue = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { token: secretValue }, // Invalid: actual JWT
          },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(exitCode).toBe(1);
      expect(runnerWasCalled).toBe(false);
      expect(capturedErrorMessages.some(m => m.includes('secret'))).toBe(true);
      // Verify secret is NOT in error message
      expect(capturedErrorMessages.every(m => !m.includes(secretValue))).toBe(true);
    });

    it('should not launch Playwright for any invalid Phase 2 config', async () => {
      // This test explicitly verifies the runner mock tracking
      writeConfig({
        ...validPhase1Config,
        roles: [
          { roleId: 'admin', name: 'Admin', credentials: { p: 'invalid_lowercase' } },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      await executeRunCommand(configPath);

      // The key assertion: runner should never be called
      expect(runnerWasCalled).toBe(false);
    });
  });

  describe('accepts valid configurations', () => {
    it('should accept valid Phase 2 config with absent credential env vars', async () => {
      // Credential env vars are NOT set, but config loading should succeed
      // (credential presence check is deferred)
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: {
              username: 'ADMIN_USER_NOT_SET',
              password: 'ADMIN_PASS_NOT_SET',
            },
            storageStatePath: '.auth/admin.json',
          },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      // Config is valid, runner should be called
      expect(runnerWasCalled).toBe(true);
      expect(exitCode).toBe(0);
    });

    it('should accept Phase 1-only configuration', async () => {
      writeConfig(validPhase1Config);

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(runnerWasCalled).toBe(true);
      expect(exitCode).toBe(0);
    });

    it('should accept valid Phase 2 config with document references', async () => {
      writeConfig({
        ...validPhase1Config,
        documents: [
          {
            documentId: 'login-workflow',
            sourcePath: 'docs/login.md',
            format: 'markdown',
          },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(runnerWasCalled).toBe(true);
      expect(exitCode).toBe(0);
    });

    it('should accept full Phase 2 config with roles and documents', async () => {
      writeConfig({
        ...validPhase1Config,
        description: 'Full Phase 2 project',
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER', password: 'ADMIN_PASS' },
            storageStatePath: '.auth/admin.json',
          },
          {
            roleId: 'customer',
            name: 'Customer',
            credentials: { username: 'CUST_USER' },
          },
        ],
        documents: [
          { documentId: 'spec', sourcePath: 'docs/spec.md', format: 'markdown' },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(runnerWasCalled).toBe(true);
      expect(exitCode).toBe(0);
    });

    it('should continue accepting valid password env-var references in credentials', async () => {
      // This test ensures we don't accidentally break legitimate password references
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'standard_user',
            name: 'Standard User',
            credentials: {
              username: 'SAUCEDEMO_USERNAME',
              password: 'SAUCEDEMO_PASSWORD', // Valid: env var name, not literal
            },
          },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(runnerWasCalled).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe('raw-secret validation (Task 2.9 requirement)', () => {
    const SECRET_VALUE = 'secret_sauce';

    it('Case 1: should reject extra password property on a role', async () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'standard_user',
            name: 'Standard User',
            credentials: {
              username: 'SAUCEDEMO_USERNAME',
              password: 'SAUCEDEMO_PASSWORD',
            },
            password: SECRET_VALUE, // Invalid: extra property with literal secret
          },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(exitCode).toBe(1);
      expect(runnerWasCalled).toBe(false);
      // Secret value must not appear in error output
      expect(capturedErrorMessages.every(m => !m.includes(SECRET_VALUE))).toBe(true);
    });

    it('Case 2: should reject literal password inside credentials map', async () => {
      writeConfig({
        ...validPhase1Config,
        roles: [
          {
            roleId: 'standard_user',
            name: 'Standard User',
            credentials: {
              username: 'SAUCEDEMO_USERNAME',
              password: SECRET_VALUE, // Invalid: literal value, not env var name
            },
          },
        ],
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(exitCode).toBe(1);
      expect(runnerWasCalled).toBe(false);
      // Secret value must not appear in error output
      expect(capturedErrorMessages.every(m => !m.includes(SECRET_VALUE))).toBe(true);
    });

    it('Case 3: should reject extra top-level password property', async () => {
      writeConfig({
        ...validPhase1Config,
        password: SECRET_VALUE, // Invalid: extra top-level property with literal secret
      });

      const { executeRunCommand } = await import('../../../src/cli/run-command.js');
      const exitCode = await executeRunCommand(configPath);

      expect(exitCode).toBe(1);
      expect(runnerWasCalled).toBe(false);
      // Secret value must not appear in error output
      expect(capturedErrorMessages.every(m => !m.includes(SECRET_VALUE))).toBe(true);
    });
  });
});
