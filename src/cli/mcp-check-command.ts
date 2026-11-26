/**
 * mcp-check command (Task P1)
 *
 * Starts the platform's own Playwright MCP server for a project, prints the
 * server version and its tools, and closes it. Makes no AI call and calls no
 * tool, so no browser is started.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadPhase2ProjectConfig, ConfigValidationError } from '../projects/index.js';
import { buildPlaywrightMcpLaunch, McpConnection } from '../mcp/playwright-mcp.js';
import { displayError } from './output.js';
import { EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';

export async function executeMcpCheckCommand(configPath: string): Promise<number> {
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), configPath));
  } catch (err) {
    const title = err instanceof ConfigValidationError ? 'Invalid project configuration' : 'Cannot load project configuration';
    displayError(title, (err as Error).message);
    return EXIT_FAILURE;
  }

  // No exploration exists yet, so the server's output directory is a temporary one.
  const outputDir = await mkdtemp(join(tmpdir(), 'qa-mcp-check-'));
  try {
    const connection = await McpConnection.connect(
      buildPlaywrightMcpLaunch({ allowedDomains: config.allowedDomains, outputDir, baseEnv: process.env })
    );
    try {
      const server = connection.serverVersion;
      const tools = await connection.listTools();
      console.log(`Project:        ${config.projectId}`);
      console.log(`MCP server:     ${server ? `${server.name} ${server.version}` : 'unknown'}`);
      console.log(`Tools (${tools.length}):`);
      for (const tool of tools) console.log(`  - ${tool.name}`);
    } finally {
      await connection.close();
    }
    console.log('MCP server closed.');
    return EXIT_SUCCESS;
  } catch (err) {
    displayError('MCP check failed', (err as Error).message);
    return EXIT_FAILURE;
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}
