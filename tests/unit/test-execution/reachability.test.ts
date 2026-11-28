/**
 * Pre-flight reachability check (Task R4 carry-over a): any HTTP response is reachable; no response is not.
 */

import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkTargetReachable } from '../../../src/test-execution/index.js';

const listen = async (status: number) => {
  const server = createServer((_req, res) => { res.writeHead(status); res.end('down for maintenance'); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
};
const close = (server: ReturnType<typeof createServer>) => new Promise((resolve) => server.close(resolve));

describe('checkTargetReachable', () => {
  it('counts any HTTP response from a running local server as reachable, even an error status', async () => {
    const { server, url } = await listen(503);
    try {
      expect(await checkTargetReachable(url)).toBeNull();
    } finally {
      await close(server);
    }
  });

  it('reports a closed local port (connection refused) as not reachable', async () => {
    const { server, url } = await listen(200);
    await close(server);
    expect(await checkTargetReachable(url)).toBe(`Target ${url} is not reachable; start the application and try again`);
  });
});
