/**
 * Unit tests for the Playwright MCP launch (Task P1). No process is started.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPlaywrightMcpLaunch } from '../../../src/mcp/playwright-mcp.js';

const outputDir = join(tmpdir(), 'qa-mcp-unit');

describe('buildPlaywrightMcpLaunch', () => {
  it('runs the installed Playwright MCP CLI with Node and the required browser settings', () => {
    const launch = buildPlaywrightMcpLaunch({ allowedDomains: ['www.saucedemo.com'], outputDir, baseEnv: {} });

    expect(launch.command).toBe(process.execPath);
    const [cli, ...flags] = launch.args;
    expect(basename(cli)).toBe('cli.js');
    expect(cli).toContain(join('@playwright', 'mcp'));
    expect(existsSync(cli)).toBe(true);
    expect(flags).toEqual([
      '--headless',
      '--isolated',
      '--browser', 'chromium',
      '--image-responses', 'omit',
      '--allowed-origins', 'https://www.saucedemo.com',
      '--output-dir', outputDir,
    ]);
    expect(launch.cwd).toBe(outputDir);
  });

  it('allows HTTP only for localhost in --allowed-origins', () => {
    const launch = buildPlaywrightMcpLaunch({ allowedDomains: ['localhost', 'example.com'], outputDir, baseEnv: {} });
    const value = launch.args[launch.args.indexOf('--allowed-origins') + 1];
    expect(value).toBe('http://localhost:*;https://localhost:*;https://example.com');
  });

  it('removes provider API keys from the child environment and keeps other variables', () => {
    const launch = buildPlaywrightMcpLaunch({
      allowedDomains: ['www.saucedemo.com'],
      outputDir,
      baseEnv: {
        PATH: '/usr/bin',
        OPENAI_API_KEY: 'sk-sentinel-openai',
        ANTHROPIC_API_KEY: 'sentinel-anthropic',
        GEMINI_API_KEY: 'sentinel-gemini',
        ai_provider_custom_key: 'sentinel-custom',
      },
    });

    expect(launch.env).toEqual({ PATH: '/usr/bin' });
    expect(JSON.stringify(launch)).not.toContain('sentinel');
  });
});
