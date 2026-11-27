/**
 * Provider-neutral request types.
 *
 * Implements Task 3.2 requirement 6: Common request contract.
 * Implements Task 3.2a: Canonical schema integration (DEC-037).
 *
 * Key principles:
 * - Bounded request options with explicit limits
 * - Structured output mode with canonical schema reference
 * - Tool definitions with tool-choice policy
 * - Timeout and cancellation support
 */

import type { ConversationMessage } from './messages.js';
import type { ContinuationRef, ContinuationPolicy } from './continuation.js';
import type { CanonicalSchema, JsonSchemaConversionResult } from './schema.js';
import { isCanonicalSchema as isCanonicalSchemaFromSchema } from './schema.js';

/**
 * External tool schema for tools supplied by external servers (e.g., MCP).
 *
 * This type wraps a JSON Schema obtained from an external tool server at runtime.
 * It is explicitly marked as externally supplied and untrusted.
 *
 * IMPORTANT: Tool-call arguments returned by the model are untrusted JSON.
 * External tool parameter schemas are NOT canonical structured-output schemas.
 * The tool owner/orchestrator (Phase 4) is responsible for validating tool
 * arguments before execution. The structured-output validator does not
 * validate external tool-call arguments.
 *
 * Provider adapters may reject an external schema if they cannot represent
 * it in their selected API. They must not silently discard constraints.
 */
export interface ExternalToolSchema {
  /**
   * Discriminator identifying this as an external JSON Schema.
   * Must be exactly 'external_json_schema'.
   */
  readonly kind: 'external_json_schema';

  /**
   * Source/provenance identifier for the external schema.
   * Must be a non-empty string identifying where the schema came from.
   * Examples: 'mcp:playwright', 'mcp:filesystem', 'openapi:petstore'
   */
  readonly source: string;

  /**
   * The external JSON Schema object.
   * Must be a plain, non-null, non-array object.
   * This schema data is externally supplied and untrusted.
   */
  readonly jsonSchema: Readonly<Record<string, unknown>>;
}

/**
 * Tool parameter schema type.
 *
 * Tool parameters can be defined as:
 * 1. A CanonicalSchema for platform-defined tools (provides local validation)
 * 2. An ExternalToolSchema for tools from external servers (e.g., MCP)
 *
 * Plain JSON Schema objects without a wrapper are not accepted.
 */
export type ToolParameterSchema = CanonicalSchema<unknown> | ExternalToolSchema;

/**
 * Tool definition for model requests.
 *
 * Platform-owned definition; adapters convert to provider-specific formats.
 */
export interface ToolDefinition {
  /**
   * Tool name. Must be unique within the request.
   * Lowercase alphanumeric with underscores, like a function name.
   */
  readonly name: string;

  /**
   * Human-readable description of what the tool does.
   * Helps the model decide when to use the tool.
   */
  readonly description: string;

  /**
   * Schema for the tool's parameters.
   *
   * Can be provided as:
   * - A CanonicalSchema for platform-defined tools (provides local validation)
   * - An ExternalToolSchema for tools from external servers (e.g., MCP)
   *
   * Plain JSON Schema objects without a wrapper are not accepted.
   *
   * IMPORTANT: Tool-call arguments returned by the model are untrusted JSON.
   * The tool owner/orchestrator is responsible for validating arguments before
   * execution. The structured-output validator does not validate tool arguments.
   */
  readonly parameters?: ToolParameterSchema;

  /**
   * Whether this tool requires human confirmation before execution.
   * Informational; not enforced by the provider adapter.
   */
  readonly requiresConfirmation?: boolean;
}

/**
 * Type guard for external tool schema.
 */
export function isExternalToolSchema(value: unknown): value is ExternalToolSchema {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).kind === 'external_json_schema' &&
    typeof (value as ExternalToolSchema).source === 'string' &&
    typeof (value as ExternalToolSchema).jsonSchema === 'object' &&
    (value as ExternalToolSchema).jsonSchema !== null
  );
}

/**
 * Check if a value is a plain object (object literal or null-prototype object).
 *
 * Rejects arrays, null, Date, Map, Set, and custom class instances.
 * Accepts ordinary object literals and Object.create(null) objects.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  // Accept plain objects (prototype is Object.prototype) and null-prototype objects
  return proto === Object.prototype || proto === null;
}

/**
 * Validate an external tool schema wrapper.
 *
 * Returns an array of validation error messages, or empty array if valid.
 */
