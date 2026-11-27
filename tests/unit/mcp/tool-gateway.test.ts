/**
 * Unit tests for the safe tool gateway (Task P2). Fake MCP client; no process is started.
 */

import { describe, it, expect, vi } from 'vitest';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { ToolGateway } from '../../../src/mcp/tool-gateway.js';

const schema = (properties: Record<string, unknown>, required: string[] = []): Tool['inputSchema'] => ({
  type: 'object',
  properties: properties as Tool['inputSchema']['properties'],
  required,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  additionalProperties: false,
});

/** The four allowlisted tools as the real server lists them, plus a tool that must never be offered. */
const SERVER_TOOLS: Tool[] = [
  { name: 'browser_navigate', description: 'Navigate to a URL', inputSchema: schema({ url: { type: 'string' } }, ['url']) },
  { name: 'browser_navigate_back', description: 'Go back', inputSchema: schema({}) },
  { name: 'browser_snapshot', description: 'Snapshot', inputSchema: schema({ target: { type: 'string' }, filename: { type: 'string' }, depth: { type: 'number' } }) },
  { name: 'browser_wait_for', description: 'Wait', inputSchema: schema({ time: { type: 'number' }, text: { type: 'string' } }) },
  { name: 'browser_click', description: 'Click', inputSchema: schema({ ref: { type: 'string' } }, ['ref']) },
];

const page = (url: string, extra = '') => `### Page\n- Page URL: ${url}\n- Page Title: T\n${extra}`;
const ok = (text: string): CallToolResult => ({ content: [{ type: 'text', text }] });

function fakeClient(callTool: (name: string, args: Record<string, unknown>, opts: { signal: AbortSignal }) => Promise<CallToolResult>) {
  return { listTools: vi.fn(async () => SERVER_TOOLS), callTool: vi.fn(callTool) };
}

const options = { allowedDomains: ['www.saucedemo.com', 'localhost'], maxToolCalls: 10, callTimeoutMs: 1000 };
const call = (name: string, args: unknown = {}, id = 'c1') => ({ id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) });
const textOf = (outcome: { result: { content: unknown } }) => outcome.result.content as string;

describe('ToolGateway tool offer', () => {
  it('offers only the read-only allowlist, as external schemas passed through unchanged', async () => {
    const gateway = await ToolGateway.create(fakeClient(async () => ok('')), options);
    expect(gateway.tools.map((t) => t.name)).toEqual(['browser_navigate', 'browser_snapshot', 'browser_navigate_back', 'browser_wait_for']);
    expect(gateway.tools[0].parameters).toEqual({ kind: 'external_json_schema', source: 'mcp:playwright', jsonSchema: SERVER_TOOLS[0].inputSchema });
  });

  it('fails clearly when the server lacks an allowlisted tool', async () => {
    const client = { listTools: async () => SERVER_TOOLS.filter((t) => t.name !== 'browser_snapshot'), callTool: vi.fn() };
    await expect(ToolGateway.create(client, options)).rejects.toThrow("does not offer the required tool 'browser_snapshot'");
  });
});

