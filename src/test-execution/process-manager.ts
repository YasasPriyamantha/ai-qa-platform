/**
 * Process management for Playwright runner
 *
 * Handles launching, monitoring, timeout, and cleanup of the Playwright Test child process.
 * Supports cross-platform process tree/group termination on timeout.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  terminateProcessTree,
  isWindows,
  type CleanupResult,
} from './process-cleanup.js';

// Re-export CleanupResult for convenience
export type { CleanupResult } from './process-cleanup.js';

/**
 * Options for launching the Playwright process.
 */
export interface ProcessLaunchOptions {
  /** Absolute path to the Playwright CLI entry point */
  cliPath: string;

  /** Command-line arguments to pass to Playwright */
  args: string[];

  /** Working directory for the child process */
  cwd: string;

  /** Environment variables to pass to the child process */
  env: NodeJS.ProcessEnv;

  /** Optional timeout in milliseconds (0 or undefined = no timeout) */
  timeoutMs?: number;

  /**
   * Optional callback for streaming stdout data.
   * Called with each chunk as it arrives, before the process exits.
   */
  onStdout?: (chunk: string) => void;

  /**
   * Optional callback for streaming stderr data.
   * Called with each chunk as it arrives, before the process exits.
   */
  onStderr?: (chunk: string) => void;
}

/**
 * Result of a completed process execution.
 */
export interface ProcessResult {
  /** Process exit code (null if terminated by signal or timeout) */
  exitCode: number | null;

  /** Signal that terminated the process (null if exited normally) */
  signal: NodeJS.Signals | null;

  /** Standard output captured from the process */
  stdout: string;

  /** Standard error captured from the process */
  stderr: string;

  /** Time when the process started (ISO 8601 UTC) */
  startTime: string;

  /** Time when the process ended (ISO 8601 UTC) */
  endTime: string;

  /** Duration in milliseconds */
  duration: number;

  /** Whether the process was terminated due to timeout */
  timedOut: boolean;

  /** Result of cleanup operation if timeout occurred */
  cleanup?: CleanupResult;

  /**
   * Whether output collection may be incomplete.
   * True if the close event did not fire within the bounded wait after exit.
   * This can happen if a descendant process holds inherited stdio pipes.
   */
  outputIncomplete?: boolean;
}

/**
 * Launch and monitor a Playwright Test child process.
 *
 * Uses process.execPath (Node.js executable) with an argument array and shell:false.
 * Does NOT concatenate arguments into a shell command string.
 *
 * Supports runner-level timeout with cross-platform process tree/group cleanup:
 * - Windows: Uses taskkill /T /F /PID (no detached:true)
 * - Linux/macOS: Uses detached:true with process group signals
 *
 * @param options - Process launch options
 * @returns Promise resolving to process result
 */
