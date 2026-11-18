/**
 * Requirement types for Phase 2
 *
 * Requirements are structured records derived from source documents.
 * The platform enforces:
 * - Author-assigned stable IDs (per DEC-009)
 * - Lifecycle tracking (active, retired)
 * - Source document references
 * - Separation between authoritative requirements and proposals
 *
 * Storage layout (project-scoped):
 * - requirements/registry.json - authoritative requirement registry
 * - requirements/proposals/<proposal-id>.json - proposal records
 *
 * Key invariants:
 * - Requirement IDs are unique within a project
 * - Retired IDs are never reused for unrelated requirements
 * - AI-proposed requirements remain proposals until reviewed/accepted
 * - Expected behavior must be explicitly stated, not inferred from website
 *
 * See DECISIONS.md DEC-029 for storage lifecycle decisions.
 */

/**
 * Requirement priority levels.
 */
export type RequirementPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * Requirement lifecycle status.
 *
 * Per PROJECT_SPEC.md section 7.2:
 * - active: Requirement is in active use
 * - retired: No longer applicable, preserved for history (IDs are never reused)
 *
 * Note: "unresolved" is NOT a lifecycle status. Requirements with missing or
 * ambiguous expected behavior use the separate `unresolved` marker.
 */
export type RequirementStatus = 'active' | 'retired';

/**
 * Marker indicating a requirement has unresolved issues.
 *
 * Per PROJECT_SPEC.md section 7.2:
 * - If expected behavior is missing, ambiguous, or contradictory, the system
 *   marks the requirement unresolved and asks for clarification
 * - It must not infer a business rule merely from what the current website happens to do
 *
 * An unresolved requirement:
 * - May omit its expectedResult
 * - Must have a meaningful reason
 * - Must remain non-actionable (cannot be used for test generation)
 */
export interface UnresolvedMarker {
  /** Reason why this requirement is unresolved */
  reason: string;
}

/**
 * Reference to the source document and location where requirement was defined.
 *
 * Per REQUIREMENTS_AUTHORING_CONVENTION.md section 8:
 * - documentId is the caller-supplied document identifier from project.config.json
 * - contentHash is the SHA-256 hash of the immutable document snapshot at parse time
 * - section preserves the original requirement heading text exactly as authored
 * - lineRange provides 1-based start/end line numbers for traceability
 */
export interface SourceReference {
  /**
   * Document ID from DocumentRecord.
   * Must match a documentId in the project's document registry.
   */
  documentId: string;

  /**
   * SHA-256 content hash of the document version this was extracted from.
   * Links to immutable snapshot in documents/sources/<hash>.<ext>.
   * Must match a contentHash in the document's versions array.
   *
   * Named `contentHash` for consistency with DocumentVersion.contentHash.
   */
  contentHash: string;

  /**
   * The original requirement heading text exactly as authored.
   * Example: "REQ-001: Login requires valid credentials"
   *
   * Used for traceability back to the exact source location.
   * Do not invent synthetic section identifiers.
   */
  section?: string;

  /**
   * Line numbers (1-based) where the requirement text appears in the source document.
   * start is the line containing the requirement heading.
   * end is the last line of the requirement content.
   *
   * Constraints:
   * - Both start and end must be positive integers (>= 1)
   * - start must be <= end
   */
  lineRange?: {
    start: number;
    end: number;
  };
}

/**
 * Negative/error case with expected outcome.
 *
 * Per PROJECT_SPEC.md section 7.2 and REQUIREMENTS_AUTHORING_CONVENTION.md section 5.4:
 * - Format: `- <condition>: <expected outcome>`
 * - Both condition and expectedOutcome are mandatory
 * - The first `: ` after the list marker separates condition from expectedOutcome
 * - A missing separator or missing expected outcome is a validation error
 */
export interface NegativeCase {
  /**
   * The error/edge condition being tested.
   * Examples: "Empty username", "Invalid password", "Locked-out user"
   */
  condition: string;

  /**
   * Expected outcome when this condition occurs.
   * Must be explicitly stated, not inferred from website behavior.
   * Examples: "the login is prevented and the error message 'X' is displayed"
   */
  expectedOutcome: string;
}

