/**
 * Playwright JSON report parser
 *
 * Parses and validates Playwright Test JSON reporter output.
 * Extracts test statistics, individual outcomes, and top-level errors.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Individual test status from Playwright report.
 * Note: Playwright's 'timedOut' maps to 'failed'; 'interrupted' is tracked separately.
 */
export type TestStatus = 'passed' | 'failed' | 'skipped';

/**
 * Individual test result extracted from the report.
 */
export interface TestResult {
  /** Test title path (e.g., ['suite', 'test name']) */
  titlePath: string[];
  /** Full test title */
  title: string;
  /** Test file path relative to project */
  file: string;
  /** Test status */
  status: TestStatus;
  /** Test duration in milliseconds */
  duration: number;
  /** Error message if test failed */
  error?: string;
  /** Whether the test was retried (always false in Phase 1) */
  retried: boolean;
  /** Original Playwright status if different from normalized status */
  originalStatus?: string;
}

/**
 * Information about an interrupted test.
 * Interrupted tests are tracked separately from normal test results.
 */
export interface InterruptedTest {
  /** Full test title */
  title: string;
  /** Test file path */
  file: string;
  /** Original Playwright status */
  originalStatus: string;
  /** Error message if available */
  error?: string;
}

/**
 * Top-level error from Playwright report.
 * These indicate setup, teardown, or worker-level failures.
 */
export interface TopLevelError {
  /** Error message */
  message: string;
  /** Error location if available */
  location?: string;
}

/**
 * Test statistics extracted from the report.
 */
export interface TestStats {
  /** Total number of tests discovered */
  total: number;
  /** Number of passed tests */
  passed: number;
  /** Number of failed tests */
  failed: number;
  /** Number of skipped tests */
  skipped: number;
  /** Total duration in milliseconds */
  duration: number;
}

/**
 * Parsed Playwright JSON report.
 */
export interface ParsedReport {
  /** Test statistics */
  stats: TestStats;
  /** Individual test results (excludes interrupted tests) */
  tests: TestResult[];
  /** Interrupted tests (tracked separately, not counted in stats) */
  interruptedTests: InterruptedTest[];
  /** Top-level errors (setup, teardown, worker failures) */
  errors: TopLevelError[];
  /** Whether the report structure is valid */
  valid: boolean;
  /** Validation error message if invalid */
  validationError?: string;
}

/**
 * Result of checking report files.
 */
export interface ReportFilesStatus {
  /** Whether results.json exists */
  jsonExists: boolean;
  /** Whether html-report/index.html exists */
  htmlIndexExists: boolean;
  /** Path to results.json */
  jsonPath: string;
  /** Path to html-report/index.html */
  htmlIndexPath: string;
}

/**
 * Check existence of report files in a run directory.
 *
 * @param runDir - Absolute path to the run directory
 * @returns Status of report files
 */
export function checkReportFiles(runDir: string): ReportFilesStatus {
  const jsonPath = join(runDir, 'results.json');
  const htmlIndexPath = join(runDir, 'html-report', 'index.html');

  return {
    jsonExists: existsSync(jsonPath),
    htmlIndexExists: existsSync(htmlIndexPath),
    jsonPath,
    htmlIndexPath,
  };
}

/**
 * Parse a Playwright JSON report from a file.
 *
 * @param jsonPath - Absolute path to results.json
 * @returns Parsed report or invalid result
 */
export function parseReportFile(jsonPath: string): ParsedReport {
  // Check file exists
  if (!existsSync(jsonPath)) {
    return createInvalidReport(`Report file does not exist: ${jsonPath}`);
  }

  // Read file
  let content: string;
  try {
    content = readFileSync(jsonPath, 'utf-8');
  } catch (err) {
    return createInvalidReport(
      `Cannot read report file: ${(err as Error).message}`
    );
  }

  // Parse JSON
  let rawReport: unknown;
  try {
    rawReport = JSON.parse(content);
  } catch {
    return createInvalidReport('Invalid JSON in report file');
  }

  // Validate and extract
  return parseReportJson(rawReport);
}

