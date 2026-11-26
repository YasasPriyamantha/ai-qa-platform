/**
 * Budget configuration and checking.
 *
 * Task 3.3a: Platform-scoped budget configuration with explicit approved limits.
 *
 * Key principles:
 * - Budgets are platform-scoped, non-secret
 * - Require explicit approved limits for all budget dimensions
 * - If no approved budget configured, no external request allowed
 * - Cost estimates use dated pricing source; unknown if unavailable
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LifecycleResult } from './lifecycle.js';
import { getUsageValueOrUndefined, type UsageValue } from './usage.js';

/**
 * Budget configuration for AI provider usage.
 *
 * All limits are required - no defaults or implicit unlimited values.
 */
export interface BudgetConfig {
  /**
   * Maximum total requests allowed in the budget window.
   */
  readonly maxTotalRequests: number;

  /**
   * Maximum input tokens per individual request.
   */
  readonly maxInputTokensPerRequest: number;

  /**
   * Maximum output tokens per individual request.
   */
  readonly maxOutputTokensPerRequest: number;

  /**
   * Maximum cumulative input tokens across all requests.
   */
  readonly maxCumulativeInputTokens: number;

  /**
   * Maximum cumulative output tokens across all requests.
   */
  readonly maxCumulativeOutputTokens: number;

  /**
   * Budget window configuration.
   */
  readonly window: BudgetWindow;

  /**
   * Optional cost estimate configuration.
   */
  readonly costEstimate?: CostEstimateConfig;

  /**
   * Policy for handling unknown/stale pricing when monetary limits are set.
   * Default: fail-closed (deny when pricing unknown)
   */
  readonly unknownPricingPolicy?: UnknownPricingPolicy;
}

/**
 * Budget window defines the time period for budget limits.
 */
export interface BudgetWindow {
  /**
   * Type of window.
   */
  readonly type: 'rolling' | 'fixed';

  /**
   * Duration in hours for rolling window, or period for fixed.
   */
  readonly durationHours: number;

  /**
   * Start time for fixed windows (ISO 8601).
   * Not used for rolling windows.
   */
  readonly startTime?: string;
}

/**
 * Cost estimate configuration with dated pricing.
 */
export interface CostEstimateConfig {
  /**
   * Price per 1000 input tokens in USD.
   */
  readonly inputPricePerKToken: number;

  /**
   * Price per 1000 output tokens in USD.
   */
  readonly outputPricePerKToken: number;

  /**
   * Source of the pricing data.
   */
  readonly pricingSource: string;

  /**
   * Date when pricing was last verified (ISO 8601 date).
   */
  readonly pricingDate: string;

  /**
   * Model ID this pricing applies to.
   */
  readonly modelId: string;

  /**
   * Maximum estimated cost allowed (USD).
   * This is an ESTIMATE, not a guaranteed cap.
   */
  readonly maxEstimatedCostUsd?: number;
}

/**
 * Result of a budget check.
 */
export interface BudgetCheckResult {
  /**
   * Whether the request is allowed.
   */
  readonly allowed: boolean;

  /**
   * Reason if not allowed.
   */
  readonly reason?: BudgetDenialReason;

  /**
   * Detailed message.
   */
  readonly message: string;

  /**
   * Current budget state at time of check.
   */
  readonly currentState?: BudgetState;

  /**
   * Estimated cost if allowed and pricing available.
   * This is an ESTIMATE based on dated pricing, not guaranteed.
   */
  readonly estimatedCost?: CostEstimate;
}

/**
 * Reasons a request may be denied due to budget.
 */
export type BudgetDenialReason =
  | 'NO_BUDGET_CONFIGURED'
  | 'REQUEST_COUNT_EXCEEDED'
  | 'INPUT_TOKENS_PER_REQUEST_EXCEEDED'
  | 'OUTPUT_TOKENS_PER_REQUEST_EXCEEDED'
  | 'CUMULATIVE_INPUT_EXCEEDED'
  | 'CUMULATIVE_OUTPUT_EXCEEDED'
  | 'ESTIMATED_COST_EXCEEDED'
  | 'BUDGET_WINDOW_EXPIRED'
  | 'PRICING_UNKNOWN'
  | 'PRICING_STALE';

