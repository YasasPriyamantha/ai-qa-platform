/**
 * Unit tests for report parser
 */

import { describe, it, expect } from 'vitest';
import {
  parseReportJson,
} from '../../../src/reporting/report-parser.js';

/**
 * Create a valid minimal Playwright JSON report structure.
 */
function createValidReport(overrides: {
  expected?: number;
  unexpected?: number;
  skipped?: number;
  duration?: number;
  errors?: Array<{ message: string; location?: string }>;
  suites?: unknown[];
} = {}): unknown {
  return {
    stats: {
      expected: overrides.expected ?? 1,
      unexpected: overrides.unexpected ?? 0,
      flaky: 0,
      skipped: overrides.skipped ?? 0,
      duration: overrides.duration ?? 1000,
    },
    errors: overrides.errors ?? [],
    suites: overrides.suites ?? [],
  };
}

describe('parseReportJson', () => {
  describe('valid reports', () => {
    it('should parse a valid passing report', () => {
      const raw = createValidReport({ expected: 5, unexpected: 0 });
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.stats.total).toBe(5);
      expect(result.stats.passed).toBe(5);
      expect(result.stats.failed).toBe(0);
      expect(result.stats.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should parse a report with failed tests', () => {
      const raw = createValidReport({ expected: 3, unexpected: 2 });
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.stats.total).toBe(5);
      expect(result.stats.passed).toBe(3);
      expect(result.stats.failed).toBe(2);
    });

    it('should parse a report with skipped tests', () => {
      const raw = createValidReport({ expected: 2, skipped: 1 });
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.stats.total).toBe(3);
      expect(result.stats.passed).toBe(2);
      expect(result.stats.skipped).toBe(1);
    });

    it('should parse a zero-test report', () => {
      const raw = createValidReport({ expected: 0, unexpected: 0, skipped: 0 });
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.stats.total).toBe(0);
      expect(result.stats.passed).toBe(0);
      expect(result.stats.failed).toBe(0);
      expect(result.stats.skipped).toBe(0);
    });

    it('should extract top-level errors', () => {
      const raw = createValidReport({
        errors: [
          { message: 'Setup error in global setup', location: 'global-setup.ts:10' },
          { message: 'Worker process crashed' },
        ],
      });
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].message).toBe('Setup error in global setup');
      expect(result.errors[0].location).toBe('global-setup.ts:10');
      expect(result.errors[1].message).toBe('Worker process crashed');
      expect(result.errors[1].location).toBeUndefined();
    });

    it('should handle string errors in errors array', () => {
      const raw = {
        stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, duration: 100 },
        errors: ['Simple string error'],
        suites: [],
      };
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('Simple string error');
    });
  });

  describe('invalid reports', () => {
    it('should reject null', () => {
      const result = parseReportJson(null);
      expect(result.valid).toBe(false);
      expect(result.validationError).toContain('JSON object');
    });

    it('should reject arrays', () => {
      const result = parseReportJson([]);
      expect(result.valid).toBe(false);
      expect(result.validationError).toBeDefined();
    });

    it('should reject primitives', () => {
      const result = parseReportJson('string');
      expect(result.valid).toBe(false);
      expect(result.validationError).toContain('JSON object');
    });

    it('should reject missing stats', () => {
      const result = parseReportJson({ errors: [], suites: [] });
      expect(result.valid).toBe(false);
      expect(result.validationError).toContain('stats');
    });

    it('should reject null stats', () => {
      const result = parseReportJson({ stats: null, errors: [], suites: [] });
      expect(result.valid).toBe(false);
      expect(result.validationError).toContain('stats');
    });

    it('should return zero counts for invalid report', () => {
      const result = parseReportJson(null);
      expect(result.stats.total).toBe(0);
      expect(result.stats.passed).toBe(0);
      expect(result.stats.failed).toBe(0);
      expect(result.stats.skipped).toBe(0);
    });
  });

  describe('test extraction from suites', () => {
    it('should extract tests from nested suites', () => {
      const raw = {
        stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, duration: 100 },
        errors: [],
        suites: [
          {
            title: '',
            file: 'test.spec.ts',
            specs: [
              {
                title: 'should pass',
                tests: [
                  {
                    status: 'expected',
                    results: [{ duration: 100 }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.tests).toHaveLength(1);
      expect(result.tests[0].title).toBe('should pass');
      expect(result.tests[0].status).toBe('passed');
      expect(result.tests[0].duration).toBe(100);
    });

    it('should extract error messages from failed tests', () => {
      const raw = {
        stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0, duration: 100 },
        errors: [],
        suites: [
          {
            title: '',
            file: 'test.spec.ts',
            specs: [
              {
                title: 'should fail',
                tests: [
                  {
                    status: 'unexpected',
                    results: [
                      {
                        duration: 50,
                        error: { message: 'Expected true to be false' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.tests).toHaveLength(1);
      expect(result.tests[0].status).toBe('failed');
      expect(result.tests[0].error).toBe('Expected true to be false');
    });

    it('should map individual timedOut status to failed', () => {
      const raw = {
        stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0, duration: 100 },
        errors: [],
        suites: [
          {
            title: '',
            file: 'test.spec.ts',
            specs: [
              {
                title: 'should timeout',
                tests: [
                  {
                    status: 'timedOut',
                    results: [
                      {
                        duration: 30000,
                        error: { message: 'Test timeout of 30000ms exceeded' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.tests).toHaveLength(1);
      expect(result.tests[0].status).toBe('failed');
      expect(result.tests[0].originalStatus).toBe('timedOut');
      expect(result.tests[0].error).toBe('Test timeout of 30000ms exceeded');
      expect(result.interruptedTests).toHaveLength(0);
    });

    it('should track interrupted tests separately', () => {
      const raw = {
        stats: { expected: 0, unexpected: 0, flaky: 0, skipped: 0, duration: 100 },
        errors: [],
        suites: [
          {
            title: '',
            file: 'test.spec.ts',
            specs: [
              {
                title: 'should be interrupted',
                tests: [
                  {
                    status: 'interrupted',
                    results: [
                      {
                        duration: 5000,
                        error: { message: 'Worker process exited unexpectedly' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.tests).toHaveLength(0); // Not counted as regular test
      expect(result.interruptedTests).toHaveLength(1);
      expect(result.interruptedTests[0].title).toBe('should be interrupted');
      expect(result.interruptedTests[0].originalStatus).toBe('interrupted');
      expect(result.interruptedTests[0].error).toBe('Worker process exited unexpectedly');
    });

    it('should separate interrupted tests from passing tests', () => {
      const raw = {
        stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, duration: 100 },
        errors: [],
        suites: [
          {
            title: '',
            file: 'test.spec.ts',
            specs: [
              {
                title: 'should pass',
                tests: [
                  {
                    status: 'expected',
                    results: [{ duration: 100 }],
                  },
                ],
              },
              {
                title: 'should be interrupted',
                tests: [
                  {
                    status: 'interrupted',
                    results: [{ duration: 5000 }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.tests).toHaveLength(1);
      expect(result.tests[0].status).toBe('passed');
      expect(result.interruptedTests).toHaveLength(1);
      expect(result.interruptedTests[0].title).toBe('should be interrupted');
    });

    it('should separate interrupted tests from failed tests', () => {
      const raw = {
        stats: { expected: 0, unexpected: 1, flaky: 0, skipped: 0, duration: 100 },
        errors: [],
        suites: [
          {
            title: '',
            file: 'test.spec.ts',
            specs: [
              {
                title: 'should fail',
                tests: [
                  {
                    status: 'unexpected',
                    results: [{ duration: 100, error: { message: 'Assertion failed' } }],
                  },
                ],
              },
              {
                title: 'should be interrupted',
                tests: [
                  {
                    status: 'interrupted',
                    results: [{ duration: 5000 }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = parseReportJson(raw);

      expect(result.valid).toBe(true);
      expect(result.tests).toHaveLength(1);
      expect(result.tests[0].status).toBe('failed');
      expect(result.interruptedTests).toHaveLength(1);
    });
  });
});
