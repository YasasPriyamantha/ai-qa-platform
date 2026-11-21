/**
 * Tests for conversation message types and helpers.
 *
 * Tests message creation, type guards, and content extraction.
 */

import { describe, it, expect } from 'vitest';
import {
  userMessage,
  systemMessage,
  assistantTextMessage,
  toolResultMessage,
  assistantToolCallMessage,
  isSystemMessage,
  isUserMessage,
  isAssistantMessage,
  isToolResultMessage,
  extractToolCalls,
  hasToolCalls,
  getAssistantText,
  hasRefusal,
  getRefusalReason,
  type SystemMessage,
  type UserMessage,
  type AssistantMessage,
  type ToolResultMessage,
  type ToolCall,
  type AssistantContentItem,
} from '../../../src/model-providers/index.js';

describe('Message creation helpers', () => {
  describe('userMessage', () => {
    it('creates a simple user message', () => {
      const msg = userMessage('Hello');

      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
      expect(msg.name).toBeUndefined();
    });

    it('creates a user message with name', () => {
      const msg = userMessage('Hello', 'Alice');

      expect(msg.role).toBe('user');
      expect(msg.content).toBe('Hello');
      expect(msg.name).toBe('Alice');
    });
  });

  describe('systemMessage', () => {
    it('creates a simple system message', () => {
      const msg = systemMessage('You are a helpful assistant.');

      expect(msg.role).toBe('system');
      expect(msg.content).toBe('You are a helpful assistant.');
      expect(msg.name).toBeUndefined();
    });

    it('creates a system message with name', () => {
      const msg = systemMessage('Instructions here', 'main');

      expect(msg.role).toBe('system');
      expect(msg.content).toBe('Instructions here');
      expect(msg.name).toBe('main');
    });
  });

  describe('assistantTextMessage', () => {
    it('creates a text assistant message', () => {
      const msg = assistantTextMessage('I can help with that.');

      expect(msg.role).toBe('assistant');
      expect(msg.content).toBe('I can help with that.');
    });
  });

  describe('toolResultMessage', () => {
    it('creates a simple tool result', () => {
      const msg = toolResultMessage('call_123', 'get_weather', 'Sunny, 72°F');

      expect(msg.role).toBe('tool');
      expect(msg.toolCallId).toBe('call_123');
      expect(msg.toolName).toBe('get_weather');
      expect(msg.content).toBe('Sunny, 72°F');
      expect(msg.isError).toBeUndefined();
    });

    it('creates a tool result with error', () => {
      const msg = toolResultMessage('call_456', 'api_call', 'Connection refused', true);

      expect(msg.role).toBe('tool');
      expect(msg.toolCallId).toBe('call_456');
      expect(msg.toolName).toBe('api_call');
      expect(msg.content).toBe('Connection refused');
      expect(msg.isError).toBe(true);
    });

    it('creates a tool result with content array', () => {
      const content = [
        { type: 'text' as const, text: 'Result data' },
        { type: 'text' as const, text: 'Additional info' },
      ];
      const msg = toolResultMessage('call_789', 'multi_result', content);

      expect(msg.role).toBe('tool');
      expect(msg.content).toEqual(content);
    });

    it('preserves content item ordering in tool results', () => {
      // Per Task 3.2: Tool results support ordered typed content items
      const content = [
        { type: 'text' as const, text: 'First item' },
        { type: 'text' as const, text: 'Second item' },
        { type: 'text' as const, text: 'Third item' },
      ];
      const msg = toolResultMessage('call_order', 'ordered_tool', content);

      // Content must preserve exact order
      expect(Array.isArray(msg.content)).toBe(true);
      const contentArray = msg.content as readonly { type: string; text: string }[];
      expect(contentArray[0].text).toBe('First item');
      expect(contentArray[1].text).toBe('Second item');
      expect(contentArray[2].text).toBe('Third item');
    });
  });

  describe('assistantToolCallMessage', () => {
    it('creates a message with tool calls', () => {
      const toolCalls: ToolCall[] = [
        { id: 'call_1', name: 'search', arguments: '{"query":"test"}' },
        { id: 'call_2', name: 'calculate', arguments: '{"expr":"2+2"}' },
      ];
      const msg = assistantToolCallMessage(toolCalls);

      expect(msg.role).toBe('assistant');
      expect(msg.toolCalls).toEqual(toolCalls);
      expect(Array.isArray(msg.content)).toBe(true);
      expect((msg.content as AssistantContentItem[]).length).toBe(2);
    });

    it('creates a message with tool calls and text', () => {
      const toolCalls: ToolCall[] = [
        { id: 'call_1', name: 'search', arguments: '{"query":"test"}' },
      ];
      const msg = assistantToolCallMessage(toolCalls, 'Let me search for that.');

      expect(msg.role).toBe('assistant');
      expect(msg.toolCalls).toEqual(toolCalls);
      expect(Array.isArray(msg.content)).toBe(true);

      const content = msg.content as AssistantContentItem[];
      expect(content[0]).toEqual({ type: 'text', text: 'Let me search for that.' });
      expect(content[1]).toEqual({ type: 'tool_call', toolCall: toolCalls[0] });
    });
  });
});

