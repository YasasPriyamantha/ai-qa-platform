/**
 * Provider adapter interface.
 *
 * Task 3.3a: Define the interface that future adapters (Tasks 3.4-3.6a) will implement.
 *
 * Key principles:
 * - Adapters receive normalized request and explicit context
 * - Adapters return normalized response or normalized error
 * - Adapters must NOT independently implement retries, timeout enforcement, or usage budgets
 * - The shared lifecycle (this task) calls adapters and handles lifecycle concerns
 */

import type { ModelRequest, RequestOptions } from './request.js';
import type { ModelResponse } from './response.js';
import type { ProviderError } from './errors.js';
import type { ProviderConfig, AdapterType } from './types.js';
import type { ObservedUsage } from './usage.js';

/**
 * Context provided to an adapter for a single request.
 *
 * Contains all information the adapter needs to execute the request,
 * but NOT lifecycle/retry policy (that's the lifecycle's job).
 */
export interface AdapterContext {
  /**
   * Complete provider configuration including capabilities.
   */
  readonly providerConfig: ProviderConfig;

  /**
   * The actual API key value.
   * NEVER log this value.
   */
  readonly apiKey: string;

  /**
   * Combined abort signal (caller + timeout).
   * Adapters should respect this for request cancellation.
   */
  readonly signal: AbortSignal;

  /**
   * Whether caller cancellation triggered the abort (vs. timeout).
   * Set by the lifecycle when creating the signal.
   */
  readonly isCancellation: boolean;

  /**
   * Request options including timeout.
   */
  readonly options: RequestOptions;

  /**
   * Platform request ID for correlation.
   */
  readonly platformRequestId: string;

  /**
   * Current attempt number (1-based).
   */
  readonly attemptNumber: number;
}

/**
 * Result of an adapter operation.
 *
 * Discriminated union for success/error handling.
 */
export type AdapterResult = AdapterSuccess | AdapterError;

/**
 * Successful adapter response.
 */
export interface AdapterSuccess {
  readonly success: true;

  /**
   * The normalized model response.
   */
  readonly response: ModelResponse;

  /**
   * Provider-observed usage (may have unknown fields).
   */
  readonly observedUsage: ObservedUsage;

  /**
   * Whether the adapter disabled SDK retries as required.
   * Must always be true - for verification.
   */
  readonly sdkRetriesDisabled: true;
}

/**
 * Failed adapter response.
 */
export interface AdapterError {
  readonly success: false;

  /**
   * The normalized provider error.
   */
  readonly error: ProviderError;

  /**
   * Partial usage if available before the error.
   */
  readonly partialUsage?: Partial<ObservedUsage>;

  /**
   * Provider request ID if available.
   */
  readonly providerRequestId?: string;

  /**
   * Whether the adapter disabled SDK retries as required.
   * Must always be true - for verification.
   */
  readonly sdkRetriesDisabled: true;
}

/**
 * Type guard for adapter success.
 */
export function isAdapterSuccess(result: AdapterResult): result is AdapterSuccess {
  return result.success === true;
}

/**
 * Type guard for adapter error.
 */
export function isAdapterError(result: AdapterResult): result is AdapterError {
  return result.success === false;
}

/**
 * Provider adapter interface.
 *
 * Future adapters (OpenAI, Anthropic, Gemini) must implement this interface.
 *
 * IMPORTANT: Adapters must NOT independently implement:
 * - Retry logic
 * - Timeout enforcement (beyond respecting the AbortSignal)
 * - Usage budget checks
 *
 * The shared lifecycle handles these concerns. Adapters only:
 * - Convert normalized request to provider-specific format
 * - Make the HTTP/SDK call with the provided signal
 * - Convert provider response to normalized format
 * - Extract and normalize errors
 * - Report observed usage
 */
export interface ProviderAdapter {
  /**
   * Adapter type identifier.
   */
  readonly adapterType: AdapterType;

  /**
   * Display name for the adapter.
   */
  readonly displayName: string;

  /**
   * Execute a model request.
   *
   * @param request - The normalized model request
   * @param context - Adapter context with config, API key, and signal
   * @returns Normalized response or error
   */
  execute(request: ModelRequest, context: AdapterContext): Promise<AdapterResult>;

  /**
   * Check if this adapter supports a specific capability.
   *
   * Adapters may override declared capabilities with runtime checks.
   *
   * @param capability - The capability to check
   * @param config - Provider configuration
   * @returns true if supported, false if not, undefined if unknown
   */
  checkCapability?(capability: string, config: ProviderConfig): boolean | undefined;

