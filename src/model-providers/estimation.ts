/**
 * Input-size estimation for conservative preflight checks.
 *
 * Task 3.3a: Conservative preflight estimate including all request components.
 *
 * Key principles:
 * - Include system instructions, messages, tool definitions, schemas, images
 * - Use documented conservative character-based estimation with safety margin
 * - Reject if images cannot be bounded conservatively
 * - Hard input-character limit as additional safeguard
 * - Estimates are NOT provider-verified token counts
 */

import type { ModelRequest, ToolDefinition, StructuredOutputMode } from './request.js';
import type { ConversationMessage } from './messages.js';
import { isExternalToolSchema, type ToolParameterSchema } from './request.js';
import { isCanonicalSchema } from './schema.js';

/**
 * Configuration for input-size estimation.
 */
export interface EstimationConfig {
  /**
   * Characters per token ratio for estimation.
   * Default: 4 (conservative for English text with code/JSON).
   */
  readonly charsPerToken: number;

  /**
   * Safety margin percentage to add to estimates.
   * Default: 20 (20% margin).
   */
  readonly safetyMarginPercent: number;

  /**
   * Hard maximum input characters allowed.
   * Requests exceeding this are rejected.
   */
  readonly maxInputCharacters: number;

  /**
   * Whether to allow unbounded image content.
   * If false, requests with images are rejected.
   * Default: false
   */
  readonly allowUnboundedImages: boolean;

  /**
   * Estimated tokens per image (if images are allowed).
   * This is a conservative high estimate.
   */
  readonly tokensPerImage: number;
}

/**
 * Default estimation configuration.
 *
 * Conservative defaults that err on the side of overestimation.
 */
export const DEFAULT_ESTIMATION_CONFIG: EstimationConfig = {
  charsPerToken: 4, // Conservative: typically 3-4 for English
  safetyMarginPercent: 20, // 20% safety margin
  maxInputCharacters: 500_000, // ~125k tokens at 4 chars/token
  allowUnboundedImages: false, // Reject images by default
  tokensPerImage: 2048, // Conservative high estimate per image
};

/**
 * Result of input-size estimation.
 */
export interface EstimationResult {
  /**
   * Whether the estimation succeeded.
   */
  readonly success: boolean;

  /**
   * Estimated input tokens (with safety margin).
   */
  readonly estimatedTokens?: number;

  /**
   * Estimated input characters (before safety margin).
   */
  readonly rawCharacters?: number;

  /**
   * Character-to-token ratio used.
   */
  readonly charsPerToken?: number;

  /**
   * Safety margin percentage applied.
   */
  readonly safetyMarginPercent?: number;

  /**
   * Breakdown of character counts by component.
   */
  readonly breakdown?: EstimationBreakdown;

  /**
   * Error if estimation failed.
   */
  readonly error?: EstimationError;

  /**
   * Warnings about the estimate.
   */
  readonly warnings: readonly string[];
}

/**
 * Breakdown of estimated characters by component.
 */
export interface EstimationBreakdown {
  readonly instructions: number;
  readonly messages: number;
  readonly toolDefinitions: number;
  readonly toolParameterSchemas: number;
  readonly structuredOutputSchema: number;
  readonly imageContent: number;
  readonly overhead: number;
  readonly total: number;
}

/**
 * Error during estimation.
 */
export interface EstimationError {
  readonly code: EstimationErrorCode;
  readonly message: string;
  readonly details?: string;
}

/**
 * Error codes for estimation failures.
 */
export type EstimationErrorCode =
  | 'EXCEEDS_MAX_CHARACTERS'
  | 'UNBOUNDED_IMAGES'
  | 'INVALID_REQUEST'
  | 'ESTIMATION_FAILED';

/**
 * Estimate input size for a model request.
 *
 * Returns a conservative estimate that includes all components:
 * - System/developer instructions
 * - All conversation messages and tool results
 * - Tool definitions
 * - Canonical tool parameter schemas
 * - External tool JSON Schemas
 * - Structured-output schema
 * - Image content items
 *
 * @param request - The model request to estimate
 * @param config - Estimation configuration
 * @returns Estimation result with token estimate or error
 */
