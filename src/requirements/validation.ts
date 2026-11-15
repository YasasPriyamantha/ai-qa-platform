/**
 * Requirement validation utilities
 *
 * Implements validation rules per PROJECT_SPEC.md section 7.2 and
 * REQUIREMENTS_AUTHORING_CONVENTION.md:
 *
 * - Requirement ID format: ^[A-Z][A-Z0-9]*-\d+$
 * - IDs are compared as exact strings (no normalization)
 * - An actionable requirement without an unresolved marker must have a non-empty expected result
 * - An unresolved requirement must have a meaningful unresolved reason
 * - An unresolved requirement may omit its expected result and must remain non-actionable
 * - Never invent an expected result
 * - Every negative case must have both condition and expectedOutcome
 * - Source references must point to valid documents within the same project
 */

import { existsSync } from 'node:fs';
import type { Requirement, NegativeCase, UnresolvedMarker, SourceReference } from './types.js';
import type { DocumentRegistry } from '../documents/types.js';
import { loadProject, type ProjectServiceOptions } from '../projects/service.js';
import { loadDocumentRegistry } from '../documents/service.js';

/**
 * Regular expression for valid requirement IDs.
 *
 * Per REQUIREMENTS_AUTHORING_CONVENTION.md section 3.1:
 * - Prefix begins with one uppercase letter (A-Z)
 * - Remaining prefix characters may be uppercase letters or digits
 * - A hyphen separates the prefix and numeric suffix
 * - Numeric suffix contains one or more digits
 *
 * Valid: REQ-001, REQ-1000, AUTH-001, REQ-01, TEST-42
 * Invalid: req-001 (lowercase), REQ_001 (underscore), REQ-001-A (extra hyphen)
 */
export const REQUIREMENT_ID_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

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
 * Result of validating a requirement ID.
 */
export interface RequirementIdValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a requirement ID format.
 *
 * Per REQUIREMENTS_AUTHORING_CONVENTION.md section 3.1:
 * - Pattern: ^[A-Z][A-Z0-9]*-\d+$
 * - Must be non-empty
 * - Must match the pattern exactly
 * - IDs are compared as exact strings (no normalization)
 *
 * @param requirementId - The ID to validate
 * @returns Validation result with error message if invalid
 */
export function validateRequirementId(requirementId: unknown): RequirementIdValidationResult {
  // Check for missing/null/undefined
  if (requirementId === undefined || requirementId === null) {
    return { valid: false, error: 'requirementId is required' };
  }

  // Check type
  if (typeof requirementId !== 'string') {
    return { valid: false, error: 'requirementId must be a string' };
  }

  // Check for empty string
  if (requirementId.length === 0) {
    return { valid: false, error: 'requirementId must not be empty' };
  }

  // Check for whitespace-only
  if (requirementId.trim().length === 0) {
    return { valid: false, error: 'requirementId must not be whitespace-only' };
  }

  // Check format - DO NOT normalize or modify the ID
  if (!REQUIREMENT_ID_PATTERN.test(requirementId)) {
    return {
      valid: false,
      error: `requirementId '${requirementId}' does not match required format. ` +
             `Expected pattern: uppercase prefix + hyphen + numeric suffix (e.g., REQ-001, AUTH-42)`,
    };
  }

  return { valid: true };
}

/**
 * Check if a requirement ID is valid.
 *
 * @param requirementId - The ID to check
 * @returns true if valid, false otherwise
 */
export function isValidRequirementId(requirementId: unknown): requirementId is string {
  return validateRequirementId(requirementId).valid;
}

/**
 * Validation result for a requirement.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Valid requirement status values.
 * Per REQUIREMENTS_AUTHORING_CONVENTION.md section 5.1.
 */
export const VALID_STATUSES = ['active', 'retired'] as const;
export type ValidStatus = (typeof VALID_STATUSES)[number];

/**
 * Valid requirement priority values.
 * Per REQUIREMENTS_AUTHORING_CONVENTION.md section 5.1.
 */
