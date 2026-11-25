/**
 * Tests for the OpenAI Responses API adapter (Task N3).
 *
 * The SDK client is injected; no network calls are made.
 */

import { describe, it, expect, vi } from 'vitest';
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  type ClientOptions,
} from 'openai';
import type { Response as OpenAIResponse } from 'openai/resources/responses/responses';
import { createOpenAIAdapter } from '../../../src/model-providers/openai-adapter.js';
import type { AdapterContext, AdapterResult, AdapterSuccess, AdapterError } from '../../../src/model-providers/adapter-interface.js';
import type { ModelRequest } from '../../../src/model-providers/request.js';
import { createCanonicalSchema, z } from '../../../src/model-providers/schema.js';
import { createUnknownCapabilities } from '../../../src/model-providers/types.js';

const context: AdapterContext = {
  providerConfig: {
    providerId: 'openai',
    adapterType: 'openai-responses',
    defaultModelId: 'gpt-test',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    capabilities: createUnknownCapabilities(),
  },
  apiKey: 'sk-test',
  signal: new AbortController().signal,
  isCancellation: false,
  options: { timeoutMs: 30000 },
  platformRequestId: 'plat_1',
  attemptNumber: 1,
};

function baseRequest(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return { providerId: 'openai', messages: [{ role: 'user', content: 'Hi' }], ...overrides };
}

function apiResponse(overrides: Partial<OpenAIResponse> & { _request_id?: string }): OpenAIResponse {
  return {
    id: 'resp_1',
    object: 'response',
    status: 'completed',
    output: [],
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 2, cache_write_tokens: 0 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 3 },
      total_tokens: 15,
    },
    ...overrides,
  } as unknown as OpenAIResponse;
}

function textMessage(text: string) {
  return { type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
}

/** Fake client: returns queued results (or throws queued errors) and records calls. */
function fakeClient(...results: Array<OpenAIResponse | Error>) {
  const create = vi.fn(async (_body: unknown, _options?: { signal?: AbortSignal }) => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next!;
  });
  const clientOptions: ClientOptions[] = [];
  const adapter = createOpenAIAdapter((opts) => {
    clientOptions.push(opts);
    return { responses: { create } };
  });
  return { adapter, create, clientOptions };
}

function ok(result: AdapterResult): AdapterSuccess {
  expect(result.success).toBe(true);
  return result as AdapterSuccess;
}

function fail(result: AdapterResult): AdapterError {
  expect(result.success).toBe(false);
  return result as AdapterError;
}

const reasoningItem = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'ENC_OPAQUE_BLOB' };
const functionCallItem = {
  type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'get_title', arguments: '{"url":"https://x"}', status: 'completed',
};

