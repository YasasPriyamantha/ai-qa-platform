/**
 * Tests for usage metadata types.
 *
 * Task 3.3a: Test known/unknown usage representation and
 * separation of observed, estimated, and reserved values.
 */

import { describe, it, expect } from 'vitest';
import {
  knownUsage,
  unknownUsage,
  isKnownUsage,
  isUnknownUsage,
  createUnknownObservedUsage,
  createObservedUsage,
  createReservation,
  reconcileReservation,
  getUsageValueOrUndefined,
  addUsageValues,
  hasCompleteUsage,
} from '../../../src/model-providers/usage.js';

describe('UsageValue creation', () => {
  describe('knownUsage', () => {
    it('creates a known usage value', () => {
      const value = knownUsage(100);

      expect(value.known).toBe(true);
      expect(value.value).toBe(100);
    });

    it('handles zero value', () => {
      const value = knownUsage(0);

      expect(value.known).toBe(true);
      expect(value.value).toBe(0);
    });
  });

  describe('unknownUsage', () => {
    it('creates an unknown usage value without reason', () => {
      const value = unknownUsage();

      expect(value.known).toBe(false);
      expect(value.reason).toBeUndefined();
    });

    it('creates an unknown usage value with reason', () => {
      const value = unknownUsage('not_reported');

      expect(value.known).toBe(false);
      expect(value.reason).toBe('not_reported');
    });

    it('supports all reason types', () => {
      expect(unknownUsage('not_reported').reason).toBe('not_reported');
      expect(unknownUsage('not_applicable').reason).toBe('not_applicable');
      expect(unknownUsage('request_failed').reason).toBe('request_failed');
      expect(unknownUsage('cancelled').reason).toBe('cancelled');
      expect(unknownUsage('timed_out').reason).toBe('timed_out');
      expect(unknownUsage('unknown').reason).toBe('unknown');
    });
  });
});

describe('UsageValue type guards', () => {
  describe('isKnownUsage', () => {
    it('returns true for known values', () => {
      expect(isKnownUsage(knownUsage(100))).toBe(true);
    });

    it('returns false for unknown values', () => {
      expect(isKnownUsage(unknownUsage())).toBe(false);
    });
  });

  describe('isUnknownUsage', () => {
    it('returns true for unknown values', () => {
      expect(isUnknownUsage(unknownUsage())).toBe(true);
    });

    it('returns false for known values', () => {
      expect(isUnknownUsage(knownUsage(100))).toBe(false);
    });
  });
});