describe('ToolGateway refusals (server is never called)', () => {
  const cases: Array<[string, ReturnType<typeof call>, RegExp]> = [
    ['a tool outside the allowlist', call('browser_click', { ref: 'e1' }), /tool 'browser_click' is not allowed/],
    ['an unknown tool', call('browser_evaluate', {}), /tool 'browser_evaluate' is not allowed/],
    ['arguments that are not JSON', call('browser_navigate', '{url:'), /arguments are not valid JSON/],
    ['arguments that are not an object', call('browser_navigate', '["x"]'), /must be a JSON object/],
    ['a missing required argument', call('browser_navigate', {}), /invalid arguments: .*url/],
    ['an argument not in the schema', call('browser_wait_for', { time: 1, selector: 'x' }), /invalid arguments/],
    ['a wrongly typed argument', call('browser_wait_for', { time: 'soon' }), /invalid arguments/],
    ['a snapshot written to a file', call('browser_snapshot', { filename: 'x.yml' }), /argument 'filename' is not allowed/],
    ['a host not in allowedDomains', call('browser_navigate', { url: 'https://evil.example/' }), /navigation refused: .*'evil\.example' is not in allowedDomains/],
    ['a subdomain of an allowed host', call('browser_navigate', { url: 'https://x.www.saucedemo.com/' }), /navigation refused/],
    ['HTTP for a non-localhost host', call('browser_navigate', { url: 'http://www.saucedemo.com/' }), /navigation refused: HTTP is only allowed for localhost/],
    ['a non-web scheme', call('browser_navigate', { url: 'file:///etc/passwd' }), /navigation refused/],
    ['an unparseable URL', call('browser_navigate', { url: 'not a url' }), /navigation refused: Invalid URL syntax/],
  ];

  it.each(cases)('refuses %s', async (_label, toolCall, message) => {
    const client = fakeClient(async () => ok(page('https://www.saucedemo.com/')));
    const gateway = await ToolGateway.create(client, options);
    const outcome = await gateway.call(toolCall);
    expect(textOf(outcome)).toMatch(/^Tool error: /);
    expect(textOf(outcome)).toMatch(message);
    expect(outcome.result).toMatchObject({ role: 'tool', toolCallId: 'c1', toolName: toolCall.name, isError: true });
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('allows HTTP for localhost', async () => {
    const client = fakeClient(async () => ok(page('http://localhost:8080/')));
    const gateway = await ToolGateway.create(client, options);
    const outcome = await gateway.call(call('browser_navigate', { url: 'http://localhost:8080/' }));
    expect(outcome.result.isError).toBeUndefined();
    expect(client.callTool).toHaveBeenCalledOnce();
  });
});

describe('ToolGateway limits, timeout and errors', () => {
  it('stops at the tool-call limit without calling the server again', async () => {
    const client = fakeClient(async () => ok(page('https://www.saucedemo.com/')));
    const gateway = await ToolGateway.create(client, { ...options, maxToolCalls: 2 });
    await gateway.call(call('browser_snapshot'));
    await gateway.call(call('browser_snapshot'));
    const third = await gateway.call(call('browser_snapshot'));
    expect(third.stopReason).toBe('tool_call_limit');
    expect(textOf(third)).toBe('Tool error: tool call limit (2) reached');
    expect(textOf(await gateway.call(call('browser_snapshot')))).toMatch(/session has stopped \(tool_call_limit\)/);
    expect(gateway.stopReason).toBe('tool_call_limit');
    expect(client.callTool).toHaveBeenCalledTimes(2);
  });

  it('times out a call that does not answer and aborts the request', async () => {
    let seen: AbortSignal | undefined;
    const client = fakeClient((_n, _a, opts) => { seen = opts.signal; return new Promise(() => undefined); });
    const gateway = await ToolGateway.create(client, { ...options, callTimeoutMs: 50 });
    const outcome = await gateway.call(call('browser_wait_for', { time: 5 }));
    expect(textOf(outcome)).toBe('Tool error: timed out after 50 ms');
    expect(seen?.aborted).toBe(true);
  });

  it('honours the caller AbortSignal, before and during a call', async () => {
    const client = fakeClient(() => new Promise(() => undefined));
    const gateway = await ToolGateway.create(client, options);
    const controller = new AbortController();
    const pending = gateway.call(call('browser_snapshot'), controller.signal);
    controller.abort();
    expect(textOf(await pending)).toBe('Tool error: cancelled');
    expect(textOf(await gateway.call(call('browser_snapshot'), controller.signal))).toBe('Tool error: cancelled');
    expect(client.callTool).toHaveBeenCalledOnce();
  });

  it('returns an MCP tool error and a thrown client error as Tool error text', async () => {
    const client = fakeClient(async (name) => {
      if (name === 'browser_wait_for') throw new Error('connection closed');
      return { content: [{ type: 'text', text: '### Error\nError: net::ERR_NAME_NOT_RESOLVED' }], isError: true };
    });
    const gateway = await ToolGateway.create(client, options);
    expect(textOf(await gateway.call(call('browser_navigate', { url: 'https://www.saucedemo.com/' }))))
      .toBe('Tool error: ### Error\nError: net::ERR_NAME_NOT_RESOLVED');
    expect(textOf(await gateway.call(call('browser_wait_for', { time: 1 })))).toBe('Tool error: connection closed');
  });
});

describe('ToolGateway results', () => {
  it('stops with domain_violation when the page ends up off-domain, and withholds the content', async () => {
    const client = fakeClient(async () => ok(page('https://evil.example/landing', 'SECRET-OFF-DOMAIN-TEXT')));
    const gateway = await ToolGateway.create(client, options);
    const outcome = await gateway.call(call('browser_navigate', { url: 'https://www.saucedemo.com/redirect' }));
    expect(outcome.stopReason).toBe('domain_violation');
    expect(outcome.evidence).toBeUndefined();
    expect(textOf(outcome)).toMatch(/^Tool error: domain_violation: .*evil\.example.*page content withheld$/);
    expect(textOf(outcome)).not.toContain('SECRET-OFF-DOMAIN-TEXT');
    expect(textOf(await gateway.call(call('browser_snapshot')))).toMatch(/session has stopped \(domain_violation\)/);
    expect(client.callTool).toHaveBeenCalledOnce();
  });

  it('returns text only, replacing image items with a note', async () => {
    const client = fakeClient(async () => ({
      content: [{ type: 'text', text: page('https://www.saucedemo.com/') }, { type: 'image', data: 'AAAA', mimeType: 'image/png' }],
    }));
    const gateway = await ToolGateway.create(client, options);
    const outcome = await gateway.call(call('browser_navigate', { url: 'https://www.saucedemo.com/' }));
    expect(textOf(outcome)).toContain('[image content omitted: text-only results]');
    expect(textOf(outcome)).not.toContain('AAAA');
    expect(outcome.evidence).toBeUndefined();
  });

  it('hands back each snapshot as raw evidence with its own ID, also shown to the model', async () => {
    const snapshot = page('https://www.saucedemo.com/', '### Snapshot\n- button "Login" [ref=e3]');
    const gateway = await ToolGateway.create(fakeClient(async () => ok(snapshot)), options);
    const first = await gateway.call(call('browser_snapshot'));
    const second = await gateway.call(call('browser_snapshot', {}, 'c2'));
    expect(first.evidence).toEqual({ id: 'ev-001', toolName: 'browser_snapshot', text: snapshot });
    expect(second.evidence?.id).toBe('ev-002');
    expect(textOf(first)).toBe(`Evidence ID: ev-001\n${snapshot}`);
    expect(second.result.toolCallId).toBe('c2');
  });
});

describe('ToolGateway interactive mode and credentials (Task Q2)', () => {
  const PASSWORD = 'PASSWORD-SENTINEL-q2-7f3a';
  const USERNAME = 'USERNAME-SENTINEL-q2-1c9d';
  const INTERACTIVE_SERVER_TOOLS: Tool[] = [
    ...SERVER_TOOLS,
    { name: 'browser_type', description: 'Type', inputSchema: schema({ target: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } }, ['target', 'text']) },
    { name: 'browser_select_option', description: 'Select', inputSchema: schema({ target: { type: 'string' }, values: { type: 'array', items: { type: 'string' } } }, ['target', 'values']) },
    { name: 'browser_press_key', description: 'Key', inputSchema: schema({ key: { type: 'string' } }, ['key']) },
    { name: 'browser_file_upload', description: 'Upload', inputSchema: schema({ paths: { type: 'array' } }) },
    { name: 'browser_evaluate', description: 'Evaluate', inputSchema: schema({ function: { type: 'string' } }) },
    { name: 'browser_run_code', description: 'Run code', inputSchema: schema({ code: { type: 'string' } }) },
    { name: 'browser_handle_dialog', description: 'Dialog', inputSchema: schema({ accept: { type: 'boolean' } }) },
    { name: 'browser_tabs', description: 'Tabs', inputSchema: schema({ action: { type: 'string' } }) },
  ];
  const interactive = {
    ...options,
    mode: 'interactive' as const,
    credentials: { standard_user: { username: USERNAME, password: PASSWORD } },
  };
  function interactiveClient(callTool: Parameters<typeof fakeClient>[0]) {
    return { listTools: vi.fn(async () => INTERACTIVE_SERVER_TOOLS), callTool: vi.fn(callTool) };
  }

  it('read-only mode keeps refusing the interactive tools; interactive mode offers them and nothing else', async () => {
    const readOnly = await ToolGateway.create(interactiveClient(async () => ok('')), options);
    expect(readOnly.tools.map((t) => t.name)).not.toContain('browser_type');

    const gateway = await ToolGateway.create(interactiveClient(async () => ok('')), interactive);
    expect(gateway.tools.map((t) => t.name)).toEqual([
      'browser_navigate', 'browser_snapshot', 'browser_navigate_back', 'browser_wait_for',
      'browser_click', 'browser_type', 'browser_select_option', 'browser_press_key',
    ]);
  });

  it.each(['browser_file_upload', 'browser_evaluate', 'browser_run_code', 'browser_handle_dialog', 'browser_tabs'])(
    'interactive mode still refuses %s without calling the server', async (name) => {
      const client = interactiveClient(async () => ok(''));
      const gateway = await ToolGateway.create(client, interactive);
      const outcome = await gateway.call(call(name, {}));
      expect(textOf(outcome)).toMatch(new RegExp(`tool '${name}' is not allowed`));
      expect(client.callTool).not.toHaveBeenCalled();
    });

  it('the domain guard is unchanged in interactive mode: off-domain navigation is refused, an off-domain click stops the session', async () => {
    const client = interactiveClient(async () => ok(page('https://evil.example/')));
    const gateway = await ToolGateway.create(client, interactive);
    expect(textOf(await gateway.call(call('browser_navigate', { url: 'https://evil.example/' })))).toMatch(/navigation refused/);
    expect(client.callTool).not.toHaveBeenCalled();
    const click = await gateway.call(call('browser_click', { ref: 'e1' }));
    expect(click.stopReason).toBe('domain_violation');
    expect(textOf(click)).toMatch(/page content withheld/);
  });

  it('replaces credential placeholders in browser_type text and redacts the value in what comes back', async () => {
    const client = interactiveClient(async (_name, args) =>
      ok(page('https://www.saucedemo.com/', `await page.getByRole('textbox').fill('${String(args.text)}');`)));
    const gateway = await ToolGateway.create(client, interactive);
    const outcome = await gateway.call(call('browser_type', { target: 'e2', text: 'pw={{credential:standard_user.password}}', submit: true }));

    expect(client.callTool).toHaveBeenCalledWith('browser_type', { target: 'e2', text: `pw=${PASSWORD}`, submit: true }, expect.anything());
    expect(outcome.result.isError).toBeUndefined();
    expect(textOf(outcome)).toContain("fill('pw=[REDACTED]')");
    expect(textOf(outcome)).not.toContain(PASSWORD);
  });

  it.each([
    ['an unknown role', '{{credential:admin.password}}'],
    ['an unknown key', '{{credential:standard_user.token}}'],
    ['an inherited property name', '{{credential:standard_user.constructor}}'],
  ])('refuses %s without calling the server', async (_label, text) => {
    const client = interactiveClient(async () => ok(''));
    const gateway = await ToolGateway.create(client, interactive);
    const outcome = await gateway.call(call('browser_type', { target: 'e2', text }));
    expect(textOf(outcome)).toMatch(/unknown credential placeholder/);
    expect(client.callTool).not.toHaveBeenCalled();
  });

  it('scrubs credential values from evidence, tool errors and thrown errors', async () => {
    const results: Array<CallToolResult | Error> = [
      ok(page('https://www.saucedemo.com/', `- textbox "Username": ${USERNAME}\n- textbox "Password": ${PASSWORD}`)),
      { content: [{ type: 'text', text: `Error: cannot type ${PASSWORD}` }], isError: true },
      new Error(`connection lost while typing ${USERNAME}`),
    ];
    const client = interactiveClient(async () => {
      const next = results.shift()!;
      if (next instanceof Error) throw next;
      return next;
    });
    const gateway = await ToolGateway.create(client, interactive);
    const snap = await gateway.call(call('browser_snapshot'));
    const toolError = await gateway.call(call('browser_type', { target: 'e2', text: '{{credential:standard_user.password}}' }));
    const thrown = await gateway.call(call('browser_type', { target: 'e1', text: '{{credential:standard_user.username}}' }));

    expect(snap.evidence?.text).toContain('- textbox "Username": [REDACTED]\n- textbox "Password": [REDACTED]');
    for (const outcome of [snap, toolError, thrown]) {
      const all = JSON.stringify(outcome);
      expect(all).not.toContain(PASSWORD);
      expect(all).not.toContain(USERNAME);
    }
    expect(textOf(toolError)).toBe('Tool error: Error: cannot type [REDACTED]');
    expect(textOf(thrown)).toBe('Tool error: connection lost while typing [REDACTED]');
  });
});