describe('OpenAI adapter: text replies', () => {
  it('sends a Responses API request with store false, maxRetries 0 and maps a text reply', async () => {
    const { adapter, create, clientOptions } = fakeClient(
      apiResponse({ output: [textMessage('Hello there')] as never, _request_id: 'req_abc' })
    );

    const result = ok(await adapter.execute(baseRequest({ instructions: 'Be brief', options: { maxTokens: 50 } }), context));

    expect(clientOptions[0]).toMatchObject({ apiKey: 'sk-test', maxRetries: 0 });
    const [body, reqOpts] = create.mock.calls[0] as unknown as [Record<string, unknown>, { signal: AbortSignal }];
    expect(body).toMatchObject({
      model: 'gpt-test',
      store: false,
      instructions: 'Be brief',
      max_output_tokens: 50,
      include: ['reasoning.encrypted_content'],
      input: [{ role: 'user', content: 'Hi' }],
    });
    expect(reqOpts.signal).toBe(context.signal);

    expect(result.response.text).toBe('Hello there');
    expect(result.response.finishReason).toBe('stop');
    expect(result.response.providerRequestId).toBe('req_abc');
    expect(result.response.identity).toEqual({ providerId: 'openai', adapterType: 'openai-responses', modelId: 'gpt-test' });
    expect(result.response.hasContinuation).toBe(false);
    expect(result.observedUsage).toEqual({
      inputTokens: { known: true, value: 10 },
      outputTokens: { known: true, value: 5 },
      totalTokens: { known: true, value: 15 },
      cachedTokens: { known: true, value: 2 },
      reasoningTokens: { known: true, value: 3 },
    });
    expect(result.sdkRetriesDisabled).toBe(true);
  });

  it('reports usage as unknown when the response has no usage', async () => {
    const { adapter } = fakeClient(apiResponse({ output: [textMessage('x')] as never, usage: undefined }));
    const result = ok(await adapter.execute(baseRequest(), context));
    expect(result.observedUsage.inputTokens).toEqual({ known: false, reason: 'not_reported' });
  });

  it('refuses stop sequences instead of silently dropping them, without calling the SDK', async () => {
    const { adapter, create } = fakeClient();
    const error = fail(await adapter.execute(baseRequest({ options: { stopSequences: ['END'] } }), context)).error;
    expect(error.code).toBe('FEATURE_UNSUPPORTED');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('OpenAI adapter: structured output', () => {
  const strictSchema = createCanonicalSchema({
    id: 'ai.check', version: 1, zodSchema: z.strictObject({ status: z.literal('ok') }),
  });

  it('uses strict mode for a strict-compatible schema and validates the reply locally', async () => {
    const { adapter, create } = fakeClient(apiResponse({ output: [textMessage('{"status":"ok"}')] as never }));

    const result = ok(await adapter.execute(baseRequest({ structuredOutput: { schema: strictSchema } }), context));

    const body = create.mock.calls[0]![0] as unknown as { text: { format: Record<string, unknown> } };
    expect(body.text.format).toMatchObject({ type: 'json_schema', name: 'ai_check', strict: true });
    expect(body.text.format.schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['status'] });
    expect(result.response.structuredOutput).toEqual({ status: 'ok' });
    expect(result.response.structuredOutputValid).toBe(true);
  });

  it('does not use strict mode when the schema breaks OpenAI strict rules', async () => {
    const loose = createCanonicalSchema({
      id: 'loose', version: 1, zodSchema: z.object({ a: z.string(), b: z.number().optional() }),
    });
    const { adapter, create } = fakeClient(apiResponse({ output: [textMessage('{"a":"x"}')] as never }));

    ok(await adapter.execute(baseRequest({ structuredOutput: { schema: loose } }), context));

    const body = create.mock.calls[0]![0] as unknown as { text: { format: { strict: boolean } } };
    expect(body.text.format.strict).toBe(false);
  });

  it('returns STRUCTURED_OUTPUT_INVALID when the reply does not match the schema', async () => {
    const { adapter } = fakeClient(apiResponse({ output: [textMessage('{"status":"bad"}')] as never, _request_id: 'req_9' }));
    const result = fail(await adapter.execute(baseRequest({ structuredOutput: { schema: strictSchema } }), context));
    expect(result.error.code).toBe('STRUCTURED_OUTPUT_INVALID');
    expect(result.error.retrySafety).toBe('retryable_safe');
    expect(result.providerRequestId).toBe('req_9');
  });
});

describe('OpenAI adapter: tools and continuation', () => {
  const externalSchema = { type: 'object', properties: { url: { type: 'string' } } };
  const tools: ModelRequest['tools'] = [
    { name: 'get_title', description: 'Get page title', parameters: { kind: 'external_json_schema', source: 'mcp:test', jsonSchema: externalSchema } },
  ];

  it('sends external tool schemas unchanged with strict false and canonical ones strict when compatible', async () => {
    const canonical = createCanonicalSchema({ id: 'p', version: 1, zodSchema: z.strictObject({ n: z.number() }) });
    const { adapter, create } = fakeClient(apiResponse({ output: [textMessage('ok')] as never }));

    await adapter.execute(
      baseRequest({
        tools: [...tools!, { name: 'count', description: 'Count', parameters: canonical }],
        toolChoice: { type: 'specific', name: 'count' },
      }),
      context
    );

    const body = create.mock.calls[0]![0] as unknown as { tools: Array<Record<string, unknown>>; tool_choice: unknown };
    expect(body.tools[0]).toEqual({
      type: 'function', name: 'get_title', description: 'Get page title', parameters: externalSchema, strict: false,
    });
    expect(body.tools[0]!.parameters).toBe(externalSchema);
    expect(body.tools[1]).toMatchObject({ name: 'count', strict: true });
    expect(body.tool_choice).toEqual({ type: 'function', name: 'count' });
  });

  it('maps a tool call, then sends the tool result and replays reasoning items unchanged', async () => {
    const firstOutput = [reasoningItem, functionCallItem];
    const { adapter, create } = fakeClient(
      apiResponse({ output: firstOutput as never }),
      apiResponse({ output: [textMessage('The title is X')] as never })
    );

    // Turn 1: model asks for a tool call.
    const first = ok(await adapter.execute(baseRequest({ tools }), context)).response;
    expect(first.finishReason).toBe('tool_calls');
    expect(first.toolCalls).toEqual([{ id: 'call_1', name: 'get_title', arguments: '{"url":"https://x"}' }]);
    expect(first.hasContinuation).toBe(true);
    expect(first.message.continuationRef).toBe(first.continuationRef);
    // The opaque payload is not exposed through the response.
    expect(JSON.stringify(first)).not.toContain('ENC_OPAQUE_BLOB');

    // Turn 2: send the tool result back with the assistant message.
    const second = ok(
      await adapter.execute(
        baseRequest({
          tools,
          messages: [
            { role: 'user', content: 'Hi' },
            first.message,
            { role: 'tool', toolCallId: 'call_1', toolName: 'get_title', content: 'X' },
          ],
        }),
        context
      )
    ).response;

    const input = (create.mock.calls[1]![0] as unknown as { input: unknown[] }).input;
    expect(input).toEqual([
      { role: 'user', content: 'Hi' },
      reasoningItem,
      functionCallItem,
      { type: 'function_call_output', call_id: 'call_1', output: 'X' },
    ]);
    expect(second.text).toBe('The title is X');
    expect(second.finishReason).toBe('stop');
  });

  it('does not replay continuation state for a different model, and fails when it is required', async () => {
    const { adapter, create } = fakeClient(
      apiResponse({ output: [reasoningItem, functionCallItem] as never }),
      apiResponse({ output: [textMessage('ok')] as never })
    );
    const first = ok(await adapter.execute(baseRequest({ tools }), context)).response;
    const messages: ModelRequest['messages'] = [
      { role: 'user', content: 'Hi' },
      first.message,
      { role: 'tool', toolCallId: 'call_1', toolName: 'get_title', content: 'X' },
    ];

    await adapter.execute(baseRequest({ tools, messages, modelId: 'other-model' }), context);
    const input = (create.mock.calls[1]![0] as unknown as { input: unknown[] }).input;
    expect(JSON.stringify(input)).not.toContain('ENC_OPAQUE_BLOB');
    expect(input[1]).toEqual({ type: 'function_call', call_id: 'call_1', name: 'get_title', arguments: '{"url":"https://x"}' });

    const required = fail(
      await adapter.execute(baseRequest({ tools, messages, modelId: 'other-model', continuationPolicy: 'require' }), context)
    );
    expect(required.error.code).toBe('FEATURE_UNSUPPORTED');
  });
});

describe('OpenAI adapter: refusal and incomplete output', () => {
  it('maps a refusal', async () => {
    const refusal = { type: 'message', id: 'm', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'I cannot help with that' }] };
    const { adapter } = fakeClient(apiResponse({ output: [refusal] as never }));
    const response = ok(await adapter.execute(baseRequest(), context)).response;
    expect(response.finishReason).toBe('refusal');
    expect(response.refusalReason).toBe('I cannot help with that');
  });

  it('maps incomplete output caused by the token limit to length', async () => {
    const { adapter } = fakeClient(
      apiResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [textMessage('partial')] as never })
    );
    const response = ok(await adapter.execute(baseRequest(), context)).response;
    expect(response.finishReason).toBe('length');
    expect(response.truncated).toBe(true);
    expect(response.text).toBe('partial');
  });

  it('maps incomplete output caused by the content filter', async () => {
    const { adapter } = fakeClient(
      apiResponse({ status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] as never })
    );
    const response = ok(await adapter.execute(baseRequest(), context)).response;
    expect(response.finishReason).toBe('content_filter');
    expect(response.contentFilter).toEqual({ filtered: true, reason: 'content_filter' });
  });
});

