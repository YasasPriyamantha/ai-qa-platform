/**
 * Unit tests for Playwright CLI resolution
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolvePlaywrightCli } from '../../../src/test-execution/playwright-cli.js';

describe('resolvePlaywrightCli', () => {
  it('should resolve the Playwright CLI path', () => {
    const cliPath = resolvePlaywrightCli();

    // Should return an absolute path
    expect(cliPath).toBeTruthy();
    expect(cliPath).toMatch(/[/\\]cli\.js$/);

    // Path should exist
    expect(existsSync(cliPath)).toBe(true);
  });

  it('should resolve to the installed @playwright/test package', () => {
    const cliPath = resolvePlaywrightCli();

    // Should contain @playwright/test in the path
    expect(cliPath).toMatch(/node_modules.*@playwright.*test/);
  });

  it('should not hardcode node_modules path', () => {
    const cliPath = resolvePlaywrightCli();

    // Should resolve dynamically, not be a hardcoded string
    expect(cliPath).not.toBe('./node_modules/@playwright/test/cli.js');
    expect(cliPath).not.toBe('node_modules/@playwright/test/cli.js');

    // Should be absolute path
    expect(cliPath).toMatch(/^([A-Z]:[/\\]|\/)/);
  });
});
