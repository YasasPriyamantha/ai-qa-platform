/**
 * Proposal service for Task 2.8 - Human Review Boundary
 *
 * Implements the trust boundary between AI-proposed requirements and
 * authoritative requirement registry per PROJECT_SPEC.md section 7.2:
 *
 * - AI-proposed IDs and structured interpretations require human review
 * - Proposals remain separate from the authoritative registry until accepted
 * - Rejected proposals preserve evidence (never silently deleted)
 * - Acceptance must pass all validation and identity rules
 *
 * Key invariants:
 * - Proposal creation does NOT create authoritative requirements
 * - Valid acceptance creates authoritative requirements via applyRequirementChange()
 * - Rejection does NOT modify the authoritative registry
 * - Invalid/duplicate/retired IDs block acceptance
 * - Source references remain attached after acceptance
 * - Edit history is preserved for audit
 *
 * Storage: requirements/proposals/<proposal-id>.json (DEC-029)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicWriteRegistry } from '../documents/atomic-fs.js';
import { loadDocumentRegistry } from '../documents/service.js';
import { loadProject, type ProjectServiceOptions } from '../projects/service.js';
import { getProposalPath, resolveDocumentSnapshotPath } from '../projects/storage.js';
import { isPathContained } from '../projects/path-safety.js';
import {
  applyRequirementChange,
  loadRequirementRegistry,
  isRetiredId,
  requirementIdExists,
  getRequirement,
  RegistryError,
  type ChangeResult,
  type RequirementWithHistory,
} from './registry.js';
import {
  validateRequirement,
  validateRequirementId,
  validateSourceReferenceStructure,
  validateSourceReferenceAgainstRegistry,
} from './validation.js';
import type {
  Requirement,
  ProposedRequirement,
  ProposalStatus,
  ReviewRecord,
  SourceReference,
} from './types.js';
import type { DocumentRegistry } from '../documents/types.js';

// ============================================================================
// Proposal Types
// ============================================================================

/**
 * Individual proposed requirement with its own status.
 *
 * While the proposal has a top-level status, each proposed requirement
 * within a proposal may have been individually accepted, rejected, or
 * still pending review.
 */
export type ProposedRequirementStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Snapshot of proposed requirement content before an edit.
 * Used for audit history to track what was changed.
 *
 * Preserves ALL mutable fields including:
 * - expectedResult (optional - may be absent for unresolved proposals)
 * - unresolved marker and reason
 * - sourceReference (read-only but preserved for completeness)
 *
 * Note: proposedId and sourceReference are NOT editable, but we
 * preserve sourceReference in the snapshot for complete audit trail.
 */
export interface ProposedRequirementSnapshot {
  title: string;
  description: string;
  /** Optional - may be absent for unresolved proposals */
  expectedResult?: string;
  negativeCases: ProposedRequirement['negativeCases'];
  priority: ProposedRequirement['priority'];
  role?: string;
  /** Unresolved marker - present if proposal was unresolved before edit */
  unresolved?: ProposedRequirement['unresolved'];
  /** Source reference is read-only but preserved for complete audit trail */
  sourceReference: ProposedRequirement['sourceReference'];
  originalSourceText?: string;
  confidence?: number;
  extractionNotes?: string;
}

/**
 * Extended review record with edit history support.
 */
export interface EditReviewRecord extends ReviewRecord {
  /** Snapshot of content before this edit (for 'edit' actions) */
  beforeSnapshot?: ProposedRequirementSnapshot;
}

/**
 * Enhanced proposed requirement with individual status tracking.
 */
export interface ProposedRequirementWithStatus extends ProposedRequirement {
  /**
   * Status of this individual proposed requirement.
   * - pending: Not yet reviewed
   * - accepted: Accepted into authoritative registry
   * - rejected: Rejected (not in authoritative registry)
   */
  individualStatus: ProposedRequirementStatus;

  /**
   * Review records specific to this requirement.
   * Includes edit history with before-snapshots.
   */
  reviews: EditReviewRecord[];

  /**
   * The authoritative requirement ID assigned on acceptance.
   * Only set when individualStatus is 'accepted'.
   * This should equal proposedId if the proposed ID was used as-is.
   */
  acceptedRequirementId?: string;
}

/**
 * Full proposal record with enhanced tracking.
 *
 * Stored at: requirements/proposals/<proposal-id>.json
 */
export interface ProposalRecord {
  /** Schema version for future migration support */
  schemaVersion: '1.0';

  /** Unique proposal identifier */
  proposalId: string;

  /** Project this proposal belongs to */
  projectId: string;

  /** Human-readable proposal name */
  name: string;

  /** Optional description */
  description?: string;

  /** Overall proposal status */
  status: ProposalStatus;

  /** Identity of the user/system that created this proposal */
  createdBy: string;

  /** ISO 8601 timestamp when proposal was created */
  createdAt: string;

  /** ISO 8601 timestamp when proposal was last updated */
  updatedAt: string;

  /** Source document this proposal was derived from */
  sourceDocumentId: string;

  /** Content hash of the source document at proposal time */
  sourceContentHash: string;

  /**
   * Proposed requirements with individual status.
   */
  proposedRequirements: ProposedRequirementWithStatus[];

