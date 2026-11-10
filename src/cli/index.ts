#!/usr/bin/env node

/**
 * CLI entry point for the AI QA Automation Platform
 *
 * Supports the following commands:
 *   npm run qa -- run --config <project-config-path>
 *   npm run qa -- help
 *
 * Results are labeled PROVISIONAL until Task 1.7 implements report parsing.
 */

import { parseArgs, getHelpText } from './args.js';
import { executeRunCommand, EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';

/**
 * Main CLI entry point.
 */
async function main(): Promise<void> {
  // Parse command-line arguments (skip node and script path)
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  // Handle parse errors
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      console.error(`Error: ${error}`);
    }
    console.error('');
    console.error(getHelpText());
    process.exit(EXIT_FAILURE);
  }

  // Execute command
  switch (parsed.command) {
    case 'help':
      console.log(getHelpText());
      process.exit(EXIT_SUCCESS);
      break;

    case 'run':
      if (!parsed.runOptions) {
        console.error('Error: Missing run options');
        console.error(getHelpText());
        process.exit(EXIT_FAILURE);
        return;
      }

      const exitCode = await executeRunCommand(parsed.runOptions.configPath);
      process.exit(exitCode);
      break;

    default:
      // Should not reach here due to parseArgs validation
      console.error('Error: Unknown command');
      console.error(getHelpText());
      process.exit(EXIT_FAILURE);
  }
}

// Run main and handle top-level errors
main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(EXIT_FAILURE);
});
