/**
 * Environment file parser.
 *
 * Task 3.3: Parse .env file without mutating process.env.
 *
 * Uses Node.js built-in util.parseEnv (available in Node 20.12.0+)
 * which returns a separate object without side effects.
 */

import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import type { ParsedEnvFile } from './types.js';

/**
 * Default .env file path relative to current working directory.
 */
export const DEFAULT_ENV_PATH = '.env';

/**
 * Parse a .env file without mutating process.env.
 *
 * Uses Node.js built-in util.parseEnv which:
 * - Returns a new object with parsed key-value pairs
 * - Does NOT modify process.env
 * - Handles comments, quotes, and multiline values
 *
 * @param filePath - Path to the .env file (default: '.env' in cwd)
 * @returns Parsed environment values (never mutates global state)
 */
export function parseEnvFile(filePath: string = DEFAULT_ENV_PATH): ParsedEnvFile {
  // Check if file exists
  if (!existsSync(filePath)) {
    return {
      values: {},
      success: false,
      error: `Environment file not found: ${filePath}`,
      filePath,
    };
  }

  try {
    // Read file content
    const content = readFileSync(filePath, 'utf-8');

    // Parse using Node.js built-in util.parseEnv
    // This returns a plain object without modifying process.env
    const parsed = parseEnv(content);

    // Filter out undefined values (parseEnv may return them in some cases)
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== undefined) {
        values[key] = value;
      }
    }

    return {
      values: Object.freeze(values),
      success: true,
      filePath,
    };
  } catch (err) {
    return {
      values: {},
      success: false,
      error: `Failed to parse environment file: ${(err as Error).message}`,
      filePath,
    };
  }
}

/**
 * Fixed environment variable name for the AI enable flag.
 *
 * Per Task 3.3 security requirements:
 * - The enable variable is fixed in code as AI_ENABLED
 * - It is NOT configurable through tracked provider configuration
 * - This prevents configuration from redirecting the enable flag
 */
export const AI_ENABLED_VAR = 'AI_ENABLED';

/**
 * Check if the AI_ENABLED flag is set to exactly "true".
 *
 * Per Task 3.3 security requirements:
 * - Only the exact parsed value "true" (case-sensitive) enables provider calls
 * - Missing, empty, whitespace-only, malformed, "TRUE", "yes", "1", "false"
 *   and all other values leave provider calls disabled
 * - Key presence alone never enables inference
 *
 * @param envValues - Parsed environment values from .env file
 * @returns Whether AI is enabled with reason
 */
export function isAiEnabled(
  envValues: Readonly<Record<string, string>>
): { enabled: boolean; reason: string; rawValue?: string } {
  const value = envValues[AI_ENABLED_VAR];

  // Missing flag means disabled
  if (value === undefined) {
    return {
      enabled: false,
      reason: 'disabled-missing-flag',
    };
  }

  // Only the exact value "true" (case-sensitive) enables inference
  // Per Task 3.3: "Only the exact parsed value "true" enables provider calls"
  if (value === 'true') {
    return {
      enabled: true,
      reason: 'enabled-explicitly',
      rawValue: value,
    };
  }

  // "false" is an explicit disable
  if (value === 'false') {
    return {
      enabled: false,
      reason: 'disabled-explicitly',
      rawValue: value,
    };
  }

  // Empty or whitespace-only values mean disabled
  if (value.trim() === '') {
    return {
      enabled: false,
      reason: 'disabled-explicitly',
      rawValue: value,
    };
  }

  // Any other value (TRUE, Yes, 1, etc.) is malformed and disabled
  return {
    enabled: false,
    reason: 'disabled-malformed-flag',
    rawValue: value,
  };
}

/**
 * Known placeholder patterns that should be treated as missing credentials.
 *
 * Per Task 3.3: Treat empty values, whitespace-only values, and known
 * placeholder patterns as missing credentials. These values must never
 * count as usable API keys.
 */
const PLACEHOLDER_PATTERNS = [
  /^replace-with-/i,          // e.g., replace-with-your-openai-api-key
  /^your-.*-key$/i,           // e.g., your-api-key
  /^<.*>$/,                   // e.g., <your-key-here>
  /^\[.*\]$/,                 // e.g., [insert-key]
  /^xxx+$/i,                  // e.g., xxx, XXXX
  /^placeholder$/i,           // literal "placeholder"
  /^insert-/i,                // e.g., insert-your-key
  /^do-not-use/i,             // e.g., do-not-use-deprecated
] as const;

/**
 * Check if a value is a placeholder that should not be used.
 *
 * @param value - The value to check
 * @returns true if the value is a placeholder
 */
export function isPlaceholderValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') {
    return true;
  }
  return PLACEHOLDER_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Get a secret value from parsed environment.
 * Returns undefined if not found, empty, whitespace-only, or a placeholder.
 *
 * Per Task 3.3: A placeholder value must never count as a usable API key.
 *
 * @param envValues - Parsed environment values
 * @param varName - Environment variable name
 * @returns The value or undefined
 */
export function getEnvSecret(
  envValues: Readonly<Record<string, string>>,
  varName: string
): string | undefined {
  const value = envValues[varName];
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  // Check for placeholder patterns
  if (isPlaceholderValue(value)) {
    return undefined;
  }
  return value;
}

/**
 * Check if a legacy generic key is present.
 *
 * @param envValues - Parsed environment values
 * @returns Warning if legacy key detected, undefined otherwise
 */
export function checkLegacyGenericKey(
  envValues: Readonly<Record<string, string>>
): string | undefined {
  const legacyKey = 'AI_PROVIDER_API_KEY';
  if (envValues[legacyKey] !== undefined && envValues[legacyKey].trim() !== '') {
    return `Deprecated: ${legacyKey} is present but will not be used. ` +
      `Please migrate to provider-specific keys (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY) ` +
      `or custom provider keys (AI_PROVIDER_<PROVIDER_ID>_API_KEY).`;
  }
  return undefined;
}
