/**
 * Stdio transport for the Playwright MCP server (Task P1, DEC-040).
 *
 * Implements the MCP SDK's Transport interface with the SDK's own ReadBuffer
 * and serializeMessage. The SDK's StdioClientTransport is not used because it
 * hides the ChildProcess, does not start a process group on Linux and signals
 * only the direct child, so terminateProcessTree() could not stop the browser
 * processes the server launches.
 *
 * Spawn follows the runner's process manager: argument array, no shell,
 * detached (own process group) on Linux/macOS only.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  ReadBuffer,
  serializeMessage,
  type JSONRPCMessage,
  type Transport,
} from '@modelcontextprotocol/client';
import { terminateProcessTree, hasProcessExited, isWindows } from '../test-execution/process-cleanup.js';

/** How long close() waits for the server to exit after stdin ends. */
const GRACEFUL_EXIT_MS = 5000;

/** Most stderr characters kept for error messages. */
const STDERR_TAIL_CHARS = 2000;

export interface StdioLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
}

export class StdioProcessTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private child?: ChildProcess;
  private readonly readBuffer = new ReadBuffer();
  private stderr = '';

  constructor(private readonly launch: StdioLaunch) {}

  /** PID of the server process, once started. */
  get pid(): number | undefined {
    return this.child?.pid;
  }

  /** Exit code of the server process, or null while it runs. */
  get exitCode(): number | null {
    return this.child?.exitCode ?? null;
  }

  /** Last part of the server's stderr output, for error messages. */
  get stderrTail(): string {
    return this.stderr.trim();
  }

  start(): Promise<void> {
    if (this.child) {
      return Promise.reject(new Error('Transport already started'));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(this.launch.command, [...this.launch.args], {
        cwd: this.launch.cwd,
        env: this.launch.env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        detached: !isWindows(),
      });
      this.child = child;

      child.once('error', (err) => {
        reject(err);
        this.onerror?.(err);
      });
      child.once('spawn', () => resolve());
      child.once('close', () => this.onclose?.());
      child.stdin?.on('error', (err) => this.onerror?.(err));
      child.stdout?.on('data', (chunk: Buffer) => {
        try {
          this.readBuffer.append(chunk);
          for (let msg = this.readBuffer.readMessage(); msg; msg = this.readBuffer.readMessage()) {
            this.onmessage?.(msg);
          }
        } catch (err) {
          this.onerror?.(err as Error);
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        this.stderr = (this.stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
      });
    });
  }

  send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.child?.stdin;
    if (!stdin || !stdin.writable) {
      return Promise.reject(new Error('MCP server process is not running'));
    }
    return new Promise((resolve) => {
      if (stdin.write(serializeMessage(message))) resolve();
      else stdin.once('drain', resolve);
    });
  }

  /**
   * Stop the server: end stdin (Playwright MCP then closes its browser and
   * exits), and if it has not exited in time, stop the whole process tree.
   * Throws if the process could not be stopped.
   */
  async close(): Promise<void> {
    const child = this.child;
    if (!child || child.pid === undefined || hasProcessExited(child)) return;

    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.stdin?.end();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(resolve, GRACEFUL_EXIT_MS); })]);
    clearTimeout(timer);
    if (hasProcessExited(child)) return;

    const result = await terminateProcessTree({ pid: child.pid!, childProcess: child });
    if (!result.success) {
      throw new Error(`Could not stop MCP server process ${child.pid}: ${result.error ?? 'unknown error'}`);
    }
  }
}