/**
 * Parse a Playwright JSON report from a raw object.
 *
 * @param rawReport - Raw parsed JSON
 * @returns Parsed report
 */
export function parseReportJson(rawReport: unknown): ParsedReport {
  if (typeof rawReport !== 'object' || rawReport === null) {
    return createInvalidReport('Report must be a JSON object');
  }

  const report = rawReport as Record<string, unknown>;

  // Extract stats
  const stats = extractStats(report);
  if (!stats) {
    return createInvalidReport('Missing or invalid stats in report');
  }

  // Extract tests (separates interrupted tests from normal results)
  const { tests, interruptedTests } = extractTests(report);

  // Extract top-level errors
  const errors = extractErrors(report);

  return {
    stats,
    tests,
    interruptedTests,
    errors,
    valid: true,
  };
}

/**
 * Extract test statistics from the report.
 */
function extractStats(report: Record<string, unknown>): TestStats | null {
  const stats = report.stats;
  if (typeof stats !== 'object' || stats === null) {
    return null;
  }

  const s = stats as Record<string, unknown>;

  // Extract required numeric fields
  const expected = typeof s.expected === 'number' ? s.expected : 0;
  const unexpected = typeof s.unexpected === 'number' ? s.unexpected : 0;
  const flaky = typeof s.flaky === 'number' ? s.flaky : 0;
  const skipped = typeof s.skipped === 'number' ? s.skipped : 0;
  const duration = typeof s.duration === 'number' ? s.duration : 0;

  // Playwright uses 'expected' for passed tests
  // 'unexpected' for failed, 'skipped' for skipped
  return {
    total: expected + unexpected + flaky + skipped,
    passed: expected,
    failed: unexpected + flaky, // In Phase 1, flaky is treated as failed (no retries)
    skipped,
    duration,
  };
}

/**
 * Result of extracting tests from the report.
 */
interface ExtractedTests {
  tests: TestResult[];
  interruptedTests: InterruptedTest[];
}

/**
 * Extract individual test results from the report.
 * Separates interrupted tests from normal results.
 */
function extractTests(report: Record<string, unknown>): ExtractedTests {
  const tests: TestResult[] = [];
  const interruptedTests: InterruptedTest[] = [];

  // Playwright JSON report has 'suites' array containing tests
  const suites = report.suites;
  if (!Array.isArray(suites)) {
    return { tests, interruptedTests };
  }

  // Recursively extract tests from suites
  extractTestsFromSuites(suites, tests, interruptedTests);

  return { tests, interruptedTests };
}

/**
 * Recursively extract tests from a suite array.
 * Separates interrupted tests from normal results.
 */
function extractTestsFromSuites(
  suites: unknown[],
  results: TestResult[],
  interruptedTests: InterruptedTest[],
  titlePath: string[] = []
): void {
  for (const suite of suites) {
    if (typeof suite !== 'object' || suite === null) {
      continue;
    }

    const s = suite as Record<string, unknown>;
    const suiteTitle = typeof s.title === 'string' ? s.title : '';
    const currentPath = suiteTitle ? [...titlePath, suiteTitle] : titlePath;
    const file = typeof s.file === 'string' ? s.file : '';

    // Extract tests from this suite
    const specs = s.specs;
    if (Array.isArray(specs)) {
      for (const spec of specs) {
        if (typeof spec !== 'object' || spec === null) {
          continue;
        }

        const sp = spec as Record<string, unknown>;
        const testTitle = typeof sp.title === 'string' ? sp.title : '';
        const testPath = [...currentPath, testTitle];

        // Extract test results (Playwright can have multiple results per test with retries)
        const tests = sp.tests;
        if (Array.isArray(tests)) {
          for (const test of tests) {
            if (typeof test !== 'object' || test === null) {
              continue;
            }

            const t = test as Record<string, unknown>;
            const rawStatus = typeof t.status === 'string' ? t.status : 'passed';
            const testResults = t.results;
            if (Array.isArray(testResults) && testResults.length > 0) {
              // Take the last result (most recent retry)
              const lastResult = testResults[testResults.length - 1];
              if (typeof lastResult === 'object' && lastResult !== null) {
                const r = lastResult as Record<string, unknown>;
                const internalStatus = normalizeStatus(rawStatus);
                const duration = typeof r.duration === 'number' ? r.duration : 0;
                const error = extractErrorMessage(r);
                const testFile = file || (typeof t.file === 'string' ? t.file : '');

                // Handle interrupted tests separately
                if (internalStatus === 'interrupted') {
                  interruptedTests.push({
                    title: testPath.join(' > '),
                    file: testFile,
                    originalStatus: rawStatus,
                    error,
                  });
                } else {
                  // Include originalStatus if it differs from normalized (e.g., timedOut -> failed)
                  const needsOriginalStatus =
                    rawStatus.toLowerCase() === 'timedout' ||
                    rawStatus.toLowerCase() === 'flaky';

                  results.push({
                    titlePath: testPath,
                    title: testPath.join(' > '),
                    file: testFile,
                    status: internalStatus,
                    duration,
                    error,
                    retried: testResults.length > 1,
                    ...(needsOriginalStatus && { originalStatus: rawStatus }),
                  });
                }
              }
            }
          }
        }
      }
    }

    // Recurse into nested suites
    const nestedSuites = s.suites;
    if (Array.isArray(nestedSuites)) {
      extractTestsFromSuites(nestedSuites, results, interruptedTests, currentPath);
    }
  }
}

