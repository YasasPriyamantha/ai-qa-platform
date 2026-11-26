/**
 * CLI argument parsing
 *
 * Parses command-line arguments for the QA platform CLI.
 * Keeps parsing logic separate from command execution.
 */

/**
 * Supported CLI commands.
 */
export type Command = 'run' | 'ai-check' | 'mcp-check' | 'explore' | 'help';

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

  /** Options for the ai-check command */
  aiCheckOptions?: {
    /** Send one live request */
    live: boolean;
  };

  /** Options for the mcp-check command */
  mcpCheckOptions?: {
    /** Path to the project configuration file */
    configPath: string;
  };

  /** Options for the explore command */
  exploreOptions?: {
    /** Path to the project configuration file */
    configPath: string;
    /** Start page instead of the project's baseUrl */
    startUrl?: string;
  };

  /** Parse errors encountered */
  errors: string[];
}

/**
 * Parse CLI arguments.
 *
 * Expected usage:
 *   npm run qa -- run --config <project-config-path>
 *   npm run qa -- ai-check [--live]
 *   npm run qa -- mcp-check --config <project-config-path>
 *   npm run qa -- explore --config <project-config-path> [--start <url>]
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

  // ai-check command
  if (command === 'ai-check') {
    return parseAiCheckArgs(args.slice(1));
  }

  // mcp-check command: same --config option as run
  if (command === 'mcp-check') {
    const parsed = parseRunArgs(args.slice(1));
    return { command: 'mcp-check', mcpCheckOptions: parsed.runOptions, errors: parsed.errors };
  }

  // explore command: --config as for run, plus an optional --start <url>
  if (command === 'explore') {
    const rest = args.slice(1);
    const startAt = rest.indexOf('--start');
    let startUrl: string | undefined;
    if (startAt !== -1) {
      startUrl = rest[startAt + 1];
      rest.splice(startAt, 2);
      if (!startUrl || startUrl.startsWith('-')) {
        return { command: 'explore', errors: ['--start requires a URL argument'] };
      }
    }
    const parsed = parseRunArgs(rest);
    if (!parsed.runOptions) return { command: 'explore', errors: parsed.errors };
    return { command: 'explore', exploreOptions: { ...parsed.runOptions, ...(startUrl ? { startUrl } : {}) }, errors: [] };
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
 * Parse arguments for the ai-check command.
 */
function parseAiCheckArgs(args: string[]): ParsedArgs {
  const errors: string[] = [];
  let live = false;

  for (const arg of args) {
    if (arg === '--live') {
      live = true;
    } else if (arg.startsWith('-')) {
      errors.push(`Unknown option: ${arg}`);
    } else {
      errors.push(`Unexpected argument: ${arg}`);
    }
  }

  if (errors.length > 0) {
    return { command: 'ai-check', errors };
  }

  return { command: 'ai-check', aiCheckOptions: { live }, errors: [] };
}

/**
 * Get CLI help text.
 */
export function getHelpText(): string {
  return `
AI QA Automation Platform - Phase 1 CLI

Usage:
  npm run qa -- run --config <project-config-path>
  npm run qa -- ai-check [--live]
  npm run qa -- mcp-check --config <project-config-path>
  npm run qa -- explore --config <project-config-path> [--start <url>]
  npm run qa -- help

Commands:
  run        Execute tests for a configured project
  ai-check   Show AI provider, key and budget status (no network call)
  mcp-check  Start the platform's Playwright MCP server, list its tools, close it
  explore    Let the AI model explore the site read-only and save observations
  help       Show this help message

Run Command Options:
  --config, -c <path>   Path to the project configuration file (required)
                        Example: project-data/saucedemo/project.config.json

mcp-check Options:
  --config, -c <path>   Path to the project configuration file (required)

explore Options:
  --config, -c <path>   Path to the project configuration file (required)
  --start <url>         Start page (default: the project's baseUrl); must be
                        in allowedDomains. Requires AI_ENABLED=true, the API
                        key in .env and config/ai-budget.json.

ai-check Options:
  --live                Send one bounded request to the configured provider.
                        Requires AI_ENABLED=true, the API key in .env and
                        config/ai-budget.json.

Examples:
  npm run qa -- run --config project-data/saucedemo/project.config.json
  npm run qa -- run -c ./tests/fixtures/runner-projects/passing/project.config.json

Exit Codes:
  0   All tests passed (PROVISIONAL until report parsing is implemented)
  1   Tests failed, configuration error, or execution error

Note: Results are labeled PROVISIONAL until Task 1.7 implements report parsing.
`.trim();
}
