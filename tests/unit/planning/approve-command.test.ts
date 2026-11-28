/**
 * Unit tests for approve and reject (Task V3, DEC-042 §3.6–§3.7).
 *
 * Candidates are written by the real generate command and marked validated in the plan
 * file, as validate records them. Everything is written to os.tmpdir().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeGenerateCommand } from '../../../src/cli/generate-command.js';
import { executeApproveCommand, executeRejectCommand } from '../../../src/cli/approve-command.js';
import { executeValidateCommand } from '../../../src/cli/validate-command.js';

const step = (action: string, target: { role: string; name: string } | null, value: string | null = null, assertion: string | null = null) =>
  ({ action, target, value, assertion, locatorSource: target ? 'evidence' : null });

const scenario = (n: number) => ({
  scenarioId: `SCN-000${n}`, title: `Scenario ${n}`, requirementIds: ['REQ-001'], requirementVersions: { 'REQ-001': 1 },
  categories: ['functional'], priority: 'high', risk: 'medium', role: null, preconditions: [], testData: [],
  steps: [step('goto', null, '/'), step('expect', null, 'Saved', 'text')],
  expectedResults: [{ requirementId: 'REQ-001', quote: 'The message `Saved` is shown.' }], questions: [], status: 'draft',
});

let root: string;
let workspace: string;
let configPath: string;
let logs: string;
const approvedDir = () => join(workspace, 'tests', 'approved');
const candidate = (id: string) => join(workspace, 'tests', 'candidates', `${id}.spec.ts`);
const planPath = () => join(workspace, 'specs', 'candidates', 'plan-v3.json');
const readPlan = () => JSON.parse(readFileSync(planPath(), 'utf-8'));
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const approve = (scenarioIds = ['SCN-0001']) => executeApproveCommand({ configPath, scenarioIds, reviewer: 'Dana Reviewer' });
const reject = (scenarioIds = ['SCN-0002']) => executeRejectCommand({ configPath, scenarioIds, reviewer: 'Dana Reviewer', reason: 'Checks only the heading.' });
const approvedFolder = () => Object.fromEntries(readdirSync(approvedDir()).map((f) => [f, readFileSync(join(approvedDir(), f), 'utf-8')]));

/** Mark scenarios validated exactly as validate records them. */
function markValidated(ids: string[]): void {
  const plan = readPlan();
  for (const s of plan.scenarios) {
    if (!ids.includes(s.scenarioId)) continue;
    s.status = 'validated';
    s.validation = {
      validatedAt: '2026-11-28T00:00:00.000Z', verdict: 'validated', reason: null, candidateSha256: sha(candidate(s.scenarioId)),
      runs: [1, 2, 3].map((n) => ({ runId: `run-${n}`, runStatus: 'passed', testStatus: 'passed' })),
    };
  }
  writeFileSync(planPath(), JSON.stringify(plan));
}

