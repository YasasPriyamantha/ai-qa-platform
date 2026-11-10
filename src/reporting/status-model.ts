/**
 * Status model and reconciliation logic
 *
 * Implements the three-status model from DEC-017 and the primary reason
 * precedence from DEC-021 and the Phase 1 implementation review.
 */

import type { ParsedReport, TestStats } from './report-parser.js';
import type { ProcessResult } from '../test-execution/runner.js';
import { checkReportFiles, parseReportFile } from './report-parser.js';

/**
 * Run status values (DEC-017).
 */
export type RunStatus = 'passed' | 'failed' | 'timed_out' | 'infrastructure_error';

/**
 * Report collection status (DEC-017).
 */
export type ReportStatus = 'complete' | 'partial' | 'failed';

/**
 * Primary reason codes for unsuccessful runs (DEC-017).
 */
export type PrimaryReason =
  | 'runner_timeout'
  | 'playwright_process_error'
  | 'report_invalid'
  | 'no_tests_found'
  | 'test_failures'
  | 'cleanup_failed'
  | 'exit_report_mismatch';

/**
 * Additional finding codes for secondary issues.
 */
export type FindingCode =
  | 'report_invalid'
  | 'html_report_missing'
  | 'cleanup_failed'
  | 'output_incomplete'
  | 'exit_report_mismatch'
  | 'tests_interrupted';

/**
 * Additional finding with code and description.
 */
export interface Finding {
  code: FindingCode;
  message: string;
}

/**
 * Final reconciled run result.
 */
export interface RunResult {
  /** Overall run status */
  runStatus: RunStatus;

  /** Report collection status */
  reportStatus: ReportStatus;

  /** Test statistics from report (if available) */
  stats: TestStats;

  /** Primary machine-readable reason for non-passed runs */
  primaryReason?: PrimaryReason;

  /** Human-readable message explaining the primary reason */
  primaryMessage?: string;

  /** Additional findings (secondary issues) */
  additionalFindings: Finding[];

  /** Parsed report (if available and valid) */
  parsedReport?: ParsedReport;

  /** Path to JSON report (if exists) */
  jsonReportPath?: string;

  /** Path to HTML report index (if exists) */
  htmlReportPath?: string;
}

/**
 * Input for status reconciliation.
 */
export interface ReconciliationInput {
  /** Process result from the runner */
  processResult: ProcessResult;

  /** Run directory path */
  runDir: string;

  /** Whether this was a spawn failure (runner didn't launch process) */
  spawnFailed?: boolean;

  /** Spawn error message if spawn failed */
  spawnError?: string;
}

/**
 * Reconcile process evidence and report evidence into a final run result.
 *
 * Implements the primary reason precedence (DEC-021, amended by DEC-027):
 * 1. runner_timeout -> run timed_out
 * 2. playwright_process_error -> primary when spawn fails or Playwright exits non-zero with missing JSON
 * 3. report_invalid -> infrastructure_error when JSON is malformed/missing (if not timeout/spawn failure)
 * 4. tests_interrupted -> infrastructure_error with playwright_process_error (takes priority over test_failures)
 * 4.5. no_tests_found -> infrastructure_error when valid JSON shows zero tests (after interrupted check)
 * 5. test_failures -> failed when tests failed
 * 6. cleanup_failed -> infrastructure_error when cleanup failed (if no higher rule applies)
 * 7. playwright_process_error -> infrastructure_error for signals/top-level errors
 * 8. exit_report_mismatch -> infrastructure_error when exit and report contradict
 *
 * @param input - Reconciliation input
 * @returns Final run result
 */
