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
  createCanonicalSchema,
  isCanonicalSchema,
  isExternalToolSchema,
  validateExternalToolSchema,
  validateToolParameterSchema,
  z,
  type ModelRequest,
  type ToolDefinition,
  type ExternalToolSchema,
} from '../../../src/model-providers/index.js';

// Helper to create a minimal canonical schema for tool parameters
function createToolParameters(props: Record<string, unknown> = {}) {
  return createCanonicalSchema({
    id: `tool-params-${Date.now()}-${Math.random()}`,
    version: 1,
    zodSchema: z.object(
      Object.fromEntries(
        Object.entries(props).map(([key]) => [key, z.string()])
      )
    ),
  });
}

// Helper to create a valid external tool schema
function createExternalToolSchema(
  source: string = 'mcp:test',
  jsonSchema: Record<string, unknown> = { type: 'object' }
): ExternalToolSchema {
  return {
    kind: 'external_json_schema',
    source,
    jsonSchema,
  };
}

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
          parameters: createToolParameters({ q: 'string' }),
        },
        {
          name: 'calculate',
          description: 'Perform calculations',
          parameters: createToolParameters({ expr: 'string' }),
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
            parameters: createToolParameters(),
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
          { name: 'search', description: 'First search', parameters: createToolParameters() },
          { name: 'search', description: 'Duplicate search', parameters: createToolParameters() },
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
        tools: [{ name: 'search', description: 'Search', parameters: createToolParameters() }],
        toolChoice: 'auto',
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });

    it('accepts specific tool choice when tool exists', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [{ name: 'search', description: 'Search', parameters: createToolParameters() }],
        toolChoice: { type: 'specific', name: 'search' },
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });

    it('rejects specific tool choice when tool does not exist', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [{ name: 'search', description: 'Search', parameters: createToolParameters() }],
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
    expect(DEFAULT_REQUEST_OPTIONS.timeoutMs).toBe(180000);
  });
});

