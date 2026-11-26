/**
 * Integration tests for the Playwright MCP connection (Task P1).
 * Starts real processes; runs locally, not in CI (DEC-039, §3.10).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlaywrightMcpLaunch, McpConnection, McpStartError } from '../../../src/mcp/playwright-mcp.js';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** All descendant PIDs of `root` (server, and any browser it started). */
function descendants(root: number): number[] {
  const table = process.platform === 'win32'
    ? execFileSync('powershell.exe', ['-NoProfile', '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], { encoding: 'utf8' })
    : execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
  const pairs = table.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/).map(Number));
  const found: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const [pid, ppid] of pairs) {
      if (ppid === parent && !found.includes(pid)) { found.push(pid); queue.push(pid); }
    }
  }
  return found;
}

let outputDir: string;
beforeEach(async () => { outputDir = await mkdtemp(join(tmpdir(), 'qa-mcp-it-')); });
afterEach(async () => { await rm(outputDir, { recursive: true, force: true }); });

function nodeLaunch(script: string) {
  return { command: process.execPath, args: ['-e', script], env: process.env, cwd: outputDir };
}

describe('McpConnection (real Playwright MCP server)', () => {
  it('connects, lists the tools, closes, and leaves no process behind', async () => {
    const connection = await McpConnection.connect(
      buildPlaywrightMcpLaunch({ allowedDomains: ['www.saucedemo.com'], outputDir, baseEnv: process.env })
    );
    const pid = connection.pid!;
    expect(isAlive(pid)).toBe(true);

    expect(connection.serverVersion?.name).toBeTruthy();
    const names = (await connection.listTools()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['browser_navigate', 'browser_snapshot', 'browser_navigate_back', 'browser_wait_for']));

    const children = descendants(pid);
    await connection.close();
    expect(isAlive(pid)).toBe(false);
    expect(children.filter(isAlive)).toEqual([]);
  }, 60_000);
});

describe('McpConnection start failures', () => {
  it('reports a server that exits during startup, with its exit code and output', async () => {
    const err = await McpConnection.connect(nodeLaunch("process.stderr.write('boom-startup'); process.exit(3)"))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpStartError);
    expect((err as Error).message).toMatch(/MCP server failed to start \(server exited with code 3\)/);
    expect((err as Error).message).toContain('boom-startup');
    expect(isAlive((err as McpStartError).pid!)).toBe(false);
  }, 30_000);

  it('stops a server that never answers the handshake within the startup timeout', async () => {
    const err = await McpConnection.connect(nodeLaunch('setInterval(() => {}, 1000)'), 1000)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpStartError);
    expect((err as Error).message).toMatch(/MCP server failed to start/);
    expect(isAlive((err as McpStartError).pid!)).toBe(false);
  }, 30_000);
});
