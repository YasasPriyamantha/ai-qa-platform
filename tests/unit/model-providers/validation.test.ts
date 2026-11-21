/**
 * Tests for message validation and tool correlation.
 *
 * Tests:
 * - Message union validation
 * - Multi-turn tool-call/result correlation
 * - Message sequence validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateSystemMessage,
  validateUserMessage,
  validateAssistantMessage,
  validateToolResultMessage,
  validateMessage,
  validateToolCorrelation,
  validateMessageSequence,
  type ConversationMessage,
  type SystemMessage,
  type UserMessage,
  type AssistantMessage,
  type ToolResultMessage,
} from '../../../src/model-providers/index.js';

describe('validateSystemMessage', () => {
  it('accepts valid system message', () => {
    const msg: SystemMessage = { role: 'system', content: 'You are helpful.' };
    const result = validateSystemMessage(msg);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts system message with name', () => {
    const msg: SystemMessage = { role: 'system', content: 'Instructions', name: 'main' };
    const result = validateSystemMessage(msg);

    expect(result.valid).toBe(true);
  });

  it('rejects non-object', () => {
    const result = validateSystemMessage('not an object');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('message must be an object');
  });

  it('rejects wrong role', () => {
    const result = validateSystemMessage({ role: 'user', content: 'test' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("role must be 'system'"))).toBe(true);
  });

  it('rejects non-string content', () => {
    const result = validateSystemMessage({ role: 'system', content: 123 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('content must be a string');
  });

  it('rejects empty content', () => {
    const result = validateSystemMessage({ role: 'system', content: '' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('content must not be empty');
  });
});

describe('validateUserMessage', () => {
  it('accepts valid string content', () => {
    const msg: UserMessage = { role: 'user', content: 'Hello' };
    const result = validateUserMessage(msg);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid array content', () => {
    const msg: UserMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'What is this?' },
        { type: 'image', mediaType: 'image/png', data: 'base64data' },
      ],
    };
    const result = validateUserMessage(msg);

    expect(result.valid).toBe(true);
  });

  it('rejects invalid content item type', () => {
    const msg = {
      role: 'user',
      content: [{ type: 'unknown', data: 'test' }],
    };
    const result = validateUserMessage(msg);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('content[0].type'))).toBe(true);
  });

  it('rejects image with invalid media type', () => {
    const msg = {
      role: 'user',
      content: [{ type: 'image', mediaType: 'text/plain', data: 'base64data' }],
    };
    const result = validateUserMessage(msg);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('mediaType'))).toBe(true);
  });
});

describe('validateAssistantMessage', () => {
  it('accepts valid string content', () => {
    const msg: AssistantMessage = { role: 'assistant', content: 'Here is my response.' };
    const result = validateAssistantMessage(msg);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid content with tool calls', () => {
    const msg: AssistantMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me help.' },
        {
          type: 'tool_call',
          toolCall: { id: 'call_123', name: 'search', arguments: '{"q":"test"}' },
        },
      ],
      toolCalls: [{ id: 'call_123', name: 'search', arguments: '{"q":"test"}' }],
    };
    const result = validateAssistantMessage(msg);

    expect(result.valid).toBe(true);
  });

  it('accepts refusal content', () => {
    const msg: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'refusal', refusal: 'I cannot help with that.' }],
    };
    const result = validateAssistantMessage(msg);

    expect(result.valid).toBe(true);
  });

  it('rejects tool call with empty id', () => {
    const msg = {
      role: 'assistant',
      toolCalls: [{ id: '', name: 'search', arguments: '{}' }],
      content: '',
    };
    const result = validateAssistantMessage(msg);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('id must be a non-empty string'))).toBe(true);
  });

  it('rejects tool call with non-string arguments', () => {
    const msg = {
      role: 'assistant',
      toolCalls: [{ id: 'call_1', name: 'search', arguments: { query: 'test' } }],
      content: '',
    };
    const result = validateAssistantMessage(msg);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('arguments must be a string'))).toBe(true);
  });
});

describe('validateToolResultMessage', () => {
  it('accepts valid string content', () => {
    const msg: ToolResultMessage = {
      role: 'tool',
      toolCallId: 'call_123',
      toolName: 'search',
      content: 'Found 5 results',
    };
    const result = validateToolResultMessage(msg);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts valid array content', () => {
    const msg: ToolResultMessage = {
      role: 'tool',
      toolCallId: 'call_123',
      toolName: 'search',
      content: [{ type: 'text', text: 'Result 1' }, { type: 'text', text: 'Result 2' }],
    };
    const result = validateToolResultMessage(msg);

    expect(result.valid).toBe(true);
  });

  it('accepts error result', () => {
    const msg: ToolResultMessage = {
      role: 'tool',
      toolCallId: 'call_123',
      toolName: 'api_call',
      content: 'Connection refused',
      isError: true,
    };
    const result = validateToolResultMessage(msg);

    expect(result.valid).toBe(true);
  });

  it('rejects empty toolCallId', () => {
    const msg = {
      role: 'tool',
      toolCallId: '',
      toolName: 'search',
      content: 'result',
    };
    const result = validateToolResultMessage(msg);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('toolCallId'))).toBe(true);
  });

  it('rejects empty toolName', () => {
    const msg = {
      role: 'tool',
      toolCallId: 'call_123',
      toolName: '',
      content: 'result',
    };
    const result = validateToolResultMessage(msg);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('toolName'))).toBe(true);
  });
});

describe('validateMessage', () => {
  it('dispatches to correct validator based on role', () => {
    const system: SystemMessage = { role: 'system', content: 'test' };
    const user: UserMessage = { role: 'user', content: 'test' };
    const assistant: AssistantMessage = { role: 'assistant', content: 'test' };
    const tool: ToolResultMessage = {
      role: 'tool',
      toolCallId: 'call_1',
      toolName: 'test',
      content: 'result',
    };

    expect(validateMessage(system).valid).toBe(true);
    expect(validateMessage(user).valid).toBe(true);
    expect(validateMessage(assistant).valid).toBe(true);
    expect(validateMessage(tool).valid).toBe(true);
  });

  it('rejects unknown role', () => {
    const result = validateMessage({ role: 'unknown', content: 'test' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('role must be'))).toBe(true);
  });
});

describe('validateToolCorrelation', () => {
  it('accepts empty message array', () => {
    const result = validateToolCorrelation([]);

    expect(result.valid).toBe(true);
    expect(result.pendingCalls).toHaveLength(0);
    expect(result.orphanedResults).toHaveLength(0);
  });

  it('accepts valid tool call and result sequence', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Search for X' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', toolCall: { id: 'call_1', name: 'search', arguments: '{"q":"X"}' } },
        ],
        toolCalls: [{ id: 'call_1', name: 'search', arguments: '{"q":"X"}' }],
      },
      { role: 'tool', toolCallId: 'call_1', toolName: 'search', content: 'Found X' },
      { role: 'assistant', content: 'I found X for you.' },
    ];
    const result = validateToolCorrelation(messages);

    expect(result.valid).toBe(true);
    expect(result.pendingCalls).toHaveLength(0);
    expect(result.orphanedResults).toHaveLength(0);
  });

  it('allows pending tool calls at end of conversation', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Search for X' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'search', arguments: '{"q":"X"}' }],
      },
    ];
    const result = validateToolCorrelation(messages);

    // Pending calls are allowed (conversation may continue)
    expect(result.pendingCalls).toContain('call_1');
    // But orphaned results are errors
    expect(result.orphanedResults).toHaveLength(0);
  });

  it('detects orphaned tool results', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'tool', toolCallId: 'nonexistent', toolName: 'search', content: 'result' },
    ];
    const result = validateToolCorrelation(messages);

    expect(result.valid).toBe(false);
    expect(result.orphanedResults).toContain('nonexistent');
    expect(result.errors.some((e) => e.includes('unknown call ID'))).toBe(true);
  });

  it('detects duplicate tool call IDs', () => {
    const messages: ConversationMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_dup', name: 'search', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: 'call_dup', toolName: 'search', content: 'result1' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_dup', name: 'calculate', arguments: '{}' }],
      },
    ];
    const result = validateToolCorrelation(messages);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate tool call ID'))).toBe(true);
  });

  it('detects tool name mismatch', () => {
    const messages: ConversationMessage[] = [
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'search', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: 'call_1', toolName: 'different_tool', content: 'result' },
    ];
    const result = validateToolCorrelation(messages);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('was for tool'))).toBe(true);
  });

  it('handles multiple tool calls in one message', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Get weather and news' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_call', toolCall: { id: 'call_1', name: 'weather', arguments: '{}' } },
          { type: 'tool_call', toolCall: { id: 'call_2', name: 'news', arguments: '{}' } },
        ],
        toolCalls: [
          { id: 'call_1', name: 'weather', arguments: '{}' },
          { id: 'call_2', name: 'news', arguments: '{}' },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', toolName: 'weather', content: 'Sunny' },
      { role: 'tool', toolCallId: 'call_2', toolName: 'news', content: 'Headlines...' },
      { role: 'assistant', content: 'The weather is sunny and here are the news.' },
    ];
    const result = validateToolCorrelation(messages);

    expect(result.valid).toBe(true);
    expect(result.pendingCalls).toHaveLength(0);
    expect(result.orphanedResults).toHaveLength(0);
  });
});

describe('validateMessageSequence', () => {
  it('accepts valid conversation', () => {
    const messages: ConversationMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const result = validateMessageSequence(messages);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports individual message errors', () => {
    const messages = [
      { role: 'system', content: '' }, // Invalid: empty content
      { role: 'user', content: 'Hello' },
    ];
    const result = validateMessageSequence(messages as ConversationMessage[]);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('message[0]'))).toBe(true);
  });

  it('validates tool correlation in sequence', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'Search' },
      { role: 'tool', toolCallId: 'nonexistent', toolName: 'search', content: 'result' },
    ];
    const result = validateMessageSequence(messages);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown call ID'))).toBe(true);
  });
});