/**
 * Structured requirement record.
 *
 * Per PROJECT_SPEC.md section 7.2 and REQUIREMENTS_AUTHORING_CONVENTION.md:
 * - Author-assigned stable IDs are the source of identity
 * - IDs must be unique within a project and never reused for unrelated requirements
 * - Expected outcomes must be explicitly stated, not inferred from website behavior
 * - Every negative case must include both condition and expected outcome
 * - Missing/ambiguous expected behavior is marked as unresolved, not invented
 *
 * ID format (per section 3.1 of authoring convention):
 * - Pattern: ^[A-Z][A-Z0-9]*-\d+$
 * - Prefix begins with uppercase letter, may continue with letters/digits
 * - Hyphen separates prefix from numeric suffix
 * - Compare IDs as exact strings; do not normalize
 */
export interface Requirement {
  /**
   * Project ID this requirement belongs to.
   * Must match the projectId in project.config.json.
   * Used for project isolation and cross-reference validation.
   */
  projectId: string;

  /**
   * Author-assigned stable requirement ID.
   *
   * Format: ^[A-Z][A-Z0-9]*-\d+$
   * Examples: REQ-001, AUTH-001, CHECKOUT-99
   *
   * Rules:
   * - Must be unique within the project
   * - Preserved exactly as authored (no normalization)
   * - Retired IDs are never reused for unrelated requirements
   * - AI may propose IDs, but they require human approval
   */
  requirementId: string;

  /** Requirement title/summary */
  title: string;

  /** Full description of the requirement */
  description: string;

  /**
   * Expected result/behavior.
   *
   * Per PROJECT_SPEC.md section 7.2 and REQUIREMENTS_AUTHORING_CONVENTION.md section 5.3:
   * - Must be explicitly authored, never inferred from website behavior
   * - Required for all active requirements that are NOT marked unresolved
   * - May be omitted ONLY when the requirement has an unresolved marker
   * - States the observable, verifiable outcome
   *
   * Precedence with unresolved (per section 5.6):
   * - When both expectedResult AND unresolved are present, the requirement is unresolved
   * - The expectedResult text is preserved but NOT considered actionable
   * - The unresolved marker takes precedence
   */
  expectedResult?: string;

  /**
   * Negative cases with expected outcomes.
   *
   * Per PROJECT_SPEC.md section 7.2:
   * - Every negative case must state its expected outcome
   * - These are NOT optional - negative cases always require expected results
   */
  negativeCases: NegativeCase[];

  /** Requirement priority */
  priority: RequirementPriority;

  /** Lifecycle status (active or retired) */
  status: RequirementStatus;

  /**
   * Unresolved marker.
   *
   * Present when the requirement has missing, ambiguous, or contradictory
   * expected behavior that requires clarification.
   *
   * A requirement with this marker:
   * - May omit its expectedResult
   * - Must have a meaningful reason
   * - Is non-actionable (cannot be used for test generation)
   */
  unresolved?: UnresolvedMarker;

  /** Reference to source document */
  sourceReference: SourceReference;

  /**
   * Role this requirement applies to.
   * Optional - some requirements apply to all roles.
   */
  role?: string;

  /** ISO 8601 timestamp when requirement was created */
  createdAt: string;

  /** ISO 8601 timestamp when requirement was last updated */
  updatedAt: string;

  /**
   * Release/version when this requirement was introduced.
   * Optional - tracked when release management is active.
   */
  introducedInRelease?: string;

  /**
   * Release/version when this requirement was last changed.
   * Optional - tracked when release management is active.
   */
  lastChangedInRelease?: string;

  /**
   * ISO 8601 timestamp when requirement was retired.
   * Set only when status is 'retired'.
   */
  retiredAt?: string;

  /** Reason for retirement */
  retirementReason?: string;
}

/**
 * Authoritative requirement registry for a project.
 * Stored at: requirements/registry.json
 *
 * Contains all accepted requirements including retired ones.
 * Retired requirements are preserved for history - IDs are never reused.
 */
export interface RequirementRegistry {
  /** Schema version for migration support */
  schemaVersion: '1.0';

  /** ISO 8601 timestamp of last registry update */
  updatedAt: string;

  /**
   * Map of requirementId to Requirement.
   * Includes both active and retired requirements.
   */
  requirements: Record<string, Requirement>;
}

/**
 * Proposal status.
 */
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'revision_requested';

/**
 * Proposed requirement (not yet authoritative).
 *
 * Per PROJECT_SPEC.md section 7.2:
 * AI-proposed IDs and structured interpretations require human review
 * before becoming authoritative requirements.
 *
 * Proposals are kept separate from the authoritative registry.
 *
 * Actionable vs Unresolved proposals:
 * - Actionable: has expectedResult, no unresolved marker
 * - Unresolved: has unresolved marker with reason (expectedResult may be omitted)
 * - Invalid: neither expectedResult nor unresolved marker (rejected at creation)
 */
