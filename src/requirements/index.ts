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
} from './validation.js';

export type { ValidationResult } from './validation.js';
