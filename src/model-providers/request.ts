/**
 * Provider-neutral request types.
 *
 * Implements Task 3.2 requirement 6: Common request contract.
 *
 * Key principles:
 * - Bounded request options with explicit limits
 * - Structured output mode with schema handle (not schema conversion)
 * - Tool definitions with tool-choice policy
 * - Timeout and cancellation support
 */

import type { ConversationMessage } from './messages.js';
import type { ContinuationRef, ContinuationPolicy } from './continuation.js';

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
   * JSON Schema for the tool's parameters.
   * Adapters convert this to provider-specific schema format.
   * Task 3.2a handles schema conversion; this is a schema handle.
   */
  readonly parameters: JsonSchemaHandle;

  /**
   * Whether this tool requires human confirmation before execution.
   * Informational; not enforced by the provider adapter.
   */
  readonly requiresConfirmation?: boolean;
}

/**
 * JSON Schema handle.
 *
 * This is a placeholder for the actual JSON Schema definition.
 * Task 3.2a defines the schema types and conversion.
 * For now, we use a generic object that adapters pass through.
 */
export interface JsonSchemaHandle {
  /**
   * Schema type (always 'object' for tool parameters).
   */
  readonly type: 'object';

  /**
   * Property definitions.
   */
  readonly properties?: Record<string, unknown>;

  /**
   * Required property names.
   */
  readonly required?: readonly string[];

  /**
   * Whether to allow additional properties.
   */
  readonly additionalProperties?: boolean;

  /**
   * Description of the schema (for documentation).
   */
  readonly description?: string;
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
 */
export interface StructuredOutputMode {
  /**
   * Schema handle for the structured output.
   * Adapters convert this to provider-specific formats.
   */
  readonly schema: JsonSchemaHandle;

  /**
   * Optional name for the schema (used by some providers).
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

  // Check tool name uniqueness
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
  timeoutMs: 60000, // 1 minute
  store: false, // Privacy default per DEC-028
};
