/**
 * Unit tests for release create (Task R1, DEC-043 §1–§3).
 *
 * Each test builds a temporary workspace (config, document registry, requirement
 * registry, plan file) in os.tmpdir() and runs the real command.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeReleaseCreateCommand } from '../../../src/cli/release-command.js';
import { parseArgs } from '../../../src/cli/args.js';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const DOC = 'demo-requirements';

let root: string;
let workspace: string;
let configPath: string;
let logs: string;
const registryPath = () => join(workspace, 'requirements', 'registry.json');
const releaseFile = (id: string) => join(workspace, 'releases', `${id}.json`);
const readRelease = (id: string) => JSON.parse(readFileSync(releaseFile(id), 'utf-8'));
const create = (releaseId: string) => executeReleaseCreateCommand({ configPath, releaseId });
const classes = (id: string) => Object.fromEntries(readRelease(id).comparison.map((c: { requirementId: string; classification: string }) => [c.requirementId, c.classification]));

const requirement = (id: string, hash = H1) => ({
  projectId: 'demo', requirementId: id, status: 'active', priority: 'high', title: id, description: `${id} description`,
  expectedResult: 'Shown.', negativeCases: [], sourceReference: { documentId: DOC, contentHash: hash },
});

const scenario = (n: number, requirementIds: string[], status = 'approved') => ({
  scenarioId: `SCN-000${n}`, title: `Scenario ${n}`, requirementIds, requirementVersions: Object.fromEntries(requirementIds.map((id) => [id, 1])),
  categories: ['functional'], priority: 'high', risk: 'medium', role: null, preconditions: [], testData: [],
  steps: [], expectedResults: [], questions: [], status,
  ...(status === 'approved' ? { approval: { reviewer: 'Dana', decidedAt: '2026-11-28T00:00:00.000Z', approvedFile: `tests/approved/SCN-000${n}.spec.ts`, approvedSha256: 'x' } } : {}),
});

function writeRegistries(requirements: Record<string, unknown>, documentHashes: string[]): void {
  writeFileSync(registryPath(), JSON.stringify({ schemaVersion: '1.0', updatedAt: '2026-11-28T00:00:00.000Z', requirements }));
  writeFileSync(join(workspace, 'documents', 'documents.json'), JSON.stringify({
    schemaVersion: '1.0', updatedAt: '2026-11-28T00:00:00.000Z',
    documents: { [DOC]: { documentId: DOC, versions: documentHashes.map((contentHash) => ({ contentHash })) } },
  }));
}

function writePlan(scenarios: unknown[]): void {
  writeFileSync(join(workspace, 'specs', 'candidates', 'plan-r1.json'), JSON.stringify({
    schemaVersion: 1, planId: 'plan-r1', projectId: 'demo', status: 'generated', createdAt: '2026-11-28T00:00:00.000Z',
    requirementIds: [], excluded: [], explorationIds: [], provider: { providerId: 'openai', modelId: 'test' },
    limits: { maxScenarios: 20, maxAiRequests: 1 }, usage: { aiRequests: 1, inputTokens: 1, outputTokens: 1 },
    stopReason: 'completed', error: null, rejected: [], notCovered: [], conflicts: [], questions: [], scenarios,
  }));
}

beforeEach(() => {
  root = join(tmpdir(), `qa-release-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  workspace = join(root, 'project');
  for (const dir of ['requirements', 'documents', join('specs', 'candidates'), join('tests', 'approved')]) mkdirSync(join(workspace, dir), { recursive: true });
  configPath = join(workspace, 'project.config.json');
  writeFileSync(configPath, JSON.stringify({
    projectId: 'demo', name: 'Demo', baseUrl: 'http://localhost:4310', environment: 'local',
    allowedDomains: ['localhost'], testDirectory: 'tests/approved', artifactDirectory: 'artifacts', roles: [],
  }));
  writeRegistries({ 'REQ-A': requirement('REQ-A'), 'REQ-B': requirement('REQ-B'), 'REQ-C': requirement('REQ-C'), 'REQ-D': requirement('REQ-D'), 'REQ-E': requirement('REQ-E') }, [H1]);
  writePlan([scenario(1, ['REQ-A']), scenario(2, ['REQ-E']), scenario(3, ['REQ-B', 'REQ-E']), scenario(4, ['REQ-C'], 'validated'), scenario(5, ['REQ-D'])]);
  logs = '';
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs += args.join(' ') + '\n'; });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logs += args.join(' ') + '\n'; });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('release create: first release (criteria 1–3, 5)', () => {
  it('snapshots every requirement as new with no previous release, nothing affected', () => {
    expect(create('v1')).toBe(0);
    const record = readRelease('v1');
    expect(record).toMatchObject({
      schemaVersion: 1, releaseId: 'v1', projectId: 'demo', previousReleaseId: null,
      target: { baseUrl: 'http://localhost:4310', environment: 'local' },
      documents: [{ documentId: DOC, contentHash: H1 }], affectedTests: [], reviews: [], runs: [],
    });
    expect(record.requirements[0]).toEqual({ requirementId: 'REQ-A', status: 'active', unresolved: false, contentVersion: 1, sourceContentHash: H1 });
    expect(Object.values(classes('v1'))).toEqual(['new', 'new', 'new', 'new', 'new']);
    // REQ-C has only a validated (not approved) scenario.
    expect(record.needsTests).toEqual(['REQ-C']);
    expect(logs).toContain('Previous release: none (first release)');
    expect(logs).toContain('REQ-A: new');
    expect(logs).toContain('Needs tests: REQ-C');
    expect(readdirSync(join(workspace, 'releases'))).toEqual(['v1.json']);
  });
});

describe('release create: comparison and affected tests (criteria 2–5)', () => {
  beforeEach(() => {
    expect(create('v1')).toBe(0);
    // V2 document: REQ-A changed, REQ-B retired, REQ-C became unresolved, REQ-D absent, REQ-E unchanged, REQ-F new.
    const old = (id: string) => ({ ...requirement(id), supersededAt: '2026-11-28T00:00:00.000Z' });
    writeRegistries({
      'REQ-A': { ...requirement('REQ-A', H2), expectedResult: 'Shown differently.', history: [old('REQ-A')] },
      'REQ-B': { ...requirement('REQ-B', H2), status: 'retired', history: [old('REQ-B')] },
      'REQ-C': { ...requirement('REQ-C', H2), unresolved: { reason: 'Which message?' }, history: [old('REQ-C')] },
      'REQ-D': requirement('REQ-D', H1),
      'REQ-E': requirement('REQ-E', H2),
      'REQ-F': requirement('REQ-F', H2),
    }, [H1, H2]);
  });

  it('classifies each requirement by ID against the previous release', () => {
    expect(create('v2')).toBe(0);
    const record = readRelease('v2');
    expect(record.previousReleaseId).toBe('v1');
    expect(record.documents).toEqual([{ documentId: DOC, contentHash: H2 }]);
    expect(classes('v2')).toEqual({ 'REQ-A': 'changed', 'REQ-B': 'retired', 'REQ-C': 'unresolved', 'REQ-D': 'missing', 'REQ-E': 'unchanged', 'REQ-F': 'new' });
    expect(record.comparison[0]).toEqual({ requirementId: 'REQ-A', classification: 'changed', previousContentVersion: 1, currentContentVersion: 2, review: 'pending' });
    const pending = record.comparison.filter((c: { review: string | null }) => c.review === 'pending').map((c: { requirementId: string }) => c.requirementId);
    expect(pending).toEqual(['REQ-A', 'REQ-B', 'REQ-C', 'REQ-D']);
    expect(logs).toContain('REQ-A: changed (version 1 → 2), pending confirmation');
    expect(logs).toContain('Unchanged requirements: 1');
  });

  it('flags approved scenarios linked to flagged requirements through the plan files', () => {
    expect(create('v2')).toBe(0);
    const record = readRelease('v2');
    expect(record.affectedTests).toEqual([
      { scenarioId: 'SCN-0001', approvedFile: 'tests/approved/SCN-0001.spec.ts', requirements: [{ requirementId: 'REQ-A', classification: 'changed' }], review: 'pending' },
      { scenarioId: 'SCN-0003', approvedFile: 'tests/approved/SCN-0003.spec.ts', requirements: [{ requirementId: 'REQ-B', classification: 'retired' }, { requirementId: 'REQ-E', classification: 'unchanged' }], review: 'pending' },
      { scenarioId: 'SCN-0005', approvedFile: 'tests/approved/SCN-0005.spec.ts', requirements: [{ requirementId: 'REQ-D', classification: 'missing' }], review: 'pending' },
    ]);
    // SCN-0002 (unchanged) stays active; SCN-0004 is not approved.
    // REQ-A's approved test is for version 1, REQ-F has none.
    expect(record.needsTests).toEqual(['REQ-A', 'REQ-F']);
    expect(logs).toContain('SCN-0003 tests/approved/SCN-0003.spec.ts: REQ-B (retired), REQ-E (unchanged)');
    expect(logs).toContain('Needs tests: REQ-A, REQ-F');
  });

  it('chooses the most recently created release as the previous one, not the last by name', () => {
    expect(create('a')).toBe(0);
    const setCreatedAt = (id: string, createdAt: string) => writeFileSync(releaseFile(id), JSON.stringify({ ...readRelease(id), createdAt }));
    setCreatedAt('v1', '2026-01-01T00:00:00.000Z');
    setCreatedAt('a', '2026-03-01T00:00:00.000Z');
    expect(create('z')).toBe(0);
    expect(readRelease('z').previousReleaseId).toBe('a');
    // a was created after v1, so z compares with a's snapshot: REQ-A is no longer changed.
    expect(classes('z')['REQ-A']).toBe('unchanged');
  });
});

describe('release create: refusals (criterion 1)', () => {
  it('refuses invalid release IDs and writes nothing', () => {
    for (const id of ['V1', '-v1', '.v1', 'v1/x', 'v 1', 'a'.repeat(33), '']) {
      logs = '';
      expect(create(id)).toBe(1);
      expect(logs).toContain('invalid release ID');
    }
    expect(existsSync(join(workspace, 'releases'))).toBe(false);
    expect(create('2026.12-rc')).toBe(0);
  });

  it('never overwrites an existing release', () => {
    expect(create('v1')).toBe(0);
    const before = readFileSync(releaseFile('v1'), 'utf-8');
    writeRegistries({ 'REQ-A': requirement('REQ-A') }, [H1]);
    logs = '';
    expect(create('v1')).toBe(1);
    expect(logs).toContain('release v1 already exists');
    expect(readFileSync(releaseFile('v1'), 'utf-8')).toBe(before);
  });
});

describe('release create: arguments', () => {
  it('parses release create and requires --release', () => {
    expect(parseArgs(['release', 'create', '--config', 'p.json', '--release', 'v1'])).toEqual({
      command: 'release', releaseOptions: { action: 'create', configPath: 'p.json', releaseId: 'v1' }, errors: [],
    });
    expect(parseArgs(['release', 'create', '--config', 'p.json']).errors).toEqual(['--release requires a release ID']);
    expect(parseArgs(['release', 'delete']).errors).toEqual(['release needs an action: create, review or report']);
  });
});