/**
 * Internal type for status normalization that includes 'interrupted'.
 */
type InternalStatus = TestStatus | 'interrupted';

/**
 * Normalize Playwright test status to our internal status type.
 *
 * Playwright's individual test statuses:
 * - 'passed' / 'expected' -> 'passed'
 * - 'failed' / 'unexpected' -> 'failed'
 * - 'timedOut' -> 'failed' (individual test timeout is a test failure)
 * - 'flaky' -> 'failed' (no retries in Phase 1)
 * - 'skipped' -> 'skipped'
 * - 'interrupted' -> 'interrupted' (tracked separately, not counted as ordinary failure)
 */
function normalizeStatus(status: string): InternalStatus {
  switch (status.toLowerCase()) {
    case 'passed':
    case 'expected':
      return 'passed';
    case 'failed':
    case 'unexpected':
    case 'timedout':
    case 'flaky':
      return 'failed';
    case 'skipped':
      return 'skipped';
    case 'interrupted':
      return 'interrupted';
    default:
      // Unknown status treated as failed for safety
      return 'failed';
  }
}

/**
 * Extract error message from a test result.
 */
function extractErrorMessage(result: Record<string, unknown>): string | undefined {
  // Try 'error' field first
  const error = result.error;
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e.message === 'string' && e.message) {
      return e.message;
    }
  }

  // Try 'errors' array
  const errors = result.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const firstError = errors[0];
    if (typeof firstError === 'object' && firstError !== null) {
      const e = firstError as Record<string, unknown>;
      if (typeof e.message === 'string' && e.message) {
        return e.message;
      }
    }
  }

  return undefined;
}

/**
 * Extract top-level errors from the report.
 * These are errors that occurred at setup/teardown/worker level,
 * not within individual tests.
 */
function extractErrors(report: Record<string, unknown>): TopLevelError[] {
  const errors: TopLevelError[] = [];

  // Playwright JSON report has 'errors' array at top level
  const reportErrors = report.errors;
  if (!Array.isArray(reportErrors)) {
    return errors;
  }

  for (const err of reportErrors) {
    if (typeof err === 'object' && err !== null) {
      const e = err as Record<string, unknown>;
      const message = typeof e.message === 'string' ? e.message : String(err);
      const location = typeof e.location === 'string' ? e.location : undefined;

      errors.push({ message, location });
    } else if (typeof err === 'string') {
      errors.push({ message: err });
    }
  }

  return errors;
}

/**
 * Create an invalid report result.
 */
function createInvalidReport(error: string): ParsedReport {
  return {
    stats: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
    },
    tests: [],
    interruptedTests: [],
    errors: [],
    valid: false,
    validationError: error,
  };
}