describe('ObservedUsage creation', () => {
  describe('createUnknownObservedUsage', () => {
    it('creates all unknown with default reason', () => {
      const observed = createUnknownObservedUsage();

      expect(isUnknownUsage(observed.inputTokens)).toBe(true);
      expect(isUnknownUsage(observed.outputTokens)).toBe(true);
      expect(isUnknownUsage(observed.totalTokens)).toBe(true);
      expect(isUnknownUsage(observed.cachedTokens)).toBe(true);
      expect(isUnknownUsage(observed.reasoningTokens)).toBe(true);

      expect((observed.inputTokens as { reason?: string }).reason).toBe('not_reported');
    });

    it('creates all unknown with custom reason', () => {
      const observed = createUnknownObservedUsage('timed_out');

      expect((observed.inputTokens as { reason?: string }).reason).toBe('timed_out');
      expect((observed.outputTokens as { reason?: string }).reason).toBe('timed_out');
    });
  });

  describe('createObservedUsage', () => {
    it('creates observed usage from known values', () => {
      const observed = createObservedUsage({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      expect(isKnownUsage(observed.inputTokens)).toBe(true);
      expect((observed.inputTokens as { value: number }).value).toBe(100);

      expect(isKnownUsage(observed.outputTokens)).toBe(true);
      expect((observed.outputTokens as { value: number }).value).toBe(50);

      expect(isKnownUsage(observed.totalTokens)).toBe(true);
      expect((observed.totalTokens as { value: number }).value).toBe(150);
    });

    it('handles partial values with unknown for missing fields', () => {
      const observed = createObservedUsage({
        inputTokens: 100,
        outputTokens: 50,
        // totalTokens not provided
      });

      expect(isKnownUsage(observed.inputTokens)).toBe(true);
      expect(isKnownUsage(observed.outputTokens)).toBe(true);
      expect(isUnknownUsage(observed.totalTokens)).toBe(true);
    });

    it('marks optional fields as not_applicable when missing', () => {
      const observed = createObservedUsage({
        inputTokens: 100,
        outputTokens: 50,
      });

      expect(isUnknownUsage(observed.cachedTokens)).toBe(true);
      expect((observed.cachedTokens as { reason?: string }).reason).toBe('not_applicable');

      expect(isUnknownUsage(observed.reasoningTokens)).toBe(true);
      expect((observed.reasoningTokens as { reason?: string }).reason).toBe('not_applicable');
    });

    it('handles zero values correctly (zero is known, not unknown)', () => {
      const observed = createObservedUsage({
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
      });

      expect(isKnownUsage(observed.inputTokens)).toBe(true);
      expect((observed.inputTokens as { value: number }).value).toBe(0);

      expect(isKnownUsage(observed.cachedTokens)).toBe(true);
      expect((observed.cachedTokens as { value: number }).value).toBe(0);
    });
  });
});

describe('ReservedUsage', () => {
  describe('createReservation', () => {
    it('creates a reservation with correct totals', () => {
      const reservation = createReservation(100, 50);

      expect(reservation.inputReserved).toBe(100);
      expect(reservation.outputReserved).toBe(50);
      expect(reservation.totalReserved).toBe(150);
      expect(reservation.reconciled).toBe(false);
      expect(reservation.reconciliation).toBeUndefined();
    });

    it('includes timestamp', () => {
      const before = new Date().toISOString();
      const reservation = createReservation(100, 50);
      const after = new Date().toISOString();

      expect(reservation.reservedAt >= before).toBe(true);
      expect(reservation.reservedAt <= after).toBe(true);
    });
  });

  describe('reconcileReservation', () => {
    it('reconciles when actual usage is less than reserved', () => {
      const reservation = createReservation(100, 50);
      const observed = createObservedUsage({
        inputTokens: 80,
        outputTokens: 40,
      });

      const reconciled = reconcileReservation(reservation, observed);

      expect(reconciled.reconciled).toBe(true);
      expect(reconciled.reconciliation).toBeDefined();
      expect(reconciled.reconciliation!.returnedToBudget).toBe(30); // 150 - 120
      expect(reconciled.reconciliation!.exceededReservation).toBe(false);
    });

    it('handles when actual usage exceeds reservation', () => {
      const reservation = createReservation(100, 50);
      const observed = createObservedUsage({
        inputTokens: 120,
        outputTokens: 60,
      });

      const reconciled = reconcileReservation(reservation, observed);

      expect(reconciled.reconciliation!.returnedToBudget).toBe(0);
      expect(reconciled.reconciliation!.exceededReservation).toBe(true);
    });

    it('conservatively keeps reservation when usage is unknown', () => {
      const reservation = createReservation(100, 50);
      const observed = createUnknownObservedUsage('not_reported');

      const reconciled = reconcileReservation(reservation, observed);

      expect(reconciled.reconciled).toBe(true);
      expect(reconciled.reconciliation!.returnedToBudget).toBe(0); // Keep reservation
      expect(reconciled.reconciliation!.exceededReservation).toBe(false);
    });

    it('conservatively keeps reservation when only some fields are unknown', () => {
      const reservation = createReservation(100, 50);
      const observed = createObservedUsage({
        inputTokens: 80,
        // outputTokens not provided (unknown)
      });

      const reconciled = reconcileReservation(reservation, observed);

      // Both must be known to return anything
      expect(reconciled.reconciliation!.returnedToBudget).toBe(0);
    });

    it('includes reconciliation timestamp', () => {
      const reservation = createReservation(100, 50);
      const observed = createObservedUsage({
        inputTokens: 80,
        outputTokens: 40,
      });

      const before = new Date().toISOString();
      const reconciled = reconcileReservation(reservation, observed);
      const after = new Date().toISOString();

      expect(reconciled.reconciliation!.reconciledAt >= before).toBe(true);
      expect(reconciled.reconciliation!.reconciledAt <= after).toBe(true);
    });
  });
});

describe('UsageValue utilities', () => {
  describe('getUsageValueOrUndefined', () => {
    it('returns value for known usage', () => {
      expect(getUsageValueOrUndefined(knownUsage(100))).toBe(100);
    });

    it('returns undefined for unknown usage', () => {
      expect(getUsageValueOrUndefined(unknownUsage())).toBeUndefined();
    });

    it('handles zero correctly', () => {
      expect(getUsageValueOrUndefined(knownUsage(0))).toBe(0);
    });
  });

  describe('addUsageValues', () => {
    it('adds two known values', () => {
      const result = addUsageValues(knownUsage(100), knownUsage(50));

      expect(isKnownUsage(result)).toBe(true);
      expect((result as { value: number }).value).toBe(150);
    });

    it('returns unknown if first value is unknown', () => {
      const result = addUsageValues(unknownUsage(), knownUsage(50));

      expect(isUnknownUsage(result)).toBe(true);
    });

    it('returns unknown if second value is unknown', () => {
      const result = addUsageValues(knownUsage(100), unknownUsage());

      expect(isUnknownUsage(result)).toBe(true);
    });

    it('returns unknown if both values are unknown', () => {
      const result = addUsageValues(unknownUsage(), unknownUsage());

      expect(isUnknownUsage(result)).toBe(true);
    });
  });
});

describe('Usage separation principle', () => {
  it('observed, estimated, and reserved are distinct types', () => {
    // This test verifies the design principle: these are separate,
    // not interchangeable or merged values

    const observed = createObservedUsage({
      inputTokens: 95, // Actual provider-reported
      outputTokens: 48,
    });

    const estimated = {
      inputEstimate: knownUsage(100), // Preflight estimate
      maxOutputRequested: knownUsage(50),
      method: 'character_ratio' as const,
      safetyMarginPercent: 20,
    };

    const reserved = createReservation(120, 60); // With safety margin

    // These are intentionally different values representing different data:
    // - observed: what the provider reported
    // - estimated: what we calculated before sending
    // - reserved: what we held in budget (with margin)

    expect((observed.inputTokens as { value: number }).value).toBe(95);
    expect((estimated.inputEstimate as { value: number }).value).toBe(100);
    expect(reserved.inputReserved).toBe(120);

    // They should NOT be equal - they represent different things
    expect((observed.inputTokens as { value: number }).value)
      .not.toBe((estimated.inputEstimate as { value: number }).value);
    expect((estimated.inputEstimate as { value: number }).value)
      .not.toBe(reserved.inputReserved);
  });

  it('never treats unknown as zero', () => {
    const observed = createObservedUsage({
      // inputTokens not provided - will be unknown
      outputTokens: 50,
    });

    // Verify unknown is distinct from zero
    expect(isUnknownUsage(observed.inputTokens)).toBe(true);

    // Compare with explicit zero
    const withZero = createObservedUsage({
      inputTokens: 0,
      outputTokens: 50,
    });

    expect(isKnownUsage(withZero.inputTokens)).toBe(true);
    expect((withZero.inputTokens as { value: number }).value).toBe(0);

    // These are semantically different:
    // - unknown: we don't know the value
    // - zero: we know the value is 0
  });
});

describe('hasCompleteUsage', () => {
  it('returns true for complete usage', () => {
    const observed = createObservedUsage({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });

    expect(hasCompleteUsage(observed)).toBe(true);
  });

  it('returns false when any required field is unknown', () => {
    const observed = createObservedUsage({
      inputTokens: 100,
      // outputTokens missing
    });

    expect(hasCompleteUsage(observed)).toBe(false);
  });

  it('returns false for all-unknown usage', () => {
    const observed = createUnknownObservedUsage();

    expect(hasCompleteUsage(observed)).toBe(false);
  });
});

describe('Response contract integration', () => {
  it('known input and unknown output survive unchanged through ResponseBuilder', async () => {
    // Dynamic import to avoid circular dependency issues
    const { ResponseBuilder } = await import('../../../src/model-providers/response.js');

    // Create observed usage with known input but unknown output
    const observed = createObservedUsage({
      inputTokens: 150,
      // outputTokens not provided - will be unknown
      // totalTokens not provided - will be unknown
    });

    // Verify our test data before building
    expect(isKnownUsage(observed.inputTokens)).toBe(true);
    expect((observed.inputTokens as { value: number }).value).toBe(150);
    expect(isUnknownUsage(observed.outputTokens)).toBe(true);
    expect(isUnknownUsage(observed.totalTokens)).toBe(true);

    // Build a response using ResponseBuilder
    const response = new ResponseBuilder()
      .identity({ providerId: 'test-provider', adapterType: 'openai-chat-completions', modelId: 'test-model' })
      .message({ role: 'assistant', content: 'Test response' })
      .timing({
        totalMs: 100,
        requestedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      })
      .usage(observed)
      .build();

    // Verify usage survives unchanged through the response contract
    expect(response.usage).toBeDefined();
    expect(response.usage).toBe(observed); // Same object reference

    // Verify known input is still known with correct value
    expect(isKnownUsage(response.usage!.inputTokens)).toBe(true);
    expect((response.usage!.inputTokens as { value: number }).value).toBe(150);

    // Verify unknown output is still unknown (not converted to zero)
    expect(isUnknownUsage(response.usage!.outputTokens)).toBe(true);
    expect(isUnknownUsage(response.usage!.totalTokens)).toBe(true);
  });
});
