/**
 * Unit tests for release runs and the release report (Task R3, DEC-043 §3.5–§3.6).
 *
 * Each test builds a temporary workspace in os.tmpdir() with a plan file and release
 * records holding fake run summaries; `run --release` uses a mocked Playwright runner.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../../src/test-execution/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/test-execution/index.js')>();
  return { ...actual, runPlaywrightTests: vi.fn() };
});

const { runPlaywrightTests } = await import('../../../src/test-execution/index.js');
const { executeRunCommand } = await import('../../../src/cli/run-command.js');
const { executeReleaseReportCommand } = await import('../../../src/cli/release-command.js');
const { parseArgs } = await import('../../../src/cli/args.js');

type Status = 'passed' | 'failed' | 'skipped' | 'interrupted';
type Run = { runId: string; finishedAt: string; runStatus: string; reportStatus: string; tests: object[] };

let root: string;
let workspace: string;
let configPath: string;
let logs: string;
const releaseFile = (id: string) => join(workspace, 'releases', `${id}.json`);
const reportFile = (id: string) => join(workspace, 'releases', `${id}-report.md`);
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf-8'));

const test = (file: string, status: Status) => ({
  file, title: `${file} > checks it`, scenarioId: /^SCN-\d{4}/.exec(file)?.[0] ?? null, status,
});
const run = (runId: string, tests: object[], runStatus = tests.some((t) => (t as { status: string }).status !== 'passed') ? 'failed' : 'passed', reportStatus = 'complete'): Run =>
  ({ runId, finishedAt: '2026-11-28T00:00:00.000Z', runStatus, reportStatus, tests });

const comparison = (requirementId: string, classification: string, review: string | null = null) =>
  ({ requirementId, classification, previousContentVersion: 1, currentContentVersion: classification === 'changed' ? 2 : 1, review });

function writeRelease(releaseId: string, previousReleaseId: string | null, runs: Run[], extra: object = {}) {
  writeFileSync(releaseFile(releaseId), JSON.stringify({
    schemaVersion: 1, releaseId, projectId: 'demo', createdAt: '2026-11-28T00:00:00.000Z', previousReleaseId,
    target: { baseUrl: 'http://localhost:4310', environment: 'local' }, documents: [], requirements: [],
    comparison: [comparison('REQ-A', 'unchanged'), comparison('REQ-B', 'changed', 'reviewed'), comparison('REQ-C', 'unchanged')],
    affectedTests: [], needsTests: [], reviews: [], runs, ...extra,
  }));
}

const scenario = (n: number, requirementIds: string[]) => ({
  scenarioId: `SCN-000${n}`, title: `Scenario ${n}`, requirementIds, requirementVersions: Object.fromEntries(requirementIds.map((id) => [id, 1])),
  categories: ['functional'], priority: 'high', risk: 'medium', role: null, preconditions: [], testData: [],
  steps: [], expectedResults: [], questions: [], status: 'approved',
  approval: { reviewer: 'Dana', decidedAt: '2026-11-28T00:00:00.000Z', approvedFile: `tests/approved/SCN-000${n}.spec.ts`, approvedSha256: 'x' },
});

beforeEach(() => {
  root = join(tmpdir(), `qa-report-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  workspace = join(root, 'project');
  for (const dir of [join('specs', 'candidates'), join('tests', 'approved'), join('tests', 'retired'), 'releases', 'artifacts']) {
    mkdirSync(join(workspace, dir), { recursive: true });
  }
  configPath = join(workspace, 'project.config.json');
  writeFileSync(configPath, JSON.stringify({
    projectId: 'demo', name: 'Demo', baseUrl: 'http://localhost:4310', environment: 'local',
    allowedDomains: ['localhost'], testDirectory: 'tests/approved', artifactDirectory: 'artifacts', roles: [],
  }));
  writeFileSync(join(workspace, 'specs', 'candidates', 'plan-r3.json'), JSON.stringify({
    schemaVersion: 1, planId: 'plan-r3', projectId: 'demo', status: 'generated', createdAt: '2026-11-28T00:00:00.000Z',
    requirementIds: [], excluded: [], explorationIds: [], provider: { providerId: 'openai', modelId: 'test' },
    limits: { maxScenarios: 20, maxAiRequests: 1 }, usage: { aiRequests: 1, inputTokens: 1, outputTokens: 1 },
    stopReason: 'completed', error: null, rejected: [], notCovered: [], conflicts: [], questions: [],
    scenarios: [scenario(1, ['REQ-A']), scenario(2, ['REQ-A', 'REQ-B']), scenario(3, ['REQ-C'])],
  }));
  logs = '';
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs += args.join(' ') + '\n'; });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logs += args.join(' ') + '\n'; });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(runPlaywrightTests).mockReset();
  rmSync(root, { recursive: true, force: true });
});

const report = () => executeReleaseReportCommand({ configPath, releaseId: 'v2' });
const row = (file: string) => readFileSync(reportFile('v2'), 'utf-8').split('\n').find((l) => l.startsWith(`| ${file} > `)) ?? '';

describe('release report: test classifications (criteria 2, 4)', () => {
  it('classifies each test and separates regressions from requirement-change failures', () => {
    writeRelease('v1', null, [run('run-v1', [
      test('SCN-0001.spec.ts', 'passed'), test('SCN-0002.spec.ts', 'passed'), test('SCN-0003.spec.ts', 'passed'),
      test('smoke.spec.ts', 'passed'), test('SCN-0004.spec.ts', 'passed'), test('SCN-0005.spec.ts', 'failed'),
      test('SCN-0006.spec.ts', 'failed'),
    ])]);
    writeFileSync(join(workspace, 'tests', 'retired', 'SCN-0004.spec.ts'), '// retired');
    writeRelease('v2', 'v1', [run('run-v2', [
      test('SCN-0001.spec.ts', 'passed'), test('SCN-0002.spec.ts', 'failed'), test('SCN-0003.spec.ts', 'failed'),
      test('smoke.spec.ts', 'failed'), test('SCN-0005.spec.ts', 'failed'), test('SCN-0006.spec.ts', 'passed'),
      test('SCN-0007.spec.ts', 'passed'),
    ])]);

    expect(report()).toBe(1);
    expect(row('SCN-0001.spec.ts')).toContain('| still passing |');
    // SCN-0002 is linked to REQ-B, changed in v2: an expected failure, not a regression.
    expect(row('SCN-0002.spec.ts')).toContain('newly failing: affected by requirement change (REQ-B (changed))');
    // SCN-0003's only requirement is unchanged; smoke has no scenario, so no linked requirement.
    expect(row('SCN-0003.spec.ts')).toContain('**newly failing: regression**');
    expect(row('smoke.spec.ts')).toContain('| none | passed | failed | **newly failing: regression** |');
    expect(row('SCN-0005.spec.ts')).toContain('| still failing |');
    expect(row('SCN-0006.spec.ts')).toContain('| fixed |');
    expect(row('SCN-0007.spec.ts')).toContain('| - | passed | new |');
    expect(row('SCN-0004.spec.ts')).toContain('| passed | - | retired |');
    const md = readFileSync(reportFile('v2'), 'utf-8');
    expect(md).toContain('**FAIL**: 2 regression(s), 0 pending review(s), latest run failed.');
    expect(md).toContain('| REQ-B | changed | 1 → 2 | reviewed |');
    expect(md).not.toMatch(/\x1b\[/);
    expect(logs).toContain('REGRESSION: SCN-0003.spec.ts > checks it');
    expect(logs).toContain('Result: FAIL (2 regression(s))');
  });

  it('exits 0 with no regression, no pending review and a passing latest run', () => {
    writeRelease('v1', null, [run('run-v1', [test('SCN-0001.spec.ts', 'passed'), test('SCN-0002.spec.ts', 'failed')])]);
    writeRelease('v2', 'v1', [run('run-v2', [test('SCN-0001.spec.ts', 'passed'), test('SCN-0002.spec.ts', 'passed')])]);
    expect(report()).toBe(0);
    expect(readFileSync(reportFile('v2'), 'utf-8')).toContain('**PASS**');
  });

  it('exits 1 when a review is pending, even with a passing run', () => {
    writeRelease('v1', null, [run('run-v1', [test('SCN-0001.spec.ts', 'passed')])]);
    writeRelease('v2', 'v1', [run('run-v2', [test('SCN-0001.spec.ts', 'passed')])], {
      affectedTests: [{ scenarioId: 'SCN-0002', approvedFile: 'tests/approved/SCN-0002.spec.ts', requirements: [{ requirementId: 'REQ-B', classification: 'changed' }], review: 'pending' }],
    });
    expect(report()).toBe(1);
    expect(readFileSync(reportFile('v2'), 'utf-8')).toContain('- SCN-0002 (REQ-B changed): keep or retire the test');
  });
});

describe('release report: blocked, missing and baseline runs (criterion 3)', () => {
  it('reports a blocked latest run as blocked, never as passing', () => {
    writeRelease('v1', null, [run('run-v1', [test('SCN-0001.spec.ts', 'passed')])]);
    writeRelease('v2', 'v1', [run('run-v2', [test('SCN-0001.spec.ts', 'passed')], 'passed', 'partial')]);
    expect(report()).toBe(1);
    const md = readFileSync(reportFile('v2'), 'utf-8');
    expect(md).toContain('| Latest | v2 | run-v2 | 2026-11-28T00:00:00.000Z | passed | partial | no (blocked) |');
    expect(md).toContain('The latest run is blocked (passed, report partial); its tests are not compared.');
    expect(md).not.toContain('still passing');
  });

  it('says "no baseline" for a first release and exits 0 when its run passed', () => {
    writeRelease('v2', null, [run('run-v2', [test('SCN-0001.spec.ts', 'passed')])]);
    expect(report()).toBe(0);
    expect(readFileSync(reportFile('v2'), 'utf-8')).toContain('No baseline: this release has no previous release.');
    expect(logs).toContain('Baseline: no baseline');
  });

  it('says when the previous release has no run, and when the release has no run yet', () => {
    writeRelease('v1', null, []);
    writeRelease('v2', 'v1', []);
    expect(report()).toBe(1);
    const md = readFileSync(reportFile('v2'), 'utf-8');
    expect(md).toContain('No baseline: release v1 has no run.');
    expect(md).toContain('Release v2 has no run yet.');
  });

  it('refuses an unknown release', () => {
    expect(executeReleaseReportCommand({ configPath, releaseId: 'v9' })).toBe(1);
    expect(logs).toContain('release v9 does not exist');
  });
});

describe('run --release (criterion 1)', () => {
  function mockRun(suites: object[], exitCode: number) {
    vi.mocked(runPlaywrightTests).mockImplementation(async () => {
      const runDirectory = join(workspace, 'artifacts', 'run-1');
      mkdirSync(join(runDirectory, 'html-report'), { recursive: true });
      writeFileSync(join(runDirectory, 'html-report', 'index.html'), '<html></html>');
      const failed = exitCode === 0 ? 0 : 1;
      writeFileSync(join(runDirectory, 'results.json'), JSON.stringify({ stats: { expected: suites.length - failed, unexpected: failed, flaky: 0, skipped: 0, duration: 5 }, errors: [], suites }));
      return {
        runId: 'run-1', runDirectory, projectConfigPath: configPath, projectId: 'demo',
        processResult: { exitCode, signal: null, stdout: '', stderr: '', startTime: '2026-11-28T10:00:00.000Z', endTime: '2026-11-28T10:00:05.000Z', duration: 5000, timedOut: false },
      };
    });
  }
  const suite = (file: string, status: string) => ({ title: file, file, specs: [{ title: 'checks it', tests: [{ status, results: [{ duration: 1 }] }] }] });

  it('appends a summary from the reconciled run to the release record', async () => {
    writeRelease('v2', null, []);
    mockRun([suite('SCN-0001.spec.ts', 'expected'), suite('smoke.spec.ts', 'unexpected')], 1);
    expect(await executeRunCommand(configPath, root, 'v2')).toBe(1);
    expect(readJson(releaseFile('v2')).runs).toEqual([{
      runId: 'run-1', finishedAt: '2026-11-28T10:00:05.000Z', runStatus: 'failed', reportStatus: 'complete',
      tests: [
        { file: 'SCN-0001.spec.ts', title: 'SCN-0001.spec.ts > checks it', scenarioId: 'SCN-0001', status: 'passed' },
        { file: 'smoke.spec.ts', title: 'smoke.spec.ts > checks it', scenarioId: null, status: 'failed' },
      ],
    }]);
    expect(logs).toContain('Run run-1 recorded in release v2 (failed, 2 tests)');
  });

  it('refuses a release that does not exist before running anything', async () => {
    expect(await executeRunCommand(configPath, root, 'v9')).toBe(1);
    expect(runPlaywrightTests).not.toHaveBeenCalled();
    expect(logs).toContain('Run refused: release v9 does not exist');
  });

  it('without --release: parses as before, runs, and writes no release record', async () => {
    expect(parseArgs(['run', '--config', 'p.json'])).toEqual({ command: 'run', runOptions: { configPath: 'p.json' }, errors: [] });
    expect(parseArgs(['run', '--config', 'p.json', '--release', 'v2']).runOptions).toEqual({ configPath: 'p.json', releaseId: 'v2' });
    expect(parseArgs(['run', '--config', 'p.json', '--release']).errors).toEqual(['--release requires a release ID']);
    expect(parseArgs(['release', 'report', '--config', 'p.json', '--release', 'v2']).releaseOptions).toEqual({ action: 'report', configPath: 'p.json', releaseId: 'v2' });
    writeRelease('v2', null, []);
    const before = readFileSync(releaseFile('v2'), 'utf-8');
    mockRun([suite('SCN-0001.spec.ts', 'expected')], 0);
    expect(await executeRunCommand(configPath, root)).toBe(0);
    expect(runPlaywrightTests).toHaveBeenCalledTimes(1);
    expect(readFileSync(releaseFile('v2'), 'utf-8')).toBe(before);
    expect(logs).not.toContain('recorded in release');
    expect(existsSync(reportFile('v2'))).toBe(false);
  });
});
