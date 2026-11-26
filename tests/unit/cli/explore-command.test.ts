/**
 * Unit tests for the explore command's refusals (Task P4).
 *
 * Each refusal happens before the MCP server is started: no exploration folder
 * is created and the adapter is never called.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeExploreCommand } from '../../../src/cli/explore-command.js';
import { globalAdapterRegistry, type ProviderAdapter } from '../../../src/model-providers/index.js';

describe('executeExploreCommand refusals', () => {
  let root: string;
  let configPath: string;
  let errors: string;
  const adapter = { adapterType: 'openai-responses', displayName: 'Never called', execute: vi.fn() } as unknown as ProviderAdapter;

  beforeEach(() => {
    root = join(tmpdir(), `qa-explore-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, 'config'), { recursive: true });
    mkdirSync(join(root, 'project', 'tests', 'approved'), { recursive: true });
    copyFileSync(join(process.cwd(), 'config', 'ai-providers.json'), join(root, 'config', 'ai-providers.json'));
    copyFileSync(join(process.cwd(), 'config', 'ai-budget.example.json'), join(root, 'config', 'ai-budget.json'));
    configPath = join(root, 'project', 'project.config.json');
    writeFileSync(configPath, JSON.stringify({
      projectId: 'demo', name: 'Demo', baseUrl: 'https://www.example.com/', environment: 'demo',
      allowedDomains: ['www.example.com'], testDirectory: 'tests/approved', artifactDirectory: 'artifacts',
    }));
    errors = '';
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors += args.join(' ') + '\n'; });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalAdapterRegistry.clear();
    rmSync(root, { recursive: true, force: true });
  });

  const explore = (startUrl?: string) => executeExploreCommand({ configPath, rootDir: root, adapter, ...(startUrl ? { startUrl } : {}) });
  const expectNothingStarted = () => {
    expect(existsSync(join(root, 'project', 'observations'))).toBe(false);
    expect(adapter.execute).not.toHaveBeenCalled();
  };

  it('refuses when AI is disabled, the key is missing or the budget is missing', async () => {
    writeFileSync(join(root, '.env'), 'AI_ENABLED=false\nOPENAI_API_KEY=sk-test-explore\n');
    expect(await explore()).toBe(1);
    expect(errors).toMatch(/Exploration refused: AI is disabled/);

    writeFileSync(join(root, '.env'), 'AI_ENABLED=true\n');
    expect(await explore()).toBe(1);
    expect(errors).toMatch(/Exploration refused: API key missing/);

    writeFileSync(join(root, '.env'), 'AI_ENABLED=true\nOPENAI_API_KEY=sk-test-explore\n');
    rmSync(join(root, 'config', 'ai-budget.json'));
    expect(await explore()).toBe(1);
    expect(errors).toMatch(/Exploration refused: no valid budget/);
    expectNothingStarted();
  });

  it('refuses a --start URL that fails the domain rule', async () => {
    writeFileSync(join(root, '.env'), 'AI_ENABLED=true\nOPENAI_API_KEY=sk-test-explore\n');
    expect(await explore('https://evil.example/')).toBe(1);
    expect(errors).toMatch(/Exploration refused: start URL is not allowed.*not in allowedDomains/s);
    expect(await explore('http://www.example.com/')).toBe(1);
    expect(errors).toMatch(/HTTP is only allowed for localhost/);
    expectNothingStarted();
  });
});
