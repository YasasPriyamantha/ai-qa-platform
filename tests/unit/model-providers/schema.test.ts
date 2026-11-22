/**
 * Tests for canonical schema abstraction.
 *
 * Tests:
 * - JSON Schema generation and local validation from the same schema
 * - Required/optional/null handling
 * - Nested objects/arrays/enums
 * - Invalid data validation
 * - Unsupported conversion result
 * - Distinct error categories (invalid_json, schema_invalid, refusal, incomplete)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  z,
  createCanonicalSchema,
  validateStructuredOutput,
  convertSchemaForProvider,
  SchemaRegistry,
  isCanonicalSchema,
  extractJsonSchema,
  isValidStructuredOutput,
  isInvalidJsonOutput,
  isSchemaInvalidOutput,
  isRefusalOutput,
  isIncompleteOutput,
  createUnknownCapabilities,
  type DeclaredCapabilities,
  type CanonicalSchema,
} from '../../../src/model-providers/index.js';

describe('createCanonicalSchema', () => {
  describe('basic schema creation', () => {
    it('creates a schema with required fields', () => {
      const schema = createCanonicalSchema({
        id: 'test-schema',
        version: 1,
        name: 'TestSchema',
        description: 'A test schema',
        zodSchema: z.object({
          name: z.string(),
          age: z.number(),
        }),
      });

      expect(schema.id).toBe('test-schema');
      expect(schema.version).toBe(1);
      expect(schema.name).toBe('TestSchema');
      expect(schema.description).toBe('A test schema');
    });

    it('generates JSON Schema that matches the Zod schema structure', () => {
      const schema = createCanonicalSchema({
        id: 'user-schema',
        version: 1,
        zodSchema: z.object({
          name: z.string(),
          email: z.string().email(),
          age: z.number().optional(),
        }),
      });

      const result = schema.toJsonSchema();
      expect(result.success).toBe(true);
      if (result.success) {
        const jsonSchema = result.jsonSchema;
        expect(jsonSchema.type).toBe('object');
        expect(jsonSchema.properties).toBeDefined();
        expect(jsonSchema.properties?.name).toBeDefined();
        expect(jsonSchema.properties?.email).toBeDefined();
        expect(jsonSchema.properties?.age).toBeDefined();
        expect(jsonSchema.required).toContain('name');
        expect(jsonSchema.required).toContain('email');
        expect(jsonSchema.required).not.toContain('age');
      }
    });
  });

  describe('JSON Schema generation options', () => {
    it('excludes $schema by default', () => {
      const schema = createCanonicalSchema({
        id: 'test',
        version: 1,
        zodSchema: z.object({ name: z.string() }),
      });

      const result = schema.toJsonSchema();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.jsonSchema.$schema).toBeUndefined();
      }
    });

    it('includes $schema when requested', () => {
      const schema = createCanonicalSchema({
        id: 'test',
        version: 1,
        zodSchema: z.object({ name: z.string() }),
      });

      const result = schema.toJsonSchema({ includeSchema: true });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.jsonSchema.$schema).toBeDefined();
      }
    });

    it('supports different target versions', () => {
      const schema = createCanonicalSchema({
        id: 'test',
        version: 1,
        zodSchema: z.object({ name: z.string() }),
      });

      const result07 = schema.toJsonSchema({ target: 'draft-07', includeSchema: true });
      expect(result07.success).toBe(true);
      if (result07.success) {
        expect(result07.jsonSchema.$schema).toContain('draft-07');
      }

      const result2020 = schema.toJsonSchema({ target: 'draft-2020-12', includeSchema: true });
      expect(result2020.success).toBe(true);
      if (result2020.success) {
        expect(result2020.jsonSchema.$schema).toContain('2020-12');
      }
    });
  });

  describe('validate method', () => {
    const schema = createCanonicalSchema({
      id: 'user',
      version: 1,
      zodSchema: z.object({
        name: z.string(),
        age: z.number().int().positive(),
      }),
    });

    it('returns success for valid data', () => {
      const result = schema.validate({ name: 'Alice', age: 30 });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'Alice', age: 30 });
      expect(result.errors).toBeUndefined();
    });

    it('returns errors for invalid data', () => {
      const result = schema.validate({ name: 123, age: 'thirty' });

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('provides path information in errors', () => {
      const result = schema.validate({ name: 'Alice', age: -5 });

      expect(result.success).toBe(false);
      const ageError = result.errors!.find((e) => e.path.includes('age'));
      expect(ageError).toBeDefined();
    });
  });

  describe('parseAndValidate method', () => {
    const schema = createCanonicalSchema({
      id: 'user',
      version: 1,
      zodSchema: z.object({
        name: z.string(),
        active: z.boolean(),
      }),
    });

    it('returns valid for correct JSON', () => {
      const result = schema.parseAndValidate('{"name":"Alice","active":true}');

      expect(result.status).toBe('valid');
      if (isValidStructuredOutput(result)) {
        expect(result.data).toEqual({ name: 'Alice', active: true });
      }
    });

    it('returns invalid_json for malformed JSON', () => {
      const result = schema.parseAndValidate('{"name":"Alice",}');

      expect(result.status).toBe('invalid_json');
      if (isInvalidJsonOutput(result)) {
        // Safe metadata only - never exposes raw output
        expect(result.outputLength).toBe(17);
        expect(result.errorPosition).toBeDefined();
      }
    });

    it('returns schema_invalid for valid JSON that fails schema', () => {
      const result = schema.parseAndValidate('{"name":123,"active":"yes"}');

      expect(result.status).toBe('schema_invalid');
      if (isSchemaInvalidOutput(result)) {
        // Safe errors only - never exposes received values
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].path).toBeDefined();
        expect(result.errors[0].message).toBeDefined();
        expect(result.errors[0].code).toBeDefined();
      }
    });
  });
});

describe('JSON Schema and validation derive from the same schema', () => {
  it('validates data that matches the JSON Schema specification', () => {
    const schema = createCanonicalSchema({
      id: 'product',
      version: 1,
      zodSchema: z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100),
        price: z.number().positive(),
        tags: z.array(z.string()),
        metadata: z.record(z.string(), z.string()),
      }),
    });

    const conversionResult = schema.toJsonSchema();
    expect(conversionResult.success).toBe(true);
    if (!conversionResult.success) return;
    const jsonSchema = conversionResult.jsonSchema;

    const validData = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Widget',
      price: 19.99,
      tags: ['electronics', 'gadget'],
      metadata: { brand: 'Acme' },
    };

    // JSON Schema says this is an object with these properties
    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.required).toContain('id');
    expect(jsonSchema.required).toContain('name');
    expect(jsonSchema.required).toContain('price');
    expect(jsonSchema.required).toContain('tags');
    expect(jsonSchema.required).toContain('metadata');

    // Local validation accepts the same valid data
    const result = schema.validate(validData);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(validData);
  });

  it('rejects data that JSON Schema would reject', () => {
    const schema = createCanonicalSchema({
      id: 'constrained',
      version: 1,
      zodSchema: z.object({
        status: z.enum(['active', 'inactive', 'pending']),
        count: z.number().int().min(0).max(100),
      }),
    });

    const conversionResult = schema.toJsonSchema();
    expect(conversionResult.success).toBe(true);
    if (!conversionResult.success) return;
    const jsonSchema = conversionResult.jsonSchema;

    // JSON Schema specifies enum constraint
    expect(jsonSchema.properties?.status).toHaveProperty('enum');

    // Local validation rejects invalid enum value
    const result1 = schema.validate({ status: 'unknown', count: 50 });
    expect(result1.success).toBe(false);

    // Local validation rejects out-of-range number
    const result2 = schema.validate({ status: 'active', count: 200 });
    expect(result2.success).toBe(false);
  });
});

describe('required/optional/null handling', () => {
  it('distinguishes required from optional fields', () => {
    const schema = createCanonicalSchema({
      id: 'mixed',
      version: 1,
      zodSchema: z.object({
        required: z.string(),
        optional: z.string().optional(),
      }),
    });

    const conversionResult = schema.toJsonSchema();
    expect(conversionResult.success).toBe(true);
    if (conversionResult.success) {
      expect(conversionResult.jsonSchema.required).toContain('required');
      expect(conversionResult.jsonSchema.required).not.toContain('optional');
    }

    // Validation matches
    expect(schema.validate({ required: 'yes' }).success).toBe(true);
    expect(schema.validate({ required: 'yes', optional: 'maybe' }).success).toBe(true);
    expect(schema.validate({ optional: 'missing required' }).success).toBe(false);
  });

  it('handles nullable fields', () => {
    const schema = createCanonicalSchema({
      id: 'nullable',
      version: 1,
      zodSchema: z.object({
        name: z.string(),
        nickname: z.string().nullable(),
      }),
    });

    // Validation allows null for nullable field
    expect(schema.validate({ name: 'Alice', nickname: null }).success).toBe(true);
    expect(schema.validate({ name: 'Alice', nickname: 'Ali' }).success).toBe(true);
    expect(schema.validate({ name: null, nickname: null }).success).toBe(false);
  });

  it('handles optional nullable fields', () => {
    const schema = createCanonicalSchema({
      id: 'optional-nullable',
      version: 1,
      zodSchema: z.object({
        field: z.string().nullable().optional(),
      }),
    });

    expect(schema.validate({}).success).toBe(true);
    expect(schema.validate({ field: null }).success).toBe(true);
    expect(schema.validate({ field: 'value' }).success).toBe(true);
  });
});

describe('nested objects/arrays/enums', () => {
  it('validates nested objects', () => {
    const schema = createCanonicalSchema({
      id: 'nested',
      version: 1,
      zodSchema: z.object({
        user: z.object({
          profile: z.object({
            name: z.string(),
            bio: z.string().optional(),
          }),
        }),
      }),
    });

    const conversionResult = schema.toJsonSchema();
    expect(conversionResult.success).toBe(true);
    if (conversionResult.success) {
      expect(conversionResult.jsonSchema.properties?.user).toBeDefined();
    }

    expect(schema.validate({
      user: { profile: { name: 'Alice' } },
    }).success).toBe(true);

    expect(schema.validate({
      user: { profile: { name: 123 } },
    }).success).toBe(false);
  });

  it('validates arrays', () => {
    const schema = createCanonicalSchema({
      id: 'arrays',
      version: 1,
      zodSchema: z.object({
        tags: z.array(z.string()),
        numbers: z.array(z.number()).min(1).max(10),
      }),
    });

    expect(schema.validate({
      tags: ['a', 'b'],
      numbers: [1, 2, 3],
    }).success).toBe(true);

    expect(schema.validate({
      tags: [1, 2], // wrong type
      numbers: [1],
    }).success).toBe(false);

    expect(schema.validate({
      tags: [],
      numbers: [], // violates min(1)
    }).success).toBe(false);
  });

  it('validates enums', () => {
    const schema = createCanonicalSchema({
      id: 'enums',
      version: 1,
      zodSchema: z.object({
        status: z.enum(['pending', 'active', 'closed']),
        priority: z.union([z.literal('low'), z.literal('medium'), z.literal('high')]),
      }),
    });

    expect(schema.validate({
      status: 'active',
      priority: 'high',
    }).success).toBe(true);

    expect(schema.validate({
      status: 'unknown',
      priority: 'high',
    }).success).toBe(false);
  });

  it('validates arrays of objects', () => {
    const schema = createCanonicalSchema({
      id: 'array-of-objects',
      version: 1,
      zodSchema: z.object({
        items: z.array(
          z.object({
            id: z.number(),
            name: z.string(),
          })
        ),
      }),
    });

    expect(schema.validate({
      items: [
        { id: 1, name: 'First' },
        { id: 2, name: 'Second' },
      ],
    }).success).toBe(true);

    expect(schema.validate({
      items: [
        { id: 1, name: 'First' },
        { id: 'two', name: 'Second' }, // wrong type for id
      ],
    }).success).toBe(false);
  });
});

describe('validateStructuredOutput', () => {
  const schema = createCanonicalSchema({
    id: 'response',
    version: 1,
    zodSchema: z.object({
      result: z.string(),
      confidence: z.number(),
    }),
  });

  it('returns valid for correct JSON response', () => {
    const result = validateStructuredOutput(
      schema,
      '{"result":"success","confidence":0.95}',
      {}
    );

    expect(result.status).toBe('valid');
    if (isValidStructuredOutput(result)) {
      expect(result.data).toEqual({ result: 'success', confidence: 0.95 });
    }
  });

  it('returns refusal when finish reason is refusal', () => {
    const result = validateStructuredOutput(
      schema,
      '',
      { finishReason: 'refusal', refusalReason: 'Cannot assist with that' }
    );

    expect(result.status).toBe('refusal');
    if (isRefusalOutput(result)) {
      expect(result.reason).toBe('Cannot assist with that');
    }
  });

  it('returns refusal when refusalReason is provided', () => {
    const result = validateStructuredOutput(
      schema,
      '{}',
      { refusalReason: 'Policy violation' }
    );

    expect(result.status).toBe('refusal');
    if (isRefusalOutput(result)) {
      expect(result.reason).toBe('Policy violation');
    }
  });

  it('returns incomplete when truncated', () => {
    const result = validateStructuredOutput(
      schema,
      '{"result":"partial...',
      { truncated: true }
    );

    expect(result.status).toBe('incomplete');
    if (isIncompleteOutput(result)) {
      // Safe metadata only - never exposes partial output content
      expect(result.outputLength).toBe(21);
      expect(result.reason).toBe('unknown');
    }
  });

  it('returns incomplete when finish reason is length', () => {
    const result = validateStructuredOutput(
      schema,
      '{"result":"cut off',
      { finishReason: 'length' }
    );

    expect(result.status).toBe('incomplete');
    if (isIncompleteOutput(result)) {
      expect(result.reason).toBe('length_limit');
    }
  });

  it('returns incomplete when finish reason is incomplete', () => {
    const result = validateStructuredOutput(
      schema,
      '{"result":',
      { finishReason: 'incomplete' }
    );

    expect(result.status).toBe('incomplete');
    if (isIncompleteOutput(result)) {
      expect(result.reason).toBe('unknown');
    }
  });

  it('returns invalid_json for malformed JSON', () => {
    const result = validateStructuredOutput(
      schema,
      'not json at all',
      {}
    );

    expect(result.status).toBe('invalid_json');
    if (isInvalidJsonOutput(result)) {
      // Safe metadata only - never exposes raw output
      expect(result.outputLength).toBe(15);
    }
  });

  it('returns schema_invalid for valid JSON that fails schema', () => {
    const result = validateStructuredOutput(
      schema,
      '{"result":123,"confidence":"high"}',
      {}
    );

    expect(result.status).toBe('schema_invalid');
    if (isSchemaInvalidOutput(result)) {
      // Safe errors only - never exposes received values
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe('convertSchemaForProvider', () => {
  const schema = createCanonicalSchema({
    id: 'test',
    version: 1,
    zodSchema: z.object({
      name: z.string(),
      items: z.array(z.string()),
    }),
  });

  function createCapabilities(overrides: Partial<DeclaredCapabilities> = {}): DeclaredCapabilities {
    return {
      ...createUnknownCapabilities(),
      ...overrides,
    };
  }

  it('returns supported when provider supports all features', () => {
    const result = convertSchemaForProvider(schema, {
      capabilities: createCapabilities({
        schemaKeywords: {
          baseTypes: 'supported',
          objectKeywords: 'supported',
          arrayKeywords: 'supported',
          stringValidation: 'supported',
          numericValidation: 'supported',
          compositionKeywords: 'supported',
          referenceKeywords: 'supported',
        },
      }),
    });

    expect(result.supported).toBe(true);
    if (result.supported) {
      expect(result.jsonSchema).toBeDefined();
      expect(result.jsonSchema.type).toBe('object');
    }
  });

  it('returns unsupported when object keywords are unsupported', () => {
    const result = convertSchemaForProvider(schema, {
      capabilities: createCapabilities({
        schemaKeywords: {
          baseTypes: 'supported',
          objectKeywords: 'unsupported',
          arrayKeywords: 'supported',
          stringValidation: 'supported',
          numericValidation: 'supported',
          compositionKeywords: 'supported',
          referenceKeywords: 'supported',
        },
      }),
    });

    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.unsupportedFeatures).toContain('object properties');
    }
  });

  it('returns unsupported when array keywords are unsupported', () => {
    const result = convertSchemaForProvider(schema, {
      capabilities: createCapabilities({
        schemaKeywords: {
          baseTypes: 'supported',
          objectKeywords: 'supported',
          arrayKeywords: 'unsupported',
          stringValidation: 'supported',
          numericValidation: 'supported',
          compositionKeywords: 'supported',
          referenceKeywords: 'supported',
        },
      }),
    });

    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.unsupportedFeatures).toContain('array items');
    }
  });

  it('returns warnings when support is unknown', () => {
    const result = convertSchemaForProvider(schema, {
      capabilities: createUnknownCapabilities(),
    });

    expect(result.supported).toBe(true);
    if (result.supported) {
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.length).toBeGreaterThan(0);
    }
  });

  describe('composition keywords', () => {
    // Use discriminated union to ensure oneOf is generated in JSON Schema
    // Simple unions like z.union([z.string(), z.number()]) are optimized
    // to type arrays ["string", "number"] which don't use composition keywords
    const unionSchema = createCanonicalSchema({
      id: 'union',
      version: 1,
      zodSchema: z.object({
        value: z.discriminatedUnion('type', [
          z.object({ type: z.literal('a'), a: z.string() }),
          z.object({ type: z.literal('b'), b: z.number() }),
        ]),
      }),
    });

    it('returns unsupported when composition is unsupported', () => {
      const result = convertSchemaForProvider(unionSchema, {
        capabilities: createCapabilities({
          schemaKeywords: {
            baseTypes: 'supported',
            objectKeywords: 'supported',
            arrayKeywords: 'supported',
            stringValidation: 'supported',
            numericValidation: 'supported',
            compositionKeywords: 'unsupported',
            referenceKeywords: 'supported',
          },
        }),
      });

      expect(result.supported).toBe(false);
      if (!result.supported) {
        expect(result.unsupportedFeatures).toContain('schema composition (anyOf/oneOf/allOf)');
      }
    });
  });
});

describe('SchemaRegistry', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry();
  });

  it('registers and retrieves schemas', () => {
    const schema = createCanonicalSchema({
      id: 'user',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
    });

    registry.register(schema);
    const retrieved = registry.get('user', 1);

    expect(retrieved).toBe(schema);
  });

  it('throws on duplicate registration', () => {
    const schema = createCanonicalSchema({
      id: 'user',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
    });

    registry.register(schema);
    expect(() => registry.register(schema)).toThrow("Schema 'user@1' is already registered");
  });

  it('allows different versions of the same schema', () => {
    const v1 = createCanonicalSchema({
      id: 'user',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
    });

    const v2 = createCanonicalSchema({
      id: 'user',
      version: 2,
      zodSchema: z.object({ name: z.string(), email: z.string() }),
    });

    registry.register(v1);
    registry.register(v2);

    expect(registry.get('user', 1)).toBe(v1);
    expect(registry.get('user', 2)).toBe(v2);
  });

  it('retrieves the latest version of a schema', () => {
    const v1 = createCanonicalSchema({
      id: 'product',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
    });

    const v3 = createCanonicalSchema({
      id: 'product',
      version: 3,
      zodSchema: z.object({ name: z.string(), price: z.number() }),
    });

    const v2 = createCanonicalSchema({
      id: 'product',
      version: 2,
      zodSchema: z.object({ name: z.string(), sku: z.string() }),
    });

    registry.register(v1);
    registry.register(v3);
    registry.register(v2);

    const latest = registry.getLatest('product');
    expect(latest).toBe(v3);
    expect(latest?.version).toBe(3);
  });

  it('returns undefined for unknown schema', () => {
    expect(registry.get('nonexistent', 1)).toBeUndefined();
    expect(registry.getLatest('nonexistent')).toBeUndefined();
  });

  it('lists registered schema IDs', () => {
    registry.register(createCanonicalSchema({
      id: 'user',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
    }));

    registry.register(createCanonicalSchema({
      id: 'product',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
    }));

    registry.register(createCanonicalSchema({
      id: 'user',
      version: 2,
      zodSchema: z.object({ name: z.string(), email: z.string() }),
    }));

    const ids = registry.listIds();
    expect(ids).toContain('user');
    expect(ids).toContain('product');
    expect(ids.length).toBe(2);
  });

  it('clears all schemas', () => {
    registry.register(createCanonicalSchema({
      id: 'user',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
    }));

    registry.clear();
    expect(registry.listIds().length).toBe(0);
  });
});

describe('type guards', () => {
  const schema = createCanonicalSchema({
    id: 'test',
    version: 1,
    zodSchema: z.object({ value: z.string() }),
  });

  it('isValidStructuredOutput identifies valid results', () => {
    const result = validateStructuredOutput(schema, '{"value":"test"}', {});
    expect(isValidStructuredOutput(result)).toBe(true);
  });

  it('isInvalidJsonOutput identifies invalid JSON', () => {
    const result = validateStructuredOutput(schema, 'not json', {});
    expect(isInvalidJsonOutput(result)).toBe(true);
  });

  it('isSchemaInvalidOutput identifies schema errors', () => {
    const result = validateStructuredOutput(schema, '{"value":123}', {});
    expect(isSchemaInvalidOutput(result)).toBe(true);
  });

  it('isRefusalOutput identifies refusals', () => {
    const result = validateStructuredOutput(schema, '', { finishReason: 'refusal' });
    expect(isRefusalOutput(result)).toBe(true);
  });

  it('isIncompleteOutput identifies incomplete output', () => {
    const result = validateStructuredOutput(schema, '{"value":', { truncated: true });
    expect(isIncompleteOutput(result)).toBe(true);
  });
});

describe('canonical schema brand enforcement', () => {
  it('isCanonicalSchema accepts genuine canonical schemas', () => {
    const schema = createCanonicalSchema({
      id: 'test',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
    });

    expect(isCanonicalSchema(schema)).toBe(true);
  });

  it('isCanonicalSchema rejects plain objects with similar structure', () => {
    // Fake object that looks like a CanonicalSchema but was not created via createCanonicalSchema
    const fakeSchema = {
      id: 'fake',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
      toJsonSchema: () => ({ success: true, jsonSchema: { type: 'object' } }),
      validate: () => ({ success: true, data: {} }),
      parseAndValidate: () => ({ status: 'valid', data: {} }),
    };

    expect(isCanonicalSchema(fakeSchema)).toBe(false);
  });

  it('isCanonicalSchema rejects null', () => {
    expect(isCanonicalSchema(null)).toBe(false);
  });

  it('isCanonicalSchema rejects undefined', () => {
    expect(isCanonicalSchema(undefined)).toBe(false);
  });

  it('isCanonicalSchema rejects primitives', () => {
    expect(isCanonicalSchema('string')).toBe(false);
    expect(isCanonicalSchema(123)).toBe(false);
    expect(isCanonicalSchema(true)).toBe(false);
  });

  it('isCanonicalSchema rejects plain JSON Schema objects', () => {
    const plainJsonSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
      },
      required: ['name'],
    };

    expect(isCanonicalSchema(plainJsonSchema)).toBe(false);
  });

  it('extractJsonSchema rejects non-canonical schemas with TypeError', () => {
    const fakeSchema = {
      id: 'fake',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
      toJsonSchema: () => ({ success: true, jsonSchema: { type: 'object' } }),
    };

    expect(() => extractJsonSchema(fakeSchema as unknown as CanonicalSchema<unknown>)).toThrow(TypeError);
    expect(() => extractJsonSchema(fakeSchema as unknown as CanonicalSchema<unknown>)).toThrow(
      'extractJsonSchema requires a genuine CanonicalSchema'
    );
  });

  it('extractJsonSchema accepts genuine canonical schemas', () => {
    const schema = createCanonicalSchema({
      id: 'test',
      version: 1,
      zodSchema: z.object({ name: z.string() }),
    });

    const result = extractJsonSchema(schema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.jsonSchema.type).toBe('object');
    }
  });
});

describe('safe error output (no raw model content exposure)', () => {
  const SENTINEL = 'UNIQUE_SENTINEL_12345_SECRET_DATA';

  it('invalid_json does not expose raw output in result', () => {
    const schema = createCanonicalSchema({
      id: 'test',
      version: 1,
      zodSchema: z.object({ value: z.string() }),
    });

    // Model output containing sentinel - this is "leaked" if it appears in error
    const malformedJson = `{"value": "${SENTINEL}`;
    const result = validateStructuredOutput(schema, malformedJson, {});

    expect(result.status).toBe('invalid_json');
    if (isInvalidJsonOutput(result)) {
      // Verify sentinel is NOT in any fields
      const resultString = JSON.stringify(result);
      expect(resultString).not.toContain(SENTINEL);
      // Only safe metadata should be present
      expect(result.outputLength).toBe(malformedJson.length);
    }
  });

  it('schema_invalid does not expose parsed values in result', () => {
    const schema = createCanonicalSchema({
      id: 'test',
      version: 1,
      zodSchema: z.object({ value: z.number() }),
    });

    // Valid JSON but wrong type, with sentinel in the value
    const wrongTypeJson = `{"value": "${SENTINEL}"}`;
    const result = validateStructuredOutput(schema, wrongTypeJson, {});

    expect(result.status).toBe('schema_invalid');
    if (isSchemaInvalidOutput(result)) {
      // Verify sentinel is NOT in any error fields
      const resultString = JSON.stringify(result);
      expect(resultString).not.toContain(SENTINEL);
      // Error messages should be safe
      for (const error of result.errors) {
        expect(error.message).not.toContain(SENTINEL);
        expect(JSON.stringify(error.path)).not.toContain(SENTINEL);
      }
    }
  });

  it('incomplete does not expose partial output content', () => {
    const schema = createCanonicalSchema({
      id: 'test',
      version: 1,
      zodSchema: z.object({ value: z.string() }),
    });

    const partialOutput = `{"value": "${SENTINEL}...`;
    const result = validateStructuredOutput(schema, partialOutput, { truncated: true });

    expect(result.status).toBe('incomplete');
    if (isIncompleteOutput(result)) {
      const resultString = JSON.stringify(result);
      expect(resultString).not.toContain(SENTINEL);
      expect(result.outputLength).toBe(partialOutput.length);
    }
  });

  it('parseAndValidate does not expose raw output in invalid_json error', () => {
    const schema = createCanonicalSchema({
      id: 'test',
      version: 1,
      zodSchema: z.object({ value: z.string() }),
    });

    const result = schema.parseAndValidate(`invalid ${SENTINEL} json`);

    expect(result.status).toBe('invalid_json');
    const resultString = JSON.stringify(result);
    expect(resultString).not.toContain(SENTINEL);
  });

  it('parseAndValidate does not expose parsed values in schema_invalid error', () => {
    const schema = createCanonicalSchema({
      id: 'test',
      version: 1,
      zodSchema: z.object({ value: z.number() }),
    });

    const result = schema.parseAndValidate(`{"value": "${SENTINEL}"}`);

    expect(result.status).toBe('schema_invalid');
    const resultString = JSON.stringify(result);
    expect(resultString).not.toContain(SENTINEL);
  });
});

describe('validation order (refusal/incomplete before JSON parsing)', () => {
  const schema = createCanonicalSchema({
    id: 'test',
    version: 1,
    zodSchema: z.object({ value: z.string() }),
  });

  it('refusal takes precedence over invalid JSON', () => {
    // Output is invalid JSON, but refusal context is set
    const result = validateStructuredOutput(
      schema,
      'This is not JSON at all',
      { finishReason: 'refusal', refusalReason: 'Content policy violation' }
    );

    expect(result.status).toBe('refusal');
    if (isRefusalOutput(result)) {
      expect(result.reason).toBe('Content policy violation');
    }
  });

  it('incomplete takes precedence over invalid JSON', () => {
    // Output is invalid JSON, but truncated context is set
    const result = validateStructuredOutput(
      schema,
      '{"value": "this is truncat',
      { truncated: true }
    );

    expect(result.status).toBe('incomplete');
    // Should NOT be invalid_json even though the JSON is malformed
    expect(result.status).not.toBe('invalid_json');
  });

  it('incomplete with length finish reason takes precedence over invalid JSON', () => {
    const result = validateStructuredOutput(
      schema,
      '{"incomplete...',
      { finishReason: 'length' }
    );

    expect(result.status).toBe('incomplete');
    if (isIncompleteOutput(result)) {
      expect(result.reason).toBe('length_limit');
    }
  });

  it('refusal with refusalReason takes precedence over valid JSON', () => {
    // Output is valid JSON but model refused
    const result = validateStructuredOutput(
      schema,
      '{"value": "test"}',
      { refusalReason: 'Cannot assist' }
    );

    expect(result.status).toBe('refusal');
  });

  it('incomplete finish reason takes precedence over schema validation', () => {
    // Valid JSON but incomplete context
    const result = validateStructuredOutput(
      schema,
      '{"value": "test"}',
      { finishReason: 'incomplete' }
    );

    expect(result.status).toBe('incomplete');
  });
});

describe('input-side JSON Schema generation', () => {
  it('optional fields are not required in generated schema', () => {
    const schema = createCanonicalSchema({
      id: 'optional-test',
      version: 1,
      zodSchema: z.object({
        required: z.string(),
        optional: z.string().optional(),
      }),
    });

    const result = schema.toJsonSchema();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.jsonSchema.required).toContain('required');
      expect(result.jsonSchema.required).not.toContain('optional');
    }
  });

  it('defaulted fields are not required in generated schema (input side)', () => {
    const schema = createCanonicalSchema({
      id: 'default-test',
      version: 1,
      zodSchema: z.object({
        required: z.string(),
        withDefault: z.string().default('default-value'),
      }),
    });

    const result = schema.toJsonSchema();
    expect(result.success).toBe(true);
    if (result.success) {
      // Input-side generation: model is allowed to omit fields with defaults
      expect(result.jsonSchema.required).toContain('required');
      expect(result.jsonSchema.required).not.toContain('withDefault');
    }
  });

  it('local parsing applies defaults when field is omitted', () => {
    const schema = createCanonicalSchema({
      id: 'default-parse-test',
      version: 1,
      zodSchema: z.object({
        required: z.string(),
        withDefault: z.string().default('applied-default'),
      }),
    });

    // Model omits the defaulted field (which is valid per input-side schema)
    const validationResult = schema.validate({ required: 'value' });
    expect(validationResult.success).toBe(true);
    expect(validationResult.data).toEqual({
      required: 'value',
      withDefault: 'applied-default',
    });
  });

  it('JSON Schema generation is deterministic (same schema produces identical output)', () => {
    const schema = createCanonicalSchema({
      id: 'determinism-test',
      version: 1,
      zodSchema: z.object({
        name: z.string(),
        age: z.number().optional(),
        tags: z.array(z.string()),
      }),
    });

    const result1 = schema.toJsonSchema();
    const result2 = schema.toJsonSchema();

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    if (result1.success && result2.success) {
      expect(JSON.stringify(result1.jsonSchema)).toBe(JSON.stringify(result2.jsonSchema));
    }
  });

  it('JSON Schema with options is deterministic', () => {
    const schema = createCanonicalSchema({
      id: 'determinism-options-test',
      version: 1,
      zodSchema: z.object({
        status: z.enum(['active', 'inactive']),
      }),
    });

    const result1 = schema.toJsonSchema({ target: 'draft-07', includeSchema: true });
    const result2 = schema.toJsonSchema({ target: 'draft-07', includeSchema: true });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    if (result1.success && result2.success) {
      expect(JSON.stringify(result1.jsonSchema)).toBe(JSON.stringify(result2.jsonSchema));
    }
  });
});

describe('unrepresentable schema handling', () => {
  it('z.date() returns unsupported conversion result', () => {
    const schema = createCanonicalSchema({
      id: 'date-schema',
      version: 1,
      zodSchema: z.object({
        createdAt: z.date(),
      }),
    });

    const result = schema.toJsonSchema();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBeDefined();
      expect(typeof result.reason).toBe('string');
    }
  });

  it('transform with input-side generation is representable (input type is string)', () => {
    // Note: Input-side JSON Schema generation (io: 'input') looks at the input type,
    // not the output type. So a transform that takes a string and outputs an uppercase
    // string is representable as just a string input schema.
    const schema = createCanonicalSchema({
      id: 'transform-schema',
      version: 1,
      zodSchema: z.object({
        value: z.string().transform((s) => s.toUpperCase()),
      }),
    });

    const result = schema.toJsonSchema();
    // Input-side: the model must produce a string, which will be transformed
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.jsonSchema.properties?.value as { type: string })?.type).toBe('string');
    }
  });

  it('z.instanceof returns unsupported conversion result', () => {
    // z.instanceof cannot be represented in JSON Schema
    const schema = createCanonicalSchema({
      id: 'instanceof-schema',
      version: 1,
      zodSchema: z.object({
        error: z.instanceof(Error),
      }),
    });

    const result = schema.toJsonSchema();
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBeDefined();
    }
  });

  it('convertSchemaForProvider returns unsupported for unrepresentable schemas', () => {
    const schema = createCanonicalSchema({
      id: 'unrepresentable',
      version: 1,
      zodSchema: z.object({
        timestamp: z.date(),
      }),
    });

    const result = convertSchemaForProvider(schema, {
      capabilities: createUnknownCapabilities(),
    });

    expect(result.supported).toBe(false);
    if (!result.supported) {
      expect(result.unsupportedFeatures.length).toBeGreaterThan(0);
      expect(result.suggestion).toBeDefined();
    }
  });

  it('nested unrepresentable type is caught', () => {
    const schema = createCanonicalSchema({
      id: 'nested-unrepresentable',
      version: 1,
      zodSchema: z.object({
        user: z.object({
          lastLogin: z.date(),
        }),
      }),
    });

    const result = schema.toJsonSchema();
    expect(result.success).toBe(false);
  });

  it('array of unrepresentable types is caught', () => {
    const schema = createCanonicalSchema({
      id: 'array-unrepresentable',
      version: 1,
      zodSchema: z.object({
        dates: z.array(z.date()),
      }),
    });

    const result = schema.toJsonSchema();
    expect(result.success).toBe(false);
  });
});

describe('structured output canonical-only enforcement', () => {
  /**
   * Note: StructuredOutputMode.schema is typed as CanonicalSchema<unknown>,
   * so TypeScript enforces at compile time that ExternalToolSchema cannot be passed.
   * These tests verify the runtime type guard behavior that underpins this.
   */

  it('isCanonicalSchema returns true only for genuine canonical schemas', () => {
    const canonicalSchema = createCanonicalSchema({
      id: 'test',
      version: 1,
      zodSchema: z.object({ value: z.string() }),
    });

    // A genuine canonical schema passes
    expect(isCanonicalSchema(canonicalSchema)).toBe(true);
  });

  it('isCanonicalSchema returns false for external tool schema', () => {
    // An external tool schema (which uses kind discriminator) is not a CanonicalSchema
    const externalSchema = {
      kind: 'external_json_schema',
      source: 'mcp:test',
      jsonSchema: { type: 'object' },
    };

    expect(isCanonicalSchema(externalSchema)).toBe(false);
  });

  it('validateStructuredOutput requires canonical schema (type safety demonstration)', () => {
    const canonicalSchema = createCanonicalSchema({
      id: 'response',
      version: 1,
      zodSchema: z.object({ result: z.string() }),
    });

    // validateStructuredOutput works with canonical schemas
    const result = validateStructuredOutput(
      canonicalSchema,
      '{"result":"success"}',
      {}
    );

    expect(result.status).toBe('valid');
    // Note: Attempting to pass an ExternalToolSchema here would be a TypeScript error
    // because validateStructuredOutput's first parameter is typed as CanonicalSchema<T>
  });

  it('existing canonical-only structured output tests continue passing', () => {
    const schema = createCanonicalSchema({
      id: 'existing-test',
      version: 1,
      zodSchema: z.object({
        name: z.string(),
        count: z.number(),
      }),
    });

    // All the existing validation paths work
    const validResult = validateStructuredOutput(
      schema,
      '{"name":"test","count":42}',
      {}
    );
    expect(validResult.status).toBe('valid');

    const invalidJsonResult = validateStructuredOutput(
      schema,
      'not json',
      {}
    );
    expect(invalidJsonResult.status).toBe('invalid_json');

    const schemaInvalidResult = validateStructuredOutput(
      schema,
      '{"name":123,"count":"wrong"}',
      {}
    );
    expect(schemaInvalidResult.status).toBe('schema_invalid');

    const refusalResult = validateStructuredOutput(
      schema,
      '',
      { finishReason: 'refusal' }
    );
    expect(refusalResult.status).toBe('refusal');

    const incompleteResult = validateStructuredOutput(
      schema,
      '{"name":"partial',
      { truncated: true }
    );
    expect(incompleteResult.status).toBe('incomplete');
  });
});
