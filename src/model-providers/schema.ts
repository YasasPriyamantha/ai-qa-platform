/**
 * Canonical schema abstraction for AI structured outputs.
 *
 * Implements Task 3.2a: One source of truth for AI structured-output schemas.
 *
 * Key principles:
 * - Zod schemas are the canonical definition (DEC-037)
 * - JSON Schema generation derives from the Zod schema via z.toJSONSchema()
 *   using input-side generation (io: "input") so the model produces
 *   what the schema will parse, not post-transform output
 * - Local validation derives from the same Zod schema via z.safeParse()
 * - Provider adapters receive JSON Schema, not raw Zod schemas
 * - Distinct validation error types for invalid JSON, schema-invalid, refusal, incomplete
 * - Error messages never expose raw model output
 */

import { z } from 'zod';
import type { DeclaredCapabilities } from './types.js';

/**
 * Brand symbol for canonical schemas.
 * Used to reliably distinguish genuine canonical schemas from arbitrary objects.
 */
const CANONICAL_SCHEMA_BRAND = Symbol.for('ai-qa-platform.canonical-schema');

/**
 * JSON Schema representation generated from a Zod schema.
 * This is a subset of JSON Schema Draft 2020-12 that we support.
 */
export interface GeneratedJsonSchema {
  readonly $schema?: string;
  readonly type?: string | readonly string[];
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: unknown;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly anyOf?: readonly unknown[];
  readonly oneOf?: readonly unknown[];
  readonly allOf?: readonly unknown[];
  readonly $ref?: string;
  readonly $defs?: Record<string, unknown>;
  readonly title?: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly format?: string;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly [key: string]: unknown;
}

/**
 * Canonical schema wrapping a Zod schema definition.
 *
 * This is the single source of truth for structured output schemas.
 * Both JSON Schema generation and runtime validation derive from this.
 *
 * The brand property ensures only schemas created via createCanonicalSchema
 * are accepted by the platform.
 *
 * @template T The TypeScript type that the schema validates to
 */
export interface CanonicalSchema<T = unknown> {
  /**
   * Brand property to identify genuine canonical schemas.
   * @internal
   */
  readonly [CANONICAL_SCHEMA_BRAND]: true;

  /**
   * Schema identifier for versioning and registry lookup.
   * Should be stable across schema versions for the same logical schema.
   */
  readonly id: string;

  /**
   * Schema version for deterministic schema management.
   * Increment when the schema structure changes.
   */
  readonly version: number;

  /**
   * Optional human-readable name for the schema.
   * Used in provider schema registration (e.g., OpenAI response_format.name).
   */
  readonly name?: string;

  /**
   * Optional description of what this schema represents.
   */
  readonly description?: string;

  /**
   * The underlying Zod schema.
   * Platform code uses this for validation; adapters should use toJsonSchema().
   */
  readonly zodSchema: z.ZodType<T>;

  /**
   * Generate JSON Schema from the Zod schema.
   * Uses input-side generation so the model produces what will be parsed.
   *
   * @param options Optional conversion options
   * @returns JSON Schema conversion result (success or unsupported)
   */
  toJsonSchema(options?: JsonSchemaOptions): JsonSchemaConversionResult;

  /**
   * Validate a value against the schema.
   *
   * @param value The value to validate (should be parsed JSON)
   * @returns Validation result with typed output or errors
   */
  validate(value: unknown): SchemaValidationResult<T>;

  /**
   * Parse and validate a JSON string.
   * Error messages are sanitized to never expose raw input.
   *
   * @param jsonString The JSON string to parse and validate
   * @returns Validation result distinguishing parse errors from schema errors
   */
  parseAndValidate(jsonString: string): StructuredOutputValidationResult<T>;
}

/**
 * Options for JSON Schema generation.
 */
export interface JsonSchemaOptions {
  /**
   * Target JSON Schema version.
   * @default 'draft-2020-12'
   */
  readonly target?: 'draft-04' | 'draft-07' | 'draft-2020-12' | 'openapi-3.0';

  /**
   * Whether to include $schema in output.
   * @default false
   */
  readonly includeSchema?: boolean;

  /**
   * Whether to include $defs for reused schemas.
   * Some providers don't support $ref/$defs.
   * @default false
   */
  readonly allowRefs?: boolean;
}

/**
 * Result of JSON Schema conversion from a canonical schema.
 */
export type JsonSchemaConversionResult =
  | JsonSchemaConversionSuccess
  | JsonSchemaConversionUnsupported;

/**
 * Successfully converted to JSON Schema.
 */
