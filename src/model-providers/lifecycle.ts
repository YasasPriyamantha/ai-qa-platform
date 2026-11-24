/**
 * Shared request lifecycle service.
 *
 * Task 3.3a: Central orchestration for provider requests.
 *
 * Key principles:
 * - Per-request timeout with caller cancellation using AbortSignal.any()
 * - Bounded retry with RetrySafety classification
 * - Every attempt counted against budget
 * - Single retry owner - adapters must NOT retry
 * - Fail-closed request gate before any network activity
 */

import type { ModelRequest } from './request.js';
import type { ModelResult } from './response.js';
import type { ProviderError, RetrySafety } from './errors.js';
import { ProviderErrors, isDefinitelySafeToRetry, requiresRetryDelay } from './errors.js';
import type { ProviderConfig } from './types.js';
import type { AdapterContext, AdapterResult } from './adapter-interface.js';
import { isAdapterSuccess, globalAdapterRegistry } from './adapter-interface.js';
import type { ObservedUsage, RequestUsageMetadata } from './usage.js';
import { estimateInputSize, calculateOutputReservation, DEFAULT_ESTIMATION_CONFIG, type EstimationConfig } from './estimation.js';
import type { BudgetConfig, BudgetState, ReservationRequest } from './budget.js';
import { checkBudget } from './budget.js';
import type { SecretResolutionContext, ResolvedProviderSecret } from '../provider-secrets/types.js';
import { isPlaceholderValue } from '../provider-secrets/env-parser.js';

/**
 * Configuration for the request lifecycle.
 */
export interface LifecycleConfig {
  /**
   * Maximum retry attempts (including initial attempt).
   * Default: 3
   */
  readonly maxAttempts: number;

  /**
   * Default request timeout in milliseconds.
   * Default: 60000 (60 seconds)
   */
  readonly defaultTimeoutMs: number;

  /**
   * Maximum retry delay in milliseconds.
   * Caps Retry-After headers.
   * Default: 60000 (60 seconds)
   */
  readonly maxRetryDelayMs: number;

  /**
   * Base retry delay for safe retries in milliseconds.
   * Default: 1000 (1 second)
   */
  readonly baseRetryDelayMs: number;

  /**
   * Estimation configuration for input size.
   */
  readonly estimationConfig: EstimationConfig;
}

/**
 * Default lifecycle configuration.
 */
export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  maxAttempts: 3,
  defaultTimeoutMs: 60000,
  maxRetryDelayMs: 60000,
  baseRetryDelayMs: 1000,
  estimationConfig: DEFAULT_ESTIMATION_CONFIG,
};

/**
 * Context for executing a lifecycle request.
 */
export interface LifecycleContext {
  /**
   * Secret resolution context (for AI_ENABLED check and credentials).
   */
  readonly secretContext: SecretResolutionContext;

  /**
   * Budget configuration.
   * If undefined, budget checks are skipped (for testing only).
   */
  readonly budgetConfig?: BudgetConfig;

  /**
   * Current budget state.
   */
  readonly budgetState?: BudgetState;

  /**
   * Caller-provided abort signal.
   */
  readonly callerSignal?: AbortSignal;

  /**
   * Lifecycle configuration.
   */
  readonly config: LifecycleConfig;
}

/**
 * Result of a lifecycle execution.
 */
export interface LifecycleResult {
  /**
   * The model result (success or error).
   */
  readonly result: ModelResult;

  /**
   * Usage metadata including all attempts.
   */
  readonly usageMetadata: RequestUsageMetadata;

  /**
   * Whether the request was retried.
   */
  readonly wasRetried: boolean;

  /**
   * Final attempt number.
   */
  readonly finalAttemptNumber: number;

  /**
   * Diagnostic metadata (safe to log).
   */
  readonly diagnostics: LifecycleDiagnostics;
}

/**
 * Diagnostic metadata for the lifecycle execution.
 *
 * Contains only safe-to-log information.
 */
export interface LifecycleDiagnostics {
  /**
   * Platform request ID.
   */
  readonly platformRequestId: string;

  /**
   * Provider ID used.
   */
  readonly providerId: string;

  /**
   * Model ID used.
   */
  readonly modelId: string;

  /**
   * Total duration in milliseconds.
   */
  readonly totalDurationMs: number;