/**
 * Configuration for monetary budget policy when pricing is unknown.
 */
export interface UnknownPricingPolicy {
  /**
   * What to do when a monetary limit is set but pricing is unavailable.
   * - 'deny': Block the request (fail-closed)
   * - 'warn_allow': Warn but allow the request (skips cost check)
   */
  readonly onUnknownPricing: 'deny' | 'warn_allow';

  /**
   * Maximum age of pricing data in days before it's considered stale.
   * Default: 90 days
   */
  readonly pricingStalenessThresholdDays: number;

  /**
   * What to do when pricing data is stale.
   * - 'deny': Block the request
   * - 'warn_allow': Warn but allow the request (uses stale pricing)
   */
  readonly onStalePricing: 'deny' | 'warn_allow';
}

/**
 * Default policy for unknown/stale pricing: fail-closed.
 */
export const DEFAULT_UNKNOWN_PRICING_POLICY: UnknownPricingPolicy = {
  onUnknownPricing: 'deny',
  pricingStalenessThresholdDays: 90,
  onStalePricing: 'warn_allow',
};

/**
 * Current state of budget consumption.
 */
export interface BudgetState {
  /**
   * Number of requests made.
   */
  readonly requestCount: number;

  /**
   * Cumulative input tokens used.
   */
  readonly cumulativeInputTokens: number;

  /**
   * Cumulative output tokens used.
   */
  readonly cumulativeOutputTokens: number;

  /**
   * When the budget window started.
   */
  readonly windowStart: string;

  /**
   * When the budget window ends (for display).
   */
  readonly windowEnd: string;
}

/**
 * Cost estimate for a request.
 */
export interface CostEstimate {
  /**
   * Estimated input cost in USD.
   */
  readonly inputCostUsd: number;

  /**
   * Estimated output cost in USD.
   */
  readonly outputCostUsd: number;

  /**
   * Total estimated cost in USD.
   */
  readonly totalCostUsd: number;

  /**
   * Cumulative estimated cost after this request.
   */
  readonly cumulativeCostUsd: number;

  /**
   * Whether this is an estimate (always true).
   * Cost estimates are based on dated pricing and may not match actual bills.
   */
  readonly isEstimate: true;

  /**
   * Pricing date used for estimate.
   */
  readonly pricingDate: string;

  /**
   * Pricing source.
   */
  readonly pricingSource: string;
}

/**
 * Request for a budget reservation.
 */
export interface ReservationRequest {
  /**
   * Estimated input tokens for the request.
   */
  readonly estimatedInputTokens: number;

  /**
   * Maximum output tokens requested.
   */
  readonly maxOutputTokens: number;

  /**
   * Platform request ID for correlation.
   */
  readonly platformRequestId: string;
}

/**
 * Result of a reservation attempt.
 */
export interface ReservationResult {
  /**
   * Whether reservation succeeded.
   */
  readonly success: boolean;

  /**
   * Reservation ID if successful.
   */
  readonly reservationId?: string;

  /**
   * Budget check that was performed.
   */
  readonly check: BudgetCheckResult;

  /**
   * Tokens reserved (input + output).
   */
  readonly tokensReserved?: number;
}

/**
 * No budget configured error.
 *
 * Used to indicate that AI requests cannot proceed without explicit budget approval.
 */
export class NoBudgetConfiguredError extends Error {
  readonly code = 'NO_BUDGET_CONFIGURED' as const;

  constructor() {
    super(
      'No budget configured. AI provider requests require explicit approved budget limits. ' +
      'Configure a budget in config/ai-budget.json.'
    );
    this.name = 'NoBudgetConfiguredError';
  }
}

/**
 * Budget exceeded error.
 */
