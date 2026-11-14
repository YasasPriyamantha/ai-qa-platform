/**
 * Tests for requirement validation utilities
 *
 * Verifies validation rules per PROJECT_SPEC.md section 7.2:
 * - Actionable requirements without unresolved marker must have expectedResult
 * - Unresolved requirements must have meaningful reason
 * - Unresolved requirements may omit expectedResult
 * - Every negative case must have expectedResult
 */

import { describe, it, expect } from 'vitest';
import {
  isActionable,
  validateRequirement,
  isValidUnresolvedMarker,
  isValidNegativeCase,
  assertValidRequirement,
  RequirementValidationError,
} from '../../../src/requirements/validation.js';
import type { Requirement, NegativeCase } from '../../../src/requirements/types.js';

/**
 * Create a minimal valid requirement for testing.
 */
function createRequirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    requirementId: 'REQ-001',
    title: 'Test Requirement',
    description: 'A test requirement for validation',
    expectedResult: 'The expected behavior',
    negativeCases: [],
    priority: 'medium',
    status: 'active',
    sourceReference: {
      documentId: 'doc-1',
      documentHash: 'abc123',
    },
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

describe('isActionable', () => {
  it('should return true for active requirement with expectedResult and no unresolved marker', () => {
    const req = createRequirement({
      status: 'active',
      expectedResult: 'Expected behavior',
    });
    expect(isActionable(req)).toBe(true);
  });

  it('should return false for retired requirements', () => {
    const req = createRequirement({
      status: 'retired',
      expectedResult: 'Expected behavior',
    });
    expect(isActionable(req)).toBe(false);
  });

  it('should return false for requirements with unresolved marker', () => {
    const req = createRequirement({
      status: 'active',
      expectedResult: 'Expected behavior',
      unresolved: { reason: 'Ambiguous behavior description' },
    });
    expect(isActionable(req)).toBe(false);
  });

  it('should return false for active requirements without expectedResult', () => {
    const req = createRequirement({
      status: 'active',
      expectedResult: undefined,
    });
    expect(isActionable(req)).toBe(false);
  });

  it('should return false for active requirements with empty expectedResult', () => {
    const req = createRequirement({
      status: 'active',
      expectedResult: '',
    });
    expect(isActionable(req)).toBe(false);
  });

  it('should return false for active requirements with whitespace-only expectedResult', () => {
    const req = createRequirement({
      status: 'active',
      expectedResult: '   ',
    });
    expect(isActionable(req)).toBe(false);
  });
});