  /**
   * Top-level reviews that apply to the entire proposal.
   */
  reviews: ReviewRecord[];
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for proposal operations.
 */
export type ProposalErrorCode =
  | 'PROJECT_LOAD_FAILED'
  | 'PROPOSAL_NOT_FOUND'
  | 'PROPOSAL_LOAD_FAILED'
  | 'PROPOSAL_WRITE_FAILED'
  | 'PROPOSAL_ALREADY_PROCESSED'
  | 'PROPOSAL_FINISHED'
  | 'REQUIREMENT_NOT_FOUND'
  | 'REQUIREMENT_ALREADY_PROCESSED'
  | 'VALIDATION_FAILED'
  | 'ACCEPTANCE_FAILED'
  | 'MISSING_PROPOSED_ID'
  | 'DUPLICATE_ID'
  | 'RETIRED_ID_REUSE'
  | 'INVALID_PROPOSAL_ID'
  | 'SOURCE_REFERENCE_INVALID'
  | 'DOCUMENT_NOT_DECLARED'
  | 'DOCUMENT_NOT_FOUND'
  | 'CONTENT_HASH_NOT_FOUND'
  | 'SNAPSHOT_NOT_FOUND';

/**
 * Error thrown by proposal operations.
 */
export class ProposalError extends Error {
  constructor(
    message: string,
    public readonly code: ProposalErrorCode,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ProposalError';
  }
}

// ============================================================================
// Proposal ID Validation
// ============================================================================

/**
 * Pattern for valid proposal IDs.
 *
 * Format: prop-<timestamp>-<random>
 * - Lowercase alphanumeric with hyphens
 * - No path separators or traversal characters
 * - Safe for use as filename
 */
export const PROPOSAL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Maximum length for proposal IDs.
 */
export const PROPOSAL_ID_MAX_LENGTH = 128;

/**
 * Windows reserved device names (case-insensitive).
 */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Result of proposal ID validation.
 */
export interface ProposalIdValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a proposal ID for safe use in file paths.
 *
 * Requirements:
 * - Non-empty
 * - No path separators (/ or \)
 * - No traversal sequences (..)
 * - No Windows reserved names
 * - Matches safe pattern (lowercase alphanumeric with hyphens)
 * - Maximum length enforced
 *
 * @param proposalId - The proposal ID to validate
 * @returns Validation result with error message if invalid
 */
export function validateProposalId(proposalId: string): ProposalIdValidationResult {
  // Check for empty or whitespace-only
  if (!proposalId || proposalId.trim() === '') {
    return { valid: false, error: 'Proposal ID cannot be empty' };
  }

  // Check for path separators
  if (proposalId.includes('/') || proposalId.includes('\\')) {
    return { valid: false, error: 'Proposal ID cannot contain path separators (/ or \\)' };
  }

  // Check for path traversal
  if (proposalId === '.' || proposalId === '..' || proposalId.includes('..')) {
    return { valid: false, error: 'Proposal ID cannot contain path traversal sequences' };
  }

  // Check for hidden file prefix
  if (proposalId.startsWith('.')) {
    return { valid: false, error: 'Proposal ID cannot start with a dot' };
  }

  // Check for Windows reserved names
  if (WINDOWS_RESERVED_NAMES.test(proposalId)) {
    return { valid: false, error: 'Proposal ID cannot be a reserved Windows name' };
  }

  // Check for invalid filesystem characters (Windows-focused)
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(proposalId)) {
    return { valid: false, error: 'Proposal ID contains invalid filesystem characters' };
  }

  // Check length
  if (proposalId.length > PROPOSAL_ID_MAX_LENGTH) {
    return { valid: false, error: `Proposal ID is too long (max ${PROPOSAL_ID_MAX_LENGTH} characters)` };
  }

  // Check pattern
  if (!PROPOSAL_ID_PATTERN.test(proposalId)) {
    return {
      valid: false,
      error: 'Proposal ID must be lowercase alphanumeric with hyphens (e.g., prop-123-abc)',
    };
  }

  return { valid: true };
}

/**
 * Resolve a proposal path and verify containment.
 *
 * Uses the shared path-safety utilities to ensure the proposal file
 * stays within the proposals directory.
 *
 * @param proposalsDir - The proposals directory
 * @param proposalId - The proposal ID
 * @returns The resolved path or throws ProposalError
 */
export function resolveProposalPathSafely(proposalsDir: string, proposalId: string): string {
  // Validate the proposal ID first
  const idValidation = validateProposalId(proposalId);
  if (!idValidation.valid) {
    throw new ProposalError(
      `Invalid proposal ID '${proposalId}': ${idValidation.error}`,
      'INVALID_PROPOSAL_ID'
    );
  }

  // Get the proposal path
  const proposalPath = getProposalPath(proposalsDir, proposalId);

  // Verify containment using shared path-safety utilities
  if (!isPathContained(proposalPath, proposalsDir)) {
    throw new ProposalError(
      `Proposal path escapes proposals directory: ${proposalPath}`,
      'INVALID_PROPOSAL_ID'
    );
  }

  return proposalPath;
}

// ============================================================================
// Proposal ID Generation
// ============================================================================

/**
 * Generate a unique proposal ID.
 *
 * Format: prop-<timestamp>-<random>
 * Example: prop-1699543210123-a1b2c3d4
 *
 * Note: This generates PROPOSAL IDs only. Requirement IDs must be
 * supplied by the caller (from AI or human author) - they are never
 * auto-generated by the proposal service.
 */
export function generateProposalId(): string {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `prop-${timestamp}-${random}`;
}

/**
 * Generate a unique review ID.
 *
 * Format: rev-<timestamp>-<random>
 *
 * Note: This generates REVIEW IDs only, not requirement IDs.
 */
export function generateReviewId(): string {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `rev-${timestamp}-${random}`;
}

// ============================================================================
// Source Reference Validation for Proposals
// ============================================================================

/**
 * Validate a source reference for a proposed requirement.
 *
 * Validates:
 * 1. Source reference structure (documentId, contentHash, etc.)
 * 2. Document is declared in project configuration
 * 3. Document exists in document registry
 * 4. Content hash exists in document's version history
 * 5. Snapshot file exists
 *
 * @param sourceRef - The source reference to validate
 * @param projectConfig - Project configuration (for document declarations)
 * @param documentRegistry - Document registry
 * @param storagePaths - Project storage paths
 * @returns Validation errors (empty array if valid)
 */