export function reconcileRunResult(input: ReconciliationInput): RunResult {
  const { processResult, runDir, spawnFailed, spawnError } = input;
  const additionalFindings: Finding[] = [];

  // Check report files
  const reportFiles = checkReportFiles(runDir);

  // Parse JSON report if it exists
  let parsedReport: ParsedReport | undefined;
  if (reportFiles.jsonExists) {
    parsedReport = parseReportFile(reportFiles.jsonPath);
  }

  // Determine report status
  const reportStatus = determineReportStatus(reportFiles, parsedReport);

  // Add html_report_missing finding if applicable
  if (reportFiles.jsonExists && parsedReport?.valid && !reportFiles.htmlIndexExists) {
    additionalFindings.push({
      code: 'html_report_missing',
      message: `HTML report index.html not found at: ${reportFiles.htmlIndexPath}`,
    });
  }

  // Track cleanup status
  const cleanupFailed = processResult.cleanup && !processResult.cleanup.success;
  const cleanupError = processResult.cleanup?.error;

  // Track output incomplete
  if (processResult.outputIncomplete) {
    additionalFindings.push({
      code: 'output_incomplete',
      message: 'Output collection may be incomplete (stdio pipes not fully drained)',
    });
  }

  // Initialize default stats
  const defaultStats: TestStats = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    duration: processResult.duration,
  };

  // PRECEDENCE RULE 1: runner_timeout
  if (processResult.timedOut) {
    // Cleanup failure is additional, not primary
    if (cleanupFailed) {
      additionalFindings.push({
        code: 'cleanup_failed',
        message: cleanupError || 'Process cleanup failed after timeout',
      });
    }

    // Report may be invalid/missing due to timeout
    if (reportStatus === 'failed') {
      additionalFindings.push({
        code: 'report_invalid',
        message: 'JSON report missing or invalid (process was terminated by timeout)',
      });
    }

    // Check for interrupted tests in the available report
    if (parsedReport?.valid && parsedReport.interruptedTests.length > 0) {
      const interruptedNames = parsedReport.interruptedTests
        .map((t) => t.title)
        .join(', ');
      additionalFindings.push({
        code: 'tests_interrupted',
        message: `${parsedReport.interruptedTests.length} test(s) were interrupted: ${interruptedNames}`,
      });
    }

    return {
      runStatus: 'timed_out',
      reportStatus,
      stats: parsedReport?.valid ? parsedReport.stats : defaultStats,
      primaryReason: 'runner_timeout',
      primaryMessage: 'Runner timeout exceeded; process was terminated',
      additionalFindings,
      parsedReport: parsedReport?.valid ? parsedReport : undefined,
      jsonReportPath: reportFiles.jsonExists ? reportFiles.jsonPath : undefined,
      htmlReportPath: reportFiles.htmlIndexExists ? reportFiles.htmlIndexPath : undefined,
    };
  }

  // PRECEDENCE RULE 2: playwright_process_error (spawn failure)
  if (spawnFailed) {
    return {
      runStatus: 'infrastructure_error',
      reportStatus: 'failed',
      stats: defaultStats,
      primaryReason: 'playwright_process_error',
      primaryMessage: spawnError || 'Playwright process failed to spawn',
      additionalFindings,
    };
  }

  // PRECEDENCE RULE 2: playwright_process_error (non-zero exit + missing JSON)
  if (processResult.exitCode !== 0 && !reportFiles.jsonExists) {
    additionalFindings.push({
      code: 'report_invalid',
      message: 'JSON report was not generated',
    });

    // Include stderr in message if available
    const stderrSnippet = processResult.stderr?.trim().slice(0, 500);
    const message = stderrSnippet
      ? `Playwright process exited with code ${processResult.exitCode}: ${stderrSnippet}`
      : `Playwright process exited with code ${processResult.exitCode}`;

    return {
      runStatus: 'infrastructure_error',
      reportStatus: 'failed',
      stats: defaultStats,
      primaryReason: 'playwright_process_error',
      primaryMessage: message,
      additionalFindings,
    };
  }

  // PRECEDENCE RULE 3: report_invalid (malformed JSON)
  if (reportFiles.jsonExists && parsedReport && !parsedReport.valid) {
    // Add cleanup failure if present
    if (cleanupFailed) {
      additionalFindings.push({
        code: 'cleanup_failed',
        message: cleanupError || 'Process cleanup failed',
      });
    }

    return {
      runStatus: 'infrastructure_error',
      reportStatus: 'failed',
      stats: defaultStats,
      primaryReason: 'report_invalid',
      primaryMessage: parsedReport.validationError || 'JSON report is malformed',
      additionalFindings,
    };
  }

  // PRECEDENCE RULE 3: report_invalid (missing JSON despite exit 0)
  if (!reportFiles.jsonExists && processResult.exitCode === 0) {
    if (cleanupFailed) {
      additionalFindings.push({
        code: 'cleanup_failed',
        message: cleanupError || 'Process cleanup failed',
      });
    }

    return {
      runStatus: 'infrastructure_error',
      reportStatus: 'failed',
      stats: defaultStats,
      primaryReason: 'report_invalid',
      primaryMessage: 'JSON report missing despite exit code 0',
      additionalFindings,
    };
  }

  // At this point, we should have a valid parsed report
  if (!parsedReport?.valid) {
    return {
      runStatus: 'infrastructure_error',
      reportStatus: 'failed',
      stats: defaultStats,
      primaryReason: 'report_invalid',
      primaryMessage: 'Failed to parse JSON report',
      additionalFindings,
    };
  }

  const stats = parsedReport.stats;

  // Check for top-level errors
  const hasTopLevelErrors = parsedReport.errors.length > 0;
  const topLevelErrorMessage = hasTopLevelErrors
    ? parsedReport.errors.map((e) => e.message).join('; ')
    : undefined;

  // PRECEDENCE RULE 4: tests_interrupted (takes priority over no_tests_found and test_failures)
  // Interrupted tests indicate the execution was terminated unexpectedly (not by runner timeout)
  // This check comes before no_tests_found because interrupted tests ARE discovered tests.
  if (parsedReport.interruptedTests.length > 0) {
    const interruptedNames = parsedReport.interruptedTests
      .map((t) => t.title)
      .join(', ');

    // Add tests_interrupted as an additional finding
    additionalFindings.push({
      code: 'tests_interrupted',
      message: `${parsedReport.interruptedTests.length} test(s) were interrupted: ${interruptedNames}`,
    });

    // Add cleanup failure if present
    if (cleanupFailed) {
      additionalFindings.push({
        code: 'cleanup_failed',
        message: cleanupError || 'Process cleanup failed',
      });
    }

    // If there are also ordinary test failures, note them
    if (stats.failed > 0) {
      additionalFindings.push({
        code: 'exit_report_mismatch',
        message: `Additionally, ${stats.failed} test(s) failed before interruption`,
      });
    }

    return {
      runStatus: 'infrastructure_error',
      reportStatus,
      stats,
      primaryReason: 'playwright_process_error',
      primaryMessage: `Test execution was interrupted (${parsedReport.interruptedTests.length} test(s) affected)`,
      additionalFindings,
      parsedReport,
      jsonReportPath: reportFiles.jsonPath,
      htmlReportPath: reportFiles.htmlIndexExists ? reportFiles.htmlIndexPath : undefined,
    };
  }

  // PRECEDENCE RULE 4.5: no_tests_found
  // Note: This check comes AFTER interrupted tests because interrupted tests ARE discovered tests.
  if (stats.total === 0) {
    if (cleanupFailed) {
      additionalFindings.push({
        code: 'cleanup_failed',
        message: cleanupError || 'Process cleanup failed',
      });
    }

    return {
      runStatus: 'infrastructure_error',
      reportStatus,
      stats,
      primaryReason: 'no_tests_found',
      primaryMessage: 'No tests were discovered in the test directory',
      additionalFindings,
      parsedReport,
      jsonReportPath: reportFiles.jsonPath,
      htmlReportPath: reportFiles.htmlIndexExists ? reportFiles.htmlIndexPath : undefined,
    };
  }

  // PRECEDENCE RULE 5: test_failures
  if (stats.failed > 0) {
    // Check for exit/report mismatch as additional finding
    if (processResult.exitCode === 0) {
      additionalFindings.push({
        code: 'exit_report_mismatch',
        message: `Process exit code was 0 but ${stats.failed} test(s) failed`,
      });
    }

    if (cleanupFailed) {
      additionalFindings.push({
        code: 'cleanup_failed',
        message: cleanupError || 'Process cleanup failed',
      });
    }

    const message = stats.failed === 1
      ? '1 test failed'
      : `${stats.failed} tests failed`;

    return {
      runStatus: 'failed',
      reportStatus,
      stats,
      primaryReason: 'test_failures',
      primaryMessage: message,
      additionalFindings,
      parsedReport,
      jsonReportPath: reportFiles.jsonPath,
      htmlReportPath: reportFiles.htmlIndexExists ? reportFiles.htmlIndexPath : undefined,
    };
  }

  // All tests passed according to the report

  // PRECEDENCE RULE 6: cleanup_failed (no higher rules apply)
  if (cleanupFailed) {
    return {
      runStatus: 'infrastructure_error',
      reportStatus,
      stats,
      primaryReason: 'cleanup_failed',
      primaryMessage: cleanupError || 'Process cleanup failed',
      additionalFindings,
      parsedReport,
      jsonReportPath: reportFiles.jsonPath,
      htmlReportPath: reportFiles.htmlIndexExists ? reportFiles.htmlIndexPath : undefined,
    };
  }

  // PRECEDENCE RULE 7: playwright_process_error (top-level errors with non-zero exit)
  if (hasTopLevelErrors && processResult.exitCode !== 0) {
    return {
      runStatus: 'infrastructure_error',
      reportStatus,
      stats,
      primaryReason: 'playwright_process_error',
      primaryMessage: `Setup/teardown error: ${topLevelErrorMessage}`,
      additionalFindings,
      parsedReport,
      jsonReportPath: reportFiles.jsonPath,
      htmlReportPath: reportFiles.htmlIndexExists ? reportFiles.htmlIndexPath : undefined,
    };
  }

  // PRECEDENCE RULE 7: playwright_process_error (signal termination)
  if (processResult.signal) {
    return {
      runStatus: 'infrastructure_error',
      reportStatus,
      stats,
      primaryReason: 'playwright_process_error',
      primaryMessage: `Process terminated by signal: ${processResult.signal}`,
      additionalFindings,
      parsedReport,
      jsonReportPath: reportFiles.jsonPath,
      htmlReportPath: reportFiles.htmlIndexExists ? reportFiles.htmlIndexPath : undefined,
    };
  }

  // PRECEDENCE RULE 8: exit_report_mismatch (non-zero exit but all tests passed)
  if (processResult.exitCode !== 0 && stats.failed === 0) {
    const message = topLevelErrorMessage
      ? `Non-zero exit (${processResult.exitCode}) with no test failures: ${topLevelErrorMessage}`
      : `Non-zero exit (${processResult.exitCode}) with no test failures`;

    return {
      runStatus: 'infrastructure_error',
      reportStatus,
      stats,
      primaryReason: 'exit_report_mismatch',
      primaryMessage: message,
      additionalFindings,
      parsedReport,
      jsonReportPath: reportFiles.jsonPath,
      htmlReportPath: reportFiles.htmlIndexExists ? reportFiles.htmlIndexPath : undefined,
    };
  }

  // SUCCESS: All checks passed
  // Check for output incomplete - this forces non-zero CLI exit
  // but the run itself still passed

  // Check report status - non-complete forces non-zero CLI exit
  // but run status can still be passed

  return {
    runStatus: 'passed',
    reportStatus,
    stats,
    additionalFindings,
    parsedReport,
    jsonReportPath: reportFiles.jsonPath,
    htmlReportPath: reportFiles.htmlIndexExists ? reportFiles.htmlIndexPath : undefined,
  };
}

