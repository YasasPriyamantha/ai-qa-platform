/**
 * OpenAI adapter (Responses API).
 *
 * Task N3: Implements ProviderAdapter with the official `openai` SDK.
 *
 * - Responses API only, `store: false`, SDK retries disabled (`maxRetries: 0`, DEC-036).
 * - Reasoning items are kept in SecureContinuationState and replayed unchanged
 *   for the assistant message that carries the matching continuationRef.
 * - Canonical schemas are sent strict only when they meet OpenAI strict rules;
 *   external tool schemas are sent as-is with `strict: false`.
 */

import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  type ClientOptions,
} from 'openai';
import type {
  FunctionTool,
  Response as OpenAIResponse,
  ResponseCreateParamsNonStreaming,
  ResponseInputItem,
  ResponseFunctionCallOutputItem,
  ResponseInputContent,
} from 'openai/resources/responses/responses';
import type { AdapterContext, AdapterResult, ProviderAdapter } from './adapter-interface.js';
import { ContinuationStateRegistry, createContinuationState } from './continuation.js';
import { ProviderErrors, type ProviderError } from './errors.js';
import type { AssistantContentItem, ToolCall } from './messages.js';
import { extractJsonSchema, isExternalToolSchema, type ModelRequest, type ToolDefinition, type ToolChoicePolicy } from './request.js';
import { ResponseBuilder, type FinishReason } from './response.js';
import { validateStructuredOutput, type CanonicalSchema } from './schema.js';
import type { ProviderIdentity } from './types.js';
import { createObservedUsage, createUnknownObservedUsage } from './usage.js';

/** The part of the SDK client the adapter uses. Tests inject a fake. */
interface ResponsesClient {
  responses: {
    create(
      body: ResponseCreateParamsNonStreaming,
      options?: { signal?: AbortSignal }
    ): PromiseLike<OpenAIResponse>;
  };
}

/**
 * Create the OpenAI Responses API adapter.
 *
 * @param createClient - Optional client factory (tests inject a fake; default is the real SDK client)
 */
export function createOpenAIAdapter(
  createClient: (options: ClientOptions) => ResponsesClient = (options) => new OpenAI(options)
): ProviderAdapter {
  const continuations = new ContinuationStateRegistry();

  return {
    adapterType: 'openai-responses',
    displayName: 'OpenAI (Responses API)',

    async execute(request: ModelRequest, context: AdapterContext): Promise<AdapterResult> {
      const identity: ProviderIdentity = {
        providerId: request.providerId,
        adapterType: 'openai-responses',
        modelId: request.modelId ?? context.providerConfig.defaultModelId,
      };

      const built = buildParams(request, context, identity, continuations);
      if ('error' in built) {
        return { success: false, error: built.error, sdkRetriesDisabled: true };
      }

      const client = createClient({
        apiKey: context.apiKey,
        baseURL: context.providerConfig.baseUrl,
        maxRetries: 0,
      });

      const requestedAt = new Date();
      let response: OpenAIResponse;
      try {
        response = await client.responses.create(built.params, { signal: context.signal });
      } catch (err) {
        return {
          success: false,
          error: mapError(err, request.providerId, context.options.timeoutMs ?? 0),
          providerRequestId: err instanceof APIError ? (err.requestID ?? undefined) : undefined,
          sdkRetriesDisabled: true,
        };
      }

      return translateResponse(response, request, context, identity, requestedAt, continuations);
    },
  };
}

// ============================================================================
// Request translation
// ============================================================================

