/**
 * Tests for requirement validation utilities
 *
 * Verifies validation rules per PROJECT_SPEC.md section 7.2 and
 * REQUIREMENTS_AUTHORING_CONVENTION.md:
 * - Requirement ID format validation
 * - Required fields validation
 * - Actionable requirements must have expectedResult
 * - Unresolved requirements must have meaningful reason
 * - Negative cases must have both condition and expectedOutcome
 * - Source reference validation
 * - Duplicate ID detection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isActionable,
  validateRequirement,
  isValidUnresolvedMarker,
  isValidNegativeCase,
  validateNegativeCase,
  assertValidRequirement,
  RequirementValidationError,
  validateRequirementId,
  isValidRequirementId,
  REQUIREMENT_ID_PATTERN,
  validateSourceReferenceStructure,
  validateSourceReferenceAgainstRegistry,
  checkForDuplicateIds,
  isStructurallyValid,
  isValidButUnresolved,
  VALID_PRIORITIES,
} from '../../../src/requirements/validation.js';
import type { Requirement, NegativeCase, SourceReference } from '../../../src/requirements/types.js';
import type { DocumentRegistry } from '../../../src/documents/types.js';

// Valid SHA-256 hash for testing (64 hex characters)
const VALID_CONTENT_HASH = 'a'.repeat(64);

/**
 * Create a minimal valid requirement for testing.
 */
function createRequirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    projectId: 'test-project',
    requirementId: 'REQ-001',
    title: 'Test Requirement',
    description: 'A test requirement for validation',
    expectedResult: 'The expected behavior',
    negativeCases: [],
    priority: 'medium',
    status: 'active',
    sourceReference: {
      documentId: 'doc-1',
      contentHash: VALID_CONTENT_HASH,
    },
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

/**
 * Create a mock document registry for testing source reference validation.
 */
function createDocumentRegistry(
  documents: Record<string, { contentHashes: string[] }> = {}
): DocumentRegistry {
  const registry: DocumentRegistry = {
    schemaVersion: '1.0',
    updatedAt: new Date().toISOString(),
    documents: {},
  };

  for (const [docId, { contentHashes }] of Object.entries(documents)) {
    registry.documents[docId] = {
      documentId: docId,
      name: docId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versions: contentHashes.map((hash, i) => ({
        contentHash: hash,
        snapshotPath: `sources/${hash}.md`,
        contentSize: 100,
        ingestedAt: new Date().toISOString(),
        sourcePath: `test-${i}.md`,
        format: 'markdown' as const,
      })),
    };
  }

  return registry;
}

// ============================================================================
// Requirement ID Validation Tests
// ============================================================================