export interface ProposedRequirement {
  /**
   * Proposed requirement ID.
   * Not authoritative until accepted.
   */
  proposedId: string;

  /** Proposed title */
  title: string;

  /** Proposed description */
  description: string;

  /**
   * Proposed expected result.
   *
   * Rules matching the authoritative Requirement type:
   * - Required for actionable proposals (without unresolved marker)
   * - May be omitted ONLY when the proposal has an unresolved marker
   * - Never invent an expected result to make validation pass
   */
  expectedResult?: string;

  /** Proposed negative cases */
  negativeCases: NegativeCase[];

  /** Proposed priority */
  priority: RequirementPriority;

  /** Reference to source document */
  sourceReference: SourceReference;

  /** Proposed role association */
  role?: string;

  /**
   * Unresolved marker.
   *
   * Present when the proposed requirement has missing, ambiguous, or
   * contradictory expected behavior that requires clarification.
   *
   * A proposed requirement with this marker:
   * - May omit its expectedResult
   * - Must have a meaningful reason
   * - Remains non-actionable after acceptance
   *
   * On acceptance, this marker is preserved in the authoritative registry.
   */
  unresolved?: UnresolvedMarker;

  /**
   * Original text from source document.
   * Preserved for reviewer context.
   */
  originalSourceText?: string;

  /**
   * Confidence score from extraction (0.0 - 1.0).
   * Optional - used when AI extraction provides confidence.
   */
  confidence?: number;

  /**
   * Extraction notes or warnings.
   * May indicate ambiguities or issues found during extraction.
   */
  extractionNotes?: string;
}

/**
 * Proposal record for a set of proposed requirements.
 * Stored at: requirements/proposals/<proposal-id>.json
 *
 * A proposal groups related requirement proposals from a single
 * extraction or import operation.
 */
export interface Proposal {
  /** Unique proposal identifier */
  proposalId: string;

  /** Human-readable proposal name */
  name: string;

  /** Optional description */
  description?: string;

  /** Proposal status */
  status: ProposalStatus;

  /** ISO 8601 timestamp when proposal was created */
  createdAt: string;

  /** ISO 8601 timestamp when proposal was last updated */
  updatedAt: string;

  /** Source document this proposal was extracted from */
  sourceDocumentId: string;

  /** Content hash of the source document at extraction time */
  sourceDocumentHash: string;

  /** Proposed requirements in this proposal */
  proposedRequirements: ProposedRequirement[];

  /**
   * Review records for this proposal.
   * Added as the proposal is reviewed.
   */
  reviews: ReviewRecord[];
}

/**
 * Review action taken on a proposal or requirement.
 *
 * Minimal action set per Task 2.8 requirements:
 * - edit: Content was modified before final review
 * - accept: Accept the proposal/requirement
 * - reject: Reject entirely
 *
 * Note: Proposal creation metadata is represented using createdBy/createdAt
 * fields rather than a 'create' review action.
 */
export type ReviewAction =
  | 'edit' // Content was edited during review
  | 'accept' // Accept the proposal/requirement
  | 'reject'; // Reject entirely

/**
 * Review record documenting a review decision.
 *
 * Per PROJECT_SPEC.md: Human approval required for semantic changes.
 * Reviews create an auditable trail of decisions.
 */
export interface ReviewRecord {
  /** Unique review identifier */
  reviewId: string;

  /** ISO 8601 timestamp of the review */
  reviewedAt: string;

  /** Reviewer identifier (user ID or name) */
  reviewer: string;

  /** Review action taken */
  action: ReviewAction;

  /** Reason for the review decision */
  reason: string;

  /**
   * Specific requirement IDs this review applies to.
   * If empty, applies to the entire proposal.
   */
  affectedRequirementIds: string[];

  /**
   * Changes made during accept_with_changes.
   * Documents what was modified from the original proposal.
   */
  changes?: string;
}

/**
 * Summary of requirement changes between versions/releases.
 * Used in release comparison (Phase 7).
 */
export type RequirementChangeType =
  | 'new' // Newly added requirement
  | 'changed' // Content modified
  | 'unchanged' // No changes
  | 'retired' // Marked as retired
  | 'unresolved'; // Status changed to unresolved
