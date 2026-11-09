/**
 * Playwright CLI resolution
 *
 * Resolves the installed Playwright Test CLI entry point from package metadata.
 * Does not hardcode or guess node_modules paths.
 */

import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';

/**
 * Resolve the absolute path to the Playwright CLI entry point.
 *
 * Uses Node's module resolution to find the installed @playwright/test package
 * and returns the path to its CLI script.
 *
 * @returns Absolute path to the Playwright CLI (cli.js)
 * @throws Error if @playwright/test is not installed or CLI cannot be resolved
 */
export function resolvePlaywrightCli(): string {
  try {
    // Create a require function from the current module context
    // This allows us to use require.resolve in an ESM module
    const require = createRequire(import.meta.url);

    // Resolve the @playwright/test package.json
    const packageJsonPath = require.resolve('@playwright/test/package.json');

    // The CLI is at cli.js in the same directory as package.json
    const packageDir = dirname(packageJsonPath);
    const cliPath = join(packageDir, 'cli.js');

    return cliPath;
  } catch (err) {
    throw new Error(
      `Failed to resolve Playwright CLI: ${(err as Error).message}. ` +
      `Ensure @playwright/test is installed.`
    );
  }
}
