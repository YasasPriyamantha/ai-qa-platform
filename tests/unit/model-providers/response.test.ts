/**
 * Tests for response types and builder.
 *
 * Tests:
 * - Response type guards
 * - Response builder
 * - Success/error response creation
 */

import { describe, it, expect } from 'vitest';
import {
  ResponseBuilder,
  isSuccessResponse,
  isErrorResponse,
  successResponse,
  errorResponse,
  ProviderErrors,
  type ModelResponse,
  type ModelResult,
  type ModelSuccessResponse,
  type ModelErrorResponse,
  type ProviderIdentity,
  type AssistantMessage,
  type ResponseTiming,
} from '../../../src/model-providers/index.js';

describe('ResponseBuilder', () => {
  const identity: ProviderIdentity = {
    providerId: 'openai',
    adapterType: 'openai-responses',
    modelId: 'gpt-4o',
  };

  const timing: ResponseTiming = {
    totalMs: 1500,
    requestedAt: '2024-01-01T12:00:00Z',
    completedAt: '2024-01-01T12:00:01.500Z',
  };

  it('builds minimal response', () => {
    const message: AssistantMessage = { role: 'assistant', content: 'Hello!' };

    const response = new ResponseBuilder()
      .identity(identity)
      .message(message)
      .timing(timing)
      .build();

    expect(response.identity).toEqual(identity);
    expect(response.message).toEqual(message);
    expect(response.text).toBe('Hello!');
    expect(response.finishReason).toBe('stop');
    expect(response.hasToolCalls).toBe(false);
    expect(response.toolCalls).toHaveLength(0);
    expect(response.hasContinuation).toBe(false);
    expect(response.truncated).toBe(false);
  });

  it('builds response with tool calls', () => {
    const message: AssistantMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me search.' },
        { type: 'tool_call', toolCall: { id: 'call_1', name: 'search', arguments: '{}' } },
      ],
      toolCalls: [{ id: 'call_1', name: 'search', arguments: '{}' }],
    };

    const response = new ResponseBuilder()
      .identity(identity)
      .message(message)
      .finishReason('tool_calls')
      .timing(timing)
      .build();

    expect(response.hasToolCalls).toBe(true);
    expect(response.toolCalls).toHaveLength(1);
    expect(response.finishReason).toBe('tool_calls');
    expect(response.text).toBe('Let me search.');
  });

  it('builds response with structured output', () => {
    const message: AssistantMessage = {
      role: 'assistant',
      content: '{"name":"John","age":30}',
    };

    const response = new ResponseBuilder()
      .identity(identity)
      .message(message)
      .structuredOutput({ name: 'John', age: 30 }, true)
      .timing(timing)
      .build();

    expect(response.structuredOutput).toEqual({ name: 'John', age: 30 });
    expect(response.structuredOutputValid).toBe(true);
  });

  it('builds response with continuation ref', () => {
    const message: AssistantMessage = { role: 'assistant', content: 'Thinking...' };

    const response = new ResponseBuilder()
      .identity(identity)
      .message(message)
      .continuationRef('cont_abc123')
      .timing(timing)
      .build();

    expect(response.continuationRef).toBe('cont_abc123');
    expect(response.hasContinuation).toBe(true);
  });

  it('builds response with usage', () => {
    const message: AssistantMessage = { role: 'assistant', content: 'Response' };

    const response = new ResponseBuilder()
      .identity(identity)
      .message(message)
      .usage({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      })
      .timing(timing)
      .build();

    expect(response.usage?.inputTokens).toBe(100);
    expect(response.usage?.outputTokens).toBe(50);
    expect(response.usage?.totalTokens).toBe(150);
  });

  it('extracts refusal reason from content', () => {
    const message: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'refusal', refusal: 'Cannot assist with that' }],
    };

    const response = new ResponseBuilder()
      .identity(identity)
      .message(message)
      .finishReason('refusal')
      .timing(timing)
      .build();

    expect(response.refusalReason).toBe('Cannot assist with that');
    expect(response.finishReason).toBe('refusal');
  });

  it('marks truncated for length finish reason', () => {
    const message: AssistantMessage = { role: 'assistant', content: 'Partial resp...' };

    const response = new ResponseBuilder()
      .identity(identity)
      .message(message)
      .finishReason('length')
      .timing(timing)
      .build();

    expect(response.truncated).toBe(true);
  });

  it('marks truncated for incomplete finish reason', () => {
    const message: AssistantMessage = { role: 'assistant', content: 'Partial' };

    const response = new ResponseBuilder()
      .identity(identity)
      .message(message)
      .finishReason('incomplete')
      .timing(timing)
      .build();

    expect(response.truncated).toBe(true);
  });

  it('throws when identity is missing', () => {
    const message: AssistantMessage = { role: 'assistant', content: 'test' };

    expect(() =>
      new ResponseBuilder().message(message).timing(timing).build()
    ).toThrow('identity is required');
  });

  it('throws when message is missing', () => {
    expect(() => new ResponseBuilder().identity(identity).timing(timing).build()).toThrow(
      'message is required'
    );
  });

  it('throws when timing is missing', () => {
    const message: AssistantMessage = { role: 'assistant', content: 'test' };

    expect(() => new ResponseBuilder().identity(identity).message(message).build()).toThrow(
      'timing is required'
    );
  });

  it('sets optional fields', () => {
    const message: AssistantMessage = { role: 'assistant', content: 'test' };

    const response = new ResponseBuilder()
      .identity(identity)
      .message(message)
      .timing(timing)
      .providerRequestId('req_123')
      .platformRequestId('platform_456')
      .modelFingerprint('fp_abc')
      .contentFilter({ filtered: false })
      .build();

    expect(response.providerRequestId).toBe('req_123');
    expect(response.platformRequestId).toBe('platform_456');
    expect(response.modelFingerprint).toBe('fp_abc');
    expect(response.contentFilter?.filtered).toBe(false);
  });
});