function validateProposedSourceReference(
  sourceRef: SourceReference | undefined,
  projectConfig: { documents?: Array<{ documentId: string }> },
  documentRegistry: DocumentRegistry,
  storagePaths: { documentsDir: string }
): string[] {
  const errors: string[] = [];

  // Check source reference exists
  if (!sourceRef) {
    errors.push('sourceReference is required for proposed requirements');
    return errors;
  }

  // Validate structure
  const structureResult = validateSourceReferenceStructure(sourceRef);
  if (!structureResult.valid) {
    errors.push(...structureResult.errors);
    return errors;
  }

  // Check document is declared in project config
  const declaredDocs = projectConfig.documents ?? [];
  const isDeclared = declaredDocs.some((d) => d.documentId === sourceRef.documentId);
  if (!isDeclared) {
    errors.push(
      `Document '${sourceRef.documentId}' is not declared in project configuration`
    );
    return errors;
  }

  // Validate against document registry
  const registryResult = validateSourceReferenceAgainstRegistry(sourceRef, documentRegistry);
  if (!registryResult.valid) {
    errors.push(...registryResult.errors);
    return errors;
  }

  // Verify snapshot file exists
  const docRecord = documentRegistry.documents[sourceRef.documentId];
  if (docRecord) {
    const version = docRecord.versions.find((v) => v.contentHash === sourceRef.contentHash);
    if (version) {
      const snapshotResult = resolveDocumentSnapshotPath(
        version.snapshotPath,
        storagePaths.documentsDir
      );
      if (!snapshotResult.isContained) {
        errors.push(`Snapshot path is invalid: ${snapshotResult.error}`);
      } else if (!existsSync(snapshotResult.absolutePath)) {
        errors.push(
          `Snapshot file not found: ${snapshotResult.absolutePath}`
        );
      }
    }
  }

  return errors;
}

// ============================================================================
// Proposal CRUD Operations
// ============================================================================

/**
 * Options for creating a proposal.
 */
export interface CreateProposalOptions {
  /** Unique proposal identifier (auto-generated if not provided) */
  proposalId?: string;

  /** Human-readable proposal name */
  name: string;

  /** Optional description */
  description?: string;

  /** Identity of the user/system creating this proposal */
  createdBy: string;

  /** Source document ID */
  sourceDocumentId: string;

  /** Content hash of the source document */
  sourceContentHash: string;

  /** Proposed requirements (with IDs supplied by caller, not auto-generated) */
  proposedRequirements: ProposedRequirement[];

  /** Project service options */
  projectServiceOptions?: ProjectServiceOptions;
}

/**
 * Result of creating a proposal.
 */
export interface CreateProposalResult {
  success: boolean;
  proposalId?: string;
  proposalPath?: string;
  error?: ProposalError;
  /** Validation errors for each proposed requirement */
  validationErrors?: Array<{
    proposedId: string;
    errors: string[];
  }>;
}

/**
 * Create a new proposal.
 *
 * This creates a proposal record but does NOT create any authoritative
 * requirements. The proposal must be explicitly accepted to create
 * authoritative requirements.
 *
 * Validates:
 * - Proposal ID format
 * - Source references for all proposed requirements
 * - Documents exist in project configuration and registry
 * - Snapshot files exist
 *
 * @param projectId - Project to create proposal for
 * @param options - Proposal options
 * @returns Result with proposal ID and path
 */
