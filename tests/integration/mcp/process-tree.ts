/**
 * Process checks shared by the MCP integration tests (Tasks P1, P2).
 */

import { execFileSync } from 'node:child_process';

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** All descendant PIDs of `root` (server, and any browser it started). */
export function descendants(root: number): number[] {
  const table = process.platform === 'win32'
    ? execFileSync('powershell.exe', ['-NoProfile', '-Command',
        'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], { encoding: 'utf8' })
    : execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
  const pairs = table.trim().split(/\r?\n/).map((line) => line.trim().split(/\s+/).map(Number));
  const found: number[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const [pid, ppid] of pairs) {
      if (ppid === parent && !found.includes(pid)) { found.push(pid); queue.push(pid); }
    }
  }
  return found;
}

/**
 * PIDs from `pids` still alive after polling every 100 ms for up to 30000 ms.
 * Chromium processes can take ~500 ms to exit after close() returns.
 */
export async function stillAliveAfterWait(pids: number[]): Promise<number[]> {
  const deadline = Date.now() + 30000;
  let alive = pids.filter(isAlive);
  while (alive.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    alive = alive.filter(isAlive);
  }
  return alive;
}
