/**
 * Integration test for `validate` (Task V2, DEC-042 §3.4): one real three-execution run
 * on a temp fixture project with one passing and one failing candidate.
 *
 * Candidates are written by the real generate command. A local HTTP server serves a page
 * showing "Saved"; SCN-0002 expects "Gone", which is never shown. The workspace links the
 * repository node_modules so the candidates can import @playwright/test.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { executeGenerateCommand } from '../../../src/cli/generate-command.js';
import { executeValidateCommand } from '../../../src/cli/validate-command.js';

const step = (action: string, value: string | null, assertion: string | null = null) => ({ action, target: null, value, assertion, locatorSource: null });
const scenario = (n: number, text: string) => ({
  scenarioId: `SCN-000${n}`, title: `Shows ${text}`, requirementIds: ['REQ-001'], requirementVersions: { 'REQ-001': 1 },
  categories: ['functional'], priority: 'high', risk: 'medium', role: null, preconditions: [], testData: [],
  steps: [step('goto', '/'), step('expect', text, 'text')],
  expectedResults: [{ requirementId: 'REQ-001', quote: `The message \`${text}\` is shown.` }], questions: [], status: 'draft',
});

describe('validate: three real executions (V2)', () => {
  let root: string;
  let workspace: string;
  let server: Server;
  let output: string;
  let exitCode: number;

  beforeAll(async () => {
    server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body><p>Saved</p></body></html>'); });
    await new Promise<void>((done) => server.listen(0, done));
    const port = (server.address() as AddressInfo).port;

    root = mkdtempSync(join(tmpdir(), 'qa-v2-validate-'));
    symlinkSync(resolve(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'junction');
    workspace = join(root, 'project');
    for (const dir of ['tests/approved', 'specs/candidates', 'requirements']) mkdirSync(join(workspace, dir), { recursive: true });
    const configPath = join(workspace, 'project.config.json');
    writeFileSync(configPath, JSON.stringify({
      projectId: 'v2-validate', name: 'V2 Validate', baseUrl: `http://localhost:${port}/`, environment: 'local',
      allowedDomains: ['localhost'], testDirectory: 'tests/approved', artifactDirectory: 'artifacts',
    }));
    writeFileSync(join(workspace, 'requirements', 'registry.json'), JSON.stringify({
      schemaVersion: '1.0', updatedAt: new Date().toISOString(), requirements: {
        'REQ-001': { projectId: 'v2-validate', requirementId: 'REQ-001', status: 'active', priority: 'high', title: 'Messages', description: 'Messages are shown.', expectedResult: 'The message `Saved` is shown. The message `Gone` is shown.', negativeCases: [] },
      },
    }));
    writeFileSync(join(workspace, 'specs', 'candidates', 'plan-v2.json'), JSON.stringify({
      schemaVersion: 1, planId: 'plan-v2', projectId: 'v2-validate', status: 'draft', createdAt: '2026-11-28T00:00:00.000Z',
      requirementIds: ['REQ-001'], excluded: [], explorationIds: ['exp-1'], provider: { providerId: 'openai', modelId: 'test' },
      limits: { maxScenarios: 20, maxAiRequests: 1 }, usage: { aiRequests: 1, inputTokens: 1, outputTokens: 1 },
      stopReason: 'completed', error: null, rejected: [], notCovered: [], conflicts: [], questions: [],
      scenarios: [scenario(1, 'Saved'), scenario(2, 'Gone')],
    }));

    const chunks: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => { chunks.push(args.join(' ')); });
    const err = vi.spyOn(console, 'error').mockImplementation((...args) => { chunks.push(args.join(' ')); });
    try {
      const generated = executeGenerateCommand({ configPath, planId: 'plan-v2', replace: false, rootDir: root });
      if (generated !== 0) throw new Error(`generate failed: ${chunks.join(' ')}`);
      exitCode = await executeValidateCommand({ configPath, planId: 'plan-v2', rootDir: root });
    } finally {
      log.mockRestore(); err.mockRestore();
    }
    output = chunks.join('\n');
  }, 240_000);

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(root, { recursive: true, force: true });
  });

  it('validates the passing candidate and marks the failing one needs-revision (failing), exiting 1', () => {
    expect(exitCode).toBe(1);
    expect(output).toContain('SCN-0001: validated');
    expect(output).toMatch(/SCN-0002: needs-revision \(failing\): failed in 3 of 3 executions: /);
    const plan = JSON.parse(readFileSync(join(workspace, 'specs', 'candidates', 'plan-v2.json'), 'utf-8'));
    const [s1, s2] = plan.scenarios;
    expect(s1).toMatchObject({ status: 'validated', validation: { verdict: 'validated', reason: null } });
    expect(s2).toMatchObject({ status: 'needs-revision', validation: { verdict: 'failing' } });
    expect(s1.validation.runs.map((r: { testStatus: string }) => r.testStatus)).toEqual(['passed', 'passed', 'passed']);
    expect(s2.validation.runs.map((r: { runStatus: string; testStatus: string }) => `${r.runStatus}/${r.testStatus}`)).toEqual(['failed/failed', 'failed/failed', 'failed/failed']);
  });

  it('ran three separate executions, each in its own run directory with JSON and HTML reports', () => {
    const plan = JSON.parse(readFileSync(join(workspace, 'specs', 'candidates', 'plan-v2.json'), 'utf-8'));
    const runIds: string[] = plan.scenarios[0].validation.runs.map((r: { runId: string }) => r.runId);
    expect(new Set(runIds).size).toBe(3);
    for (const runId of runIds) {
      const dir = join(workspace, 'artifacts', runId);
      expect(output).toContain(`Run:        ${dir}`);
      expect(existsSync(join(dir, 'results.json'))).toBe(true);
      expect(existsSync(join(dir, 'html-report', 'index.html'))).toBe(true);
    }
    expect(plan.scenarios[1].validation.runs.map((r: { runId: string }) => r.runId)).toEqual(runIds);
  });
});
