/**
 * Unit tests for process manager startup failure handling
 */

import { describe, it, expect } from 'vitest';
import { launchPlaywrightProcess, ProcessStartupError } from '../../../src/test-execution/process-manager.js';
import { resolvePlaywrightCli } from '../../../src/test-execution/playwright-cli.js';

describe('launchPlaywrightProcess', () => {
  it('should reject with ProcessStartupError when child process fails to start due to invalid cwd', async () => {
    // Use a valid CLI path but invalid working directory to force startup failure
    const cliPath = resolvePlaywrightCli();
    const invalidCwd = '/nonexistent/working/directory';

    const options = {
      cliPath,
      args: ['test'],
      cwd: invalidCwd,
      env: process.env,
    };

    // Should reject with ProcessStartupError
    await expect(launchPlaywrightProcess(options)).rejects.toThrow(ProcessStartupError);
  });

  it('should include partial result in startup error', async () => {
    const cliPath = resolvePlaywrightCli();
    const invalidCwd = '/nonexistent/working/directory';

    const options = {
      cliPath,
      args: ['test'],
      cwd: invalidCwd,
      env: process.env,
    };

    try {
      await launchPlaywrightProcess(options);
      // Should not reach here
      expect.fail('Expected ProcessStartupError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProcessStartupError);

      const startupErr = err as ProcessStartupError;

      // Should have partial result with timing information
      expect(startupErr.partialResult).toBeDefined();
      expect(startupErr.partialResult.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(startupErr.partialResult.endTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(startupErr.partialResult.duration).toBeGreaterThanOrEqual(0);

      // Exit code and signal should be null for startup failure
      expect(startupErr.partialResult.exitCode).toBeNull();
      expect(startupErr.partialResult.signal).toBeNull();

      // Stdout and stderr should be empty or minimal
      expect(startupErr.partialResult.stdout).toBeDefined();
      expect(startupErr.partialResult.stderr).toBeDefined();

      // Error message should indicate the failure
      expect(startupErr.message).toMatch(/Playwright process error/);
    }
  });

  it('should not hang when process startup fails', async () => {
    const cliPath = resolvePlaywrightCli();
    const invalidCwd = '/nonexistent/working/directory';

    const options = {
      cliPath,
      args: ['test'],
      cwd: invalidCwd,
      env: process.env,
    };

    // Set a timeout to ensure the promise settles
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Process manager did not settle within timeout')), 5000)
    );

    // Should reject quickly, not hang
    await expect(
      Promise.race([
        launchPlaywrightProcess(options),
        timeoutPromise
      ])
    ).rejects.toThrow(ProcessStartupError);
  });

  it('should handle normal process exit with non-zero code', async () => {
    // This tests the case where the process starts successfully but exits with error
    // Use a non-existent module to make Node.js exit with code 1
    const cliPath = '/nonexistent/path/to/playwright-cli.js';

    const options = {
      cliPath,
      args: ['test'],
      cwd: process.cwd(),
      env: process.env,
    };

    // This should NOT throw ProcessStartupError - the process started successfully
    // It should resolve with exitCode 1
    const result = await launchPlaywrightProcess(options);

    expect(result.exitCode).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain('MODULE_NOT_FOUND');
  });

  it('should capture final stdout output after process exits', async () => {
    // This test verifies that stdout is fully captured even if data arrives
    // just before or around the time of process exit.
    // The implementation waits for 'close' event after 'exit' to collect remaining output.

    // Create a script that outputs data and exits
    const script = `
      console.log('LINE_1');
      console.log('LINE_2');
      console.log('FINAL_LINE');
      process.exit(0);
    `;

    const options = {
      cliPath: '-e',  // Node's -e flag for inline script
      args: [script],
      cwd: process.cwd(),
      env: process.env,
    };

    const result = await launchPlaywrightProcess(options);

    expect(result.exitCode).toBe(0);
    // All lines should be captured
    expect(result.stdout).toContain('LINE_1');
    expect(result.stdout).toContain('LINE_2');
    expect(result.stdout).toContain('FINAL_LINE');
    // outputIncomplete should not be set for normal completion
    expect(result.outputIncomplete).toBeUndefined();
  });

  it('should capture stderr output completely', async () => {
    // Test that stderr is also fully captured
    const script = `
      console.error('ERROR_1');
      console.error('ERROR_2');
      console.error('FINAL_ERROR');
      process.exit(1);
    `;

    const options = {
      cliPath: '-e',
      args: [script],
      cwd: process.cwd(),
      env: process.env,
    };

    const result = await launchPlaywrightProcess(options);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ERROR_1');
    expect(result.stderr).toContain('ERROR_2');
    expect(result.stderr).toContain('FINAL_ERROR');
  });
});