export const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type ValidPriority = (typeof VALID_PRIORITIES)[number];

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
 * Options for requirement validation.
 */
export interface RequirementValidationOptions {
  /**
   * If true, skip ID format validation.
   * Useful when validating partial requirements or proposals.
   */
  skipIdValidation?: boolean;

  /**
   * If true, skip source reference validation.
   * Useful when validating without document registry access.
   */
  skipSourceReferenceValidation?: boolean;

  /**
   * Document registry for source reference validation.
   * Required if skipSourceReferenceValidation is false.
   */
  documentRegistry?: DocumentRegistry;
}

/**
 * Validate a requirement according to project rules.
 *
 * This performs comprehensive validation including:
 * 1. Required fields: projectId, requirementId, title, description, status, priority, sourceReference
 * 2. Requirement ID format (^[A-Z][A-Z0-9]*-\d+$)
 * 3. Valid status (active or retired)
 * 4. Valid priority (critical, high, medium, low)
 * 5. expectedResult required for active requirements without unresolved marker
 * 6. Unresolved marker must have meaningful reason
 * 7. Every negative case must have condition and expectedOutcome
 * 8. Source reference structure validation
 *
 * Distinction between structurally invalid vs valid-but-unresolved:
 * - Structurally invalid: fails validation due to missing/malformed required fields
 * - Valid-but-unresolved: passes structural validation but has unresolved marker
 *
 * @param requirement - The requirement to validate
 * @param options - Validation options
 * @returns Validation result with any errors found
 */