describe('validateRequirement', () => {
  describe('active requirements without unresolved marker', () => {
    it('should pass validation with non-empty expectedResult', () => {
      const req = createRequirement({
        status: 'active',
        expectedResult: 'The system should do X',
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation without expectedResult', () => {
      const req = createRequirement({
        status: 'active',
        expectedResult: undefined,
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Active requirement without unresolved marker must have a non-empty expectedResult'
      );
    });

    it('should fail validation with empty expectedResult', () => {
      const req = createRequirement({
        status: 'active',
        expectedResult: '',
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
    });

    it('should fail validation with whitespace-only expectedResult', () => {
      const req = createRequirement({
        status: 'active',
        expectedResult: '   \n\t  ',
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
    });
  });

  describe('requirements with unresolved marker', () => {
    it('should allow omitting expectedResult when unresolved', () => {
      const req = createRequirement({
        status: 'active',
        expectedResult: undefined,
        unresolved: { reason: 'Expected behavior is ambiguous' },
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow empty expectedResult when unresolved', () => {
      const req = createRequirement({
        status: 'active',
        expectedResult: '',
        unresolved: { reason: 'Missing expected result in source document' },
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(true);
    });

    it('should fail validation with empty unresolved reason', () => {
      const req = createRequirement({
        status: 'active',
        expectedResult: undefined,
        unresolved: { reason: '' },
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Unresolved requirement must have a meaningful reason (non-empty string)'
      );
    });

    it('should fail validation with whitespace-only unresolved reason', () => {
      const req = createRequirement({
        status: 'active',
        expectedResult: undefined,
        unresolved: { reason: '   ' },
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
    });
  });

  describe('retired requirements', () => {
    it('should pass validation for retired requirement without expectedResult', () => {
      const req = createRequirement({
        status: 'retired',
        expectedResult: undefined,
        retiredAt: '2026-01-20T10:00:00Z',
        retirementReason: 'Feature removed',
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(true);
    });

    it('should pass validation for retired requirement with expectedResult', () => {
      const req = createRequirement({
        status: 'retired',
        expectedResult: 'Original expected behavior',
        retiredAt: '2026-01-20T10:00:00Z',
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(true);
    });
  });

  describe('negative cases', () => {
    it('should pass validation with valid negative cases', () => {
      const req = createRequirement({
        negativeCases: [
          { scenario: 'Empty username', expectedResult: 'Show error message' },
          { scenario: 'Invalid password', expectedResult: 'Show auth error' },
        ],
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(true);
    });

    it('should fail validation when negative case has empty expectedResult', () => {
      const req = createRequirement({
        negativeCases: [
          { scenario: 'Empty username', expectedResult: '' },
        ],
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Negative case at index 0 must have a non-empty expectedResult'
      );
    });

    it('should fail validation for all invalid negative cases', () => {
      const req = createRequirement({
        negativeCases: [
          { scenario: 'Case 1', expectedResult: 'Valid' },
          { scenario: 'Case 2', expectedResult: '' },
          { scenario: 'Case 3', expectedResult: '   ' },
        ],
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('multiple validation errors', () => {
    it('should report all validation errors', () => {
      const req = createRequirement({
        status: 'active',
        expectedResult: undefined,
        unresolved: { reason: '' }, // Invalid - empty reason
        negativeCases: [
          { scenario: 'Test', expectedResult: '' }, // Invalid
        ],
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('isValidUnresolvedMarker', () => {
  it('should return true for valid marker with reason', () => {
    expect(isValidUnresolvedMarker({ reason: 'Ambiguous behavior' })).toBe(true);
  });

  it('should return false for empty reason', () => {
    expect(isValidUnresolvedMarker({ reason: '' })).toBe(false);
  });

  it('should return false for whitespace-only reason', () => {
    expect(isValidUnresolvedMarker({ reason: '   ' })).toBe(false);
  });
});

describe('isValidNegativeCase', () => {
  it('should return true for valid negative case', () => {
    const negCase: NegativeCase = {
      scenario: 'Invalid input',
      expectedResult: 'Show validation error',
    };
    expect(isValidNegativeCase(negCase)).toBe(true);
  });

  it('should return false for empty expectedResult', () => {
    const negCase: NegativeCase = {
      scenario: 'Invalid input',
      expectedResult: '',
    };
    expect(isValidNegativeCase(negCase)).toBe(false);
  });

  it('should return false for whitespace-only expectedResult', () => {
    const negCase: NegativeCase = {
      scenario: 'Invalid input',
      expectedResult: '   ',
    };
    expect(isValidNegativeCase(negCase)).toBe(false);
  });
});

describe('assertValidRequirement', () => {
  it('should not throw for valid requirement', () => {
    const req = createRequirement();
    expect(() => assertValidRequirement(req)).not.toThrow();
  });

  it('should throw RequirementValidationError for invalid requirement', () => {
    const req = createRequirement({
      status: 'active',
      expectedResult: undefined,
    });
    expect(() => assertValidRequirement(req)).toThrow(RequirementValidationError);
  });

  it('should include requirementId in error', () => {
    const req = createRequirement({
      requirementId: 'REQ-999',
      status: 'active',
      expectedResult: undefined,
    });
    try {
      assertValidRequirement(req);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RequirementValidationError);
      expect((err as RequirementValidationError).requirementId).toBe('REQ-999');
    }
  });
});
