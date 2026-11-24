/**
 * Provider-neutral response types.
 *
 * Implements Task 3.2 requirement 6: Common response contract.
 *
 * Key principles:
 * - Text/structured output with provider-validated content
 * - Tool calls with stable IDs for correlation
 * - Finish state distinguishing stop, tool calls, length, refusal
 * - Usage statistics with known/unknown representation (Task 3.3a)
 * - Provider/model/request identification
 */

import type { ToolCall, AssistantMessage } from './messages.js';
import type { ContinuationRef } from './continuation.js';
import type { ProviderIdentity } from './types.js';
import type { ObservedUsage } from './usage.js';

/**
 * Finish reason indicating why generation stopped.
 */
export type FinishReason =
  | 'stop' // Model finished naturally or hit stop sequence
  | 'tool_calls' // Model requested tool calls
  | 'length' // Hit max tokens limit
  | 'content_filter' // Content was filtered
  | 'refusal' // Model refused to respond
  | 'incomplete' // Response was truncated or incomplete
  | 'error' // Provider error during generation
  | 'cancelled'; // Request was cancelled

// TokenUsage interface removed in Task 3.3a cleanup.
// No consumers existed. Use ObservedUsage from usage.ts instead.

/**
 * Response timing information.
 */
export interface ResponseTiming {
  /**
   * Time to first token in milliseconds.
   */
  readonly firstTokenMs?: number;

  /**
   * Total response time in milliseconds.
   */
  readonly totalMs: number;

  /**
   * Request sent timestamp (ISO 8601).
   */
  readonly requestedAt: string;

  /**
   * Response received timestamp (ISO 8601).
   */
  readonly completedAt: string;
}

/**
 * Complete model response.
 */
export interface ModelResponse {
  /**
   * Provider identity that generated this response.
   */
  readonly identity: ProviderIdentity;

  /**
   * Provider-generated request ID for debugging.
   */
  readonly providerRequestId?: string;

  /**
   * Platform-side request ID for correlation.
   */
  readonly platformRequestId?: string;

  /**
   * Response content as an assistant message.
   * Contains text, tool calls, or refusal.
   */
  readonly message: AssistantMessage;

  /**
   * Finish reason indicating why generation stopped.
   */
  readonly finishReason: FinishReason;

  /**
   * Whether the response contains tool calls.
   */
  readonly hasToolCalls: boolean;

  /**
   * Extracted tool calls for convenience.
   * Same as message.toolCalls but guaranteed to be an array.
   */
  readonly toolCalls: readonly ToolCall[];

  /**
   * Text content of the response (if any).
   * Extracted from the message for convenience.
   */
  readonly text: string;

  /**
   * Structured output (if request used structured output mode).
   * JSON-parsed result that should match the request schema.
   * Validation is done by the adapter; this is the parsed result.
   */
  readonly structuredOutput?: unknown;

  /**
   * Whether the response was validated against the schema.
   * Only present if structured output was requested.
   */
  readonly structuredOutputValid?: boolean;

  /**
   * Continuation reference for preserving conversation state.
   * Present if the provider returned reasoning/thinking content
   * that should be preserved for multi-turn conversations.
   */
  readonly continuationRef?: ContinuationRef;

  /**
   * Whether continuation state was created for this response.
   */
  readonly hasContinuation: boolean;

  /**
   * Provider-observed token usage with known/unknown representation.
   * Each field (input, output, total) can independently be known or unknown.
   * Unknown values are never converted to zero.
   */
  readonly usage?: ObservedUsage;

  /**
   * Response timing information.
   */
  readonly timing: ResponseTiming;

  /**
   * Refusal reason if the model refused to respond.
   */
  readonly refusalReason?: string;

  /**
   * Content filter information if content was filtered.
   */
  readonly contentFilter?: ContentFilterResult;

  /**
   * Whether the response was truncated due to length.
   */
  readonly truncated: boolean;

  /**
   * Model fingerprint or version for reproducibility.
   */
  readonly modelFingerprint?: string;
}

/**
 * Content filter result information.
 */
export interface ContentFilterResult {
  /**
   * Whether content was filtered.
   */
  readonly filtered: boolean;

  /**
   * Categories that triggered filtering.
   */
  readonly categories?: readonly string[];

  /**
   * Filter severity or reason.
   */
  readonly reason?: string;
}

/**
 * Response with error (failed request).
 */
export interface ModelErrorResponse {
  /**
   * This is an error response.
   */
  readonly success: false;

  /**
   * Error that occurred.
   */
  readonly error: import('./errors.js').ProviderError;

  /**
   * Provider identity that was targeted.
   */
  readonly identity?: ProviderIdentity;

  /**
   * Provider request ID if available.
   */
  readonly providerRequestId?: string;

  /**
   * Platform request ID for correlation.
   */
  readonly platformRequestId?: string;

