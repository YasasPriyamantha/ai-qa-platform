/**
 * Local fixture site shared by the MCP integration tests (Tasks P2, P4).
 */

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { AddressInfo } from 'node:net';

const SITE_DIR = join(import.meta.dirname, '..', '..', 'fixtures', 'mcp-site');

/**
 * Static server for the fixture HTML. `/redirect-away` redirects to
 * `redirectTarget()` (the off-domain server in the tests).
 */
export function startSite(host: string, redirectTarget?: () => string): Promise<Server> {
  const server = createServer(async (req, res) => {
    if (req.url === '/redirect-away' && redirectTarget) {
      res.writeHead(302, { Location: redirectTarget() });
      res.end();
      return;
    }
    const file = req.url === '/' ? 'index.html' : basename(req.url ?? '');
    try {
      const body = await readFile(join(SITE_DIR, file));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(0, host, () => resolve(server)));
}

export const portOf = (server: Server) => (server.address() as AddressInfo).port;