export interface JsonSchemaConversionSuccess {
  readonly success: true;
  readonly jsonSchema: GeneratedJsonSchema;
}

/**
 * Schema cannot be represented as JSON Schema.
 */
export interface JsonSchemaConversionUnsupported {
  readonly success: false;
  readonly reason: string;
}

/**
 * Result of schema validation (after JSON is already parsed).
 */
export interface SchemaValidationResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly errors?: readonly SchemaValidationError[];
}

/**
 * Individual schema validation error.
 * Never exposes received values or raw input.
 */
export interface SchemaValidationError {
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly code: string;
}

/**
 * Discriminated union for structured output validation results.
 *
 * Provides distinct categories per Task 3.2a requirement 5:
 * - valid: Successfully parsed and validated
 * - invalid_json: Failed to parse as JSON
 * - schema_invalid: Parsed as JSON but failed schema validation
 * - refusal: Model refused to generate output
 * - incomplete: Output was truncated or incomplete
 *
 * Error results never expose raw model output.
 */
export type StructuredOutputValidationResult<T> =
  | StructuredOutputValid<T>
  | StructuredOutputInvalidJson
  | StructuredOutputSchemaInvalid
  | StructuredOutputRefusal
  | StructuredOutputIncomplete;

/**
 * Successfully validated structured output.
 */
export interface StructuredOutputValid<T> {
  readonly status: 'valid';
  readonly data: T;
}

/**
 * Failed to parse response as JSON.
 * Does not expose raw output or parse error details that might contain output.
 */
export interface StructuredOutputInvalidJson {
  readonly status: 'invalid_json';
  /**
   * Length of the output that failed to parse.
   * Provides diagnostic info without exposing content.
   */
  readonly outputLength: number;
  /**
   * Position where parsing failed, if available.
   */
  readonly errorPosition?: number;
}

/**
 * Parsed as JSON but failed schema validation.
 * Does not expose parsed values or raw input fields.
 */
export interface StructuredOutputSchemaInvalid {
  readonly status: 'schema_invalid';
  readonly errors: readonly SchemaValidationError[];
}

/**
 * Model refused to generate output (detected via content).
 */
export interface StructuredOutputRefusal {
  readonly status: 'refusal';
  readonly reason?: string;
}

/**
 * Output was truncated or incomplete.
 * Does not expose partial output content.
 */
export interface StructuredOutputIncomplete {
  readonly status: 'incomplete';
  /**
   * Length of the partial output.
   */
  readonly outputLength: number;
  readonly reason: 'length_limit' | 'connection_error' | 'unknown';
}

/**
 * Context for schema conversion to provider-specific format.
 */
export interface SchemaConversionContext {
  /**
   * Target provider's declared capabilities.
   */
  readonly capabilities: DeclaredCapabilities;

  /**
   * Whether strict schema enforcement is requested.
   */
  readonly strict?: boolean;

  /**
   * Target JSON Schema version for this provider.
   */
  readonly targetVersion?: 'draft-04' | 'draft-07' | 'draft-2020-12' | 'openapi-3.0';
}

/**
 * Result of schema conversion for a provider.
 */
export type SchemaConversionResult =
  | SchemaConversionSuccess
  | SchemaConversionUnsupported;

/**
 * Successfully converted schema for the provider.
 */
export interface SchemaConversionSuccess {
  readonly supported: true;
  readonly jsonSchema: GeneratedJsonSchema;
  readonly warnings?: readonly string[];
}

/**
 * Schema contains features unsupported by the provider.
 */
export interface SchemaConversionUnsupported {
  readonly supported: false;
  readonly unsupportedFeatures: readonly string[];
  readonly suggestion?: string;
}

/**
 * Schema registry for managing canonical schemas.
 *
 * Per Task 3.2a requirement 6: Keep schema definitions versionable
 * and deterministic.
 */
export class SchemaRegistry {
  private readonly schemas = new Map<string, CanonicalSchema<unknown>>();

  /**
   * Register a canonical schema.
   * @throws If a schema with the same ID and version already exists
   */
  register<T>(schema: CanonicalSchema<T>): void {
    const key = `${schema.id}@${schema.version}`;
    if (this.schemas.has(key)) {
      throw new Error(`Schema '${key}' is already registered`);
    }
    this.schemas.set(key, schema as CanonicalSchema<unknown>);
  }

  /**
   * Get a schema by ID and version.
   */
  get<T = unknown>(id: string, version: number): CanonicalSchema<T> | undefined {
    return this.schemas.get(`${id}@${version}`) as CanonicalSchema<T> | undefined;
  }

