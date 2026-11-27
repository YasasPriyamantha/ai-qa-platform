/**
 * Unit tests for the AI exploration loop (Task P3).
 *
 * The OpenAI adapter runs with a fake SDK client and the P2 gateway with a fake
 * MCP client: no network, no browser, no live API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CallToolResult, Tool } from '@modelcontextprotocol/client';
import { runExploration, type ExplorationOptions } from '../../../src/exploration/loop.js';
import { EXPLORATION_SUMMARY_SCHEMA } from '../../../src/exploration/summary.js';
import { saveExplorationRecord } from '../../../src/exploration/record.js';
import { ToolGateway } from '../../../src/mcp/tool-gateway.js';
import { createOpenAIAdapter, globalAdapterRegistry, type BudgetConfig } from '../../../src/model-providers/index.js';
import { createSecretResolutionContext } from '../../../src/provider-secrets/index.js';

const BUDGET: BudgetConfig = {
  maxTotalRequests: 20,
  maxInputTokensPerRequest: 30_000,
  maxOutputTokensPerRequest: 4_000,
  maxCumulativeInputTokens: 300_000,
  maxCumulativeOutputTokens: 40_000,
  window: { type: 'rolling', durationHours: 24 },
};

const SCHEMA = { type: 'object', properties: {} } as const;
const TOOLS: Tool[] = [
  { name: 'browser_navigate', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'browser_snapshot', inputSchema: { type: 'object', properties: { filename: { type: 'string' } } } },
  { name: 'browser_navigate_back', inputSchema: SCHEMA },
  { name: 'browser_wait_for', inputSchema: { type: 'object', properties: { time: { type: 'number' } } } },
  { name: 'browser_click', inputSchema: SCHEMA },
  { name: 'browser_type', inputSchema: SCHEMA },
  { name: 'browser_select_option', inputSchema: SCHEMA },
  { name: 'browser_press_key', inputSchema: SCHEMA },
];

/** Fake MCP server: navigation sets the page (with optional redirects); snapshots describe it. */
function fakeMcp(redirects: Record<string, string> = {}) {
  let page = 'about:blank';
  let snapshots = 0;
  let typed = '';
  const callTool = vi.fn(async (name: string, args: Record<string, unknown>): Promise<CallToolResult> => {
    if (name === 'browser_navigate') page = redirects[String(args.url)] ?? String(args.url);
    // Like the real server: browser_type echoes the code it ran, and the snapshot shows the field's value.
    if (name === 'browser_type') typed = String(args.text);
    const body = name === 'browser_snapshot'
      ? `\n- Page Snapshot:\n- heading "Page ${++snapshots}" [ref=e1]\n- textbox "Password" [ref=e2]: ${typed}\nSECRET-OFFSITE-TEXT`
      : name === 'browser_type' ? `\nawait page.getByRole('textbox').fill('${typed}');` : '';
    return { content: [{ type: 'text', text: `- Page URL: ${page}${body}` }] };
  });
  return { listTools: async () => TOOLS, callTool, close: vi.fn(async () => undefined) };
}

type Output = Record<string, unknown>;
const call = (id: string, name: string, args: object = {}): Output =>
  ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args), status: 'completed' });
const reasoning = (id: string): Output => ({ type: 'reasoning', id, summary: [], encrypted_content: `enc-${id}` });
const answer = (summary: unknown): Output[] =>
  [{ type: 'message', id: 'msg', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(summary), annotations: [] }] }];

const SUMMARY = {
  pages: [{
    url: 'https://example.com/',
    title: 'Home',
    evidenceIds: ['ev-001'],
    elements: [{ role: 'heading', name: 'Page 1', evidenceIds: ['ev-001'] }],
    forms: [{ name: 'Login', fields: [{ role: 'textbox', name: 'Username' }], evidenceIds: [] }],
    links: [{ name: 'About', url: 'https://example.com/about', evidenceIds: ['ev-999'] }],
    actions: [],
  }],
  blockers: [],
};

