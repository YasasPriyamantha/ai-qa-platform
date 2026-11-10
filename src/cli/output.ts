/**
 * CLI output formatting
 *
 * Handles display of run status, progress, and results.
 * Keeps output formatting separate from command logic.
 */

import type { ResolvedConfig } from '../projects/config.js';
import type { RunMetadata, ProcessResult } from '../test-execution/runner.js';

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
 * Provisional outcome of a test run.
 * Task 1.7 will implement final status with report parsing.
 */
export type ProvisionalOutcome =
  | 'PROVISIONAL SUCCESS'
  | 'PROVISIONAL FAILURE'
  | 'TIMEOUT'
  | 'RUNNER ERROR';

/**
 * Determine the provisional outcome from process result.
 *
 * Exit 0 only when:
 * - Runner process exit code is 0
 * - Run did not time out
 * - No startup/cleanup errors
 *
 * Until Task 1.7, results are explicitly labeled PROVISIONAL.
 */
export function determineProvisionalOutcome(
  processResult: ProcessResult
): ProvisionalOutcome {
  // Timeout takes precedence
  if (processResult.timedOut) {
    return 'TIMEOUT';
  }

  // Cleanup failure
  if (processResult.cleanup && !processResult.cleanup.success) {
    return 'RUNNER ERROR';
  }

  // Process exit code
  if (processResult.exitCode === 0) {
    return 'PROVISIONAL SUCCESS';
  }

  return 'PROVISIONAL FAILURE';
}

/**
 * Display run completion information.
 */
export function displayRunComplete(
  metadata: RunMetadata,
  outcome: ProvisionalOutcome
): void {
  const { processResult, runId, runDirectory, projectId } = metadata;

  console.log('');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('  Run Complete');
  console.log('───────────────────────────────────────────────────────────────────');
  console.log('');
  console.log(`  Project:     ${projectId}`);
  console.log(`  Run ID:      ${runId}`);
  console.log(`  Duration:    ${formatDuration(processResult.duration)}`);
  console.log(`  Artifacts:   ${runDirectory}`);
  console.log('');

  // Display outcome with appropriate styling
  displayOutcome(outcome);

  // Display warnings
  displayWarnings(processResult);

  console.log('');
}

/**
 * Display the provisional outcome.
 */
function displayOutcome(outcome: ProvisionalOutcome): void {
  switch (outcome) {
    case 'PROVISIONAL SUCCESS':
      console.log('  ┌─────────────────────────────────────────────┐');
      console.log('  │  OUTCOME: PROVISIONAL SUCCESS               │');
      console.log('  │  (Final verification pending Task 1.7)      │');
      console.log('  └─────────────────────────────────────────────┘');
      break;

    case 'PROVISIONAL FAILURE':
      console.log('  ┌─────────────────────────────────────────────┐');
      console.log('  │  OUTCOME: PROVISIONAL FAILURE               │');
      console.log('  │  (Tests failed or non-zero exit)            │');
      console.log('  └─────────────────────────────────────────────┘');
      break;

    case 'TIMEOUT':
      console.log('  ┌─────────────────────────────────────────────┐');
      console.log('  │  OUTCOME: TIMEOUT                           │');
      console.log('  │  (Runner timeout exceeded)                  │');
      console.log('  └─────────────────────────────────────────────┘');
      break;

    case 'RUNNER ERROR':
      console.log('  ┌─────────────────────────────────────────────┐');
      console.log('  │  OUTCOME: RUNNER ERROR                      │');
      console.log('  │  (Process or cleanup failure)               │');
      console.log('  └─────────────────────────────────────────────┘');
      break;
  }
}

/**
 * Display warnings for cleanup failure or incomplete output.
 */
function displayWarnings(processResult: ProcessResult): void {
  const warnings: string[] = [];

  // Cleanup failure warning
  if (processResult.cleanup && !processResult.cleanup.success) {
    warnings.push(`Cleanup failed: ${processResult.cleanup.error || 'Unknown error'}`);
  }

  // Output incomplete warning
  if (processResult.outputIncomplete) {
    warnings.push('Output collection may be incomplete (stdio pipes not fully drained)');
  }

  if (warnings.length > 0) {
    console.log('');
    console.log('  ⚠ WARNINGS:');
    for (const warning of warnings) {
      console.log(`    • ${warning}`);
    }
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