export function validateRequirement(
  requirement: Requirement,
  options: RequirementValidationOptions = {}
): ValidationResult {
  const errors: string[] = [];

  // === Required field validation ===

  // Validate projectId
  if (requirement.projectId === undefined || requirement.projectId === null) {
    errors.push('projectId is required');
  } else if (typeof requirement.projectId !== 'string') {
    errors.push('projectId must be a string');
  } else if (requirement.projectId.trim().length === 0) {
    errors.push('projectId must not be empty');
  }

  // Validate requirementId (format validation unless skipped)
  if (!options.skipIdValidation) {
    const idResult = validateRequirementId(requirement.requirementId);
    if (!idResult.valid) {
      errors.push(idResult.error!);
    }
  } else {
    // Still check it's a non-empty string even when skipping format validation
    if (requirement.requirementId === undefined || requirement.requirementId === null) {
      errors.push('requirementId is required');
    } else if (typeof requirement.requirementId !== 'string') {
      errors.push('requirementId must be a string');
    } else if (requirement.requirementId.trim().length === 0) {
      errors.push('requirementId must not be empty');
    }
  }

  // Validate title
  if (requirement.title === undefined || requirement.title === null) {
    errors.push('title is required');
  } else if (typeof requirement.title !== 'string') {
    errors.push('title must be a string');
  } else if (requirement.title.trim().length === 0) {
    errors.push('title must not be empty');
  }

  // Validate description
  if (requirement.description === undefined || requirement.description === null) {
    errors.push('description is required');
  } else if (typeof requirement.description !== 'string') {
    errors.push('description must be a string');
  } else if (requirement.description.trim().length === 0) {
    errors.push('description must not be empty');
  }

  // Validate status
  if (requirement.status === undefined || requirement.status === null) {
    errors.push('status is required');
  } else if (!VALID_STATUSES.includes(requirement.status as ValidStatus)) {
    errors.push(
      `status must be one of: ${VALID_STATUSES.join(', ')}; got '${requirement.status}'`
    );
  }

  // Validate priority
  if (requirement.priority === undefined || requirement.priority === null) {
    errors.push('priority is required');
  } else if (!VALID_PRIORITIES.includes(requirement.priority as ValidPriority)) {
    errors.push(
      `priority must be one of: ${VALID_PRIORITIES.join(', ')}; got '${requirement.priority}'`
    );
  }

  // === Source reference validation ===
  if (!options.skipSourceReferenceValidation) {
    const sourceRefStructureResult = validateSourceReferenceStructure(requirement.sourceReference);
    if (!sourceRefStructureResult.valid) {
      errors.push(...sourceRefStructureResult.errors);
    } else if (options.documentRegistry) {
      // Also validate against registry if provided
      const sourceRefRegistryResult = validateSourceReferenceAgainstRegistry(
        requirement.sourceReference,
        options.documentRegistry
      );
      if (!sourceRefRegistryResult.valid) {
        errors.push(...sourceRefRegistryResult.errors);
      }
    }
  }

  // === Business rule validation ===

  // Rule: Actionable requirements must have non-empty expectedResult
  // (Active requirements without unresolved marker)
  if (requirement.status === 'active' && requirement.unresolved === undefined) {
    if (!requirement.expectedResult || requirement.expectedResult.trim() === '') {
      errors.push(
        'Active requirement without unresolved marker must have a non-empty expectedResult'
      );
    }
  }

  // Rule: Unresolved requirements must have a meaningful reason
  if (requirement.unresolved !== undefined) {
    if (!isValidUnresolvedMarker(requirement.unresolved)) {
      errors.push(
        'Unresolved requirement must have a meaningful reason (non-empty string)'
      );
    }
  }

  // Rule: Every negative case must have non-empty condition and expectedOutcome
  if (requirement.negativeCases !== undefined) {
    if (!Array.isArray(requirement.negativeCases)) {
      errors.push('negativeCases must be an array');
    } else {
      for (let i = 0; i < requirement.negativeCases.length; i++) {
        const negCase = requirement.negativeCases[i];
        const negCaseResult = validateNegativeCase(negCase);
        if (!negCaseResult.valid) {
          for (const err of negCaseResult.errors) {
            errors.push(`Negative case at index ${i}: ${err}`);
          }
        }
      }
    }
  }

  // === Timestamp validation ===
  if (requirement.createdAt !== undefined && requirement.createdAt !== null) {
    if (typeof requirement.createdAt !== 'string') {
      errors.push('createdAt must be a string');
    }
    // Note: We don't strictly validate ISO 8601 format here to allow flexibility
  }

  if (requirement.updatedAt !== undefined && requirement.updatedAt !== null) {
    if (typeof requirement.updatedAt !== 'string') {
      errors.push('updatedAt must be a string');
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
 * Result of validating a negative case.
 */
export interface NegativeCaseValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a negative case.
 *
 * Per REQUIREMENTS_AUTHORING_CONVENTION.md section 5.4:
 * - Format: `- <condition>: <expected outcome>`
 * - Both condition and expectedOutcome are mandatory
 * - Empty or whitespace-only values are invalid
 *
 * @param negCase - The negative case to validate
 * @returns Validation result with specific errors
 */
export function validateNegativeCase(negCase: NegativeCase): NegativeCaseValidationResult {
  const errors: string[] = [];

  // Check condition
  if (negCase.condition === undefined || negCase.condition === null) {
    errors.push('condition is required');
  } else if (typeof negCase.condition !== 'string') {
    errors.push('condition must be a string');
  } else if (negCase.condition.trim().length === 0) {
    errors.push('condition must not be empty');
  }

  // Check expectedOutcome
  if (negCase.expectedOutcome === undefined || negCase.expectedOutcome === null) {
    errors.push('expectedOutcome is required');
  } else if (typeof negCase.expectedOutcome !== 'string') {
    errors.push('expectedOutcome must be a string');
  } else if (negCase.expectedOutcome.trim().length === 0) {
    errors.push('expectedOutcome must not be empty');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a negative case is valid (has non-empty condition and expectedOutcome).
 *
 * Per PROJECT_SPEC.md section 7.2 and REQUIREMENTS_AUTHORING_CONVENTION.md section 5.4:
 * - Every negative case must include its expected outcome
 * - Both condition and expectedOutcome are mandatory
 * - This is NOT optional - negative cases always require both parts
 */
export function isValidNegativeCase(negCase: NegativeCase): boolean {
  const result = validateNegativeCase(negCase);
  return result.valid;
}

/**
 * Validate and throw if invalid.
 *
 * @param requirement - The requirement to validate
 * @param options - Validation options
 * @throws RequirementValidationError if validation fails
 */
export function assertValidRequirement(
  requirement: Requirement,
  options: RequirementValidationOptions = {}
): void {
  const result = validateRequirement(requirement, options);
  if (!result.valid) {
    throw new RequirementValidationError(
      result.errors.join('; '),
      requirement.requirementId
    );
  }
}

/**
 * Result of checking requirement uniqueness.
 */
export interface UniqueIdCheckResult {
  valid: boolean;
  duplicates: Array<{
    requirementId: string;
    indices: number[];
  }>;
}

/**
 * Check for duplicate requirement IDs in a collection.
 *
 * Per REQUIREMENTS_AUTHORING_CONVENTION.md section 3.3:
 * - Requirement IDs must be unique within a project
 * - IDs are compared as exact strings (no normalization)
 *
 * @param requirements - Array of requirements to check
 * @returns Result with list of duplicate IDs and their positions
 */
export function checkForDuplicateIds(
  requirements: Array<{ requirementId: string }>
): UniqueIdCheckResult {
  const idPositions = new Map<string, number[]>();

  // Track positions of each ID
  for (let i = 0; i < requirements.length; i++) {
    const id = requirements[i].requirementId;
    if (id !== undefined && id !== null) {
      const positions = idPositions.get(id) || [];
      positions.push(i);
      idPositions.set(id, positions);
    }
  }

  // Find duplicates
  const duplicates: Array<{ requirementId: string; indices: number[] }> = [];
  for (const [id, positions] of idPositions) {
    if (positions.length > 1) {
      duplicates.push({ requirementId: id, indices: positions });
    }
  }

  return {
    valid: duplicates.length === 0,
    duplicates,
  };
}

/**
 * Check if a requirement is structurally valid (regardless of unresolved status).
 *
 * A structurally valid requirement:
 * - Has all required fields with correct types
 * - Has valid field values (status, priority, etc.)
 * - Has valid source reference structure
 *
 * A structurally valid requirement MAY still be unresolved.
 * This is different from isActionable() which also checks unresolved status.
 *
 * @param requirement - The requirement to check
 * @param options - Validation options
 * @returns true if structurally valid
 */
export function isStructurallyValid(
  requirement: Requirement,
  options: RequirementValidationOptions = {}
): boolean {
  const result = validateRequirement(requirement, options);
  return result.valid;
}

/**
 * Determine if a requirement is valid-but-unresolved.
 *
 * A valid-but-unresolved requirement:
 * - Passes structural validation
 * - Has an unresolved marker with a meaningful reason
 * - May or may not have expectedResult (it's preserved but not actionable)
 *
 * This distinguishes between:
 * - Structurally invalid: missing/malformed fields
 * - Valid-but-unresolved: complete record that needs clarification
 * - Actionable: complete record ready for test generation
 *
 * @param requirement - The requirement to check
 * @param options - Validation options
 * @returns true if valid but unresolved
 */
export function isValidButUnresolved(
  requirement: Requirement,
  options: RequirementValidationOptions = {}
): boolean {
  if (!isStructurallyValid(requirement, options)) {
    return false;
  }
  return requirement.unresolved !== undefined && isValidUnresolvedMarker(requirement.unresolved);
}

// ============================================================================
// Source Reference Validation
// ============================================================================

/**
 * Result of validating a source reference.
 */
export interface SourceReferenceValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Context for source reference validation.
 * Provides access to project documents and configuration.
 */
export interface SourceReferenceValidationContext {
  /**
   * The project ID the requirement belongs to.
   * Used to verify the referenced document belongs to the same project.
   */
  projectId: string;

  /**
   * Document registry for the project.
   * Used to verify the referenced document and version exist.
   */
  documentRegistry: DocumentRegistry;
}

/**
 * Validate a source reference structure (without cross-reference checks).
 *
 * This validates the structure of a SourceReference:
 * - documentId is a non-empty string
 * - contentHash is a non-empty string (64-char hex expected)
 * - lineRange, if present, has valid start/end (1-based, start <= end)
 * - section, if present, is a non-empty string
 *
 * @param sourceRef - The source reference to validate
 * @returns Validation result with specific errors
 */
export function validateSourceReferenceStructure(
  sourceRef: unknown
): SourceReferenceValidationResult {
  const errors: string[] = [];

  // Check for missing/null/undefined
  if (sourceRef === undefined || sourceRef === null) {
    return { valid: false, errors: ['sourceReference is required'] };
  }

  // Check type
  if (typeof sourceRef !== 'object') {
    return { valid: false, errors: ['sourceReference must be an object'] };
  }

  const ref = sourceRef as Record<string, unknown>;

  // Validate documentId
  if (ref.documentId === undefined || ref.documentId === null) {
    errors.push('sourceReference.documentId is required');
  } else if (typeof ref.documentId !== 'string') {
    errors.push('sourceReference.documentId must be a string');
  } else if (ref.documentId.trim().length === 0) {
    errors.push('sourceReference.documentId must not be empty');
  }

  // Validate contentHash
  if (ref.contentHash === undefined || ref.contentHash === null) {
    errors.push('sourceReference.contentHash is required');
  } else if (typeof ref.contentHash !== 'string') {
    errors.push('sourceReference.contentHash must be a string');
  } else if (ref.contentHash.trim().length === 0) {
    errors.push('sourceReference.contentHash must not be empty');
  } else if (!/^[a-f0-9]{64}$/i.test(ref.contentHash)) {
    errors.push('sourceReference.contentHash must be a 64-character hex string (SHA-256)');
  }

  // Validate lineRange if present
  if (ref.lineRange !== undefined && ref.lineRange !== null) {
    if (typeof ref.lineRange !== 'object') {
      errors.push('sourceReference.lineRange must be an object');
    } else {
      const lineRange = ref.lineRange as Record<string, unknown>;

      // Check start
      if (lineRange.start === undefined || lineRange.start === null) {
        errors.push('sourceReference.lineRange.start is required when lineRange is present');
      } else if (typeof lineRange.start !== 'number' || !Number.isInteger(lineRange.start)) {
        errors.push('sourceReference.lineRange.start must be an integer');
      } else if (lineRange.start < 1) {
        errors.push('sourceReference.lineRange.start must be >= 1 (1-based line numbers)');
      }

      // Check end
      if (lineRange.end === undefined || lineRange.end === null) {
        errors.push('sourceReference.lineRange.end is required when lineRange is present');
      } else if (typeof lineRange.end !== 'number' || !Number.isInteger(lineRange.end)) {
        errors.push('sourceReference.lineRange.end must be an integer');
      } else if (lineRange.end < 1) {
        errors.push('sourceReference.lineRange.end must be >= 1 (1-based line numbers)');
      }

      // Check start <= end
      if (
        typeof lineRange.start === 'number' &&
        typeof lineRange.end === 'number' &&
        Number.isInteger(lineRange.start) &&
        Number.isInteger(lineRange.end) &&
        lineRange.start > lineRange.end
      ) {
        errors.push(
          `sourceReference.lineRange.start (${lineRange.start}) must be <= end (${lineRange.end})`
        );
      }
    }
  }

  // Validate section if present
  if (ref.section !== undefined && ref.section !== null) {
    if (typeof ref.section !== 'string') {
      errors.push('sourceReference.section must be a string');
    } else if (ref.section.trim().length === 0) {
      errors.push('sourceReference.section must not be empty when present');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a source reference against a document registry.
 *
 * This validates that:
 * - The referenced documentId exists in the registry
 * - The referenced contentHash exists in the document's versions array
 *
 * Note: This does NOT check project isolation. The caller must verify
 * the document registry belongs to the expected project.
 *
 * @param sourceRef - The source reference to validate (must pass structural validation first)
 * @param documentRegistry - The document registry to validate against
 * @returns Validation result with specific errors
 */
export function validateSourceReferenceAgainstRegistry(
  sourceRef: SourceReference,
  documentRegistry: DocumentRegistry
): SourceReferenceValidationResult {
  const errors: string[] = [];

  // Check document exists
  const document = documentRegistry.documents[sourceRef.documentId];
  if (!document) {
    errors.push(
      `sourceReference.documentId '${sourceRef.documentId}' not found in document registry`
    );
    return { valid: false, errors };
  }

  // Check version exists
  const versionExists = document.versions.some(
    (v) => v.contentHash === sourceRef.contentHash
  );
  if (!versionExists) {
    errors.push(
      `sourceReference.contentHash '${sourceRef.contentHash}' not found in document ` +
      `'${sourceRef.documentId}' versions`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Fully validate a source reference with cross-reference checks.
 *
 * This combines structural validation with registry validation.
 *
 * @param sourceRef - The source reference to validate
 * @param context - Validation context with project info and document registry
 * @returns Validation result with specific errors
 */
export function validateSourceReference(
  sourceRef: unknown,
  context: SourceReferenceValidationContext
): SourceReferenceValidationResult {
  // First validate structure
  const structureResult = validateSourceReferenceStructure(sourceRef);
  if (!structureResult.valid) {
    return structureResult;
  }

  // Then validate against registry
  const typedRef = sourceRef as SourceReference;
  return validateSourceReferenceAgainstRegistry(typedRef, context.documentRegistry);
}

// ============================================================================
// Project-Scoped Requirement Validation
// ============================================================================

/**
 * Error codes for project-level requirement validation.
 */
export type ProjectValidationErrorCode =
  | 'PROJECT_LOAD_FAILED'
  | 'REGISTRY_NOT_FOUND'
  | 'REGISTRY_LOAD_FAILED'
  | 'PROJECT_ID_MISMATCH'
  | 'VALIDATION_FAILED';

/**
 * Error detail for project-level validation failures.
 */
export interface ProjectValidationError {
  code: ProjectValidationErrorCode;
  message: string;
  cause?: Error;
}

/**
 * Individual requirement validation failure.
 */
export interface RequirementValidationFailure {
  requirementId: string;
  errors: string[];
}

/**
 * Result of project-scoped requirement validation.
 */
export interface ProjectRequirementValidationResult {
  /**
   * Whether all requirements passed validation.
   */
  valid: boolean;

  /**
   * Project-level error (project load failed, registry missing, etc).
   * If present, individual requirement validation was not attempted.
   */
  projectError?: ProjectValidationError;

  /**
   * The loaded project's authoritative project ID.
   * Undefined if project failed to load.
   */
  projectId?: string;

  /**
   * Individual requirement validation failures.
   * Only populated when projectError is not present.
   */
  failures: RequirementValidationFailure[];

  /**
   * Duplicate ID detection results.
   */
  duplicates: Array<{
    requirementId: string;
    indices: number[];
  }>;

  /**
   * Total requirements validated.
   */
  totalValidated: number;
}

/**
 * Options for project-scoped requirement validation.
 */
export interface ProjectRequirementValidationOptions {
  /**
   * Project service options (e.g., custom project-data root).
   * Useful for tests with isolated workspaces.
   */
  projectServiceOptions?: ProjectServiceOptions;

  /**
   * If true, skip requirement ID format validation.
   */
  skipIdValidation?: boolean;
}

/**
 * Validate requirements for a specific project.
 *
 * This is the high-level project-scoped validation entry point that:
 * 1. Loads the project configuration using its actual project ID
 * 2. Loads that project's document registry (documents/documents.json)
 * 3. Rejects requirements whose projectId does not match the loaded project
 * 4. Validates source references against the loaded project's document registry
 * 5. Detects duplicate requirement IDs
 * 6. Runs standard requirement validation on each requirement
 *
 * This function enforces project isolation: a requirement from Project A
 * cannot pass validation through Project B's entry point, even if Project B
 * happens to contain documents with the same IDs and hashes.
 *
 * If the project's document registry does not exist, validation fails with
 * a clear REGISTRY_NOT_FOUND error rather than silently accepting requirements.
 *
 * @param projectId - The project ID to validate requirements against
 * @param requirements - Array of requirements to validate
 * @param options - Validation options
 * @returns Validation result with project-level and individual failures
 */
export function validateRequirementsForProject(
  projectId: string,
  requirements: Requirement[],
  options: ProjectRequirementValidationOptions = {}
): ProjectRequirementValidationResult {
  // Step 1: Load the project
  let loadedProjectId: string;
  let registryPath: string;

  try {
    const project = loadProject(projectId, options.projectServiceOptions);
    loadedProjectId = project.config.projectId;
    registryPath = project.storagePaths.documentsRegistryPath;
  } catch (err) {
    const error = err as Error;
    return {
      valid: false,
      projectError: {
        code: 'PROJECT_LOAD_FAILED',
        message: `Failed to load project '${projectId}': ${error.message}`,
        cause: error,
      },
      failures: [],
      duplicates: [],
      totalValidated: 0,
    };
  }

  // Step 2: Load the document registry
  let documentRegistry: DocumentRegistry;
  try {
    documentRegistry = loadDocumentRegistry(registryPath);

    // Check if registry has any documents - an empty registry might be valid,
    // but a non-existent registry file that returns an empty default should
    // be distinguished. loadDocumentRegistry returns an empty registry if
    // file doesn't exist, so we need to check for that case explicitly.
    // For requirements with source references, we need the registry to exist.
    const requiresRegistry = requirements.some(
      req => req.sourceReference?.documentId
    );

    // If any requirement has source references, the registry must have documents
    if (requiresRegistry && Object.keys(documentRegistry.documents).length === 0) {
      // Check if registry file actually exists
      // loadDocumentRegistry returns empty registry for missing files
      // We need to verify if this is intentional (empty project) or missing
      if (!existsSync(registryPath)) {
        return {
          valid: false,
          projectError: {
            code: 'REGISTRY_NOT_FOUND',
            message: `Document registry not found for project '${projectId}' at ${registryPath}. ` +
                     `Cannot validate source references without a registry.`,
          },
          projectId: loadedProjectId,
          failures: [],
          duplicates: [],
          totalValidated: 0,
        };
      }
    }
  } catch (err) {
    const error = err as Error;
    return {
      valid: false,
      projectError: {
        code: 'REGISTRY_LOAD_FAILED',
        message: `Failed to load document registry for project '${projectId}': ${error.message}`,
        cause: error,
      },
      projectId: loadedProjectId,
      failures: [],
      duplicates: [],
      totalValidated: 0,
    };
  }

  // Step 3: Validate requirements
  const failures: RequirementValidationFailure[] = [];

  for (let i = 0; i < requirements.length; i++) {
    const req = requirements[i];
    const reqErrors: string[] = [];

    // Check projectId matches the loaded project
    if (req.projectId !== loadedProjectId) {
      reqErrors.push(
        `Requirement projectId '${req.projectId}' does not match target project '${loadedProjectId}'`
      );
    }

    // Run standard validation with the project's registry
    const validationResult = validateRequirement(req, {
      skipIdValidation: options.skipIdValidation,
      skipSourceReferenceValidation: false,
      documentRegistry,
    });

    if (!validationResult.valid) {
      reqErrors.push(...validationResult.errors);
    }

    if (reqErrors.length > 0) {
      failures.push({
        requirementId: req.requirementId,
        errors: reqErrors,
      });
    }
  }

  // Step 4: Check for duplicate IDs
  const duplicateResult = checkForDuplicateIds(requirements);

  return {
    valid: failures.length === 0 && duplicateResult.valid,
    projectId: loadedProjectId,
    failures,
    duplicates: duplicateResult.duplicates,
    totalValidated: requirements.length,
  };
}
