/**
 * CLI argument parsing
 *
 * Parses command-line arguments for the QA platform CLI.
 * Keeps parsing logic separate from command execution.
 */

/**
 * Supported CLI commands.
 */
export type Command = 'run' | 'help';

/**
 * Parsed CLI arguments.
 */
export interface ParsedArgs {
  /** The command to execute */
  command: Command;

  /** Options for the run command */
  runOptions?: {
    /** Path to the project configuration file */
    configPath: string;
  };

  /** Parse errors encountered */
  errors: string[];
}

/**
 * Parse CLI arguments.
 *
 * Expected usage:
 *   npm run qa -- run --config <project-config-path>
 *   npm run qa -- help
 *
 * @param args - Command line arguments (typically process.argv.slice(2))
 * @returns Parsed arguments with any validation errors
 */
export function parseArgs(args: string[]): ParsedArgs {
  // No arguments provided
  if (args.length === 0) {
    return {
      command: 'help',
      errors: ['No command specified'],
    };
  }

  const command = args[0];

  // Help command
  if (command === 'help' || command === '--help' || command === '-h') {
    return {
      command: 'help',
      errors: [],
    };
  }

  // Run command
  if (command === 'run') {
    return parseRunArgs(args.slice(1));
  }

  // Unknown command
  return {
    command: 'help',
    errors: [`Unknown command: ${command}`],
  };
}

/**
 * Parse arguments for the run command.
 */
function parseRunArgs(args: string[]): ParsedArgs {
  const errors: string[] = [];
  let configPath: string | undefined;

  // Parse --config option
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--config' || arg === '-c') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        errors.push('--config requires a path argument');
      } else {
        configPath = value;
        i++; // Skip the value
      }
    } else if (arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
      if (!configPath) {
        errors.push('--config requires a path argument');
      }
    } else if (arg.startsWith('-c=')) {
      configPath = arg.slice('-c='.length);
      if (!configPath) {
        errors.push('--config requires a path argument');
      }
    } else if (arg.startsWith('-')) {
      errors.push(`Unknown option: ${arg}`);
    } else {
      errors.push(`Unexpected argument: ${arg}`);
    }
  }

  // Validate required options
  if (!configPath && errors.length === 0) {
    errors.push('Missing required option: --config <project-config-path>');
  }

  if (errors.length > 0) {
    return {
      command: 'run',
      errors,
    };
  }

  return {
    command: 'run',
    runOptions: {
      configPath: configPath!,
    },
    errors: [],
  };
}

/**
 * Get CLI help text.
 */
export function getHelpText(): string {
  return `
AI QA Automation Platform - Phase 1 CLI

Usage:
  npm run qa -- run --config <project-config-path>
  npm run qa -- help

Commands:
  run     Execute tests for a configured project
  help    Show this help message

Run Command Options:
  --config, -c <path>   Path to the project configuration file (required)
                        Example: project-data/saucedemo/project.config.json

Examples:
  npm run qa -- run --config project-data/saucedemo/project.config.json
  npm run qa -- run -c ./tests/fixtures/runner-projects/passing/project.config.json

Exit Codes:
  0   All tests passed (PROVISIONAL until report parsing is implemented)
  1   Tests failed, configuration error, or execution error

Note: Results are labeled PROVISIONAL until Task 1.7 implements report parsing.
`.trim();
}
