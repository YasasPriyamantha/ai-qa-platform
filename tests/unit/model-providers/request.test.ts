/**
 * Tests for request validation.
 *
 * Tests:
 * - Request validation
 * - Message order validation
 * - Tool definition validation
 * - Bounded options validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateRequest,
  DEFAULT_REQUEST_OPTIONS,
  type ModelRequest,
  type ToolDefinition,
} from '../../../src/model-providers/index.js';

describe('validateRequest', () => {
  const minimalValidRequest: ModelRequest = {
    providerId: 'openai',
    messages: [{ role: 'user', content: 'Hello' }],
  };

  describe('basic validation', () => {
    it('accepts minimal valid request', () => {
      const result = validateRequest(minimalValidRequest);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects empty providerId', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        providerId: '',
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('providerId is required');
    });

    it('rejects whitespace-only providerId', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        providerId: '   ',
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
    });

    it('rejects empty messages array', () => {
      const request: ModelRequest = {
        providerId: 'openai',
        messages: [],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('messages array must not be empty');
    });
  });

  describe('message order validation', () => {
    it('accepts system message at start', () => {
      const request: ModelRequest = {
        providerId: 'openai',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });

    it('accepts valid tool call sequence', () => {
      const request: ModelRequest = {
        providerId: 'openai',
        messages: [
          { role: 'user', content: 'Search for X' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_1', name: 'search', arguments: '{"q":"X"}' }],
          },
          { role: 'tool', toolCallId: 'call_1', toolName: 'search', content: 'Found X' },
          { role: 'assistant', content: 'I found X.' },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });

    it('rejects orphaned tool result', () => {
      const request: ModelRequest = {
        providerId: 'openai',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'tool', toolCallId: 'nonexistent', toolName: 'search', content: 'result' },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('no matching tool call'))).toBe(true);
    });

    it('rejects mismatched tool name in result', () => {
      const request: ModelRequest = {
        providerId: 'openai',
        messages: [
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_1', name: 'search', arguments: '{}' }],
          },
          { role: 'tool', toolCallId: 'call_1', toolName: 'different', content: 'result' },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('does not match call name'))).toBe(true);
    });
  });

  describe('tool definitions validation', () => {
    it('accepts valid tool definitions', () => {
      const tools: ToolDefinition[] = [
        {
          name: 'search',
          description: 'Search the web',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
        {
          name: 'calculate',
          description: 'Perform calculations',
          parameters: { type: 'object', properties: { expr: { type: 'string' } } },
        },
      ];
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools,
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });

    it('rejects empty tool name', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: '',
            description: 'Tool with empty name',
            parameters: { type: 'object' },
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('tool name must not be empty'))).toBe(true);
    });

    it('rejects duplicate tool names', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          { name: 'search', description: 'First search', parameters: { type: 'object' } },
          { name: 'search', description: 'Duplicate search', parameters: { type: 'object' } },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('duplicate tool name'))).toBe(true);
    });
  });

  describe('tool choice validation', () => {
    it('accepts auto tool choice', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [{ name: 'search', description: 'Search', parameters: { type: 'object' } }],
        toolChoice: 'auto',
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });

    it('accepts specific tool choice when tool exists', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [{ name: 'search', description: 'Search', parameters: { type: 'object' } }],
        toolChoice: { type: 'specific', name: 'search' },
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });

    it('rejects specific tool choice when tool does not exist', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [{ name: 'search', description: 'Search', parameters: { type: 'object' } }],
        toolChoice: { type: 'specific', name: 'nonexistent' },
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("'nonexistent' not found"))).toBe(true);
    });
  });

  describe('bounded options validation', () => {
    it('accepts valid options', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        options: {
          maxTokens: 1000,
          temperature: 0.7,
          topP: 0.9,
          timeoutMs: 30000,
        },
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });

    it('rejects maxTokens < 1', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        options: { maxTokens: 0 },
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('maxTokens must be at least 1'))).toBe(true);
    });

    it('rejects maxTokens > 1000000', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        options: { maxTokens: 2000000 },
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('maxTokens exceeds maximum'))).toBe(true);
    });

    it('rejects temperature < 0', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        options: { temperature: -0.5 },
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('temperature must be between 0 and 2'))).toBe(
        true
      );
    });

    it('rejects temperature > 2', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        options: { temperature: 3 },
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
    });

    it('rejects topP outside 0-1', () => {
      const request1: ModelRequest = {
        ...minimalValidRequest,
        options: { topP: -0.1 },
      };
      const request2: ModelRequest = {
        ...minimalValidRequest,
        options: { topP: 1.5 },
      };

      expect(validateRequest(request1).valid).toBe(false);
      expect(validateRequest(request2).valid).toBe(false);
    });

    it('rejects timeoutMs < 1000', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        options: { timeoutMs: 500 },
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('timeoutMs must be at least 1000ms'))).toBe(
        true
      );
    });

    it('rejects timeoutMs > 600000', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        options: { timeoutMs: 700000 },
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('timeoutMs exceeds maximum'))).toBe(true);
    });
  });
});

describe('DEFAULT_REQUEST_OPTIONS', () => {
  it('has privacy-preserving defaults', () => {
    expect(DEFAULT_REQUEST_OPTIONS.store).toBe(false);
  });

  it('has reasonable timeout default', () => {
    expect(DEFAULT_REQUEST_OPTIONS.timeoutMs).toBe(60000);
  });
});
