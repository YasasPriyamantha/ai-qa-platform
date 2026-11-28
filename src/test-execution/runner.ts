/**
 * Generic Playwright runner
 *
 * Executes Playwright Test for a validated project configuration.
 * Supports runner-level timeout with cross-platform process tree/group cleanup.
 */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig } from '../projects/config.js';
import { generateRunId } from './run-id.js';
import { resolvePlaywrightCli } from './playwright-cli.js';
import {
  launchPlaywrightProcess,
  type ProcessResult,
  type LogPersistenceResult,
} from './process-manager.js';
import { createFilteredChildEnv } from '../provider-secrets/child-env-filter.js';

/**
 * Result of creating a collision-safe run directory.
 */
export interface RunDirectoryResult {
  /** Unique run identifier (UTC timestamp-based, possibly with suffix) */
  runId: string;
  /** Absolute path to the created run directory */
  runDirectory: string;
}

/**
 * Options for creating a run directory.
 */
export interface CreateRunDirectoryOptions {
  /** Maximum number of collision retry attempts (default: 10) */
  maxAttempts?: number;
}

/**
 * Create a collision-safe run directory in the artifact directory.
 *
 * This function is extracted from runPlaywrightTests for testability.
 * It handles:
 * - Creating the parent artifact directory if missing
 * - Generating a unique run ID with collision suffixes
 * - Atomic directory creation (throws EEXIST if already exists)
 * - Retrying up to maxAttempts times on collision
 *
 * @param artifactDirectory - Absolute path to the artifact directory
 * @param options - Optional configuration
 * @returns The run ID and run directory path
 * @throws Error if directory creation fails after all attempts
 */
export function createCollisionSafeRunDirectory(
  artifactDirectory: string,
  options: CreateRunDirectoryOptions = {}
): RunDirectoryResult {
  const maxAttempts = options.maxAttempts ?? 10;

  // Ensure parent artifact directory exists
  if (!existsSync(artifactDirectory)) {
    try {
      mkdirSync(artifactDirectory, { recursive: true });
    } catch (err) {
      throw new Error(
        `Failed to create artifact directory: ${(err as Error).message}. ` +
        `Path: ${artifactDirectory}`
      );
    }
  }

  // Generate collision-safe run ID and create directory atomically
  let runId: string | undefined;
  let runDirectory: string | undefined;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const candidateRunId = generateRunId(artifactDirectory);
    const candidateRunDirectory = join(artifactDirectory, candidateRunId);

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

  // This should never happen if maxAttempts > 0
  if (!runId || !runDirectory) {
    throw new Error(
      'Failed to create run directory: maximum attempts reached without success'
    );
  }

  return { runId, runDirectory };
}

/**
 * Options for running tests.
 */
export interface RunOptions {
  /** Additional Playwright CLI arguments (e.g., '--grep', '--project') */
  additionalArgs?: string[];

  /**
   * Runner-level timeout in milliseconds.
   * If the Playwright process exceeds this duration, it will be terminated.
   * Set to 0 or undefined to disable timeout.
   */
  timeoutMs?: number;

  /**
   * Optional callback for streaming stdout data.
   * Called with each chunk as it arrives, before the process exits.
   * Useful for observing output markers while the process is running.
   */
  onStdout?: (chunk: string) => void;

  /**
   * Optional callback for streaming stderr data.
   * Called with each chunk as it arrives, before the process exits.
   */
  onStderr?: (chunk: string) => void;