  /**
   * Get the latest version of a schema by ID.
   */
  getLatest<T = unknown>(id: string): CanonicalSchema<T> | undefined {
    let latest: CanonicalSchema<unknown> | undefined;
    let latestVersion = -1;

    for (const [key, schema] of this.schemas) {
      if (key.startsWith(`${id}@`) && schema.version > latestVersion) {
        latest = schema;
        latestVersion = schema.version;
      }
    }

    return latest as CanonicalSchema<T> | undefined;
  }

  /**
   * List all registered schema IDs.
   */
  listIds(): string[] {
    const ids = new Set<string>();
    for (const schema of this.schemas.values()) {
      ids.add(schema.id);
    }
    return Array.from(ids);
  }

  /**
   * Clear all registered schemas.
   */
  clear(): void {
    this.schemas.clear();
  }
}

/**
 * Check if an object is a genuine canonical schema created by this module.
 */
export function isCanonicalSchema(value: unknown): value is CanonicalSchema<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    CANONICAL_SCHEMA_BRAND in value &&
    (value as Record<symbol, unknown>)[CANONICAL_SCHEMA_BRAND] === true
  );
}

/**
 * Sanitize a path from Zod issues to only include string/number segments.
 */
function sanitizePath(path: readonly PropertyKey[]): readonly (string | number)[] {
  return path.map((segment) => {
    if (typeof segment === 'symbol') {
      return String(segment);
    }
    return segment;
  });
}

/**
 * Extract position from a JSON parse error message if available.
 */
