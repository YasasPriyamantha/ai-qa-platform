/**
 * Integration tests for the explore command and observation record (Tasks P4, Q2).
 *
 * Real Playwright MCP against the local fixture site (tests/fixtures/mcp-site/),
 * with the OpenAI adapter on a fake SDK client: no network, no live API call.
 * Runs locally, not in CI (DEC-039, §3.10). Everything is written to os.tmpdir().
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeExploreCommand } from '../../../src/cli/explore-command.js';
import { createOpenAIAdapter, globalAdapterRegistry } from '../../../src/model-providers/index.js';
import { startSite, portOf } from './fixture-site.js';

const API_KEY_SENTINEL = 'sk-test-SENTINEL-API-KEY-4f1c';
const DOTENV_SENTINEL = 'DOTENV-SENTINEL-VALUE-9b2e';
const CONTINUATION_SENTINEL = 'CONTINUATION-SENTINEL-77aa';

const BUDGET = {
  maxTotalRequests: 10,
  maxInputTokensPerRequest: 30_000,
  maxOutputTokensPerRequest: 4_000,
  maxCumulativeInputTokens: 300_000,
  maxCumulativeOutputTokens: 40_000,
  window: { type: 'rolling', durationHours: 24 },
};

type Output = Record<string, unknown>;
const call = (id: string, name: string, args: object = {}): Output =>
  ({ type: 'function_call', id: `fc_${id}`, call_id: id, name, arguments: JSON.stringify(args), status: 'completed' });
const reasoning = (id: string): Output => ({ type: 'reasoning', id, summary: [], encrypted_content: `${CONTINUATION_SENTINEL}-${id}` });
const answer = (summary: unknown): Output[] =>
  [{ type: 'message', id: 'msg', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(summary), annotations: [] }] }];

/** A scripted turn, or one computed from the request (to use element references from the latest snapshot). */
type Turn = Output[] | ((body: { input: Output[] }) => Output[]);

/** Every request body the fake SDK client received in the current test. */
let requestBodies: string[] = [];

/** OpenAI adapter on a fake SDK client that returns the scripted outputs in turn. */
function fakeAdapter(script: Turn[]) {
  return createOpenAIAdapter(() => ({
    responses: {
      create: async (body) => {
        requestBodies.push(JSON.stringify(body));
        const turn = script.shift();
        if (!turn) throw new Error('script exhausted');
        const output = typeof turn === 'function' ? turn(body as unknown as { input: Output[] }) : turn;
        return { id: 'resp', status: 'completed', output, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } as never;
      },
    },
  }));
}

/** All files under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

let site: Server;
let offsite: Server;
let base: string;
beforeAll(async () => {
  offsite = await startSite('127.0.0.1');
  site = await startSite('localhost', () => `http://127.0.0.1:${portOf(offsite)}/offsite.html`);
  base = `http://localhost:${portOf(site)}`;
});
afterAll(async () => {
  await new Promise((r) => site.close(r));
  await new Promise((r) => offsite.close(r));
});

let root: string;
let configPath: string;
beforeEach(() => {
  root = join(tmpdir(), `qa-explore-it-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(root, 'project', 'tests', 'approved'), { recursive: true });
  copyFileSync(join(process.cwd(), 'config', 'ai-providers.json'), join(root, 'config', 'ai-providers.json'));
  writeFileSync(join(root, 'config', 'ai-budget.json'), JSON.stringify(BUDGET));
  writeFileSync(join(root, '.env'), `AI_ENABLED=true\nOPENAI_API_KEY=${API_KEY_SENTINEL}\nOTHER_SETTING=${DOTENV_SENTINEL}\n`);
  configPath = join(root, 'project', 'project.config.json');
  writeFileSync(configPath, JSON.stringify({
    projectId: 'fixture-site',
    name: 'Fixture site',
    baseUrl: `${base}/`,
    environment: 'local',
    allowedDomains: ['localhost'],
    testDirectory: 'tests/approved',
    artifactDirectory: 'artifacts',
  }));
  requestBodies = [];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  globalAdapterRegistry.clear();
  rmSync(root, { recursive: true, force: true });
});

/** Run explore with the scripted model and return the single exploration folder and its record. */
async function explore(script: Turn[], extra: { startUrl?: string; requirementIds?: string[] } = {}) {
  const exitCode = await executeExploreCommand({ configPath, rootDir: root, adapter: fakeAdapter(script), ...extra });
  const observations = join(root, 'project', 'observations');
  const ids = readdirSync(observations);
  expect(ids).toHaveLength(1);
  const dir = join(observations, ids[0]);
  const record = JSON.parse(readFileSync(join(dir, 'observations.json'), 'utf-8'));
  return { exitCode, dir, id: ids[0], record };
}