describe('OpenAI adapter: error mapping', () => {
  const headers = (extra: Record<string, string> = {}) => new Headers({ 'x-request-id': 'req_err', ...extra });

  it('maps 401 to CREDENTIALS_INVALID (not retryable)', async () => {
    const { adapter } = fakeClient(APIError.generate(401, { error: { message: 'bad key', code: 'invalid_api_key' } }, undefined, headers()));
    const result = fail(await adapter.execute(baseRequest(), context));
    expect(result.error).toMatchObject({
      code: 'CREDENTIALS_INVALID', retrySafety: 'not_retryable', httpStatus: 401, providerCode: 'invalid_api_key', requestId: 'req_err',
    });
    expect(result.providerRequestId).toBe('req_err');
    expect(result.error.message).not.toContain('sk-test');
  });

  it('maps 429 to RATE_LIMITED with the Retry-After delay', async () => {
    const { adapter } = fakeClient(APIError.generate(429, { error: { message: 'slow down' } }, undefined, headers({ 'retry-after': '2' })));
    const { error } = fail(await adapter.execute(baseRequest(), context));
    expect(error).toMatchObject({ code: 'RATE_LIMITED', retrySafety: 'retryable_with_delay', retryAfterMs: 2000 });
  });

  it('maps 429 insufficient_quota to QUOTA_EXCEEDED (not retryable)', async () => {
    const { adapter } = fakeClient(APIError.generate(429, { error: { message: 'quota', code: 'insufficient_quota' } }, undefined, headers()));
    const { error } = fail(await adapter.execute(baseRequest(), context));
    expect(error).toMatchObject({ code: 'QUOTA_EXCEEDED', retrySafety: 'not_retryable', httpStatus: 429 });
  });

  it('maps 500 to PROVIDER_UNAVAILABLE (ambiguous retry)', async () => {
    const { adapter } = fakeClient(APIError.generate(500, { error: { message: 'oops' } }, undefined, headers()));
    const { error } = fail(await adapter.execute(baseRequest(), context));
    expect(error).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retrySafety: 'retryable_ambiguous', httpStatus: 500 });
  });

  it('maps abort, timeout and connection errors', async () => {
    const { adapter } = fakeClient(
      new APIUserAbortError(),
      new APIConnectionTimeoutError(),
      new APIConnectionError({ message: 'ECONNRESET' })
    );
    expect(fail(await adapter.execute(baseRequest(), context)).error).toMatchObject({ code: 'CANCELLED', retrySafety: 'not_retryable' });
    expect(fail(await adapter.execute(baseRequest(), context)).error).toMatchObject({ code: 'TIMEOUT', retrySafety: 'retryable_ambiguous' });
    expect(fail(await adapter.execute(baseRequest(), context)).error).toMatchObject({ code: 'CONNECTION_ERROR', retrySafety: 'retryable_ambiguous' });
  });
});

describe('OpenAI adapter: real SDK client with stubbed fetch (no network)', () => {
  function sdkAdapter(fetchImpl: typeof fetch) {
    return createOpenAIAdapter((opts) => new OpenAI({ ...opts, fetch: fetchImpl }));
  }

  it('makes exactly one HTTP attempt on a 500 because SDK retries are disabled', async () => {
    const fetchStub = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500, headers: { 'content-type': 'application/json' } })
    );
    const result = fail(await sdkAdapter(fetchStub as unknown as typeof fetch).execute(baseRequest(), context));
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('reads the provider request ID from the x-request-id header', async () => {
    const body = apiResponse({ output: [textMessage('hi')] as never });
    const fetchStub = vi.fn(async () =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_hdr' } })
    );
    const result = ok(await sdkAdapter(fetchStub as unknown as typeof fetch).execute(baseRequest(), context));
    expect(result.response.providerRequestId).toBe('req_hdr');
    expect(result.response.text).toBe('hi');
  });
});