export function estimateInputSize(
  request: ModelRequest,
  config: EstimationConfig = DEFAULT_ESTIMATION_CONFIG
): EstimationResult {
  const warnings: string[] = [];
  let totalCharacters = 0;

  // Calculate instructions
  const instructionsChars = estimateInstructions(request.instructions);
  totalCharacters += instructionsChars;

  // Calculate messages
  const messagesResult = estimateMessages(request.messages);
  if (messagesResult.error) {
    return {
      success: false,
      error: messagesResult.error,
      warnings,
    };
  }
  totalCharacters += messagesResult.characters;
  if (messagesResult.imageCount > 0) {
    warnings.push(`Request contains ${messagesResult.imageCount} image(s)`);
  }

  // Calculate tool definitions
  const toolDefsChars = estimateToolDefinitions(request.tools);
  totalCharacters += toolDefsChars;

  // Calculate tool parameter schemas
  const toolSchemasChars = estimateToolParameterSchemas(request.tools);
  totalCharacters += toolSchemasChars;

  // Calculate structured output schema
  const structuredSchemaChars = estimateStructuredOutputSchema(request.structuredOutput);
  totalCharacters += structuredSchemaChars;

  // Calculate images (if allowed)
  let imageCharacters = 0;
  if (messagesResult.imageCount > 0) {
    if (!config.allowUnboundedImages) {
      return {
        success: false,
        error: {
          code: 'UNBOUNDED_IMAGES',
          message: `Request contains ${messagesResult.imageCount} image(s) but images are not allowed`,
          details: 'Set allowUnboundedImages: true in config to allow images (not recommended)',
        },
        warnings,
      };
    }
    // Conservative estimate: each image uses a fixed high token count
    imageCharacters = messagesResult.imageCount * config.tokensPerImage * config.charsPerToken;
    totalCharacters += imageCharacters;
  }

  // Add overhead for JSON structure, special tokens, etc.
  const overhead = Math.ceil(totalCharacters * 0.05); // 5% overhead
  totalCharacters += overhead;

  // Check hard limit
  if (totalCharacters > config.maxInputCharacters) {
    return {
      success: false,
      error: {
        code: 'EXCEEDS_MAX_CHARACTERS',
        message: `Estimated input size (${totalCharacters} characters) exceeds maximum (${config.maxInputCharacters})`,
        details: `Reduce message content or tool definitions`,
      },
      warnings,
    };
  }

  // Calculate estimated tokens with safety margin
  const baseTokens = Math.ceil(totalCharacters / config.charsPerToken);
  const marginTokens = Math.ceil(baseTokens * (config.safetyMarginPercent / 100));
  const estimatedTokens = baseTokens + marginTokens;

  const breakdown: EstimationBreakdown = {
    instructions: instructionsChars,
    messages: messagesResult.characters,
    toolDefinitions: toolDefsChars,
    toolParameterSchemas: toolSchemasChars,
    structuredOutputSchema: structuredSchemaChars,
    imageContent: imageCharacters,
    overhead,
    total: totalCharacters,
  };

  return {
    success: true,
    estimatedTokens,
    rawCharacters: totalCharacters,
    charsPerToken: config.charsPerToken,
    safetyMarginPercent: config.safetyMarginPercent,
    breakdown,
    warnings,
  };
}

/**
 * Estimate character count for instructions.
 */
function estimateInstructions(instructions: string | undefined): number {
  if (!instructions) {
    return 0;
  }
  return instructions.length;
}

/**
 * Result of message estimation.
 */
interface MessageEstimationResult {
  characters: number;
  imageCount: number;
  error?: EstimationError;
}

/**
 * Estimate character count for all messages.
 */
function estimateMessages(
  messages: readonly ConversationMessage[]
): MessageEstimationResult {
  let totalChars = 0;
  let imageCount = 0;

  for (const message of messages) {
    // Role overhead
    totalChars += message.role.length + 10; // Role name + JSON structure

    // Content - handle as generic since all message types have string | array content
    const content = message.content;
    if (typeof content === 'string') {
      totalChars += content.length;
    } else if (Array.isArray(content)) {
      // Handle content arrays - estimate based on type discrimination
      for (const item of content) {
        if ('type' in item) {
          if (item.type === 'text' && 'text' in item) {
            totalChars += (item as { text: string }).text.length;
          } else if (item.type === 'image') {
            imageCount += 1;
          } else if (item.type === 'image_url' && 'url' in item) {
            totalChars += (item as { url: string }).url.length;
            imageCount += 1;
          } else if (item.type === 'tool_call' && 'toolCall' in item) {
            const tc = (item as { toolCall: { name: string; id: string; arguments: string } }).toolCall;
            totalChars += tc.name.length + tc.id.length + tc.arguments.length;
          } else if (item.type === 'refusal' && 'refusal' in item) {
            totalChars += (item as { refusal: string }).refusal.length;
          } else {
            // Unknown item type - conservative estimate
            totalChars += JSON.stringify(item).length;
          }
        } else {
          totalChars += JSON.stringify(item).length;
        }
      }
    }

    // Tool calls in assistant messages (via convenience accessor)
    if (message.role === 'assistant' && 'toolCalls' in message && message.toolCalls) {
      for (const toolCall of message.toolCalls) {
        totalChars += toolCall.name.length;
        totalChars += toolCall.id.length;
        totalChars += toolCall.arguments.length;
      }
    }

    // Tool result metadata
    if (message.role === 'tool') {
      totalChars += (message as { toolCallId?: string }).toolCallId?.length ?? 0;
      totalChars += (message as { toolName?: string }).toolName?.length ?? 0;
    }
  }

  return { characters: totalChars, imageCount };
}