export class BudgetExceededError extends Error {
  readonly code: BudgetDenialReason;
  readonly checkResult: BudgetCheckResult;

  constructor(checkResult: BudgetCheckResult) {
    super(checkResult.message);
    this.name = 'BudgetExceededError';
    this.code = checkResult.reason ?? 'REQUEST_COUNT_EXCEEDED';
    this.checkResult = checkResult;
  }
}

/**
 * Check if a budget configuration is valid and complete.
 *
 * @param config - Budget configuration to validate
 * @returns Array of validation errors, empty if valid
 */
export function validateBudgetConfig(config: unknown): string[] {
  const errors: string[] = [];

  if (typeof config !== 'object' || config === null) {
    errors.push('Budget config must be an object');
    return errors;
  }

  const c = config as Record<string, unknown>;

  // Required number fields
  const numberFields = [
    'maxTotalRequests',
    'maxInputTokensPerRequest',
    'maxOutputTokensPerRequest',
    'maxCumulativeInputTokens',
    'maxCumulativeOutputTokens',
  ] as const;

  for (const field of numberFields) {
    if (typeof c[field] !== 'number' || c[field] <= 0) {
      errors.push(`${field} must be a positive number`);
    }
  }

  // Window validation
  if (typeof c.window !== 'object' || c.window === null) {
    errors.push('window is required');
  } else {
    const window = c.window as Record<string, unknown>;
    if (window.type !== 'rolling' && window.type !== 'fixed') {
      errors.push("window.type must be 'rolling' or 'fixed'");
    }
    if (typeof window.durationHours !== 'number' || window.durationHours <= 0) {
      errors.push('window.durationHours must be a positive number');
    }
  }

  // Optional cost estimate validation
  if (c.costEstimate !== undefined) {
    if (typeof c.costEstimate !== 'object' || c.costEstimate === null) {
      errors.push('costEstimate must be an object if provided');
    } else {
      const cost = c.costEstimate as Record<string, unknown>;
      if (typeof cost.inputPricePerKToken !== 'number' || cost.inputPricePerKToken < 0) {
        errors.push('costEstimate.inputPricePerKToken must be a non-negative number');
      }
      if (typeof cost.outputPricePerKToken !== 'number' || cost.outputPricePerKToken < 0) {
        errors.push('costEstimate.outputPricePerKToken must be a non-negative number');
      }
      if (typeof cost.pricingSource !== 'string' || cost.pricingSource.trim() === '') {
        errors.push('costEstimate.pricingSource must be a non-empty string');
      }
      if (typeof cost.pricingDate !== 'string' || cost.pricingDate.trim() === '') {
        errors.push('costEstimate.pricingDate must be a non-empty string');
      }
      if (typeof cost.modelId !== 'string' || cost.modelId.trim() === '') {
        errors.push('costEstimate.modelId must be a non-empty string');
      }
    }
  }

  return errors;
}

/**
 * Check if pricing data is stale.
 *
 * @param pricingDate - The date when pricing was last verified (ISO 8601)
 * @param thresholdDays - Maximum age in days
 * @param now - Current date (for testing)
 * @returns Object with stale status and age in days
 */
export function isPricingStale(
  pricingDate: string,
  thresholdDays: number,
  now: Date = new Date()
): { stale: boolean; ageDays: number; threshold: number } {
  const pricingTime = new Date(pricingDate).getTime();
  if (isNaN(pricingTime)) {
    // Invalid date is considered extremely stale
    return { stale: true, ageDays: Infinity, threshold: thresholdDays };
  }

  const ageMs = now.getTime() - pricingTime;
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

  return {
    stale: ageDays > thresholdDays,
    ageDays,
    threshold: thresholdDays,
  };
}

/**
 * Check if a monetary limit requires pricing validation.
 *
 * Returns true if the budget has any monetary limit configured.
 */
export function hasMonetaryLimit(budget: BudgetConfig): boolean {
  return budget.costEstimate?.maxEstimatedCostUsd !== undefined;
}