export function validateExternalToolSchema(schema: unknown): string[] {
  const errors: string[] = [];

  if (typeof schema !== 'object' || schema === null) {
    errors.push('external tool schema must be an object');
    return errors;
  }

  const obj = schema as Record<string, unknown>;

  if (obj.kind !== 'external_json_schema') {
    errors.push("external tool schema must have kind 'external_json_schema'");
  }

  if (typeof obj.source !== 'string' || obj.source.trim() === '') {
    errors.push('external tool schema source must be a non-empty string');
  }

  if (typeof obj.jsonSchema !== 'object' || obj.jsonSchema === null) {
    errors.push('external tool schema jsonSchema must be a non-null object');
  } else if (!isPlainObject(obj.jsonSchema)) {
    errors.push('external tool schema jsonSchema must be a plain object');
  }

  return errors;
}

/**
 * Validate a tool parameter schema.
 *
 * Returns an array of validation error messages, or empty array if valid.
 */
export function validateToolParameterSchema(schema: unknown, toolName: string): string[] {
  // Check if it's a canonical schema
  if (isCanonicalSchema(schema)) {
    return [];
  }

  // Check if it looks like an external tool schema
  if (typeof schema === 'object' && schema !== null) {
    const obj = schema as Record<string, unknown>;
    if (obj.kind === 'external_json_schema') {
      const externalErrors = validateExternalToolSchema(schema);
      return externalErrors.map(e => `tool '${toolName}': ${e}`);
    }
  }

  // Not a recognized schema type
  return [`tool '${toolName}': parameters must be a CanonicalSchema or ExternalToolSchema`];
}

/**
 * Re-export isCanonicalSchema from schema.ts for convenience.
 *
 * This type guard uses the brand symbol to reliably distinguish genuine
 * canonical schemas from arbitrary structurally similar objects.
 */
export const isCanonicalSchema = isCanonicalSchemaFromSchema;

/**
 * Extract JSON Schema from a canonical schema.
 *
 * Only accepts genuine CanonicalSchema instances created via createCanonicalSchema().
 * Raw JSON Schema objects are not accepted as request inputs.
 *
 * @param schema The canonical schema to extract JSON Schema from
 * @returns The JSON Schema conversion result (success or unsupported)
 * @throws TypeError if the input is not a genuine CanonicalSchema
 */
export function extractJsonSchema(
  schema: CanonicalSchema<unknown>
): JsonSchemaConversionResult {
  if (!isCanonicalSchema(schema)) {
    throw new TypeError(
      'extractJsonSchema requires a genuine CanonicalSchema created via createCanonicalSchema(). ' +
      'Raw JSON Schema objects are not accepted as request inputs.'
    );
  }
  return schema.toJsonSchema();
}

/**
 * Tool choice policy for requests.
 *
 * Controls how the model uses available tools.
 */
export type ToolChoicePolicy =
  | 'auto' // Model decides whether to call tools
  | 'none' // Model must not call tools
  | 'required' // Model must call at least one tool
  | { readonly type: 'specific'; readonly name: string }; // Model must call this specific tool

/**
 * Structured output mode for responses.
 *
 * When enabled, the response is constrained to match a schema.
 *
 * Per DEC-037: The schema must be a genuine CanonicalSchema created via
 * createCanonicalSchema(). This provides both JSON Schema generation
 * (for the provider) and local runtime validation (for response verification)
 * from a single Zod schema definition.
 */
export interface StructuredOutputMode {
  /**
   * Canonical schema for the structured output.
   *
   * Must be a genuine CanonicalSchema created via createCanonicalSchema().
   * The platform validates responses locally using the schema's Zod validator
   * even when provider-side validation is enabled.
   *
   * Plain JSON Schema objects are not accepted. Use createCanonicalSchema() to
   * wrap a Zod schema definition.
   */
  readonly schema: CanonicalSchema<unknown>;

  /**
   * Optional name for the schema (used by some providers).
   * Overrides the schema's name property if set.
   */
  readonly name?: string;