export async function launchPlaywrightProcess(
  options: ProcessLaunchOptions
): Promise<ProcessResult> {
  const { cliPath, args, cwd, env, timeoutMs, onStdout, onStderr } = options;

  // Record start time
  const startTime = new Date().toISOString();
  const startMs = Date.now();

  // Prepare stdout and stderr buffers
  let stdout = '';
  let stderr = '';

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let timeoutHandlerActive = false;
    let resolved = false;

    // State for exit handler to capture
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;

    // Track output completion
    let outputIncomplete = false;

    // Helper to create result
    const createResult = (cleanup?: CleanupResult): ProcessResult => {
      const endTime = new Date().toISOString();
      const duration = Date.now() - startMs;
      const result: ProcessResult = {
        exitCode,
        signal: exitSignal,
        stdout,
        stderr,
        startTime,
        endTime,
        duration,
        timedOut,
        cleanup,
      };
      // Only include outputIncomplete if true to avoid cluttering normal results
      if (outputIncomplete) {
        result.outputIncomplete = true;
      }
      return result;
    };

    // Helper to resolve only once
    const resolveOnce = (result: ProcessResult) => {
      if (!resolved) {
        resolved = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        resolve(result);
      }
    };

    // Helper to reject only once
    const rejectOnce = (err: Error) => {
      if (!resolved) {
        resolved = true;
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        reject(err);
      }
    };

    try {
      // Determine spawn options based on platform
      // Windows: No detached (would open separate console)
      // Linux/macOS: Use detached to create process group for cleanup
      const spawnOptions: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        shell: boolean;
        stdio: ['ignore', 'pipe', 'pipe'];
        detached?: boolean;
      } = {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      };

      // Only set detached on Unix platforms
      if (!isWindows()) {
        spawnOptions.detached = true;
      }

      // Launch the process using Node.js directly with an argument array
      child = spawn(process.execPath, [cliPath, ...args], spawnOptions);

      // On Unix with detached, unref to prevent the child from keeping parent alive
      // But we still wait for exit explicitly
      if (!isWindows() && child.pid) {
        child.unref();
      }
    } catch (err) {
      // Process startup failed before spawn returned
      rejectOnce(
        new Error(
          `Failed to spawn Playwright process: ${(err as Error).message}`
        )
      );
      return;
    }

    // Handle process startup errors (e.g., ENOENT, EACCES)
    child.on('error', (err) => {
      const endTime = new Date().toISOString();
      const duration = Date.now() - startMs;

      rejectOnce(
        new ProcessStartupError(
          `Playwright process error: ${err.message}`,
          {
            exitCode: null,
            signal: null,
            stdout,
            stderr,
            startTime,
            endTime,
            duration,
            timedOut: false,
          }
        )
      );
    });

    // Capture stdout
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        const str = chunk.toString();
        stdout += str;
        // Call stream callback if provided
        if (onStdout) {
          onStdout(str);
        }
      });
    }

    // Capture stderr
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const str = chunk.toString();
        stderr += str;
        // Call stream callback if provided
        if (onStderr) {
          onStderr(str);
        }
      });
    }

    // Handle process exit
    // We wait for 'exit' to confirm process termination, then wait for 'close'
    // with a bounded timeout to collect any remaining stdout/stderr data.
    child.on('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;

      // If timeout handler is active, let it handle resolution
      // This prevents race condition where exit fires before cleanup result is set
      if (timeoutHandlerActive) {
        return;
      }

      // Wait for 'close' event to ensure all output is collected.
      // Use bounded timeout to prevent hanging on descendant processes holding pipes.
      const closeTimeout = setTimeout(() => {
        outputIncomplete = true;
        child.removeAllListeners('close');
        resolveOnce(createResult());
      }, 1000); // 1 second to collect remaining output after exit

      child.once('close', () => {
        clearTimeout(closeTimeout);
        resolveOnce(createResult());
      });
    });

    // Set up timeout if specified
    if (timeoutMs && timeoutMs > 0 && child.pid) {
      timeoutHandle = setTimeout(async () => {
        if (resolved) return;

        timedOut = true;
        timeoutHandlerActive = true;

        // Terminate the process tree/group and get cleanup result
        const cleanupResult = await terminateProcessTree({
          pid: child.pid!,
          childProcess: child,
          gracePeriodMs: 3000,
        });

        // At this point, the process has exited (terminateProcessTree waits for exit).
        // Wait for 'close' to collect remaining stdout/stderr with bounded timeout.
        await new Promise<void>((resolveClose) => {
          const closeTimeout = setTimeout(() => {
            outputIncomplete = true;
            child.removeAllListeners('close');
            resolveClose();
          }, 1000); // 1 second to collect remaining output after exit

          child.once('close', () => {
            clearTimeout(closeTimeout);
            resolveClose();
          });
        });

        // Now resolve with the cleanup result
        resolveOnce(createResult(cleanupResult));
      }, timeoutMs);
    }
  });
}

/**
 * Error indicating process startup failure.
 * Contains partial process result for diagnostic purposes.
 */
export class ProcessStartupError extends Error {
  constructor(
    message: string,
    public readonly partialResult: ProcessResult
  ) {
    super(message);
    this.name = 'ProcessStartupError';
  }
}
