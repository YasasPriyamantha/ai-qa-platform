/**
 * Unit tests for CLI run command
 *
 * Tests timeout wiring and exit code behavior using mocked runner.
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
