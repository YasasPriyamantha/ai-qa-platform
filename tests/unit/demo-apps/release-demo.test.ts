/**
 * Task Q6: Release Demo V1 server serves its pages, and the project config loads.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadProject } from '../../../src/projects/service.js';

const serverModuleUrl = pathToFileURL(join(process.cwd(), 'demo-apps', 'release-demo', 'server.mjs')).href;

describe('Release Demo V1 server', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const { createDemoHandler } = (await import(serverModuleUrl)) as {
      createDemoHandler: (version: string) => RequestListener;
    };
    server = createServer(createDemoHandler('v1'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const post = (path: string, form: Record<string, string>, cookie = '') =>
    fetch(base + path, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams(form).toString(),
    });

  const signIn = async () => {
    const res = await post('/', { username: 'release_tester', password: 'rt-pass-2026' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/tasks.html');
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };

  it('serves the login page at / with labelled fields and no required attributes', async () => {
    const res = await fetch(base + '/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<h1>Sign in to Release Demo</h1>');
    expect(html).toContain('<label for="username">Username</label>');
    expect(html).toContain('<label for="password">Password</label>');
    expect(html).toContain('<button type="submit">Sign in</button>');
    expect(html).not.toMatch(/\brequired\b/);
  });

  it('answers login failures at / with the message, checking username, then password, then credentials', async () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ username: '', password: '' }, 'Username is required.'],
      [{ username: 'release_tester', password: '' }, 'Password is required.'],
      [{ username: 'release_tester', password: 'wrong-password' }, 'Username or password is incorrect.'],
    ];
    for (const [form, message] of cases) {
      const res = await post('/', form);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(message);
    }
  });

  it('redirects /tasks.html to / when not signed in', async () => {
    const res = await fetch(base + '/tasks.html', { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
  });

  it('shows the initial tasks after sign-in, adds a task, and rejects an empty title', async () => {
    const cookie = await signIn();
    const page = await (await fetch(base + '/tasks.html', { headers: { cookie } })).text();
    expect(page).toContain('<h1>My Tasks</h1>');
    for (const title of ['Prepare release notes', 'Review test results', 'Approve deployment']) {
      expect(page).toContain(`<li>${title}</li>`);
    }
    expect(page).toContain('<label for="title">Task title</label>');
    expect(page).toContain('placeholder="Enter a task title"');

    const added = await post('/tasks.html', { title: 'Check deployment logs' }, cookie);
    expect(added.status).toBe(303);
    const after = await (await fetch(base + '/tasks.html', { headers: { cookie } })).text();
    expect(after).toContain('<li>Check deployment logs</li>');

    const empty = await post('/tasks.html', { title: '  ' }, cookie);
    const emptyHtml = await empty.text();
    expect(empty.status).toBe(200);
    expect(emptyHtml).toContain('Task title is required.');
    expect(emptyHtml.match(/<li>/g)).toHaveLength(4);
  });
});

describe('Release Demo project config', () => {
  it('loads through the existing project loader', () => {
    const { config } = loadProject('release-demo');
    expect(config.baseUrl).toBe('http://localhost:4310');
    expect(config.environment).toBe('local');
    expect(config.allowedDomains).toEqual(['localhost']);
    expect(config.exploration).toEqual({ mode: 'interactive' });
    expect(config.roles?.map((r) => r.roleId)).toEqual(['demo_user']);
    expect(config.documents?.map((d) => d.documentId)).toEqual(['release-demo-requirements']);
  });
});