describe('tool parameter schema validation', () => {
  const minimalValidRequest: ModelRequest = {
    providerId: 'openai',
    messages: [{ role: 'user', content: 'Hello' }],
  };

  describe('canonical schema acceptance', () => {
    it('accepts genuine canonical schema for tool parameters', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: 'search',
            description: 'Search the web',
            parameters: createToolParameters({ query: 'string' }),
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });

    it('accepts tool without parameters (optional parameters)', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: 'get_time',
            description: 'Get the current time',
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });
  });

  describe('external tool schema acceptance', () => {
    it('accepts well-formed external JSON Schema wrapper', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: 'mcp_tool',
            description: 'Tool from MCP server',
            parameters: createExternalToolSchema('mcp:playwright', {
              type: 'object',
              properties: { url: { type: 'string' } },
            }),
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });

    it('accepts external schema with complex JSON Schema', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: 'complex_tool',
            description: 'Tool with complex schema',
            parameters: createExternalToolSchema('openapi:petstore', {
              type: 'object',
              properties: {
                name: { type: 'string', minLength: 1 },
                age: { type: 'integer', minimum: 0 },
                tags: { type: 'array', items: { type: 'string' } },
              },
              required: ['name'],
            }),
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(true);
    });
  });

  describe('plain JSON Schema rejection', () => {
    it('rejects arbitrary plain JSON Schema object without wrapper', () => {
      const plainJsonSchema = {
        type: 'object',
        properties: { name: { type: 'string' } },
      };
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: 'bad_tool',
            description: 'Tool with unwrapped JSON Schema',
            parameters: plainJsonSchema as unknown as ExternalToolSchema,
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('CanonicalSchema or ExternalToolSchema'))).toBe(true);
    });

    it('rejects look-alike object impersonating CanonicalSchema', () => {
      const fakeCanonical = {
        id: 'fake',
        version: 1,
        zodSchema: z.object({ name: z.string() }),
        toJsonSchema: () => ({ success: true, jsonSchema: { type: 'object' } }),
        validate: () => ({ success: true, data: {} }),
        parseAndValidate: () => ({ status: 'valid', data: {} }),
      };
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: 'fake_tool',
            description: 'Tool with fake canonical schema',
            parameters: fakeCanonical as unknown as ExternalToolSchema,
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('CanonicalSchema or ExternalToolSchema'))).toBe(true);
    });
  });

  describe('external schema validation', () => {
    it('rejects external schema with empty source', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: 'bad_source',
            description: 'Tool with empty source',
            parameters: {
              kind: 'external_json_schema',
              source: '',
              jsonSchema: { type: 'object' },
            },
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('source must be a non-empty string'))).toBe(true);
    });

    it('rejects external schema with whitespace-only source', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: 'bad_source',
            description: 'Tool with whitespace source',
            parameters: {
              kind: 'external_json_schema',
              source: '   ',
              jsonSchema: { type: 'object' },
            },
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('source must be a non-empty string'))).toBe(true);
    });

    it('rejects external schema with null jsonSchema', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: 'null_schema',
            description: 'Tool with null jsonSchema',
            parameters: {
              kind: 'external_json_schema',
              source: 'mcp:test',
              jsonSchema: null as unknown as Record<string, unknown>,
            },
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('jsonSchema must be a non-null object'))).toBe(true);
    });

    it('rejects external schema with array jsonSchema', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: 'array_schema',
            description: 'Tool with array jsonSchema',
            parameters: {
              kind: 'external_json_schema',
              source: 'mcp:test',
              jsonSchema: ['not', 'an', 'object'] as unknown as Record<string, unknown>,
            },
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('jsonSchema must be a plain object'))).toBe(true);
    });

    it('rejects external schema with wrong kind', () => {
      const request: ModelRequest = {
        ...minimalValidRequest,
        tools: [
          {
            name: 'wrong_kind',
            description: 'Tool with wrong kind',
            parameters: {
              kind: 'wrong_kind' as 'external_json_schema',
              source: 'mcp:test',
              jsonSchema: { type: 'object' },
            },
          },
        ],
      };
      const result = validateRequest(request);

      expect(result.valid).toBe(false);
    });
  });
});

