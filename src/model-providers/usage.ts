/**
 * Usage metadata types for provider responses.
 *
 * Task 3.3a: Represent each usage field independently as known or unknown.
 *
 * Key principles:
 * - Provider-observed, locally estimated, and reserved usage are separate values
 * - Never replace unknown values with zero
 * - Never report an estimate as observed usage
 * - Each field can be known, unknown, or not applicable
 */

/**
 * A usage value that is known (reported by provider or measured locally).
 */
export interface KnownUsageValue {
  readonly known: true;
  readonly value: number;
}

/**
 * A usage value that is unknown (not reported or not measurable).
 */
export interface UnknownUsageValue {
  readonly known: false;
  /**
   * Optional reason why the value is unknown.
   */
  readonly reason?: UsageUnknownReason;
}

/**
 * Reasons why a usage value may be unknown.
 */
export type UsageUnknownReason =
  | 'not_reported'      // Provider didn't include this field
  | 'not_applicable'    // This metric doesn't apply (e.g., no reasoning tokens for non-reasoning model)
  | 'request_failed'    // Request failed before usage could be determined
  | 'cancelled'         // Request was cancelled
  | 'timed_out'         // Request timed out
  | 'unknown';          // Unknown reason

/**
 * A usage field that can be known or unknown.
 */
export type UsageValue = KnownUsageValue | UnknownUsageValue;

/**
 * Type guard for known usage value.
 */
export function isKnownUsage(value: UsageValue): value is KnownUsageValue {
  return value.known === true;
}

/**
 * Type guard for unknown usage value.
 */
export function isUnknownUsage(value: UsageValue): value is UnknownUsageValue {
  return value.known === false;
}

/**
 * Create a known usage value.
 */
export function knownUsage(value: number): KnownUsageValue {
  return { known: true, value };
}

/**
 * Create an unknown usage value.
 */
export function unknownUsage(reason?: UsageUnknownReason): UnknownUsageValue {
  return { known: false, reason };
}

/**
 * Provider-observed usage metadata.
 *
 * These values are reported by the provider in their response.
 * They represent actual consumption according to the provider's accounting.
 */
export interface ObservedUsage {
  /**
   * Input tokens reported by provider.
   */
  readonly inputTokens: UsageValue;

  /**
   * Output tokens reported by provider.
   */
  readonly outputTokens: UsageValue;

  /**
   * Total tokens reported by provider.
   * May differ from input + output due to provider-specific accounting.
   */
  readonly totalTokens: UsageValue;

  /**
   * Cached/prompt-cached tokens (if provider reports this).
   */
  readonly cachedTokens: UsageValue;

  /**
   * Reasoning/thinking tokens (if provider reports this).
   */
  readonly reasoningTokens: UsageValue;
}

/**
 * Locally estimated usage.
 *
 * These values are computed locally using conservative estimation.
 * They are NOT provider-verified and may differ from actual usage.
 */
export interface EstimatedUsage {
  /**
   * Estimated input tokens/characters before sending.
   * This is a preflight estimate, not a tokenizer-exact count.
   */
  readonly inputEstimate: UsageValue;

  /**
   * Estimated maximum output tokens requested.
   */
  readonly maxOutputRequested: UsageValue;

  /**
   * Estimation method used.
   */
  readonly method: EstimationMethod;

  /**
   * Safety margin percentage applied to the estimate.
   */
  readonly safetyMarginPercent?: number;
}

/**
 * Methods for estimating token usage.
 */
export type EstimationMethod =
  | 'character_ratio'    // Character count * ratio
  | 'word_count'         // Word count * average tokens per word
  | 'tiktoken'           // OpenAI tiktoken (if available)
  | 'provider_estimate'  // Provider-specific estimation API
  | 'unknown';           // Unknown estimation method

/**
 * Reserved usage for a pending request.
 *
 * Reservations are made before sending a request to ensure budget compliance.
 * They are reconciled against observed usage when the response arrives.
 */
export interface ReservedUsage {
  /**
   * Reserved input tokens (based on estimate + safety margin).
   */
  readonly inputReserved: number;

  /**
   * Reserved output tokens (based on maxTokens request parameter).
   */
  readonly outputReserved: number;

  /**
   * Total reserved (input + output).
   */
  readonly totalReserved: number;

  /**
   * Timestamp when reservation was made.
   */
  readonly reservedAt: string;

  /**
   * Whether this reservation has been reconciled.
   */
  readonly reconciled: boolean;

  /**
   * Reconciliation result if reconciled.
   */
  readonly reconciliation?: ReservationReconciliation;
}

/**
 * Result of reconciling a reservation against observed usage.
 */
export interface ReservationReconciliation {
  /**
   * Actual input tokens used (from provider, or unknown).
   */
  readonly actualInput: UsageValue;

  /**
   * Actual output tokens used (from provider, or unknown).
   */
  readonly actualOutput: UsageValue;

