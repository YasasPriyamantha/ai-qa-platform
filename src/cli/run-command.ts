/**
 * Run command implementation
 *
 * Executes Playwright tests for a configured project.
 * Reuses the shared config loader, runner, and report reconciliation.
 */

import { resolve, isAbsolute } from 'node:path';
import { loadProjectConfig, ConfigValidationError } from '../projects/index.js';
import {
  runPlaywrightTests,
  ProcessStartupError,
  createCollisionSafeRunDirectory,
} from '../test-execution/index.js';
import {
  reconcileRunResult,
  shouldExitNonZero,
} from '../reporting/index.js';
import {
  displayRunStart,
  displayRunComplete,
  displayStartupError,
  displayError,
  displaySpawnFailure,
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
      // Process startup failed - create a minimal run directory for artifacts
      const { runId, runDirectory } = createCollisionSafeRunDirectory(
        config.resolvedArtifactDirectory
      );

      displaySpawnFailure(
        config.projectId,
        runId,
        runDirectory,
        err
      );
      return EXIT_FAILURE;
    }
    displayStartupError(err as Error);
    return EXIT_FAILURE;
  }

  // Reconcile process evidence with report evidence
  const result = reconcileRunResult({
    processResult: metadata.processResult,
    runDir: metadata.runDirectory,
  });

  // Display completion information with final status
  displayRunComplete(metadata, result);

  // Determine exit code
  if (shouldExitNonZero(result, metadata.processResult)) {
    return EXIT_FAILURE;
  }

  return EXIT_SUCCESS;
}
