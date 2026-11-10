/**
 * Integration tests for the Playwright runner
 *
 * These tests launch actual Playwright processes and require increased timeouts.
 * Each test has a deliberate timeout based on its expected duration.
 *
 * IMPORTANT: Tests only delete run directories they created, not entire artifacts folders.
 * This preserves historical runs and other test runs from being accidentally deleted.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, rmSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runPlaywrightTests } from '../../../src/test-execution/runner.js';
import { loadProjectConfig } from '../../../src/projects/loader.js';

// Timeout for standard integration tests that launch Playwright processes
const INTEGRATION_TIMEOUT = 60000;

// Runner timeout for hanging fixture test (30 seconds as per requirements)
const HANGING_RUNNER_TIMEOUT = 30000;

// Vitest timeout for hanging fixture test
// Must exceed: runner timeout + browser startup + cleanup margin
// 30s runner timeout + 15s startup margin + 15s cleanup margin = 60s
const HANGING_TEST_TIMEOUT = 60000;

describe('runPlaywrightTests', () => {
  const fixturesBase = resolve(process.cwd(), 'tests/fixtures/runner-projects');

  // Track run directories created by each test for targeted cleanup
  const createdRunDirectories: string[] = [];

  // Clean up ONLY the run directories created by this test, not entire artifacts folders
  // This preserves pre-existing run directories from manual runs or other tests
  afterEach(() => {
    for (const runDir of createdRunDirectories) {
      if (existsSync(runDir)) {
        rmSync(runDir, { recursive: true, force: true });
      }
    }
    // Clear the tracking array for next test
    createdRunDirectories.length = 0;
  });

  it('should execute passing fixture and report success', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const configPath = resolve(fixturesBase, 'passing/project.config.json');
    const config = loadProjectConfig(configPath);

    const result = await runPlaywrightTests(config);
    createdRunDirectories.push(result.runDirectory);

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
    expect(result.processResult.timedOut).toBe(false);

    // Verify timestamps
    expect(result.processResult.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.processResult.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should execute failing fixture and report non-zero exit', { timeout: INTEGRATION_TIMEOUT }, async () => {
    const configPath = resolve(fixturesBase, 'failing/project.config.json');
    const config = loadProjectConfig(configPath);

    const result = await runPlaywrightTests(config);
    createdRunDirectories.push(result.runDirectory);

    // Verify run metadata
    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/);
    expect(result.projectId).toBe('fixture-failing');

    // Verify process exited with non-zero code (test failure)
    expect(result.processResult.exitCode).not.toBe(0);
    expect(result.processResult.signal).toBeNull();
    expect(result.processResult.timedOut).toBe(false);

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
    createdRunDirectories.push(result.runDirectory);

    // Verify run metadata
    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/);
    expect(result.projectId).toBe('fixture-no-tests');

    // No tests discovered should result in non-zero exit
    // Playwright exits with 1 when no tests are found (without --pass-with-no-tests)
    expect(result.processResult.exitCode).not.toBe(0);
    expect(result.processResult.timedOut).toBe(false);

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
    createdRunDirectories.push(result1.runDirectory);
    const result2 = await runPlaywrightTests(config);
    createdRunDirectories.push(result2.runDirectory);

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
    createdRunDirectories.push(result1.runDirectory);

    // Record contents of first run
    const firstRunContents = existsSync(result1.runDirectory)
      ? readdirSync(result1.runDirectory)
      : [];

    const result2 = await runPlaywrightTests(config);
    createdRunDirectories.push(result2.runDirectory);

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
    createdRunDirectories.push(result.runDirectory);

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
    createdRunDirectories.push(result.runDirectory);

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

  describe('timeout handling', () => {
    it(
      'should observe readiness marker before timeout termination',
      { timeout: HANGING_TEST_TIMEOUT },
      async () => {
        const configPath = resolve(fixturesBase, 'hanging/project.config.json');
        const config = loadProjectConfig(configPath);

        // Track whether readiness marker was observed while process is running
        let markerObserved = false;
        let markerObservedTime: number | undefined;
        let markerResolve: (() => void) | undefined;
        let markerReject: ((err: Error) => void) | undefined;

        // Create promise that resolves when marker is observed
        const markerPromise = new Promise<void>((resolve, reject) => {
          markerResolve = resolve;
          markerReject = reject;
        });

        // Set up marker timeout
        const markerTimeout = setTimeout(() => {
          if (markerReject) {
            markerReject(new Error(
              'FIXTURE_PAGE_READY marker was not observed within expected time. ' +
              'This indicates the browser/test did not start properly.'
            ));
          }
        }, 20000); // 20 second timeout for marker - browser startup should be well within this

        // Run the hanging fixture with timeout
        const runPromise = runPlaywrightTests(config, {
          timeoutMs: HANGING_RUNNER_TIMEOUT,
          onStdout: (chunk) => {
            if (chunk.includes('FIXTURE_PAGE_READY') && !markerObserved) {
              clearTimeout(markerTimeout);
              markerObserved = true;
              markerObservedTime = Date.now();
              if (markerResolve) {
                markerResolve();
              }
            }
          },
        });

        // Wait for marker to be observed (while process is still running)
        await markerPromise;

        // Now wait for the run to complete (via timeout)
        const result = await runPromise;
        createdRunDirectories.push(result.runDirectory);
        const processEndTime = Date.now();

        // Verify readiness marker was observed BEFORE process ended
        expect(markerObserved).toBe(true);
        expect(markerObservedTime).toBeDefined();
        expect(markerObservedTime!).toBeLessThan(processEndTime);

        // Verify timeout behavior
        expect(result.processResult.timedOut).toBe(true);

        // Verify cleanup was attempted and results are available
        expect(result.processResult.cleanup).toBeDefined();
        expect(result.processResult.cleanup!.requested).toBe(true);

        // Log cleanup result for verification
        console.log('Cleanup result:', JSON.stringify(result.processResult.cleanup, null, 2));

        // On Windows, we expect taskkill; on Unix, sigterm/sigkill
        if (process.platform === 'win32') {
          expect(result.processResult.cleanup!.method).toBe('taskkill');
        } else {
          expect(['sigterm', 'sigkill']).toContain(result.processResult.cleanup!.method);
        }

        // Verify cleanup timing
        expect(result.processResult.cleanup!.duration).toBeGreaterThan(0);

        // Duration should approximately match the runner timeout
        // Allow some margin for browser startup and cleanup
        expect(result.processResult.duration).toBeGreaterThanOrEqual(HANGING_RUNNER_TIMEOUT - 1000);
        // It shouldn't exceed timeout by too much (cleanup should be relatively quick)
        expect(result.processResult.duration).toBeLessThan(HANGING_RUNNER_TIMEOUT + 15000);

        // Verify run directory was created
        expect(existsSync(result.runDirectory)).toBe(true);

        // Verify the marker was in the output
        expect(result.processResult.stdout).toContain('FIXTURE_PAGE_READY');
      }
    );

    it(
      'should report cleanup failure accurately',
      { timeout: HANGING_TEST_TIMEOUT },
      async () => {
        // This test verifies that cleanup results are always available
        // and that failure information would be surfaced if cleanup failed
        const configPath = resolve(fixturesBase, 'hanging/project.config.json');
        const config = loadProjectConfig(configPath);

        const result = await runPlaywrightTests(config, {
          timeoutMs: HANGING_RUNNER_TIMEOUT,
        });
        createdRunDirectories.push(result.runDirectory);

        // Verify timeout was triggered
        expect(result.processResult.timedOut).toBe(true);

        // Verify cleanup result structure is present on timeout
        expect(result.processResult.cleanup).toBeDefined();
        expect(typeof result.processResult.cleanup!.requested).toBe('boolean');
        expect(typeof result.processResult.cleanup!.success).toBe('boolean');
        expect(typeof result.processResult.cleanup!.method).toBe('string');
        expect(typeof result.processResult.cleanup!.duration).toBe('number');

        // Error field should be defined only if cleanup failed
        if (!result.processResult.cleanup!.success) {
          expect(result.processResult.cleanup!.error).toBeDefined();
          console.log('Cleanup failed with error:', result.processResult.cleanup!.error);
        }

        // Log success case for verification
        if (result.processResult.cleanup!.success) {
          console.log('Cleanup succeeded using method:', result.processResult.cleanup!.method);
        }
      }
    );
  });

  describe('stream callbacks', () => {
    it('should invoke onStdout callback with output chunks', { timeout: INTEGRATION_TIMEOUT }, async () => {
      const configPath = resolve(fixturesBase, 'passing/project.config.json');
      const config = loadProjectConfig(configPath);

      const chunks: string[] = [];

      const result = await runPlaywrightTests(config, {
        onStdout: (chunk) => {
          chunks.push(chunk);
        },
      });
      createdRunDirectories.push(result.runDirectory);

      // Should have received some output chunks
      expect(chunks.length).toBeGreaterThan(0);

      // Combined chunks should match the final stdout
      const combined = chunks.join('');
      expect(combined).toBe(result.processResult.stdout);
    });

    it('should invoke onStderr callback with error chunks', { timeout: INTEGRATION_TIMEOUT }, async () => {
      const configPath = resolve(fixturesBase, 'failing/project.config.json');
      const config = loadProjectConfig(configPath);

      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      const result = await runPlaywrightTests(config, {
        onStdout: (chunk) => {
          stdoutChunks.push(chunk);
        },
        onStderr: (chunk) => {
          stderrChunks.push(chunk);
        },
      });
      createdRunDirectories.push(result.runDirectory);

      // Should have received some output
      const combinedStdout = stdoutChunks.join('');
      const combinedStderr = stderrChunks.join('');

      expect(combinedStdout).toBe(result.processResult.stdout);
      expect(combinedStderr).toBe(result.processResult.stderr);
    });
  });

  describe('run artifact ownership', () => {
    it(
      'should preserve pre-existing run directories when creating a new run',
      { timeout: INTEGRATION_TIMEOUT },
      async () => {
        const configPath = resolve(fixturesBase, 'passing/project.config.json');
        const config = loadProjectConfig(configPath);

        // Create a pre-existing run directory with a sentinel file
        const artifactDir = config.resolvedArtifactDirectory;
        mkdirSync(artifactDir, { recursive: true });

        const preExistingRunId = 'pre-existing-manual-run';
        const preExistingRunDir = join(artifactDir, preExistingRunId);
        mkdirSync(preExistingRunDir, { recursive: true });

        const sentinelFile = join(preExistingRunDir, 'sentinel.txt');
        const sentinelContent = 'This run was created manually and must be preserved';
        writeFileSync(sentinelFile, sentinelContent);

        // Execute a new run via the platform
        const result = await runPlaywrightTests(config);
        createdRunDirectories.push(result.runDirectory);

        // Verify the new run was successful
        expect(existsSync(result.runDirectory)).toBe(true);
        expect(result.runId).not.toBe(preExistingRunId);

        // Verify the pre-existing directory was NOT deleted
        expect(existsSync(preExistingRunDir)).toBe(true);

        // Verify the sentinel file still exists with original content
        expect(existsSync(sentinelFile)).toBe(true);
        const preservedContent = readFileSync(sentinelFile, 'utf-8');
        expect(preservedContent).toBe(sentinelContent);

        // Clean up the pre-existing directory after test (we created it, so we can delete it)
        rmSync(preExistingRunDir, { recursive: true, force: true });
      }
    );

    it(
      'should not delete artifacts directory even when run creates errors',
      { timeout: INTEGRATION_TIMEOUT },
      async () => {
        const configPath = resolve(fixturesBase, 'failing/project.config.json');
        const config = loadProjectConfig(configPath);

        // Create a pre-existing run directory
        const artifactDir = config.resolvedArtifactDirectory;
        mkdirSync(artifactDir, { recursive: true });

        const preExistingRunId = 'historical-run-to-preserve';
        const preExistingRunDir = join(artifactDir, preExistingRunId);
        mkdirSync(preExistingRunDir, { recursive: true });
        const marker = join(preExistingRunDir, 'keep-me.txt');
        writeFileSync(marker, 'historical data');

        // Execute a failing run
        const result = await runPlaywrightTests(config);
        createdRunDirectories.push(result.runDirectory);

        // Test failure should not affect pre-existing runs
        expect(result.processResult.exitCode).not.toBe(0);
        expect(existsSync(preExistingRunDir)).toBe(true);
        expect(existsSync(marker)).toBe(true);

        // Clean up
        rmSync(preExistingRunDir, { recursive: true, force: true });
      }
    );
  });

  describe('log persistence (DEC-016)', () => {
    it(
      'should create logs directory with stdout.log and stderr.log',
      { timeout: INTEGRATION_TIMEOUT },
      async () => {
        const configPath = resolve(fixturesBase, 'passing/project.config.json');
        const config = loadProjectConfig(configPath);

        const result = await runPlaywrightTests(config);
        createdRunDirectories.push(result.runDirectory);

        // Verify log persistence result
        expect(result.processResult.logPersistence).toBeDefined();
        expect(result.processResult.logPersistence!.logsDirectoryCreated).toBe(true);
        expect(result.processResult.logPersistence!.stdoutWritten).toBe(true);
        expect(result.processResult.logPersistence!.stderrWritten).toBe(true);

        // Verify logs directory exists
        const logsDir = join(result.runDirectory, 'logs');
        expect(existsSync(logsDir)).toBe(true);

        // Verify stdout.log contains expected output
        const stdoutLog = join(logsDir, 'stdout.log');
        expect(existsSync(stdoutLog)).toBe(true);
        const stdoutContent = readFileSync(stdoutLog, 'utf-8');
        expect(stdoutContent).toBe(result.processResult.stdout);
        expect(stdoutContent).toContain('passing.spec.ts');

        // Verify stderr.log exists (may be empty for successful runs)
        const stderrLog = join(logsDir, 'stderr.log');
        expect(existsSync(stderrLog)).toBe(true);
        const stderrContent = readFileSync(stderrLog, 'utf-8');
        expect(stderrContent).toBe(result.processResult.stderr);
      }
    );

    it(
      'should persist logs for failing tests',
      { timeout: INTEGRATION_TIMEOUT },
      async () => {
        const configPath = resolve(fixturesBase, 'failing/project.config.json');
        const config = loadProjectConfig(configPath);

        const result = await runPlaywrightTests(config);
        createdRunDirectories.push(result.runDirectory);

        // Logs should be created even for failing tests
        expect(result.processResult.logPersistence!.logsDirectoryCreated).toBe(true);

        const logsDir = join(result.runDirectory, 'logs');
        const stdoutLog = join(logsDir, 'stdout.log');
        expect(existsSync(stdoutLog)).toBe(true);

        // Stdout should contain failure evidence
        const stdoutContent = readFileSync(stdoutLog, 'utf-8');
        expect(stdoutContent).toContain('failing.spec.ts');
      }
    );

    it(
      'should persist partial logs when timeout occurs',
      { timeout: HANGING_TEST_TIMEOUT },
      async () => {
        const configPath = resolve(fixturesBase, 'hanging/project.config.json');
        const config = loadProjectConfig(configPath);

        const result = await runPlaywrightTests(config, {
          timeoutMs: HANGING_RUNNER_TIMEOUT,
        });
        createdRunDirectories.push(result.runDirectory);

        // Log persistence should succeed even on timeout
        expect(result.processResult.logPersistence!.logsDirectoryCreated).toBe(true);

        // Logs directory should contain captured output before timeout
        const logsDir = join(result.runDirectory, 'logs');
        const stdoutLog = join(logsDir, 'stdout.log');
        expect(existsSync(stdoutLog)).toBe(true);

        // The readiness marker should be in the persisted log
        const stdoutContent = readFileSync(stdoutLog, 'utf-8');
        expect(stdoutContent).toContain('FIXTURE_PAGE_READY');
      }
    );
  });
});
