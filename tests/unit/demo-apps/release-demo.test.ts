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

  it('has no sign-out button or route (V2 only)', async () => {
    const cookie = await signIn();
    expect(await (await fetch(base + '/tasks.html', { headers: { cookie } })).text()).not.toContain('Sign out');
    expect((await post('/signout', {}, cookie)).status).toBe(404);
  });
});

describe('Release Demo V2 server (Task R4)', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const { createDemoHandler } = (await import(serverModuleUrl)) as {
      createDemoHandler: (version: string) => RequestListener;
    };
    server = createServer(createDemoHandler('v2'));
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
  const tasksPage = async (cookie: string) => (await fetch(base + '/tasks.html', { headers: { cookie } })).text();
  const signIn = async () => {
    const res = await post('/', { username: 'release_tester', password: 'rt-pass-2026' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/tasks.html');
    return (res.headers.get('set-cookie') ?? '').split(';')[0];
  };

  it('keeps the V1 login page and its messages, with the planted empty-password regression fixed (R5, §3.8)', async () => {
    const html = await (await fetch(base + '/')).text();
    expect(html).toContain('<h1>Sign in to Release Demo</h1>');
    expect(html).toContain('<label for="username">Username</label>');
    expect(html).toContain('<label for="password">Password</label>');
    expect(html).toContain('<button type="submit">Sign in</button>');
    const message = async (form: Record<string, string>) => (await (await post('/', form)).text()).match(/<p role="alert">(.*)<\/p>/)?.[1];
    expect(await message({ username: '', password: '' })).toBe('Username is required.');
    expect(await message({ username: 'release_tester', password: '' })).toBe('Password is required.');
    expect(await message({ username: 'release_tester', password: 'wrong-password' })).toBe('Username or password is incorrect.');
  });

  it('starts with an empty task list, adds a task, and shows the new empty-title message', async () => {
    const cookie = await signIn();
    const page = await tasksPage(cookie);
    expect(page).toContain('<h1>My Tasks</h1>');
    expect(page).not.toContain('<li>');
    expect(page).toContain('<label for="title">Task title</label>');
    expect(page).toContain('placeholder="Enter a task title"');
    expect(page).toContain('<button type="submit">Add task</button>');

    expect((await post('/tasks.html', { title: 'Check deployment logs' }, cookie)).status).toBe(303);
    expect(await tasksPage(cookie)).toContain('<li>Check deployment logs</li>');

    const emptyHtml = await (await post('/tasks.html', { title: '  ' }, cookie)).text();
    expect(emptyHtml).toContain('<p role="alert">Please enter a task title.</p>');
    expect(emptyHtml).not.toContain('Task title is required.');
    expect(emptyHtml.match(/<li>/g)).toHaveLength(1);
  });

  it('signs out from /tasks.html: ends the session and goes to /', async () => {
    const cookie = await signIn();
    const page = await tasksPage(cookie);
    expect(page).toContain('<form method="post" action="/signout">');
    expect(page).toContain('<button type="submit">Sign out</button>');
    const res = await post('/signout', {}, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(await (await fetch(base + '/', { headers: { cookie } })).text()).toContain('<h1>Sign in to Release Demo</h1>');
    const after = await fetch(base + '/tasks.html', { redirect: 'manual', headers: { cookie } });
    expect(after.status).toBe(303);
    expect(after.headers.get('location')).toBe('/');
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
