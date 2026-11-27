// Release Demo server (Task Q6, DEC-041 §9). Dependency-free; serves one version folder.
// Usage: node demo-apps/release-demo/server.mjs <version>   (for example: v1)
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PORT = 4310;
const DEMO_USERNAME = 'release_tester';
const DEMO_PASSWORD = 'rt-pass-2026';
const INITIAL_TASKS = ['Prepare release notes', 'Review test results', 'Approve deployment'];
const MAX_BODY_BYTES = 10_000;

const escapeHtml = (text) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const messageHtml = (message) => (message ? `<p role="alert">${escapeHtml(message)}</p>` : '');

/**
 * Create the request handler for one version folder (for example "v1").
 * Sessions and their tasks live in memory, so they reset when the server restarts.
 * Each session gets its own copy of the initial tasks, so test runs do not affect each other.
 */
export function createDemoHandler(version) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), version);
  if (!/^v\d+$/.test(version) || !existsSync(dir)) {
    throw new Error(`Unknown demo version '${version}'`);
  }
  const loginPage = readFileSync(join(dir, 'index.html'), 'utf-8');
  const tasksPage = readFileSync(join(dir, 'tasks.html'), 'utf-8');
  /** @type {Map<string, string[]>} session id -> task titles */
  const sessions = new Map();

  const sendHtml = (res, status, html, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
    res.end(html);
  };
  const redirect = (res, location, headers = {}) => {
    res.writeHead(303, { Location: location, ...headers });
    res.end();
  };
  const renderLogin = (message) => loginPage.replace('<!--MESSAGE-->', messageHtml(message));
  const renderTasks = (tasks, message) =>
    tasksPage
      .replace('<!--TASKS-->', tasks.map((t) => `      <li>${escapeHtml(t)}</li>`).join('\n'))
      .replace('<!--MESSAGE-->', messageHtml(message));

  const sessionTasks = (req) => {
    const match = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie ?? '');
    return match ? sessions.get(match[1]) : undefined;
  };

  const readForm = (req) =>
    new Promise((resolve, reject) => {
      let body = '';
      req.setEncoding('utf-8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY_BYTES) reject(new Error('Request body too large'));
      });
      req.on('end', () => resolve(new URLSearchParams(body)));
      req.on('error', reject);
    });

  const handleLogin = async (req, res) => {
    const form = await readForm(req);
    const username = (form.get('username') ?? '').trim();
    const password = form.get('password') ?? '';
    if (!username) return sendHtml(res, 200, renderLogin('Username is required.'));
    if (!password) return sendHtml(res, 200, renderLogin('Password is required.'));
    if (username !== DEMO_USERNAME || password !== DEMO_PASSWORD) {
      return sendHtml(res, 200, renderLogin('Username or password is incorrect.'));
    }
    const sid = randomUUID();
    sessions.set(sid, [...INITIAL_TASKS]);
    redirect(res, '/tasks.html', { 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
  };

  const handleAddTask = async (req, res, tasks) => {
    const title = ((await readForm(req)).get('title') ?? '').trim();
    if (!title) return sendHtml(res, 200, renderTasks(tasks, 'Task title is required.'));
    tasks.push(title);
    redirect(res, '/tasks.html');
  };

  return (req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const route = `${req.method} ${path}`;
    const fail = () => {
      if (!res.headersSent) sendHtml(res, 400, 'Bad request');
    };
    if (route === 'GET /' || route === 'GET /index.html') return sendHtml(res, 200, renderLogin());
    if (route === 'POST /') return handleLogin(req, res).catch(fail);
    if (path === '/tasks.html' && (req.method === 'GET' || req.method === 'POST')) {
      const tasks = sessionTasks(req);
      if (!tasks) return redirect(res, '/');
      if (req.method === 'GET') return sendHtml(res, 200, renderTasks(tasks));
      return handleAddTask(req, res, tasks).catch(fail);
    }
    sendHtml(res, 404, 'Not found');
  };
}

// Run directly: listen on the IPv4 and IPv6 loopback addresses so http://localhost:4310 works
// whichever address "localhost" resolves to (Windows and Linux differ). Not exposed to the network.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node demo-apps/release-demo/server.mjs <version>   (for example: v1)');
    process.exit(1);
  }
  const handler = createDemoHandler(version);
  createServer(handler).listen(PORT, '127.0.0.1', () => {
    console.log(`Release Demo ${version} listening on http://localhost:${PORT}`);
  });
  createServer(handler)
    .on('error', (err) => console.warn(`IPv6 loopback not available (${err.code}); using IPv4 only.`))
    .listen(PORT, '::1');
}
