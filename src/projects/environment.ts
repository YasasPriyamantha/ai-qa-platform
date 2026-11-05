/**
 * Environment-based configuration loading for Playwright
 *
 * Loads project configuration from environment variables.
 * Used by the root playwright.config.ts.
 */

import { existsSync, statSync } from 'node:fs';
import { join, relative, parse as parsePath } from 'node:path';
import { loadProjectConfig } from './loader.js';
import { ConfigValidationError, type PlaywrightEnvConfig } from './config.js';

/**
 * Environment variable names for Playwright configuration.
 */
export const ENV_PROJECT_CONFIG_PATH = 'QA_PROJECT_CONFIG_PATH';
export const ENV_RUN_DIR = 'QA_RUN_DIR';

/**
 * Interface for environment object to avoid direct process.env access.
 */
export interface EnvironmentVariables {
  [key: string]: string | undefined;
}

/**
 * Load Playwright configuration from environment variables.
 *
 * This function validates QA_PROJECT_CONFIG_PATH and QA_RUN_DIR,
 * loads the project configuration, and returns derived Playwright settings.
 *
 * @param env - Environment object (typically process.env)
 * @returns Playwright configuration derived from environment
 * @throws ConfigValidationError if environment variables are missing or invalid
 */
export function loadPlaywrightConfig(env: EnvironmentVariables): PlaywrightEnvConfig {
  // Validate QA_PROJECT_CONFIG_PATH
  const configPath = env[ENV_PROJECT_CONFIG_PATH];
  if (!configPath || configPath.trim() === '') {
    throw new ConfigValidationError(
      `Environment variable ${ENV_PROJECT_CONFIG_PATH} is required but not set. ` +
      `Set it to the absolute path of the project's project.config.json file.`,
      ENV_PROJECT_CONFIG_PATH
    );
  }

  // Validate QA_RUN_DIR
  const runDir = env[ENV_RUN_DIR];
  if (!runDir || runDir.trim() === '') {
    throw new ConfigValidationError(
      `Environment variable ${ENV_RUN_DIR} is required but not set. ` +
      `Set it to the absolute path of the run directory for this execution.`,
      ENV_RUN_DIR
    );
  }

  // Validate run directory is absolute
  if (!isAbsolutePath(runDir)) {
    throw new ConfigValidationError(
      `${ENV_RUN_DIR} must be an absolute path`,
      ENV_RUN_DIR,
      runDir
    );
  }

  // Load and validate project configuration
  const config = loadProjectConfig(configPath);

  // Validate run directory exists and is a directory
  // The runner creates the run directory before launching Playwright
  if (!existsSync(runDir)) {
    throw new ConfigValidationError(
      `Run directory does not exist: ${runDir}. ` +
      `The runner must create the run directory before launching Playwright.`,
      ENV_RUN_DIR,
      runDir
    );
  }

  try {
    const stat = statSync(runDir);
    if (!stat.isDirectory()) {
      throw new ConfigValidationError(
        `Run directory path exists but is not a directory: ${runDir}`,
        ENV_RUN_DIR,
        runDir
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ConfigValidationError(
        `Cannot access run directory: ${(err as Error).message}`,
        ENV_RUN_DIR,
        runDir
      );
    }
  }

  // Validate run directory is inside the artifact directory
  validateRunDirContainment(runDir, config.resolvedArtifactDirectory);

  // Derive Playwright configuration
  return {
    config,
    runDir,
    testDir: config.resolvedTestDirectory,
    baseURL: config.baseUrl,
    outputDir: join(runDir, 'test-output'),
  };
}

/**
 * Check if a path is absolute.
 */
function isAbsolutePath(p: string): boolean {
  const parsed = parsePath(p);
  return (
    parsed.root !== '' ||
    p.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(p)
  );
}

/**
 * Validate that the run directory is a strict descendant of the artifact directory.
 * Uses path.relative containment check with Windows path normalization.
 *
 * Rejects:
 * - Run directory equal to artifact directory (empty relative path)
 * - Run directory outside artifact directory (relative path starts with '..')
 * - Different-drive paths on Windows (relative path is absolute)
 */
function validateRunDirContainment(runDir: string, artifactDir: string): void {
  const rel = relative(artifactDir, runDir);

  // Empty relative path means runDir === artifactDir; must be a strict descendant
  if (rel === '') {
    throw new ConfigValidationError(
      `Run directory must be a strict descendant of the artifact directory, not equal to it. ` +
      `Both point to: ${runDir}`,
      ENV_RUN_DIR,
      runDir
    );
  }

  // If relative path starts with '..' it escapes the artifact directory
  // If relative path is absolute (e.g., different drive on Windows), reject it
  if (rel.startsWith('..') || isAbsolutePath(rel)) {
    throw new ConfigValidationError(
      `Run directory must be inside the artifact directory. ` +
      `Run: ${runDir}, Artifact: ${artifactDir}`,
      ENV_RUN_DIR,
      runDir
    );
  }

  // Also check with normalized paths for Windows drive-letter case differences
  const normalizedArtifact = normalizeWindowsPath(artifactDir);
  const normalizedRun = normalizeWindowsPath(runDir);

  if (!normalizedRun.toLowerCase().startsWith(normalizedArtifact.toLowerCase())) {
    throw new ConfigValidationError(
      `Run directory escapes artifact directory (drive-letter case mismatch). ` +
      `Run: ${runDir}, Artifact: ${artifactDir}`,
      ENV_RUN_DIR,
      runDir
    );
  }
}

/**
 * Normalize a Windows path for comparison.
 */
function normalizeWindowsPath(p: string): string {
  let normalized = p.replace(/\\/g, '/');
  if (/^[A-Z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }
  if (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