function buildParams(
  request: ModelRequest,
  context: AdapterContext,
  identity: ProviderIdentity,
  continuations: ContinuationStateRegistry
): { params: ResponseCreateParamsNonStreaming } | { error: ProviderError } {
  const options = request.options ?? {};
  // The Responses API has no stop sequences or seed; refuse rather than drop them silently.
  if (options.stopSequences && options.stopSequences.length > 0) {
    return { error: ProviderErrors.featureUnsupported('stopSequences', request.providerId) };
  }
  if (options.seed !== undefined) {
    return { error: ProviderErrors.featureUnsupported('seed', request.providerId) };
  }

  const input = translateMessages(request, identity, continuations);
  if ('error' in input) return input;

  const params: ResponseCreateParamsNonStreaming = {
    model: identity.modelId,
    input: input.items,
    store: false,
  };
  if (context.providerConfig.capabilities.reasoning !== 'unsupported') {
    // With store: false, reasoning items can only be replayed in encrypted form.
    params.include = ['reasoning.encrypted_content'];
  }
  if (request.instructions !== undefined) params.instructions = request.instructions;
  if (options.maxTokens !== undefined) params.max_output_tokens = options.maxTokens;
  if (options.temperature !== undefined) params.temperature = options.temperature;
  if (options.topP !== undefined) params.top_p = options.topP;
  if (options.user !== undefined) params.safety_identifier = options.user;

  if (request.tools && request.tools.length > 0) {
    const tools: FunctionTool[] = [];
    for (const tool of request.tools) {
      const converted = translateTool(tool, request.providerId);
      if ('error' in converted) return converted;
      tools.push(converted.tool);
    }
    params.tools = tools;
    if (request.toolChoice !== undefined) params.tool_choice = translateToolChoice(request.toolChoice);
  }

  if (request.structuredOutput) {
    const { schema, name, strict } = request.structuredOutput;
    const converted = convertCanonical(schema, request.providerId);
    if ('error' in converted) return converted;
    params.text = {
      format: {
        type: 'json_schema',
        name: toSchemaName(name ?? schema.name ?? schema.id),
        schema: converted.jsonSchema,
        strict: strict !== false && meetsStrictRules(converted.jsonSchema),
      },
    };
  }

  return { params };
}

function translateMessages(
  request: ModelRequest,
  identity: ProviderIdentity,
  continuations: ContinuationStateRegistry
): { items: ResponseInputItem[] } | { error: ProviderError } {
  const items: ResponseInputItem[] = [];
  const replay = request.continuationPolicy !== 'ignore' && request.continuationPolicy !== 'clear';

  for (const msg of request.messages) {
    switch (msg.role) {
      case 'system':
        items.push({ role: 'system', content: msg.content });
        break;
      case 'user':
        items.push({
          role: 'user',
          content: typeof msg.content === 'string' ? msg.content : msg.content.map(toInputContent),
        });
        break;
      case 'assistant': {
        if (replay && msg.continuationRef !== undefined) {
          // Replay the original output items (reasoning, function calls, message) unchanged.
          const access = continuations.get(msg.continuationRef)?.getPayload(identity);
          if (access?.granted) {
            items.push(...(access.payload as ResponseInputItem[]));
            break;
          }
          if (request.continuationPolicy === 'require') {
            return {
              error: ProviderErrors.featureUnsupported(
                `continuation state '${msg.continuationRef}' (${access?.reason ?? 'not_found'})`,
                request.providerId
              ),
            };
          }
        }
        const content: readonly AssistantContentItem[] =
          typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content;
        const text = content
          .map((c) => (c.type === 'text' ? c.text : c.type === 'refusal' ? c.refusal : ''))
          .join('');
        if (text !== '') items.push({ role: 'assistant', content: text });
        const calls = msg.toolCalls ?? content.flatMap((c) => (c.type === 'tool_call' ? [c.toolCall] : []));
        for (const call of calls) {
          items.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments });
        }
        break;
      }
      case 'tool':
        items.push({
          type: 'function_call_output',
          call_id: msg.toolCallId,
          output:
            typeof msg.content === 'string'
              ? msg.content
              : msg.content.map((c) => toInputContent(c) as ResponseFunctionCallOutputItem),
        });
        break;
    }
  }
  return { items };
}

function toInputContent(
  item: { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string } | { type: 'image_url'; url: string }
): ResponseInputContent {
  switch (item.type) {
    case 'text':
      return { type: 'input_text', text: item.text };
    case 'image':
      return { type: 'input_image', detail: 'auto', image_url: `data:${item.mediaType};base64,${item.data}` };
    case 'image_url':
      return { type: 'input_image', detail: 'auto', image_url: item.url };
  }
}

