/**
 * CLI output formatting
 *
 * Handles display of run status, progress, and final results.
 * Implements the final status model from DEC-017 and DEC-021.
 */

import type { ResolvedConfig } from '../projects/config.js';
import type { RunMetadata } from '../test-execution/runner.js';
import type { RunResult, Finding } from '../reporting/index.js';

/**
 * Display run start information.
 */
export function displayRunStart(config: ResolvedConfig): void {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  AI QA Automation Platform - Test Execution');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Project:     ${config.name} (${config.projectId})`);
  console.log(`  Environment: ${config.environment}`);
  console.log(`  Base URL:    ${config.baseUrl}`);
  console.log(`  Test Dir:    ${config.resolvedTestDirectory}`);
  console.log('');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('  Starting test run...');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('');
}

/**
 * Format duration in a human-readable format.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

/**
 * Display run completion with final status.
 */
export function displayRunComplete(
  metadata: RunMetadata,
  result: RunResult
): void {
  const { processResult, runId, runDirectory, projectId } = metadata;
  const { stats, runStatus, reportStatus, primaryReason, primaryMessage, additionalFindings } = result;

  console.log('');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('  Run Complete');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`  Project:     ${projectId}`);
  console.log(`  Run ID:      ${runId}`);
  console.log(`  Duration:    ${formatDuration(processResult.duration)}`);
  console.log('');

  // Display test counts
  displayTestCounts(stats);

  // Display status
  displayStatus(runStatus, reportStatus);

  // Display primary reason if present
  if (primaryReason && primaryMessage) {
    displayPrimaryReason(primaryReason, primaryMessage);
  }

  // Display additional findings
  if (additionalFindings.length > 0) {
    displayFindings(additionalFindings);
  }

  // Display artifact paths
  console.log('');
  console.log('  Artifacts:');
  console.log(`    Directory:   ${runDirectory}`);
  if (result.jsonReportPath) {
    console.log(`    JSON Report: ${result.jsonReportPath}`);
  }
  if (result.htmlReportPath) {
    console.log(`    HTML Report: ${result.htmlReportPath}`);
  } else if (reportStatus === 'partial') {
    console.log(`    HTML Report: (not found)`);
  }

  console.log('');
}

/**
 * Display test count summary.
 */
function displayTestCounts(stats: { total: number; passed: number; failed: number; skipped: number }): void {
  console.log('  Test Results:');
  console.log(`    Total:   ${stats.total}`);
  console.log(`    Passed:  ${stats.passed}`);
  console.log(`    Failed:  ${stats.failed}`);
  console.log(`    Skipped: ${stats.skipped}`);
  console.log('');
}

/**
 * Display run and report status.
 */
function displayStatus(runStatus: string, reportStatus: string): void {
  const runStatusDisplay = runStatus.toUpperCase().replace(/_/g, ' ');
  const reportStatusDisplay = reportStatus.toUpperCase();

  // Determine status box styling
  const isSuccess = runStatus === 'passed' && reportStatus === 'complete';
  const statusSymbol = isSuccess ? '✓' : '✗';
  const statusLabel = isSuccess ? 'SUCCESS' : 'FAILED';

  console.log('  ┌─────────────────────────────────────────────┐');
  console.log(`  │  ${statusSymbol} ${statusLabel.padEnd(40)} │`);
  console.log('  ├─────────────────────────────────────────────┤');
  console.log(`  │  Run Status:    ${runStatusDisplay.padEnd(26)} │`);
  console.log(`  │  Report Status: ${reportStatusDisplay.padEnd(26)} │`);
  console.log('  └─────────────────────────────────────────────┘');
}

/**
 * Display primary reason for non-passed runs.
 */
function displayPrimaryReason(reason: string, message: string): void {
  console.log('');
  console.log('  Primary Reason:');
  console.log(`    Code:    ${reason}`);
  console.log(`    Message: ${message}`);
}

/**
 * Display additional findings.
 */
function displayFindings(findings: Finding[]): void {
  console.log('');
  console.log('  Additional Findings:');
  for (const finding of findings) {
    console.log(`    • [${finding.code}] ${finding.message}`);
  }
}

/**
 * Display error message.
 */
export function displayError(message: string, details?: string): void {
  console.error('');
  console.error('═══════════════════════════════════════════════════════════════════');
  console.error('  ERROR');
  console.error('═══════════════════════════════════════════════════════════════════');
  console.error('');
  console.error(`  ${message}`);
  if (details) {
    console.error('');
    console.error(`  Details: ${details}`);
  }
  console.error('');
}

/**
 * Display startup error (config or runner setup failed).
 */
export function displayStartupError(error: Error): void {
  displayError('Failed to start test run', error.message);
}

/**
 * Display spawn failure as a run result.
 */
export function displaySpawnFailure(
  projectId: string,
  runId: string,
  runDirectory: string,
  error: Error
): void {
  console.log('');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('  Run Complete');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`  Project:     ${projectId}`);
  console.log(`  Run ID:      ${runId}`);
  console.log('');
  console.log('  ┌─────────────────────────────────────────────┐');
  console.log('  │  ✗ INFRASTRUCTURE ERROR                    │');
  console.log('  ├─────────────────────────────────────────────┤');
  console.log('  │  Run Status:    INFRASTRUCTURE ERROR       │');
  console.log('  │  Report Status: FAILED                     │');
  console.log('  └─────────────────────────────────────────────┘');
  console.log('');
  console.log('  Primary Reason:');
  console.log('    Code:    playwright_process_error');
  console.log(`    Message: ${error.message}`);
  console.log('');
  console.log('  Artifacts:');
  console.log(`    Directory:   ${runDirectory}`);
  console.log('');
}
