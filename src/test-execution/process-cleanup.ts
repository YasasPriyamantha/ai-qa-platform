/**
 * Cross-platform process tree/group cleanup
 *
 * Provides OS-specific process termination strategies:
 * - Windows: Uses taskkill /T /F /PID
 * - Linux/macOS: Uses process groups with SIGTERM → SIGKILL
 *
 * Cleanup failures are surfaced, never silently ignored.
 */

import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Result of a cleanup attempt.
 */
export interface CleanupResult {
  /** Whether cleanup was requested (timeout triggered) */
  requested: boolean;

  /** Whether the process tree/group was successfully terminated */
  success: boolean;

  /** Error message if cleanup failed */
  error?: string;

  /** The method used for cleanup */
  method: 'none' | 'taskkill' | 'sigterm' | 'sigkill';

  /** Time taken for cleanup in milliseconds */
  duration: number;
}

/**
 * Options for process cleanup.
 */
export interface CleanupOptions {
  /** Process ID to terminate */
  pid: number;

  /** Child process handle to wait for exit */
  childProcess: ChildProcess;

  /** Grace period in milliseconds before force kill (Linux/macOS only) */
  gracePeriodMs?: number;
}

/** Default grace period before SIGKILL (Linux/macOS) */
const DEFAULT_GRACE_PERIOD_MS = 3000;

/**
 * Terminate a process tree/group using OS-specific strategy.
 *
 * Windows: Invokes taskkill /T /F /PID
 * Linux/macOS: Sends SIGTERM to process group, waits, then SIGKILL if needed
 *
 * @param options - Cleanup options
 * @returns Promise resolving to cleanup result
 */
export async function terminateProcessTree(
  options: CleanupOptions
): Promise<CleanupResult> {
  const { pid, childProcess, gracePeriodMs = DEFAULT_GRACE_PERIOD_MS } = options;
  const startTime = Date.now();

  if (process.platform === 'win32') {
    return terminateWindows(pid, childProcess, startTime);
  } else {
    return terminateUnix(pid, childProcess, gracePeriodMs, startTime);
  }
}

/**
 * Windows-specific process tree termination using taskkill.
 *
 * Invokes: taskkill.exe /T /F /PID <pid>
 * - /T: Terminates the process and all child processes
 * - /F: Forces termination
 *
 * Uses shell: false to prevent command injection.
 * Waits for child process exit event after requesting termination.
 */
async function terminateWindows(
  pid: number,
  childProcess: ChildProcess,
  startTime: number
): Promise<CleanupResult> {
  return new Promise((resolve) => {
    // Spawn taskkill with argument array, no shell
    const taskkill = spawn('taskkill.exe', ['/T', '/F', '/PID', String(pid)], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let taskkillStdout = '';
    let taskkillStderr = '';

    if (taskkill.stdout) {
      taskkill.stdout.on('data', (chunk) => {
        taskkillStdout += chunk.toString();
      });
    }

    if (taskkill.stderr) {
      taskkill.stderr.on('data', (chunk) => {
        taskkillStderr += chunk.toString();
      });
    }

    taskkill.on('error', (err) => {
      resolve({
        requested: true,
        success: false,
        error: `Failed to spawn taskkill: ${err.message}`,
        method: 'taskkill',
        duration: Date.now() - startTime,
      });
    });

    taskkill.on('exit', (code) => {
      // Helper to create the result
      const createTaskkillResult = (): CleanupResult => ({
        requested: true,
        success: code === 0,
        error: code !== 0
          ? `taskkill exited with code ${code}: ${taskkillStderr || taskkillStdout}`.trim()
          : undefined,
        method: 'taskkill',
        duration: Date.now() - startTime,
      });

      // Check if the child process has already exited.
      // Use exitCode and signalCode - NOT 'killed' which only indicates a signal was sent.
      if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
        // Child has already exited
        resolve(createTaskkillResult());
        return;
      }

      // Child hasn't exited yet - wait for exit event with bounded timeout.
      // Register listener BEFORE checking again to avoid race condition.
      let exitResolved = false;

      const onExit = () => {
        if (!exitResolved) {
          exitResolved = true;
          clearTimeout(exitTimeout);
          resolve(createTaskkillResult());
        }
      };

      childProcess.once('exit', onExit);

      // Check again after registering listener - process may have exited between checks
      if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
        if (!exitResolved) {
          exitResolved = true;
          childProcess.removeListener('exit', onExit);
          resolve(createTaskkillResult());
        }
        return;
      }

      // Set bounded timeout for child exit
      const exitTimeout = setTimeout(() => {
        if (!exitResolved) {
          exitResolved = true;
          childProcess.removeListener('exit', onExit);
          resolve({
            requested: true,
            success: false,
            error: 'Child process did not exit after taskkill',
            method: 'taskkill',
            duration: Date.now() - startTime,
          });
        }
      }, 5000); // 5 second wait for child exit
    });
  });
}

