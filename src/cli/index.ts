#!/usr/bin/env node

/**
 * CLI entry point for the AI QA Automation Platform
 *
 * Supports the following commands:
 *   npm run qa -- run --config <project-config-path> [--release <id>]
 *   npm run qa -- ai-check [--live]
 *   npm run qa -- mcp-check --config <project-config-path>
 *   npm run qa -- explore --config <project-config-path> [--start <url>] [--requirement <ID>[,…]]
 *   npm run qa -- requirements import|list --config <project-config-path> [--document <documentId>]
 *   npm run qa -- requirements propose --config <project-config-path> --document <documentId>
 *   npm run qa -- requirements review --config <project-config-path> --proposal <id> [--accept <IDs>] [--reject <IDs>]
 *   npm run qa -- plan --config <project-config-path> --requirements <ID>[,…] --observations <exploration-id>[,…]
 *   npm run qa -- generate --config <project-config-path> --plan <plan-id> [--replace]
 *   npm run qa -- validate --config <project-config-path> --plan <plan-id> [--scenario <SCN-…>[,…]]
 *   npm run qa -- approve --config <project-config-path> --scenario <SCN-…>[,…] --reviewer <name>
 *   npm run qa -- reject --config <project-config-path> --scenario <SCN-…>[,…] --reviewer <name> --reason <text>
 *   npm run qa -- release create --config <project-config-path> --release <id>
 *   npm run qa -- release review --config <project-config-path> --release <id> --reviewer <name> --reason <text> (--requirement <IDs> --confirm | --scenario <IDs> --keep|--retire)
 *   npm run qa -- release report --config <project-config-path> --release <id>
 *   npm run qa -- help
 *
 * Results are labeled PROVISIONAL until Task 1.7 implements report parsing.
 */

import { parseArgs, getHelpText } from './args.js';
import { executeRunCommand, EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';
import { executeAiCheckCommand } from './ai-check-command.js';
import { executeMcpCheckCommand } from './mcp-check-command.js';
import { executeExploreCommand } from './explore-command.js';
import { executeRequirementsCommand } from './requirements-command.js';
import { executeProposeCommand, executeReviewCommand } from './proposal-command.js';
import { executePlanCommand } from './plan-command.js';
import { executeGenerateCommand } from './generate-command.js';
import { executeValidateCommand } from './validate-command.js';
import { executeApproveCommand, executeRejectCommand } from './approve-command.js';
import { executeReleaseCreateCommand, executeReleaseReviewCommand, executeReleaseReportCommand } from './release-command.js';

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

      const exitCode = await executeRunCommand(parsed.runOptions.configPath, process.cwd(), parsed.runOptions.releaseId);
      process.exit(exitCode);
      break;

    case 'ai-check':
      process.exit(await executeAiCheckCommand({ live: parsed.aiCheckOptions?.live ?? false }));
      break;

    case 'mcp-check':
      process.exit(await executeMcpCheckCommand(parsed.mcpCheckOptions!.configPath));
      break;

    case 'explore':
      process.exit(await executeExploreCommand(parsed.exploreOptions!));
      break;

    case 'requirements': {
      const options = parsed.requirementsOptions!;
      if (options.action === 'propose') process.exit(await executeProposeCommand(options));
      else if (options.action === 'review') process.exit(executeReviewCommand(options));
      else process.exit(executeRequirementsCommand(options));
      break;
    }

    case 'plan':
      process.exit(await executePlanCommand(parsed.planOptions!));
      break;

    case 'generate':
      process.exit(executeGenerateCommand(parsed.generateOptions!));
      break;

    case 'validate':
      process.exit(await executeValidateCommand(parsed.validateOptions!));
      break;

    case 'approve':
      process.exit(executeApproveCommand(parsed.decisionOptions!));
      break;

    case 'reject':
      process.exit(executeRejectCommand(parsed.decisionOptions!));
      break;

    case 'release': {
      const options = parsed.releaseOptions!;
      if (options.action === 'review') process.exit(executeReleaseReviewCommand(options));
      else process.exit(options.action === 'report' ? executeReleaseReportCommand(options) : executeReleaseCreateCommand(options));
      break;
    }

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
