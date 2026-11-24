/**
 * Tests for input-size estimation.
 *
 * Task 3.3a: Test conservative preflight estimation including all components.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateInputSize,
  quickSizeCheck,
  calculateOutputReservation,
  calculateTotalReservation,
  DEFAULT_ESTIMATION_CONFIG,
  type EstimationConfig,
} from '../../../src/model-providers/estimation.js';
import { createCanonicalSchema, z } from '../../../src/model-providers/schema.js';
import type { ModelRequest, ToolDefinition } from '../../../src/model-providers/request.js';

// Test fixtures
function createMinimalRequest(): ModelRequest {
  return {
    providerId: 'test',
    messages: [
      { role: 'user', content: 'Hello' },
    ],
  };
}

function createRequestWithInstructions(): ModelRequest {
  return {
    providerId: 'test',
    instructions: 'You are a helpful assistant. Be concise.',
    messages: [
      { role: 'user', content: 'Hello' },
    ],
  };
}

function createRequestWithTools(): ModelRequest {
  const tools: ToolDefinition[] = [
    {
      name: 'search',
      description: 'Search the web for information',
      parameters: createCanonicalSchema({
        id: 'SearchParams',
        version: 1,
        name: 'SearchParams',
        zodSchema: z.object({
          query: z.string().describe('Search query'),
          limit: z.number().optional().describe('Max results'),
        }),
      }),
    },
    {
      name: 'calculate',
      description: 'Perform mathematical calculations',
    },
  ];

  return {
    providerId: 'test',
    messages: [
      { role: 'user', content: 'Search for TypeScript tutorials' },
    ],
    tools,
  };
}

function createRequestWithStructuredOutput(): ModelRequest {
  const schema = createCanonicalSchema({
    id: 'AnswerResponse',
    version: 1,
    name: 'AnswerResponse',
    zodSchema: z.object({
      answer: z.string(),
      confidence: z.number(),
      sources: z.array(z.string()),
    }),
  });

  return {
    providerId: 'test',
    messages: [
      { role: 'user', content: 'What is TypeScript?' },
    ],
    structuredOutput: {
      schema,
      strict: true,
    },
  };
}

function createRequestWithImages(): ModelRequest {
  return {
    providerId: 'test',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', mediaType: 'image/png', data: 'abc123' },
        ],
      },
    ],
  };
}

function createLargeRequest(): ModelRequest {
  const longText = 'x'.repeat(100000);
  return {
    providerId: 'test',
    instructions: 'x'.repeat(10000),
    messages: [
      { role: 'user', content: longText },
      { role: 'assistant', content: longText },
      { role: 'user', content: longText },
    ],
  };
}

describe('estimateInputSize', () => {
  describe('basic estimation', () => {
    it('estimates minimal request', () => {
      const request = createMinimalRequest();
      const result = estimateInputSize(request);

      expect(result.success).toBe(true);
      expect(result.estimatedTokens).toBeGreaterThan(0);
      expect(result.rawCharacters).toBeGreaterThan(0);
      expect(result.breakdown).toBeDefined();
    });

    it('includes instructions in estimate', () => {
      const withInstructions = createRequestWithInstructions();
      const withoutInstructions = createMinimalRequest();

      const resultWith = estimateInputSize(withInstructions);
      const resultWithout = estimateInputSize(withoutInstructions);

      expect(resultWith.success).toBe(true);
      expect(resultWithout.success).toBe(true);
      expect(resultWith.rawCharacters!).toBeGreaterThan(resultWithout.rawCharacters!);
      expect(resultWith.breakdown!.instructions).toBeGreaterThan(0);
    });

    it('provides breakdown of components', () => {
      const request = createRequestWithTools();
      const result = estimateInputSize(request);

      expect(result.success).toBe(true);
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown!.messages).toBeGreaterThan(0);
      expect(result.breakdown!.toolDefinitions).toBeGreaterThan(0);
      expect(result.breakdown!.toolParameterSchemas).toBeGreaterThan(0);
    });
  });

  describe('tools estimation', () => {
    it('includes tool definitions in estimate', () => {
      const withTools = createRequestWithTools();
      const withoutTools = createMinimalRequest();

      const resultWith = estimateInputSize(withTools);
      const resultWithout = estimateInputSize(withoutTools);

      expect(resultWith.breakdown!.toolDefinitions).toBeGreaterThan(0);
      expect(resultWith.rawCharacters!).toBeGreaterThan(resultWithout.rawCharacters!);
    });

    it('includes tool parameter schemas in estimate', () => {
      const request = createRequestWithTools();
      const result = estimateInputSize(request);

      expect(result.breakdown!.toolParameterSchemas).toBeGreaterThan(0);
    });
  });

  describe('structured output estimation', () => {
    it('includes structured output schema in estimate', () => {
      const withSchema = createRequestWithStructuredOutput();
      const withoutSchema = createMinimalRequest();

      const resultWith = estimateInputSize(withSchema);
      const resultWithout = estimateInputSize(withoutSchema);

      expect(resultWith.breakdown!.structuredOutputSchema).toBeGreaterThan(0);
      expect(resultWith.rawCharacters!).toBeGreaterThan(resultWithout.rawCharacters!);
    });
  });

  describe('image content handling', () => {
    it('rejects images by default', () => {
      const request = createRequestWithImages();
      const result = estimateInputSize(request);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('UNBOUNDED_IMAGES');
    });

    it('allows images when configured', () => {
      const request = createRequestWithImages();
      const config: EstimationConfig = {
        ...DEFAULT_ESTIMATION_CONFIG,
        allowUnboundedImages: true,
      };
      const result = estimateInputSize(request, config);

      expect(result.success).toBe(true);
      expect(result.breakdown!.imageContent).toBeGreaterThan(0);
      expect(result.warnings).toContain('Request contains 1 image(s)');
    });

    it('estimates image tokens conservatively', () => {
      const request = createRequestWithImages();
      const config: EstimationConfig = {
        ...DEFAULT_ESTIMATION_CONFIG,
        allowUnboundedImages: true,
        tokensPerImage: 1000,
        charsPerToken: 4,
      };
      const result = estimateInputSize(request, config);

      expect(result.success).toBe(true);
      // 1 image * 1000 tokens * 4 chars = 4000 characters for image
      expect(result.breakdown!.imageContent).toBe(4000);
    });
  });

  describe('safety margin', () => {
    it('applies safety margin to estimate', () => {
      const request = createMinimalRequest();
      const config: EstimationConfig = {
        ...DEFAULT_ESTIMATION_CONFIG,
        safetyMarginPercent: 50, // 50% margin
      };
      const result = estimateInputSize(request, config);

      expect(result.success).toBe(true);
      expect(result.safetyMarginPercent).toBe(50);

      // Estimated tokens should include the margin
      const baseTokens = Math.ceil(result.rawCharacters! / config.charsPerToken);
      const marginTokens = Math.ceil(baseTokens * 0.5);
      expect(result.estimatedTokens).toBe(baseTokens + marginTokens);
    });
  });

  describe('hard limits', () => {
    it('rejects requests exceeding max characters', () => {
      const request = createLargeRequest();
      const config: EstimationConfig = {
        ...DEFAULT_ESTIMATION_CONFIG,
        maxInputCharacters: 10000, // Very low limit
      };
      const result = estimateInputSize(request, config);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('EXCEEDS_MAX_CHARACTERS');
    });

    it('accepts requests within limits', () => {
      const request = createMinimalRequest();
      const result = estimateInputSize(request);

      expect(result.success).toBe(true);
    });
  });

  describe('multi-turn conversations', () => {
    it('estimates all messages in conversation', () => {
      const request: ModelRequest = {
        providerId: 'test',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
          { role: 'assistant', content: 'I am doing well!' },
        ],
      };

      const result = estimateInputSize(request);

      expect(result.success).toBe(true);
      // Should include all messages
      expect(result.breakdown!.messages).toBeGreaterThan(40); // All text content
    });

    it('includes tool results in estimation', () => {
      const request: ModelRequest = {
        providerId: 'test',
        messages: [
          { role: 'user', content: 'Search for cats' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [
              { id: 'call_1', name: 'search', arguments: '{"query":"cats"}' },
            ],
          },
          {
            role: 'tool',
            toolCallId: 'call_1',
            toolName: 'search',
            content: [
              { type: 'text', text: 'Found 10 results about cats' },
            ],
          },
        ],
      };

      const result = estimateInputSize(request);

      expect(result.success).toBe(true);
      // Should include tool call and result content
      expect(result.breakdown!.messages).toBeGreaterThan(50);
    });
  });

  describe('overhead calculation', () => {
    it('includes overhead for JSON structure', () => {
      const request = createMinimalRequest();
      const result = estimateInputSize(request);

      expect(result.success).toBe(true);
      expect(result.breakdown!.overhead).toBeGreaterThan(0);
    });
  });
});

describe('quickSizeCheck', () => {
  it('returns true for small requests', () => {
    const request = createMinimalRequest();
    const result = quickSizeCheck(request, 100000);

    expect(result).toBe(true);
  });

  it('returns false for requests over limit', () => {
    const request = createLargeRequest();
    const result = quickSizeCheck(request, 1000);

    expect(result).toBe(false);
  });

  it('is faster than full estimation', () => {
    const request = createLargeRequest();

    // Quick check should return early
    const start = Date.now();
    quickSizeCheck(request, 1000);
    const quickTime = Date.now() - start;

    // Full estimation processes everything
    const start2 = Date.now();
    estimateInputSize(request, { ...DEFAULT_ESTIMATION_CONFIG, maxInputCharacters: 1000000 });
    const fullTime = Date.now() - start2;

    // Quick check should be faster (or at least not slower)
    expect(quickTime).toBeLessThanOrEqual(fullTime + 10); // Allow some variance
  });
});

describe('calculateOutputReservation', () => {
  it('uses requested maxTokens when provided', () => {
    expect(calculateOutputReservation(1000)).toBe(1000);
    expect(calculateOutputReservation(100)).toBe(100);
  });

  it('uses default when maxTokens not provided', () => {
    expect(calculateOutputReservation(undefined)).toBe(4096);
    expect(calculateOutputReservation(undefined, 2000)).toBe(2000);
  });

  it('uses default for zero or negative values', () => {
    expect(calculateOutputReservation(0)).toBe(4096);
  });
});

describe('calculateTotalReservation', () => {
  it('sums input estimate and output reservation', () => {
    expect(calculateTotalReservation(1000, 500)).toBe(1500);
    expect(calculateTotalReservation(5000, 2000)).toBe(7000);
  });
});

describe('DEFAULT_ESTIMATION_CONFIG', () => {
  it('has conservative defaults', () => {
    expect(DEFAULT_ESTIMATION_CONFIG.charsPerToken).toBe(4);
    expect(DEFAULT_ESTIMATION_CONFIG.safetyMarginPercent).toBe(20);
    expect(DEFAULT_ESTIMATION_CONFIG.maxInputCharacters).toBeGreaterThan(100000);
    expect(DEFAULT_ESTIMATION_CONFIG.allowUnboundedImages).toBe(false);
  });
});

describe('Design principle: conservative estimation', () => {
  it('estimate is NOT provider-verified', () => {
    // This test documents that estimates are local approximations
    const request = createMinimalRequest();
    const result = estimateInputSize(request);

    expect(result.success).toBe(true);
    // The estimate exists but is not tokenizer-exact
    expect(result.warnings).not.toContain('verified');

    // We use a character ratio, not actual tokenization
    expect(result.charsPerToken).toBe(DEFAULT_ESTIMATION_CONFIG.charsPerToken);
  });

  it('estimate includes safety margin for uncertainty', () => {
    const request = createMinimalRequest();
    const result = estimateInputSize(request);

    expect(result.success).toBe(true);
    expect(result.safetyMarginPercent).toBe(DEFAULT_ESTIMATION_CONFIG.safetyMarginPercent);

    // Estimated tokens include margin
    const baseTokens = Math.ceil(result.rawCharacters! / result.charsPerToken!);
    expect(result.estimatedTokens!).toBeGreaterThan(baseTokens);
  });

  it('hard character limit provides additional safeguard', () => {
    // Even if token estimation is off, hard limit catches extreme cases
    const hugeRequest: ModelRequest = {
      providerId: 'test',
      messages: [{ role: 'user', content: 'x'.repeat(1000000) }],
    };

    const result = estimateInputSize(hugeRequest);

    expect(result.success).toBe(false);
    expect(result.error!.code).toBe('EXCEEDS_MAX_CHARACTERS');
  });
});

describe('External JSON Schema tool definitions', () => {
  it('external JSON Schema tool definitions contribute to input-size estimate', () => {
    // This test proves that external JSON Schema definitions (not canonical schemas)
    // are properly included in the input-size estimation

    // Create a request with external JSON Schema tool parameter (ExternalToolSchema format)
    const externalSchema = {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'The search query to execute' },
        maxResults: { type: 'number', description: 'Maximum number of results to return' },
        filters: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
          },
          required: ['category'],
        },
      },
      required: ['query'],
      additionalProperties: false,
    };

    const requestWithExternalSchema: ModelRequest = {
      providerId: 'test',
      messages: [{ role: 'user', content: 'Search for data' }],
      tools: [
        {
          name: 'search',
          description: 'Search the database',
          parameters: {
            kind: 'external_json_schema', // ExternalToolSchema discriminator
            source: 'test:search-api',
            jsonSchema: externalSchema,
          },
        },
      ],
    };

    const requestWithoutTools: ModelRequest = {
      providerId: 'test',
      messages: [{ role: 'user', content: 'Search for data' }],
    };

    const resultWithSchema = estimateInputSize(requestWithExternalSchema);
    const resultWithoutTools = estimateInputSize(requestWithoutTools);

    expect(resultWithSchema.success).toBe(true);
    expect(resultWithoutTools.success).toBe(true);

    // The estimate with external schema should be LARGER
    expect(resultWithSchema.rawCharacters!).toBeGreaterThan(resultWithoutTools.rawCharacters!);

    // The breakdown should show tool parameter schema contribution
    expect(resultWithSchema.breakdown!.toolParameterSchemas).toBeGreaterThan(0);

    // The schema size should be approximately the JSON stringified size
    const schemaSize = JSON.stringify(externalSchema).length;
    expect(resultWithSchema.breakdown!.toolParameterSchemas).toBeGreaterThanOrEqual(schemaSize);
  });

  it('external JSON Schema is distinct from canonical structured-output schema', () => {
    // This test documents that external tool schemas are handled differently
    // from canonical schemas used for structured output

    // Create request with both: external tool schema + canonical structured output
    const externalToolSchema = {
      type: 'object' as const,
      properties: {
        action: { type: 'string' },
        target: { type: 'string' },
      },
      required: ['action'],
    };

    const requestWithBoth: ModelRequest = {
      providerId: 'test',
      messages: [{ role: 'user', content: 'Execute command' }],
      tools: [
        {
          name: 'execute',
          description: 'Execute an action',
          parameters: {
            kind: 'external_json_schema', // ExternalToolSchema discriminator
            source: 'test:executor',
            jsonSchema: externalToolSchema,
          },
        },
      ],
      structuredOutput: {
        schema: createCanonicalSchema({
          id: 'CommandResult',
          version: 1,
          name: 'CommandResult',
          zodSchema: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
        }),
        strict: true,
      },
    };

    const result = estimateInputSize(requestWithBoth);

    expect(result.success).toBe(true);
    expect(result.breakdown).toBeDefined();

    // Both should contribute independently
    expect(result.breakdown!.toolParameterSchemas).toBeGreaterThan(0);
    expect(result.breakdown!.structuredOutputSchema).toBeGreaterThan(0);

    // They should be separate line items in the breakdown
    // (not merged together)
    const toolSchemaContribution = result.breakdown!.toolParameterSchemas;

    // Each should approximately match their respective schema sizes
    const externalSchemaSize = JSON.stringify(externalToolSchema).length;
    expect(toolSchemaContribution).toBeGreaterThanOrEqual(externalSchemaSize);
  });

  it('default image rejection is retained unless image size can be bounded', () => {
    // This test documents that images are rejected by default
    // The only way to allow them is explicit configuration
    // There is no "auto-detect safe image size" logic

    const requestWithImage: ModelRequest = {
      providerId: 'test',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is in this image?' },
            { type: 'image', mediaType: 'image/png', data: 'base64data' },
          ],
        },
      ],
    };

    // Default config rejects images
    const resultDefault = estimateInputSize(requestWithImage);
    expect(resultDefault.success).toBe(false);
    expect(resultDefault.error!.code).toBe('UNBOUNDED_IMAGES');

    // Only explicit allowUnboundedImages: true allows them
    const resultAllowed = estimateInputSize(requestWithImage, {
      ...DEFAULT_ESTIMATION_CONFIG,
      allowUnboundedImages: true,
    });
    expect(resultAllowed.success).toBe(true);
    expect(resultAllowed.breakdown!.imageContent).toBeGreaterThan(0);
  });
});