/**
 * Check if a request would fit within budget.
 *
 * @param reservation - The reservation request
 * @param budget - Budget configuration
 * @param state - Current budget state
 * @returns Budget check result
 */
export function checkBudget(
  reservation: ReservationRequest,
  budget: BudgetConfig,
  state: BudgetState
): BudgetCheckResult {
  // Check request count
  if (state.requestCount >= budget.maxTotalRequests) {
    return {
      allowed: false,
      reason: 'REQUEST_COUNT_EXCEEDED',
      message: `Request count (${state.requestCount}) has reached limit (${budget.maxTotalRequests})`,
      currentState: state,
    };
  }

  // Check per-request input tokens
  if (reservation.estimatedInputTokens > budget.maxInputTokensPerRequest) {
    return {
      allowed: false,
      reason: 'INPUT_TOKENS_PER_REQUEST_EXCEEDED',
      message: `Estimated input tokens (${reservation.estimatedInputTokens}) exceeds per-request limit (${budget.maxInputTokensPerRequest})`,
      currentState: state,
    };
  }

  // Check per-request output tokens
  if (reservation.maxOutputTokens > budget.maxOutputTokensPerRequest) {
    return {
      allowed: false,
      reason: 'OUTPUT_TOKENS_PER_REQUEST_EXCEEDED',
      message: `Requested output tokens (${reservation.maxOutputTokens}) exceeds per-request limit (${budget.maxOutputTokensPerRequest})`,
      currentState: state,
    };
  }

  // Check cumulative input tokens
  const projectedInput = state.cumulativeInputTokens + reservation.estimatedInputTokens;
  if (projectedInput > budget.maxCumulativeInputTokens) {
    return {
      allowed: false,
      reason: 'CUMULATIVE_INPUT_EXCEEDED',
      message: `Projected cumulative input (${projectedInput}) would exceed limit (${budget.maxCumulativeInputTokens})`,
      currentState: state,
    };
  }

  // Check cumulative output tokens
  const projectedOutput = state.cumulativeOutputTokens + reservation.maxOutputTokens;
  if (projectedOutput > budget.maxCumulativeOutputTokens) {
    return {
      allowed: false,
      reason: 'CUMULATIVE_OUTPUT_EXCEEDED',
      message: `Projected cumulative output (${projectedOutput}) would exceed limit (${budget.maxCumulativeOutputTokens})`,
      currentState: state,
    };
  }

  // Calculate cost estimate if pricing available
  let estimatedCost: CostEstimate | undefined;
  const policy = budget.unknownPricingPolicy ?? DEFAULT_UNKNOWN_PRICING_POLICY;

  // INVARIANT: If a monetary limit is configured and pricing is unknown or stale,
  // the request is DENIED. No configuration value may bypass this rule (DEC-038).
  if (hasMonetaryLimit(budget)) {
    if (!budget.costEstimate) {
      // Monetary limit set but no pricing data - DENY unconditionally
      return {
        allowed: false,
        reason: 'PRICING_UNKNOWN',
        message: 'Monetary limit is configured but no pricing data is available. ' +
          'Add costEstimate with valid pricing or remove maxEstimatedCostUsd.',
        currentState: state,
      };
    }

    // Check pricing staleness - mandatory check when monetary limit exists
    const stalenessCheck = isPricingStale(
      budget.costEstimate.pricingDate,
      policy.pricingStalenessThresholdDays
    );

    if (stalenessCheck.stale) {
      // Stale pricing with monetary limit - DENY unconditionally
      // This is NOT configurable; policy.onStalePricing is ignored here
      return {
        allowed: false,
        reason: 'PRICING_STALE',
        message: `Pricing data is ${stalenessCheck.ageDays} days old (threshold: ${stalenessCheck.threshold} days). ` +
          `Update pricing in costEstimate.pricingDate to continue using monetary limits.`,
        currentState: state,
      };
    }
  }

  if (budget.costEstimate) {

    const inputCost = (reservation.estimatedInputTokens / 1000) * budget.costEstimate.inputPricePerKToken;
    const outputCost = (reservation.maxOutputTokens / 1000) * budget.costEstimate.outputPricePerKToken;
    const totalCost = inputCost + outputCost;

    // Calculate cumulative cost
    const previousCumulativeInput = (state.cumulativeInputTokens / 1000) * budget.costEstimate.inputPricePerKToken;
    const previousCumulativeOutput = (state.cumulativeOutputTokens / 1000) * budget.costEstimate.outputPricePerKToken;
    const cumulativeCost = previousCumulativeInput + previousCumulativeOutput + totalCost;

    estimatedCost = {
      inputCostUsd: inputCost,
      outputCostUsd: outputCost,
      totalCostUsd: totalCost,
      cumulativeCostUsd: cumulativeCost,
      isEstimate: true,
      pricingDate: budget.costEstimate.pricingDate,
      pricingSource: budget.costEstimate.pricingSource,
    };

    // Check cost limit if configured
    if (budget.costEstimate.maxEstimatedCostUsd !== undefined) {
      if (cumulativeCost > budget.costEstimate.maxEstimatedCostUsd) {
        return {
          allowed: false,
          reason: 'ESTIMATED_COST_EXCEEDED',
          message: `Estimated cumulative cost ($${cumulativeCost.toFixed(4)}) would exceed limit ($${budget.costEstimate.maxEstimatedCostUsd})`,
          currentState: state,
          estimatedCost,
        };
      }
    }
  }

  return {
    allowed: true,
    message: 'Request is within budget',
    currentState: state,
    estimatedCost,
  };
}