export function createProposal(
  projectId: string,
  options: CreateProposalOptions
): CreateProposalResult {
  // Load project to get storage paths and config
  let project;
  try {
    project = loadProject(projectId, options.projectServiceOptions);
  } catch (err) {
    return {
      success: false,
      error: new ProposalError(
        `Failed to load project '${projectId}': ${(err as Error).message}`,
        'PROJECT_LOAD_FAILED',
        err
      ),
    };
  }

  const { storagePaths, config } = project;

  // Generate or validate proposal ID
  const proposalId = options.proposalId ?? generateProposalId();
  const idValidation = validateProposalId(proposalId);
  if (!idValidation.valid) {
    return {
      success: false,
      error: new ProposalError(
        `Invalid proposal ID '${proposalId}': ${idValidation.error}`,
        'INVALID_PROPOSAL_ID'
      ),
    };
  }

  // Load document registry
  let documentRegistry: DocumentRegistry;
  try {
    documentRegistry = loadDocumentRegistry(storagePaths.documentsRegistryPath);
  } catch {
    // Document registry may not exist yet - create empty one
    documentRegistry = {
      schemaVersion: '1.0',
      updatedAt: new Date().toISOString(),
      documents: {},
    };
  }

  // Validate source references and content for all proposed requirements
  const validationErrors: Array<{ proposedId: string; errors: string[] }> = [];
  for (const propReq of options.proposedRequirements) {
    const errors: string[] = [];

    // Validate source reference
    const sourceRefErrors = validateProposedSourceReference(
      propReq.sourceReference,
      config,
      documentRegistry,
      storagePaths
    );
    errors.push(...sourceRefErrors);

    // Validate expectedResult/unresolved marker per Task 2.6 semantics:
    // - Actionable: has expectedResult, no unresolved marker
    // - Unresolved: has unresolved marker with reason (expectedResult may be omitted)
    // - Invalid: neither expectedResult nor unresolved marker
    const hasExpectedResult = propReq.expectedResult !== undefined &&
      propReq.expectedResult.trim() !== '';
    const hasUnresolvedMarker = propReq.unresolved !== undefined;

    if (!hasExpectedResult && !hasUnresolvedMarker) {
      errors.push(
        'Proposed requirement must have either expectedResult or unresolved marker. ' +
        'Do not create proposals without explicit expected behavior or an unresolved reason.'
      );
    }

    // If unresolved marker is present, validate it has a meaningful reason
    if (hasUnresolvedMarker) {
      if (!propReq.unresolved!.reason ||
          propReq.unresolved!.reason.trim() === '') {
        errors.push(
          'Unresolved marker must have a meaningful reason'
        );
      }
    }

    if (errors.length > 0) {
      validationErrors.push({
        proposedId: propReq.proposedId,
        errors,
      });
    }
  }

  if (validationErrors.length > 0) {
    // Determine error code based on type of errors
    const hasSourceRefErrors = validationErrors.some((v) =>
      v.errors.some((e) => e.includes('sourceReference') || e.includes('Document') ||
        e.includes('Snapshot') || e.includes('not declared') || e.includes('contentHash'))
    );
    const hasContentErrors = validationErrors.some((v) =>
      v.errors.some((e) => e.includes('expectedResult') || e.includes('unresolved'))
    );

    const errorCode: ProposalErrorCode = hasSourceRefErrors
      ? 'SOURCE_REFERENCE_INVALID'
      : hasContentErrors
        ? 'VALIDATION_FAILED'
        : 'SOURCE_REFERENCE_INVALID';

    return {
      success: false,
      error: new ProposalError(
        `Validation failed for ${validationErrors.length} proposed requirement(s)`,
        errorCode
      ),
      validationErrors,
    };
  }

  const now = new Date().toISOString();

  // Convert ProposedRequirement to ProposedRequirementWithStatus
  const proposedRequirements: ProposedRequirementWithStatus[] =
    options.proposedRequirements.map((pr) => ({
      ...pr,
      individualStatus: 'pending' as const,
      reviews: [],
    }));

  const proposal: ProposalRecord = {
    schemaVersion: '1.0',
    proposalId,
    projectId,
    name: options.name,
    description: options.description,
    status: 'pending',
    createdBy: options.createdBy,
    createdAt: now,
    updatedAt: now,
    sourceDocumentId: options.sourceDocumentId,
    sourceContentHash: options.sourceContentHash,
    proposedRequirements,
    reviews: [],
  };

  // Ensure proposals directory exists
  mkdirSync(storagePaths.proposalsDir, { recursive: true });

  // Resolve path safely and write proposal atomically
  let proposalPath: string;
  try {
    proposalPath = resolveProposalPathSafely(storagePaths.proposalsDir, proposalId);
  } catch (err) {
    return {
      success: false,
      error: err instanceof ProposalError ? err : new ProposalError(
        `Failed to resolve proposal path: ${(err as Error).message}`,
        'INVALID_PROPOSAL_ID',
        err
      ),
    };
  }

  const writeResult = atomicWriteRegistry(proposalPath, proposal);

  if (!writeResult.success) {
    return {
      success: false,
      error: new ProposalError(
        `Failed to write proposal: ${writeResult.error?.message}`,
        'PROPOSAL_WRITE_FAILED',
        writeResult.error
      ),
    };
  }

  return {
    success: true,
    proposalId,
    proposalPath,
  };
}

/**
 * Load a proposal by ID.
 *
 * @param projectId - Project containing the proposal
 * @param proposalId - Proposal ID to load
 * @param options - Project service options
 * @returns The proposal record
 * @throws ProposalError if not found or load fails
 */
export function loadProposal(
  projectId: string,
  proposalId: string,
  options?: { projectServiceOptions?: ProjectServiceOptions }
): ProposalRecord {
  let project;
  try {
    project = loadProject(projectId, options?.projectServiceOptions);
  } catch (err) {
    throw new ProposalError(
      `Failed to load project '${projectId}': ${(err as Error).message}`,
      'PROJECT_LOAD_FAILED',
      err
    );
  }

  // Resolve path safely (validates ID and checks containment)
  let proposalPath: string;
  try {
    proposalPath = resolveProposalPathSafely(project.storagePaths.proposalsDir, proposalId);
  } catch (err) {
    throw err instanceof ProposalError ? err : new ProposalError(
      `Invalid proposal ID: ${(err as Error).message}`,
      'INVALID_PROPOSAL_ID',
      err
    );
  }

  if (!existsSync(proposalPath)) {
    throw new ProposalError(
      `Proposal '${proposalId}' not found in project '${projectId}'`,
      'PROPOSAL_NOT_FOUND'
    );
  }

  try {
    const content = readFileSync(proposalPath, 'utf-8');
    return JSON.parse(content) as ProposalRecord;
  } catch (err) {
    throw new ProposalError(
      `Failed to load proposal '${proposalId}': ${(err as Error).message}`,
      'PROPOSAL_LOAD_FAILED',
      err
    );
  }
}

/**
 * Save a proposal record.
 *
 * @param projectId - Project containing the proposal
 * @param proposal - Proposal to save
 * @param options - Project service options
 */
export function saveProposal(
  projectId: string,
  proposal: ProposalRecord,
  options?: { projectServiceOptions?: ProjectServiceOptions }
): void {
  let project;
  try {
    project = loadProject(projectId, options?.projectServiceOptions);
  } catch (err) {
    throw new ProposalError(
      `Failed to load project '${projectId}': ${(err as Error).message}`,
      'PROJECT_LOAD_FAILED',
      err
    );
  }

  // Update timestamp
  proposal.updatedAt = new Date().toISOString();

  // Ensure proposals directory exists
  mkdirSync(project.storagePaths.proposalsDir, { recursive: true });

  // Resolve path safely
  const proposalPath = resolveProposalPathSafely(
    project.storagePaths.proposalsDir,
    proposal.proposalId
  );
  const writeResult = atomicWriteRegistry(proposalPath, proposal);

  if (!writeResult.success) {
    throw new ProposalError(
      `Failed to save proposal: ${writeResult.error?.message}`,
      'PROPOSAL_WRITE_FAILED',
      writeResult.error
    );
  }
}

