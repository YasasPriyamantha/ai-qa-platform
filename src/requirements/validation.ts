/**
 * Requirement validation utilities
 *
 * Implements validation rules per PROJECT_SPEC.md section 7.2:
 * - An actionable requirement without an unresolved marker must have a non-empty expected result
 * - An unresolved requirement must have a meaningful unresolved reason
 * - An unresolved requirement may omit its expected result and must remain non-actionable
 * - Never invent an expected result
 * - Every negative case must retain its explicitly required expected outcome
 */

import type { Requirement, NegativeCase, UnresolvedMarker } from './types.js';

/**
 * Validation error for requirement data.
 */
export class RequirementValidationError extends Error {
  constructor(
    message: string,
    public readonly requirementId: string,
    public readonly field?: string
  ) {
    super(message);
    this.name = 'RequirementValidationError';
  }
}

/**
 * Validation result for a requirement.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Check if a requirement is actionable (can be used for test generation).
 *
 * A requirement is actionable if:
 * - It has status 'active' (not 'retired')
 * - It does NOT have an unresolved marker
 * - It has a non-empty expectedResult
 */
export function isActionable(requirement: Requirement): boolean {
  if (requirement.status !== 'active') {
    return false;
  }
  if (requirement.unresolved !== undefined) {
    return false;
  }
  if (!requirement.expectedResult || requirement.expectedResult.trim() === '') {
    return false;
  }
  return true;
}

/**
 * Validate a requirement according to project rules.
 *
 * Validation rules:
 * 1. An actionable requirement without an unresolved marker must have a non-empty expected result
 * 2. An unresolved requirement must have a meaningful unresolved reason
 * 3. Every negative case must have a non-empty expected result
 *
 * @param requirement - The requirement to validate
 * @returns Validation result with any errors found
 */
export function validateRequirement(requirement: Requirement): ValidationResult {
  const errors: string[] = [];

  // Rule 1: Actionable requirements must have non-empty expectedResult
  if (requirement.status === 'active' && requirement.unresolved === undefined) {
    if (!requirement.expectedResult || requirement.expectedResult.trim() === '') {
      errors.push(
        'Active requirement without unresolved marker must have a non-empty expectedResult'
      );
    }
  }

  // Rule 2: Unresolved requirements must have a meaningful reason
  if (requirement.unresolved !== undefined) {
    if (!isValidUnresolvedMarker(requirement.unresolved)) {
      errors.push(
        'Unresolved requirement must have a meaningful reason (non-empty string)'
      );
    }
  }

  // Rule 3: Every negative case must have a non-empty expected result
  for (let i = 0; i < requirement.negativeCases.length; i++) {
    const negCase = requirement.negativeCases[i];
    if (!isValidNegativeCase(negCase)) {
      errors.push(
        `Negative case at index ${i} must have a non-empty expectedResult`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if an unresolved marker is valid (has a meaningful reason).
 */
export function isValidUnresolvedMarker(marker: UnresolvedMarker): boolean {
  return (
    marker.reason !== undefined &&
    typeof marker.reason === 'string' &&
    marker.reason.trim().length > 0
  );
}

/**
 * Check if a negative case is valid (has a non-empty expected result).
 *
 * Per PROJECT_SPEC.md: Every negative case must include its expected outcome.
 * This is NOT optional - negative cases always require expected results.
 */
export function isValidNegativeCase(negCase: NegativeCase): boolean {
  return (
    negCase.expectedResult !== undefined &&
    typeof negCase.expectedResult === 'string' &&
    negCase.expectedResult.trim().length > 0
  );
}

/**
 * Validate and throw if invalid.
 *
 * @param requirement - The requirement to validate
 * @throws RequirementValidationError if validation fails
 */
export function assertValidRequirement(requirement: Requirement): void {
  const result = validateRequirement(requirement);
  if (!result.valid) {
    throw new RequirementValidationError(
      result.errors.join('; '),
      requirement.requirementId
    );
  }
}