function translateTool(
  tool: ToolDefinition,
  providerId: string
): { tool: FunctionTool } | { error: ProviderError } {
  const base = { type: 'function' as const, name: tool.name, description: tool.description };
  if (tool.parameters === undefined) {
    return { tool: { ...base, parameters: null, strict: false } };
  }
  if (isExternalToolSchema(tool.parameters)) {
    // External (e.g. MCP) schemas are untrusted and passed through unchanged, never strict.
    return { tool: { ...base, parameters: tool.parameters.jsonSchema as Record<string, unknown>, strict: false } };
  }
  const converted = convertCanonical(tool.parameters, providerId);
  if ('error' in converted) return converted;
  return { tool: { ...base, parameters: converted.jsonSchema, strict: meetsStrictRules(converted.jsonSchema) } };
}

function convertCanonical(
  schema: CanonicalSchema<unknown>,
  providerId: string
): { jsonSchema: Record<string, unknown> } | { error: ProviderError } {
  const result = extractJsonSchema(schema);
  if (!result.success) {
    return { error: ProviderErrors.featureUnsupported(`schema '${schema.id}': ${result.reason}`, providerId) };
  }
  return { jsonSchema: result.jsonSchema as Record<string, unknown> };
}

function translateToolChoice(choice: ToolChoicePolicy): ResponseCreateParamsNonStreaming['tool_choice'] {
  return typeof choice === 'string' ? choice : { type: 'function', name: choice.name };
}

/** OpenAI requires format names matching ^[a-zA-Z0-9_-]{1,64}$. */
function toSchemaName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'output';
}

/** Keywords OpenAI strict mode rejects. */
const STRICT_UNSUPPORTED_KEYWORDS = [
  'allOf', 'oneOf', 'not', 'if', 'then', 'else', 'patternProperties',
  'dependentRequired', 'dependentSchemas', 'unevaluatedProperties', 'propertyNames',
];

/**
 * Whether a JSON Schema meets OpenAI strict-mode rules: the root is an object,
 * every object sets `additionalProperties: false` and lists all its properties
 * as required, and no unsupported keyword is used.
 */
function meetsStrictRules(schema: Record<string, unknown>): boolean {
  if (schema.type !== 'object') return false;
  const check = (node: unknown): boolean => {
    if (typeof node !== 'object' || node === null) return true;
    if (Array.isArray(node)) return node.every(check);
    const obj = node as Record<string, unknown>;
    if (STRICT_UNSUPPORTED_KEYWORDS.some((k) => k in obj)) return false;
    if (obj.type === 'object' || obj.properties !== undefined) {
      if (obj.additionalProperties !== false) return false;
      const keys = Object.keys((obj.properties as Record<string, unknown> | undefined) ?? {});
      const required = Array.isArray(obj.required) ? (obj.required as string[]) : [];
      if (keys.some((k) => !required.includes(k))) return false;
    }
    for (const key of ['properties', '$defs']) {
      if (obj[key] !== undefined && !Object.values(obj[key] as object).every(check)) return false;
    }
    return check(obj.items) && check(obj.anyOf);
  };
  return check(schema);
}

// ============================================================================
// Response translation
// ============================================================================