/**
 * List all proposals for a project.
 *
 * @param projectId - Project to list proposals for
 * @param options - Project service options
 * @returns Array of proposal IDs
 */
export function listProposals(
  projectId: string,
  options?: { projectServiceOptions?: ProjectServiceOptions }
): string[] {
  let project;
  try {
    project = loadProject(projectId, options?.projectServiceOptions);
  } catch (err) {
    throw new ProposalError(
      `Failed to load project '${projectId}': ${(err as Error).message}`,
      'PROJECT_LOAD_FAILED',
      err
    );
  }

  const proposalsDir = project.storagePaths.proposalsDir;

  if (!existsSync(proposalsDir)) {
    return [];
  }

  try {
    const files = readdirSync(proposalsDir);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => basename(f, '.json'))
      .filter((id) => validateProposalId(id).valid); // Only return valid IDs
  } catch {
    return [];
  }
}

// ============================================================================
// Accept/Reject Operations
// ============================================================================

/**
 * Check if entire proposal is finished (no pending requirements).
 */
function isProposalFinished(proposal: ProposalRecord): boolean {
  return proposal.proposedRequirements.every(
    (pr) => pr.individualStatus !== 'pending'
  );
}

/**
 * Options for accepting a proposed requirement.
 */
export interface AcceptOptions {
  /** Reviewer identifier */
  reviewer: string;

  /** Optional reason/notes for acceptance */
  reason?: string;

  /** Project service options */
  projectServiceOptions?: ProjectServiceOptions;

  /**
   * Injectable write function for testing retry scenarios.
   * When provided, used instead of saveProposal.
   * @internal
   */
  _writeProposal?: (projectId: string, proposal: ProposalRecord) => void;
}

/**
 * Result of accepting a proposed requirement.
 */
export interface AcceptResult {
  success: boolean;
  /** The authoritative requirement ID (equals proposedId when accepted) */
  requirementId?: string;
  error?: ProposalError | RegistryError;
  /** Validation errors if acceptance failed validation */
  validationErrors?: string[];
  /** True if this was a retry and the requirement was already accepted */
  wasRetry?: boolean;
}

/**
 * Compare two requirements for exact match.
 *
 * Used for retry-safe acceptance to verify the existing authoritative
 * requirement matches the proposed requirement content.
 *
 * Compares ALL relevant fields including:
 * - projectId, requirementId
 * - title, description, expectedResult (including absence)
 * - priority, role
 * - negativeCases (array comparison)
 * - unresolved marker and reason (including absence)
 * - status (lifecycle status)
 * - complete sourceReference including lineRange
 *
 * Requirements that differ only in lifecycle status or unresolved marker
 * are NOT treated as exact matches.
 */
function requirementsMatch(
  existing: RequirementWithHistory,
  proposed: ProposedRequirement,
  projectId: string
): boolean {
  // Compare project and ID
  if (existing.projectId !== projectId) return false;
  if (existing.requirementId !== proposed.proposedId) return false;

  // Accepted requirements start as 'active' - match only if existing is active
  if (existing.status !== 'active') return false;

  // Compare basic fields
  if (existing.title !== proposed.title) return false;
  if (existing.description !== proposed.description) return false;
  if (existing.priority !== proposed.priority) return false;
  if (existing.role !== proposed.role) return false;

  // Compare expectedResult including absence
  // Both undefined, both same string, or mismatch
  if (existing.expectedResult !== proposed.expectedResult) return false;

  // Compare unresolved marker including absence
  const existingUnresolved = existing.unresolved;
  const proposedUnresolved = proposed.unresolved;
  if (existingUnresolved && proposedUnresolved) {
    if (existingUnresolved.reason !== proposedUnresolved.reason) return false;
  } else if (existingUnresolved || proposedUnresolved) {
    // One has unresolved, the other doesn't
    return false;
  }

  // Compare negative cases
  if (existing.negativeCases.length !== proposed.negativeCases.length) return false;
  for (let i = 0; i < existing.negativeCases.length; i++) {
    if (existing.negativeCases[i].condition !== proposed.negativeCases[i].condition) return false;
    if (existing.negativeCases[i].expectedOutcome !== proposed.negativeCases[i].expectedOutcome) return false;
  }

  // Compare source reference
  const existingRef = existing.sourceReference;
  const proposedRef = proposed.sourceReference;
  if (existingRef.documentId !== proposedRef.documentId) return false;
  if (existingRef.contentHash !== proposedRef.contentHash) return false;
  if (existingRef.section !== proposedRef.section) return false;

  // Compare line ranges
  const existingLine = existingRef.lineRange;
  const proposedLine = proposedRef.lineRange;
  if (existingLine && proposedLine) {
    if (existingLine.start !== proposedLine.start) return false;
    if (existingLine.end !== proposedLine.end) return false;
  } else if (existingLine || proposedLine) {
    // One has lineRange, the other doesn't
    return false;
  }

  return true;
}

/**
 * Accept a single proposed requirement from a proposal.
 *
 * This is the ONLY path from proposal to authoritative registry.
 * It MUST use applyRequirementChange() from the requirements public barrel.
 *
 * Retry-safe behavior:
 * - If the registry write succeeds but proposal file update fails,
 *   subsequent retries will detect the existing requirement.
 * - If the existing requirement EXACTLY matches the proposed content
 *   (including sourceReference), the proposal is marked accepted
 *   without another registry mutation.
 * - If the existing requirement differs, duplicate ID error is returned.
 *
 * Acceptance validates:
 * 1. Proposed ID format
 * 2. Proposed ID not already in registry (unless retry scenario)
 * 3. Proposed ID not retired in registry
 * 4. Full requirement validation
 *
 * @param projectId - Project containing the proposal
 * @param proposalId - Proposal ID
 * @param proposedId - ID of the proposed requirement to accept
 * @param options - Accept options
 * @returns Result with authoritative requirement ID or error
 */