/**
 * Determine report collection status.
 *
 * - complete: valid JSON AND HTML index.html both verified
 * - partial: valid JSON but HTML missing/unverified
 * - failed: JSON missing or malformed
 */
function determineReportStatus(
  reportFiles: { jsonExists: boolean; htmlIndexExists: boolean },
  parsedReport?: ParsedReport
): ReportStatus {
  // JSON must exist and be valid
  if (!reportFiles.jsonExists || !parsedReport?.valid) {
    return 'failed';
  }

  // JSON is valid; check HTML
  if (!reportFiles.htmlIndexExists) {
    return 'partial';
  }

  return 'complete';
}

/**
 * Determine if the CLI should exit with non-zero code.
 *
 * Non-zero exit for:
 * - Run status is not 'passed'
 * - Report status is not 'complete'
 * - Cleanup failed (even if tests passed)
 * - Output incomplete (unverified result)
 *
 * @param result - Final run result
 * @param processResult - Original process result
 * @returns true if CLI should exit non-zero
 */
export function shouldExitNonZero(
  result: RunResult,
  processResult: ProcessResult
): boolean {
  // Any non-passed run status
  if (result.runStatus !== 'passed') {
    return true;
  }

  // Any non-complete report status
  if (result.reportStatus !== 'complete') {
    return true;
  }

  // Cleanup failure (captured in additionalFindings)
  if (result.additionalFindings.some((f) => f.code === 'cleanup_failed')) {
    return true;
  }

  // Output incomplete
  if (processResult.outputIncomplete) {
    return true;
  }

  return false;
}
