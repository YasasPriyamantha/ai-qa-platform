/**
 * Unit tests for release review (Task R2, DEC-043 §4).
 *
 * Each test builds a temporary workspace (config, plan file, approved files and a
 * release record with pending items) in os.tmpdir() and runs the real command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Lets a test make the atomic write of one file fail (criterion 4).
const failWrite = vi.hoisted(() => ({ pathPart: null as string | null }));
vi.mock('../../../src/documents/atomic-fs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/documents/atomic-fs.js')>();
  return {
    ...actual,
    atomicWriteRegistry: ((path: string, data: unknown) => (failWrite.pathPart && path.includes(failWrite.pathPart)
      ? { success: false, error: new Error('disk full') }
      : actual.atomicWriteRegistry(path, data))) as typeof actual.atomicWriteRegistry,
  };
});

const { executeReleaseReviewCommand } = await import('../../../src/cli/release-command.js');
const { executeApproveCommand, executeRejectCommand } = await import('../../../src/cli/approve-command.js');
const { parseArgs } = await import('../../../src/cli/args.js');

let root: string;
let workspace: string;
let configPath: string;
let logs: string;
const planPath = () => join(workspace, 'specs', 'candidates', 'plan-r2.json');
const releaseFile = () => join(workspace, 'releases', 'v2.json');
const approvedFile = (id: string) => join(workspace, 'tests', 'approved', `${id}.spec.ts`);
const retiredFile = (id: string) => join(workspace, 'tests', 'retired', `${id}.spec.ts`);
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf-8'));
const scenarioOf = (id: string) => readJson(planPath()).scenarios.find((s: { scenarioId: string }) => s.scenarioId === id);
const review = (decision: 'confirm' | 'keep' | 'retire', ids: string[], extra: Partial<{ reviewer: string; reason: string; releaseId: string }> = {}) =>
  executeReleaseReviewCommand({ configPath, releaseId: 'v2', reviewer: 'Dana', reason: 'Requirement retired in V2', decision, ids, ...extra });

const scenario = (n: number, requirementIds: string[]) => ({
  scenarioId: `SCN-000${n}`, title: `Scenario ${n}`, requirementIds, requirementVersions: Object.fromEntries(requirementIds.map((id) => [id, 1])),
  categories: ['functional'], priority: 'high', risk: 'medium', role: null, preconditions: [], testData: [],
  steps: [], expectedResults: [], questions: [], status: 'approved',
  approval: { reviewer: 'Dana', decidedAt: '2026-11-28T00:00:00.000Z', approvedFile: `tests/approved/SCN-000${n}.spec.ts`, approvedSha256: 'x' },
});

const affected = (n: number, requirementId: string, classification: string) => ({
  scenarioId: `SCN-000${n}`, approvedFile: `tests/approved/SCN-000${n}.spec.ts`, requirements: [{ requirementId, classification }], review: 'pending',
});

beforeEach(() => {
  root = join(tmpdir(), `qa-review-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  workspace = join(root, 'project');
  for (const dir of [join('specs', 'candidates'), join('tests', 'approved'), 'releases']) mkdirSync(join(workspace, dir), { recursive: true });
  configPath = join(workspace, 'project.config.json');
  writeFileSync(configPath, JSON.stringify({
    projectId: 'demo', name: 'Demo', baseUrl: 'http://localhost:4310', environment: 'local',
    allowedDomains: ['localhost'], testDirectory: 'tests/approved', artifactDirectory: 'artifacts', roles: [],
  }));
  writeFileSync(planPath(), JSON.stringify({
    schemaVersion: 1, planId: 'plan-r2', projectId: 'demo', status: 'generated', createdAt: '2026-11-28T00:00:00.000Z',
    requirementIds: [], excluded: [], explorationIds: [], provider: { providerId: 'openai', modelId: 'test' },
    limits: { maxScenarios: 20, maxAiRequests: 1 }, usage: { aiRequests: 1, inputTokens: 1, outputTokens: 1 },
    stopReason: 'completed', error: null, rejected: [], notCovered: [], conflicts: [], questions: [],
    scenarios: [scenario(1, ['REQ-A']), scenario(2, ['REQ-B']), scenario(3, ['REQ-C'])],
  }));
  for (const n of [1, 2, 3]) writeFileSync(approvedFile(`SCN-000${n}`), `// Approved test SCN-000${n}\r\nimport { test } from '@playwright/test';\n`);
  const req = (requirementId: string) => ({ requirementId, status: 'active', unresolved: false, contentVersion: 1, sourceContentHash: 'a'.repeat(64) });
  writeFileSync(releaseFile(), JSON.stringify({
    schemaVersion: 1, releaseId: 'v2', projectId: 'demo', createdAt: '2026-11-28T00:00:00.000Z', previousReleaseId: 'v1',
    target: { baseUrl: 'http://localhost:4310', environment: 'local' }, documents: [],
    requirements: [req('REQ-A'), req('REQ-B'), req('REQ-C')],
    comparison: [
      { requirementId: 'REQ-A', classification: 'retired', previousContentVersion: 1, currentContentVersion: 2, review: 'pending' },
      { requirementId: 'REQ-B', classification: 'changed', previousContentVersion: 1, currentContentVersion: 2, review: 'pending' },
      { requirementId: 'REQ-C', classification: 'unchanged', previousContentVersion: 1, currentContentVersion: 1, review: null },
    ],
    affectedTests: [affected(1, 'REQ-A', 'retired'), affected(2, 'REQ-B', 'changed')],
    needsTests: ['REQ-B'], reviews: [], runs: [],
  }));
  failWrite.pathPart = null;
  logs = '';
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs += args.join(' ') + '\n'; });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logs += args.join(' ') + '\n'; });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('release review: decisions (criteria 1–2)', () => {
  it('confirms flagged requirement changes and records each decision', () => {
    expect(review('confirm', ['REQ-A', 'REQ-B'], { reason: 'Matches the V2 document' })).toBe(0);
    const record = readJson(releaseFile());
    expect(record.comparison.map((c: { review: string | null }) => c.review)).toEqual(['reviewed', 'reviewed', null]);
    expect(record.affectedTests.map((t: { review: string }) => t.review)).toEqual(['pending', 'pending']);
    expect(record.reviews).toEqual([
      { itemId: 'REQ-A', action: 'confirm', reviewer: 'Dana', decidedAt: expect.any(String), reason: 'Matches the V2 document' },
      { itemId: 'REQ-B', action: 'confirm', reviewer: 'Dana', decidedAt: expect.any(String), reason: 'Matches the V2 document' },
    ]);
    expect(logs).toContain('REQ-A: confirmed');
  });

  it('keeps a test active: the file and the plan stay unchanged', () => {
    const plan = readFileSync(planPath(), 'utf-8');
    expect(review('keep', ['SCN-0002'], { reason: 'Adding a task is unchanged' })).toBe(0);
    expect(existsSync(approvedFile('SCN-0002'))).toBe(true);
    expect(readFileSync(planPath(), 'utf-8')).toBe(plan);
    const record = readJson(releaseFile());
    expect(record.affectedTests[1].review).toBe('reviewed');
    expect(record.reviews[0]).toMatchObject({ itemId: 'SCN-0002', action: 'keep', reason: 'Adding a task is unchanged' });
  });

  it('retires a test: moves the file unchanged to tests/retired/ and marks the plan scenario retired', () => {
    const content = readFileSync(approvedFile('SCN-0001'));
    expect(review('retire', ['SCN-0001'])).toBe(0);
    expect(existsSync(approvedFile('SCN-0001'))).toBe(false);
    expect(readFileSync(retiredFile('SCN-0001')).equals(content)).toBe(true);
    const s = scenarioOf('SCN-0001');
    expect(s.status).toBe('retired');
    expect(s.retirement).toEqual({ reviewer: 'Dana', decidedAt: expect.any(String), reason: 'Requirement retired in V2', releaseId: 'v2' });
    expect(s.approval.approvedFile).toBe('tests/approved/SCN-0001.spec.ts');
    expect(scenarioOf('SCN-0002').status).toBe('approved');
    const record = readJson(releaseFile());
    expect(record.affectedTests[0].review).toBe('reviewed');
    expect(record.reviews[0]).toMatchObject({ itemId: 'SCN-0001', action: 'retire' });
    expect(logs).toContain('SCN-0001: retired → tests/retired/SCN-0001.spec.ts');
  });
});

describe('release review: refusals (criteria 1–3)', () => {
  it('refuses items that are not pending or unknown, and changes nothing', () => {
    expect(review('confirm', ['REQ-C'])).toBe(1);
    expect(logs).toContain('not pending in release v2: REQ-C');
    expect(review('confirm', ['REQ-X'])).toBe(1);
    expect(logs).toContain('not in release v2: REQ-X');
    // SCN-0003 is approved but not affected in this release.
    expect(review('retire', ['SCN-0003'])).toBe(1);
    expect(logs).toContain("not in release v2's affected tests: SCN-0003");
    expect(review('confirm', ['REQ-A'], { releaseId: 'v9' })).toBe(1);
    expect(logs).toContain('release v9 does not exist');
    expect(readJson(releaseFile()).reviews).toEqual([]);
    expect(review('keep', ['SCN-0002'])).toBe(0);
    logs = '';
    expect(review('retire', ['SCN-0002'])).toBe(1);
    expect(logs).toContain('not pending in release v2: SCN-0002');
    expect(existsSync(approvedFile('SCN-0002'))).toBe(true);
  });

  it('refuses a missing reason or reviewer', () => {
    const before = readFileSync(releaseFile(), 'utf-8');
    expect(review('confirm', ['REQ-A'], { reason: '  ' })).toBe(1);
    expect(logs).toContain('--reason is required');
    expect(review('confirm', ['REQ-A'], { reviewer: '' })).toBe(1);
    expect(review('confirm', ['REQ-A'], { reviewer: 'Dana\nEve' })).toBe(1);
    expect(logs).toContain('--reviewer must be a name on one line');
    expect(readFileSync(releaseFile(), 'utf-8')).toBe(before);
  });

  it('retired is final for release review, approve and reject', () => {
    expect(review('retire', ['SCN-0001'])).toBe(0);
    // Make SCN-0001 pending again in the record to show that the plan status alone blocks it.
    const record = readJson(releaseFile());
    writeFileSync(releaseFile(), JSON.stringify({ ...record, affectedTests: record.affectedTests.map((t: object) => ({ ...t, review: 'pending' })) }));
    logs = '';
    expect(review('keep', ['SCN-0001'])).toBe(1);
    expect(logs).toContain('SCN-0001 (retired)');
    for (const decide of [
      () => executeApproveCommand({ configPath, scenarioIds: ['SCN-0001'], reviewer: 'Dana' }),
      () => executeRejectCommand({ configPath, scenarioIds: ['SCN-0001'], reviewer: 'Dana', reason: 'x' }),
    ]) {
      logs = '';
      expect(decide()).toBe(1);
      expect(logs).toContain('approved, rejected and retired scenarios are final');
    }
    expect(scenarioOf('SCN-0001').status).toBe('retired');
  });

  it('never overwrites an existing file in tests/retired/', () => {
    mkdirSync(join(workspace, 'tests', 'retired'));
    writeFileSync(retiredFile('SCN-0001'), 'older');
    expect(review('retire', ['SCN-0001'])).toBe(1);
    expect(logs).toContain('already exists and is never overwritten');
    expect(readFileSync(retiredFile('SCN-0001'), 'utf-8')).toBe('older');
    expect(existsSync(approvedFile('SCN-0001'))).toBe(true);
    expect(scenarioOf('SCN-0001').status).toBe('approved');
  });

  it('refuses to retire when tests/retired/ would be inside the Playwright test folder', () => {
    writeFileSync(configPath, JSON.stringify({ ...readJson(configPath), testDirectory: 'tests' }));
    expect(review('retire', ['SCN-0001'])).toBe(1);
    expect(logs).toContain('so retired tests would still run');
    expect(existsSync(approvedFile('SCN-0001'))).toBe(true);
  });
});

describe('release review: rollback (criterion 4)', () => {
  for (const [what, pathPart] of [['the release record', 'v2.json'], ['the plan file', 'plan-r2.json']] as const) {
    it(`moves the file back and leaves the records unchanged when writing ${what} fails`, () => {
      const plan = readJson(planPath());
      const release = readFileSync(releaseFile(), 'utf-8');
      const content = readFileSync(approvedFile('SCN-0001'));
      failWrite.pathPart = pathPart;
      expect(review('retire', ['SCN-0001'])).toBe(1);
      expect(logs).toContain('Moved files were moved back');
      expect(readFileSync(approvedFile('SCN-0001')).equals(content)).toBe(true);
      expect(existsSync(retiredFile('SCN-0001'))).toBe(false);
      expect(readJson(planPath())).toEqual(plan);
      expect(readFileSync(releaseFile(), 'utf-8')).toBe(release);
    });
  }
});

describe('release review: arguments', () => {
  const base = ['release', 'review', '--config', 'p.json', '--release', 'v2', '--reviewer', 'Dana', '--reason', 'Why'];
  it('parses exactly one decision with its ID flag', () => {
    expect(parseArgs([...base, '--scenario', 'SCN-0001,SCN-0002', '--retire']).releaseOptions).toEqual({
      action: 'review', configPath: 'p.json', releaseId: 'v2', reviewer: 'Dana', reason: 'Why', decision: 'retire', ids: ['SCN-0001', 'SCN-0002'],
    });
    expect(parseArgs([...base, '--requirement', 'REQ-A', '--confirm']).releaseOptions).toMatchObject({ decision: 'confirm', ids: ['REQ-A'] });
    expect(parseArgs([...base, '--scenario', 'SCN-0001', '--keep', '--retire']).errors).toEqual(['release review needs exactly one of --confirm, --keep or --retire']);
    expect(parseArgs([...base, '--scenario', 'SCN-0001']).errors).toEqual(['release review needs exactly one of --confirm, --keep or --retire']);
    expect(parseArgs([...base, '--scenario', 'SCN-0001', '--confirm']).errors).toEqual(['--confirm takes --requirement, not --scenario']);
    expect(parseArgs([...base, '--keep']).errors).toEqual(['--keep requires --scenario with one or more IDs']);
    expect(parseArgs(['release', 'review', '--config', 'p.json', '--release', 'v2', '--scenario', 'SCN-0001', '--keep']).errors)
      .toEqual(['--reviewer requires a value', '--reason requires a value']);
  });
});