function translateResponse(
  response: OpenAIResponse,
  request: ModelRequest,
  context: AdapterContext,
  identity: ProviderIdentity,
  requestedAt: Date,
  continuations: ContinuationStateRegistry
): AdapterResult {
  const providerRequestId = (response as { _request_id?: string | null })._request_id ?? undefined;
  const usage = response.usage
    ? createObservedUsage({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
        cachedTokens: response.usage.input_tokens_details?.cached_tokens,
        reasoningTokens: response.usage.output_tokens_details?.reasoning_tokens,
      })
    : createUnknownObservedUsage();

  if (response.status === 'failed') {
    const err = ProviderErrors.unknownError(response.error?.message ?? 'response failed');
    return {
      success: false,
      error: { ...err, providerCode: response.error?.code, requestId: providerRequestId },
      partialUsage: usage,
      providerRequestId,
      sdkRetriesDisabled: true,
    };
  }

  const content: AssistantContentItem[] = [];
  const toolCalls: ToolCall[] = [];
  let hasReasoning = false;
  for (const item of response.output) {
    if (item.type === 'message') {
      for (const part of item.content) {
        content.push(part.type === 'output_text' ? { type: 'text', text: part.text } : { type: 'refusal', refusal: part.refusal });
      }
    } else if (item.type === 'function_call') {
      const call: ToolCall = { id: item.call_id, name: item.name, arguments: item.arguments };
      toolCalls.push(call);
      content.push({ type: 'tool_call', toolCall: call });
    } else if (item.type === 'reasoning') {
      hasReasoning = true;
    }
  }

  const refusal = content.some((c) => c.type === 'refusal');
  const incompleteReason = response.incomplete_details?.reason;
  let finishReason: FinishReason;
  if (response.status === 'incomplete') {
    finishReason =
      incompleteReason === 'max_output_tokens' ? 'length'
      : incompleteReason === 'content_filter' ? 'content_filter'
      : 'incomplete';
  } else if (refusal) {
    finishReason = 'refusal';
  } else if (toolCalls.length > 0) {
    finishReason = 'tool_calls';
  } else {
    finishReason = 'stop';
  }

  // Keep the whole output (reasoning + calls + message, in order) so it can be replayed unchanged.
  const continuationRef = hasReasoning
    ? continuations.register(createContinuationState(identity, structuredClone(response.output)))
    : undefined;

  const completedAt = new Date();
  const builder = new ResponseBuilder()
    .identity(identity)
    .platformRequestId(context.platformRequestId)
    .message({
      role: 'assistant',
      content,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(continuationRef !== undefined ? { continuationRef } : {}),
    })
    .finishReason(finishReason)
    .usage(usage)
    .timing({
      totalMs: completedAt.getTime() - requestedAt.getTime(),
      requestedAt: requestedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    });
  if (providerRequestId !== undefined) builder.providerRequestId(providerRequestId);
  if (continuationRef !== undefined) builder.continuationRef(continuationRef);
  if (finishReason === 'content_filter') builder.contentFilter({ filtered: true, reason: incompleteReason });

  if (request.structuredOutput && finishReason === 'stop') {
    const text = content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    const validation = validateStructuredOutput(request.structuredOutput.schema, text, { finishReason });
    if (validation.status !== 'valid') {
      const errors =
        validation.status === 'schema_invalid'
          ? validation.errors.map((e) => `${e.path.join('.')}: ${e.message}`)
          : [validation.status];
      return {
        success: false,
        error: { ...ProviderErrors.structuredOutputInvalid(errors), requestId: providerRequestId },
        partialUsage: usage,
        providerRequestId,
        sdkRetriesDisabled: true,
      };
    }
    builder.structuredOutput(validation.data, true);
  }

  return { success: true, response: builder.build(), observedUsage: usage, sdkRetriesDisabled: true };
}

// ============================================================================
// Error mapping
// ============================================================================

function mapError(err: unknown, providerId: string, timeoutMs: number): ProviderError {
  if (err instanceof APIUserAbortError) return ProviderErrors.cancelled();
  if (err instanceof APIConnectionTimeoutError) return ProviderErrors.timeout(timeoutMs);
  if (err instanceof APIConnectionError) return ProviderErrors.connectionError(err.message);
  if (err instanceof APIError && err.status !== undefined) {
    const details = {
      httpStatus: err.status,
      providerCode: err.code ?? undefined,
      providerType: err.type,
      requestId: err.requestID ?? undefined,
    };
    if (err.status === 429 && err.code === 'insufficient_quota') {
      return { ...ProviderErrors.quotaExceeded(), ...details };
    }
    const mapped = ProviderErrors.fromHttpStatus(err.status, providerId);
    const retryAfterSeconds = Number(err.headers?.get('retry-after'));
    const retryAfter =
      mapped.code === 'RATE_LIMITED' && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? { retryAfterMs: retryAfterSeconds * 1000 }
        : {};
    return { ...mapped, ...details, ...retryAfter };
  }
  return ProviderErrors.unknownError(err instanceof Error ? err.message : String(err));
}