  /**
   * Whether request timed out.
   */
  readonly timedOut: boolean;

  /**
   * Whether request was cancelled by caller.
   */
  readonly cancelledByCaller: boolean;

  /**
   * Attempt durations in milliseconds.
   */
  readonly attemptDurations: readonly number[];

  /**
   * Error codes for each failed attempt.
   */
  readonly attemptErrors: readonly (string | undefined)[];

  /**
   * Retry safety classification of final error (if any).
   */
  readonly finalRetrySafety?: RetrySafety;

  /**
   * Whether budget check passed.
   */
  readonly budgetCheckPassed: boolean;

  /**
   * Reservation ID if budget was used.
   */
  readonly reservationId?: string;
}

/**
 * Request gate result.
 */
export interface RequestGateResult {
  /**
   * Whether the request is allowed to proceed.
   */
  readonly allowed: boolean;

  /**
   * Error if not allowed.
   */
  readonly error?: ProviderError;

  /**
   * Gate that blocked the request (if any).
   */
  readonly blockedBy?: RequestGate;

  /**
   * Provider configuration (if resolved).
   */
  readonly providerConfig?: ProviderConfig;

  /**
   * Resolved secret (if resolved).
   */
  readonly secret?: ResolvedProviderSecret;

  /**
   * Reservation ID (if budget reserved).
   */
  readonly reservationId?: string;

  /**
   * Estimated input tokens.
   */
  readonly estimatedInputTokens?: number;
}

/**
 * Request gates in order of enforcement.
 */
export type RequestGate =
  | 'AI_ENABLED'
  | 'PROVIDER_CONFIG'
  | 'API_KEY'
  | 'CAPABILITIES'
  | 'BUDGET';

/**
 * Generate a unique platform request ID.
 */
export function generatePlatformRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `plat_${timestamp}_${random}`;
}

/**
 * Create a combined abort signal from caller signal and timeout.
 *
 * Uses AbortSignal.any() and AbortSignal.timeout() per Node 22.11.
 *
 * @param callerSignal - Optional caller-provided abort signal
 * @param timeoutMs - Timeout in milliseconds
 * @returns Combined signal and function to check if cancellation was by caller
 */
export function createCombinedSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; isCancellation: () => boolean } {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  if (!callerSignal) {
    return {
      signal: timeoutSignal,
      isCancellation: () => false,
    };
  }

  const combinedSignal = AbortSignal.any([callerSignal, timeoutSignal]);

  return {
    signal: combinedSignal,
    isCancellation: () => callerSignal.aborted && !timeoutSignal.aborted,
  };
}

/**
 * Delay for retry with abort support.
 *
 * @param ms - Milliseconds to delay
 * @param signal - Abort signal to respect
 * @returns Promise that resolves after delay or rejects on abort
 */
async function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    signal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      reject(signal.reason);
    }, { once: true });
  });
}

/**
 * Calculate retry delay based on error and configuration.
 *
 * @param error - The error that triggered retry
 * @param attemptNumber - Current attempt number (1-based)
 * @param config - Lifecycle configuration
 * @returns Delay in milliseconds, capped at maxRetryDelayMs
 */
export function calculateRetryDelay(
  error: ProviderError,
  attemptNumber: number,
  config: LifecycleConfig
): number {
  // Use Retry-After if available
  if (error.retryAfterMs !== undefined && error.retryAfterMs > 0) {
    return Math.min(error.retryAfterMs, config.maxRetryDelayMs);
  }

  // Exponential backoff for safe retries
  const backoffDelay = config.baseRetryDelayMs * Math.pow(2, attemptNumber - 1);
  return Math.min(backoffDelay, config.maxRetryDelayMs);
}

/**
 * Check if an error should be retried.
 *
 * Per Task 3.3a:
 * - retryable_safe: eligible for bounded retry
 * - retryable_with_delay: eligible after bounded delay
 * - retryable_ambiguous: NEVER automatically retry (request may have been accepted)
 * - unknown: NEVER automatically retry
 * - not_retryable: NEVER retry
 *
 * @param error - The error to check
 * @param attemptNumber - Current attempt number
 * @param maxAttempts - Maximum attempts allowed
 * @returns Whether to retry
 */
