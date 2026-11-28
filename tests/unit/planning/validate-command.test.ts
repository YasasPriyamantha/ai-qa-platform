/**
 * Unit tests for the validate command's checks before running (Task V2, DEC-042 §3.5).
 *
 * Candidates are written by the real generate command, then changed or left without
 * credentials, so validate blocks them without starting Playwright. Everything is
 * written to os.tmpdir().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeGenerateCommand } from '../../../src/cli/generate-command.js';
import { executeValidateCommand } from '../../../src/cli/validate-command.js';

const step = (action: string, target: { role: string; name: string } | null, value: string | null = null, assertion: string | null = null) =>
  ({ action, target, value, assertion, locatorSource: target ? 'evidence' : null });

const scenario = (n: number, steps: object[]) => ({
  scenarioId: `SCN-000${n}`, title: `Scenario ${n}`, requirementIds: ['REQ-001'], requirementVersions: { 'REQ-001': 1 },
  categories: ['functional'], priority: 'high', risk: 'medium', role: 'user', preconditions: [], testData: [],
  steps, expectedResults: [{ requirementId: 'REQ-001', quote: 'The message `Saved` is shown.' }], questions: [], status: 'draft',
});

let root: string;
let workspace: string;
let configPath: string;
let logs: string;
const planPath = () => join(workspace, 'specs', 'candidates', 'plan-v2.json');
const readPlan = () => JSON.parse(readFileSync(planPath(), 'utf-8'));
const validate = (scenarioIds?: string[]) => executeValidateCommand({ configPath, planId: 'plan-v2', rootDir: root, ...(scenarioIds ? { scenarioIds } : {}) });

beforeEach(() => {
  root = join(tmpdir(), `qa-validate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  workspace = join(root, 'project');
  mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
  mkdirSync(join(workspace, 'specs', 'candidates'), { recursive: true });
  mkdirSync(join(workspace, 'requirements'), { recursive: true });
  configPath = join(workspace, 'project.config.json');
  writeFileSync(configPath, JSON.stringify({
    projectId: 'demo', name: 'Demo', baseUrl: 'https://www.example.com/', environment: 'demo',
    allowedDomains: ['www.example.com'], testDirectory: 'tests/approved', artifactDirectory: 'artifacts',
    roles: [{ roleId: 'user', name: 'User', credentials: { username: 'V2_TEST_USER' } }],
  }));
  writeFileSync(join(workspace, 'requirements', 'registry.json'), JSON.stringify({
    schemaVersion: '1.0', updatedAt: new Date().toISOString(), requirements: {
      'REQ-001': { projectId: 'demo', requirementId: 'REQ-001', status: 'active', priority: 'high', title: 'Save', description: 'A user saves.', expectedResult: 'The message `Saved` is shown.', negativeCases: [] },
    },
  }));
  writeFileSync(planPath(), JSON.stringify({
    schemaVersion: 1, planId: 'plan-v2', projectId: 'demo', status: 'draft', createdAt: '2026-11-28T00:00:00.000Z',
    requirementIds: ['REQ-001'], excluded: [], explorationIds: ['exp-1'], provider: { providerId: 'openai', modelId: 'test' },
    limits: { maxScenarios: 20, maxAiRequests: 1 }, usage: { aiRequests: 1, inputTokens: 1, outputTokens: 1 },
    stopReason: 'completed', error: null, rejected: [], notCovered: [], conflicts: [], questions: [],
    scenarios: [
      scenario(1, [step('goto', null, '/'), step('expect', null, 'Saved', 'text')]),
      scenario(2, [step('goto', null, '/'), step('fill', { role: 'textbox', name: 'User' }, '{{credential:user.username}}'), step('expect', null, 'Saved', 'text')]),
      { ...scenario(3, [step('goto', null, '/')]), expectedResults: [] },
    ],
  }));
  logs = '';
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs += args.join(' ') + '\n'; });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logs += args.join(' ') + '\n'; });
  vi.stubEnv('V2_TEST_USER', '');
  // SCN-0003 has no expected result, so generate skips it and it has no candidate file.
  expect(executeGenerateCommand({ configPath, planId: 'plan-v2', replace: false, rootDir: root })).toBe(0);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('validate: checks before running', { timeout: 30_000 }, () => {
  it('blocks a changed candidate ("regenerate it") and one whose credential is not set, without running either', async () => {
    appendFileSync(join(workspace, 'tests', 'candidates', 'SCN-0001.spec.ts'), '// edited by hand\n');
    expect(await validate()).toBe(1);

    expect(logs).toContain('Ignored:    SCN-0003 (not generated)');
    expect(logs).toContain('SCN-0001: blocked: file differs from what the generator renders from its plan; regenerate it');
    expect(logs).toContain('SCN-0002: blocked: credential variables not set in .env or the environment: V2_TEST_USER');
    expect(logs).not.toContain('Execution');
    const [s1, s2, s3] = readPlan().scenarios;
    expect(s1).toMatchObject({ status: 'blocked', validation: { verdict: 'blocked', runs: [], candidateSha256: expect.stringMatching(/^[0-9a-f]{64}$/) } });
    expect(s2).toMatchObject({ status: 'blocked', validation: { verdict: 'blocked', runs: [] } });
    expect(s3.status).toBe('draft');
    expect(s3.validation).toBeUndefined();
  });

  it('selects only the scenarios named with --scenario and refuses unknown IDs', async () => {
    appendFileSync(join(workspace, 'tests', 'candidates', 'SCN-0001.spec.ts'), '\n');
    expect(await validate(['SCN-0001'])).toBe(1);
    expect(readPlan().scenarios.map((s: { status: string }) => s.status)).toEqual(['blocked', 'draft', 'draft']);

    expect(await validate(['SCN-9999'])).toBe(1);
    expect(logs).toContain('not in plan plan-v2: SCN-9999');
  });
});