function extractErrorPosition(error: Error): number | undefined {
  // JSON parse errors often include position like "at position 42"
  const match = error.message.match(/position\s+(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * Create a canonical schema from a Zod schema.
 *
 * @param options Schema options including the Zod schema
 * @returns A CanonicalSchema instance with the brand
 */
export function createCanonicalSchema<T>(options: {
  id: string;
  version: number;
  name?: string;
  description?: string;
  zodSchema: z.ZodType<T>;
}): CanonicalSchema<T> {
  const { id, version, name, description, zodSchema } = options;

  const schema: CanonicalSchema<T> = {
    [CANONICAL_SCHEMA_BRAND]: true,
    id,
    version,
    name,
    description,
    zodSchema,

    toJsonSchema(jsonOptions?: JsonSchemaOptions): JsonSchemaConversionResult {
      const target = jsonOptions?.target ?? 'draft-2020-12';
      const allowRefs = jsonOptions?.allowRefs ?? false;

      try {
        // Use input-side generation per DEC-037
        // The model must produce what will be parsed, not post-transform output
        const jsonSchema = z.toJSONSchema(zodSchema, {
          target,
          io: 'input',
          reused: allowRefs ? 'ref' : 'inline',
          // Throw on unrepresentable types rather than silently weakening
          unrepresentable: 'throw',
        }) as GeneratedJsonSchema;

        // Remove $schema if not requested
        if (!jsonOptions?.includeSchema && jsonSchema.$schema) {
          const { $schema: _, ...rest } = jsonSchema;
          return { success: true, jsonSchema: rest as GeneratedJsonSchema };
        }

        return { success: true, jsonSchema };
      } catch (error) {
        // Schema contains types that cannot be represented in JSON Schema
        const reason = error instanceof Error
          ? error.message
          : 'Schema contains unrepresentable types';
        return { success: false, reason };
      }
    },

    validate(value: unknown): SchemaValidationResult<T> {
      const result = zodSchema.safeParse(value);

      if (result.success) {
        return {
          success: true,
          data: result.data,
        };
      }

      // Sanitize errors to not expose received values
      const errors: SchemaValidationError[] = result.error.issues.map((issue) => ({
        path: sanitizePath(issue.path),
        message: issue.message,
        code: issue.code,
      }));

      return {
        success: false,
        errors,
      };
    },

    parseAndValidate(jsonString: string): StructuredOutputValidationResult<T> {
      // Try to parse JSON
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonString);
      } catch (error) {
        // Return sanitized error without exposing raw output
        return {
          status: 'invalid_json',
          outputLength: jsonString.length,
          errorPosition: error instanceof Error ? extractErrorPosition(error) : undefined,
        };
      }

      // Validate against schema
      const result = zodSchema.safeParse(parsed);

      if (result.success) {
        return {
          status: 'valid',
          data: result.data,
        };
      }

      // Sanitize errors to not expose received values or raw input
      const errors: SchemaValidationError[] = result.error.issues.map((issue) => ({
        path: sanitizePath(issue.path),
        message: issue.message,
        code: issue.code,
      }));

      return {
        status: 'schema_invalid',
        errors,
      };
    },
  };

  return schema;
}

/**
 * Validate structured output from a model response.
 *
 * This function handles the full validation flow:
 * 1. Check for refusal state FIRST (before any parsing)
 * 2. Check for incomplete/truncated state SECOND (before any parsing)
 * 3. Parse JSON
 * 4. Validate against schema
 *
 * A truncated response that also contains invalid JSON is reported as
 * incomplete, not invalid_json.
 *
 * @param schema The canonical schema to validate against
 * @param output The raw output string from the model
 * @param context Validation context (finish reason, truncation status)
 * @returns Validation result with appropriate status
 */
export function validateStructuredOutput<T>(
  schema: CanonicalSchema<T>,
  output: string,
  context: {
    finishReason?: string;
    truncated?: boolean;
    refusalReason?: string;
  }
): StructuredOutputValidationResult<T> {
  // 1. Check for refusal FIRST (before any parsing attempts)
  if (context.finishReason === 'refusal' || context.refusalReason) {
    return {
      status: 'refusal',
      reason: context.refusalReason,
    };
  }

  // 2. Check for incomplete/truncated output SECOND (before any parsing attempts)
  // A truncated response should be reported as incomplete, not invalid_json
  if (context.truncated || context.finishReason === 'length' || context.finishReason === 'incomplete') {
    return {
      status: 'incomplete',
      outputLength: output.length,
      reason: context.finishReason === 'length' ? 'length_limit' : 'unknown',
    };
  }

  // 3. Try to parse and validate
  return schema.parseAndValidate(output);
}

/**
 * Convert a canonical schema for a specific provider.
 *
 * This function checks if the schema uses features unsupported by the
 * provider and either returns the converted schema or an unsupported result.
 *
 * Note: This is a generic conversion interface. Provider-specific schema
 * lowering rules (OpenAI, Anthropic, Gemini) are implemented in the
 * respective adapter tasks (3.4-3.6a), not in this shared module.
 *
 * @param schema The canonical schema to convert
 * @param context Provider capability context
 * @returns Conversion result (supported with schema or unsupported with reasons)
 */
export function convertSchemaForProvider<T>(
  schema: CanonicalSchema<T>,
  context: SchemaConversionContext
): SchemaConversionResult {
  const warnings: string[] = [];
  const unsupportedFeatures: string[] = [];

  // Generate JSON Schema with appropriate options
  const conversionResult = schema.toJsonSchema({
    target: context.targetVersion ?? 'draft-2020-12',
    allowRefs: context.capabilities.schemaKeywords.referenceKeywords === 'supported',
  });

  // Handle unrepresentable schemas
  if (!conversionResult.success) {
    return {
      supported: false,
      unsupportedFeatures: [conversionResult.reason],
      suggestion: 'Remove transforms, dates, or other types that cannot be expressed in JSON Schema',
    };
  }

  const jsonSchema = conversionResult.jsonSchema;

  // Check for unsupported features based on capabilities
  const schemaKeywords = context.capabilities.schemaKeywords;

  // Check object keywords
  if (jsonSchema.properties && schemaKeywords.objectKeywords !== 'supported') {
    if (schemaKeywords.objectKeywords === 'unsupported') {
      unsupportedFeatures.push('object properties');
    } else {
      warnings.push('object properties support is unknown');
    }
  }

  // Check array keywords (including nested arrays)
  if (hasArrayItems(jsonSchema) && schemaKeywords.arrayKeywords !== 'supported') {
    if (schemaKeywords.arrayKeywords === 'unsupported') {
      unsupportedFeatures.push('array items');
    } else {
      warnings.push('array items support is unknown');
    }
  }

  // Check composition keywords (including nested)
  if (hasCompositionKeywords(jsonSchema) &&
      schemaKeywords.compositionKeywords !== 'supported') {
    if (schemaKeywords.compositionKeywords === 'unsupported') {
      unsupportedFeatures.push('schema composition (anyOf/oneOf/allOf)');
    } else {
      warnings.push('schema composition support is unknown');
    }
  }

  // Check reference keywords
  if ((jsonSchema.$ref || jsonSchema.$defs) &&
      schemaKeywords.referenceKeywords !== 'supported') {
    if (schemaKeywords.referenceKeywords === 'unsupported') {
      unsupportedFeatures.push('schema references ($ref/$defs)');
    } else {
      warnings.push('schema reference support is unknown');
    }
  }

  // Check string validation
  if (hasStringValidation(jsonSchema) && schemaKeywords.stringValidation !== 'supported') {
    if (schemaKeywords.stringValidation === 'unsupported') {
      unsupportedFeatures.push('string validation (pattern/format/length)');
    } else {
      warnings.push('string validation support is unknown');
    }
  }

  // Check numeric validation
  if (hasNumericValidation(jsonSchema) && schemaKeywords.numericValidation !== 'supported') {
    if (schemaKeywords.numericValidation === 'unsupported') {
      unsupportedFeatures.push('numeric validation (min/max)');
    } else {
      warnings.push('numeric validation support is unknown');
    }
  }

  // If there are unsupported features, return failure
  if (unsupportedFeatures.length > 0) {
    return {
      supported: false,
      unsupportedFeatures,
      suggestion: 'Consider simplifying the schema or using a provider that supports these features',
    };
  }

  return {
    supported: true,
    jsonSchema,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Check if a JSON Schema uses array items keywords (including nested).
 */
function hasArrayItems(schema: GeneratedJsonSchema): boolean {
  if (schema.items) {
    return true;
  }

  // Check nested schemas in properties
  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      if (typeof prop === 'object' && prop !== null) {
        if (hasArrayItems(prop as GeneratedJsonSchema)) {
          return true;
        }
      }
    }
  }

  // Check items in nested arrays
  if (schema.items && typeof schema.items === 'object') {
    if (hasArrayItems(schema.items as GeneratedJsonSchema)) {
      return true;
    }
  }

  // Check composition schemas
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const schemas = schema[key] as readonly unknown[] | undefined;
    if (schemas) {
      for (const s of schemas) {
        if (typeof s === 'object' && s !== null) {
          if (hasArrayItems(s as GeneratedJsonSchema)) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

/**
 * Check if a JSON Schema uses composition keywords (including nested).
 */
function hasCompositionKeywords(schema: GeneratedJsonSchema): boolean {
  if (schema.anyOf || schema.oneOf || schema.allOf) {
    return true;
  }

  // Check nested schemas in properties
  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      if (typeof prop === 'object' && prop !== null) {
        if (hasCompositionKeywords(prop as GeneratedJsonSchema)) {
          return true;
        }
      }
    }
  }

  // Check items
  if (schema.items && typeof schema.items === 'object') {
    if (hasCompositionKeywords(schema.items as GeneratedJsonSchema)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a JSON Schema uses string validation keywords.
 */
function hasStringValidation(schema: GeneratedJsonSchema): boolean {
  if (schema.pattern || schema.format || schema.minLength || schema.maxLength) {
    return true;
  }

  // Check nested schemas
  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      if (typeof prop === 'object' && prop !== null) {
        if (hasStringValidation(prop as GeneratedJsonSchema)) {
          return true;
        }
      }
    }
  }

  if (schema.items && typeof schema.items === 'object') {
    if (hasStringValidation(schema.items as GeneratedJsonSchema)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a JSON Schema uses numeric validation keywords.
 */
function hasNumericValidation(schema: GeneratedJsonSchema): boolean {
  if (schema.minimum !== undefined || schema.maximum !== undefined) {
    return true;
  }

  // Check nested schemas
  if (schema.properties) {
    for (const prop of Object.values(schema.properties)) {
      if (typeof prop === 'object' && prop !== null) {
        if (hasNumericValidation(prop as GeneratedJsonSchema)) {
          return true;
        }
      }
    }
  }

  if (schema.items && typeof schema.items === 'object') {
    if (hasNumericValidation(schema.items as GeneratedJsonSchema)) {
      return true;
    }
  }

  return false;
}

/**
 * Type guard for valid structured output.
 */
export function isValidStructuredOutput<T>(
  result: StructuredOutputValidationResult<T>
): result is StructuredOutputValid<T> {
  return result.status === 'valid';
}

/**
 * Type guard for invalid JSON structured output.
 */
export function isInvalidJsonOutput<T>(
  result: StructuredOutputValidationResult<T>
): result is StructuredOutputInvalidJson {
  return result.status === 'invalid_json';
}

/**
 * Type guard for schema-invalid structured output.
 */
export function isSchemaInvalidOutput<T>(
  result: StructuredOutputValidationResult<T>
): result is StructuredOutputSchemaInvalid {
  return result.status === 'schema_invalid';
}

/**
 * Type guard for refusal structured output.
 */
export function isRefusalOutput<T>(
  result: StructuredOutputValidationResult<T>
): result is StructuredOutputRefusal {
  return result.status === 'refusal';
}

/**
 * Type guard for incomplete structured output.
 */
export function isIncompleteOutput<T>(
  result: StructuredOutputValidationResult<T>
): result is StructuredOutputIncomplete {
  return result.status === 'incomplete';
}

// Re-export Zod for schema definition convenience
export { z } from 'zod';
