/**
 * Unit tests for the ai-check command (Task N4).
 *
 * The adapter is mocked; no network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeAiCheckCommand } from '../../../src/cli/ai-check-command.js';
import {
  ResponseBuilder,
  createObservedUsage,
  globalAdapterRegistry,
  type AdapterContext,
  type AdapterResult,
  type ModelRequest,
  type ProviderAdapter,
} from '../../../src/model-providers/index.js';

const TEST_KEY = 'sk-test-ai-check-secret-value';

function writeEnv(root: string, lines: string[]): void {
  writeFileSync(join(root, '.env'), lines.join('\n') + '\n');
}

function writeBudget(root: string): void {
  copyFileSync(
    join(process.cwd(), 'config', 'ai-budget.example.json'),
    join(root, 'config', 'ai-budget.json')
  );
}

function mockAdapter(): ProviderAdapter & { execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(async (request: ModelRequest, context: AdapterContext): Promise<AdapterResult> => {
    const usage = createObservedUsage({ inputTokens: 30, outputTokens: 8, totalTokens: 38 });
    const response = new ResponseBuilder()
      .identity({ providerId: request.providerId, adapterType: 'openai-responses', modelId: request.modelId! })
      .message({ role: 'assistant', content: [{ type: 'text', text: '{"status":"ok"}' }] })
      .finishReason('stop')
      .usage(usage)
      .providerRequestId('req_mock_1')
      .timing({ totalMs: 5, requestedAt: new Date().toISOString(), completedAt: new Date().toISOString() })
      .structuredOutput({ status: 'ok' }, true)
      .build();
    expect(context.apiKey).toBe(TEST_KEY);
    return { success: true, response, observedUsage: usage, sdkRetriesDisabled: true };
  });
  return { adapterType: 'openai-responses', displayName: 'Mock OpenAI', execute };
}

describe('executeAiCheckCommand', () => {
  let root: string;
  let output: string;

  beforeEach(() => {
    root = join(tmpdir(), `qa-ai-check-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, 'config'), { recursive: true });
    copyFileSync(
      join(process.cwd(), 'config', 'ai-providers.json'),
      join(root, 'config', 'ai-providers.json')
    );
    output = '';
    const capture = (...args: unknown[]) => { output += args.join(' ') + '\n'; };
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalAdapterRegistry.clear();
    rmSync(root, { recursive: true, force: true });
  });

  it('AI disabled: status is printed without a network call, and --live refuses', async () => {
    writeEnv(root, ['AI_ENABLED=false', `OPENAI_API_KEY=${TEST_KEY}`]);
    writeBudget(root);
    const adapter = mockAdapter();

    expect(await executeAiCheckCommand({ live: false, rootDir: root, adapter })).toBe(0);
    expect(output).toContain('openai');
    expect(output).toContain('gpt-6-luna');
    expect(output).toContain('AI enabled:  no');
    expect(output).toContain('OPENAI_API_KEY present');
    expect(output).toContain('Output tokens per request: 1024');

    expect(await executeAiCheckCommand({ live: true, rootDir: root, adapter })).toBe(1);
    expect(output).toContain('AI is disabled');
    expect(adapter.execute).not.toHaveBeenCalled();
    expect(output).not.toContain(TEST_KEY);
  });

  it('missing key: --live refuses before any request', async () => {
    writeEnv(root, ['AI_ENABLED=true']);
    writeBudget(root);
    const adapter = mockAdapter();

    expect(await executeAiCheckCommand({ live: true, rootDir: root, adapter })).toBe(1);
    expect(output).toContain('OPENAI_API_KEY missing');
    expect(output).toContain('API key missing');
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('missing budget file: --live refuses before any request', async () => {
    writeEnv(root, ['AI_ENABLED=true', `OPENAI_API_KEY=${TEST_KEY}`]);
    const adapter = mockAdapter();

    expect(await executeAiCheckCommand({ live: true, rootDir: root, adapter })).toBe(1);
    expect(output).toContain('Budget:      not configured');
    expect(output).toContain('no valid budget');
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('successful mocked --live: one request, validated result, usage and duration printed', async () => {
    writeEnv(root, ['AI_ENABLED=true', `OPENAI_API_KEY=${TEST_KEY}`]);
    writeBudget(root);
    const adapter = mockAdapter();

    expect(await executeAiCheckCommand({ live: true, rootDir: root, adapter })).toBe(0);
    expect(adapter.execute).toHaveBeenCalledTimes(1);
    const request = adapter.execute.mock.calls[0][0] as ModelRequest;
    expect(request.structuredOutput?.schema.id).toBe('ai-check');
    expect(request.options?.maxTokens).toBe(1024);

    expect(output).toContain('Live check passed');
    expect(output).toContain('{"status":"ok"} (validated locally)');
    expect(output).toContain('input 30, output 8, total 38');
    expect(output).toMatch(/Duration:\s+\d+ms/);
    expect(output).toContain('1/1 requests');
    expect(output).not.toContain(TEST_KEY);
  });
});