describe('isExternalToolSchema type guard', () => {
  it('returns true for valid external tool schema', () => {
    const schema = createExternalToolSchema('mcp:test', { type: 'object' });
    expect(isExternalToolSchema(schema)).toBe(true);
  });

  it('returns false for canonical schema', () => {
    const schema = createToolParameters();
    expect(isExternalToolSchema(schema)).toBe(false);
  });

  it('returns false for plain object', () => {
    expect(isExternalToolSchema({ type: 'object' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isExternalToolSchema(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isExternalToolSchema(undefined)).toBe(false);
  });
});

describe('isCanonicalSchema type guard (re-exported)', () => {
  it('returns true for genuine canonical schema', () => {
    const schema = createToolParameters();
    expect(isCanonicalSchema(schema)).toBe(true);
  });

  it('returns false for external tool schema', () => {
    const schema = createExternalToolSchema();
    expect(isCanonicalSchema(schema)).toBe(false);
  });

  it('returns false for plain JSON Schema object', () => {
    const plainSchema = { type: 'object', properties: {} };
    expect(isCanonicalSchema(plainSchema)).toBe(false);
  });

  it('returns false for look-alike fake canonical schema', () => {
    const fakeSchema = {
      id: 'fake',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
      toJsonSchema: () => ({ success: true, jsonSchema: { type: 'object' } }),
    };
    expect(isCanonicalSchema(fakeSchema)).toBe(false);
  });
});

describe('validateExternalToolSchema', () => {
  it('returns empty array for valid schema', () => {
    const schema = createExternalToolSchema();
    expect(validateExternalToolSchema(schema)).toEqual([]);
  });

  it('accepts ordinary object literal for jsonSchema', () => {
    const schema = {
      kind: 'external_json_schema',
      source: 'mcp:test',
      jsonSchema: { type: 'object', properties: { name: { type: 'string' } } },
    };
    expect(validateExternalToolSchema(schema)).toEqual([]);
  });

  it('accepts null-prototype object for jsonSchema', () => {
    const nullProtoSchema = Object.create(null);
    nullProtoSchema.type = 'object';
    const schema = {
      kind: 'external_json_schema',
      source: 'mcp:test',
      jsonSchema: nullProtoSchema,
    };
    expect(validateExternalToolSchema(schema)).toEqual([]);
  });

  it('returns errors for empty source', () => {
    const schema = { kind: 'external_json_schema', source: '', jsonSchema: {} };
    const errors = validateExternalToolSchema(schema);
    expect(errors).toContain('external tool schema source must be a non-empty string');
  });

  it('returns errors for whitespace-only source', () => {
    const schema = { kind: 'external_json_schema', source: '   \t\n  ', jsonSchema: {} };
    const errors = validateExternalToolSchema(schema);
    expect(errors).toContain('external tool schema source must be a non-empty string');
  });

  it('returns errors for null jsonSchema', () => {
    const schema = { kind: 'external_json_schema', source: 'test', jsonSchema: null };
    const errors = validateExternalToolSchema(schema);
    expect(errors).toContain('external tool schema jsonSchema must be a non-null object');
  });

  it('returns errors for array jsonSchema', () => {
    const schema = { kind: 'external_json_schema', source: 'test', jsonSchema: [] };
    const errors = validateExternalToolSchema(schema);
    expect(errors).toContain('external tool schema jsonSchema must be a plain object');
  });

  it('returns errors for Date instance as jsonSchema', () => {
    const schema = { kind: 'external_json_schema', source: 'test', jsonSchema: new Date() };
    const errors = validateExternalToolSchema(schema);
    expect(errors).toContain('external tool schema jsonSchema must be a plain object');
  });

  it('returns errors for Map instance as jsonSchema', () => {
    const schema = { kind: 'external_json_schema', source: 'test', jsonSchema: new Map() };
    const errors = validateExternalToolSchema(schema);
    expect(errors).toContain('external tool schema jsonSchema must be a plain object');
  });

  it('returns errors for custom class instance as jsonSchema', () => {
    class CustomSchema {
      type = 'object';
    }
    const schema = { kind: 'external_json_schema', source: 'test', jsonSchema: new CustomSchema() };
    const errors = validateExternalToolSchema(schema);
    expect(errors).toContain('external tool schema jsonSchema must be a plain object');
  });

  it('returns errors for wrong kind', () => {
    const schema = { kind: 'wrong', source: 'test', jsonSchema: {} };
    const errors = validateExternalToolSchema(schema);
    expect(errors).toContain("external tool schema must have kind 'external_json_schema'");
  });

  it('returns multiple errors for multiple issues', () => {
    const schema = { kind: 'wrong', source: '', jsonSchema: null };
    const errors = validateExternalToolSchema(schema);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('validateToolParameterSchema', () => {
  it('accepts canonical schema', () => {
    const schema = createToolParameters();
    const errors = validateToolParameterSchema(schema, 'test_tool');
    expect(errors).toEqual([]);
  });

  it('accepts external tool schema', () => {
    const schema = createExternalToolSchema();
    const errors = validateToolParameterSchema(schema, 'test_tool');
    expect(errors).toEqual([]);
  });

  it('rejects plain object', () => {
    const schema = { type: 'object' };
    const errors = validateToolParameterSchema(schema, 'test_tool');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('test_tool');
    expect(errors[0]).toContain('CanonicalSchema or ExternalToolSchema');
  });

  it('includes tool name in error messages', () => {
    const schema = { kind: 'external_json_schema', source: '', jsonSchema: {} };
    const errors = validateToolParameterSchema(schema, 'my_tool');
    expect(errors.some((e) => e.includes("tool 'my_tool'"))).toBe(true);
  });
});
