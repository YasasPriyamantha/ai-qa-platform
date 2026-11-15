/**
 * Requirements management module
 *
 * Provides types for structured requirements, proposals, and reviews.
 * Requirement extraction and validation services are implemented in later tasks.
 */

export type {
  RequirementPriority,
  RequirementStatus,
  UnresolvedMarker,
  SourceReference,
  NegativeCase,
  Requirement,
  RequirementRegistry,
  ProposalStatus,
  ProposedRequirement,
  Proposal,
  ReviewAction,
  ReviewRecord,
  RequirementChangeType,
} from './types.js';

export {
  RequirementValidationError,
  isActionable,
  validateRequirement,
  isValidUnresolvedMarker,
  isValidNegativeCase,
  assertValidRequirement,
  validateRequirementsForProject,
  validateRequirementId,
  isValidRequirementId,
  REQUIREMENT_ID_PATTERN,
  checkForDuplicateIds,
  isStructurallyValid,
  isValidButUnresolved,
  validateSourceReferenceStructure,
  validateSourceReferenceAgainstRegistry,
} from './validation.js';

export type {
  ValidationResult,
  RequirementIdValidationResult,
  RequirementValidationOptions,
  NegativeCaseValidationResult,
  SourceReferenceValidationResult,
  SourceReferenceValidationContext,
  UniqueIdCheckResult,
  ProjectValidationErrorCode,
  ProjectValidationError,
  RequirementValidationFailure,
  ProjectRequirementValidationResult,
  ProjectRequirementValidationOptions,
} from './validation.js';
