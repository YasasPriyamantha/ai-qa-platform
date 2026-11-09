/**
 * Integration tests for the Playwright runner
 *
 * These tests launch actual Playwright processes and require increased timeouts.
 * Each test has a 60-second timeout instead of the default 5 seconds.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runPlaywrightTests } from '../../../src/test-execution/runner.js';
import { loadProjectConfig } from '../../../src/projects/loader.js';

// Timeout for integration tests that launch Playwright processes
const INTEGRATION_TIMEOUT = 60000;

describe('runPlaywrightTests', () => {
  const fixturesBase = resolve(process.cwd(), 'tests/fixtures/runner-projects');

  // Clean up artifact directories after each test
  afterEach(() => {
    ['passing', 'failing', 'no-tests'].forEach((fixture) => {
      const artifactDir = join(fixturesBase, fixture, 'artifacts');
      if (existsSync(artifactDir)) {
        rmSync(artifactDir, { recursive: true, force: true });
      }
    });
  });

  it('should execute passing fixture and report success', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const configPath = resolve(fixturesBase, 'passing/project.config.json');
    const config = loadProjectConfig(configPath);

    const result = await runPlaywrightTests(config);

    // Verify run metadata
    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/);
    expect(result.projectId).toBe('fixture-passing');
    expect(result.runDirectory).toContain(result.runId);

    // Verify run directory was created
    expect(existsSync(result.runDirectory)).toBe(true);

    // Verify process result
    expect(result.processResult.exitCode).toBe(0);
    expect(result.processResult.signal).toBeNull();
    expect(result.processResult.stdout).toBeTruthy();
    expect(result.processResult.duration).toBeGreaterThan(0);

    // Verify timestamps
    expect(result.processResult.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.processResult.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should execute failing fixture and report non-zero exit', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const configPath = resolve(fixturesBase, 'failing/project.config.json');
    const config = loadProjectConfig(configPath);

    const result = await runPlaywrightTests(config);

    // Verify run metadata
    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/);
    expect(result.projectId).toBe('fixture-failing');

    // Verify process exited with non-zero code (test failure)
    expect(result.processResult.exitCode).not.toBe(0);
    expect(result.processResult.signal).toBeNull();

    // Verify output contains failure evidence
    const output = result.processResult.stdout + result.processResult.stderr;
    expect(output).toContain('failing.spec.ts');

    // Run directory should exist
    expect(existsSync(result.runDirectory)).toBe(true);
  });

  it('should execute no-tests fixture and report non-zero exit', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const configPath = resolve(fixturesBase, 'no-tests/project.config.json');
    const config = loadProjectConfig(configPath);

    const result = await runPlaywrightTests(config);

    // Verify run metadata
    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/);
    expect(result.projectId).toBe('fixture-no-tests');

    // No tests discovered should result in non-zero exit
    // Playwright exits with 1 when no tests are found (without --pass-with-no-tests)
    expect(result.processResult.exitCode).not.toBe(0);

    // Output should indicate no tests found
    const output = result.processResult.stdout + result.processResult.stderr;
    expect(output.toLowerCase()).toMatch(/no tests? found|0 passed/);

    // Run directory should exist
    expect(existsSync(result.runDirectory)).toBe(true);
  });

  it('should create unique run directories for successive runs', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const configPath = resolve(fixturesBase, 'passing/project.config.json');
    const config = loadProjectConfig(configPath);

    // Run twice rapidly
    const result1 = await runPlaywrightTests(config);
    const result2 = await runPlaywrightTests(config);

    // Should have different run IDs
    expect(result1.runId).not.toBe(result2.runId);

    // Both directories should exist
    expect(existsSync(result1.runDirectory)).toBe(true);
    expect(existsSync(result2.runDirectory)).toBe(true);

    // Artifact directory should contain both runs
    const artifactDir = config.resolvedArtifactDirectory;
    const runs = readdirSync(artifactDir);
    expect(runs).toContain(result1.runId);
    expect(runs).toContain(result2.runId);
  });

  it('should never overwrite a previous run directory', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const configPath = resolve(fixturesBase, 'passing/project.config.json');
    const config = loadProjectConfig(configPath);

    const result1 = await runPlaywrightTests(config);

    // Record contents of first run
    const firstRunContents = existsSync(result1.runDirectory)
      ? readdirSync(result1.runDirectory)
      : [];

    const result2 = await runPlaywrightTests(config);

    // Second run should have different ID
    expect(result2.runId).not.toBe(result1.runId);

    // First run directory should still exist and be unchanged
    expect(existsSync(result1.runDirectory)).toBe(true);
    const currentFirstRunContents = readdirSync(result1.runDirectory);
    expect(currentFirstRunContents).toEqual(firstRunContents);
  });

  it('should capture stdout and stderr from process', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const configPath = resolve(fixturesBase, 'passing/project.config.json');
    const config = loadProjectConfig(configPath);

    const result = await runPlaywrightTests(config);

    // Stdout should contain Playwright's test summary
    expect(result.processResult.stdout).toBeTruthy();
    expect(result.processResult.stdout.length).toBeGreaterThan(0);

    // Should mention the test file or results
    const output = result.processResult.stdout + result.processResult.stderr;
    expect(output).toMatch(/passing\.spec\.ts|passed|test/i);
  });

  it('should record process start and end times', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const configPath = resolve(fixturesBase, 'passing/project.config.json');
    const config = loadProjectConfig(configPath);

    const result = await runPlaywrightTests(config);

    // Start and end times should be valid ISO 8601 timestamps
    const startDate = new Date(result.processResult.startTime);
    const endDate = new Date(result.processResult.endTime);

    expect(startDate.getTime()).toBeGreaterThan(0);
    expect(endDate.getTime()).toBeGreaterThan(0);
    expect(endDate.getTime()).toBeGreaterThanOrEqual(startDate.getTime());

    // Duration should match the time difference
    const expectedDuration = endDate.getTime() - startDate.getTime();
    expect(result.processResult.duration).toBeGreaterThanOrEqual(0);
    expect(result.processResult.duration).toBeCloseTo(expectedDuration, -2); // Within 100ms
  });
});