/**
 * Calculate the end time for a budget window.
 */
export function calculateWindowEnd(window: BudgetWindow, windowStart: string): string {
  const start = new Date(windowStart);
  const end = new Date(start.getTime() + window.durationHours * 60 * 60 * 1000);
  return end.toISOString();
}

/**
 * Check if a budget window has expired.
 */
export function isWindowExpired(window: BudgetWindow, windowStart: string, now: Date = new Date()): boolean {
  const end = new Date(calculateWindowEnd(window, windowStart));
  return now >= end;
}

/**
 * Create an initial budget state.
 */
export function createInitialBudgetState(window: BudgetWindow): BudgetState {
  const now = new Date();
  let windowStart: string;

  if (window.type === 'fixed' && window.startTime) {
    windowStart = window.startTime;
  } else {
    windowStart = now.toISOString();
  }

  return {
    requestCount: 0,
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    windowStart,
    windowEnd: calculateWindowEnd(window, windowStart),
  };
}

/**
 * Count one executeRequest() call in a per-run, in-memory budget state
 * (DEC-039; the usage ledger is not used). executeRequest() does not update
 * the state itself. A request refused by the gate (no attempt made) is not
 * counted. Unknown output usage counts as the full reservation, never as zero.
 */
export function countRunRequest(
  state: BudgetState,
  outcome: Pick<LifecycleResult, 'finalAttemptNumber' | 'usageMetadata'>,
  maxOutputTokens: number
): BudgetState {
  if (outcome.finalAttemptNumber === 0) return state;
  const known = (value: UsageValue | undefined) => (value ? getUsageValueOrUndefined(value) : undefined);
  const observed = outcome.usageMetadata.observed;
  return {
    ...state,
    requestCount: state.requestCount + 1,
    cumulativeInputTokens: state.cumulativeInputTokens + (known(observed?.inputTokens) ?? 0),
    cumulativeOutputTokens: state.cumulativeOutputTokens + (known(observed?.outputTokens) ?? maxOutputTokens),
  };
}

/**
 * Generate a unique reservation ID.
 */
export function generateReservationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `rsv_${timestamp}_${random}`;
}

/**
 * Error codes for budget configuration loading.
 */