  /**
   * Whether to enforce strict schema validation.
   * Not all providers support strict mode.
   */
  readonly strict?: boolean;
}

/**
 * Request options with bounded limits.
 */
export interface RequestOptions {
  /**
   * Maximum tokens in the response.
   * Provider adapters enforce this if supported.
   */
  readonly maxTokens?: number;

  /**
   * Temperature for sampling (0.0 to 2.0).
   * Lower = more deterministic, higher = more creative.
   */
  readonly temperature?: number;

  /**
   * Top-p sampling (nucleus sampling).
   * Alternative to temperature; use one or the other.
   */
  readonly topP?: number;

  /**
   * Stop sequences that end generation.
   */
  readonly stopSequences?: readonly string[];

  /**
   * Request timeout in milliseconds.
   * Adapters enforce this at the HTTP/request level.
   */
  readonly timeoutMs?: number;

  /**
   * Seed for deterministic generation (if supported).
   */
  readonly seed?: number;

  /**
   * Whether to store the request/response on the provider's side.
   * Per DEC-028: Default to false for privacy.
   * @default false
   */
  readonly store?: boolean;

  /**
   * User identifier for rate limiting and abuse detection.
   * Per DEC-028: Never include secrets or PII.
   */
  readonly user?: string;
}

/**
 * Complete model request.
 */
export interface ModelRequest {
  /**
   * Target provider ID.
   * Must match a configured provider.
   */
  readonly providerId: string;

  /**
   * Model ID to use.
   * Overrides the provider's default model if specified.
   */
  readonly modelId?: string;

  /**
   * System/developer instructions.
   * Separate from messages for providers that use a system parameter.
   */
  readonly instructions?: string;

  /**
   * Conversation messages.
   * Must be in valid turn order (system?, user/assistant/tool alternating).
   */
  readonly messages: readonly ConversationMessage[];

  /**
   * Tool definitions available for this request.
   */
  readonly tools?: readonly ToolDefinition[];

  /**
   * Tool choice policy.
   * @default 'auto' if tools are provided
   */
  readonly toolChoice?: ToolChoicePolicy;

  /**
   * Structured output mode.
   * When set, response is constrained to match the schema.
   */
  readonly structuredOutput?: StructuredOutputMode;

  /**
   * Request options (limits, timeout, etc.).
   */
  readonly options?: RequestOptions;

  /**
   * Continuation reference from a previous response.
   * Used for multi-turn conversations with reasoning/thinking.
   */
  readonly continuationRef?: ContinuationRef;

  /**
   * Continuation handling policy.
   * @default 'prefer'
   */
  readonly continuationPolicy?: ContinuationPolicy;

  /**
   * Abort signal for cancellation.
   * Adapters should respect this for request cancellation.
   */
  readonly signal?: AbortSignal;

  /**
   * Request metadata for tracing/debugging.
   * Not sent to the provider.
   */
  readonly metadata?: RequestMetadata;
}

/**
 * Request metadata for tracing and debugging.
 */
export interface RequestMetadata {
  /**
   * Caller-provided request ID for correlation.
   */
  readonly requestId?: string;

  /**
   * Workflow or task context.
   */
  readonly context?: string;

  /**
   * Timestamp when the request was created.
   */
  readonly timestamp?: string;
}

/**
 * Validation result for a model request.
 */
export interface RequestValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validate a model request.
 *
 * Checks:
 * - Provider ID is present
 * - Messages array is not empty
 * - Message order is valid (turn-taking)
 * - Tool names are unique
 * - Bounded options are within ranges
 */
