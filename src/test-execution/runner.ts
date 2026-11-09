/**
 * Generic Playwright runner
 *
 * Executes Playwright Test for a validated project configuration.
 * This is the normal execution path without timeout/process-tree termination.
 * Task 1.5b will add timeout handling.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig } from '../projects/config.js';
import { generateRunId } from './run-id.js';
import { resolvePlaywrightCli } from './playwright-cli.js';
import { launchPlaywrightProcess, type ProcessResult } from './process-manager.js';

/**
 * Options for running tests.
 */
export interface RunOptions {
  /** Additional Playwright CLI arguments (e.g., '--grep', '--project') */
  additionalArgs?: string[];
}

/**
 * Execution metadata for a test run.
 */
export interface RunMetadata {
  /** Unique run identifier (UTC timestamp-based) */
  runId: string;

  /** Absolute path to the run directory */
  runDirectory: string;

  /** Absolute path to the project config file */
  projectConfigPath: string;

  /** Project identifier */
  projectId: string;

  /** Process execution result */
  processResult: ProcessResult;
}

/**
 * Execute Playwright Test for a validated project configuration.
 *
 * Creates a unique run directory, resolves the Playwright CLI, launches the process,
 * and returns structured execution metadata.
 *
 * This implementation does NOT include timeout or process-tree cleanup.
 * Those features are deferred to Task 1.5b.
 *
 * @param config - Validated and resolved project configuration
 * @param options - Run options
 * @returns Promise resolving to run metadata
 * @throws Error if runner setup or process launch fails
 */
export async function runPlaywrightTests(
  config: ResolvedConfig,
  options: RunOptions = {}
): Promise<RunMetadata> {
  // Ensure parent artifact directory exists
  // Use recursive creation for the parent directory only
  if (!existsSync(config.resolvedArtifactDirectory)) {
    try {
      mkdirSync(config.resolvedArtifactDirectory, { recursive: true });
    } catch (err) {
      throw new Error(
        `Failed to create artifact directory: ${(err as Error).message}. ` +
        `Path: ${config.resolvedArtifactDirectory}`
      );
    }
  }

  // Generate collision-safe run ID and create directory atomically
  // Try up to 10 times in case of rapid concurrent executions
  let runId: string | undefined;
  let runDirectory: string | undefined;
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const candidateRunId = generateRunId(config.resolvedArtifactDirectory);
    const candidateRunDirectory = join(config.resolvedArtifactDirectory, candidateRunId);

    try {
      // Create run directory WITHOUT recursive flag
      // This will throw EEXIST if the directory already exists
      mkdirSync(candidateRunDirectory, { recursive: false });
      // Success - directory created atomically
      runId = candidateRunId;
      runDirectory = candidateRunDirectory;
      break;
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'EEXIST') {
        // Directory already exists (collision detected)
        // Try again with a new timestamp
        attempts++;
        if (attempts >= maxAttempts) {
          throw new Error(
            `Failed to create unique run directory after ${maxAttempts} attempts. ` +
            `Last attempted: ${candidateRunDirectory}`
          );
        }
        // Continue to next iteration
        continue;
      }
      // Other error - fail immediately
      throw new Error(
        `Failed to create run directory: ${nodeErr.message}. ` +
        `Path: ${candidateRunDirectory}`
      );
    }
  }

  // Ensure directory was created successfully
  if (!runId || !runDirectory) {
    throw new Error(
      'Failed to create run directory: maximum attempts reached without success'
    );
  }

  // Resolve Playwright CLI entry point from installed package
  const cliPath = resolvePlaywrightCli();

  // Build Playwright CLI arguments
  // Always use the platform-owned config at the repository root
  const args: string[] = [
    'test',
    '--config=playwright.config.ts',
    ...(options.additionalArgs || []),
  ];

  // Prepare environment variables for the child process
  // Pass absolute paths to the config and run directory
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    QA_PROJECT_CONFIG_PATH: config.configPath,
    QA_RUN_DIR: runDirectory,
  };

  // Launch Playwright process
  // Working directory is the platform root (current working directory)
  const processResult = await launchPlaywrightProcess({
    cliPath,
    args,
    cwd: process.cwd(),
    env,
  });

  return {
    runId,
    runDirectory,
    projectConfigPath: config.configPath,
    projectId: config.projectId,
    processResult,
  };
}
