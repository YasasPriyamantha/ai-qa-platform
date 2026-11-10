/**
 * Unit tests for CLI output formatting
 */

import { describe, it, expect } from 'vitest';
import { determineProvisionalOutcome } from '../../../src/cli/output.js';
import type { ProcessResult, CleanupResult } from '../../../src/test-execution/runner.js';

/**
 * Create a mock ProcessResult for testing.
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
 * Create a mock CleanupResult for testing.
 */
function createCleanupResult(overrides: Partial<CleanupResult> = {}): CleanupResult {
  return {
    requested: true,
    success: true,
    method: 'taskkill',
    duration: 100,
    ...overrides,
  };
}

describe('determineProvisionalOutcome', () => {
  describe('PROVISIONAL SUCCESS', () => {
    it('should return PROVISIONAL SUCCESS for exit code 0 without timeout', () => {
      const result = createProcessResult({ exitCode: 0, timedOut: false });
      expect(determineProvisionalOutcome(result)).toBe('PROVISIONAL SUCCESS');
    });

    it('should return PROVISIONAL SUCCESS with successful cleanup', () => {
      const result = createProcessResult({
        exitCode: 0,
        timedOut: false,
        cleanup: createCleanupResult({ success: true }),
      });
      expect(determineProvisionalOutcome(result)).toBe('PROVISIONAL SUCCESS');
    });
  });

  describe('PROVISIONAL FAILURE', () => {
    it('should return PROVISIONAL FAILURE for non-zero exit code', () => {
      const result = createProcessResult({ exitCode: 1, timedOut: false });
      expect(determineProvisionalOutcome(result)).toBe('PROVISIONAL FAILURE');
    });

    it('should return PROVISIONAL FAILURE for exit code 2', () => {
      const result = createProcessResult({ exitCode: 2, timedOut: false });
      expect(determineProvisionalOutcome(result)).toBe('PROVISIONAL FAILURE');
    });

    it('should return PROVISIONAL FAILURE for null exit code without timeout', () => {
      const result = createProcessResult({ exitCode: null, timedOut: false });
      expect(determineProvisionalOutcome(result)).toBe('PROVISIONAL FAILURE');
    });
  });

  describe('TIMEOUT', () => {
    it('should return TIMEOUT when timedOut is true', () => {
      const result = createProcessResult({ timedOut: true });
      expect(determineProvisionalOutcome(result)).toBe('TIMEOUT');
    });

    it('should return TIMEOUT even with exit code 0 if timedOut', () => {
      const result = createProcessResult({ exitCode: 0, timedOut: true });
      expect(determineProvisionalOutcome(result)).toBe('TIMEOUT');
    });

    it('should return TIMEOUT with cleanup present', () => {
      const result = createProcessResult({
        timedOut: true,
        cleanup: createCleanupResult(),
      });
      expect(determineProvisionalOutcome(result)).toBe('TIMEOUT');
    });
  });

  describe('RUNNER ERROR', () => {
    it('should return RUNNER ERROR when cleanup failed', () => {
      const result = createProcessResult({
        exitCode: 0,
        timedOut: false,
        cleanup: createCleanupResult({ success: false, error: 'Cleanup failed' }),
      });
      expect(determineProvisionalOutcome(result)).toBe('RUNNER ERROR');
    });

    it('should return TIMEOUT over RUNNER ERROR when both apply', () => {
      // Timeout takes precedence
      const result = createProcessResult({
        timedOut: true,
        cleanup: createCleanupResult({ success: false, error: 'Cleanup failed' }),
      });
      expect(determineProvisionalOutcome(result)).toBe('TIMEOUT');
    });
  });

  describe('outcome precedence', () => {
    it('should prioritize timeout over cleanup failure', () => {
      const result = createProcessResult({
        exitCode: 0,
        timedOut: true,
        cleanup: createCleanupResult({ success: false }),
      });
      expect(determineProvisionalOutcome(result)).toBe('TIMEOUT');
    });

    it('should prioritize cleanup failure over provisional success', () => {
      const result = createProcessResult({
        exitCode: 0,
        timedOut: false,
        cleanup: createCleanupResult({ success: false }),
      });
      expect(determineProvisionalOutcome(result)).toBe('RUNNER ERROR');
    });
  });
});