export function shouldRetry(
  error: ProviderError,
  attemptNumber: number,
  maxAttempts: number
): boolean {
  // Never exceed max attempts
  if (attemptNumber >= maxAttempts) {
    return false;
  }

  // Only retry definitely safe or delayed errors
  // NEVER retry ambiguous - the request may have been accepted
  return isDefinitelySafeToRetry(error) || requiresRetryDelay(error);
}

/**
 * Run the fail-closed request gate.
 *
 * Checks in order:
 * 1. AI_ENABLED through provider-secret boundary
 * 2. Valid provider config and model ID
 * 3. Matching API key exists and not placeholder
 * 4. Required capabilities supported
 * 5. Budget and reservations
 *
 * @param request - The model request
 * @param context - Lifecycle context
 * @returns Gate result
 */
export function runRequestGate(
  request: ModelRequest,
  context: LifecycleContext
): RequestGateResult {
  // Gate 1: AI_ENABLED
  if (!context.secretContext.enablement.enabled) {
    return {
      allowed: false,
      error: ProviderErrors.credentialsMissing(
        request.providerId,
        'AI_ENABLED not set to true in .env'
      ),
      blockedBy: 'AI_ENABLED',
    };
  }

  // Gate 2: Provider config
  const providerEntry = context.secretContext.providerConfig.providers.find(
    (p) => p.providerId === request.providerId
  );

  if (!providerEntry) {
    return {
      allowed: false,
      error: ProviderErrors.providerNotFound(request.providerId),
      blockedBy: 'PROVIDER_CONFIG',
    };
  }

  if (providerEntry.enabled === false) {
    return {
      allowed: false,
      error: ProviderErrors.providerNotFound(`${request.providerId} (disabled)`),
      blockedBy: 'PROVIDER_CONFIG',
    };
  }

  // Convert to full ProviderConfig with capabilities
  // For now, create minimal config - full conversion would use config-conversion.ts
  const providerConfig: ProviderConfig = {
    ...providerEntry,
    capabilities: {
      toolCalling: providerEntry.capabilities?.toolCalling ?? 'unknown',
      strictJsonSchema: providerEntry.capabilities?.strictJsonSchema ?? 'unknown',
      schemaKeywords: {
        baseTypes: 'unknown',
        objectKeywords: 'unknown',
        arrayKeywords: 'unknown',
        stringValidation: 'unknown',
        numericValidation: 'unknown',
        compositionKeywords: 'unknown',
        referenceKeywords: 'unknown',
      },
      usageReporting: providerEntry.capabilities?.usageReporting ?? 'unknown',
      reasoning: providerEntry.capabilities?.reasoning ?? 'unknown',
      continuationRequired: 'unknown',
      streaming: providerEntry.capabilities?.streaming ?? 'unknown',
      imageInput: providerEntry.capabilities?.imageInput ?? 'unknown',
    },
  };

  // Gate 3: API key
  const secret = context.secretContext.secrets.get(request.providerId);
  if (!secret) {
    return {
      allowed: false,
      error: ProviderErrors.credentialsMissing(
        request.providerId,
        providerEntry.apiKeyEnvVar
      ),
      blockedBy: 'API_KEY',
    };
  }

  // Check for placeholder value
  if (isPlaceholderValue(secret.apiKey)) {
    return {
      allowed: false,
      error: ProviderErrors.credentialsInvalid(
        request.providerId,
        'API key is a placeholder value - set actual key in .env'
      ),
      blockedBy: 'API_KEY',
    };
  }

  // Gate 4: Capabilities (basic check)
  // Check if tools are requested but tool calling is unsupported
  if (request.tools && request.tools.length > 0) {
    if (providerConfig.capabilities.toolCalling === 'unsupported') {
      return {
        allowed: false,
        error: ProviderErrors.featureUnsupported('tool_calling', request.providerId),
        blockedBy: 'CAPABILITIES',
      };
    }
  }

  // Check if structured output is requested but unsupported
  if (request.structuredOutput) {
    if (providerConfig.capabilities.strictJsonSchema === 'unsupported') {
      return {
        allowed: false,
        error: ProviderErrors.featureUnsupported('structured_output', request.providerId),
        blockedBy: 'CAPABILITIES',
      };
    }
  }

  // Gate 5: Budget
  if (context.budgetConfig && context.budgetState) {
    // Estimate input size
    const estimation = estimateInputSize(request, context.config.estimationConfig);
    if (!estimation.success) {
      return {
        allowed: false,
        error: ProviderErrors.contextLengthExceeded(
          context.config.estimationConfig.maxInputCharacters,
          estimation.rawCharacters
        ),
        blockedBy: 'BUDGET',
      };
    }

    const outputReservation = calculateOutputReservation(
      request.options?.maxTokens,
      context.budgetConfig.maxOutputTokensPerRequest
    );

    const reservationRequest: ReservationRequest = {
      estimatedInputTokens: estimation.estimatedTokens!,
      maxOutputTokens: outputReservation,
      platformRequestId: generatePlatformRequestId(),
    };

    const budgetCheck = checkBudget(reservationRequest, context.budgetConfig, context.budgetState);
    if (!budgetCheck.allowed) {
      return {
        allowed: false,
        error: {
          code: 'QUOTA_EXCEEDED',
          message: budgetCheck.message,
          severity: 'error',
          retrySafety: 'not_retryable',
          timestamp: new Date().toISOString(),
        },
        blockedBy: 'BUDGET',
      };
    }

    // Create reservation ID
    const reservationId = `rsv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

    return {
      allowed: true,
      providerConfig,
      secret,
      reservationId,
      estimatedInputTokens: estimation.estimatedTokens!,
    };
  }

  // No budget configured - DENY (default-deny per Task 3.3a requirement)
  // A valid budget configuration is required for any external provider request
  return {
    allowed: false,
    error: {
      code: 'QUOTA_EXCEEDED',
      message: 'No budget configured. AI provider requests require explicit approved budget limits. Configure a budget in config/ai-budget.json.',
      severity: 'error',
      retrySafety: 'not_retryable',
      timestamp: new Date().toISOString(),
    },
    blockedBy: 'BUDGET',
    providerConfig,
    secret,
  };
}

/**
 * Execute a request through the shared lifecycle.
 *
 * This is the main entry point for provider requests.
 * All requests go through this function, which handles:
 * - Request gate enforcement
 * - Timeout and cancellation
 * - Retry logic
 * - Usage tracking
 *
 * @param request - The model request
 * @param context - Lifecycle context
 * @returns Lifecycle result
 */
export async function executeRequest(
  request: ModelRequest,
  context: LifecycleContext
): Promise<LifecycleResult> {
  const startTime = Date.now();
  const platformRequestId = generatePlatformRequestId();
  const attemptDurations: number[] = [];
  const attemptErrors: (string | undefined)[] = [];

  let lastError: ProviderError | undefined;
  let wasRetried = false;
  let timedOut = false;
  let cancelledByCaller = false;
  let budgetCheckPassed = false;
  let reservationId: string | undefined;

  // Run request gate
  const gateResult = runRequestGate(request, context);
  if (!gateResult.allowed) {
    return {
      result: {
        success: false,
        error: gateResult.error!,
        platformRequestId,
      },
      usageMetadata: {
        attemptNumber: 0,
        totalAttempts: 0,
        usageComplete: false,
      },
      wasRetried: false,
      finalAttemptNumber: 0,
      diagnostics: {
        platformRequestId,
        providerId: request.providerId,
        modelId: request.modelId ?? 'unknown',
        totalDurationMs: Date.now() - startTime,
        timedOut: false,
        cancelledByCaller: false,
        attemptDurations: [],
        attemptErrors: [gateResult.error!.code],
        budgetCheckPassed: false,
      },
    };
  }

  budgetCheckPassed = true;
  reservationId = gateResult.reservationId;

  const providerConfig = gateResult.providerConfig!;
  const secret = gateResult.secret!;

  // Get adapter
  const adapter = globalAdapterRegistry.get(providerConfig.adapterType);
  if (!adapter) {
    // No adapter registered - return error
    return {
      result: {
        success: false,
        error: ProviderErrors.providerNotFound(`No adapter for ${providerConfig.adapterType}`),
        platformRequestId,
      },
      usageMetadata: {
        attemptNumber: 0,
        totalAttempts: 0,
        usageComplete: false,
      },
      wasRetried: false,
      finalAttemptNumber: 0,
      diagnostics: {
        platformRequestId,
        providerId: request.providerId,
        modelId: request.modelId ?? providerConfig.defaultModelId,
        totalDurationMs: Date.now() - startTime,
        timedOut: false,
        cancelledByCaller: false,
        attemptDurations: [],
        attemptErrors: ['PROVIDER_NOT_FOUND'],
        budgetCheckPassed: true,
        reservationId,
      },
    };
  }

  // Execute with retry loop
  let attemptNumber = 0;
  let finalResult: AdapterResult | undefined;
  let finalObservedUsage: ObservedUsage | undefined;

  while (attemptNumber < context.config.maxAttempts) {
    attemptNumber++;
    const attemptStart = Date.now();

    // Create combined signal for this attempt
    const timeoutMs = request.options?.timeoutMs ?? context.config.defaultTimeoutMs;
    const { signal, isCancellation } = createCombinedSignal(context.callerSignal, timeoutMs);

    // Create adapter context
    const adapterContext: AdapterContext = {
      providerConfig,
      apiKey: secret.apiKey,
      signal,
      isCancellation: isCancellation(),
      options: { timeoutMs },
      platformRequestId,
      attemptNumber,
    };

    try {
      // Execute adapter
      const result = await adapter.execute(request, adapterContext);
      attemptDurations.push(Date.now() - attemptStart);

      if (isAdapterSuccess(result)) {
        // Success - return result
        finalResult = result;
        finalObservedUsage = result.observedUsage;
        attemptErrors.push(undefined);
        break;
      }

      // Error - check if we should retry
      lastError = result.error;
      attemptErrors.push(result.error.code);

      // Check abort
      if (signal.aborted) {
        if (isCancellation()) {
          cancelledByCaller = true;
          lastError = ProviderErrors.cancelled();
        } else {
          timedOut = true;
          lastError = ProviderErrors.timeout(timeoutMs);
        }
        break;
      }

      // Check retry eligibility
      if (!shouldRetry(lastError, attemptNumber, context.config.maxAttempts)) {
        finalResult = result;
        break;
      }

      // Retry - calculate delay
      wasRetried = true;
      const delay = calculateRetryDelay(lastError, attemptNumber, context.config);

      try {
        await delayWithAbort(delay, signal);
      } catch {
        // Delay was aborted
        if (isCancellation()) {
          cancelledByCaller = true;
          lastError = ProviderErrors.cancelled();
        } else {
          timedOut = true;
          lastError = ProviderErrors.timeout(timeoutMs);
        }
        break;
      }

    } catch (err) {
      // Unexpected error from adapter
      attemptDurations.push(Date.now() - attemptStart);
      lastError = ProviderErrors.unknownError((err as Error).message, err as Error);
      attemptErrors.push('UNKNOWN_ERROR');
      break;
    }
  }

  // Build final result
  const totalDuration = Date.now() - startTime;

  if (finalResult && isAdapterSuccess(finalResult)) {
    return {
      result: {
        success: true,
        response: finalResult.response,
      },
      usageMetadata: {
        observed: finalObservedUsage,
        attemptNumber,
        totalAttempts: attemptNumber,
        durationMs: totalDuration,
        usageComplete: true,
      },
      wasRetried,
      finalAttemptNumber: attemptNumber,
      diagnostics: {
        platformRequestId,
        providerId: request.providerId,
        modelId: request.modelId ?? providerConfig.defaultModelId,
        totalDurationMs: totalDuration,
        timedOut: false,
        cancelledByCaller: false,
        attemptDurations,
        attemptErrors,
        budgetCheckPassed,
        reservationId,
      },
    };
  }

  // Error result
  return {
    result: {
      success: false,
      error: lastError ?? ProviderErrors.unknownError('No error captured'),
      platformRequestId,
    },
    usageMetadata: {
      attemptNumber,
      totalAttempts: attemptNumber,
      durationMs: totalDuration,
      usageComplete: false,
    },
    wasRetried,
    finalAttemptNumber: attemptNumber,
    diagnostics: {
      platformRequestId,
      providerId: request.providerId,
      modelId: request.modelId ?? providerConfig.defaultModelId,
      totalDurationMs: totalDuration,
      timedOut,
      cancelledByCaller,
      attemptDurations,
      attemptErrors,
      finalRetrySafety: lastError?.retrySafety,
      budgetCheckPassed,
      reservationId,
    },
  };
}