/**
 * Unix-specific process group termination.
 *
 * Requires the child process to have been started with detached: true
 * to establish a process group.
 *
 * 1. Sends SIGTERM to the process group (-pid)
 * 2. Waits for grace period
 * 3. If not exited, sends SIGKILL
 * 4. Waits for child exit event
 */
async function terminateUnix(
  pid: number,
  childProcess: ChildProcess,
  gracePeriodMs: number,
  startTime: number
): Promise<CleanupResult> {
  return new Promise((resolve) => {
    // Send SIGTERM to process group (negative PID)
    try {
      process.kill(-pid, 'SIGTERM');
    } catch (err) {
      // Process may have already exited
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ESRCH') {
        resolve({
          requested: true,
          success: true,
          method: 'sigterm',
          duration: Date.now() - startTime,
        });
        return;
      }
      resolve({
        requested: true,
        success: false,
        error: `Failed to send SIGTERM: ${error.message}`,
        method: 'sigterm',
        duration: Date.now() - startTime,
      });
      return;
    }

    // Check if already exited after SIGTERM.
    // Use exitCode and signalCode - NOT 'killed' which only indicates a signal was sent.
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      resolve({
        requested: true,
        success: true,
        method: 'sigterm',
        duration: Date.now() - startTime,
      });
      return;
    }

    // Wait for graceful exit with race-safe pattern
    let resolved = false;

    const exitHandler = () => {
      if (!resolved) {
        resolved = true;
        resolve({
          requested: true,
          success: true,
          method: 'sigterm',
          duration: Date.now() - startTime,
        });
      }
    };

    // Register listener BEFORE checking again
    childProcess.once('exit', exitHandler);

    // Check again after registering listener - process may have exited between checks
    if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
      if (!resolved) {
        resolved = true;
        childProcess.removeListener('exit', exitHandler);
        resolve({
          requested: true,
          success: true,
          method: 'sigterm',
          duration: Date.now() - startTime,
        });
      }
      return;
    }

    // After grace period, escalate to SIGKILL
    setTimeout(() => {
      if (resolved) return;

      childProcess.removeListener('exit', exitHandler);

      // Check if exited during grace period.
      // Use exitCode and signalCode - NOT 'killed'.
      if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
        if (!resolved) {
          resolved = true;
          resolve({
            requested: true,
            success: true,
            method: 'sigterm',
            duration: Date.now() - startTime,
          });
        }
        return;
      }

      // Send SIGKILL to process group
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ESRCH') {
          // Process already gone
          if (!resolved) {
            resolved = true;
            resolve({
              requested: true,
              success: true,
              method: 'sigkill',
              duration: Date.now() - startTime,
            });
          }
          return;
        }
        if (!resolved) {
          resolved = true;
          resolve({
            requested: true,
            success: false,
            error: `Failed to send SIGKILL: ${error.message}`,
            method: 'sigkill',
            duration: Date.now() - startTime,
          });
        }
        return;
      }

      // Wait for exit after SIGKILL with race-safe pattern
      const onKillExit = () => {
        clearTimeout(killTimeout);
        if (!resolved) {
          resolved = true;
          resolve({
            requested: true,
            success: true,
            method: 'sigkill',
            duration: Date.now() - startTime,
          });
        }
      };

      // Register listener BEFORE checking and setting timeout
      childProcess.once('exit', onKillExit);

      // Check if process already exited after registering listener
      if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
        if (!resolved) {
          resolved = true;
          childProcess.removeListener('exit', onKillExit);
          resolve({
            requested: true,
            success: true,
            method: 'sigkill',
            duration: Date.now() - startTime,
          });
        }
        return;
      }

      // Set bounded timeout for child exit
      const killTimeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          childProcess.removeListener('exit', onKillExit);
          resolve({
            requested: true,
            success: false,
            error: 'Child process did not exit after SIGKILL',
            method: 'sigkill',
            duration: Date.now() - startTime,
          });
        }
      }, 5000);
    }, gracePeriodMs);
  });
}

/**
 * Check if the current platform is Windows.
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Check if a child process has actually exited.
 *
 * Uses exitCode and signalCode - NOT 'killed' property.
 * The 'killed' property only indicates that a signal was sent,
 * not that the process has actually terminated.
 *
 * @param childProcess - The child process to check
 * @returns true if the process has exited, false otherwise
 */
export function hasProcessExited(childProcess: ChildProcess): boolean {
  return childProcess.exitCode !== null || childProcess.signalCode !== null;
}
