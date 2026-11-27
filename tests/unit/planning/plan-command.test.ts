/**
 * Unit tests for the plan command and scenario planner (Task Q3).
 *
 * The OpenAI adapter runs on a fake SDK client that returns a scripted plan:
 * no network, no live API call. Everything is written to os.tmpdir().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executePlanCommand } from '../../../src/cli/plan-command.js';
import { createOpenAIAdapter, globalAdapterRegistry } from '../../../src/model-providers/index.js';

const BUDGET = {
  maxTotalRequests: 5,
  maxInputTokensPerRequest: 30_000,
  maxOutputTokensPerRequest: 4_000,
  maxCumulativeInputTokens: 100_000,
  maxCumulativeOutputTokens: 20_000,
  window: { type: 'rolling', durationHours: 24 },
};

const requirement = (requirementId: string, extra: object = {}) => ({
  projectId: 'demo', requirementId, status: 'active', priority: 'high',
  title: `${requirementId} title`, description: 'A user logs in.',
  expectedResult: 'The `Products` page\n  is shown.',
  negativeCases: [{ condition: 'Wrong password', expectedOutcome: 'The error "Username and password do not match" is shown.' }],
  ...extra,
});

const EVIDENCE = '### Snapshot\n```yaml\n- form "Login" [ref=e9]:\n  - textbox "Username" [ref=e11]\n  - textbox "Password" [ref=e13]\n  - button "Login" [ref=e15] [cursor=pointer]\n```';

const scenario = (extra: object = {}) => ({
  title: 'Valid login', requirementIds: ['REQ-001'], categories: ['functional', 'end-to-end'], priority: 'high', risk: 'high',
  role: 'standard_user', preconditions: ['Logged out'], testData: ['standard_user credentials'],
  steps: [
    { action: 'goto', target: null, value: '/', assertion: null },
    { action: 'fill', target: { role: 'textbox', name: 'Username' }, value: '{{credential:standard_user.username}}', assertion: null },
    { action: 'click', target: { role: 'button', name: 'Login' }, value: null, assertion: null },
    { action: 'expect', target: { role: 'heading', name: 'Products' }, value: null, assertion: 'visible' },
  ],
  expectedResults: [{ requirementId: 'REQ-001', quote: 'The Products page is shown.' }],
  questions: [],
  ...extra,
});

let root: string;
let workspace: string;
let configPath: string;
let requestBodies: string[];
let errors: string;

/** OpenAI adapter on a fake SDK client returning `plan` as structured output. */
const fakeAdapter = (plan: unknown) => createOpenAIAdapter(() => ({
  responses: {
    create: async (body) => {
      requestBodies.push(JSON.stringify(body));
      return {
        id: 'resp', status: 'completed',
        output: [{ type: 'message', id: 'msg', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(plan), annotations: [] }] }],
        usage: { input_tokens: 500, output_tokens: 200, total_tokens: 700 },
      } as never;
    },
  },
}));

function writeObservation(id: string, schemaVersion = 2): void {
  const dir = join(workspace, 'observations', id);
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  writeFileSync(join(dir, 'evidence', 'ev-001.txt'), EVIDENCE);
  writeFileSync(join(dir, 'observations.json'), JSON.stringify({
    schemaVersion, explorationId: id, startUrl: 'https://www.example.com/', pagesVisited: ['https://www.example.com/'],
    evidence: [{ id: 'ev-001', toolName: 'browser_snapshot', file: 'evidence/ev-001.txt' }],
    summary: { pages: [{
      url: 'https://www.example.com/inventory.html', title: 'Inventory', evidenceIds: ['ev-002'], unsupported: false,
      elements: [{ role: 'heading', name: 'Products', evidenceIds: ['ev-002'], unsupported: false }, { role: 'button', name: 'Ghost', evidenceIds: [], unsupported: true }],
      forms: [], links: [], actions: [],
    }], blockers: [] },
  }));
}

function writeRegistry(requirements: Record<string, object>): void {
  mkdirSync(join(workspace, 'requirements'), { recursive: true });
  writeFileSync(join(workspace, 'requirements', 'registry.json'), JSON.stringify({ schemaVersion: '1.0', updatedAt: new Date().toISOString(), requirements }));
}

