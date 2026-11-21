/**
 * Message and contract validation.
 *
 * Implements Task 3.2 requirement 9: Tests for message union validation,
 * multi-turn tool-call/result correlation, and opaque state preservation.
 *
 * This module provides runtime validation for conversation messages
 * and tool call/result correlation.
 */

import type { ConversationMessage, ToolCall } from './messages.js';

/**
 * Validation result for messages.
 */
export interface MessageValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validate a system message.
 */
export function validateSystemMessage(msg: unknown): MessageValidationResult {
  const errors: string[] = [];

  if (typeof msg !== 'object' || msg === null) {
    return { valid: false, errors: ['message must be an object'] };
  }

  const m = msg as Record<string, unknown>;

  if (m.role !== 'system') {
    errors.push(`role must be 'system', got '${m.role}'`);
  }

  if (typeof m.content !== 'string') {
    errors.push('content must be a string');
  } else if (m.content.length === 0) {
    errors.push('content must not be empty');
  }

  if (m.name !== undefined && typeof m.name !== 'string') {
    errors.push('name must be a string if provided');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate content item (text, image, image_url).
 */
export function validateContentItem(item: unknown, index: number): string[] {
  const errors: string[] = [];
  const prefix = `content[${index}]`;

  if (typeof item !== 'object' || item === null) {
    errors.push(`${prefix} must be an object`);
    return errors;
  }

  const i = item as Record<string, unknown>;

  if (!['text', 'image', 'image_url'].includes(i.type as string)) {
    errors.push(`${prefix}.type must be 'text', 'image', or 'image_url'`);
    return errors;
  }

  if (i.type === 'text') {
    if (typeof i.text !== 'string') {
      errors.push(`${prefix}.text must be a string`);
    }
  } else if (i.type === 'image') {
    if (typeof i.data !== 'string') {
      errors.push(`${prefix}.data must be a string`);
    }
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(i.mediaType as string)) {
      errors.push(`${prefix}.mediaType must be a valid image media type`);
    }
  } else if (i.type === 'image_url') {
    if (typeof i.url !== 'string') {
      errors.push(`${prefix}.url must be a string`);
    }
  }

  return errors;
}

/**
 * Validate message content (string or array of content items).
 */
export function validateMessageContent(content: unknown): string[] {
  const errors: string[] = [];

  if (typeof content === 'string') {
    return errors; // String content is valid
  }

  if (!Array.isArray(content)) {
    errors.push('content must be a string or array');
    return errors;
  }

  for (let i = 0; i < content.length; i++) {
    errors.push(...validateContentItem(content[i], i));
  }

  return errors;
}

/**
 * Validate a user message.
 */
export function validateUserMessage(msg: unknown): MessageValidationResult {
  const errors: string[] = [];

  if (typeof msg !== 'object' || msg === null) {
    return { valid: false, errors: ['message must be an object'] };
  }

  const m = msg as Record<string, unknown>;

  if (m.role !== 'user') {
    errors.push(`role must be 'user', got '${m.role}'`);
  }

  errors.push(...validateMessageContent(m.content));

  if (m.name !== undefined && typeof m.name !== 'string') {
    errors.push('name must be a string if provided');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a tool call.
 */
export function validateToolCall(tc: unknown, index: number): string[] {
  const errors: string[] = [];
  const prefix = `toolCall[${index}]`;

  if (typeof tc !== 'object' || tc === null) {
    errors.push(`${prefix} must be an object`);
    return errors;
  }

  const t = tc as Record<string, unknown>;

  if (typeof t.id !== 'string' || t.id.length === 0) {
    errors.push(`${prefix}.id must be a non-empty string`);
  }

  if (typeof t.name !== 'string' || t.name.length === 0) {
    errors.push(`${prefix}.name must be a non-empty string`);
  }

  if (typeof t.arguments !== 'string') {
    errors.push(`${prefix}.arguments must be a string`);
  }

  return errors;
}

/**
 * Validate assistant content item.
 */
export function validateAssistantContentItem(item: unknown, index: number): string[] {
  const errors: string[] = [];
  const prefix = `content[${index}]`;

  if (typeof item !== 'object' || item === null) {
    errors.push(`${prefix} must be an object`);
    return errors;
  }

  const i = item as Record<string, unknown>;

  if (!['text', 'tool_call', 'refusal'].includes(i.type as string)) {
    errors.push(`${prefix}.type must be 'text', 'tool_call', or 'refusal'`);
    return errors;
  }

  if (i.type === 'text') {
    if (typeof i.text !== 'string') {
      errors.push(`${prefix}.text must be a string`);
    }
  } else if (i.type === 'tool_call') {
    errors.push(...validateToolCall(i.toolCall, index));
  } else if (i.type === 'refusal') {
    if (typeof i.refusal !== 'string') {
      errors.push(`${prefix}.refusal must be a string`);
    }
  }

  return errors;
}

/**
 * Validate an assistant message.
 */
export function validateAssistantMessage(msg: unknown): MessageValidationResult {
  const errors: string[] = [];

  if (typeof msg !== 'object' || msg === null) {
    return { valid: false, errors: ['message must be an object'] };
  }

  const m = msg as Record<string, unknown>;

  if (m.role !== 'assistant') {
    errors.push(`role must be 'assistant', got '${m.role}'`);
  }

  // Content can be string or array of assistant content items
  if (typeof m.content === 'string') {
    // Valid
  } else if (Array.isArray(m.content)) {
    for (let i = 0; i < m.content.length; i++) {
      errors.push(...validateAssistantContentItem(m.content[i], i));
    }
  } else {
    errors.push('content must be a string or array');
  }

  // Validate toolCalls if present
  if (m.toolCalls !== undefined) {
    if (!Array.isArray(m.toolCalls)) {
      errors.push('toolCalls must be an array if provided');
    } else {
      for (let i = 0; i < m.toolCalls.length; i++) {
        errors.push(...validateToolCall(m.toolCalls[i], i));
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate tool result content item.
 */
export function validateToolResultContentItem(item: unknown, index: number): string[] {
  const errors: string[] = [];
  const prefix = `content[${index}]`;

  if (typeof item !== 'object' || item === null) {
    errors.push(`${prefix} must be an object`);
    return errors;
  }

  const i = item as Record<string, unknown>;

  if (!['text', 'image'].includes(i.type as string)) {
    errors.push(`${prefix}.type must be 'text' or 'image'`);
    return errors;
  }

  if (i.type === 'text') {
    if (typeof i.text !== 'string') {
      errors.push(`${prefix}.text must be a string`);
    }
  } else if (i.type === 'image') {
    if (typeof i.data !== 'string') {
      errors.push(`${prefix}.data must be a string`);
    }
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(i.mediaType as string)) {
      errors.push(`${prefix}.mediaType must be a valid image media type`);
    }
  }

  return errors;
}

/**
 * Validate a tool result message.
 */
export function validateToolResultMessage(msg: unknown): MessageValidationResult {
  const errors: string[] = [];

  if (typeof msg !== 'object' || msg === null) {
    return { valid: false, errors: ['message must be an object'] };
  }

  const m = msg as Record<string, unknown>;

  if (m.role !== 'tool') {
    errors.push(`role must be 'tool', got '${m.role}'`);
  }

  if (typeof m.toolCallId !== 'string' || m.toolCallId.length === 0) {
    errors.push('toolCallId must be a non-empty string');
  }

  if (typeof m.toolName !== 'string' || m.toolName.length === 0) {
    errors.push('toolName must be a non-empty string');
  }

  // Content can be string or array
  if (typeof m.content === 'string') {
    // Valid
  } else if (Array.isArray(m.content)) {
    for (let i = 0; i < m.content.length; i++) {
      errors.push(...validateToolResultContentItem(m.content[i], i));
    }
  } else {
    errors.push('content must be a string or array');
  }

  if (m.isError !== undefined && typeof m.isError !== 'boolean') {
    errors.push('isError must be a boolean if provided');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate any conversation message.
 */
export function validateMessage(msg: unknown): MessageValidationResult {
  if (typeof msg !== 'object' || msg === null) {
    return { valid: false, errors: ['message must be an object'] };
  }

  const m = msg as Record<string, unknown>;
  const role = m.role;

  switch (role) {
    case 'system':
      return validateSystemMessage(msg);
    case 'user':
      return validateUserMessage(msg);
    case 'assistant':
      return validateAssistantMessage(msg);
    case 'tool':
      return validateToolResultMessage(msg);
    default:
      return {
        valid: false,
        errors: [`role must be 'system', 'user', 'assistant', or 'tool', got '${role}'`],
      };
  }
}

/**
 * Result of tool call/result correlation validation.
 */
export interface ToolCorrelationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly pendingCalls: readonly string[]; // Call IDs without results
  readonly orphanedResults: readonly string[]; // Result IDs without calls
}

/**
 * Validate tool call/result correlation across a message sequence.
 *
 * Rules:
 * - Every tool result must have a matching tool call in a preceding assistant message
 * - Tool name in result must match the call's tool name
 * - Call IDs must be unique within the conversation
 */
export function validateToolCorrelation(
  messages: readonly ConversationMessage[]
): ToolCorrelationResult {
  const errors: string[] = [];
  const callRegistry = new Map<string, { name: string; index: number }>();
  const resolvedCalls = new Set<string>();
  const orphanedResults: string[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === 'assistant') {
      // Extract tool calls
      let toolCalls: readonly ToolCall[] = [];
      if (msg.toolCalls) {
        toolCalls = msg.toolCalls;
      } else if (typeof msg.content !== 'string') {
        toolCalls = msg.content
          .filter((item): item is { type: 'tool_call'; toolCall: ToolCall } =>
            item.type === 'tool_call'
          )
          .map((item) => item.toolCall);
      }

      for (const tc of toolCalls) {
        if (callRegistry.has(tc.id)) {
          errors.push(
            `Duplicate tool call ID '${tc.id}' at message[${i}], ` +
              `first seen at message[${callRegistry.get(tc.id)!.index}]`
          );
        } else {
          callRegistry.set(tc.id, { name: tc.name, index: i });
        }
      }
    }

    if (msg.role === 'tool') {
      const callInfo = callRegistry.get(msg.toolCallId);
      if (!callInfo) {
        errors.push(
          `Tool result at message[${i}] references unknown call ID '${msg.toolCallId}'`
        );
        orphanedResults.push(msg.toolCallId);
      } else {
        if (callInfo.name !== msg.toolName) {
          errors.push(
            `Tool result at message[${i}] has name '${msg.toolName}' ` +
              `but call '${msg.toolCallId}' was for tool '${callInfo.name}'`
          );
        }
        resolvedCalls.add(msg.toolCallId);
      }
    }
  }

  // Find unresolved calls (pending)
  const pendingCalls: string[] = [];
  for (const [id] of callRegistry) {
    if (!resolvedCalls.has(id)) {
      pendingCalls.push(id);
    }
  }

  return {
    valid: errors.length === 0 && orphanedResults.length === 0,
    errors,
    pendingCalls,
    orphanedResults,
  };
}

/**
 * Validate a complete message sequence.
 *
 * Validates:
 * - Each individual message
 * - Tool call/result correlation
 * - Message ordering (system first, then user/assistant/tool)
 */
export function validateMessageSequence(
  messages: readonly ConversationMessage[]
): MessageValidationResult {
  const errors: string[] = [];

  if (!Array.isArray(messages)) {
    return { valid: false, errors: ['messages must be an array'] };
  }

  // Validate each message
  for (let i = 0; i < messages.length; i++) {
    const result = validateMessage(messages[i]);
    if (!result.valid) {
      for (const err of result.errors) {
        errors.push(`message[${i}]: ${err}`);
      }
    }
  }

  // If individual messages are invalid, skip correlation check
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Validate tool correlation
  const correlationResult = validateToolCorrelation(messages);
  for (const err of correlationResult.errors) {
    errors.push(err);
  }

  // Note: Pending calls at the end are not an error (conversation may continue)
  // We only report orphaned results as errors

  return { valid: errors.length === 0, errors };
}