export function acceptProposedRequirement(
  projectId: string,
  proposalId: string,
  proposedId: string,
  options: AcceptOptions
): AcceptResult {
  // Load project
  let project;
  try {
    project = loadProject(projectId, options.projectServiceOptions);
  } catch (err) {
    return {
      success: false,
      error: new ProposalError(
        `Failed to load project '${projectId}': ${(err as Error).message}`,
        'PROJECT_LOAD_FAILED',
        err
      ),
    };
  }

  // Load proposal
  let proposal: ProposalRecord;
  try {
    proposal = loadProposal(projectId, proposalId, {
      projectServiceOptions: options.projectServiceOptions,
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof ProposalError ? err : new ProposalError(
        `Failed to load proposal: ${(err as Error).message}`,
        'PROPOSAL_LOAD_FAILED',
        err
      ),
    };
  }

  // Check if entire proposal is finished
  if (isProposalFinished(proposal)) {
    return {
      success: false,
      error: new ProposalError(
        `Proposal '${proposalId}' is already finished (all requirements have been reviewed)`,
        'PROPOSAL_FINISHED'
      ),
    };
  }

  // Find the proposed requirement
  const proposedReq = proposal.proposedRequirements.find(
    (pr) => pr.proposedId === proposedId
  );

  if (!proposedReq) {
    return {
      success: false,
      error: new ProposalError(
        `Proposed requirement '${proposedId}' not found in proposal '${proposalId}'`,
        'REQUIREMENT_NOT_FOUND'
      ),
    };
  }

  // Check if already processed
  if (proposedReq.individualStatus !== 'pending') {
    return {
      success: false,
      error: new ProposalError(
        `Proposed requirement '${proposedId}' has already been ${proposedReq.individualStatus}`,
        'REQUIREMENT_ALREADY_PROCESSED'
      ),
    };
  }

  // Validate proposed ID format
  const idValidation = validateRequirementId(proposedReq.proposedId);
  if (!idValidation.valid) {
    return {
      success: false,
      error: new ProposalError(
        `Invalid proposed ID: ${idValidation.error}`,
        'VALIDATION_FAILED'
      ),
      validationErrors: [idValidation.error!],
    };
  }

  // Check if proposed ID is missing (empty/null)
  if (!proposedReq.proposedId || proposedReq.proposedId.trim() === '') {
    return {
      success: false,
      error: new ProposalError(
        'Proposed ID is missing or empty. All accepted requirements must have a valid ID.',
        'MISSING_PROPOSED_ID'
      ),
    };
  }

  // Load requirement registry to check for duplicates/retired IDs
  const registry = loadRequirementRegistry(project.storagePaths.requirementsRegistryPath);

  // Check for existing ID - handle retry scenario
  if (requirementIdExists(registry, proposedReq.proposedId)) {
    // Check if it's retired
    if (isRetiredId(registry, proposedReq.proposedId)) {
      return {
        success: false,
        error: new ProposalError(
          `Cannot accept proposed ID '${proposedReq.proposedId}': ` +
            `this ID was previously used and is now retired. ` +
            `Retired IDs cannot be reused for new requirements.`,
          'RETIRED_ID_REUSE'
        ),
      };
    }

    // ID exists and is not retired - check if this is a retry scenario
    const existingReq = getRequirement(registry, proposedReq.proposedId);
    if (existingReq && requirementsMatch(existingReq, proposedReq, projectId)) {
      // This is a retry - the requirement was already accepted but proposal
      // file update failed. Mark proposal as accepted without registry mutation.
      const now = new Date().toISOString();
      const acceptReview: EditReviewRecord = {
        reviewId: generateReviewId(),
        reviewedAt: now,
        reviewer: options.reviewer,
        action: 'accept',
        reason: options.reason ?? 'Accepted into authoritative registry (retry)',
        affectedRequirementIds: [proposedReq.proposedId],
      };

      proposedReq.individualStatus = 'accepted';
      proposedReq.acceptedRequirementId = proposedReq.proposedId;
      proposedReq.reviews.push(acceptReview);

      updateProposalStatus(proposal);

      const writeProposal = options._writeProposal ?? saveProposal;
      writeProposal(projectId, proposal, {
        projectServiceOptions: options.projectServiceOptions,
      });

      return {
        success: true,
        requirementId: proposedReq.proposedId,
        wasRetry: true,
      };
    }

    // ID exists but content doesn't match - this is a true duplicate
    return {
      success: false,
      error: new ProposalError(
        `Cannot accept proposed ID '${proposedReq.proposedId}': ` +
          `this ID already exists in the authoritative registry with different content.`,
        'DUPLICATE_ID'
      ),
    };
  }

  // Build the full Requirement from ProposedRequirement
  const now = new Date().toISOString();
  const requirement: Requirement = {
    projectId,
    requirementId: proposedReq.proposedId,
    title: proposedReq.title,
    description: proposedReq.description,
    expectedResult: proposedReq.expectedResult, // may be undefined for unresolved
    negativeCases: proposedReq.negativeCases,
    priority: proposedReq.priority,
    status: 'active',
    sourceReference: proposedReq.sourceReference,
    role: proposedReq.role,
    unresolved: proposedReq.unresolved, // preserve unresolved marker if present
    createdAt: now,
    updatedAt: now,
  };

  // Validate the full requirement
  const validationResult = validateRequirement(requirement, {
    skipSourceReferenceValidation: true,
  });

  if (!validationResult.valid) {
    return {
      success: false,
      error: new ProposalError(
        `Requirement validation failed: ${validationResult.errors.join('; ')}`,
        'VALIDATION_FAILED'
      ),
      validationErrors: validationResult.errors,
    };
  }

  // Use applyRequirementChange to create the authoritative requirement
  // This is the ONLY path to the authoritative registry
  const changeResult: ChangeResult = applyRequirementChange(
    projectId,
    {
      type: 'register',
      requirement,
    },
    { projectServiceOptions: options.projectServiceOptions }
  );

  if (!changeResult.success) {
    // Record failure in proposal but keep as pending for retry
    const failureReview: EditReviewRecord = {
      reviewId: generateReviewId(),
      reviewedAt: now,
      reviewer: options.reviewer,
      action: 'reject',
      reason: `Acceptance failed: ${changeResult.error?.message}`,
      affectedRequirementIds: [proposedReq.proposedId],
    };

    proposedReq.reviews.push(failureReview);

    try {
      const writeProposal = options._writeProposal ?? saveProposal;
      writeProposal(projectId, proposal, {
        projectServiceOptions: options.projectServiceOptions,
      });
    } catch {
      // Ignore save errors during failure recording
    }

    return {
      success: false,
      error: new ProposalError(
        `Acceptance failed: ${changeResult.error?.message}`,
        'ACCEPTANCE_FAILED',
        changeResult.error
      ),
    };
  }

  // Success - update proposal record
  const acceptReview: EditReviewRecord = {
    reviewId: generateReviewId(),
    reviewedAt: now,
    reviewer: options.reviewer,
    action: 'accept',
    reason: options.reason ?? 'Accepted into authoritative registry',
    affectedRequirementIds: [proposedReq.proposedId],
  };

  proposedReq.individualStatus = 'accepted';
  proposedReq.acceptedRequirementId = proposedReq.proposedId;
  proposedReq.reviews.push(acceptReview);

  // Update overall proposal status if all requirements are processed
  updateProposalStatus(proposal);

  const writeProposal = options._writeProposal ?? saveProposal;
  writeProposal(projectId, proposal, {
    projectServiceOptions: options.projectServiceOptions,
  });

  return {
    success: true,
    requirementId: proposedReq.proposedId,
  };
}

/**
 * Options for rejecting a proposed requirement.
 */
export interface RejectOptions {
  /** Reviewer identifier */
  reviewer: string;

  /** Reason for rejection (required) */
  reason: string;

  /** Project service options */
  projectServiceOptions?: ProjectServiceOptions;
}

/**
 * Result of rejecting a proposed requirement.
 */
export interface RejectResult {
  success: boolean;
  error?: ProposalError;
}

/**
 * Reject a single proposed requirement from a proposal.
 *
 * Rejection does NOT modify the authoritative registry.
 * It preserves the proposal record with rejection metadata for audit.
 *
 * @param projectId - Project containing the proposal
 * @param proposalId - Proposal ID
 * @param proposedId - ID of the proposed requirement to reject
 * @param options - Reject options
 * @returns Result indicating success or failure
 */
export function rejectProposedRequirement(
  projectId: string,
  proposalId: string,
  proposedId: string,
  options: RejectOptions
): RejectResult {
  // Load proposal
  let proposal: ProposalRecord;
  try {
    proposal = loadProposal(projectId, proposalId, {
      projectServiceOptions: options.projectServiceOptions,
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof ProposalError ? err : new ProposalError(
        `Failed to load proposal: ${(err as Error).message}`,
        'PROPOSAL_LOAD_FAILED',
        err
      ),
    };
  }

  // Check if entire proposal is finished
  if (isProposalFinished(proposal)) {
    return {
      success: false,
      error: new ProposalError(
        `Proposal '${proposalId}' is already finished (all requirements have been reviewed)`,
        'PROPOSAL_FINISHED'
      ),
    };
  }

  // Find the proposed requirement
  const proposedReq = proposal.proposedRequirements.find(
    (pr) => pr.proposedId === proposedId
  );

  if (!proposedReq) {
    return {
      success: false,
      error: new ProposalError(
        `Proposed requirement '${proposedId}' not found in proposal '${proposalId}'`,
        'REQUIREMENT_NOT_FOUND'
      ),
    };
  }

  // Check if already processed
  if (proposedReq.individualStatus !== 'pending') {
    return {
      success: false,
      error: new ProposalError(
        `Proposed requirement '${proposedId}' has already been ${proposedReq.individualStatus}`,
        'REQUIREMENT_ALREADY_PROCESSED'
      ),
    };
  }

  // Record rejection
  const now = new Date().toISOString();
  const rejectReview: EditReviewRecord = {
    reviewId: generateReviewId(),
    reviewedAt: now,
    reviewer: options.reviewer,
    action: 'reject',
    reason: options.reason,
    affectedRequirementIds: [proposedReq.proposedId],
  };

  proposedReq.individualStatus = 'rejected';
  proposedReq.reviews.push(rejectReview);

  // Update overall proposal status if all requirements are processed
  updateProposalStatus(proposal);

  try {
    saveProposal(projectId, proposal, {
      projectServiceOptions: options.projectServiceOptions,
    });
  } catch (err) {
    return {
      success: false,
      error: err instanceof ProposalError ? err : new ProposalError(
        `Failed to save rejection: ${(err as Error).message}`,
        'PROPOSAL_WRITE_FAILED',
        err
      ),
    };
  }

  return { success: true };
}

/**
 * Update the overall proposal status based on individual requirement statuses.
 */
function updateProposalStatus(proposal: ProposalRecord): void {
  const statuses = proposal.proposedRequirements.map((pr) => pr.individualStatus);

  // If all are pending, proposal is pending
  if (statuses.every((s) => s === 'pending')) {
    proposal.status = 'pending';
    return;
  }

  // If all are accepted, proposal is accepted
  if (statuses.every((s) => s === 'accepted')) {
    proposal.status = 'accepted';
    return;
  }

  // If all are rejected, proposal is rejected
  if (statuses.every((s) => s === 'rejected')) {
    proposal.status = 'rejected';
    return;
  }

  // If all are processed (no pending), determine based on mix
  if (statuses.every((s) => s !== 'pending')) {
    // Mix of accepted and rejected - still considered "accepted" at proposal level
    // since some requirements were accepted
    proposal.status = 'accepted';
    return;
  }

  // Some are still pending
  proposal.status = 'pending';
}

// ============================================================================
// Edit Operations
// ============================================================================

/**
 * Options for editing a proposed requirement.
 */
export interface EditOptions {
  /** Editor identifier */
  editor: string;

  /** Optional reason for the edit */
  reason?: string;

  /** Project service options */
  projectServiceOptions?: ProjectServiceOptions;
}

/**
 * Edit a proposed requirement before acceptance.
 *
 * This allows humans to correct proposed content before accepting it.
 * The proposal record is updated with the edits.
 *
 * IMPORTANT: Every successful edit creates a review record with the
 * complete before-snapshot for audit history. Failed edits do not
 * create history entries.
 *
 * @param projectId - Project containing the proposal
 * @param proposalId - Proposal ID
 * @param proposedId - ID of the proposed requirement to edit
 * @param edits - Fields to update
 * @param options - Edit options with editor identity
 * @returns Updated proposal record
 */
export function editProposedRequirement(
  projectId: string,
  proposalId: string,
  proposedId: string,
  edits: Partial<Omit<ProposedRequirement, 'proposedId' | 'sourceReference'>>,
  options: EditOptions
): ProposalRecord {
  const proposal = loadProposal(projectId, proposalId, {
    projectServiceOptions: options.projectServiceOptions,
  });

  // Check if entire proposal is finished
  if (isProposalFinished(proposal)) {
    throw new ProposalError(
      `Cannot edit proposal '${proposalId}': all requirements have been reviewed`,
      'PROPOSAL_FINISHED'
    );
  }

  const proposedReq = proposal.proposedRequirements.find(
    (pr) => pr.proposedId === proposedId
  );

  if (!proposedReq) {
    throw new ProposalError(
      `Proposed requirement '${proposedId}' not found in proposal '${proposalId}'`,
      'REQUIREMENT_NOT_FOUND'
    );
  }

  if (proposedReq.individualStatus !== 'pending') {
    throw new ProposalError(
      `Cannot edit proposed requirement '${proposedId}': already ${proposedReq.individualStatus}`,
      'REQUIREMENT_ALREADY_PROCESSED'
    );
  }

  // Capture before-snapshot for audit history
  // Includes ALL mutable fields plus sourceReference for complete audit trail
  const beforeSnapshot: ProposedRequirementSnapshot = {
    title: proposedReq.title,
    description: proposedReq.description,
    expectedResult: proposedReq.expectedResult, // may be undefined
    negativeCases: proposedReq.negativeCases.map((nc) => ({ ...nc })),
    priority: proposedReq.priority,
    role: proposedReq.role,
    unresolved: proposedReq.unresolved ? { ...proposedReq.unresolved } : undefined,
    sourceReference: { ...proposedReq.sourceReference }, // read-only but preserved
    originalSourceText: proposedReq.originalSourceText,
    confidence: proposedReq.confidence,
    extractionNotes: proposedReq.extractionNotes,
  };

  // Apply edits
  if (edits.title !== undefined) proposedReq.title = edits.title;
  if (edits.description !== undefined) proposedReq.description = edits.description;
  if (edits.expectedResult !== undefined) proposedReq.expectedResult = edits.expectedResult;
  if (edits.negativeCases !== undefined) proposedReq.negativeCases = edits.negativeCases;
  if (edits.priority !== undefined) proposedReq.priority = edits.priority;
  if (edits.role !== undefined) proposedReq.role = edits.role;
  if (edits.originalSourceText !== undefined) proposedReq.originalSourceText = edits.originalSourceText;
  if (edits.confidence !== undefined) proposedReq.confidence = edits.confidence;
  if (edits.extractionNotes !== undefined) proposedReq.extractionNotes = edits.extractionNotes;

  // Create edit review record with before-snapshot
  const now = new Date().toISOString();
  const editReview: EditReviewRecord = {
    reviewId: generateReviewId(),
    reviewedAt: now,
    reviewer: options.editor,
    action: 'edit',
    reason: options.reason ?? 'Content edited',
    affectedRequirementIds: [proposedReq.proposedId],
    beforeSnapshot,
  };

  proposedReq.reviews.push(editReview);

  // Save with edits - if this fails, no history is created
  saveProposal(projectId, proposal, {
    projectServiceOptions: options.projectServiceOptions,
  });

  return proposal;
}

// ============================================================================
// Summary and Query Functions
// ============================================================================

/**
 * Get a summary of proposal status.
 */
export interface ProposalSummary {
  proposalId: string;
  projectId: string;
  name: string;
  status: ProposalStatus;
  sourceDocumentId: string;
  createdBy: string;
  counts: {
    total: number;
    pending: number;
    accepted: number;
    rejected: number;
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Get a summary of a proposal.
 */
export function getProposalSummary(
  projectId: string,
  proposalId: string,
  options?: { projectServiceOptions?: ProjectServiceOptions }
): ProposalSummary {
  const proposal = loadProposal(projectId, proposalId, {
    projectServiceOptions: options?.projectServiceOptions,
  });

  const counts = {
    total: proposal.proposedRequirements.length,
    pending: proposal.proposedRequirements.filter((pr) => pr.individualStatus === 'pending').length,
    accepted: proposal.proposedRequirements.filter((pr) => pr.individualStatus === 'accepted').length,
    rejected: proposal.proposedRequirements.filter((pr) => pr.individualStatus === 'rejected').length,
  };

  return {
    proposalId: proposal.proposalId,
    projectId: proposal.projectId,
    name: proposal.name,
    status: proposal.status,
    sourceDocumentId: proposal.sourceDocumentId,
    createdBy: proposal.createdBy,
    counts,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}