describe('validateRequirementId', () => {
  describe('valid IDs', () => {
    it('should accept REQ-001', () => {
      const result = validateRequirementId('REQ-001');
      expect(result.valid).toBe(true);
    });

    it('should accept REQ-1 (single digit)', () => {
      const result = validateRequirementId('REQ-1');
      expect(result.valid).toBe(true);
    });

    it('should accept REQ-1000 (many digits)', () => {
      const result = validateRequirementId('REQ-1000');
      expect(result.valid).toBe(true);
    });

    it('should accept AUTH-001 (different prefix)', () => {
      const result = validateRequirementId('AUTH-001');
      expect(result.valid).toBe(true);
    });

    it('should accept A-1 (minimal)', () => {
      const result = validateRequirementId('A-1');
      expect(result.valid).toBe(true);
    });

    it('should accept TEST42-99 (digits in prefix)', () => {
      const result = validateRequirementId('TEST42-99');
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid IDs', () => {
    it('should reject lowercase', () => {
      const result = validateRequirementId('req-001');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('does not match required format');
    });

    it('should reject underscore', () => {
      const result = validateRequirementId('REQ_001');
      expect(result.valid).toBe(false);
    });

    it('should reject extra hyphen', () => {
      const result = validateRequirementId('REQ-001-A');
      expect(result.valid).toBe(false);
    });

    it('should reject missing numeric suffix', () => {
      const result = validateRequirementId('REQ-');
      expect(result.valid).toBe(false);
    });

    it('should reject missing hyphen', () => {
      const result = validateRequirementId('REQ001');
      expect(result.valid).toBe(false);
    });

    it('should reject starting with digit', () => {
      const result = validateRequirementId('1REQ-001');
      expect(result.valid).toBe(false);
    });

    it('should reject empty string', () => {
      const result = validateRequirementId('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must not be empty');
    });

    it('should reject whitespace-only', () => {
      const result = validateRequirementId('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('whitespace-only');
    });

    it('should reject null', () => {
      const result = validateRequirementId(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject undefined', () => {
      const result = validateRequirementId(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    it('should reject non-string', () => {
      const result = validateRequirementId(123);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be a string');
    });
  });

  describe('ID comparison (no normalization)', () => {
    it('should treat REQ-01 and REQ-001 as different IDs', () => {
      // Both are valid but distinct
      expect(validateRequirementId('REQ-01').valid).toBe(true);
      expect(validateRequirementId('REQ-001').valid).toBe(true);
      // They should be compared as exact strings (tested elsewhere in duplicate check)
    });
  });
});

describe('isValidRequirementId', () => {
  it('should return true for valid ID', () => {
    expect(isValidRequirementId('REQ-001')).toBe(true);
  });

  it('should return false for invalid ID', () => {
    expect(isValidRequirementId('req-001')).toBe(false);
  });

  it('should narrow type to string', () => {
    const id: unknown = 'REQ-001';
    if (isValidRequirementId(id)) {
      // TypeScript should know id is string here
      expect(id.toUpperCase()).toBe('REQ-001');
    }
  });
});

describe('REQUIREMENT_ID_PATTERN', () => {
  it('should match valid IDs', () => {
    expect(REQUIREMENT_ID_PATTERN.test('REQ-001')).toBe(true);
    expect(REQUIREMENT_ID_PATTERN.test('AUTH-1')).toBe(true);
    expect(REQUIREMENT_ID_PATTERN.test('TEST99-42')).toBe(true);
  });

  it('should not match invalid IDs', () => {
    expect(REQUIREMENT_ID_PATTERN.test('req-001')).toBe(false);
    expect(REQUIREMENT_ID_PATTERN.test('REQ_001')).toBe(false);
    expect(REQUIREMENT_ID_PATTERN.test('REQ001')).toBe(false);
  });
});

// ============================================================================
// isActionable Tests
// ============================================================================

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

  it('should return false even when both expectedResult AND unresolved are present', () => {
    // Per section 5.6: unresolved marker takes precedence
    const req = createRequirement({
      status: 'active',
      expectedResult: 'Some expected behavior',
      unresolved: { reason: 'But there is ambiguity about X' },
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

// ============================================================================
// validateRequirement Tests
// ============================================================================

describe('validateRequirement', () => {
  describe('required fields', () => {
    it('should fail when projectId is missing', () => {
      const req = createRequirement();
      (req as unknown as Record<string, unknown>).projectId = undefined;
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('projectId is required');
    });

    it('should fail when projectId is empty', () => {
      const req = createRequirement({ projectId: '' });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('projectId must not be empty');
    });

    it('should fail when title is missing', () => {
      const req = createRequirement();
      (req as unknown as Record<string, unknown>).title = undefined;
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('title is required');
    });

    it('should fail when description is missing', () => {
      const req = createRequirement();
      (req as unknown as Record<string, unknown>).description = undefined;
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('description is required');
    });
  });

  describe('status validation', () => {
    it('should accept active status', () => {
      const req = createRequirement({ status: 'active' });
      const result = validateRequirement(req);
      expect(result.valid).toBe(true);
    });

    it('should accept retired status', () => {
      const req = createRequirement({ status: 'retired' });
      const result = validateRequirement(req);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid status', () => {
      const req = createRequirement();
      (req as unknown as Record<string, unknown>).status = 'pending';
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('status must be one of'))).toBe(true);
    });
  });

  describe('priority validation', () => {
    for (const priority of VALID_PRIORITIES) {
      it(`should accept ${priority} priority`, () => {
        const req = createRequirement({ priority });
        const result = validateRequirement(req);
        expect(result.valid).toBe(true);
      });
    }

    it('should reject invalid priority', () => {
      const req = createRequirement();
      (req as unknown as Record<string, unknown>).priority = 'urgent';
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('priority must be one of'))).toBe(true);
    });
  });

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

    it('should preserve expectedResult when both present (unresolved takes precedence)', () => {
      const req = createRequirement({
        status: 'active',
        expectedResult: 'Partial expected behavior',
        unresolved: { reason: 'Some aspects remain ambiguous' },
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(true);
      // expectedResult is preserved for context
      expect(req.expectedResult).toBe('Partial expected behavior');
      // But requirement is not actionable (tested in isActionable tests)
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
          { condition: 'Empty username', expectedOutcome: 'Show error message' },
          { condition: 'Invalid password', expectedOutcome: 'Show auth error' },
        ],
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(true);
    });

    it('should fail validation when negative case has empty expectedOutcome', () => {
      const req = createRequirement({
        negativeCases: [
          { condition: 'Empty username', expectedOutcome: '' },
        ],
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Negative case at index 0'))).toBe(true);
      expect(result.errors.some(e => e.includes('expectedOutcome'))).toBe(true);
    });

    it('should fail validation when negative case has empty condition', () => {
      const req = createRequirement({
        negativeCases: [
          { condition: '', expectedOutcome: 'Show error' },
        ],
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('condition'))).toBe(true);
    });

    it('should fail validation for all invalid negative cases', () => {
      const req = createRequirement({
        negativeCases: [
          { condition: 'Case 1', expectedOutcome: 'Valid' },
          { condition: 'Case 2', expectedOutcome: '' },
          { condition: '', expectedOutcome: 'Valid' },
        ],
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      // Should have errors for indices 1 and 2
      expect(result.errors.some(e => e.includes('index 1'))).toBe(true);
      expect(result.errors.some(e => e.includes('index 2'))).toBe(true);
    });
  });

  describe('source reference validation', () => {
    it('should fail when sourceReference is missing', () => {
      const req = createRequirement();
      (req as unknown as Record<string, unknown>).sourceReference = undefined;
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('sourceReference is required'))).toBe(true);
    });

    it('should fail when sourceReference.documentId is empty', () => {
      const req = createRequirement({
        sourceReference: {
          documentId: '',
          contentHash: VALID_CONTENT_HASH,
        },
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('documentId'))).toBe(true);
    });

    it('should fail when sourceReference.contentHash is invalid', () => {
      const req = createRequirement({
        sourceReference: {
          documentId: 'doc-1',
          contentHash: 'not-a-hash',
        },
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('contentHash'))).toBe(true);
    });

    it('should pass with valid sourceReference and lineRange', () => {
      const req = createRequirement({
        sourceReference: {
          documentId: 'doc-1',
          contentHash: VALID_CONTENT_HASH,
          section: 'REQ-001: Test requirement',
          lineRange: { start: 10, end: 25 },
        },
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(true);
    });
  });

  describe('validation options', () => {
    it('should skip ID validation when skipIdValidation is true', () => {
      const req = createRequirement({ requirementId: 'invalid-id' });
      const result = validateRequirement(req, { skipIdValidation: true });
      // Should not have ID format error, but may have other errors
      expect(result.errors.every(e => !e.includes('does not match required format'))).toBe(true);
    });

    it('should skip source reference validation when skipSourceReferenceValidation is true', () => {
      const req = createRequirement({
        sourceReference: {
          documentId: '',
          contentHash: 'invalid',
        },
      });
      const result = validateRequirement(req, { skipSourceReferenceValidation: true });
      // Should not have source reference errors
      expect(result.errors.every(e => !e.includes('sourceReference'))).toBe(true);
    });
  });

  describe('multiple validation errors', () => {
    it('should report all validation errors', () => {
      const req = createRequirement({
        status: 'active',
        expectedResult: undefined,
        unresolved: { reason: '' }, // Invalid - empty reason
        negativeCases: [
          { condition: '', expectedOutcome: '' }, // Both invalid
        ],
      });
      const result = validateRequirement(req);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});

// ============================================================================
// Unresolved Marker Tests
// ============================================================================

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

// ============================================================================
// Negative Case Validation Tests
// ============================================================================

describe('validateNegativeCase', () => {
  it('should pass for valid negative case', () => {
    const negCase: NegativeCase = {
      condition: 'Invalid input',
      expectedOutcome: 'Show validation error',
    };
    const result = validateNegativeCase(negCase);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when condition is missing', () => {
    const negCase = { expectedOutcome: 'Show error' } as NegativeCase;
    const result = validateNegativeCase(negCase);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('condition is required');
  });

  it('should fail when expectedOutcome is missing', () => {
    const negCase = { condition: 'Invalid input' } as NegativeCase;
    const result = validateNegativeCase(negCase);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('expectedOutcome is required');
  });

  it('should fail when both are empty', () => {
    const negCase: NegativeCase = {
      condition: '',
      expectedOutcome: '',
    };
    const result = validateNegativeCase(negCase);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

describe('isValidNegativeCase', () => {
  it('should return true for valid negative case', () => {
    const negCase: NegativeCase = {
      condition: 'Invalid input',
      expectedOutcome: 'Show validation error',
    };
    expect(isValidNegativeCase(negCase)).toBe(true);
  });

  it('should return false for empty expectedOutcome', () => {
    const negCase: NegativeCase = {
      condition: 'Invalid input',
      expectedOutcome: '',
    };
    expect(isValidNegativeCase(negCase)).toBe(false);
  });

  it('should return false for whitespace-only expectedOutcome', () => {
    const negCase: NegativeCase = {
      condition: 'Invalid input',
      expectedOutcome: '   ',
    };
    expect(isValidNegativeCase(negCase)).toBe(false);
  });

  it('should return false for empty condition', () => {
    const negCase: NegativeCase = {
      condition: '',
      expectedOutcome: 'Show error',
    };
    expect(isValidNegativeCase(negCase)).toBe(false);
  });
});

// ============================================================================
// Source Reference Validation Tests
// ============================================================================

describe('validateSourceReferenceStructure', () => {
  it('should pass for valid source reference', () => {
    const ref: SourceReference = {
      documentId: 'doc-1',
      contentHash: VALID_CONTENT_HASH,
    };
    const result = validateSourceReferenceStructure(ref);
    expect(result.valid).toBe(true);
  });

  it('should pass with optional fields', () => {
    const ref: SourceReference = {
      documentId: 'doc-1',
      contentHash: VALID_CONTENT_HASH,
      section: 'REQ-001: Test',
      lineRange: { start: 1, end: 10 },
    };
    const result = validateSourceReferenceStructure(ref);
    expect(result.valid).toBe(true);
  });

  it('should fail for null', () => {
    const result = validateSourceReferenceStructure(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('sourceReference is required');
  });

  it('should fail for non-object', () => {
    const result = validateSourceReferenceStructure('not an object');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('sourceReference must be an object');
  });

  it('should fail for missing documentId', () => {
    const ref = { contentHash: VALID_CONTENT_HASH };
    const result = validateSourceReferenceStructure(ref);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('documentId is required'))).toBe(true);
  });

  it('should fail for invalid contentHash format', () => {
    const ref = {
      documentId: 'doc-1',
      contentHash: 'not-64-hex-chars',
    };
    const result = validateSourceReferenceStructure(ref);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('64-character hex'))).toBe(true);
  });

  describe('lineRange validation', () => {
    it('should fail when start is missing', () => {
      const ref = {
        documentId: 'doc-1',
        contentHash: VALID_CONTENT_HASH,
        lineRange: { end: 10 },
      };
      const result = validateSourceReferenceStructure(ref);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('start is required'))).toBe(true);
    });

    it('should fail when start is 0 (must be 1-based)', () => {
      const ref = {
        documentId: 'doc-1',
        contentHash: VALID_CONTENT_HASH,
        lineRange: { start: 0, end: 10 },
      };
      const result = validateSourceReferenceStructure(ref);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('>= 1'))).toBe(true);
    });

    it('should fail when start > end', () => {
      const ref = {
        documentId: 'doc-1',
        contentHash: VALID_CONTENT_HASH,
        lineRange: { start: 20, end: 10 },
      };
      const result = validateSourceReferenceStructure(ref);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('start (20) must be <= end (10)'))).toBe(true);
    });
  });
});

describe('validateSourceReferenceAgainstRegistry', () => {
  it('should pass when document and version exist', () => {
    const ref: SourceReference = {
      documentId: 'doc-1',
      contentHash: VALID_CONTENT_HASH,
    };
    const registry = createDocumentRegistry({
      'doc-1': { contentHashes: [VALID_CONTENT_HASH] },
    });
    const result = validateSourceReferenceAgainstRegistry(ref, registry);
    expect(result.valid).toBe(true);
  });

  it('should fail when document does not exist', () => {
    const ref: SourceReference = {
      documentId: 'nonexistent',
      contentHash: VALID_CONTENT_HASH,
    };
    const registry = createDocumentRegistry({
      'doc-1': { contentHashes: [VALID_CONTENT_HASH] },
    });
    const result = validateSourceReferenceAgainstRegistry(ref, registry);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('not found in document registry'))).toBe(true);
  });

  it('should fail when version does not exist', () => {
    const differentHash = 'b'.repeat(64);
    const ref: SourceReference = {
      documentId: 'doc-1',
      contentHash: differentHash,
    };
    const registry = createDocumentRegistry({
      'doc-1': { contentHashes: [VALID_CONTENT_HASH] },
    });
    const result = validateSourceReferenceAgainstRegistry(ref, registry);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('not found in document'))).toBe(true);
  });

  it('should pass when version exists among multiple versions', () => {
    const hash2 = 'b'.repeat(64);
    const hash3 = 'c'.repeat(64);
    const ref: SourceReference = {
      documentId: 'doc-1',
      contentHash: hash2,
    };
    const registry = createDocumentRegistry({
      'doc-1': { contentHashes: [VALID_CONTENT_HASH, hash2, hash3] },
    });
    const result = validateSourceReferenceAgainstRegistry(ref, registry);
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// Duplicate ID Detection Tests
// ============================================================================

describe('checkForDuplicateIds', () => {
  it('should return valid for unique IDs', () => {
    const requirements = [
      { requirementId: 'REQ-001' },
      { requirementId: 'REQ-002' },
      { requirementId: 'REQ-003' },
    ];
    const result = checkForDuplicateIds(requirements);
    expect(result.valid).toBe(true);
    expect(result.duplicates).toHaveLength(0);
  });

  it('should detect duplicate IDs', () => {
    const requirements = [
      { requirementId: 'REQ-001' },
      { requirementId: 'REQ-002' },
      { requirementId: 'REQ-001' }, // Duplicate
    ];
    const result = checkForDuplicateIds(requirements);
    expect(result.valid).toBe(false);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].requirementId).toBe('REQ-001');
    expect(result.duplicates[0].indices).toEqual([0, 2]);
  });

  it('should detect multiple different duplicates', () => {
    const requirements = [
      { requirementId: 'REQ-001' },
      { requirementId: 'REQ-002' },
      { requirementId: 'REQ-001' }, // Duplicate
      { requirementId: 'REQ-002' }, // Another duplicate
    ];
    const result = checkForDuplicateIds(requirements);
    expect(result.valid).toBe(false);
    expect(result.duplicates).toHaveLength(2);
  });

  it('should compare IDs as exact strings (no normalization)', () => {
    // REQ-01 and REQ-001 are different IDs
    const requirements = [
      { requirementId: 'REQ-01' },
      { requirementId: 'REQ-001' },
    ];
    const result = checkForDuplicateIds(requirements);
    expect(result.valid).toBe(true);
    expect(result.duplicates).toHaveLength(0);
  });

  it('should handle empty array', () => {
    const result = checkForDuplicateIds([]);
    expect(result.valid).toBe(true);
    expect(result.duplicates).toHaveLength(0);
  });
});

// ============================================================================
// Structural Validity vs Unresolved Tests
// ============================================================================

describe('isStructurallyValid', () => {
  it('should return true for valid actionable requirement', () => {
    const req = createRequirement();
    expect(isStructurallyValid(req)).toBe(true);
  });

  it('should return true for valid unresolved requirement', () => {
    const req = createRequirement({
      expectedResult: undefined,
      unresolved: { reason: 'Behavior is ambiguous' },
    });
    expect(isStructurallyValid(req)).toBe(true);
  });

  it('should return false for requirement with missing required fields', () => {
    const req = createRequirement();
    (req as unknown as Record<string, unknown>).title = undefined;
    expect(isStructurallyValid(req)).toBe(false);
  });
});

describe('isValidButUnresolved', () => {
  it('should return true for valid unresolved requirement', () => {
    const req = createRequirement({
      expectedResult: undefined,
      unresolved: { reason: 'Behavior is ambiguous' },
    });
    expect(isValidButUnresolved(req)).toBe(true);
  });

  it('should return true when both expectedResult and unresolved are present', () => {
    const req = createRequirement({
      expectedResult: 'Partial expected behavior',
      unresolved: { reason: 'Some aspects remain unclear' },
    });
    expect(isValidButUnresolved(req)).toBe(true);
  });

  it('should return false for actionable requirement', () => {
    const req = createRequirement();
    expect(isValidButUnresolved(req)).toBe(false);
  });

  it('should return false for structurally invalid requirement', () => {
    const req = createRequirement({
      unresolved: { reason: 'Has unresolved marker' },
    });
    (req as unknown as Record<string, unknown>).title = undefined; // Make structurally invalid
    expect(isValidButUnresolved(req)).toBe(false);
  });

  it('should return false for unresolved requirement with invalid reason', () => {
    const req = createRequirement({
      expectedResult: undefined,
      unresolved: { reason: '' }, // Invalid empty reason
    });
    expect(isValidButUnresolved(req)).toBe(false);
  });
});

// ============================================================================
// assertValidRequirement Tests
// ============================================================================

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

// ============================================================================
// Project-Scoped Requirement Validation Tests
// ============================================================================

import { validateRequirementsForProject } from '../../../src/requirements/validation.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Create a minimal project structure for testing.
 */
function createTestProject(
  projectDataRoot: string,
  projectId: string,
  documents: Record<string, { contentHashes: string[] }> = {}
): string {
  const workspace = join(projectDataRoot, projectId);
  mkdirSync(workspace, { recursive: true });

  // Create project.config.json
  const config = {
    projectId,
    name: `Test Project ${projectId}`,
    baseUrl: 'http://localhost',
    environment: 'local',
    allowedDomains: ['localhost'],
    testDirectory: 'tests/approved',
    artifactDirectory: 'artifacts',
  };
  writeFileSync(
    join(workspace, 'project.config.json'),
    JSON.stringify(config, null, 2)
  );

  // Create required directories
  mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
  mkdirSync(join(workspace, 'artifacts'), { recursive: true });

  // Create document registry if documents provided
  if (Object.keys(documents).length > 0) {
    const documentsDir = join(workspace, 'documents');
    mkdirSync(documentsDir, { recursive: true });

    const registry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {} as Record<string, unknown>,
    };

    for (const [docId, { contentHashes }] of Object.entries(documents)) {
      registry.documents[docId] = {
        documentId: docId,
        name: docId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: contentHashes.map((hash, i) => ({
          contentHash: hash,
          snapshotPath: `sources/${hash}.md`,
          contentSize: 100,
          ingestedAt: new Date().toISOString(),
          sourcePath: `test-${i}.md`,
          format: 'markdown',
        })),
      };
    }

    writeFileSync(
      join(documentsDir, 'documents.json'),
      JSON.stringify(registry, null, 2)
    );
  }

  return workspace;
}

describe('validateRequirementsForProject', () => {
  let tempRoot: string;

  beforeEach(() => {
    // Create unique temp directory for each test
    tempRoot = join(tmpdir(), `req-validation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    // Cleanup temp directories
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Test A - correct project', () => {
    it('should pass validation for requirement with matching projectId and valid source reference', () => {
      // Setup Project A with a document
      const projectId = 'project-a';
      createTestProject(tempRoot, projectId, {
        'doc-1': { contentHashes: [VALID_CONTENT_HASH] },
      });

      // Create requirement for Project A
      const requirement = createRequirement({
        projectId: 'project-a',
        sourceReference: {
          documentId: 'doc-1',
          contentHash: VALID_CONTENT_HASH,
        },
      });

      const result = validateRequirementsForProject(
        projectId,
        [requirement],
        { projectServiceOptions: { projectDataRoot: tempRoot } }
      );

      expect(result.valid).toBe(true);
      expect(result.projectId).toBe(projectId);
      expect(result.failures).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
      expect(result.totalValidated).toBe(1);
    });
  });

  describe('Test B - cross-project validation rejection', () => {
    it('should fail when Project A requirement is validated through Project B entry point', () => {
      // Create both projects with SAME documentId and contentHash
      const hashA = VALID_CONTENT_HASH; // Same hash used by both

      createTestProject(tempRoot, 'project-a', {
        'doc-1': { contentHashes: [hashA] },
      });

      createTestProject(tempRoot, 'project-b', {
        'doc-1': { contentHashes: [hashA] }, // Same document ID and hash!
      });

      // Create requirement that belongs to Project A
      const requirementForA = createRequirement({
        projectId: 'project-a', // This is Project A's requirement
        sourceReference: {
          documentId: 'doc-1',
          contentHash: hashA,
        },
      });

      // Validate through Project B's entry point - should FAIL
      const result = validateRequirementsForProject(
        'project-b', // Validating against Project B
        [requirementForA], // But requirement belongs to Project A
        { projectServiceOptions: { projectDataRoot: tempRoot } }
      );

      expect(result.valid).toBe(false);
      expect(result.projectId).toBe('project-b');
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].requirementId).toBe('REQ-001');
      expect(result.failures[0].errors.some(e =>
        e.includes('project-a') && e.includes('project-b')
      )).toBe(true);
    });
  });

  describe('Test C - explicit projectId mismatch', () => {
    it('should reject requirement with projectId that does not match validation target', () => {
      createTestProject(tempRoot, 'project-a', {
        'doc-1': { contentHashes: [VALID_CONTENT_HASH] },
      });

      // Requirement claims to belong to a different project
      const requirement = createRequirement({
        projectId: 'some-other-project',
        sourceReference: {
          documentId: 'doc-1',
          contentHash: VALID_CONTENT_HASH,
        },
      });

      const result = validateRequirementsForProject(
        'project-a',
        [requirement],
        { projectServiceOptions: { projectDataRoot: tempRoot } }
      );

      expect(result.valid).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].errors.some(e =>
        e.includes('does not match target project')
      )).toBe(true);
    });
  });

  describe('Test D - missing registry', () => {
    it('should fail with REGISTRY_NOT_FOUND when document registry is missing', () => {
      // Create project WITHOUT documents directory
      createTestProject(tempRoot, 'project-no-registry', {});

      // Create requirement with source reference (requires registry)
      const requirement = createRequirement({
        projectId: 'project-no-registry',
        sourceReference: {
          documentId: 'doc-1',
          contentHash: VALID_CONTENT_HASH,
        },
      });

      const result = validateRequirementsForProject(
        'project-no-registry',
        [requirement],
        { projectServiceOptions: { projectDataRoot: tempRoot } }
      );

      expect(result.valid).toBe(false);
      expect(result.projectError).toBeDefined();
      expect(result.projectError!.code).toBe('REGISTRY_NOT_FOUND');
      expect(result.projectError!.message).toContain('Document registry not found');
    });

    it('should not fail for empty registry when no requirements have source references', () => {
      // Create project WITHOUT documents directory
      createTestProject(tempRoot, 'project-no-docs', {});

      // Create requirement WITHOUT source reference
      const requirement = createRequirement({
        projectId: 'project-no-docs',
      });
      // Remove source reference to simulate parsing case where no source reference is needed
      (requirement as unknown as { sourceReference: undefined }).sourceReference = undefined;

      // This should fail validation for different reason (missing sourceReference is required)
      const result = validateRequirementsForProject(
        'project-no-docs',
        [requirement],
        { projectServiceOptions: { projectDataRoot: tempRoot } }
      );

      // Should fail due to missing sourceReference in requirement, not registry
      expect(result.valid).toBe(false);
      expect(result.projectError).toBeUndefined();
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].errors.some(e => e.includes('sourceReference'))).toBe(true);
    });
  });

  describe('Test E - duplicate detection', () => {
    it('should detect duplicate requirement IDs through project-level entry point', () => {
      createTestProject(tempRoot, 'project-dups', {
        'doc-1': { contentHashes: [VALID_CONTENT_HASH] },
      });

      // Create requirements with duplicate IDs
      const req1 = createRequirement({
        projectId: 'project-dups',
        requirementId: 'REQ-001',
        sourceReference: {
          documentId: 'doc-1',
          contentHash: VALID_CONTENT_HASH,
        },
      });

      const req2 = createRequirement({
        projectId: 'project-dups',
        requirementId: 'REQ-002',
        sourceReference: {
          documentId: 'doc-1',
          contentHash: VALID_CONTENT_HASH,
        },
      });

      const req3 = createRequirement({
        projectId: 'project-dups',
        requirementId: 'REQ-001', // Duplicate!
        sourceReference: {
          documentId: 'doc-1',
          contentHash: VALID_CONTENT_HASH,
        },
      });

      const result = validateRequirementsForProject(
        'project-dups',
        [req1, req2, req3],
        { projectServiceOptions: { projectDataRoot: tempRoot } }
      );

      expect(result.valid).toBe(false);
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0].requirementId).toBe('REQ-001');
      expect(result.duplicates[0].indices).toEqual([0, 2]);
    });
  });

  describe('project load failures', () => {
    it('should fail with PROJECT_LOAD_FAILED for non-existent project', () => {
      const result = validateRequirementsForProject(
        'nonexistent-project',
        [createRequirement()],
        { projectServiceOptions: { projectDataRoot: tempRoot } }
      );

      expect(result.valid).toBe(false);
      expect(result.projectError).toBeDefined();
      expect(result.projectError!.code).toBe('PROJECT_LOAD_FAILED');
      expect(result.projectError!.message).toContain('nonexistent-project');
    });
  });

  describe('source reference validation through project context', () => {
    it('should fail when document does not exist in project registry', () => {
      createTestProject(tempRoot, 'project-ref', {
        'doc-1': { contentHashes: [VALID_CONTENT_HASH] },
      });

      const requirement = createRequirement({
        projectId: 'project-ref',
        sourceReference: {
          documentId: 'nonexistent-doc', // This doc doesn't exist
          contentHash: VALID_CONTENT_HASH,
        },
      });

      const result = validateRequirementsForProject(
        'project-ref',
        [requirement],
        { projectServiceOptions: { projectDataRoot: tempRoot } }
      );

      expect(result.valid).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].errors.some(e =>
        e.includes('not found in document registry')
      )).toBe(true);
    });

    it('should fail when contentHash does not exist in document versions', () => {
      createTestProject(tempRoot, 'project-hash', {
        'doc-1': { contentHashes: [VALID_CONTENT_HASH] },
      });

      const differentHash = 'b'.repeat(64);
      const requirement = createRequirement({
        projectId: 'project-hash',
        sourceReference: {
          documentId: 'doc-1',
          contentHash: differentHash, // This version doesn't exist
        },
      });

      const result = validateRequirementsForProject(
        'project-hash',
        [requirement],
        { projectServiceOptions: { projectDataRoot: tempRoot } }
      );

      expect(result.valid).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].errors.some(e =>
        e.includes('not found in document')
      )).toBe(true);
    });
  });
});
