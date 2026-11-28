/**
 * Unit tests for the validate verdict rules (Task V2, DEC-042 §3.4), with fake runner results.
 */

import { describe, it, expect } from 'vitest';
import { decideVerdict, type Execution } from '../../../src/planning/validator.js';
import type { RunStatus, TestResult } from '../../../src/reporting/index.js';

const FILE = 'SCN-0001.spec.ts';
const result = (status: TestResult['status'], file = FILE, error?: string): TestResult =>
  ({ titlePath: [], title: 'SCN-0001: t', file, status, duration: 1, retried: false, ...(error ? { error } : {}) });
const exec = (n: number, runStatus: RunStatus, tests: TestResult[], message?: string): Execution =>
  ({ runId: `run-${n}`, runStatus, tests, ...(message ? { message } : {}) });
const other = result('passed', 'SCN-0002.spec.ts');

describe('decideVerdict', () => {
  it('validated only when the candidate passed in all three executions', () => {
    const v = decideVerdict(FILE, [1, 2, 3].map((n) => exec(n, 'passed', [result('passed'), other])));
    expect(v).toEqual({
      verdict: 'validated', reason: null,
      runs: [1, 2, 3].map((n) => ({ runId: `run-${n}`, runStatus: 'passed', testStatus: 'passed' })),
    });
    expect(decideVerdict(FILE, [1, 2].map((n) => exec(n, 'passed', [result('passed')]))).verdict).toBe('blocked');
  });

  it('failing when it failed in all three, with the first error line as the observed fact', () => {
    const v = decideVerdict(FILE, [1, 2, 3].map((n) => exec(n, 'failed', [result('failed', FILE, '\nError: expect(locator).toBeVisible() failed\n  at x'), other])));
    expect(v.verdict).toBe('failing');
    expect(v.reason).toBe('failed in 3 of 3 executions: Error: expect(locator).toBeVisible() failed');
    expect(v.runs.map((r) => r.testStatus)).toEqual(['failed', 'failed', 'failed']);
  });

  it('strips ANSI colour codes from the error before using its first line', () => {
    const coloured = '\x1b[31mError: \x1b[2mexpect(\x1b[22m\x1b[31mlocator\x1b[39m\x1b[2m).toBeVisible() failed\x1b[22m\n  at x';
    const v = decideVerdict(FILE, [1, 2, 3].map((n) => exec(n, 'failed', [result('failed', FILE, coloured)])));
    expect(v.reason).toBe('failed in 3 of 3 executions: Error: expect(locator).toBeVisible() failed');
  });

  it('unstable when the results are mixed', () => {
    const v = decideVerdict(FILE, [exec(1, 'passed', [result('passed')]), exec(2, 'failed', [result('failed')]), exec(3, 'passed', [result('passed')])]);
    expect(v.verdict).toBe('unstable');
    expect(v.reason).toBe('failed in 1 of 3 executions');
  });

  it('blocked when an execution timed out, even if the others passed', () => {
    const v = decideVerdict(FILE, [exec(1, 'passed', [result('passed')]), exec(2, 'timed_out', [], 'Runner timeout after 1800000ms'), exec(3, 'passed', [result('passed')])]);
    expect(v.verdict).toBe('blocked');
    expect(v.reason).toBe('run run-2: timed_out: Runner timeout after 1800000ms');
    expect(v.runs[1]).toEqual({ runId: 'run-2', runStatus: 'timed_out', testStatus: 'no-result' });
  });

  it('blocked when an execution has no result for its file, or an infrastructure error', () => {
    const missing = decideVerdict(FILE, [exec(1, 'passed', [result('passed')]), exec(2, 'passed', [other]), exec(3, 'passed', [result('passed')])]);
    expect(missing).toMatchObject({ verdict: 'blocked', reason: `run run-2: no result for ${FILE}` });
    const infra = decideVerdict(FILE, [1, 2, 3].map((n) => exec(n, 'infrastructure_error', [result('failed')], 'Top-level error')));
    expect(infra).toMatchObject({ verdict: 'blocked', reason: 'run run-1: infrastructure_error: Top-level error' });
    const skipped = decideVerdict(FILE, [1, 2, 3].map((n) => exec(n, 'passed', [result('skipped')])));
    expect(skipped).toMatchObject({ verdict: 'blocked', reason: 'run run-1: test skipped' });
  });
});