  /**
   * Partial usage if available before error.
   * Uses ObservedUsage with known/unknown representation.
   */
  readonly partialUsage?: Partial<ObservedUsage>;

  /**
   * Timing up to the error.
   */
  readonly timing?: Partial<ResponseTiming>;
}

/**
 * Response with success (completed request).
 */
export interface ModelSuccessResponse {
  /**
   * This is a success response.
   */
  readonly success: true;

  /**
   * The model response.
   */
  readonly response: ModelResponse;
}

/**
 * Result type for model requests.
 * Discriminated union for success/error handling.
 */
export type ModelResult = ModelSuccessResponse | ModelErrorResponse;

/**
 * Type guard for success response.
 */
export function isSuccessResponse(result: ModelResult): result is ModelSuccessResponse {
  return result.success === true;
}

/**
 * Type guard for error response.
 */
export function isErrorResponse(result: ModelResult): result is ModelErrorResponse {
  return result.success === false;
}

/**
 * Create a success response.
 */
export function successResponse(response: ModelResponse): ModelSuccessResponse {
  return { success: true, response };
}

/**
 * Create an error response.
 */
export function errorResponse(
  error: import('./errors.js').ProviderError,
  metadata?: {
    identity?: ProviderIdentity;
    providerRequestId?: string;
    platformRequestId?: string;
    partialUsage?: Partial<ObservedUsage>;
    timing?: Partial<ResponseTiming>;
  }
): ModelErrorResponse {
  return {
    success: false,
    error,
    ...(metadata ?? {}),
  };
}

/**
 * Response builder for constructing ModelResponse.
 * Used by adapters to build responses from provider-specific formats.
 */
export class ResponseBuilder {
  private _identity!: ProviderIdentity;
  private _message!: AssistantMessage;
  private _finishReason: FinishReason = 'stop';
  private _providerRequestId?: string;
  private _platformRequestId?: string;
  private _usage?: ObservedUsage;
  private _timing!: ResponseTiming;
  private _continuationRef?: ContinuationRef;
  private _structuredOutput?: unknown;
  private _structuredOutputValid?: boolean;
  private _contentFilter?: ContentFilterResult;
  private _modelFingerprint?: string;

  identity(identity: ProviderIdentity): this {
    this._identity = identity;
    return this;
  }

  message(message: AssistantMessage): this {
    this._message = message;
    return this;
  }

  finishReason(reason: FinishReason): this {
    this._finishReason = reason;
    return this;
  }

  providerRequestId(id: string): this {
    this._providerRequestId = id;
    return this;
  }

  platformRequestId(id: string): this {
    this._platformRequestId = id;
    return this;
  }

  /**
   * Set provider-observed usage with known/unknown representation.
   */
  usage(usage: ObservedUsage): this {
    this._usage = usage;
    return this;
  }

  timing(timing: ResponseTiming): this {
    this._timing = timing;
    return this;
  }

  continuationRef(ref: ContinuationRef): this {
    this._continuationRef = ref;
    return this;
  }

  structuredOutput(output: unknown, valid: boolean): this {
    this._structuredOutput = output;
    this._structuredOutputValid = valid;
    return this;
  }

  contentFilter(filter: ContentFilterResult): this {
    this._contentFilter = filter;
    return this;
  }

  modelFingerprint(fingerprint: string): this {
    this._modelFingerprint = fingerprint;
    return this;
  }

  build(): ModelResponse {
    if (!this._identity) {
      throw new Error('identity is required');
    }
    if (!this._message) {
      throw new Error('message is required');
    }
    if (!this._timing) {
      throw new Error('timing is required');
    }

    // Extract text and tool calls from message
    const toolCalls = this._message.toolCalls ?? [];
    const hasToolCalls = toolCalls.length > 0;

    let text = '';
    if (typeof this._message.content === 'string') {
      text = this._message.content;
    } else {
      const textParts: string[] = [];
      for (const item of this._message.content) {
        if (item.type === 'text') {
          textParts.push(item.text);
        }
      }
      text = textParts.join('');
    }

    // Extract refusal reason
    let refusalReason: string | undefined;
    if (typeof this._message.content !== 'string') {
      for (const item of this._message.content) {
        if (item.type === 'refusal') {
          refusalReason = item.refusal;
          break;
        }
      }
    }

    return {
      identity: this._identity,
      providerRequestId: this._providerRequestId,
      platformRequestId: this._platformRequestId,
      message: this._message,
      finishReason: this._finishReason,
      hasToolCalls,
      toolCalls,
      text,
      structuredOutput: this._structuredOutput,
      structuredOutputValid: this._structuredOutputValid,
      continuationRef: this._continuationRef,
      hasContinuation: this._continuationRef !== undefined,
      usage: this._usage,
      timing: this._timing,
      refusalReason,
      contentFilter: this._contentFilter,
      truncated: this._finishReason === 'length' || this._finishReason === 'incomplete',
      modelFingerprint: this._modelFingerprint,
    };
  }
}
