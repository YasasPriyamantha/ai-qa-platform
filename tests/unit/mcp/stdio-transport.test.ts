/**
 * Unit tests for StdioProcessTransport.close() (Task P1). The child process and
 * terminateProcessTree() are faked; no process is started or killed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exit(code: number): void {
    this.exitCode = code;
    this.emit('exit', code, null);
  }
}

let child: FakeChild;
const terminateProcessTree = vi.fn();

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    child = new FakeChild();
    queueMicrotask(() => child.emit('spawn'));
    return child;
  },
}));
vi.mock('../../../src/test-execution/process-cleanup.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/test-execution/process-cleanup.js')>()),
  terminateProcessTree: (...args: unknown[]) => terminateProcessTree(...args),
}));

const { StdioProcessTransport } = await import('../../../src/mcp/stdio-transport.js');

async function startedTransport() {
  const transport = new StdioProcessTransport({ command: 'node', args: [], env: {}, cwd: '.' });
  await transport.start();
  return transport;
}

beforeEach(() => { terminateProcessTree.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('StdioProcessTransport.close', () => {
  it('returns the same promise to a call made while a close is running', async () => {
    const transport = await startedTransport();
    const end = vi.spyOn(child.stdin, 'end');

    const first = transport.close();
    const second = transport.close();
    expect(second).toBe(first);

    child.exit(0);
    await first;
    expect(end).toHaveBeenCalledTimes(1);
    expect(terminateProcessTree).not.toHaveBeenCalled();
  });

  it('succeeds when the tree kill fails but the server has already exited', async () => {
    vi.useFakeTimers();
    const transport = await startedTransport();
    terminateProcessTree.mockImplementation(async () => {
      child.exit(1);
      return { requested: true, success: false, error: 'taskkill failed' };
    });

    const closing = transport.close();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(closing).resolves.toBeUndefined();
    expect(terminateProcessTree).toHaveBeenCalledTimes(1);
  });

  it('throws when the tree kill fails and the server is still running', async () => {
    vi.useFakeTimers();
    const transport = await startedTransport();
    terminateProcessTree.mockResolvedValue({ requested: true, success: false, error: 'taskkill failed' });

    const closing = transport.close();
    const outcome = expect(closing).rejects.toThrow(/Could not stop MCP server process 4242: taskkill failed/);
    await vi.advanceTimersByTimeAsync(5000);
    await outcome;
  });
});