beforeEach(() => {
  root = join(tmpdir(), `qa-approve-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  workspace = join(root, 'project');
  mkdirSync(approvedDir(), { recursive: true });
  mkdirSync(join(workspace, 'specs', 'candidates'), { recursive: true });
  mkdirSync(join(workspace, 'requirements'), { recursive: true });
  writeFileSync(join(approvedDir(), 'smoke.spec.ts'), '// hand-written smoke test\n');
  configPath = join(workspace, 'project.config.json');
  writeFileSync(configPath, JSON.stringify({
    projectId: 'demo', name: 'Demo', baseUrl: 'https://www.example.com/', environment: 'demo',
    allowedDomains: ['www.example.com'], testDirectory: 'tests/approved', artifactDirectory: 'artifacts', roles: [],
  }));
  writeFileSync(join(workspace, 'requirements', 'registry.json'), JSON.stringify({
    schemaVersion: '1.0', updatedAt: new Date().toISOString(), requirements: {
      'REQ-001': { projectId: 'demo', requirementId: 'REQ-001', status: 'active', priority: 'high', title: 'Save', description: 'A user saves.', expectedResult: 'The message `Saved` is shown.', negativeCases: [] },
    },
  }));
  writeFileSync(planPath(), JSON.stringify({
    schemaVersion: 1, planId: 'plan-v3', projectId: 'demo', status: 'draft', createdAt: '2026-11-28T00:00:00.000Z',
    requirementIds: ['REQ-001'], excluded: [], explorationIds: ['exp-1'], provider: { providerId: 'openai', modelId: 'test' },
    limits: { maxScenarios: 20, maxAiRequests: 1 }, usage: { aiRequests: 1, inputTokens: 1, outputTokens: 1 },
    stopReason: 'completed', error: null, rejected: [], notCovered: [], conflicts: [], questions: [],
    scenarios: [scenario(1), scenario(2)],
  }));
  logs = '';
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs += args.join(' ') + '\n'; });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logs += args.join(' ') + '\n'; });
  expect(executeGenerateCommand({ configPath, planId: 'plan-v3', replace: false, rootDir: root })).toBe(0);
  markValidated(['SCN-0001', 'SCN-0002']);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('approve: refusals (criterion 2)', { timeout: 30_000 }, () => {
  it('refuses a scenario that is not validated', () => {
    const plan = readPlan();
    plan.scenarios[0].status = 'needs-revision';
    writeFileSync(planPath(), JSON.stringify(plan));
    expect(approve()).toBe(1);
    expect(logs).toContain('SCN-0001: not approved: status is needs-revision, not validated');
    expect(approvedFolder()).toEqual({ 'smoke.spec.ts': '// hand-written smoke test\n' });
    expect(readPlan().scenarios[0].status).toBe('needs-revision');
  });

  it('refuses a candidate file changed since validation', () => {
    appendFileSync(candidate('SCN-0001'), '// edited by hand\n');
    expect(approve()).toBe(1);
    expect(logs).toContain('SCN-0001: not approved: candidate file changed since validation');
    expect(approvedFolder()).toEqual({ 'smoke.spec.ts': '// hand-written smoke test\n' });
  });

  it('refuses when a requirement changed or was retired since planning', () => {
    const registryPath = join(workspace, 'requirements', 'registry.json');
    const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
    registry.requirements['REQ-001'].history = [{ ...registry.requirements['REQ-001'], supersededAt: '2026-11-28T00:00:00.000Z' }];
    writeFileSync(registryPath, JSON.stringify(registry));
    expect(approve()).toBe(1);
    expect(logs).toContain('SCN-0001: not approved: REQ-001: requirement changed since planning; re-plan');

    delete registry.requirements['REQ-001'].history;
    registry.requirements['REQ-001'].status = 'retired';
    writeFileSync(registryPath, JSON.stringify(registry));
    logs = '';
    expect(approve()).toBe(1);
    expect(logs).toContain('REQ-001: requirement changed since planning; re-plan');
    expect(approvedFolder()).toEqual({ 'smoke.spec.ts': '// hand-written smoke test\n' });
    expect(readPlan().scenarios[0].status).toBe('validated');
  });

  it('refuses when a file of that name exists in the approved folder, leaving it unchanged', () => {
    writeFileSync(join(approvedDir(), 'SCN-0001.spec.ts'), '// existing\n');
    expect(approve()).toBe(1);
    expect(logs).toMatch(/SCN-0001: not approved: .*SCN-0001\.spec\.ts already exists/);
    expect(approvedFolder()).toEqual({ 'smoke.spec.ts': '// hand-written smoke test\n', 'SCN-0001.spec.ts': '// existing\n' });
  });
});

describe('approve: promotion and record (criteria 1, 3, 4)', { timeout: 60_000 }, () => {
  it('shows the quotes and checks, copies the file with only the header replaced, and records the approval', () => {
    const original = readFileSync(candidate('SCN-0001'), 'utf-8');
    expect(approve()).toBe(0);

    expect(logs).toContain('Requirements: REQ-001 (version 1)');
    expect(logs).toContain('Expected (REQ-001): "The message `Saved` is shown."');
    expect(logs).toContain('Check:        text "Saved" is shown');

    const approvedPath = join(approvedDir(), 'SCN-0001.spec.ts');
    const approved = readFileSync(approvedPath, 'utf-8');
    const today = new Date().toISOString().slice(0, 10);
    const [header, ...rest] = approved.split('\n');
    expect(header).toBe(`// Approved test (DEC-042): approved by Dana Reviewer on ${today} after validation runs run-1, run-2, run-3. Do not edit; re-plan instead.`);
    expect(rest.join('\n')).toBe(original.split('\n').slice(1).join('\n'));
    expect(readFileSync(join(approvedDir(), 'smoke.spec.ts'), 'utf-8')).toBe('// hand-written smoke test\n');

    const s = readPlan().scenarios[0];
    expect(s.status).toBe('approved');
    expect(s.approval).toEqual({ reviewer: 'Dana Reviewer', decidedAt: expect.any(String), approvedFile: 'tests/approved/SCN-0001.spec.ts', approvedSha256: sha(approvedPath) });
    expect(readPlan().scenarios[1].status).toBe('validated');

    // The approved file type-checks with the platform tsconfig, as npm run typecheck checks project-data/**/*.ts.
    const modules = join(process.cwd(), 'node_modules');
    writeFileSync(join(approvedDir(), 'tsconfig.json'), JSON.stringify({
      extends: join(process.cwd(), 'tsconfig.json'),
      compilerOptions: { noEmit: true, rootDir: '.', typeRoots: [join(modules, '@types')], paths: { '@playwright/test': [join(modules, '@playwright', 'test')] } },
      files: ['SCN-0001.spec.ts'],
    }));
    const tsc = spawnSync(process.execPath, [join(modules, 'typescript', 'bin', 'tsc'), '-p', join(approvedDir(), 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf-8' });
    expect(`${tsc.stdout}${tsc.stderr}`).toBe('');
    expect(tsc.status).toBe(0);
  });

  it('approved and rejected scenarios are final for approve, reject and validate', async () => {
    expect(approve()).toBe(0);
    expect(reject()).toBe(0);
    for (const id of ['SCN-0001', 'SCN-0002']) {
      logs = '';
      expect(approve([id])).toBe(1);
      expect(reject([id])).toBe(1);
      expect(await executeValidateCommand({ configPath, planId: 'plan-v3', rootDir: root, scenarioIds: [id] })).toBe(1);
      expect(logs).toContain('already decided');
    }
    expect(Object.keys(approvedFolder()).sort()).toEqual(['SCN-0001.spec.ts', 'smoke.spec.ts']);
  });
});

describe('reject (criterion 4)', { timeout: 30_000 }, () => {
  it('records the reviewer, date and reason, and keeps the candidate file', () => {
    const before = readFileSync(candidate('SCN-0002'), 'utf-8');
    expect(reject()).toBe(0);
    const s = readPlan().scenarios[1];
    expect(s.status).toBe('rejected');
    expect(s.rejection).toEqual({ reviewer: 'Dana Reviewer', decidedAt: expect.any(String), reason: 'Checks only the heading.' });
    expect(readFileSync(candidate('SCN-0002'), 'utf-8')).toBe(before);
    expect(existsSync(join(approvedDir(), 'SCN-0002.spec.ts'))).toBe(false);
    expect(executeRejectCommand({ configPath, scenarioIds: ['SCN-0001'], reviewer: 'Dana', reason: ' ' })).toBe(1);
  });
});