describe('Message type guards', () => {
  const system: SystemMessage = { role: 'system', content: 'test' };
  const user: UserMessage = { role: 'user', content: 'test' };
  const assistant: AssistantMessage = { role: 'assistant', content: 'test' };
  const tool: ToolResultMessage = {
    role: 'tool',
    toolCallId: 'call_1',
    toolName: 'test',
    content: 'result',
  };

  describe('isSystemMessage', () => {
    it('returns true for system messages', () => {
      expect(isSystemMessage(system)).toBe(true);
    });

    it('returns false for other message types', () => {
      expect(isSystemMessage(user)).toBe(false);
      expect(isSystemMessage(assistant)).toBe(false);
      expect(isSystemMessage(tool)).toBe(false);
    });
  });

  describe('isUserMessage', () => {
    it('returns true for user messages', () => {
      expect(isUserMessage(user)).toBe(true);
    });

    it('returns false for other message types', () => {
      expect(isUserMessage(system)).toBe(false);
      expect(isUserMessage(assistant)).toBe(false);
      expect(isUserMessage(tool)).toBe(false);
    });
  });

  describe('isAssistantMessage', () => {
    it('returns true for assistant messages', () => {
      expect(isAssistantMessage(assistant)).toBe(true);
    });

    it('returns false for other message types', () => {
      expect(isAssistantMessage(system)).toBe(false);
      expect(isAssistantMessage(user)).toBe(false);
      expect(isAssistantMessage(tool)).toBe(false);
    });
  });

  describe('isToolResultMessage', () => {
    it('returns true for tool messages', () => {
      expect(isToolResultMessage(tool)).toBe(true);
    });

    it('returns false for other message types', () => {
      expect(isToolResultMessage(system)).toBe(false);
      expect(isToolResultMessage(user)).toBe(false);
      expect(isToolResultMessage(assistant)).toBe(false);
    });
  });
});

describe('Assistant message content extraction', () => {
  describe('extractToolCalls', () => {
    it('returns empty array for text-only message', () => {
      const msg: AssistantMessage = { role: 'assistant', content: 'Just text' };
      expect(extractToolCalls(msg)).toEqual([]);
    });

    it('extracts tool calls from toolCalls field', () => {
      const toolCalls: ToolCall[] = [
        { id: 'call_1', name: 'search', arguments: '{}' },
      ];
      const msg: AssistantMessage = {
        role: 'assistant',
        content: '',
        toolCalls,
      };

      expect(extractToolCalls(msg)).toEqual(toolCalls);
    });

    it('extracts tool calls from content blocks', () => {
      const toolCall: ToolCall = { id: 'call_1', name: 'search', arguments: '{}' };
      const msg: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'tool_call', toolCall }],
      };

      expect(extractToolCalls(msg)).toEqual([toolCall]);
    });
  });

  describe('hasToolCalls', () => {
    it('returns false for text-only message', () => {
      const msg: AssistantMessage = { role: 'assistant', content: 'Just text' };
      expect(hasToolCalls(msg)).toBe(false);
    });

    it('returns true when toolCalls field is present', () => {
      const msg: AssistantMessage = {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'search', arguments: '{}' }],
      };
      expect(hasToolCalls(msg)).toBe(true);
    });

    it('returns true when content has tool_call blocks', () => {
      const msg: AssistantMessage = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'First' },
          { type: 'tool_call', toolCall: { id: 'call_1', name: 'search', arguments: '{}' } },
        ],
      };
      expect(hasToolCalls(msg)).toBe(true);
    });
  });

  describe('getAssistantText', () => {
    it('returns string content directly', () => {
      const msg: AssistantMessage = { role: 'assistant', content: 'Hello world' };
      expect(getAssistantText(msg)).toBe('Hello world');
    });

    it('extracts text from content blocks', () => {
      const msg: AssistantMessage = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'First part. ' },
          { type: 'text', text: 'Second part.' },
        ],
      };
      expect(getAssistantText(msg)).toBe('First part. Second part.');
    });

    it('ignores non-text content blocks', () => {
      const msg: AssistantMessage = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Text here' },
          { type: 'tool_call', toolCall: { id: 'call_1', name: 'test', arguments: '{}' } },
        ],
      };
      expect(getAssistantText(msg)).toBe('Text here');
    });

    it('returns empty string when no text content', () => {
      const msg: AssistantMessage = {
        role: 'assistant',
        content: [
          { type: 'tool_call', toolCall: { id: 'call_1', name: 'test', arguments: '{}' } },
        ],
      };
      expect(getAssistantText(msg)).toBe('');
    });
  });

  describe('hasRefusal', () => {
    it('returns false for string content', () => {
      const msg: AssistantMessage = { role: 'assistant', content: 'Normal response' };
      expect(hasRefusal(msg)).toBe(false);
    });

    it('returns false when no refusal block', () => {
      const msg: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Normal response' }],
      };
      expect(hasRefusal(msg)).toBe(false);
    });

    it('returns true when refusal block present', () => {
      const msg: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'refusal', refusal: 'Cannot assist with that' }],
      };
      expect(hasRefusal(msg)).toBe(true);
    });
  });

  describe('getRefusalReason', () => {
    it('returns undefined for string content', () => {
      const msg: AssistantMessage = { role: 'assistant', content: 'Normal response' };
      expect(getRefusalReason(msg)).toBeUndefined();
    });

    it('returns undefined when no refusal block', () => {
      const msg: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Normal response' }],
      };
      expect(getRefusalReason(msg)).toBeUndefined();
    });

    it('returns refusal reason when present', () => {
      const msg: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'refusal', refusal: 'Cannot assist with that request' }],
      };
      expect(getRefusalReason(msg)).toBe('Cannot assist with that request');
    });
  });
});