export type BudgetConfigErrorCode =
  | 'BUDGET_NOT_CONFIGURED'
  | 'BUDGET_INVALID';

/**
 * Error returned when budget configuration cannot be loaded.
 */
export interface BudgetConfigError {
  readonly code: BudgetConfigErrorCode;
  readonly message: string;
  readonly details?: string[];
}

/**
 * Result of loading budget configuration.
 */
export type BudgetConfigResult =
  | { readonly success: true; readonly config: BudgetConfig }
  | { readonly success: false; readonly error: BudgetConfigError };

/**
 * Default path for budget configuration.
 * This is the ONLY location for budget configuration.
 * The .qa-platform/ directory is reserved for runtime data (usage ledger),
 * not configuration.
 */
export const DEFAULT_BUDGET_CONFIG_PATH = 'config/ai-budget.json' as const;

/**
 * @deprecated Use DEFAULT_BUDGET_CONFIG_PATH instead.
 * Retained for backward compatibility but only contains the single valid path.
 */
export const DEFAULT_BUDGET_CONFIG_PATHS = [
  DEFAULT_BUDGET_CONFIG_PATH,
] as const;

/**
 * Budget configuration load error.
 *
 * Used to indicate that budget configuration could not be loaded.
 */
export class BudgetConfigLoadError extends Error {
  readonly code: BudgetConfigErrorCode;
  readonly details?: string[];

  constructor(code: BudgetConfigErrorCode, message: string, details?: string[]) {
    super(message);
    this.name = 'BudgetConfigLoadError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Load budget configuration from a specific file path.
 *
 * @param path - Path to the budget configuration file
 * @returns Budget configuration result
 */
export function loadBudgetConfigFromPath(path: string): BudgetConfigResult {
  if (!existsSync(path)) {
    return {
      success: false,
      error: {
        code: 'BUDGET_NOT_CONFIGURED',
        message: `Budget configuration file not found: ${path}`,
      },
    };
  }

  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'BUDGET_NOT_CONFIGURED',
        message: `Failed to read budget configuration: ${(err as Error).message}`,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      success: false,
      error: {
        code: 'BUDGET_INVALID',
        message: 'Budget configuration is not valid JSON',
      },
    };
  }

  const validationErrors = validateBudgetConfig(parsed);
  if (validationErrors.length > 0) {
    return {
      success: false,
      error: {
        code: 'BUDGET_INVALID',
        message: 'Budget configuration is invalid',
        details: validationErrors,
      },
    };
  }

  return {
    success: true,
    config: parsed as BudgetConfig,
  };
}

/**
 * Load budget configuration from the default path.
 *
 * Budget configuration is loaded ONLY from config/ai-budget.json.
 * There is no fallback to .qa-platform/budget.json or any other location.
 *
 * @param baseDir - Base directory to search from (default: current working directory)
 * @returns Budget configuration result
 */
export function loadBudgetConfig(baseDir: string = process.cwd()): BudgetConfigResult {
  const fullPath = join(baseDir, DEFAULT_BUDGET_CONFIG_PATH);
  if (existsSync(fullPath)) {
    return loadBudgetConfigFromPath(fullPath);
  }

  // No config file found
  return {
    success: false,
    error: {
      code: 'BUDGET_NOT_CONFIGURED',
      message: 'No budget configuration found. AI provider requests require explicit approved budget limits.',
      details: [
        `Expected path: ${DEFAULT_BUDGET_CONFIG_PATH}`,
        'Create a budget configuration file at config/ai-budget.json.',
      ],
    },
  };
}

/**
 * Type guard for successful budget config result.
 */
export function isBudgetConfigSuccess(
  result: BudgetConfigResult
): result is { readonly success: true; readonly config: BudgetConfig } {
  return result.success === true;
}

/**
 * Type guard for failed budget config result.
 */
export function isBudgetConfigError(
  result: BudgetConfigResult
): result is { readonly success: false; readonly error: BudgetConfigError } {
  return result.success === false;
}