  /**
   * Extra environment variables for the Playwright child process (role credentials, DEC-042 §3.2).
   * Added through createFilteredChildEnv() additions; values are never logged or written.
   */
  extraEnv?: Record<string, string>;
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

// Re-export types for convenience
export type { ProcessResult, LogPersistenceResult } from './process-manager.js';
export type { CleanupResult } from './process-cleanup.js';

/**
 * Persist captured stdout and stderr to log files (DEC-016).
 *
 * Creates <run-dir>/logs/ containing stdout.log and stderr.log.
 * Preserves available output for successful runs, test failures, timeouts, and process errors.
 *
 * @param runDirectory - Absolute path to the run directory
 * @param stdout - Captured stdout content
 * @param stderr - Captured stderr content
 * @returns Result indicating what was persisted
 */
export function persistExecutionLogs(
  runDirectory: string,
  stdout: string,
  stderr: string
): LogPersistenceResult {
  const logsDir = join(runDirectory, 'logs');
  const result: LogPersistenceResult = {
    logsDirectoryCreated: false,
    stdoutWritten: false,
    stderrWritten: false,
  };

  try {
    // Create logs directory
    mkdirSync(logsDir, { recursive: true });
    result.logsDirectoryCreated = true;

    // Write stdout.log (may be empty)
    try {
      writeFileSync(join(logsDir, 'stdout.log'), stdout, 'utf-8');
      result.stdoutWritten = true;
    } catch (err) {
      result.error = `Failed to write stdout.log: ${(err as Error).message}`;
    }

    // Write stderr.log (may be empty)
    try {
      writeFileSync(join(logsDir, 'stderr.log'), stderr, 'utf-8');
      result.stderrWritten = true;
    } catch (err) {
      const msg = `Failed to write stderr.log: ${(err as Error).message}`;
      result.error = result.error ? `${result.error}; ${msg}` : msg;
    }
  } catch (err) {
    result.error = `Failed to create logs directory: ${(err as Error).message}`;
  }

  return result;
}

/**
 * Execute Playwright Test for a validated project configuration.
 *
 * Creates a unique run directory, resolves the Playwright CLI, launches the process,
 * and returns structured execution metadata.
 *
 * Supports runner-level timeout with cross-platform process tree/group cleanup:
 * - Windows: Uses taskkill /T /F /PID (no detached:true to avoid console window)
 * - Linux/macOS: Uses detached:true with process group SIGTERM → SIGKILL
 *
 * @param config - Validated and resolved project configuration
 * @param options - Run options including optional timeout
 * @returns Promise resolving to run metadata
 * @throws Error if runner setup or process launch fails
 */
export async function runPlaywrightTests(
  config: ResolvedConfig,
  options: RunOptions = {}
): Promise<RunMetadata> {
  // Create collision-safe run directory
  const { runId, runDirectory } = createCollisionSafeRunDirectory(
    config.resolvedArtifactDirectory
  );

  // Resolve Playwright CLI entry point from installed package
  const cliPath = resolvePlaywrightCli();

  // Build Playwright CLI arguments
  // Always use the platform-owned config at the repository root
  const args: string[] = [
    'test',
    '--config=playwright.config.ts',
    ...(options.additionalArgs || []),
  ];

  // Prepare environment variables for the child process.
  // Task 3.3: Filter out provider secrets from inherited environment.
  // This prevents AI provider API keys from being exposed to:
  // - Browser content (via page.evaluate or similar)
  // - Test output/logs
  // - Child process arguments
  //
  // The filter removes:
  // - Built-in provider keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY)
  // - All AI_PROVIDER_* variables (case-insensitive)
  // - Any registered provider key variables from config
  //
  // Windows system variables (PATH, SystemRoot, etc.) are preserved.
  const env = createFilteredChildEnv({
    baseEnv: process.env,
    // Note: registeredKeyVars could be loaded from provider config in future,
    // but the built-in names and AI_PROVIDER_* prefix cover all current cases
    additions: {
      ...options.extraEnv,
      QA_PROJECT_CONFIG_PATH: config.configPath,
      QA_RUN_DIR: runDirectory,
    },
  });

  // Launch Playwright process with optional timeout and stream callbacks
  const processResult = await launchPlaywrightProcess({
    cliPath,
    args,
    cwd: process.cwd(),
    env,
    timeoutMs: options.timeoutMs,
    onStdout: options.onStdout,
    onStderr: options.onStderr,
  });

  // Persist captured stdout and stderr to log files (DEC-016)
  // This preserves output for successful runs, failures, timeouts, and process errors
  const logResult = persistExecutionLogs(
    runDirectory,
    processResult.stdout,
    processResult.stderr
  );

  // Include log persistence status in process result for diagnostic purposes
  // (The result is informational; log persistence failures don't change run status)
  const processResultWithLogs: ProcessResult = {
    ...processResult,
    logPersistence: logResult,
  };

  return {
    runId,
    runDirectory,
    projectConfigPath: config.configPath,
    projectId: config.projectId,
    processResult: processResultWithLogs,
  };
}
