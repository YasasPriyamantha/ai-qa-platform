/**
 * Run command implementation
 *
 * Executes Playwright tests for a configured project.
 * Reuses the shared config loader, runner, and report reconciliation.
 *
 * DEC-032: Validates both Phase 1 and Phase 2 configuration before execution.
 * - Phase 1: execution fields (baseUrl, testDirectory, etc.)
 * - Phase 2: role profiles, credential references, document references
 *
 * Role credentials (DEC-042 §3.2): each role credential variable is passed to
 * Playwright from the parsed root .env, otherwise the inherited environment value.
 * Missing names are warned about; the run still goes ahead. Values are never printed.
 */

import { resolve, isAbsolute, join } from 'node:path';
import {
  loadPhase2ProjectConfig,
  ConfigValidationError,
  checkCredentialPresence,
} from '../projects/index.js';
import { parseEnvFile, getEnvSecret } from '../provider-secrets/index.js';
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
 * @param rootDir - Directory holding the root .env (default: current directory)
 * @returns Exit code (0 for success, non-zero for failure)
 */
export async function executeRunCommand(configPath: string, rootDir: string = process.cwd()): Promise<number> {
  // Resolve config path to absolute
  const absoluteConfigPath = isAbsolute(configPath)
    ? configPath
    : resolve(process.cwd(), configPath);

  // Load and validate project configuration (Phase 1 + Phase 2)
  // DEC-032: Validates both execution fields and role/credential structure
  // before Playwright starts. Does not require credential values to be present.
  let config;
  try {
    config = loadPhase2ProjectConfig(absoluteConfigPath);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      displayError('Invalid project configuration', err.message);
    } else {
      displayStartupError(err as Error);
    }
    return EXIT_FAILURE;
  }

  // Role credentials: .env value wins, otherwise the inherited value (CI secrets). Only role variables.
  const envFile = parseEnvFile(join(rootDir, '.env'));
  const credentialEnv: Record<string, string> = {};
  for (const variable of (config.roles ?? []).flatMap((r) => Object.values(r.credentials))) {
    const value = (envFile.success ? getEnvSecret(envFile.values, variable) : undefined) ?? process.env[variable];
    if (value !== undefined && value.trim() !== '') credentialEnv[variable] = value;
  }

  // Display run start information
  displayRunStart(config);

  const presence = checkCredentialPresence(config.roles, credentialEnv);
  if (!presence.allPresent) {
    console.log(`  Warning: role credential variables not set in .env or the environment: ${presence.missingVariables.join(', ')}`);
    console.log('');
  }

  // Execute tests with default timeout
  let metadata;
  try {
    metadata = await runPlaywrightTests(config, {
      timeoutMs: DEFAULT_TIMEOUT_MS,
      extraEnv: credentialEnv,
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
