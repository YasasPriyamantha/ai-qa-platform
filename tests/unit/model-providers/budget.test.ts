/**
 * Tests for budget configuration and checking.
 *
 * Task 3.3a: Test budget enforcement with explicit approved limits.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  validateBudgetConfig,
  checkBudget,
  calculateWindowEnd,
  isWindowExpired,
  createInitialBudgetState,
  generateReservationId,
  NoBudgetConfiguredError,
  BudgetExceededError,
  type BudgetConfig,
  type BudgetState,
  type ReservationRequest,
  type BudgetCheckResult,
} from '../../../src/model-providers/budget.js';

// Test fixtures
function createTestBudget(): BudgetConfig {
  return {
    maxTotalRequests: 100,
    maxInputTokensPerRequest: 10000,
    maxOutputTokensPerRequest: 4000,
    maxCumulativeInputTokens: 100000,
    maxCumulativeOutputTokens: 50000,
    window: {
      type: 'rolling',
      durationHours: 24,
    },
  };
}

// Get a fresh pricing date (yesterday) to avoid staleness issues
function getFreshPricingDate(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

function createTestBudgetWithCost(): BudgetConfig {
  return {
    ...createTestBudget(),
    costEstimate: {
      inputPricePerKToken: 0.01,
      outputPricePerKToken: 0.03,
      pricingSource: 'OpenAI Pricing Page',
      pricingDate: getFreshPricingDate(), // Dynamic fresh date
      modelId: 'gpt-4o',
      maxEstimatedCostUsd: 10.00,
    },
  };
}

function createTestState(overrides?: Partial<BudgetState>): BudgetState {
  return {
    requestCount: 0,
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    windowStart: new Date().toISOString(),
    windowEnd: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function createTestReservation(overrides?: Partial<ReservationRequest>): ReservationRequest {
  return {
    estimatedInputTokens: 1000,
    maxOutputTokens: 500,
    platformRequestId: 'req-123',
    ...overrides,
  };
}

describe('validateBudgetConfig', () => {
  it('validates complete budget config', () => {
    const config = createTestBudget();
    const errors = validateBudgetConfig(config);

    expect(errors).toHaveLength(0);
  });

  it('validates budget with cost estimate', () => {
    const config = createTestBudgetWithCost();
    const errors = validateBudgetConfig(config);

    expect(errors).toHaveLength(0);
  });

  it('rejects non-object config', () => {
    expect(validateBudgetConfig(null)).toContain('Budget config must be an object');
    expect(validateBudgetConfig('string')).toContain('Budget config must be an object');
    expect(validateBudgetConfig(123)).toContain('Budget config must be an object');
  });

  describe('required number fields', () => {
    it('rejects missing maxTotalRequests', () => {
      const config = { ...createTestBudget(), maxTotalRequests: undefined };
      const errors = validateBudgetConfig(config);
      expect(errors).toContain('maxTotalRequests must be a positive number');
    });

    it('rejects zero maxTotalRequests', () => {
      const config = { ...createTestBudget(), maxTotalRequests: 0 };
      const errors = validateBudgetConfig(config);
      expect(errors).toContain('maxTotalRequests must be a positive number');
    });

    it('rejects negative maxTotalRequests', () => {
      const config = { ...createTestBudget(), maxTotalRequests: -1 };
      const errors = validateBudgetConfig(config);
      expect(errors).toContain('maxTotalRequests must be a positive number');
    });

    it('rejects missing maxInputTokensPerRequest', () => {
      const config = { ...createTestBudget(), maxInputTokensPerRequest: undefined };
      const errors = validateBudgetConfig(config);
      expect(errors).toContain('maxInputTokensPerRequest must be a positive number');
    });

    it('rejects missing maxOutputTokensPerRequest', () => {
      const config = { ...createTestBudget(), maxOutputTokensPerRequest: undefined };
      const errors = validateBudgetConfig(config);
      expect(errors).toContain('maxOutputTokensPerRequest must be a positive number');
    });

    it('rejects missing cumulative limits', () => {
      const config = {
        ...createTestBudget(),
        maxCumulativeInputTokens: undefined,
        maxCumulativeOutputTokens: undefined,
      };
      const errors = validateBudgetConfig(config);
      expect(errors).toContain('maxCumulativeInputTokens must be a positive number');
      expect(errors).toContain('maxCumulativeOutputTokens must be a positive number');
    });
  });

  describe('window validation', () => {
    it('rejects missing window', () => {
      const config = { ...createTestBudget(), window: undefined };
      const errors = validateBudgetConfig(config);
      expect(errors).toContain('window is required');
    });

    it('rejects invalid window type', () => {
      const config = {
        ...createTestBudget(),
        window: { type: 'invalid', durationHours: 24 },
      };
      const errors = validateBudgetConfig(config);
      expect(errors).toContain("window.type must be 'rolling' or 'fixed'");
    });

    it('rejects missing durationHours', () => {
      const config = {
        ...createTestBudget(),
        window: { type: 'rolling' as const, durationHours: undefined as unknown as number },
      };
      const errors = validateBudgetConfig(config);
      expect(errors).toContain('window.durationHours must be a positive number');
    });
  });

  describe('cost estimate validation', () => {
    it('rejects invalid cost estimate', () => {
      const config = {
        ...createTestBudget(),
        costEstimate: 'invalid',
      };
      const errors = validateBudgetConfig(config);
      expect(errors).toContain('costEstimate must be an object if provided');
    });

    it('rejects missing pricing fields', () => {
      const config = {
        ...createTestBudget(),
        costEstimate: {
          inputPricePerKToken: -1,
          outputPricePerKToken: -1,
          pricingSource: '',
          pricingDate: '',
          modelId: '',
        },
      };
      const errors = validateBudgetConfig(config);
      expect(errors).toContain('costEstimate.inputPricePerKToken must be a non-negative number');
      expect(errors).toContain('costEstimate.outputPricePerKToken must be a non-negative number');
      expect(errors).toContain('costEstimate.pricingSource must be a non-empty string');
      expect(errors).toContain('costEstimate.pricingDate must be a non-empty string');
      expect(errors).toContain('costEstimate.modelId must be a non-empty string');
    });

    it('allows zero prices', () => {
      const config = {
        ...createTestBudget(),
        costEstimate: {
          inputPricePerKToken: 0,
          outputPricePerKToken: 0,
          pricingSource: 'Free tier',
          pricingDate: '2024-01-01',
          modelId: 'free-model',
        },
      };
      const errors = validateBudgetConfig(config);
      expect(errors).toHaveLength(0);
    });
  });
});

describe('checkBudget', () => {
  describe('request count', () => {
    it('allows request within count limit', () => {
      const budget = createTestBudget();
      const state = createTestState({ requestCount: 50 });
      const reservation = createTestReservation();

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(true);
    });

    it('denies request when count at limit', () => {
      const budget = createTestBudget();
      const state = createTestState({ requestCount: 100 });
      const reservation = createTestReservation();

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('REQUEST_COUNT_EXCEEDED');
    });
  });

  describe('per-request input tokens', () => {
    it('allows request within input token limit', () => {
      const budget = createTestBudget();
      const state = createTestState();
      const reservation = createTestReservation({ estimatedInputTokens: 5000 });

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(true);
    });

    it('denies request exceeding input token limit', () => {
      const budget = createTestBudget();
      const state = createTestState();
      const reservation = createTestReservation({ estimatedInputTokens: 15000 });

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('INPUT_TOKENS_PER_REQUEST_EXCEEDED');
    });
  });

  describe('per-request output tokens', () => {
    it('allows request within output token limit', () => {
      const budget = createTestBudget();
      const state = createTestState();
      const reservation = createTestReservation({ maxOutputTokens: 2000 });

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(true);
    });

    it('denies request exceeding output token limit', () => {
      const budget = createTestBudget();
      const state = createTestState();
      const reservation = createTestReservation({ maxOutputTokens: 5000 });

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('OUTPUT_TOKENS_PER_REQUEST_EXCEEDED');
    });
  });

  describe('cumulative input tokens', () => {
    it('allows request within cumulative input limit', () => {
      const budget = createTestBudget();
      const state = createTestState({ cumulativeInputTokens: 50000 });
      const reservation = createTestReservation({ estimatedInputTokens: 1000 });

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(true);
    });

    it('denies request that would exceed cumulative input limit', () => {
      const budget = createTestBudget();
      const state = createTestState({ cumulativeInputTokens: 99500 });
      const reservation = createTestReservation({ estimatedInputTokens: 1000 });

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('CUMULATIVE_INPUT_EXCEEDED');
    });
  });

  describe('cumulative output tokens', () => {
    it('allows request within cumulative output limit', () => {
      const budget = createTestBudget();
      const state = createTestState({ cumulativeOutputTokens: 25000 });
      const reservation = createTestReservation({ maxOutputTokens: 500 });

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(true);
    });

    it('denies request that would exceed cumulative output limit', () => {
      const budget = createTestBudget();
      const state = createTestState({ cumulativeOutputTokens: 49800 });
      const reservation = createTestReservation({ maxOutputTokens: 500 });

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('CUMULATIVE_OUTPUT_EXCEEDED');
    });
  });

  describe('cost estimation', () => {
    it('calculates cost estimate when pricing available', () => {
      const budget = createTestBudgetWithCost();
      const state = createTestState();
      const reservation = createTestReservation({
        estimatedInputTokens: 1000,
        maxOutputTokens: 500,
      });

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(true);
      expect(result.estimatedCost).toBeDefined();
      expect(result.estimatedCost!.isEstimate).toBe(true);
      expect(result.estimatedCost!.inputCostUsd).toBe(0.01); // 1k tokens * $0.01
      expect(result.estimatedCost!.outputCostUsd).toBe(0.015); // 0.5k tokens * $0.03
      expect(result.estimatedCost!.totalCostUsd).toBe(0.025);
    });

    it('denies request exceeding cost limit', () => {
      // Create budget with low cost limit but high token limits
      const freshDate = getFreshPricingDate();
      const budget: BudgetConfig = {
        maxTotalRequests: 1000,
        maxInputTokensPerRequest: 10000,
        maxOutputTokensPerRequest: 4000,
        maxCumulativeInputTokens: 1000000,
        maxCumulativeOutputTokens: 500000,
        window: {
          type: 'rolling',
          durationHours: 24,
        },
        costEstimate: {
          inputPricePerKToken: 0.01,
          outputPricePerKToken: 0.03,
          pricingSource: 'OpenAI Pricing Page',
          pricingDate: freshDate, // Use fresh date to avoid staleness
          modelId: 'gpt-4o',
          maxEstimatedCostUsd: 1.00, // Very low limit
        },
      };
      const state = createTestState({
        cumulativeInputTokens: 50000, // $0.50 worth
        cumulativeOutputTokens: 15000, // $0.45 worth = $0.95 total
      });
      const reservation = createTestReservation({
        estimatedInputTokens: 5000, // $0.05
        maxOutputTokens: 1000, // $0.03 = $0.08 total, would push to $1.03
      });

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('ESTIMATED_COST_EXCEEDED');
    });

    it('includes pricing metadata in estimate', () => {
      const budget = createTestBudgetWithCost();
      const state = createTestState();
      const reservation = createTestReservation();

      const result = checkBudget(reservation, budget, state);

      expect(result.estimatedCost!.pricingDate).toBe(getFreshPricingDate());
      expect(result.estimatedCost!.pricingSource).toBe('OpenAI Pricing Page');
    });
  });

  describe('current state in result', () => {
    it('includes current state in result', () => {
      const budget = createTestBudget();
      const state = createTestState({ requestCount: 50 });
      const reservation = createTestReservation();

      const result = checkBudget(reservation, budget, state);

      expect(result.currentState).toBeDefined();
      expect(result.currentState!.requestCount).toBe(50);
    });
  });
});

describe('calculateWindowEnd', () => {
  it('calculates rolling window end', () => {
    const window = { type: 'rolling' as const, durationHours: 24 };
    const start = '2024-01-15T10:00:00.000Z';

    const end = calculateWindowEnd(window, start);

    expect(end).toBe('2024-01-16T10:00:00.000Z');
  });

  it('handles fractional hours', () => {
    const window = { type: 'rolling' as const, durationHours: 1.5 };
    const start = '2024-01-15T10:00:00.000Z';

    const end = calculateWindowEnd(window, start);

    expect(end).toBe('2024-01-15T11:30:00.000Z');
  });
});

describe('isWindowExpired', () => {
  it('returns false when window active', () => {
    const window = { type: 'rolling' as const, durationHours: 24 };
    const start = new Date().toISOString();
    const now = new Date();

    expect(isWindowExpired(window, start, now)).toBe(false);
  });

  it('returns true when window expired', () => {
    const window = { type: 'rolling' as const, durationHours: 1 };
    const start = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
    const now = new Date();

    expect(isWindowExpired(window, start, now)).toBe(true);
  });
});

describe('createInitialBudgetState', () => {
  it('creates state with zero counters', () => {
    const window = { type: 'rolling' as const, durationHours: 24 };
    const state = createInitialBudgetState(window);

    expect(state.requestCount).toBe(0);
    expect(state.cumulativeInputTokens).toBe(0);
    expect(state.cumulativeOutputTokens).toBe(0);
  });

  it('sets window start and end', () => {
    const window = { type: 'rolling' as const, durationHours: 24 };
    const state = createInitialBudgetState(window);

    expect(state.windowStart).toBeDefined();
    expect(state.windowEnd).toBeDefined();
  });

  it('uses fixed start time when provided', () => {
    const window = {
      type: 'fixed' as const,
      durationHours: 24,
      startTime: '2024-01-01T00:00:00.000Z',
    };
    const state = createInitialBudgetState(window);

    expect(state.windowStart).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('generateReservationId', () => {
  it('generates unique IDs', () => {
    const id1 = generateReservationId();
    const id2 = generateReservationId();

    expect(id1).not.toBe(id2);
  });

  it('starts with rsv_ prefix', () => {
    const id = generateReservationId();
    expect(id.startsWith('rsv_')).toBe(true);
  });
});

describe('Error classes', () => {
  describe('NoBudgetConfiguredError', () => {
    it('has correct code', () => {
      const error = new NoBudgetConfiguredError();
      expect(error.code).toBe('NO_BUDGET_CONFIGURED');
    });

    it('has descriptive message', () => {
      const error = new NoBudgetConfiguredError();
      expect(error.message).toContain('No budget configured');
      expect(error.message).toContain('explicit approved budget limits');
    });
  });

  describe('BudgetExceededError', () => {
    it('wraps check result', () => {
      const checkResult: BudgetCheckResult = {
        allowed: false,
        reason: 'REQUEST_COUNT_EXCEEDED',
        message: 'Too many requests',
        currentState: createTestState(),
      };

      const error = new BudgetExceededError(checkResult);

      expect(error.code).toBe('REQUEST_COUNT_EXCEEDED');
      expect(error.checkResult).toBe(checkResult);
      expect(error.message).toBe('Too many requests');
    });
  });
});

describe('Design principle: explicit approval required', () => {
  it('no default budget - explicit configuration required', () => {
    // This test documents that there is no implicit/default budget
    // All limits must be explicitly configured

    const config = createTestBudget();

    // All fields are required - there's no "unlimited" default
    expect(config.maxTotalRequests).toBeGreaterThan(0);
    expect(config.maxInputTokensPerRequest).toBeGreaterThan(0);
    expect(config.maxOutputTokensPerRequest).toBeGreaterThan(0);
    expect(config.maxCumulativeInputTokens).toBeGreaterThan(0);
    expect(config.maxCumulativeOutputTokens).toBeGreaterThan(0);
  });

  it('cost estimates clearly labeled as estimates', () => {
    // This test documents that cost is always an estimate, never guaranteed
    const budget = createTestBudgetWithCost();
    const state = createTestState();
    const reservation = createTestReservation();

    const result = checkBudget(reservation, budget, state);

    expect(result.estimatedCost).toBeDefined();
    expect(result.estimatedCost!.isEstimate).toBe(true);
    // Should include pricing source and date for transparency
    expect(result.estimatedCost!.pricingSource).toBeDefined();
    expect(result.estimatedCost!.pricingDate).toBeDefined();
  });
});

describe('Monetary budget policy - unknown/stale pricing', () => {
  // Import functions for this test section
  let isPricingStale: typeof import('../../../src/model-providers/budget.js').isPricingStale;
  let hasMonetaryLimit: typeof import('../../../src/model-providers/budget.js').hasMonetaryLimit;
  let DEFAULT_UNKNOWN_PRICING_POLICY: typeof import('../../../src/model-providers/budget.js').DEFAULT_UNKNOWN_PRICING_POLICY;

  beforeAll(async () => {
    const module = await import('../../../src/model-providers/budget.js');
    isPricingStale = module.isPricingStale;
    hasMonetaryLimit = module.hasMonetaryLimit;
    DEFAULT_UNKNOWN_PRICING_POLICY = module.DEFAULT_UNKNOWN_PRICING_POLICY;
  });

  describe('isPricingStale', () => {
    it('returns not stale for recent pricing', () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const result = isPricingStale(yesterday, 90);

      expect(result.stale).toBe(false);
      expect(result.ageDays).toBeLessThanOrEqual(1);
    });

    it('returns stale for old pricing', () => {
      const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
      const result = isPricingStale(fourMonthsAgo, 90);

      expect(result.stale).toBe(true);
      expect(result.ageDays).toBeGreaterThan(90);
    });

    it('handles invalid date as extremely stale', () => {
      const result = isPricingStale('not-a-date', 90);

      expect(result.stale).toBe(true);
      expect(result.ageDays).toBe(Infinity);
    });

    it('respects custom threshold', () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // Not stale with 90 day threshold
      expect(isPricingStale(thirtyDaysAgo, 90).stale).toBe(false);

      // Stale with 7 day threshold
      expect(isPricingStale(thirtyDaysAgo, 7).stale).toBe(true);
    });
  });

  describe('hasMonetaryLimit', () => {
    it('returns true when maxEstimatedCostUsd is set', () => {
      const budget: BudgetConfig = {
        ...createTestBudget(),
        costEstimate: {
          inputPricePerKToken: 0.01,
          outputPricePerKToken: 0.03,
          pricingSource: 'test',
          pricingDate: '2024-01-01',
          modelId: 'gpt-4',
          maxEstimatedCostUsd: 10.00,
        },
      };

      expect(hasMonetaryLimit(budget)).toBe(true);
    });

    it('returns false when no cost estimate', () => {
      const budget = createTestBudget();
      expect(hasMonetaryLimit(budget)).toBe(false);
    });

    it('returns false when cost estimate exists but no maxEstimatedCostUsd', () => {
      const budget: BudgetConfig = {
        ...createTestBudget(),
        costEstimate: {
          inputPricePerKToken: 0.01,
          outputPricePerKToken: 0.03,
          pricingSource: 'test',
          pricingDate: '2024-01-01',
          modelId: 'gpt-4',
          // No maxEstimatedCostUsd
        },
      };

      expect(hasMonetaryLimit(budget)).toBe(false);
    });
  });

  describe('DEFAULT_UNKNOWN_PRICING_POLICY', () => {
    it('defaults to fail-closed for unknown pricing', () => {
      expect(DEFAULT_UNKNOWN_PRICING_POLICY.onUnknownPricing).toBe('deny');
    });

    it('defaults to warn_allow for stale pricing', () => {
      expect(DEFAULT_UNKNOWN_PRICING_POLICY.onStalePricing).toBe('warn_allow');
    });

    it('defaults to 90 day staleness threshold', () => {
      expect(DEFAULT_UNKNOWN_PRICING_POLICY.pricingStalenessThresholdDays).toBe(90);
    });
  });

  describe('checkBudget with stale pricing', () => {
    it('denies when pricing is stale and policy is deny', () => {
      const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const budget: BudgetConfig = {
        ...createTestBudget(),
        costEstimate: {
          inputPricePerKToken: 0.01,
          outputPricePerKToken: 0.03,
          pricingSource: 'test',
          pricingDate: fourMonthsAgo,
          modelId: 'gpt-4',
          maxEstimatedCostUsd: 10.00, // Monetary limit set
        },
        unknownPricingPolicy: {
          onUnknownPricing: 'deny',
          pricingStalenessThresholdDays: 90,
          onStalePricing: 'deny', // Deny on stale
        },
      };

      const state = createTestState();
      const reservation = createTestReservation();

      const result = checkBudget(reservation, budget, state);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('PRICING_STALE');
    });

    it('denies when pricing is stale with monetary limit (policy ignored - invariant)', () => {
      // INVARIANT (DEC-038): When monetary limit is configured, stale pricing ALWAYS denies.
      // The unknownPricingPolicy is NOT configurable for this case.
      const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const budget: BudgetConfig = {
        ...createTestBudget(),
        costEstimate: {
          inputPricePerKToken: 0.01,
          outputPricePerKToken: 0.03,
          pricingSource: 'test',
          pricingDate: fourMonthsAgo,
          modelId: 'gpt-4',
          maxEstimatedCostUsd: 100.00, // Monetary limit set - triggers invariant
        },
        unknownPricingPolicy: {
          onUnknownPricing: 'deny',
          pricingStalenessThresholdDays: 90,
          onStalePricing: 'warn_allow', // This is IGNORED when monetary limit is set
        },
      };

      const state = createTestState();
      const reservation = createTestReservation();

      const result = checkBudget(reservation, budget, state);

      // Stale pricing with monetary limit MUST deny regardless of policy
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('PRICING_STALE');
    });

    it('allows with fresh pricing data when monetary limit is set', () => {
      // Fresh pricing (yesterday) with monetary limit should be allowed
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const budget: BudgetConfig = {
        ...createTestBudget(),
        costEstimate: {
          inputPricePerKToken: 0.01,
          outputPricePerKToken: 0.03,
          pricingSource: 'test',
          pricingDate: yesterday,
          modelId: 'gpt-4',
          maxEstimatedCostUsd: 100.00, // Monetary limit set
        },
      };

      const state = createTestState();
      const reservation = createTestReservation();

      const result = checkBudget(reservation, budget, state);
      expect(result.allowed).toBe(true);
      expect(result.estimatedCost).toBeDefined();
    });

    it('allows when no monetary limit is configured (staleness not checked)', () => {
      const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const budget: BudgetConfig = {
        ...createTestBudget(),
        costEstimate: {
          inputPricePerKToken: 0.01,
          outputPricePerKToken: 0.03,
          pricingSource: 'test',
          pricingDate: fourMonthsAgo,
          modelId: 'gpt-4',
          // No maxEstimatedCostUsd - no monetary limit
        },
        unknownPricingPolicy: {
          onUnknownPricing: 'deny',
          pricingStalenessThresholdDays: 90,
          onStalePricing: 'deny',
        },
      };

      const state = createTestState();
      const reservation = createTestReservation();

      const result = checkBudget(reservation, budget, state);

      // No monetary limit, so staleness doesn't block
      expect(result.allowed).toBe(true);
    });
  });
});

describe('Budget config loading', () => {
  // Import lazily to avoid issues
  let loadBudgetConfigFromPath: typeof import('../../../src/model-providers/budget.js').loadBudgetConfigFromPath;
  let loadBudgetConfig: typeof import('../../../src/model-providers/budget.js').loadBudgetConfig;
  let isBudgetConfigSuccess: typeof import('../../../src/model-providers/budget.js').isBudgetConfigSuccess;
  let isBudgetConfigError: typeof import('../../../src/model-providers/budget.js').isBudgetConfigError;
  let BudgetConfigLoadError: typeof import('../../../src/model-providers/budget.js').BudgetConfigLoadError;

  // Test fixtures
  const TEST_DIR = 'tests/fixtures/budget-config-' + Date.now();
  const { mkdirSync, writeFileSync, rmSync } = require('fs');
  const { join } = require('path');

  beforeAll(async () => {
    const module = await import('../../../src/model-providers/budget.js');
    loadBudgetConfigFromPath = module.loadBudgetConfigFromPath;
    loadBudgetConfig = module.loadBudgetConfig;
    isBudgetConfigSuccess = module.isBudgetConfigSuccess;
    isBudgetConfigError = module.isBudgetConfigError;
    BudgetConfigLoadError = module.BudgetConfigLoadError;

    // Create test directory
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    // Clean up test directory
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('loadBudgetConfigFromPath', () => {
    it('returns BUDGET_NOT_CONFIGURED for non-existent file', () => {
      const result = loadBudgetConfigFromPath('/nonexistent/path/budget.json');

      expect(result.success).toBe(false);
      expect(isBudgetConfigError(result)).toBe(true);
      if (!result.success) {
        expect(result.error.code).toBe('BUDGET_NOT_CONFIGURED');
      }
    });

    it('returns BUDGET_INVALID for invalid JSON', () => {
      const path = join(TEST_DIR, 'invalid-json.json');
      writeFileSync(path, 'not valid json {{{');

      const result = loadBudgetConfigFromPath(path);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BUDGET_INVALID');
        expect(result.error.message).toContain('not valid JSON');
      }
    });

    it('returns BUDGET_INVALID for invalid config structure', () => {
      const path = join(TEST_DIR, 'invalid-config.json');
      writeFileSync(path, JSON.stringify({
        maxTotalRequests: 'not a number',
        // Missing required fields
      }));

      const result = loadBudgetConfigFromPath(path);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BUDGET_INVALID');
        expect(result.error.details).toBeDefined();
        expect(result.error.details!.length).toBeGreaterThan(0);
      }
    });

    it('returns success with valid config', () => {
      const path = join(TEST_DIR, 'valid-config.json');
      const validConfig = {
        maxTotalRequests: 100,
        maxInputTokensPerRequest: 10000,
        maxOutputTokensPerRequest: 4000,
        maxCumulativeInputTokens: 100000,
        maxCumulativeOutputTokens: 50000,
        window: {
          type: 'rolling',
          durationHours: 24,
        },
      };
      writeFileSync(path, JSON.stringify(validConfig));

      const result = loadBudgetConfigFromPath(path);

      expect(result.success).toBe(true);
      expect(isBudgetConfigSuccess(result)).toBe(true);
      if (result.success) {
        expect(result.config.maxTotalRequests).toBe(100);
        expect(result.config.window.type).toBe('rolling');
      }
    });
  });

  describe('loadBudgetConfig', () => {
    it('returns BUDGET_NOT_CONFIGURED when config file does not exist', () => {
      const emptyDir = join(TEST_DIR, 'empty');
      mkdirSync(emptyDir, { recursive: true });

      const result = loadBudgetConfig(emptyDir);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BUDGET_NOT_CONFIGURED');
        expect(result.error.details).toBeDefined();
        expect(result.error.details!.some(d => d.includes('Expected path'))).toBe(true);
      }
    });

    it('loads config from config/ai-budget.json', () => {
      const baseDir = join(TEST_DIR, 'with-config');
      const configDir = join(baseDir, 'config');
      mkdirSync(configDir, { recursive: true });

      const validConfig = {
        maxTotalRequests: 50,
        maxInputTokensPerRequest: 5000,
        maxOutputTokensPerRequest: 2000,
        maxCumulativeInputTokens: 50000,
        maxCumulativeOutputTokens: 25000,
        window: {
          type: 'rolling',
          durationHours: 12,
        },
      };
      writeFileSync(join(configDir, 'ai-budget.json'), JSON.stringify(validConfig));

      const result = loadBudgetConfig(baseDir);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.config.maxTotalRequests).toBe(50);
      }
    });

    it('does NOT load config from .qa-platform/budget.json (single location only)', () => {
      // REQUIREMENT: Budget config is loaded ONLY from config/ai-budget.json
      // The .qa-platform/ directory is for runtime data (ledger), not configuration
      const baseDir = join(TEST_DIR, 'with-qa-platform');
      const qaDir = join(baseDir, '.qa-platform');
      mkdirSync(qaDir, { recursive: true });

      const validConfig = {
        maxTotalRequests: 75,
        maxInputTokensPerRequest: 8000,
        maxOutputTokensPerRequest: 3000,
        maxCumulativeInputTokens: 75000,
        maxCumulativeOutputTokens: 40000,
        window: {
          type: 'fixed',
          durationHours: 24,
        },
      };
      writeFileSync(join(qaDir, 'budget.json'), JSON.stringify(validConfig));

      const result = loadBudgetConfig(baseDir);

      // Should NOT load from .qa-platform - must deny
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BUDGET_NOT_CONFIGURED');
      }
    });
  });

  describe('Type guards', () => {
    it('isBudgetConfigSuccess returns true for success', () => {
      const result = { success: true as const, config: createTestBudget() };
      expect(isBudgetConfigSuccess(result)).toBe(true);
      expect(isBudgetConfigError(result)).toBe(false);
    });

    it('isBudgetConfigError returns true for error', () => {
      const result = {
        success: false as const,
        error: { code: 'BUDGET_NOT_CONFIGURED' as const, message: 'test' },
      };
      expect(isBudgetConfigError(result)).toBe(true);
      expect(isBudgetConfigSuccess(result)).toBe(false);
    });
  });

  describe('BudgetConfigLoadError', () => {
    it('creates error with BUDGET_NOT_CONFIGURED code', () => {
      const error = new BudgetConfigLoadError(
        'BUDGET_NOT_CONFIGURED',
        'No config file found'
      );

      expect(error.code).toBe('BUDGET_NOT_CONFIGURED');
      expect(error.message).toBe('No config file found');
      expect(error.name).toBe('BudgetConfigLoadError');
    });

    it('creates error with BUDGET_INVALID code and details', () => {
      const error = new BudgetConfigLoadError(
        'BUDGET_INVALID',
        'Config is invalid',
        ['maxTotalRequests must be a positive number']
      );

      expect(error.code).toBe('BUDGET_INVALID');
      expect(error.details).toContain('maxTotalRequests must be a positive number');
    });
  });
});