/**
 * Estimate character count for tool definitions.
 */
function estimateToolDefinitions(tools: readonly ToolDefinition[] | undefined): number {
  if (!tools || tools.length === 0) {
    return 0;
  }

  let totalChars = 0;
  for (const tool of tools) {
    totalChars += tool.name.length;
    totalChars += tool.description.length;
    // Additional JSON structure overhead
    totalChars += 50;
  }
  return totalChars;
}

/**
 * Estimate character count for tool parameter schemas.
 */
function estimateToolParameterSchemas(tools: readonly ToolDefinition[] | undefined): number {
  if (!tools || tools.length === 0) {
    return 0;
  }

  let totalChars = 0;
  for (const tool of tools) {
    if (tool.parameters) {
      totalChars += estimateToolParameterSchema(tool.parameters);
    }
  }
  return totalChars;
}

/**
 * Estimate character count for a single tool parameter schema.
 */
function estimateToolParameterSchema(schema: ToolParameterSchema): number {
  if (isExternalToolSchema(schema)) {
    // External JSON Schema - stringify to get size
    return JSON.stringify(schema.jsonSchema).length;
  }

  if (isCanonicalSchema(schema)) {
    // Canonical schema - convert to JSON Schema and measure
    const result = schema.toJsonSchema();
    if (result.success) {
      return JSON.stringify(result.jsonSchema).length;
    }
    // If conversion fails, estimate based on schema complexity
    return 500; // Conservative default
  }

  // Unknown schema type - conservative estimate
  return 500;
}

/**
 * Estimate character count for structured output schema.
 */
function estimateStructuredOutputSchema(mode: StructuredOutputMode | undefined): number {
  if (!mode) {
    return 0;
  }

  const result = mode.schema.toJsonSchema();
  if (result.success) {
    return JSON.stringify(result.jsonSchema).length;
  }

  // Conversion failed - conservative estimate
  return 1000;
}

/**
 * Quick check if input size is within hard limits.
 *
 * Faster than full estimation for quick rejection.
 *
 * @param request - Request to check
 * @param maxCharacters - Maximum allowed characters
 * @returns true if likely within limits, false if definitely over
 */
export function quickSizeCheck(
  request: ModelRequest,
  maxCharacters: number
): boolean {
  // Quick character count without detailed breakdown
  let chars = 0;

  if (request.instructions) {
    chars += request.instructions.length;
  }

  for (const message of request.messages) {
    if (typeof message.content === 'string') {
      chars += message.content.length;
    } else {
      // Rough estimate for structured content
      chars += JSON.stringify(message.content).length;
    }

    // Quick check - if already over, return early
    if (chars > maxCharacters) {
      return false;
    }
  }

  return true;
}

/**
 * Calculate maximum output tokens reservation.
 *
 * Uses the requested maxTokens or a conservative default.
 *
 * @param maxTokens - Requested max output tokens
 * @param defaultMax - Default if not specified
 * @returns Output tokens to reserve
 */
export function calculateOutputReservation(
  maxTokens: number | undefined,
  defaultMax: number = 4096
): number {
  if (maxTokens !== undefined && maxTokens > 0) {
    return maxTokens;
  }
  return defaultMax;
}

/**
 * Calculate total reservation for a request.
 *
 * @param inputEstimate - Estimated input tokens
 * @param outputReservation - Output tokens to reserve
 * @returns Total tokens to reserve against budget
 */
export function calculateTotalReservation(
  inputEstimate: number,
  outputReservation: number
): number {
  return inputEstimate + outputReservation;
}
