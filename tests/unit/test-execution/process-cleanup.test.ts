/**
 * Unit tests for process cleanup module
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import {
  isWindows,
  hasProcessExited,
} from '../../../src/test-execution/process-cleanup.js';

describe('process-cleanup', () => {
  describe('isWindows', () => {
    it('should return boolean based on platform', () => {
      const result = isWindows();
      expect(typeof result).toBe('boolean');

      // Verify it matches process.platform
      expect(result).toBe(process.platform === 'win32');
    });
  });

  describe('hasProcessExited', () => {
    it('should return false for a running process', async () => {
      // Spawn a process that sleeps briefly
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
        stdio: 'ignore',
      });

      // Process should not be exited immediately
      expect(hasProcessExited(child)).toBe(false);

      // Clean up
      child.kill('SIGKILL');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    });

    it('should return true when exitCode is set (normal exit)', async () => {
      // Spawn a process that exits immediately with code 0
      const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
        stdio: 'ignore',
      });

      // Wait for exit
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));

      // Now exitCode should be set
      expect(child.exitCode).toBe(0);
      expect(hasProcessExited(child)).toBe(true);
    });

    it('should return true when signalCode is set (killed by signal)', async () => {
      // Spawn a process that waits
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
        stdio: 'ignore',
      });

      // Wait for process to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Kill with signal
      child.kill('SIGTERM');

      // Wait for exit
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));

      // signalCode should be set (on Unix) or exitCode (on Windows)
      // Either way, hasProcessExited should return true
      expect(hasProcessExited(child)).toBe(true);
    });

    it('should not rely on killed property - killed=true does not mean exited', async () => {
      // This test verifies that we don't use the 'killed' property
      // The 'killed' property only indicates a signal was sent, not that process exited

      // On Windows, signal handling is limited, so we skip the detailed killed/exited checks
      // The important verification is that hasProcessExited uses exitCode/signalCode, not killed

      if (process.platform === 'win32') {
        // On Windows, just verify that after kill() the process eventually exits
        // and hasProcessExited correctly reports it
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
          stdio: 'ignore',
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        // kill() on Windows terminates the process
        child.kill();

        await new Promise<void>((resolve) => child.once('exit', () => resolve()));

        // After exit, hasProcessExited should return true
        expect(hasProcessExited(child)).toBe(true);
      } else {
        // On Unix, we can demonstrate the killed vs exited distinction
        const child = spawn(process.execPath, ['-e', `
          // Ignore SIGTERM
          process.on('SIGTERM', () => {});
          setTimeout(() => process.exit(0), 5000);
        `], {
          stdio: 'ignore',
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        // Send SIGTERM - this sets killed=true but process keeps running
        child.kill('SIGTERM');

        // Verify killed is true but process hasn't exited
        expect(child.killed).toBe(true);
        // exitCode and signalCode should still be null since process is running
        expect(child.exitCode).toBeNull();
        expect(child.signalCode).toBeNull();

        // hasProcessExited should return false because process is still running
        expect(hasProcessExited(child)).toBe(false);

        // Clean up - force kill
        child.kill('SIGKILL');
        await new Promise<void>((resolve) => child.once('exit', () => resolve()));

        // Now it should definitely show as exited
        expect(hasProcessExited(child)).toBe(true);
      }
    });

    it('should return true when exitCode is non-zero', async () => {
      // Spawn a process that exits with non-zero code
      const child = spawn(process.execPath, ['-e', 'process.exit(42)'], {
        stdio: 'ignore',
      });

      // Wait for exit
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));

      expect(child.exitCode).toBe(42);
      expect(hasProcessExited(child)).toBe(true);
    });
  });

  // Note: Full integration testing of terminateProcessTree is done
  // in the integration tests with actual processes.
  // The race-safe exit detection pattern is tested via the hasProcessExited
  // helper and the integration timeout tests.
});
