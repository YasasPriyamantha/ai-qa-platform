/**
 * Unit tests for requirements propose and review (Task Q5).
 *
 * The OpenAI adapter runs on a fake SDK client that returns scripted
 * proposals: no network, no live API call. Everything is written to os.tmpdir().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeProposeCommand, executeReviewCommand } from '../../../src/cli/proposal-command.js';
import { createOpenAIAdapter, globalAdapterRegistry } from '../../../src/model-providers/index.js';

const BUDGET = {
  maxTotalRequests: 5,
  maxInputTokensPerRequest: 30_000,
  maxOutputTokensPerRequest: 4_000,
  maxCumulativeInputTokens: 100_000,
  maxCumulativeOutputTokens: 20_000,
  window: { type: 'rolling', durationHours: 24 },
};

const NOTES = [
  '# Checkout notes',
  '',
  'Pressing Finish completes the order and the page shows "Thank you for your order!".',
  '',
  'The total should include tax, but nobody agreed on how it is shown.',
].join('\n');

const item = (proposedId: string, extra: object = {}) => ({
  proposedId, title: `${proposedId} title`, description: 'Finishing an order.',
  expectedResult: 'The page shows "Thank you for your order!".', unresolvedReason: null,
  negativeCases: [], priority: 'high', lineStart: 3, lineEnd: 3,
  ...extra,
});

let root: string;
let workspace: string;
let configPath: string;
let requestBodies: string[];
let out: string;

/** OpenAI adapter on a fake SDK client returning `output` as structured output. */
const fakeAdapter = (output: unknown) => createOpenAIAdapter(() => ({
  responses: {
    create: async (body) => {
      requestBodies.push(JSON.stringify(body));
      return {
        id: 'resp', status: 'completed',
        output: [{ type: 'message', id: 'msg', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
        usage: { input_tokens: 300, output_tokens: 100, total_tokens: 400 },
      } as never;
    },
  },
}));

const registryPath = () => join(workspace, 'requirements', 'registry.json');
const proposalsDir = () => join(workspace, 'requirements', 'proposals');
const readProposal = () => {
  const files = readdirSync(proposalsDir());
  expect(files).toHaveLength(1);
  return JSON.parse(readFileSync(join(proposalsDir(), files[0]), 'utf-8'));
};

beforeEach(() => {
  root = join(tmpdir(), `qa-propose-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  workspace = join(root, 'demo');
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(join(workspace, 'docs'), { recursive: true });
  mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
  copyFileSync(join(process.cwd(), 'config', 'ai-providers.json'), join(root, 'config', 'ai-providers.json'));
  writeFileSync(join(root, 'config', 'ai-budget.json'), JSON.stringify(BUDGET));
  writeFileSync(join(root, '.env'), 'AI_ENABLED=true\nOPENAI_API_KEY=sk-test-propose\n');
  writeFileSync(join(workspace, 'docs', 'notes.md'), NOTES);
  configPath = join(workspace, 'project.config.json');
  writeFileSync(configPath, JSON.stringify({
    projectId: 'demo', name: 'Demo', baseUrl: 'https://www.example.com/', environment: 'demo',
    allowedDomains: ['www.example.com'], testDirectory: 'tests/approved', artifactDirectory: 'artifacts',
    documents: [{ documentId: 'notes', sourcePath: 'docs/notes.md', format: 'markdown' }],
  }));
  requestBodies = [];
  out = '';
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { out += args.join(' ') + '\n'; });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { out += args.join(' ') + '\n'; });
});

afterEach(() => {
  vi.restoreAllMocks();
  globalAdapterRegistry.clear();
  rmSync(root, { recursive: true, force: true });
});

const propose = (output: unknown) =>
  executeProposeCommand({ configPath, documentId: 'notes', rootDir: root, adapter: fakeAdapter({ requirements: output }) });

describe('requirements propose', () => {
  it('saves a valid proposal with one AI request, numbered lines and no registry change', async () => {
    expect(await propose([item('CHK-001')])).toBe(0);

    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toContain('3: Pressing Finish completes the order');
    expect(requestBodies[0]).toContain('Never infer behaviour from websites');
    const proposal = readProposal();
    expect(proposal.status).toBe('pending');
    expect(proposal.sourceDocumentId).toBe('notes');
    expect(proposal.proposedRequirements).toHaveLength(1);
    const [p] = proposal.proposedRequirements;
    expect(p).toMatchObject({ proposedId: 'CHK-001', individualStatus: 'pending', expectedResult: 'The page shows "Thank you for your order!".' });
    expect(p.sourceReference).toMatchObject({ documentId: 'notes', contentHash: proposal.sourceContentHash, lineRange: { start: 3, end: 3 } });
    expect(p.originalSourceText).toContain('Pressing Finish');
    expect(p.unresolved).toBeUndefined();
    expect(existsSync(registryPath())).toBe(false);
    // The original document is preserved as an immutable snapshot by the document service.
    const sources = readdirSync(join(workspace, 'documents', 'sources'));
    expect(readFileSync(join(workspace, 'documents', 'sources', sources[0]), 'utf-8')).toBe(NOTES);
  });

  it('rejects reused active, retired, duplicate and malformed IDs', async () => {
    mkdirSync(join(workspace, 'requirements'), { recursive: true });
    writeFileSync(registryPath(), JSON.stringify({ schemaVersion: '1.0', updatedAt: new Date().toISOString(), requirements: {
      'REQ-001': { requirementId: 'REQ-001', status: 'active' },
      'REQ-002': { requirementId: 'REQ-002', status: 'retired' },
    } }));
    const registryBefore = readFileSync(registryPath(), 'utf-8');

    expect(await propose([item('REQ-001'), item('REQ-002'), item('REQ-003'), item('REQ-003'), item('req 4')])).toBe(0);

    expect(requestBodies[0]).toContain('Existing requirement IDs: REQ-001, REQ-002');
    expect(out).toMatch(/Rejected: +REQ-001: REQ-001 is already used by an active or retired requirement/);
    expect(out).toMatch(/Rejected: +REQ-002: REQ-002 is already used by an active or retired requirement/);
    expect(out).toMatch(/Rejected: +REQ-003: REQ-003 is proposed more than once/);
    expect(out).toMatch(/Rejected: +req 4: .*does not match required format/);
    expect(readProposal().proposedRequirements.map((p: { proposedId: string }) => p.proposedId)).toEqual(['REQ-003']);
    expect(readFileSync(registryPath(), 'utf-8')).toBe(registryBefore);
  });

  it('rejects a line range that is not in the snapshot, and saves nothing when no item is valid', async () => {
    expect(await propose([item('CHK-001', { lineStart: 4, lineEnd: 40 }), item('CHK-002', { lineStart: 0, lineEnd: 1 })])).toBe(1);

    expect(out).toMatch(/Rejected: +CHK-001: line range 4-40 does not exist in the snapshot \(5 lines\)/);
    expect(out).toMatch(/Rejected: +CHK-002: line range 0-1 does not exist/);
    expect(out).toContain('nothing_valid');
    expect(existsSync(proposalsDir())).toBe(false);
  });

  it('marks a proposal without an expected result as unresolved', async () => {
    expect(await propose([
      item('CHK-001', { expectedResult: null, unresolvedReason: 'Nobody agreed how tax is shown.', lineStart: 5, lineEnd: 5 }),
      item('CHK-002', { expectedResult: '  ', lineStart: 5, lineEnd: 5 }),
    ])).toBe(0);

    const [a, b] = readProposal().proposedRequirements;
    expect(a.expectedResult).toBeUndefined();
    expect(a.unresolved).toEqual({ reason: 'Nobody agreed how tax is shown.' });
    expect(b.expectedResult).toBeUndefined();
    expect(b.unresolved).toEqual({ reason: 'The document gives no expected result.' });
    expect(out).toContain('[unresolved: The document gives no expected result.]');
  });
});

describe('requirements review', () => {
  it('accept moves one item to the registry; reject does not', async () => {
    expect(await propose([item('CHK-001'), item('CHK-002')])).toBe(0);
    const { proposalId } = readProposal();

    expect(executeReviewCommand({ configPath, proposalId, accept: ['CHK-001'], reject: ['CHK-002'] })).toBe(0);

    const registry = JSON.parse(readFileSync(registryPath(), 'utf-8'));
    expect(Object.keys(registry.requirements)).toEqual(['CHK-001']);
    expect(registry.requirements['CHK-001']).toMatchObject({ status: 'active', expectedResult: 'The page shows "Thank you for your order!".' });
    const statuses = readProposal().proposedRequirements.map((p: { proposedId: string; individualStatus: string }) => [p.proposedId, p.individualStatus]);
    expect(statuses).toEqual([['CHK-001', 'accepted'], ['CHK-002', 'rejected']]);
    expect(out).toMatch(/CHK-001 +accepted/);
    expect(out).toMatch(/CHK-002 +rejected/);
  });

  it('fails for an ID that is not in the proposal', async () => {
    expect(await propose([item('CHK-001')])).toBe(0);
    const { proposalId } = readProposal();

    expect(executeReviewCommand({ configPath, proposalId, accept: ['CHK-009'], reject: [] })).toBe(1);
    expect(out).toMatch(/CHK-009 +not accepted/);
    expect(existsSync(registryPath())).toBe(false);
  });
});
