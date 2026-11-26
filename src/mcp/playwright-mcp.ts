/**
 * Playwright MCP connection (Task P1, DEC-040).
 *
 * Starts the pinned @playwright/mcp server from the platform's own
 * dependencies (never npx, never an IDE MCP configuration) and connects the
 * official MCP client SDK to it over stdio.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Client, type Tool } from '@modelcontextprotocol/client';
import { createFilteredChildEnv } from '../provider-secrets/child-env-filter.js';
import { VERSION } from '../application/version.js';
import { StdioProcessTransport, type StdioLaunch } from './stdio-transport.js';

/** Default time allowed for the server to start and answer `initialize`. */
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;

/** Absolute path of the installed Playwright MCP CLI entry. */
function playwrightMcpCliPath(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
}

/**
 * Playwright MCP `--allowed-origins` value from the project's allowedDomains.
 * HTTPS only, except `localhost`, which may use HTTP on any port (DEC-015).
 * Extra protection only: the server documents that it is not a security
 * boundary and does not affect redirects.
 */
function allowedOrigins(allowedDomains: readonly string[]): string {
  return allowedDomains
    .flatMap((host) =>
      host === 'localhost' ? ['http://localhost:*', 'https://localhost:*'] : [`https://${host}`]
    )
    .join(';');
}

/**
 * Build the server launch: Node plus the CLI entry, an argument array, the
 * filtered environment (no provider keys), headless, isolated in-memory
 * profile, bundled Chromium, no image responses, allowed origins, and the
 * output directory, which is also the server's working directory (its file
 * access root).
 */
export function buildPlaywrightMcpLaunch(options: {
  readonly allowedDomains: readonly string[];
  readonly outputDir: string;
  readonly baseEnv: NodeJS.ProcessEnv;
}): StdioLaunch {
  return {
    command: process.execPath,
    args: [
      playwrightMcpCliPath(),
      '--headless',
      '--isolated',
      '--browser', 'chromium',
      '--image-responses', 'omit',
      '--allowed-origins', allowedOrigins(options.allowedDomains),
      '--output-dir', options.outputDir,
    ],
    env: createFilteredChildEnv({ baseEnv: options.baseEnv }),
    cwd: options.outputDir,
  };
}

/** The MCP server did not start; its process has been stopped. */
export class McpStartError extends Error {
  constructor(message: string, readonly pid: number | undefined) {
    super(message);
    this.name = 'McpStartError';
  }
}

export class McpConnection {
  private constructor(
    private readonly client: Client,
    private readonly transport: StdioProcessTransport
  ) {}

  /**
   * Start the server and complete the MCP handshake. On any failure the
   * process is stopped and an McpStartError with exit code and stderr is
   * thrown.
   */
  static async connect(
    launch: StdioLaunch,
    startupTimeoutMs: number = DEFAULT_STARTUP_TIMEOUT_MS
  ): Promise<McpConnection> {
    const transport = new StdioProcessTransport(launch);
    const client = new Client({ name: 'ai-qa-platform', version: VERSION });
    try {
      await client.connect(transport, { timeout: startupTimeoutMs });
      return new McpConnection(client, transport);
    } catch (err) {
      await transport.close().catch(() => undefined);
      const exit = transport.exitCode !== null ? ` (server exited with code ${transport.exitCode})` : '';
      const stderr = transport.stderrTail ? `\nServer output: ${transport.stderrTail}` : '';
      throw new McpStartError(
        `MCP server failed to start${exit}: ${(err as Error).message}${stderr}`,
        transport.pid
      );
    }
  }

  /** PID of the server process. */
  get pid(): number | undefined {
    return this.transport.pid;
  }

  /** Server name and version as reported in the handshake. */
  get serverVersion(): { name: string; version: string } | undefined {
    const info = this.client.getServerVersion();
    return info ? { name: info.name, version: info.version } : undefined;
  }

  /** All tools the server offers (all pages). */
  async listTools(): Promise<Tool[]> {
    return (await this.client.listTools()).tools;
  }

  /** Close the session and stop the server and its browser processes. */
  async close(): Promise<void> {
    try {
      await this.client.close();
    } finally {
      await this.transport.close();
    }
  }
}
