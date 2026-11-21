/**
 * Opaque provider continuation state.
 *
 * Implements Task 3.2 requirement 5: Opaque continuation state preservation.
 *
 * Key principles:
 * - Continuation state is opaque bytes/structured payload
 * - Only the creating adapter may interpret it
 * - Preserve exactly across subsequent turns
 * - Reject or clear when switching to incompatible provider/model
 * - Never parse, edit, reorder, truncate, log, expose, or persist by default
 *
 * This may carry:
 * - Gemini thought signatures
 * - Anthropic thinking/redacted-thinking blocks
 * - OpenAI encrypted reasoning items
 * - Future provider-specific state
 *
 * SECURITY: The payload is stored in a JavaScript private field (#payload)
 * and is NOT accessible via JSON.stringify, util.inspect, or String().
 * Access requires explicit identity verification via getPayload().
 */

import type { ProviderIdentity } from './types.js';

/**
 * Custom inspect symbol for Node.js util.inspect.
 */
const customInspectSymbol = Symbol.for('nodejs.util.inspect.custom');

/**
 * Result of continuation state compatibility check.
 */
export interface ContinuationCompatibility {
  /**
   * Whether the state is compatible with the target identity.
   */
  readonly compatible: boolean;

  /**
   * Reason for incompatibility if not compatible.
   */
  readonly reason?: ContinuationIncompatibilityReason;
}

/**
 * Reasons for continuation state incompatibility.
 */
export type ContinuationIncompatibilityReason =
  | 'provider_mismatch'
  | 'adapter_mismatch'
  | 'model_mismatch'
  | 'state_expired'
  | 'state_invalid';

/**
 * Result of payload access attempt.
 */
export interface PayloadAccessResult {
  /**
   * Whether access was granted.
   */
  readonly granted: boolean;

  /**
   * The payload if access was granted.
   */
  readonly payload?: unknown;

  /**
   * Reason for denial if access was not granted.
   */
  readonly reason?: ContinuationIncompatibilityReason;
}

/**
 * Read-only interface for continuation state.
 * Does NOT expose the payload - use getPayload() with identity verification.
 */
export interface ContinuationState {
  /**
   * Provider identity that created this state.
   * State is only valid when passed to the same provider/adapter/model.
   */
  readonly identity: Readonly<ProviderIdentity>;

  /**
   * Creation timestamp (ISO 8601).
   * For diagnostics only; not part of the opaque state.
   */
  readonly createdAt: string;

  /**
   * Optional version marker for format evolution.
   * Adapters may use this to handle format changes.
   */
  readonly version?: number;

  /**
   * Get the opaque payload with identity verification.
   *
   * @param requestingIdentity - The identity requesting access
   * @returns Access result with payload if granted
   */
  getPayload(requestingIdentity: ProviderIdentity): PayloadAccessResult;
}

/**
 * Secure continuation state container.
 *
 * Uses JavaScript private field (#payload) to prevent accidental exposure.
 * - JSON.stringify returns only safe identity information
 * - util.inspect returns only safe identity information
 * - String() returns only safe identity information
 * - Payload access requires identity verification via getPayload()
 */
export class SecureContinuationState implements ContinuationState {
  /**
   * The opaque payload stored in a private field.
   * Cannot be accessed via bracket notation, JSON.stringify, or util.inspect.
   */
  readonly #payload: unknown;

  /**
   * Provider identity that created this state.
   */
  readonly identity: Readonly<ProviderIdentity>;

  /**
   * Creation timestamp (ISO 8601).
   */
  readonly createdAt: string;

  /**
   * Optional version marker.
   */
  readonly version?: number;

  constructor(
    identity: ProviderIdentity,
    payload: unknown,
    version?: number
  ) {
    this.identity = Object.freeze({ ...identity });
    this.#payload = payload;
    this.createdAt = new Date().toISOString();
    if (version !== undefined) {
      this.version = version;
    }
  }

  /**
   * Get the opaque payload with identity verification.
   *
   * The requesting identity must match the creating identity exactly
   * (providerId, adapterType, and modelId must all match).
   *
   * @param requestingIdentity - The identity requesting access
   * @returns Access result with payload if granted
   */
  getPayload(requestingIdentity: ProviderIdentity): PayloadAccessResult {
    // Verify provider ID
    if (requestingIdentity.providerId !== this.identity.providerId) {
      return {
        granted: false,
        reason: 'provider_mismatch',
      };
    }

    // Verify adapter type
    if (requestingIdentity.adapterType !== this.identity.adapterType) {
      return {
        granted: false,
        reason: 'adapter_mismatch',
      };
    }

    // Verify model ID
    if (requestingIdentity.modelId !== this.identity.modelId) {
      return {
        granted: false,
        reason: 'model_mismatch',
      };
    }

    // Identity matches - grant access
    return {
      granted: true,
      payload: this.#payload,
    };
  }

