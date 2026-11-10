/**
 * Unit tests for status model and reconciliation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  reconcileRunResult,
  shouldExitNonZero,
  type ReconciliationInput,
  type RunResult,
} from '../../../src/reporting/status-model.js';
import type { ProcessResult } from '../../../src/test-execution/runner.js';

/**
 * Create a mock ProcessResult.
 */
function createProcessResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-01-01T00:00:01.000Z',
    duration: 1000,
    timedOut: false,
    ...overrides,
  };
}

/**
 * Create a valid Playwright JSON report.
 */
function createValidJsonReport(overrides: {
  expected?: number;
  unexpected?: number;
  skipped?: number;
  duration?: number;
  errors?: Array<{ message: string }>;
} = {}): string {
  return JSON.stringify({
    stats: {
      expected: overrides.expected ?? 1,
      unexpected: overrides.unexpected ?? 0,
      flaky: 0,
      skipped: overrides.skipped ?? 0,
      duration: overrides.duration ?? 1000,
    },
    errors: overrides.errors ?? [],
    suites: [],
  });
}

describe('reconcileRunResult', () => {
  let runDir: string;

  beforeEach(() => {
    runDir = join(tmpdir(), `qa-status-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(runDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(runDir)) {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper to create input and optionally write report files.
   */
  function createInput(
    processOverrides: Partial<ProcessResult> = {},
    options: {
      writeJson?: boolean;
      jsonContent?: string;
      writeHtml?: boolean;
      spawnFailed?: boolean;
      spawnError?: string;
    } = {}
  ): ReconciliationInput {
    if (options.writeJson) {
      const content = options.jsonContent ?? createValidJsonReport();
      writeFileSync(join(runDir, 'results.json'), content);
    }

    if (options.writeHtml) {
      const htmlDir = join(runDir, 'html-report');
      mkdirSync(htmlDir, { recursive: true });
      writeFileSync(join(htmlDir, 'index.html'), '<html></html>');
    }

    return {
      processResult: createProcessResult(processOverrides),
      runDir,
      spawnFailed: options.spawnFailed,
      spawnError: options.spawnError,
    };
  }

  describe('valid passing JSON + HTML', () => {
    it('should return passed status with complete report', () => {
      const input = createInput({ exitCode: 0 }, { writeJson: true, writeHtml: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('passed');
      expect(result.reportStatus).toBe('complete');
      expect(result.primaryReason).toBeUndefined();
      expect(result.additionalFindings).toHaveLength(0);
    });
  });

  describe('valid JSON with test failures', () => {
    it('should return failed status with test_failures reason', () => {
      const json = createValidJsonReport({ expected: 2, unexpected: 1 });
      const input = createInput({ exitCode: 1 }, { writeJson: true, jsonContent: json, writeHtml: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('failed');
      expect(result.reportStatus).toBe('complete');
      expect(result.primaryReason).toBe('test_failures');
      expect(result.primaryMessage).toBe('1 test failed');
      expect(result.stats.failed).toBe(1);
    });

    it('should use plural for multiple failures', () => {
      const json = createValidJsonReport({ expected: 1, unexpected: 3 });
      const input = createInput({ exitCode: 1 }, { writeJson: true, jsonContent: json, writeHtml: true });
      const result = reconcileRunResult(input);

      expect(result.primaryReason).toBe('test_failures');
      expect(result.primaryMessage).toBe('3 tests failed');
    });
  });

  describe('valid JSON with top-level errors', () => {
    it('should report infrastructure_error for non-zero exit with top-level errors', () => {
      const json = createValidJsonReport({
        expected: 1,
        unexpected: 0,
        errors: [{ message: 'Worker crashed during teardown' }],
      });
      const input = createInput({ exitCode: 1 }, { writeJson: true, jsonContent: json, writeHtml: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.primaryReason).toBe('playwright_process_error');
      expect(result.primaryMessage).toContain('Worker crashed during teardown');
    });
  });

  describe('spawn failure', () => {
    it('should return infrastructure_error with playwright_process_error', () => {
      const input = createInput({}, { spawnFailed: true, spawnError: 'ENOENT: Playwright not found' });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.reportStatus).toBe('failed');
      expect(result.primaryReason).toBe('playwright_process_error');
      expect(result.primaryMessage).toBe('ENOENT: Playwright not found');
    });
  });

  describe('missing JSON with non-zero exit', () => {
    it('should return infrastructure_error with playwright_process_error and report_invalid finding', () => {
      const input = createInput({ exitCode: 1, stderr: 'Error: No test files found' });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.reportStatus).toBe('failed');
      expect(result.primaryReason).toBe('playwright_process_error');
      expect(result.primaryMessage).toContain('exit');
      expect(result.additionalFindings.some((f) => f.code === 'report_invalid')).toBe(true);
    });
  });

  describe('missing JSON despite exit 0', () => {
    it('should return infrastructure_error with report_invalid', () => {
      const input = createInput({ exitCode: 0 });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.reportStatus).toBe('failed');
      expect(result.primaryReason).toBe('report_invalid');
      expect(result.primaryMessage).toContain('missing');
    });
  });

  describe('malformed JSON', () => {
    it('should return infrastructure_error with report_invalid', () => {
      writeFileSync(join(runDir, 'results.json'), '{ invalid json }');
      const input = createInput({ exitCode: 0 });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.reportStatus).toBe('failed');
      expect(result.primaryReason).toBe('report_invalid');
    });

    it('should handle JSON with missing stats', () => {
      writeFileSync(join(runDir, 'results.json'), '{"errors": [], "suites": []}');
      const input = createInput({ exitCode: 0 });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.reportStatus).toBe('failed');
      expect(result.primaryReason).toBe('report_invalid');
    });
  });

  describe('zero-test report', () => {
    it('should return infrastructure_error with no_tests_found', () => {
      const json = createValidJsonReport({ expected: 0, unexpected: 0, skipped: 0 });
      const input = createInput({ exitCode: 1 }, { writeJson: true, jsonContent: json, writeHtml: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.reportStatus).toBe('complete');
      expect(result.primaryReason).toBe('no_tests_found');
    });
  });

  describe('non-zero exit with passing tests', () => {
    it('should return infrastructure_error with exit_report_mismatch', () => {
      const json = createValidJsonReport({ expected: 1, unexpected: 0 });
      const input = createInput({ exitCode: 1 }, { writeJson: true, jsonContent: json, writeHtml: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.primaryReason).toBe('exit_report_mismatch');
      expect(result.primaryMessage).toContain('Non-zero exit');
    });
  });

  describe('timeout with missing JSON', () => {
    it('should return timed_out with runner_timeout reason', () => {
      const input = createInput({ exitCode: null, timedOut: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('timed_out');
      expect(result.reportStatus).toBe('failed');
      expect(result.primaryReason).toBe('runner_timeout');
      expect(result.additionalFindings.some((f) => f.code === 'report_invalid')).toBe(true);
    });
  });

  describe('timeout plus cleanup failure', () => {
    it('should return runner_timeout as primary with cleanup_failed as additional', () => {
      const input = createInput({
        timedOut: true,
        cleanup: { requested: true, success: false, method: 'taskkill', duration: 100, error: 'Access denied' },
      });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('timed_out');
      expect(result.primaryReason).toBe('runner_timeout');
      expect(result.additionalFindings.some((f) => f.code === 'cleanup_failed')).toBe(true);
      expect(result.additionalFindings.find((f) => f.code === 'cleanup_failed')?.message).toContain('Access denied');
    });
  });

  describe('test failure plus mismatch', () => {
    it('should keep test_failures as primary with exit_report_mismatch as additional', () => {
      const json = createValidJsonReport({ expected: 1, unexpected: 1 });
      const input = createInput({ exitCode: 0 }, { writeJson: true, jsonContent: json, writeHtml: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('failed');
      expect(result.primaryReason).toBe('test_failures');
      expect(result.additionalFindings.some((f) => f.code === 'exit_report_mismatch')).toBe(true);
    });
  });

  describe('valid JSON with missing HTML', () => {
    it('should return passed with partial report status', () => {
      const input = createInput({ exitCode: 0 }, { writeJson: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('passed');
      expect(result.reportStatus).toBe('partial');
      expect(result.additionalFindings.some((f) => f.code === 'html_report_missing')).toBe(true);
    });
  });

  describe('HTML present but JSON missing', () => {
    it('should return failed report status (never pass)', () => {
      // Write only HTML
      const htmlDir = join(runDir, 'html-report');
      mkdirSync(htmlDir, { recursive: true });
      writeFileSync(join(htmlDir, 'index.html'), '<html></html>');

      const input = createInput({ exitCode: 0 });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.reportStatus).toBe('failed');
      expect(result.primaryReason).toBe('report_invalid');
    });
  });

  describe('cleanup failure with passing tests', () => {
    it('should return infrastructure_error with cleanup_failed', () => {
      const json = createValidJsonReport({ expected: 1, unexpected: 0 });
      const input = createInput(
        {
          exitCode: 0,
          cleanup: { requested: true, success: false, method: 'taskkill', duration: 100, error: 'Process not found' },
        },
        { writeJson: true, jsonContent: json, writeHtml: true }
      );
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.primaryReason).toBe('cleanup_failed');
    });
  });

  describe('output incomplete', () => {
    it('should add output_incomplete finding', () => {
      const json = createValidJsonReport({ expected: 1, unexpected: 0 });
      const input = createInput(
        { exitCode: 0, outputIncomplete: true },
        { writeJson: true, jsonContent: json, writeHtml: true }
      );
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('passed');
      expect(result.additionalFindings.some((f) => f.code === 'output_incomplete')).toBe(true);
    });
  });

  describe('interrupted tests', () => {
    /**
     * Create JSON report with interrupted tests.
     */
    function createJsonWithInterruptedTests(options: {
      passedCount?: number;
      failedCount?: number;
      interruptedCount?: number;
    } = {}): string {
      const passed = options.passedCount ?? 0;
      const failed = options.failedCount ?? 0;
      const interrupted = options.interruptedCount ?? 1;

      const specs: unknown[] = [];

      // Add passed tests
      for (let i = 0; i < passed; i++) {
        specs.push({
          title: `passing test ${i + 1}`,
          tests: [{ status: 'expected', results: [{ duration: 100 }] }],
        });
      }

      // Add failed tests
      for (let i = 0; i < failed; i++) {
        specs.push({
          title: `failing test ${i + 1}`,
          tests: [{
            status: 'unexpected',
            results: [{ duration: 100, error: { message: 'Assertion failed' } }],
          }],
        });
      }

      // Add interrupted tests
      for (let i = 0; i < interrupted; i++) {
        specs.push({
          title: `interrupted test ${i + 1}`,
          tests: [{
            status: 'interrupted',
            results: [{ duration: 5000, error: { message: 'Worker process exited unexpectedly' } }],
          }],
        });
      }

      return JSON.stringify({
        stats: {
          expected: passed,
          unexpected: failed,
          flaky: 0,
          skipped: 0,
          duration: 1000,
        },
        errors: [],
        suites: [{ title: '', file: 'test.spec.ts', specs }],
      });
    }

    it('should return infrastructure_error with playwright_process_error for interrupted tests', () => {
      const json = createJsonWithInterruptedTests({ interruptedCount: 1 });
      const input = createInput({ exitCode: 1 }, { writeJson: true, jsonContent: json, writeHtml: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.primaryReason).toBe('playwright_process_error');
      expect(result.primaryMessage).toContain('interrupted');
      expect(result.additionalFindings.some((f) => f.code === 'tests_interrupted')).toBe(true);
    });

    it('should treat interrupted tests as higher priority than test_failures', () => {
      const json = createJsonWithInterruptedTests({ failedCount: 1, interruptedCount: 1 });
      const input = createInput({ exitCode: 1 }, { writeJson: true, jsonContent: json, writeHtml: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.primaryReason).toBe('playwright_process_error');
      // test_failures should be noted as additional finding
      expect(result.additionalFindings.some((f) => f.message.includes('failed before interruption'))).toBe(true);
    });

    it('should add tests_interrupted finding when runner timeout fires with interrupted tests', () => {
      const json = createJsonWithInterruptedTests({ passedCount: 1, interruptedCount: 1 });
      // Write JSON report before running
      writeFileSync(join(runDir, 'results.json'), json);
      mkdirSync(join(runDir, 'html-report'), { recursive: true });
      writeFileSync(join(runDir, 'html-report', 'index.html'), '<html></html>');

      const input: ReconciliationInput = {
        processResult: createProcessResult({ timedOut: true, exitCode: null }),
        runDir,
      };
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('timed_out');
      expect(result.primaryReason).toBe('runner_timeout');
      expect(result.additionalFindings.some((f) => f.code === 'tests_interrupted')).toBe(true);
    });

    it('should handle interrupted tests with otherwise passing tests', () => {
      const json = createJsonWithInterruptedTests({ passedCount: 2, interruptedCount: 1 });
      const input = createInput({ exitCode: 1 }, { writeJson: true, jsonContent: json, writeHtml: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).toBe('infrastructure_error');
      expect(result.primaryReason).toBe('playwright_process_error');
      expect(result.stats.passed).toBe(2);
      expect(result.stats.failed).toBe(0); // Interrupted tests not counted as failed
    });

    it('should never classify interrupted run as passed', () => {
      const json = createJsonWithInterruptedTests({ passedCount: 3, interruptedCount: 1 });
      const input = createInput({ exitCode: 0 }, { writeJson: true, jsonContent: json, writeHtml: true });
      const result = reconcileRunResult(input);

      expect(result.runStatus).not.toBe('passed');
      expect(result.runStatus).toBe('infrastructure_error');
    });
  });
});

describe('shouldExitNonZero', () => {
  function createResult(overrides: Partial<RunResult> = {}): RunResult {
    return {
      runStatus: 'passed',
      reportStatus: 'complete',
      stats: { total: 1, passed: 1, failed: 0, skipped: 0, duration: 1000 },
      additionalFindings: [],
      ...overrides,
    };
  }

  function createProcessResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
    return {
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      startTime: '2026-01-01T00:00:00.000Z',
      endTime: '2026-01-01T00:00:01.000Z',
      duration: 1000,
      timedOut: false,
      ...overrides,
    };
  }

  it('should return false for passed run with complete report', () => {
    const result = createResult();
    expect(shouldExitNonZero(result, createProcessResult())).toBe(false);
  });

  it('should return true for failed run', () => {
    const result = createResult({ runStatus: 'failed', primaryReason: 'test_failures' });
    expect(shouldExitNonZero(result, createProcessResult())).toBe(true);
  });

  it('should return true for timed_out run', () => {
    const result = createResult({ runStatus: 'timed_out', primaryReason: 'runner_timeout' });
    expect(shouldExitNonZero(result, createProcessResult())).toBe(true);
  });

  it('should return true for infrastructure_error run', () => {
    const result = createResult({ runStatus: 'infrastructure_error', primaryReason: 'no_tests_found' });
    expect(shouldExitNonZero(result, createProcessResult())).toBe(true);
  });

  it('should return true for partial report status', () => {
    const result = createResult({ reportStatus: 'partial' });
    expect(shouldExitNonZero(result, createProcessResult())).toBe(true);
  });

  it('should return true for failed report status', () => {
    const result = createResult({ reportStatus: 'failed' });
    expect(shouldExitNonZero(result, createProcessResult())).toBe(true);
  });

  it('should return true for cleanup failure', () => {
    const result = createResult({
      additionalFindings: [{ code: 'cleanup_failed', message: 'Failed' }],
    });
    expect(shouldExitNonZero(result, createProcessResult())).toBe(true);
  });

  it('should return true for output incomplete', () => {
    const result = createResult();
    const processResult = createProcessResult({ outputIncomplete: true });
    expect(shouldExitNonZero(result, processResult)).toBe(true);
  });
});