export function validateRequest(request: ModelRequest): RequestValidationResult {
  const errors: string[] = [];

  // Check provider ID
  if (!request.providerId || request.providerId.trim() === '') {
    errors.push('providerId is required');
  }

  // Check messages
  if (!request.messages || request.messages.length === 0) {
    errors.push('messages array must not be empty');
  } else {
    // Validate message order
    const orderErrors = validateMessageOrder(request.messages);
    errors.push(...orderErrors);
  }

  // Check tool name uniqueness and parameter schema validity
  if (request.tools && request.tools.length > 0) {
    const toolNames = new Set<string>();
    for (const tool of request.tools) {
      if (!tool.name || tool.name.trim() === '') {
        errors.push('tool name must not be empty');
      } else if (toolNames.has(tool.name)) {
        errors.push(`duplicate tool name: ${tool.name}`);
      } else {
        toolNames.add(tool.name);
      }

      // Validate tool parameter schema if provided
      if (tool.parameters !== undefined) {
        const paramErrors = validateToolParameterSchema(tool.parameters, tool.name);
        errors.push(...paramErrors);
      }
    }
  }

  // Check specific tool choice exists
  if (
    request.toolChoice &&
    typeof request.toolChoice === 'object' &&
    request.toolChoice.type === 'specific'
  ) {
    const specificChoice = request.toolChoice as { readonly type: 'specific'; readonly name: string };
    const toolExists = request.tools?.some((t) => t.name === specificChoice.name);
    if (!toolExists) {
      errors.push(`tool choice '${specificChoice.name}' not found in tools`);
    }
  }

  // Check bounded options
  if (request.options) {
    if (request.options.maxTokens !== undefined) {
      if (request.options.maxTokens < 1) {
        errors.push('maxTokens must be at least 1');
      }
      if (request.options.maxTokens > 1000000) {
        errors.push('maxTokens exceeds maximum (1000000)');
      }
    }

    if (request.options.temperature !== undefined) {
      if (request.options.temperature < 0 || request.options.temperature > 2) {
        errors.push('temperature must be between 0 and 2');
      }
    }

    if (request.options.topP !== undefined) {
      if (request.options.topP < 0 || request.options.topP > 1) {
        errors.push('topP must be between 0 and 1');
      }
    }

    if (request.options.timeoutMs !== undefined) {
      if (request.options.timeoutMs < 1000) {
        errors.push('timeoutMs must be at least 1000ms');
      }
      if (request.options.timeoutMs > 600000) {
        errors.push('timeoutMs exceeds maximum (600000ms / 10 minutes)');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate conversation message order.
 *
 * Rules:
 * - System messages may appear at the start
 * - After system, messages should alternate user/assistant/tool
 * - Tool results must follow assistant messages with tool calls
 */
function validateMessageOrder(messages: readonly ConversationMessage[]): string[] {
  const errors: string[] = [];

  if (messages.length === 0) {
    return errors;
  }

  let seenNonSystem = false;
  let lastRole: string | null = null;
  let pendingToolCalls = new Map<string, string>(); // callId -> toolName

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'system') {
      if (seenNonSystem) {
        // System messages after non-system are allowed by some providers
        // but we'll flag it as a warning-level issue
        // For now, we allow it but could add a warning
      }
    } else {
      seenNonSystem = true;
    }

    // Track tool call lifecycle
    if (msg.role === 'assistant') {
      // Check for tool calls in content
      if (typeof msg.content !== 'string') {
        for (const item of msg.content) {
          if (item.type === 'tool_call') {
            pendingToolCalls.set(item.toolCall.id, item.toolCall.name);
          }
        }
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          pendingToolCalls.set(tc.id, tc.name);
        }
      }
    }

    if (msg.role === 'tool') {
      // Tool result must reference a pending tool call
      if (!pendingToolCalls.has(msg.toolCallId)) {
        errors.push(
          `message[${i}]: tool result for '${msg.toolCallId}' has no matching tool call`
        );
      } else {
        const expectedName = pendingToolCalls.get(msg.toolCallId);
        if (expectedName !== msg.toolName) {
          errors.push(
            `message[${i}]: tool result name '${msg.toolName}' does not match call name '${expectedName}'`
          );
        }
        pendingToolCalls.delete(msg.toolCallId);
      }
    }

    lastRole = msg.role;
  }

  // All tool calls should have results (unless at the end for continuation)
  if (pendingToolCalls.size > 0 && lastRole !== 'assistant') {
    const pendingIds = Array.from(pendingToolCalls.keys()).join(', ');
    errors.push(`unresolved tool calls: ${pendingIds}`);
  }

  return errors;
}

/**
 * Default request options.
 */
export const DEFAULT_REQUEST_OPTIONS: RequestOptions = {
  timeoutMs: 180000, // 3 minutes
  store: false, // Privacy default per DEC-028
};
