/**
 * Platform-owned Playwright configuration
 *
 * This is the single platform-owned Playwright configuration at the repository root.
 * It serves all target-application projects and runner fixtures.
 *
 * ENVIRONMENT VARIABLES:
 *
 *   QA_PROJECT_CONFIG_PATH - Absolute path to the selected project's project.config.json
 *   QA_RUN_DIR             - Absolute path to the unique run directory for this execution
 *
 * These environment variables are validated by loadPlaywrightConfig().
 * The configuration derives testDir, baseURL, and outputDir from the validated
 * project configuration.
 *
 * FAIL-FAST BEHAVIOR:
 *
 * If either environment variable is missing, invalid, or points outside the
 * allowed project/run directories, the config throws a clear error before
 * Playwright attempts to discover or run tests.
 *
 * This configuration NEVER silently falls back to a default project.
 */

import { defineConfig } from '@playwright/test';
import { loadPlaywrightConfig, ConfigValidationError } from './src/projects/index.js';

// Load configuration from environment variables
// Fails fast with a clear error if environment is invalid
let envConfig;
try {
  envConfig = loadPlaywrightConfig(process.env);
} catch (err) {
  if (err instanceof ConfigValidationError) {
    // Re-throw with clear context for Playwright's error output
    throw new Error(
      `Playwright configuration failed: ${err.message}\n\n` +
      `Ensure both QA_PROJECT_CONFIG_PATH and QA_RUN_DIR are set to valid absolute paths ` +
      `before running Playwright.`
    );
  }
  throw err;
}

export default defineConfig({
  // Derived from validated project configuration
  testDir: envConfig.testDir,

  use: {
    baseURL: envConfig.baseURL,
  },

  // Output directory for test artifacts (traces, screenshots)
  // Separate from the sibling HTML report directory
  outputDir: envConfig.outputDir,

  // Disable retries for Phase 1 execution (DEC-018)
  retries: 0,

  // Reporter configuration is deferred to Task 1.7
  // Do not configure JSON or HTML reporters here
});