/** No API key, .env content or provider continuation payload anywhere in the exploration folder. */
function expectNoSecrets(dir: string): void {
  for (const file of filesUnder(dir)) {
    const text = readFileSync(file, 'utf-8');
    expect(text, file).not.toContain(API_KEY_SENTINEL);
    expect(text, file).not.toContain(DOTENV_SENTINEL);
    expect(text, file).not.toContain(CONTINUATION_SENTINEL);
  }
}

describe('explore (real Playwright MCP, local fixture site, fake model)', () => {
  it('a successful exploration writes an evidence-backed record', async () => {
    const { exitCode, dir, id, record } = await explore([
      [reasoning('rs_1'), call('c1', 'browser_navigate', { url: `${base}/` })],
      [reasoning('rs_2'), call('c2', 'browser_snapshot')],
      answer({
        pages: [{
          url: `${base}/`,
          title: 'Fixture Home',
          evidenceIds: ['ev-001'],
          elements: [{ role: 'heading', name: 'Fixture Home', evidenceIds: ['ev-001'] }],
          forms: [],
          links: [{ name: 'About', url: `${base}/about.html`, evidenceIds: ['ev-001'] }, { name: 'Notice', url: `${base}/injection.html`, evidenceIds: [] }],
          actions: [],
        }],
        blockers: [],
      }),
    ]);

    expect(exitCode).toBe(0);
    expect(id).toMatch(/^exp-\d{8}T\d{6}Z-[0-9a-f]{6}$/);
    expect(record).toMatchObject({
      schemaVersion: 2,
      explorationId: id,
      projectId: 'fixture-site',
      releaseId: null,
      startUrl: `${base}/`,
      provider: { providerId: 'openai', modelId: expect.any(String) },
      limits: { maxAiRequests: 10, maxToolCalls: expect.any(Number), budget: { maxCumulativeInputTokens: 300_000 } },
      usage: { aiRequests: 3, toolCalls: 2, inputTokens: 300, outputTokens: 60 },
      stopReason: 'completed',
      error: null,
      pagesVisited: [`${base}/`],
      evidence: [{ id: 'ev-001', toolName: 'browser_snapshot', file: 'evidence/ev-001.txt' }],
    });
    expect(Date.parse(record.startedAt)).toBeLessThanOrEqual(Date.parse(record.finishedAt));

    // Tool-call log: name, checked arguments, duration, error flag, evidence ID; no page text.
    expect(record.toolCalls).toMatchObject([
      { tool: 'browser_navigate', arguments: { url: `${base}/` }, error: false, pageUrl: `${base}/` },
      { tool: 'browser_snapshot', arguments: {}, error: false, evidenceId: 'ev-001' },
    ]);
    expect(record.toolCalls[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(record.toolCalls)).not.toContain('Fixture Home');

    // Raw evidence is kept as a file and may contain element references; the summary never does.
    const evidence = readFileSync(join(dir, 'evidence', 'ev-001.txt'), 'utf-8');
    expect(evidence).toContain('heading "Fixture Home"');
    expect(evidence).toMatch(/\[ref=e\d+\]/);
    expect(JSON.stringify(record)).not.toMatch(/ref\s*=\s*e\d+/i);

    // Summary: claims linked to evidence, unsupported ones kept and flagged.
    const page = record.summary.pages[0];
    expect(page.unsupported).toBe(false);
    expect(page.elements[0]).toMatchObject({ role: 'heading', name: 'Fixture Home', unsupported: false });
    expect(page.links.map((l: { unsupported: boolean }) => l.unsupported)).toEqual([false, true]);

    // The MCP server's own output stays inside the exploration folder.
    expect(existsSync(join(dir, 'mcp-output'))).toBe(true);
    expectNoSecrets(dir);
  }, 120_000);

  it('a domain violation ends with stop reason domain_violation and leaves no off-domain evidence', async () => {
    const { dir, record } = await explore([
      [reasoning('rs_1'), call('c1', 'browser_navigate', { url: `${base}/redirect-away` })],
      answer({ pages: [], blockers: [] }),
    ]);

    expect(record.stopReason).toBe('domain_violation');
    expect(record.usage).toMatchObject({ aiRequests: 2, toolCalls: 1 });
    expect(record.toolCalls).toMatchObject([{ tool: 'browser_navigate', error: true }]);
    expect(record.toolCalls[0].pageUrl).toBeUndefined();
    expect(record.pagesVisited).toEqual([]);
    expect(record.evidence).toEqual([]);
    expect(readdirSync(join(dir, 'evidence'))).toEqual([]);
    expect(readFileSync(join(dir, 'observations.json'), 'utf-8')).not.toContain('127.0.0.1');
    // The MCP server writes the page it landed on to its output folder; none of it may remain.
    for (const file of filesUnder(dir)) expect(readFileSync(file, 'utf-8'), file).not.toContain('OFF-DOMAIN-CONTENT-MARKER');
    expectNoSecrets(dir);
  }, 120_000);

  it('interactive mode logs in with credential placeholders and reaches the page behind the login; the credential is never stored or sent', async () => {
    const USERNAME = 'fixture-USERNAME-SENTINEL-8d2c';
    const PASSWORD = 'fixture-PASSWORD-SENTINEL-31b7'; // the fixture login page accepts only these
    writeFileSync(join(root, '.env'), `AI_ENABLED=true\nOPENAI_API_KEY=${API_KEY_SENTINEL}\nFIXTURE_MEMBER_USER=${USERNAME}\nFIXTURE_MEMBER_PASSWORD=${PASSWORD}\n`);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    writeFileSync(configPath, JSON.stringify({
      ...config,
      exploration: { mode: 'interactive' },
      roles: [{ roleId: 'member', name: 'Member', credentials: { username: 'FIXTURE_MEMBER_USER', password: 'FIXTURE_MEMBER_PASSWORD' } }],
    }));
    mkdirSync(join(root, 'project', 'requirements'), { recursive: true });
    writeFileSync(join(root, 'project', 'requirements', 'registry.json'), JSON.stringify({
      schemaVersion: '1.0', updatedAt: new Date().toISOString(),
      requirements: { 'REQ-001': { requirementId: 'REQ-001', status: 'active', title: 'Member login', description: 'A member logs in.', expectedResult: 'The Members Area is shown.' } },
    }));

    /** The element reference of a textbox in the latest snapshot the model was sent. */
    const refOf = (body: { input: Output[] }, label: string) => {
      const latest = body.input.filter((i) => i.type === 'function_call_output').map((i) => String(i.output)).reverse()
        .find((text) => text.startsWith('Evidence ID:'));
      const match = latest?.match(new RegExp(`textbox "${label}" \\[ref=(e\\d+)\\]`));
      if (!match) throw new Error(`no textbox "${label}" in the latest snapshot`);
      return match[1];
    };

    const { exitCode, dir, record } = await explore([
      [call('c1', 'browser_navigate', { url: `${base}/login.html` })],
      [call('c2', 'browser_snapshot')],
      (body) => [call('c3', 'browser_type', { target: refOf(body, 'Username'), text: '{{credential:member.username}}' })],
      (body) => [call('c4', 'browser_type', { target: refOf(body, 'Password'), text: '{{credential:member.password}}', submit: true })],
      [call('c5', 'browser_wait_for', { text: 'Members Area' })],
      [call('c6', 'browser_snapshot')],
      answer({
        pages: [{
          url: `${base}/members.html`,
          title: 'Fixture Members',
          evidenceIds: ['ev-002'],
          elements: [{ role: 'heading', name: 'Members Area', evidenceIds: ['ev-002'] }],
          forms: [],
          links: [],
          actions: [{ role: 'button', name: 'Log out', evidenceIds: ['ev-002'] }, { role: 'button', name: 'Checkout', evidenceIds: ['ev-002'] }],
        }],
        blockers: [],
      }),
    ], { startUrl: `${base}/login.html`, requirementIds: ['REQ-001'] });

    expect(exitCode).toBe(0);
    expect(record).toMatchObject({ schemaVersion: 2, requirementIds: ['REQ-001'], stopReason: 'completed' });
    expect(record.toolCalls.map((c: { error: boolean }) => c.error)).toEqual([false, false, false, false, false, false]);
    expect(record.toolCalls[3].arguments.text).toBe('{{credential:member.password}}');
    expect(record.pagesVisited).toContain(`${base}/members.html`);
    expect(readFileSync(join(dir, 'evidence', 'ev-002.txt'), 'utf-8')).toContain('heading "Members Area"');
    expect(record.summary.pages[0].actions.map((a: { unsupported: boolean }) => a.unsupported)).toEqual([false, true]);

    // The model saw the requirement and the placeholders, never a credential value.
    expect(requestBodies[0]).toContain('REQ-001: Member login');
    expect(requestBodies[0]).toContain('{{credential:member.password}}');
    // The real server echoes the typed value in its result; the gateway redacted it before the model saw it.
    expect(requestBodies.at(-1)).toContain('[REDACTED]');
    for (const body of requestBodies) {
      expect(body).not.toContain(PASSWORD);
      expect(body).not.toContain(USERNAME);
    }
    // Nothing on disk (record, evidence, MCP output) holds a credential value, and process.env was not touched.
    for (const file of filesUnder(dir)) {
      const text = readFileSync(file, 'utf-8');
      expect(text, file).not.toContain(PASSWORD);
      expect(text, file).not.toContain(USERNAME);
    }
    expect(process.env.FIXTURE_MEMBER_PASSWORD).toBeUndefined();
    expectNoSecrets(dir);
  }, 120_000);
});