/** Fake OpenAI SDK client returning the scripted outputs in turn and recording each request body. */
function fakeOpenAI(script: (Output[] | Error)[], delayMs = 0) {
  const bodies: Record<string, unknown>[] = [];
  const adapter = createOpenAIAdapter(() => ({
    responses: {
      create: async (body) => {
        bodies.push(structuredClone(body) as unknown as Record<string, unknown>);
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        const next = script.shift() ?? new Error('script exhausted');
        if (next instanceof Error) throw next;
        return { id: 'resp', status: 'completed', output: next, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } as never;
      },
    },
  }));
  return { adapter, bodies };
}

const inputOf = (body: Record<string, unknown>) => body.input as Output[];
const outputs = (body: Record<string, unknown>) =>
  inputOf(body).filter((i) => i.type === 'function_call_output').map((i) => String(i.output));

describe('runExploration', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `qa-explore-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, 'config'), { recursive: true });
    copyFileSync(join(process.cwd(), 'config', 'ai-providers.json'), join(root, 'config', 'ai-providers.json'));
    writeFileSync(join(root, '.env'), 'AI_ENABLED=true\nOPENAI_API_KEY=sk-test-explore-key\n');
  });

  afterEach(() => {
    globalAdapterRegistry.clear();
    rmSync(root, { recursive: true, force: true });
  });

  async function explore(
    script: (Output[] | Error)[],
    overrides: Partial<ExplorationOptions> & {
      maxToolCalls?: number; redirects?: Record<string, string>; delayMs?: number;
      gatewayOptions?: Partial<Parameters<typeof ToolGateway.create>[1]>;
    } = {}
  ) {
    const mcp = fakeMcp(overrides.redirects);
    const gateway = await ToolGateway.create(mcp, {
      allowedDomains: ['example.com'],
      maxToolCalls: overrides.maxToolCalls ?? 10,
      callTimeoutMs: 5_000,
      ...overrides.gatewayOptions,
    });
    const { adapter, bodies } = fakeOpenAI(script, overrides.delayMs);
    const result = await runExploration({
      startUrl: 'https://example.com/',
      providerId: 'openai',
      modelId: 'gpt-6-luna',
      adapter,
      secretContext: createSecretResolutionContext({
        envFilePath: join(root, '.env'),
        providerConfigPath: join(root, 'config', 'ai-providers.json'),
      }),
      budgetConfig: BUDGET,
      gateway,
      mcp,
      maxAiRequests: 10,
      maxDurationMs: 60_000,
      ...overrides,
    });
    return { result, bodies, mcp };
  }

  it('normal session: tools run through the gateway, reasoning carries over, the summary is validated and checked', async () => {
    const { result, bodies, mcp } = await explore([
      [reasoning('rs_1'), call('c1', 'browser_navigate', { url: 'https://example.com/' })],
      [reasoning('rs_2'), call('c2', 'browser_snapshot')],
      answer(SUMMARY),
    ]);

    expect(result.stopReason).toBe('completed');
    expect(result.error).toBeUndefined();
    expect(result.budgetState.requestCount).toBe(3);
    expect(result.toolCalls).toBe(2);
    expect(result.evidence.map((e) => e.id)).toEqual(['ev-001']);
    expect(result.toolLog).toMatchObject([
      { tool: 'browser_navigate', arguments: { url: 'https://example.com/' }, error: false, pageUrl: 'https://example.com/' },
      { tool: 'browser_snapshot', arguments: {}, error: false, evidenceId: 'ev-001' },
    ]);
    expect(mcp.callTool).toHaveBeenCalledTimes(2);
    expect(mcp.close).toHaveBeenCalledTimes(1);

    // Every request offers exactly the gateway tools, and asks for the summary schema.
    for (const body of bodies) {
      expect((body.tools as Output[]).map((t) => t.name)).toEqual(['browser_navigate', 'browser_snapshot', 'browser_navigate_back', 'browser_wait_for']);
      expect((body.text as { format: Output }).format.name).toBe('exploration_summary');
    }
    // Same adapter instance: earlier reasoning items are replayed, calls and results in order.
    expect(inputOf(bodies[2]).map((i) => i.type ?? i.role)).toEqual([
      'user', 'reasoning', 'function_call', 'function_call_output', 'reasoning', 'function_call', 'function_call_output',
    ]);
    expect(String(bodies[0].instructions)).toMatch(/untrusted data/);

    const page = result.summary!.pages[0];
    expect(page.unsupported).toBe(false);
    expect(page.elements[0].unsupported).toBe(false);
    expect(page.forms[0].unsupported).toBe(true); // no evidence cited
    expect(page.links[0].unsupported).toBe(true); // unknown evidence cited
  });

  it('request limit: the last request is sent without tools and asks only for the summary', async () => {
    const { result, bodies } = await explore(
      [[call('c1', 'browser_snapshot')], answer(SUMMARY)],
      { maxAiRequests: 2 }
    );

    expect(result.stopReason).toBe('ai_request_limit');
    expect(bodies).toHaveLength(2);
    expect(bodies[0].tools).toBeDefined();
    expect(bodies[1].tools).toBeUndefined();
    expect(JSON.stringify(inputOf(bodies[1]).at(-1))).toMatch(/Do not call any tools/);
    expect(result.summary?.pages[0].elements[0].unsupported).toBe(false);
  });

  it('tool-call limit: the refused call stops exploring and the summary is requested without tools', async () => {
    const { result, bodies, mcp } = await explore(
      [[call('c1', 'browser_snapshot')], [call('c2', 'browser_snapshot')], answer(SUMMARY)],
      { maxToolCalls: 1 }
    );

    expect(result.stopReason).toBe('tool_call_limit');
    expect(mcp.callTool).toHaveBeenCalledTimes(1);
    expect(outputs(bodies[2]).at(-1)).toMatch(/Tool error: tool call limit \(1\) reached/);
    expect(bodies[2].tools).toBeUndefined();
  });

  it('a refused tool and an off-domain URL are refused without calling the server, and the session continues', async () => {
    const { result, bodies, mcp } = await explore([
      [call('c1', 'browser_click'), call('c2', 'browser_navigate', { url: 'https://evil.example/' })],
      answer(SUMMARY),
    ]);

    expect(result.stopReason).toBe('completed');
    expect(mcp.callTool).not.toHaveBeenCalled();
    const [click, nav] = outputs(bodies[1]);
    expect(click).toMatch(/Tool error: tool 'browser_click' is not allowed/);
    expect(nav).toMatch(/Tool error: navigation refused/);
    expect(bodies[1].tools).toBeDefined();
  });

  it('an off-domain redirect stops with domain_violation and its content is never sent to the model', async () => {
    const { result, bodies } = await explore(
      [
        [call('c1', 'browser_navigate', { url: 'https://example.com/out' }), call('c2', 'browser_snapshot')],
        answer({ pages: [], blockers: [] }),
      ],
      { redirects: { 'https://example.com/out': 'https://evil.example/' } }
    );

    expect(result.stopReason).toBe('domain_violation');
    expect(result.evidence).toHaveLength(0);
    expect(bodies[1].tools).toBeUndefined();
    expect(outputs(bodies[1])[0]).toMatch(/domain_violation/);
    expect(outputs(bodies[1])[1]).toMatch(/browser session has stopped/);
    expect(JSON.stringify(bodies)).not.toContain('SECRET-OFFSITE-TEXT');
  });

  it('wall-clock limit: once the time is up, the summary is requested without tools', async () => {
    const { result, bodies } = await explore(
      [[call('c1', 'browser_snapshot')], answer(SUMMARY)],
      { maxDurationMs: 5, delayMs: 30 }
    );

    expect(result.stopReason).toBe('time_limit');
    expect(bodies[1].tools).toBeUndefined();
  });

  it('adapter error: the session stops with ai_error and MCP is still closed', async () => {
    const { result, mcp } = await explore([new Error('socket hang up')]);

    expect(result.stopReason).toBe('ai_error');
    expect(result.error).toMatch(/socket hang up/);
    expect(result.budgetState.requestCount).toBe(1);
    expect(mcp.close).toHaveBeenCalledTimes(1);
  });

  it('MCP is closed even when a tool call throws unexpectedly', async () => {
    const { adapter } = fakeOpenAI([[call('c1', 'browser_snapshot')]]);
    const close = vi.fn(async () => undefined);
    await expect(runExploration({
      startUrl: 'https://example.com/', providerId: 'openai', modelId: 'gpt-6-luna', adapter,
      secretContext: createSecretResolutionContext({ envFilePath: join(root, '.env'), providerConfigPath: join(root, 'config', 'ai-providers.json') }),
      budgetConfig: BUDGET,
      gateway: { tools: [], call: async () => { throw new Error('boom'); } },
      mcp: { close }, maxAiRequests: 5, maxDurationMs: 60_000,
    })).rejects.toThrow('boom');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('invalid summary: a schema mismatch or an element reference gives a clear failure', async () => {
    const missing = await explore([answer({ pages: [] })]);
    expect(missing.result.stopReason).toBe('invalid_summary');
    expect(missing.result.error).toMatch(/STRUCTURED_OUTPUT_INVALID.*blockers/);
    expect(missing.result.summary).toBeUndefined();

    const withRef = await explore([answer({ ...SUMMARY, blockers: [{ description: 'Click ref=e12 first', evidenceIds: [] }] })]);
    expect(withRef.result.stopReason).toBe('invalid_summary');
    expect(withRef.result.error).toMatch(/must not contain MCP element references/);
  });

  it('snapshot compaction: only the latest snapshot is sent in full; call/result pairing is kept', async () => {
    const { bodies } = await explore([
      [call('c1', 'browser_snapshot')],
      [call('c2', 'browser_navigate', { url: 'https://example.com/a' })],
      [call('c3', 'browser_snapshot')],
      [call('c4', 'browser_snapshot')],
      answer(SUMMARY),
    ]);

    const last = inputOf(bodies[4]);
    const calls = last.filter((i) => i.type === 'function_call').map((i) => i.call_id);
    const results = last.filter((i) => i.type === 'function_call_output');
    expect(results.map((i) => i.call_id)).toEqual(calls);
    const [snap1, nav, snap2, snap3] = results.map((i) => String(i.output));
    expect(snap1).toMatch(/^Evidence ID: ev-001\n\[Older snapshot omitted/);
    expect(snap1).not.toContain('Page 1');
    expect(nav).toContain('- Page URL: https://example.com/a');
    expect(snap2).toMatch(/Older snapshot omitted; it is kept as evidence ev-002/);
    expect(snap3).toMatch(/^Evidence ID: ev-003\n[\s\S]*heading "Page 3"/);
  });

  it('evidence-text check (§8): an element, form field or action is supported only if its name is in cited evidence', async () => {
    const { result } = await explore([
      [call('c1', 'browser_navigate', { url: 'https://example.com/' })],
      [call('c2', 'browser_snapshot')],
      answer({
        pages: [{
          ...SUMMARY.pages[0],
          elements: [
            { role: 'heading', name: 'Page   1', evidenceIds: ['ev-001'] }, // whitespace is normalised
            { role: 'heading', name: 'Invented heading', evidenceIds: ['ev-001'] },
          ],
          forms: [{ name: 'Login', fields: [{ role: 'heading', name: 'Page 1' }, { role: 'textbox', name: 'Email' }], evidenceIds: ['ev-001'] }],
          actions: [
            { role: 'heading', name: 'Page 1', evidenceIds: ['ev-001'] },
            { role: 'button', name: 'Checkout', evidenceIds: ['ev-001'] },
            { role: 'button', name: 'Page 1', evidenceIds: [] },
          ],
        }],
        blockers: [],
      }),
    ]);
    const page = result.summary!.pages[0];
    expect(page.elements.map((e) => e.unsupported)).toEqual([false, true]);
    expect(page.forms[0].unsupported).toBe(false); // the form name is not checked against the text, only its fields
    expect(page.forms[0].fields.map((f) => f.unsupported)).toEqual([false, true]);
    expect(page.actions.map((a) => a.unsupported)).toEqual([false, true, true]);
  });

  it('requirement-guided: the goal lists the requirements and credential placeholders, and asks for actions', async () => {
    const { bodies } = await explore([answer({ pages: [], blockers: [] })], {
      requirements: [{
        requirementId: 'REQ-001',
        title: 'Login with valid credentials',
        description: 'A standard user logs in from the login page.',
        expectedResult: 'The inventory page is shown.',
      }],
      credentialPlaceholders: ['{{credential:standard_user.username}}', '{{credential:standard_user.password}}'],
    });
    const instructions = String(bodies[0].instructions);
    expect(instructions).toMatch(/reach and observe the pages that the requirements/);
    expect(instructions).toMatch(/type the credential placeholders/);
    expect(instructions).toMatch(/Never submit a form or take an action that is not needed/);
    expect(instructions).toMatch(/actions \(the buttons and links/);
    const first = JSON.stringify(inputOf(bodies[0])[0]);
    for (const text of ['REQ-001: Login with valid credentials', 'A standard user logs in', 'Expected result: The inventory page is shown.',
      '{{credential:standard_user.username}}, {{credential:standard_user.password}}']) {
      expect(first).toContain(text);
    }
  });

  it('credential sentinel: the value reaches the browser but never the model, the result or the saved record', async () => {
    const SENTINEL = 'CREDENTIAL-SENTINEL-q2-55e1';
    const { result, bodies, mcp } = await explore([
      [call('c1', 'browser_navigate', { url: 'https://example.com/' })],
      [call('c2', 'browser_type', { target: 'e2', text: '{{credential:standard_user.password}}' })],
      [call('c3', 'browser_snapshot')],
      answer({ pages: [], blockers: [] }),
    ], { gatewayOptions: { mode: 'interactive', credentials: { standard_user: { password: SENTINEL } } } });

    expect(mcp.callTool).toHaveBeenCalledWith('browser_type', { target: 'e2', text: SENTINEL }, expect.anything());
    expect(result.toolLog[1]).toMatchObject({ tool: 'browser_type', arguments: { text: '{{credential:standard_user.password}}' }, error: false });
    expect(result.evidence[0].text).toContain('textbox "Password" [ref=e2]: [REDACTED]');
    expect(outputs(bodies[2]).join('\n')).toContain("fill('[REDACTED]')");
    for (const body of bodies) expect(JSON.stringify(body)).not.toContain(SENTINEL);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);

    const workspace = join(root, 'workspace');
    const limits = { maxAiRequests: 10, maxToolCalls: 10, maxDurationMs: 60_000, callTimeoutMs: 5_000, budget: BUDGET };
    saveExplorationRecord(workspace, {
      explorationId: 'exp-test', projectId: 'demo', startUrl: 'https://example.com/', requirementIds: ['REQ-001'],
      providerId: 'openai', modelId: 'gpt-6-luna', startedAt: new Date().toISOString(), limits,
    }, result);
    const files = readdirSync(workspace, { recursive: true, withFileTypes: true }).filter((e) => e.isFile());
    expect(files.length).toBe(2); // observations.json and evidence/ev-001.txt
    for (const file of files) expect(readFileSync(join(file.parentPath, file.name), 'utf-8')).not.toContain(SENTINEL);
    expect(JSON.parse(readFileSync(join(workspace, 'observations', 'exp-test', 'observations.json'), 'utf-8')))
      .toMatchObject({ schemaVersion: 2, requirementIds: ['REQ-001'] });
  });

  it('without requirements the read-only goal is unchanged', async () => {
    const { bodies } = await explore([answer({ pages: [], blockers: [] })]);
    expect(String(bodies[0].instructions)).toMatch(/explore a website read-only/);
    expect(JSON.stringify(inputOf(bodies[0])[0])).not.toMatch(/Requirements:|credential/);
  });

  it('the summary schema converts to JSON Schema for the provider', () => {
    expect(EXPLORATION_SUMMARY_SCHEMA.toJsonSchema().success).toBe(true);
  });
});
