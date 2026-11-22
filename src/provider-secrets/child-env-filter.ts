/**
 * Child process environment filtering.
 *
 * Task 3.3: Strip provider secrets from child process environment.
 *
 * When launching Playwright test processes, the platform must remove
 * AI provider API keys from the inherited environment to prevent
 * accidental exposure through:
 * - Browser content (via page.evaluate or similar)
 * - Test output/logs
 * - Child process arguments
 *
 * This module provides the filtering logic without modifying the
 * parent process environment.
 */

import type { SecretResolutionContext } from './types.js';
import { BUILT_IN_PROVIDER_KEY_NAMES } from '../model-providers/types.js';

/**
 * Pattern prefix for custom provider keys.
 * All variables starting with AI_PROVIDER_ are stripped (case-insensitive).
 */
const AI_PROVIDER_PREFIX = 'AI_PROVIDER_';

/**
 * Filter options for child environment.
 */
export interface ChildEnvFilterOptions {
  /**
   * Base environment to filter (typically process.env).
   */
  baseEnv: NodeJS.ProcessEnv;

  /**
   * Additional registered key variable names from provider config.
   * These are stripped even if they don't match the AI_PROVIDER_ prefix.
   */
  registeredKeyVars?: readonly string[];

  /**
   * Additional environment variables to add after filtering.
   * These are added AFTER filtering, so they can include platform variables
   * like QA_PROJECT_CONFIG_PATH.
   */
  additions?: Record<string, string>;
}

/**
 * Create a filtered environment for child processes.
 *
 * This function:
 * 1. Copies the base environment
 * 2. Removes all built-in provider key variables (OPENAI_API_KEY, etc.)
 * 3. Removes all AI_PROVIDER_* variables (case-insensitive)
 * 4. Removes any registered provider key variables from config
 * 5. Adds any specified additional variables
 *
 * Windows system variables (LOCALAPPDATA, USERPROFILE, PATH, SystemRoot, etc.)
 * are preserved.
 *
 * @param options - Filter options
 * @returns Filtered environment object
 */
export function createFilteredChildEnv(options: ChildEnvFilterOptions): NodeJS.ProcessEnv {
  const { baseEnv, registeredKeyVars = [], additions = {} } = options;

  // Create a new environment object (shallow copy)
  const filtered: NodeJS.ProcessEnv = {};

  // Build a set of variable names to remove (all uppercase for case-insensitive matching)
  const removeSet = new Set<string>();

  // Add built-in provider key names
  for (const name of BUILT_IN_PROVIDER_KEY_NAMES) {
    removeSet.add(name.toUpperCase());
  }

  // Add registered provider key names
  for (const name of registeredKeyVars) {
    removeSet.add(name.toUpperCase());
  }

  // Copy environment, filtering out secrets
  for (const [key, value] of Object.entries(baseEnv)) {
    // Skip if explicitly in remove set
    if (removeSet.has(key.toUpperCase())) {
      continue;
    }

    // Skip if starts with AI_PROVIDER_ (case-insensitive)
    if (key.toUpperCase().startsWith(AI_PROVIDER_PREFIX)) {
      continue;
    }

    // Keep this variable
    filtered[key] = value;
  }

  // Add additional variables
  for (const [key, value] of Object.entries(additions)) {
    filtered[key] = value;
  }

  return filtered;
}

/**
 * Create a filtered environment using a secret resolution context.
 *
 * Convenience function that extracts registered key vars from context.
 *
 * @param baseEnv - Base environment to filter
 * @param context - Secret resolution context
 * @param additions - Additional variables to add
 * @returns Filtered environment
 */
export function createFilteredChildEnvFromContext(
  baseEnv: NodeJS.ProcessEnv,
  context: SecretResolutionContext,
  additions?: Record<string, string>
): NodeJS.ProcessEnv {
  return createFilteredChildEnv({
    baseEnv,
    registeredKeyVars: context.registeredKeyVars,
    additions,
  });
}

/**
 * Get list of variable names that would be removed by filtering.
 *
 * Useful for diagnostics (the names are safe to log, not the values).
 *
 * @param baseEnv - Environment to analyze
 * @param registeredKeyVars - Additional registered key variable names
 * @returns List of variable names that would be removed
 */
export function getFilteredVariableNames(
  baseEnv: NodeJS.ProcessEnv,
  registeredKeyVars: readonly string[] = []
): readonly string[] {
  const removed: string[] = [];

  // Build remove set
  const removeSet = new Set<string>();
  for (const name of BUILT_IN_PROVIDER_KEY_NAMES) {
    removeSet.add(name.toUpperCase());
  }
  for (const name of registeredKeyVars) {
    removeSet.add(name.toUpperCase());
  }

  for (const key of Object.keys(baseEnv)) {
    // Check explicit removal
    if (removeSet.has(key.toUpperCase())) {
      removed.push(key);
      continue;
    }

    // Check prefix
    if (key.toUpperCase().startsWith(AI_PROVIDER_PREFIX)) {
      removed.push(key);
    }
  }

  return removed;
}

/**
 * Verify that required Windows variables are preserved.
 *
 * Returns list of missing critical variables (empty if all present).
 *
 * @param env - Environment to check
 * @returns List of missing critical variable names
 */
export function checkPreservedWindowsVariables(env: NodeJS.ProcessEnv): readonly string[] {
  // Critical Windows variables that should be preserved
  const criticalVars = [
    'PATH',
    'SystemRoot',
    'TEMP',
    'TMP',
  ];

  // Note: Additional Windows variables (LOCALAPPDATA, USERPROFILE, etc.)
  // are nice-to-have but not critical for test execution.

  const missing: string[] = [];

  for (const name of criticalVars) {
    if (!env[name]) {
      missing.push(name);
    }
  }

  return missing;
}
