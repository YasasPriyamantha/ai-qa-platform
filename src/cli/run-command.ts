/**
 * Run command implementation
 *
 * Executes Playwright tests for a configured project.
 * Reuses the shared config loader and generic runner.
 */

import { resolve, isAbsolute } from 'node:path';
import { loadProjectConfig, ConfigValidationError } from '../projects/index.js';
import { runPlaywrightTests, ProcessStartupError } from '../test-execution/index.js';
import {
  displayRunStart,
  displayRunComplete,
  displayStartupError,
  displayError,
  determineProvisionalOutcome,
  type ProvisionalOutcome,
} from './output.js';

/**
 * Default runner timeout: 30 minutes.
 *
 * This is supplied through RunOptions.timeoutMs, not hard-coded in the runner
 * or added to project.config.json.
 */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Exit codes for the CLI.
 */
export const EXIT_SUCCESS = 0;
export const EXIT_FAILURE = 1;

/**
 * Execute the run command.
 *
 * @param configPath - Path to the project configuration file
 * @returns Exit code (0 for success, non-zero for failure)
 */
export async function executeRunCommand(configPath: string): Promise<number> {
  // Resolve config path to absolute
  const absoluteConfigPath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);

  // Load and validate project configuration
  let config;
  try {
    config = loadProjectConfig(absoluteConfigPath);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      displayError('Invalid project configuration', err.message);
    } else {
      displayStartupError(err as Error);
    }
    return EXIT_FAILURE;
  }

  // Display run start information
  displayRunStart(config);

  // Execute tests with default timeout
  let metadata;
  try {
    metadata = await runPlaywrightTests(config, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      // Stream output to console for progress visibility
      onStdout: (chunk) => process.stdout.write(chunk),
      onStderr: (chunk) => process.stderr.write(chunk),
    });
  } catch (err) {
    if (err instanceof ProcessStartupError) {
      displayError('Playwright process failed to start', err.message);
    } else {
      displayStartupError(err as Error);
    }
    return EXIT_FAILURE;
  }

  // Determine provisional outcome
  const outcome = determineProvisionalOutcome(metadata.processResult);

  // Display completion information
  displayRunComplete(metadata, outcome);

  // Determine exit code based on outcome
  return determineExitCode(outcome, metadata.processResult);
}

/**
 * Determine CLI exit code from provisional outcome.
 *
 * Exit 0 only when:
 * - Runner process exit code is 0
 * - Run did not time out
 * - No startup/cleanup errors
 * - Output collection was complete
 *
 * Non-zero exit for:
 * - Non-zero runner exit
 * - Timeout
 * - Invalid config (handled above)
 * - Spawn error (handled above)
 * - Cleanup failure
 * - Output incomplete
 */
function determineExitCode(
  outcome: ProvisionalOutcome,
  processResult: { cleanup?: { success: boolean }; outputIncomplete?: boolean }
): number {
  // Any non-success outcome is a failure
  if (outcome !== 'PROVISIONAL SUCCESS') {
    return EXIT_FAILURE;
  }

  // Cleanup failure forces non-zero exit
  if (processResult.cleanup && !processResult.cleanup.success) {
    return EXIT_FAILURE;
  }

  // Output incomplete forces non-zero exit (unverified result)
  if (processResult.outputIncomplete) {
    return EXIT_FAILURE;
  }

  return EXIT_SUCCESS;
}