  /**
   * Amount returned to budget (reservation - actual, clamped to 0).
   * Zero if actual is unknown (conservatively keep reservation).
   */
  readonly returnedToBudget: number;

  /**
   * Whether actual exceeded reservation.
   * If true, budget may be negative.
   */
  readonly exceededReservation: boolean;

  /**
   * Timestamp when reconciled.
   */
  readonly reconciledAt: string;
}

/**
 * Complete usage metadata for a request lifecycle.
 *
 * Keeps observed, estimated, and reserved usage as separate fields.
 * Never merges or confuses these different data sources.
 */
export interface RequestUsageMetadata {
  /**
   * Usage observed/reported by the provider.
   * Only populated after a successful response.
   */
  readonly observed?: ObservedUsage;

  /**
   * Locally estimated usage computed before sending.
   */
  readonly estimated?: EstimatedUsage;

  /**
   * Reservation made against budget before sending.
   */
  readonly reserved?: ReservedUsage;

  /**
   * Request attempt number (1-based).
   */
  readonly attemptNumber: number;

  /**
   * Total attempts across all retries.
   */
  readonly totalAttempts: number;

  /**
   * Request duration in milliseconds (actual).
   */
  readonly durationMs?: number;

  /**
   * Whether usage data is complete or partial.
   */
  readonly usageComplete: boolean;
}

/**
 * Create all-unknown observed usage.
 *
 * Used when provider response doesn't include usage data.
 */
export function createUnknownObservedUsage(reason?: UsageUnknownReason): ObservedUsage {
  const unknown = unknownUsage(reason ?? 'not_reported');
  return {
    inputTokens: unknown,
    outputTokens: unknown,
    totalTokens: unknown,
    cachedTokens: unknown,
    reasoningTokens: unknown,
  };
}

/**
 * Create observed usage from known values.
 *
 * Values that are not provided should be passed as undefined.
 */
export function createObservedUsage(values: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}): ObservedUsage {
  return {
    inputTokens: values.inputTokens !== undefined
      ? knownUsage(values.inputTokens)
      : unknownUsage('not_reported'),
    outputTokens: values.outputTokens !== undefined
      ? knownUsage(values.outputTokens)
      : unknownUsage('not_reported'),
    totalTokens: values.totalTokens !== undefined
      ? knownUsage(values.totalTokens)
      : unknownUsage('not_reported'),
    cachedTokens: values.cachedTokens !== undefined
      ? knownUsage(values.cachedTokens)
      : unknownUsage('not_applicable'),
    reasoningTokens: values.reasoningTokens !== undefined
      ? knownUsage(values.reasoningTokens)
      : unknownUsage('not_applicable'),
  };
}

/**
 * Create a reservation from estimated usage.
 */
export function createReservation(
  inputReserved: number,
  outputReserved: number
): ReservedUsage {
  return {
    inputReserved,
    outputReserved,
    totalReserved: inputReserved + outputReserved,
    reservedAt: new Date().toISOString(),
    reconciled: false,
  };
}

/**
 * Reconcile a reservation against observed usage.
 *
 * If observed usage is unknown, conservatively keeps the reservation.
 */
export function reconcileReservation(
  reservation: ReservedUsage,
  observed: ObservedUsage
): ReservedUsage {
  const actualInput = observed.inputTokens;
  const actualOutput = observed.outputTokens;

  // Calculate amount to return to budget
  let returnedToBudget = 0;
  let exceededReservation = false;

  if (isKnownUsage(actualInput) && isKnownUsage(actualOutput)) {
    const actualTotal = actualInput.value + actualOutput.value;
    if (actualTotal < reservation.totalReserved) {
      returnedToBudget = reservation.totalReserved - actualTotal;
    } else if (actualTotal > reservation.totalReserved) {
      exceededReservation = true;
    }
  }
  // If unknown, returnedToBudget stays 0 (conservatively keep reservation)

  return {
    ...reservation,
    reconciled: true,
    reconciliation: {
      actualInput,
      actualOutput,
      returnedToBudget,
      exceededReservation,
      reconciledAt: new Date().toISOString(),
    },
  };
}

/**
 * Get numeric value from UsageValue, returning undefined if unknown.
 */
export function getUsageValueOrUndefined(value: UsageValue): number | undefined {
  return isKnownUsage(value) ? value.value : undefined;
}

/**
 * Safely add two usage values.
 * Returns unknown if either input is unknown.
 */
export function addUsageValues(a: UsageValue, b: UsageValue): UsageValue {
  if (isKnownUsage(a) && isKnownUsage(b)) {
    return knownUsage(a.value + b.value);
  }
  return unknownUsage('not_reported');
}

/**
 * Check if observed usage has all required fields known.
 */
export function hasCompleteUsage(observed: ObservedUsage): boolean {
  return (
    isKnownUsage(observed.inputTokens) &&
    isKnownUsage(observed.outputTokens) &&
    isKnownUsage(observed.totalTokens)
  );
}
