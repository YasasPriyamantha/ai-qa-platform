/**
 * Process management for Playwright runner
 *
 * Handles launching and monitoring the Playwright Test child process.
 * IMPORTANT: Timeout and process-tree termination are NOT implemented here.
 * Those features are explicitly deferred to Task 1.5b.
 */

import { spawn, type ChildProcess } from 'node:child_process';

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
}

/**
 * Result of a completed process execution.
 */
export interface ProcessResult {
  /** Process exit code (null if terminated by signal) */
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
}

/**
 * Launch and monitor a Playwright Test child process.
 *
 * Uses process.execPath (Node.js executable) with an argument array and shell:false.
 * Does NOT concatenate arguments into a shell command string.
 *
 * IMPORTANT: This implementation does NOT include timeout or process-tree cleanup.
 * Those features are deferred to Task 1.5b.
 *
 * @param options - Process launch options
 * @returns Promise resolving to process result
 */
export async function launchPlaywrightProcess(
  options: ProcessLaunchOptions
): Promise<ProcessResult> {
  const { cliPath, args, cwd, env } = options;

  // Record start time
  const startTime = new Date().toISOString();
  const startMs = Date.now();

  // Prepare stdout and stderr buffers
  let stdout = '';
  let stderr = '';

  return new Promise((resolve, reject) => {
    let child: ChildProcess;

    try {
      // Launch the process using Node.js directly with an argument array
      // shell: false prevents shell injection vulnerabilities
      child = spawn(process.execPath, [cliPath, ...args], {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // Process startup failed before spawn returned
      reject(
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

      reject(
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
          }
        )
      );
    });

    // Capture stdout
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }

    // Capture stderr
    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    // Handle process exit
    child.on('exit', (code, signal) => {
      const endTime = new Date().toISOString();
      const duration = Date.now() - startMs;

      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        startTime,
        endTime,
        duration,
      });
    });
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
