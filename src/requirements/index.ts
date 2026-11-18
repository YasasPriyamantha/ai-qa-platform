/**
 * Requirements management module
 *
 * Provides types for structured requirements, proposals, and reviews.
 * Includes deterministic parser for structured Markdown requirement documents.
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

// Parser exports
export {
  parseRequirementDocument,
  parseRequirementContent,
  isValidRequirementIdFormat,
  getErrors,
  getWarnings,
  hasErrors,
  getDiagnosticsForRequirement,
  formatDiagnostic,
  formatDiagnostics,
} from './parser.js';

export type {
  DiagnosticSeverity,
  ParseDiagnostic,
  ParseContext,
  ParsedRequirement,
  UnknownContent,
  ParseResult,
} from './parser.js';

// Registry exports - Public API
// Use importRequirements() for bulk document imports
// Use applyRequirementChange() for single-record changes (Task 2.8 proposal acceptance)
export {
  RegistryError,
  // Public read operations
  loadRequirementRegistry,
  requirementIdExists,
  isRetiredId,
  isActiveId,
  getRequirement,
  getActiveRequirements,
  getRetiredRequirements,
  hasContentChanged,
  hasSourceReferenceChanged,
  getRequirementHistory,
  getAllRequirementIds,
  getRegistryStats,
  // Public write operations (validated, atomic)
  importRequirements,
  applyRequirementChange,
  // Note: saveRequirementRegistry, registerRequirement, updateRequirement, retireRequirement
  // are internal helpers available in registry.ts for testing only.
  // They are NOT part of the supported public API.
} from './registry.js';

export type {
  RequirementVersion,
  RequirementWithHistory,
  RequirementRegistryWithHistory,
  RegistryErrorCode,
  MissingIdFinding,
  SourceReferenceUpdate,
  ImportPlan,
  ImportResult,
  ImportOptions,
  // applyRequirementChange types
  ChangeOperationType,
  RegisterChange,
  UpdateChange,
  RetireChange,
  ChangeOperation,
  ChangeResult,
} from './registry.js';

// Proposal exports (Task 2.8 - Human Review Boundary)
// Public proposal writes go through create, edit, accept, reject operations.
// saveProposal is an internal helper and NOT part of the public API.
export {
  ProposalError,
  generateProposalId,
  generateReviewId,
  validateProposalId,
  resolveProposalPathSafely,
  PROPOSAL_ID_PATTERN,
  PROPOSAL_ID_MAX_LENGTH,
  createProposal,
  loadProposal,
  // Note: saveProposal is NOT exported - use create/edit/accept/reject operations
  listProposals,
  acceptProposedRequirement,
  rejectProposedRequirement,
  editProposedRequirement,
  getProposalSummary,
} from './proposals.js';

export type {
  ProposedRequirementStatus,
  ProposedRequirementSnapshot,
  EditReviewRecord,
  ProposedRequirementWithStatus,
  ProposalRecord,
  ProposalErrorCode,
  ProposalIdValidationResult,
  CreateProposalOptions,
  CreateProposalResult,
  AcceptOptions,
  AcceptResult,
  RejectOptions,
  RejectResult,
  EditOptions,
  ProposalSummary,
} from './proposals.js';