describe('Response type guards', () => {
  const mockResponse: ModelResponse = {
    identity: { providerId: 'test', adapterType: 'openai-responses', modelId: 'test' },
    message: { role: 'assistant', content: 'test' },
    finishReason: 'stop',
    hasToolCalls: false,
    toolCalls: [],
    text: 'test',
    hasContinuation: false,
    timing: {
      totalMs: 100,
      requestedAt: '2024-01-01T12:00:00Z',
      completedAt: '2024-01-01T12:00:00.100Z',
    },
    truncated: false,
  };

  describe('isSuccessResponse', () => {
    it('returns true for success response', () => {
      const result: ModelResult = { success: true, response: mockResponse };
      expect(isSuccessResponse(result)).toBe(true);
    });

    it('returns false for error response', () => {
      const result: ModelResult = {
        success: false,
        error: ProviderErrors.timeout(5000),
      };
      expect(isSuccessResponse(result)).toBe(false);
    });
  });

  describe('isErrorResponse', () => {
    it('returns true for error response', () => {
      const result: ModelResult = {
        success: false,
        error: ProviderErrors.timeout(5000),
      };
      expect(isErrorResponse(result)).toBe(true);
    });

    it('returns false for success response', () => {
      const result: ModelResult = { success: true, response: mockResponse };
      expect(isErrorResponse(result)).toBe(false);
    });
  });
});

describe('successResponse', () => {
  it('wraps response in success result', () => {
    const mockResponse: ModelResponse = {
      identity: { providerId: 'test', adapterType: 'openai-responses', modelId: 'test' },
      message: { role: 'assistant', content: 'Hello' },
      finishReason: 'stop',
      hasToolCalls: false,
      toolCalls: [],
      text: 'Hello',
      hasContinuation: false,
      timing: {
        totalMs: 100,
        requestedAt: '2024-01-01T12:00:00Z',
        completedAt: '2024-01-01T12:00:00.100Z',
      },
      truncated: false,
    };

    const result = successResponse(mockResponse);

    expect(result.success).toBe(true);
    expect((result as ModelSuccessResponse).response).toBe(mockResponse);
  });
});

describe('errorResponse', () => {
  it('wraps error in error result', () => {
    const error = ProviderErrors.rateLimited(5000);

    const result = errorResponse(error);

    expect(result.success).toBe(false);
    expect((result as ModelErrorResponse).error).toBe(error);
  });

  it('includes optional metadata', () => {
    const error = ProviderErrors.timeout(5000);
    const identity: ProviderIdentity = {
      providerId: 'openai',
      adapterType: 'openai-responses',
      modelId: 'gpt-4o',
    };

    const result = errorResponse(error, {
      identity,
      providerRequestId: 'req_123',
      platformRequestId: 'platform_456',
      partialUsage: { inputTokens: 100 },
    });

    expect(result.identity).toEqual(identity);
    expect(result.providerRequestId).toBe('req_123');
    expect(result.platformRequestId).toBe('platform_456');
    expect(result.partialUsage?.inputTokens).toBe(100);
  });
});