  /**
   * Validate a request before sending.
   *
   * Optional method for adapter-specific validation beyond common validation.
   *
   * @param request - The request to validate
   * @param config - Provider configuration
   * @returns List of validation errors, empty if valid
   */
  validateRequest?(request: ModelRequest, config: ProviderConfig): string[];
}

/**
 * Fake adapter for testing lifecycle behavior.
 *
 * Used in tests to simulate various provider responses without network calls.
 */
export interface FakeAdapterBehavior {
  /**
   * Response to return on success.
   */
  response?: ModelResponse;

  /**
   * Error to return on failure.
   */
  error?: ProviderError;

  /**
   * Delay before returning (ms).
   */
  delayMs?: number;

  /**
   * Whether to respect the abort signal.
   * If true and signal aborted during delay, returns cancelled error.
   */
  respectAbortSignal?: boolean;

  /**
   * Observed usage to report.
   */
  observedUsage?: ObservedUsage;

  /**
   * Custom handler for full control.
   */
  handler?: (request: ModelRequest, context: AdapterContext) => Promise<AdapterResult>;
}

/**
 * Create a fake adapter for testing.
 *
 * @param adapterType - Adapter type to simulate
 * @param behavior - Behavior configuration
 * @returns A fake adapter implementing ProviderAdapter
 */
export function createFakeAdapter(
  adapterType: AdapterType,
  behavior: FakeAdapterBehavior
): ProviderAdapter {
  return {
    adapterType,
    displayName: `Fake ${adapterType}`,

    async execute(request: ModelRequest, context: AdapterContext): Promise<AdapterResult> {
      // Custom handler takes precedence
      if (behavior.handler) {
        return behavior.handler(request, context);
      }

      // Apply delay if configured
      if (behavior.delayMs && behavior.delayMs > 0) {
        const aborted = await new Promise<boolean>((resolve) => {
          const timeoutId = setTimeout(() => resolve(false), behavior.delayMs);

          if (behavior.respectAbortSignal) {
            if (context.signal.aborted) {
              clearTimeout(timeoutId);
              resolve(true);
              return;
            }
            context.signal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              resolve(true);
            });
          }
        });

        if (aborted) {
          const { ProviderErrors } = await import('./errors.js');
          return {
            success: false,
            error: ProviderErrors.cancelled(),
            sdkRetriesDisabled: true,
          };
        }
      }

      // Check abort after delay
      if (behavior.respectAbortSignal && context.signal.aborted) {
        const { ProviderErrors } = await import('./errors.js');
        return {
          success: false,
          error: ProviderErrors.cancelled(),
          sdkRetriesDisabled: true,
        };
      }

      // Return error if configured
      if (behavior.error) {
        return {
          success: false,
          error: behavior.error,
          sdkRetriesDisabled: true,
        };
      }

      // Return success response
      if (behavior.response) {
        const { createUnknownObservedUsage } = await import('./usage.js');
        return {
          success: true,
          response: behavior.response,
          observedUsage: behavior.observedUsage ?? createUnknownObservedUsage(),
          sdkRetriesDisabled: true,
        };
      }

      // Default: return an error indicating no behavior configured
      const { ProviderErrors } = await import('./errors.js');
      return {
        success: false,
        error: ProviderErrors.unknownError('Fake adapter: no behavior configured'),
        sdkRetriesDisabled: true,
      };
    },
  };
}

/**
 * Adapter registry for looking up adapters by type.
 */
export class AdapterRegistry {
  private readonly adapters = new Map<AdapterType, ProviderAdapter>();

  /**
   * Register an adapter.
   */
  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.adapterType, adapter);
  }

  /**
   * Get an adapter by type.
   */
  get(adapterType: AdapterType): ProviderAdapter | undefined {
    return this.adapters.get(adapterType);
  }

  /**
   * Check if an adapter type is registered.
   */
  has(adapterType: AdapterType): boolean {
    return this.adapters.has(adapterType);
  }

  /**
   * Get all registered adapter types.
   */
  types(): AdapterType[] {
    return [...this.adapters.keys()];
  }

  /**
   * Clear all registered adapters (for testing).
   */
  clear(): void {
    this.adapters.clear();
  }
}

/**
 * Global adapter registry.
 *
 * Adapters register themselves here during initialization.
 * The lifecycle uses this to look up adapters by type.
 */
export const globalAdapterRegistry = new AdapterRegistry();