  /**
   * Safe JSON serialization - never includes payload.
   */
  toJSON(): object {
    return {
      _type: 'ContinuationState',
      _redacted: true,
      identity: this.identity,
      createdAt: this.createdAt,
      ...(this.version !== undefined ? { version: this.version } : {}),
    };
  }

  /**
   * Safe string representation - never includes payload.
   */
  toString(): string {
    return describeContinuationState(this);
  }

  /**
   * Safe inspection for Node.js util.inspect - never includes payload.
   */
  [customInspectSymbol](): string {
    return describeContinuationState(this);
  }
}

/**
 * Check if continuation state is compatible with a target provider identity.
 *
 * Per Task 3.2 requirement 5: Only the matching adapter may interpret the state.
 * If the provider, adapter type, or model differs, the state must be rejected.
 *
 * @param state - The continuation state to check
 * @param targetIdentity - The target provider identity
 * @returns Compatibility result
 */
export function checkContinuationCompatibility(
  state: ContinuationState,
  targetIdentity: ProviderIdentity
): ContinuationCompatibility {
  // Check provider ID
  if (state.identity.providerId !== targetIdentity.providerId) {
    return {
      compatible: false,
      reason: 'provider_mismatch',
    };
  }

  // Check adapter type
  if (state.identity.adapterType !== targetIdentity.adapterType) {
    return {
      compatible: false,
      reason: 'adapter_mismatch',
    };
  }

  // Check model ID
  if (state.identity.modelId !== targetIdentity.modelId) {
    return {
      compatible: false,
      reason: 'model_mismatch',
    };
  }

  return { compatible: true };
}

/**
 * Create a new secure continuation state container.
 *
 * This is called by adapters when they receive continuation-requiring
 * content from the provider (thinking blocks, reasoning items, etc.).
 *
 * @param identity - Provider identity that created this state
 * @param payload - Opaque payload from the provider
 * @param version - Optional version marker
 * @returns New secure continuation state container
 */
export function createContinuationState(
  identity: ProviderIdentity,
  payload: unknown,
  version?: number
): SecureContinuationState {
  return new SecureContinuationState(identity, payload, version);
}

/**
 * Sealed reference to continuation state.
 *
 * Used in conversation context to reference continuation state without
 * exposing the actual opaque payload. The reference is an opaque string
 * that maps to the actual state in the conversation's state registry.
 */
export type ContinuationRef = string;

/**
 * Generate a new continuation reference.
 * Uses a random identifier to prevent guessing.
 */
export function generateContinuationRef(): ContinuationRef {
  // Use timestamp + random suffix for uniqueness
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `cont_${timestamp}_${random}`;
}

/**
 * Continuation state registry for a conversation.
 *
 * Maps continuation references to their opaque state containers.
 * This allows messages to reference state without containing it.
 */
export class ContinuationStateRegistry {
  private readonly states = new Map<ContinuationRef, ContinuationState>();

  /**
   * Register a continuation state and return its reference.
   */
  register(state: ContinuationState): ContinuationRef {
    const ref = generateContinuationRef();
    this.states.set(ref, state);
    return ref;
  }

  /**
   * Get a continuation state by reference.
   */
  get(ref: ContinuationRef): ContinuationState | undefined {
    return this.states.get(ref);
  }

  /**
   * Check if a reference exists.
   */
  has(ref: ContinuationRef): boolean {
    return this.states.has(ref);
  }

  /**
   * Remove a continuation state by reference.
   * Call this when the state is no longer needed.
   */
  remove(ref: ContinuationRef): boolean {
    return this.states.delete(ref);
  }

  /**
   * Clear all continuation states.
   * Call this when starting a new conversation or on provider switch.
   */
  clear(): void {
    this.states.clear();
  }

  /**
   * Get the number of registered states.
   */
  get size(): number {
    return this.states.size;
  }

  /**
   * Clear states that don't match the target identity.
   * Returns the number of states cleared.
   */
  clearIncompatible(targetIdentity: ProviderIdentity): number {
    let cleared = 0;
    for (const [ref, state] of this.states) {
      const { compatible } = checkContinuationCompatibility(state, targetIdentity);
      if (!compatible) {
        this.states.delete(ref);
        cleared++;
      }
    }
    return cleared;
  }
}

/**
 * Continuation handling policy for requests.
 */
export type ContinuationPolicy =
  | 'require' // Fail if continuation state is missing or incompatible
  | 'prefer' // Use if available, proceed without if not
  | 'ignore' // Ignore continuation state even if available
  | 'clear'; // Clear existing state and start fresh

/**
 * Describe continuation state for safe logging.
 *
 * Returns a description that includes identity information but
 * never includes the opaque payload.
 */
export function describeContinuationState(state: ContinuationState): string {
  const { identity, createdAt, version } = state;
  const parts = [
    `provider=${identity.providerId}`,
    `adapter=${identity.adapterType}`,
    `model=${identity.modelId}`,
    `created=${createdAt}`,
  ];
  if (version !== undefined) {
    parts.push(`version=${version}`);
  }
  return `ContinuationState(${parts.join(', ')})`;
}