beforeEach(() => {
  root = join(tmpdir(), `qa-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  workspace = join(root, 'project');
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
  copyFileSync(join(process.cwd(), 'config', 'ai-providers.json'), join(root, 'config', 'ai-providers.json'));
  writeFileSync(join(root, 'config', 'ai-budget.json'), JSON.stringify(BUDGET));
  writeFileSync(join(root, '.env'), 'AI_ENABLED=true\nOPENAI_API_KEY=sk-test-plan\n');
  configPath = join(workspace, 'project.config.json');
  writeFileSync(configPath, JSON.stringify({
    projectId: 'demo', name: 'Demo', baseUrl: 'https://www.example.com/', environment: 'demo',
    allowedDomains: ['www.example.com'], testDirectory: 'tests/approved', artifactDirectory: 'artifacts',
    roles: [{ roleId: 'standard_user', name: 'Standard user', credentials: { username: 'DEMO_USER', password: 'DEMO_PASSWORD' } }],
  }));
  writeRegistry({
    'REQ-001': requirement('REQ-001', { history: [{}] }),
    'REQ-002': requirement('REQ-002', { unresolved: { reason: 'Timeout not specified' } }),
    'REQ-003': requirement('REQ-003', { status: 'retired' }),
  });
  writeObservation('exp-1');
  requestBodies = [];
  errors = '';
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors += args.join(' ') + '\n'; });
});

afterEach(() => {
  vi.restoreAllMocks();
  globalAdapterRegistry.clear();
  rmSync(root, { recursive: true, force: true });
});

async function plan(output: unknown, requirementIds = ['REQ-001'], explorationIds = ['exp-1']) {
  const dir = join(workspace, 'specs', 'candidates');
  const before = existsSync(dir) ? readdirSync(dir) : [];
  const exitCode = await executePlanCommand({ configPath, rootDir: root, adapter: fakeAdapter(output), requirementIds, explorationIds });
  const files = readdirSync(dir);
  const added = files.filter((f) => !before.includes(f));
  expect(added).toHaveLength(1);
  return { exitCode, set: JSON.parse(readFileSync(join(dir, added[0]), 'utf-8')), files };
}

const output = (scenarios: unknown[], extra: object = {}) => ({ scenarios, conflicts: [], questions: [], ...extra });

describe('plan', () => {
  it('saves a valid, requirement-traced plan with allocated IDs, versions and locator sources', async () => {
    const negative = scenario({
      title: 'Wrong password', categories: ['black-box'],
      expectedResults: [{ requirementId: 'REQ-001', quote: 'Username and password do not match' }],
      steps: [{ action: 'click', target: { role: 'button', name: 'Ghost' }, value: null, assertion: null }],
    });
    const { exitCode, set, files } = await plan(output([scenario(), negative], { conflicts: ['None known'], questions: ['Which browser?'] }));

    expect(exitCode).toBe(0);
    expect(files[0]).toMatch(/^plan-\d{8}T\d{6}Z-[0-9a-f]{6}\.json$/);
    expect(set).toMatchObject({
      schemaVersion: 1, projectId: 'demo', status: 'draft', requirementIds: ['REQ-001'], explorationIds: ['exp-1'],
      stopReason: 'completed', error: null, rejected: [], notCovered: [], conflicts: ['None known'], questions: ['Which browser?'],
      usage: { aiRequests: 1, inputTokens: 500, outputTokens: 200 },
    });
    expect(set.scenarios.map((s: { scenarioId: string }) => s.scenarioId)).toEqual(['SCN-0001', 'SCN-0002']);
    expect(set.scenarios[0]).toMatchObject({ status: 'draft', requirementVersions: { 'REQ-001': 2 }, categories: ['functional', 'end-to-end'] });
    // Heading from a supported claim, textbox and button from snapshot evidence; an unsupported claim is not used.
    expect(set.scenarios[0].steps.map((s: { locatorSource: string | null }) => s.locatorSource)).toEqual([null, 'evidence', 'evidence', 'summary']);
    expect(set.scenarios[1].steps[0].locatorSource).toBe('needs-observation');

    // The model saw the requirement, placeholders, supported claims and snapshot names; never unresolved or retired requirements.
    const body = requestBodies[0];
    expect(body).toContain('REQ-001: REQ-001 title');
    expect(body).toContain('{{credential:standard_user.password}}');
    expect(body).toContain('textbox \\"Username\\"');
    expect(body).not.toContain('Ghost');
    expect(body).not.toContain('REQ-002');
  });

  it('rejects an invented expected result and an unknown requirement ID; reports missing negative cases', async () => {
    const invented = scenario({ title: 'Invented', expectedResults: [{ requirementId: 'REQ-001', quote: 'A welcome banner appears' }] });
    const unknown = scenario({ title: 'Unknown', requirementIds: ['REQ-001', 'REQ-404'] });
    const none = scenario({ title: 'No requirement', requirementIds: [], expectedResults: [] });
    const { exitCode, set } = await plan(output([scenario(), invented, unknown, none]));

    expect(exitCode).toBe(0);
    expect(set.scenarios.map((s: { title: string }) => s.title)).toEqual(['Valid login']);
    expect(set.rejected).toEqual([
      { title: 'Invented', reasons: ['expected result "A welcome banner appears" is not quoted from REQ-001'] },
      { title: 'Unknown', reasons: ['requirement REQ-404 is unknown, inactive or not in this plan'] },
      { title: 'No requirement', reasons: ['no requirement ID'] },
    ]);
    expect(set.notCovered).toEqual([{ requirementId: 'REQ-001', case: 'negative case: Wrong password' }]);
  });

  it('excludes an unresolved requirement with its reason and refuses unknown or retired ones before any request', async () => {
    const { set } = await plan(output([scenario()]), ['REQ-001', 'REQ-002']);
    expect(set.requirementIds).toEqual(['REQ-001']);
    expect(set.excluded).toEqual([{ requirementId: 'REQ-002', reason: 'Timeout not specified' }]);
    expect(requestBodies[0]).not.toContain('REQ-002');

    requestBodies = [];
    expect(await executePlanCommand({ configPath, rootDir: root, adapter: fakeAdapter(output([])), requirementIds: ['REQ-001', 'REQ-003', 'REQ-404'], explorationIds: ['exp-1'] })).toBe(1);
    expect(errors).toMatch(/Planning refused: unknown or retired requirement.*REQ-003, REQ-404/s);
    expect(requestBodies).toEqual([]);
  });

  it('refuses an observation record with an older schema version and asks to re-run explore', async () => {
    writeObservation('exp-old', 1);
    expect(await executePlanCommand({ configPath, rootDir: root, adapter: fakeAdapter(output([])), requirementIds: ['REQ-001'], explorationIds: ['exp-old'] })).toBe(1);
    expect(errors).toMatch(/schemaVersion 1 is not supported.*re-run explore/s);
    expect(requestBodies).toEqual([]);
  });

  it('never reuses a scenario ID from an existing plan or candidate file', async () => {
    await plan(output([scenario(), scenario()]));
    mkdirSync(join(workspace, 'tests', 'candidates'), { recursive: true });
    writeFileSync(join(workspace, 'tests', 'candidates', 'SCN-0007.spec.ts'), '');
    const { set, files } = await plan(output([scenario()]));
    expect(files).toHaveLength(2);
    expect(set.scenarios[0].scenarioId).toBe('SCN-0008');
  });

  it('keeps the validated scenarios and records the stop reason at the scenario limit and the budget limit', async () => {
    const { exitCode, set } = await plan(output(Array.from({ length: 22 }, () => scenario())));
    expect(exitCode).toBe(0);
    expect(set.stopReason).toBe('scenario_limit');
    expect(set.scenarios).toHaveLength(20);
    expect(set.scenarios.at(-1).scenarioId).toBe('SCN-0020');

    writeFileSync(join(root, 'config', 'ai-budget.json'), JSON.stringify({ ...BUDGET, maxInputTokensPerRequest: 10 }));
    requestBodies = [];
    const limited = await plan(output([scenario()]));
    expect(limited.exitCode).toBe(1);
    expect(limited.set).toMatchObject({ stopReason: 'budget_limit', scenarios: [], usage: { aiRequests: 0 } });
    expect(requestBodies).toEqual([]);
  });
});
