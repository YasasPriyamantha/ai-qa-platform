/**
 * Unit tests for CLI output formatting
 *
 * Tests the display functions for the final status model.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  displayRunStart,
  displayRunComplete,
  displayError,
} from '../../../src/cli/output.js';
import type { ResolvedConfig } from '../../../src/projects/config.js';
import type { RunMetadata } from '../../../src/test-execution/runner.js';
import type { RunResult } from '../../../src/reporting/index.js';

// Capture console output
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
let consoleOutput: string[] = [];
let consoleErrors: string[] = [];

beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
  console.log = vi.fn((...args) => {
    consoleOutput.push(args.join(' '));
  });
  console.error = vi.fn((...args) => {
    consoleErrors.push(args.join(' '));
  });
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
});

/**
 * Create a mock ResolvedConfig.
 */
function createMockConfig(): ResolvedConfig {
  return {
    projectId: 'test-project',
    name: 'Test Project',
    baseUrl: 'http://localhost',
    environment: 'local',
    allowedDomains: ['localhost'],
    testDirectory: 'tests/approved',
    artifactDirectory: 'artifacts',
    projectWorkspace: '/test/workspace',
    resolvedTestDirectory: '/test/workspace/tests/approved',
    resolvedArtifactDirectory: '/test/workspace/artifacts',
    configPath: '/test/workspace/project.config.json',
  };
}

/**
 * Create a mock RunMetadata.
 */
function createMockMetadata(overrides: Partial<RunMetadata> = {}): RunMetadata {
  return {
    runId: '2026-01-01T00-00-00-000Z',
    runDirectory: '/test/workspace/artifacts/2026-01-01T00-00-00-000Z',
    projectConfigPath: '/test/workspace/project.config.json',
    projectId: 'test-project',
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
    ...overrides,
  };
}

/**
 * Create a mock RunResult.
 */
function createMockResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runStatus: 'passed',
    reportStatus: 'complete',
    stats: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 1000 },
    additionalFindings: [],
    jsonReportPath: '/test/workspace/artifacts/2026-01-01T00-00-00-000Z/results.json',
    htmlReportPath: '/test/workspace/artifacts/2026-01-01T00-00-00-000Z/html-report/index.html',
    ...overrides,
  };
}

describe('displayRunStart', () => {
  it('should display project information', () => {
    const config = createMockConfig();
    displayRunStart(config);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Test Project');
    expect(output).toContain('test-project');
    expect(output).toContain('local');
    expect(output).toContain('http://localhost');
  });
});

describe('displayRunComplete', () => {
  it('should display success for passed run with complete report', () => {
    const metadata = createMockMetadata();
    const result = createMockResult();
    displayRunComplete(metadata, result);

    const output = consoleOutput.join('\n');
    expect(output).toContain('SUCCESS');
    expect(output).toContain('PASSED');
    expect(output).toContain('COMPLETE');
  });

  it('should display failure for failed run', () => {
    const metadata = createMockMetadata();
    const result = createMockResult({
      runStatus: 'failed',
      primaryReason: 'test_failures',
      primaryMessage: '2 tests failed',
      stats: { total: 3, passed: 1, failed: 2, skipped: 0, duration: 1000 },
    });
    displayRunComplete(metadata, result);

    const output = consoleOutput.join('\n');
    expect(output).toContain('FAILED');
    expect(output).toContain('test_failures');
    expect(output).toContain('2 tests failed');
  });

  it('should display timeout status', () => {
    const metadata = createMockMetadata({
      processResult: {
        exitCode: null,
        signal: 'SIGTERM',
        stdout: '',
        stderr: '',
        startTime: '2026-01-01T00:00:00.000Z',
        endTime: '2026-01-01T00:30:00.000Z',
        duration: 1800000,
        timedOut: true,
      },
    });
    const result = createMockResult({
      runStatus: 'timed_out',
      reportStatus: 'failed',
      primaryReason: 'runner_timeout',
      primaryMessage: 'Runner timeout exceeded',
    });
    displayRunComplete(metadata, result);

    const output = consoleOutput.join('\n');
    expect(output).toContain('TIMED OUT');
    expect(output).toContain('runner_timeout');
  });

  it('should display infrastructure error status', () => {
    const metadata = createMockMetadata();
    const result = createMockResult({
      runStatus: 'infrastructure_error',
      primaryReason: 'no_tests_found',
      primaryMessage: 'No tests were discovered',
    });
    displayRunComplete(metadata, result);

    const output = consoleOutput.join('\n');
    expect(output).toContain('INFRASTRUCTURE ERROR');
    expect(output).toContain('no_tests_found');
  });

  it('should display additional findings', () => {
    const metadata = createMockMetadata();
    const result = createMockResult({
      runStatus: 'failed',
      primaryReason: 'test_failures',
      primaryMessage: '1 test failed',
      additionalFindings: [
        { code: 'cleanup_failed', message: 'Process cleanup failed' },
      ],
    });
    displayRunComplete(metadata, result);

    const output = consoleOutput.join('\n');
    expect(output).toContain('Additional Findings');
    expect(output).toContain('cleanup_failed');
    expect(output).toContain('Process cleanup failed');
  });

  it('should display partial report status', () => {
    const metadata = createMockMetadata();
    const result = createMockResult({
      reportStatus: 'partial',
      htmlReportPath: undefined,
      additionalFindings: [
        { code: 'html_report_missing', message: 'HTML report not found' },
      ],
    });
    displayRunComplete(metadata, result);

    const output = consoleOutput.join('\n');
    expect(output).toContain('PARTIAL');
    expect(output).toContain('html_report_missing');
  });
});

describe('displayError', () => {
  it('should display error message', () => {
    displayError('Test error');

    const output = consoleErrors.join('\n');
    expect(output).toContain('ERROR');
    expect(output).toContain('Test error');
  });

  it('should display error with details', () => {
    displayError('Test error', 'Additional details here');

    const output = consoleErrors.join('\n');
    expect(output).toContain('Test error');
    expect(output).toContain('Additional details here');
  });
});
