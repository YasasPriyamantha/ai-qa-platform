/**
 * Requirement registry service for Task 2.7
 *
 * Implements requirement identity and lifecycle rules per PROJECT_SPEC.md section 7.2:
 *
 * - Author-assigned stable IDs are the source of identity
 * - IDs must be unique within a project
 * - Retired IDs are never reused for unrelated requirements
 * - Requirements keep their ID when description/expected result changes
 * - Retired requirements remain in history
 * - Previous versions are preserved when content changes
 *
 * Storage: requirements/registry.json (atomic writes via atomic-fs.ts)
 *
 * Key behaviors:
 * - Import is all-or-nothing: validation failures leave registry unchanged
 * - Missing IDs from imported documents are reported, not auto-retired
 * - Previous version content is preserved for history
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteRegistry } from '../documents/atomic-fs.js';
import { loadDocumentRegistry } from '../documents/service.js';
import { loadProject, type ProjectServiceOptions } from '../projects/service.js';
import { resolveDocumentSnapshotPath } from '../projects/storage.js';
import {
  parseRequirementContent,
  hasErrors,
  getErrors,
  formatDiagnostics,
  type ParseResult,
  type ParseDiagnostic,
  type ParseContext,
} from './parser.js';
import {
  validateRequirement,
  validateRequirementId,
  checkForDuplicateIds,
} from './validation.js';
import type {
  Requirement,
  RequirementStatus,
  SourceReference,
} from './types.js';
import type { DocumentRegistry } from '../documents/types.js';

// ============================================================================
// Extended Types for History Tracking
// ============================================================================

/**
 * A historical version of a requirement's content.
 *
 * Stored when a requirement's content changes on import.
 * Preserves the previous version for traceability per PROJECT_SPEC.md section 7.9.
 */
export interface RequirementVersion {
  /** The content that was superseded */
  title: string;
  description: string;
  expectedResult?: string;
  negativeCases: Requirement['negativeCases'];
  priority: Requirement['priority'];
  role?: string;
  unresolved?: Requirement['unresolved'];

  /**
   * Lifecycle status when this version was current.
   * Preserves whether the requirement was active or retired at the time
   * of supersession, enabling history to show lifecycle transitions.
   */
  status: RequirementStatus;

  /** Source reference when this version was current */
  sourceReference: SourceReference;

  /** ISO 8601 timestamp when this version was superseded */
  supersededAt: string;

  /** Reason for supersession (content change, etc.) */
  reason?: string;
}

/**
 * Extended requirement record with history tracking.
 *
 * The base Requirement type contains the current state.
 * This interface adds a history array for previous versions.
 */
export interface RequirementWithHistory extends Requirement {
  /**
   * Previous versions of this requirement's content.
   * Newest superseded version first (reverse chronological).
   * Keep minimal to avoid bloat; this is not a release comparison system.
   */
  history?: RequirementVersion[];
}

/**
 * Extended registry with history support.
 */
export interface RequirementRegistryWithHistory {
  schemaVersion: '1.0';
  updatedAt: string;
  requirements: Record<string, RequirementWithHistory>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error codes for registry operations.
 */
export type RegistryErrorCode =
  | 'REGISTRY_NOT_FOUND'
  | 'REGISTRY_LOAD_FAILED'
  | 'REGISTRY_WRITE_FAILED'
  | 'PROJECT_LOAD_FAILED'
  | 'DOCUMENT_REGISTRY_REQUIRED'
  | 'DOCUMENT_REGISTRY_LOAD_FAILED'
  | 'DOCUMENT_NOT_DECLARED'
  | 'DOCUMENT_VERSION_NOT_FOUND'
  | 'SNAPSHOT_NOT_FOUND'
  | 'SNAPSHOT_CORRUPTED'
  | 'PARSE_ERRORS'
  | 'VALIDATION_FAILED'
  | 'DUPLICATE_ID'
  | 'RETIRED_ID_REUSE'
  | 'CROSS_DOCUMENT_ID_CONFLICT'
  | 'ID_NOT_FOUND'
  | 'PROJECT_ID_MISMATCH'
  | 'SOURCE_DOCUMENT_UNKNOWN'
  | 'SOURCE_HASH_UNKNOWN';

/**
 * Error thrown by registry operations.
 */
export class RegistryError extends Error {
  constructor(
    message: string,
    public readonly code: RegistryErrorCode,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

// ============================================================================
// Registry Loading and Saving
// ============================================================================

/**
 * Load a requirement registry from disk.
 *
 * @param registryPath - Absolute path to registry.json
 * @returns The registry, or a new empty registry if file doesn't exist
 * @throws RegistryError for parse/read failures
 */
export function loadRequirementRegistry(
  registryPath: string
): RequirementRegistryWithHistory {
  if (!existsSync(registryPath)) {
    return {
      schemaVersion: '1.0',
      updatedAt: new Date().toISOString(),
      requirements: {},
    };
  }

  try {
    const content = readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(content) as RequirementRegistryWithHistory;

    if (parsed.schemaVersion !== '1.0') {
      throw new RegistryError(
        `Unsupported registry schema version: ${parsed.schemaVersion}`,
        'REGISTRY_LOAD_FAILED'
      );
    }

    return parsed;
  } catch (err) {
    if (err instanceof RegistryError) {
      throw err;
    }

    if (err instanceof SyntaxError) {
      throw new RegistryError(
        `Invalid JSON in requirement registry: ${err.message}`,
        'REGISTRY_LOAD_FAILED',
        err
      );
    }

    throw new RegistryError(
      `Failed to read requirement registry: ${(err as Error).message}`,
      'REGISTRY_LOAD_FAILED',
      err
    );
  }
}

/**
 * Save a requirement registry atomically.
 *
 * INTERNAL: Uses atomic-fs.ts to write temp file + rename for safety.
 * External callers should use importRequirements() or applyRequirementChange()
 * for validated, atomic registry mutations.
 *
 * @param registryPath - Absolute path to registry.json
 * @param registry - The registry to save
 * @throws RegistryError if write fails
 * @internal Exported for testing only - external callers should use importRequirements() or applyRequirementChange()
 */
export function saveRequirementRegistry(
  registryPath: string,
  registry: RequirementRegistryWithHistory
): void {
  // Ensure directory exists
  const dir = dirname(registryPath);
  mkdirSync(dir, { recursive: true });

  // Update timestamp
  registry.updatedAt = new Date().toISOString();

  const result = atomicWriteRegistry(registryPath, registry);

  if (!result.success) {
    throw new RegistryError(
      `Failed to save requirement registry: ${result.error?.message}`,
      'REGISTRY_WRITE_FAILED',
      result.error
    );
  }
}

// ============================================================================
// Identity and Lifecycle Rules
// ============================================================================

/**
 * Check if a requirement ID exists in the registry.
 */
export function requirementIdExists(
  registry: RequirementRegistryWithHistory,
  requirementId: string
): boolean {
  return requirementId in registry.requirements;
}

/**
 * Check if a requirement ID is retired.
 */
export function isRetiredId(
  registry: RequirementRegistryWithHistory,
  requirementId: string
): boolean {
  const existing = registry.requirements[requirementId];
  return existing !== undefined && existing.status === 'retired';
}

/**
 * Check if a requirement ID is active.
 */
export function isActiveId(
  registry: RequirementRegistryWithHistory,
  requirementId: string
): boolean {
  const existing = registry.requirements[requirementId];
  return existing !== undefined && existing.status === 'active';
}

/**
 * Get a requirement from the registry by ID.
 */
export function getRequirement(
  registry: RequirementRegistryWithHistory,
  requirementId: string
): RequirementWithHistory | undefined {
  return registry.requirements[requirementId];
}

/**
 * Get all active requirements from the registry.
 */
export function getActiveRequirements(
  registry: RequirementRegistryWithHistory
): RequirementWithHistory[] {
  return Object.values(registry.requirements).filter(
    (req) => req.status === 'active'
  );
}

/**
 * Get all retired requirements from the registry.
 */
export function getRetiredRequirements(
  registry: RequirementRegistryWithHistory
): RequirementWithHistory[] {
  return Object.values(registry.requirements).filter(
    (req) => req.status === 'retired'
  );
}

// ============================================================================
// Content Comparison
// ============================================================================

/**
 * Check if requirement content has changed.
 *
 * Compares fields that constitute "content" - excludes metadata like timestamps.
 *
 * Fields compared:
 * - title
 * - description
 * - expectedResult
 * - priority
 * - role
 * - status (lifecycle status)
 * - unresolved.reason
 * - negativeCases (condition and expectedOutcome)
 *
 * NOT compared (operational metadata):
 * - createdAt, updatedAt, retiredAt
 * - sourceReference (source changes don't constitute content changes)
 */
export function hasContentChanged(
  existing: RequirementWithHistory,
  incoming: Requirement
): boolean {
  // Compare content fields
  if (existing.title !== incoming.title) return true;
  if (existing.description !== incoming.description) return true;
  if (existing.expectedResult !== incoming.expectedResult) return true;
  if (existing.priority !== incoming.priority) return true;
  if (existing.role !== incoming.role) return true;

  // Compare lifecycle status
  if (existing.status !== incoming.status) return true;

  // Compare unresolved marker
  const existingUnresolved = existing.unresolved?.reason;
  const incomingUnresolved = incoming.unresolved?.reason;
  if (existingUnresolved !== incomingUnresolved) return true;

  // Compare negative cases
  if (existing.negativeCases.length !== incoming.negativeCases.length) return true;
  for (let i = 0; i < existing.negativeCases.length; i++) {
    const e = existing.negativeCases[i];
    const n = incoming.negativeCases[i];
    if (e.condition !== n.condition || e.expectedOutcome !== n.expectedOutcome) {
      return true;
    }
  }

  return false;
}

/**
 * Create a history version from the current state of a requirement.
 */
function createHistoryVersion(
  existing: RequirementWithHistory,
  reason?: string
): RequirementVersion {
  return {
    title: existing.title,
    description: existing.description,
    expectedResult: existing.expectedResult,
    negativeCases: [...existing.negativeCases],
    priority: existing.priority,
    role: existing.role,
    unresolved: existing.unresolved ? { ...existing.unresolved } : undefined,
    status: existing.status,
    sourceReference: { ...existing.sourceReference },
    supersededAt: new Date().toISOString(),
    reason,
  };
}

// ============================================================================
// Import Operation
// ============================================================================

/**
 * Finding about a missing requirement ID in an imported document.
 */
export interface MissingIdFinding {
  requirementId: string;
  status: RequirementStatus;
  lastSeenDocumentId: string;
  lastSeenContentHash: string;
}

/**
 * Source reference update record.
 *
 * Records when a requirement's source reference changed without content changes.
 * This occurs when re-importing unchanged content from a newer document snapshot.
 */
export interface SourceReferenceUpdate {
  requirementId: string;
  previousSourceReference: SourceReference;
  newSourceReference: SourceReference;
}

/**
 * Result of an import planning operation.
 *
 * Contains all the changes that would be made, allowing for
 * review before committing.
 */
export interface ImportPlan {
  /** New requirements to add */
  newRequirements: Requirement[];

  /** Existing requirements with content changes */
  updatedRequirements: Array<{
    existing: RequirementWithHistory;
    incoming: Requirement;
  }>;

  /** Existing requirements with no content changes and unchanged source reference */
  unchangedRequirements: RequirementWithHistory[];

  /**
   * Requirements with unchanged content but updated source reference.
   *
   * This occurs when the same requirement content is imported from a newer
   * document snapshot. The source reference (documentId, contentHash, lineRange)
   * is updated but no content history entry is created.
   */
  sourceUpdated: SourceReferenceUpdate[];

  /** IDs in registry that are not in imported document */
  missingIds: MissingIdFinding[];

  /** Warnings from parsing (non-blocking) */
  warnings: ParseDiagnostic[];
}

/**
 * Result of an import operation.
 */
export interface ImportResult {
  /** Whether the import succeeded */
  success: boolean;

  /** Error if import failed */
  error?: RegistryError;

  /** Parse diagnostics (errors that blocked import) */
  parseErrors?: ParseDiagnostic[];

  /** Validation errors that blocked import */
  validationErrors?: Array<{
    requirementId: string;
    errors: string[];
  }>;

  /** Retired IDs that would be reused (active incoming trying to reactivate retired) */
  retiredIdReuse?: string[];

  /** Duplicate IDs in incoming document */
  duplicateIds?: Array<{
    requirementId: string;
    indices: number[];
  }>;

  /** Cross-document ID conflicts (ID belongs to a different source document) */
  crossDocumentConflicts?: Array<{
    requirementId: string;
    incomingDocumentId: string;
    existingDocumentId: string;
  }>;

  /** The import plan (if validation passed) */
  plan?: ImportPlan;

  /** Count of requirements processed */
  stats?: {
    total: number;
    new: number;
    updated: number;
    unchanged: number;
    sourceUpdated: number;
    missing: number;
    warnings: number;
  };
}

/**
 * Options for import operation.
 *
 * The import operation reads the snapshot directly from disk.
 * Callers cannot supply arbitrary content.
 */
export interface ImportOptions {
  /** Document ID of the source document (must be declared in project config.documents) */
  documentId: string;

  /** Content hash of the document snapshot to import (must exist in document registry) */
  contentHash: string;

  /** Project service options for loading project */
  projectServiceOptions?: ProjectServiceOptions;
}

/**
 * Compute SHA-256 hash of content.
 */
function computeSHA256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Import requirements from an immutable document snapshot into the registry.
 *
 * This is the main import operation that:
 * 1. Loads the project and validates the document is declared in config.documents
 * 2. Loads the project's document registry and verifies the document exists
 * 3. Verifies the requested contentHash exists in the document's versions
 * 4. Resolves the snapshot path using the canonical resolver
 * 5. Reads the snapshot from disk and verifies SHA-256 matches the requested hash
 * 6. Parses the verified snapshot content
 * 7. Rejects on any error-severity parser diagnostics
 * 8. Validates all candidate records
 * 9. Checks requirement identity, duplicate IDs, lifecycle rules
 * 10. Builds complete proposed registry update in memory
 * 11. Persists using atomic filesystem utility
 *
 * All-or-nothing: if any step fails, the registry remains unchanged.
 *
 * The import reads the actual immutable snapshot rather than accepting caller-supplied
 * content. This ensures requirements are always parsed from verified, content-addressed
 * snapshots.
 *
 * @param projectId - Project to import into
 * @param options - Import options with documentId and contentHash
 * @returns Import result with success/failure and details
 */
export function importRequirements(
  projectId: string,
  options: ImportOptions
): ImportResult {
  const { documentId, contentHash } = options;

  // Step 1: Load the project
  let project;
  try {
    project = loadProject(projectId, options.projectServiceOptions);
  } catch (err) {
    return {
      success: false,
      error: new RegistryError(
        `Failed to load project '${projectId}': ${(err as Error).message}`,
        'PROJECT_LOAD_FAILED',
        err
      ),
    };
  }

  const { config, storagePaths } = project;

  // Step 2: Verify documentId is declared in project's config.documents
  const declaredDoc = config.documents?.find(d => d.documentId === documentId);
  if (!declaredDoc) {
    return {
      success: false,
      error: new RegistryError(
        `Document '${documentId}' is not declared in project '${projectId}' config.documents. ` +
          `Cannot import requirements from an undeclared document.`,
        'DOCUMENT_NOT_DECLARED'
      ),
    };
  }

  // Step 3: Load document registry (required)
  let documentRegistry: DocumentRegistry;
  try {
    if (!existsSync(storagePaths.documentsRegistryPath)) {
      return {
        success: false,
        error: new RegistryError(
          `Document registry not found for project '${projectId}' at ${storagePaths.documentsRegistryPath}. ` +
            `Cannot import requirements without a document registry.`,
          'DOCUMENT_REGISTRY_REQUIRED'
        ),
      };
    }

    documentRegistry = loadDocumentRegistry(storagePaths.documentsRegistryPath);
  } catch (err) {
    return {
      success: false,
      error: new RegistryError(
        `Failed to load document registry: ${(err as Error).message}`,
        'DOCUMENT_REGISTRY_LOAD_FAILED',
        err
      ),
    };
  }

  // Step 4: Verify document exists in registry
  const docRecord = documentRegistry.documents[documentId];
  if (!docRecord) {
    return {
      success: false,
      error: new RegistryError(
        `Document '${documentId}' not found in document registry. ` +
          `The document must be ingested before importing requirements.`,
        'DOCUMENT_REGISTRY_REQUIRED'
      ),
    };
  }

  // Step 5: Verify the requested contentHash exists in the document's versions
  const versionRecord = docRecord.versions.find(v => v.contentHash === contentHash);
  if (!versionRecord) {
    return {
      success: false,
      error: new RegistryError(
        `Content hash '${contentHash}' not found in document '${documentId}' versions. ` +
          `The document may need to be re-ingested or the hash is incorrect.`,
        'DOCUMENT_VERSION_NOT_FOUND'
      ),
    };
  }

  // Step 6: Resolve snapshot path using canonical resolver (ensures containment)
  const snapshotResolution = resolveDocumentSnapshotPath(
    versionRecord.snapshotPath,
    storagePaths.documentsDir
  );

  if (!snapshotResolution.isContained) {
    return {
      success: false,
      error: new RegistryError(
        snapshotResolution.error ?? `Snapshot path escapes containment`,
        'SNAPSHOT_NOT_FOUND'
      ),
    };
  }

  const absoluteSnapshotPath = snapshotResolution.absolutePath;

  // Step 7: Read snapshot from disk
  let snapshotBytes: Buffer;
  try {
    if (!existsSync(absoluteSnapshotPath)) {
      return {
        success: false,
        error: new RegistryError(
          `Snapshot file not found at '${absoluteSnapshotPath}'. ` +
            `The document snapshot may have been deleted or corrupted.`,
          'SNAPSHOT_NOT_FOUND'
        ),
      };
    }

    snapshotBytes = readFileSync(absoluteSnapshotPath);
  } catch (err) {
    return {
      success: false,
      error: new RegistryError(
        `Failed to read snapshot file: ${(err as Error).message}`,
        'SNAPSHOT_NOT_FOUND',
        err
      ),
    };
  }

  // Step 8: Verify SHA-256 hash matches the requested contentHash
  const calculatedHash = computeSHA256(snapshotBytes);
  if (calculatedHash !== contentHash) {
    return {
      success: false,
      error: new RegistryError(
        `Snapshot corrupted: calculated hash '${calculatedHash}' does not match ` +
          `requested hash '${contentHash}'. The snapshot file may have been modified.`,
        'SNAPSHOT_CORRUPTED'
      ),
    };
  }

  // Step 9: Decode snapshot content as UTF-8
  const content = snapshotBytes.toString('utf-8');

  // Step 10: Parse the verified document content
  const parseContext: ParseContext = {
    projectId,
    documentId,
    contentHash,
    documentsDir: storagePaths.documentsDir,
    snapshotPath: versionRecord.snapshotPath,
  };

  const parseResult = parseRequirementContent(content, parseContext);

  // Step 4: Check for error-severity parser diagnostics
  if (hasErrors(parseResult)) {
    const errors = getErrors(parseResult.diagnostics);
    return {
      success: false,
      error: new RegistryError(
        `Document contains parsing errors:\n${formatDiagnostics(errors)}`,
        'PARSE_ERRORS'
      ),
      parseErrors: errors,
    };
  }

  // Extract parsed requirements
  const incomingRequirements = parseResult.requirements.map((pr) => pr.requirement);

  // Step 5: Check for duplicate IDs in incoming document
  const duplicateCheck = checkForDuplicateIds(incomingRequirements);
  if (!duplicateCheck.valid) {
    return {
      success: false,
      error: new RegistryError(
        `Document contains duplicate requirement IDs: ${duplicateCheck.duplicates.map((d) => d.requirementId).join(', ')}`,
        'DUPLICATE_ID'
      ),
      duplicateIds: duplicateCheck.duplicates,
    };
  }

  // Step 6: Validate each requirement
  const validationErrors: Array<{ requirementId: string; errors: string[] }> = [];
  for (const req of incomingRequirements) {
    const validationResult = validateRequirement(req, {
      documentRegistry,
      skipSourceReferenceValidation: false,
    });

    if (!validationResult.valid) {
      validationErrors.push({
        requirementId: req.requirementId,
        errors: validationResult.errors,
      });
    }
  }

  if (validationErrors.length > 0) {
    return {
      success: false,
      error: new RegistryError(
        `${validationErrors.length} requirement(s) failed validation`,
        'VALIDATION_FAILED'
      ),
      validationErrors,
    };
  }

  // Step 7: Load existing registry
  const registry = loadRequirementRegistry(storagePaths.requirementsRegistryPath);

  // Step 8: Check cross-document ID conflicts and retired-ID reuse rules
  //
  // Cross-document conflict: incoming ID already belongs to a different source document
  // Retired-ID reuse rules (per PROJECT_SPEC.md section 7.2):
  //
  // | Incoming status | Existing status | Same document? | Action |
  // |-----------------|-----------------|----------------|--------|
  // | Active          | Retired         | Any            | REJECT - cannot reactivate retired ID |
  // | Retired         | Retired         | Yes            | ALLOW - re-import of same retired req |
  // | Retired         | Retired         | No             | REJECT - cross-document conflict |
  // | Retired         | Active          | Yes            | ALLOW - explicit retirement |
  // | Retired         | Active          | No             | REJECT - cross-document conflict |
  // | Active          | Active          | Yes            | ALLOW - normal update |
  // | Active          | Active          | No             | REJECT - cross-document conflict |
  // | Any             | Does not exist  | N/A            | ALLOW - new registration |

  const retiredIdReuse: string[] = [];
  const crossDocumentConflicts: Array<{
    requirementId: string;
    incomingDocumentId: string;
    existingDocumentId: string;
  }> = [];

  for (const req of incomingRequirements) {
    const existing = registry.requirements[req.requirementId];

    if (!existing) {
      // ID doesn't exist - allowed (new registration)
      continue;
    }

    // Check cross-document ownership
    const isSameDocument = existing.sourceReference.documentId === options.documentId;

    if (!isSameDocument) {
      // ID belongs to a different document - reject
      crossDocumentConflicts.push({
        requirementId: req.requirementId,
        incomingDocumentId: options.documentId,
        existingDocumentId: existing.sourceReference.documentId,
      });
      continue;
    }

    // Same document - check retired-ID reuse rules
    if (existing.status === 'retired' && req.status === 'active') {
      // Active incoming trying to reactivate a retired ID - reject
      retiredIdReuse.push(req.requirementId);
    }
    // All other combinations for same document are allowed:
    // - retired incoming + retired existing = re-import retired
    // - retired incoming + active existing = explicit retirement
    // - active incoming + active existing = normal update
  }

  if (crossDocumentConflicts.length > 0) {
    const conflictDetails = crossDocumentConflicts
      .map((c) => `${c.requirementId} (incoming: ${c.incomingDocumentId}, existing: ${c.existingDocumentId})`)
      .join('; ');
    return {
      success: false,
      error: new RegistryError(
        `Cross-document ID conflict: requirement IDs already belong to different source documents: ${conflictDetails}`,
        'CROSS_DOCUMENT_ID_CONFLICT'
      ),
      crossDocumentConflicts,
    };
  }

  if (retiredIdReuse.length > 0) {
    return {
      success: false,
      error: new RegistryError(
        `Cannot reactivate retired requirement IDs: ${retiredIdReuse.join(', ')}. ` +
          `An active incoming requirement cannot reactivate a retired registry record.`,
        'RETIRED_ID_REUSE'
      ),
      retiredIdReuse,
    };
  }

  // Step 9: Build import plan
  const plan = buildImportPlan(
    registry,
    incomingRequirements,
    options.documentId,
    parseResult
  );

  // Step 10: Apply plan to registry
  const updatedRegistry = applyImportPlan(registry, plan);

  // Step 11: Save registry atomically
  try {
    saveRequirementRegistry(storagePaths.requirementsRegistryPath, updatedRegistry);
  } catch (err) {
    return {
      success: false,
      error: err instanceof RegistryError
        ? err
        : new RegistryError(
            `Failed to save registry: ${(err as Error).message}`,
            'REGISTRY_WRITE_FAILED',
            err
          ),
    };
  }

  return {
    success: true,
    plan,
    stats: {
      total: incomingRequirements.length,
      new: plan.newRequirements.length,
      updated: plan.updatedRequirements.length,
      unchanged: plan.unchangedRequirements.length,
      sourceUpdated: plan.sourceUpdated.length,
      missing: plan.missingIds.length,
      warnings: plan.warnings.length,
    },
  };
}

/**
 * Check if source reference has changed.
 *
 * Compares documentId, contentHash, section, and lineRange.
 * This is separate from hasContentChanged because a source reference change
 * does not constitute a business-meaning content change.
 */
export function hasSourceReferenceChanged(
  existing: RequirementWithHistory,
  incoming: Requirement
): boolean {
  const existingRef = existing.sourceReference;
  const incomingRef = incoming.sourceReference;

  // Compare documentId
  if (existingRef.documentId !== incomingRef.documentId) return true;

  // Compare contentHash
  if (existingRef.contentHash !== incomingRef.contentHash) return true;

  // Compare section (both may be undefined)
  if (existingRef.section !== incomingRef.section) return true;

  // Compare lineRange
  const existingRange = existingRef.lineRange;
  const incomingRange = incomingRef.lineRange;

  if (existingRange === undefined && incomingRange === undefined) {
    return false;
  }

  if (existingRange === undefined || incomingRange === undefined) {
    return true;
  }

  if (existingRange.start !== incomingRange.start) return true;
  if (existingRange.end !== incomingRange.end) return true;

  return false;
}

/**
 * Build an import plan without modifying the registry.
 *
 * This allows for preview and validation before committing changes.
 *
 * Categorizes incoming requirements as:
 * - new: ID not in registry
 * - updated: content changed (triggers history entry)
 * - sourceUpdated: content unchanged but source reference changed (no history entry)
 * - unchanged: both content and source reference identical
 */
function buildImportPlan(
  registry: RequirementRegistryWithHistory,
  incomingRequirements: Requirement[],
  documentId: string,
  parseResult: ParseResult
): ImportPlan {
  const incomingIds = new Set(incomingRequirements.map((r) => r.requirementId));

  const newRequirements: Requirement[] = [];
  const updatedRequirements: Array<{
    existing: RequirementWithHistory;
    incoming: Requirement;
  }> = [];
  const unchangedRequirements: RequirementWithHistory[] = [];
  const sourceUpdated: SourceReferenceUpdate[] = [];

  // Categorize incoming requirements
  for (const incoming of incomingRequirements) {
    const existing = registry.requirements[incoming.requirementId];

    if (!existing) {
      newRequirements.push(incoming);
    } else if (hasContentChanged(existing, incoming)) {
      // Content changed - this is a full update with history entry
      updatedRequirements.push({ existing, incoming });
    } else if (hasSourceReferenceChanged(existing, incoming)) {
      // Content unchanged but source reference changed
      // Update source reference without creating history entry
      sourceUpdated.push({
        requirementId: incoming.requirementId,
        previousSourceReference: { ...existing.sourceReference },
        newSourceReference: { ...incoming.sourceReference },
      });
    } else {
      // Both content and source reference unchanged
      unchangedRequirements.push(existing);
    }
  }

  // Find missing IDs (in registry but not in imported document)
  // Per task requirement: report, don't auto-retire
  const missingIds: MissingIdFinding[] = [];
  for (const [reqId, existing] of Object.entries(registry.requirements)) {
    // Only consider active requirements from the same document
    if (
      existing.status === 'active' &&
      existing.sourceReference.documentId === documentId &&
      !incomingIds.has(reqId)
    ) {
      missingIds.push({
        requirementId: reqId,
        status: existing.status,
        lastSeenDocumentId: existing.sourceReference.documentId,
        lastSeenContentHash: existing.sourceReference.contentHash,
      });
    }
  }

  // Collect warnings from parse result
  const warnings = parseResult.diagnostics.filter((d) => d.severity === 'warning');

  return {
    newRequirements,
    updatedRequirements,
    unchangedRequirements,
    sourceUpdated,
    missingIds,
    warnings,
  };
}

/**
 * Apply an import plan to create an updated registry.
 *
 * This creates a new registry object without modifying the original.
 *
 * Handles:
 * - New requirements: creates new records
 * - Updated requirements: preserves history with previous state
 * - Source updated: updates source reference without history entry
 * - Explicit retirement: active → retired transition through import
 * - Re-import of retired: preserved as retired
 */
function applyImportPlan(
  registry: RequirementRegistryWithHistory,
  plan: ImportPlan
): RequirementRegistryWithHistory {
  const now = new Date().toISOString();

  // Start with a copy of the existing registry
  const updatedRegistry: RequirementRegistryWithHistory = {
    schemaVersion: '1.0',
    updatedAt: now,
    requirements: { ...registry.requirements },
  };

  // Add new requirements
  for (const req of plan.newRequirements) {
    const reqWithHistory: RequirementWithHistory = {
      ...req,
      createdAt: now,
      updatedAt: now,
    };
    // If new requirement is retired, set retiredAt
    if (req.status === 'retired') {
      reqWithHistory.retiredAt = now;
      reqWithHistory.retirementReason = req.retirementReason ?? 'Imported as retired';
    }
    updatedRegistry.requirements[req.requirementId] = reqWithHistory;
  }

  // Update existing requirements with content changes
  for (const { existing, incoming } of plan.updatedRequirements) {
    // Determine the appropriate history reason
    let historyReason: string;
    if (existing.status === 'active' && incoming.status === 'retired') {
      historyReason = 'Retired through document import';
    } else if (existing.status === 'retired' && incoming.status === 'retired') {
      historyReason = 'Retired requirement updated on import';
    } else {
      historyReason = 'Content changed on import';
    }

    // Create history entry for the previous version
    const historyVersion = createHistoryVersion(existing, historyReason);

    const updatedReq: RequirementWithHistory = {
      ...incoming,
      createdAt: existing.createdAt,
      updatedAt: now,
      history: [historyVersion, ...(existing.history ?? [])],
    };

    // Handle retirement timestamps
    if (incoming.status === 'retired') {
      if (existing.status === 'active') {
        // Explicit retirement through import
        updatedReq.retiredAt = now;
        updatedReq.retirementReason = incoming.retirementReason ?? 'Retired through document import';
      } else {
        // Preserve existing retirement info if present
        updatedReq.retiredAt = existing.retiredAt ?? now;
        updatedReq.retirementReason = incoming.retirementReason ?? existing.retirementReason;
      }
    }

    updatedRegistry.requirements[incoming.requirementId] = updatedReq;
  }

  // Apply source reference updates (no history entry created)
  for (const srcUpdate of plan.sourceUpdated) {
    const existing = updatedRegistry.requirements[srcUpdate.requirementId];
    if (existing) {
      // Update only the source reference - preserves history, no new history entry
      updatedRegistry.requirements[srcUpdate.requirementId] = {
        ...existing,
        sourceReference: { ...srcUpdate.newSourceReference },
        updatedAt: now,
      };
    }
  }

  // Note: unchanged requirements are already in the registry
  // Note: missing IDs are reported but not modified (per task requirement)

  return updatedRegistry;
}

// ============================================================================
// Safe Public Mutation API
// ============================================================================

/**
 * Type of change to apply to the registry.
 */
export type ChangeOperationType = 'register' | 'update' | 'retire';

/**
 * Registration operation: add a new requirement.
 */
export interface RegisterChange {
  type: 'register';
  requirement: Requirement;
}

/**
 * Update operation: modify an existing requirement.
 */
export interface UpdateChange {
  type: 'update';
  requirement: Requirement;
  reason?: string;
}

/**
 * Retirement operation: retire an existing requirement.
 */
export interface RetireChange {
  type: 'retire';
  requirementId: string;
  reason: string;
}

/**
 * A single change operation for applyRequirementChange.
 */
export type ChangeOperation = RegisterChange | UpdateChange | RetireChange;

/**
 * Result of a single change operation.
 */
export interface ChangeResult {
  success: boolean;
  error?: RegistryError;
  /** The updated requirement (after successful change) */
  requirement?: RequirementWithHistory;
}

/**
 * Apply a single validated change to the requirement registry.
 *
 * This is the ONLY safe public mutation path for single-record changes.
 * Task 2.8 proposal acceptance MUST use this function.
 *
 * Full validation performed:
 * 1. Load the selected project
 * 2. Load and require the document registry
 * 3. Verify the incoming record's project ID
 * 4. Run Task 2.6 requirement validation
 * 5. Verify source document and content hash against document registry
 * 6. Enforce project-level ID uniqueness
 * 7. Enforce retired-ID reactivation and reuse restrictions
 * 8. Enforce source-document ownership
 * 9. Preserve history correctly
 * 10. Build complete result before changing persisted state
 * 11. Persist using atomic filesystem utility
 *
 * All-or-nothing: if any step fails, the registry remains unchanged.
 *
 * @param projectId - Project to apply change to
 * @param change - The change operation to apply
 * @param options - Project service options
 * @returns Change result with success/failure and details
 */
export function applyRequirementChange(
  projectId: string,
  change: ChangeOperation,
  options?: { projectServiceOptions?: ProjectServiceOptions }
): ChangeResult {
  // Step 1: Load the project
  let project;
  try {
    project = loadProject(projectId, options?.projectServiceOptions);
  } catch (err) {
    return {
      success: false,
      error: new RegistryError(
        `Failed to load project '${projectId}': ${(err as Error).message}`,
        'PROJECT_LOAD_FAILED',
        err
      ),
    };
  }

  const { storagePaths } = project;

  // Step 2: Load document registry (required)
  let documentRegistry: DocumentRegistry;
  try {
    if (!existsSync(storagePaths.documentsRegistryPath)) {
      return {
        success: false,
        error: new RegistryError(
          `Document registry not found for project '${projectId}'. ` +
            `Cannot apply changes without a document registry.`,
          'DOCUMENT_REGISTRY_REQUIRED'
        ),
      };
    }

    documentRegistry = loadDocumentRegistry(storagePaths.documentsRegistryPath);
  } catch (err) {
    return {
      success: false,
      error: new RegistryError(
        `Failed to load document registry: ${(err as Error).message}`,
        'DOCUMENT_REGISTRY_LOAD_FAILED',
        err
      ),
    };
  }

  // Step 3: Load existing registry
  const registry = loadRequirementRegistry(storagePaths.requirementsRegistryPath);

  // Step 4: Handle the specific change type
  if (change.type === 'retire') {
    return applyRetireChange(registry, change, storagePaths.requirementsRegistryPath);
  }

  // For register and update, we need to validate the requirement
  const requirement = change.requirement;

  // Step 5: Verify project ID matches
  if (requirement.projectId !== projectId) {
    return {
      success: false,
      error: new RegistryError(
        `Requirement project ID '${requirement.projectId}' does not match target project '${projectId}'`,
        'PROJECT_ID_MISMATCH'
      ),
    };
  }

  // Step 6: Run full requirement validation including source reference
  const validationResult = validateRequirement(requirement, {
    documentRegistry,
    skipSourceReferenceValidation: false,
  });

  if (!validationResult.valid) {
    return {
      success: false,
      error: new RegistryError(
        `Requirement validation failed: ${validationResult.errors.join('; ')}`,
        'VALIDATION_FAILED'
      ),
    };
  }

  // Step 7: Verify source document exists in document registry
  const sourceDocId = requirement.sourceReference.documentId;
  const docRecord = documentRegistry.documents[sourceDocId];
  if (!docRecord) {
    return {
      success: false,
      error: new RegistryError(
        `Source document '${sourceDocId}' not found in document registry`,
        'SOURCE_DOCUMENT_UNKNOWN'
      ),
    };
  }

  // Step 8: Verify content hash exists in document versions
  const contentHash = requirement.sourceReference.contentHash;
  const versionExists = docRecord.versions.some(v => v.contentHash === contentHash);
  if (!versionExists) {
    return {
      success: false,
      error: new RegistryError(
        `Content hash '${contentHash}' not found in document '${sourceDocId}' versions`,
        'SOURCE_HASH_UNKNOWN'
      ),
    };
  }

  // Step 9: Check existing requirement state
  const existing = registry.requirements[requirement.requirementId];

  if (change.type === 'register') {
    // For registration, ID must not exist
    if (existing) {
      return {
        success: false,
        error: new RegistryError(
          `Requirement ID '${requirement.requirementId}' already exists in registry`,
          'DUPLICATE_ID'
        ),
      };
    }
  } else if (change.type === 'update') {
    // For update, ID must exist
    if (!existing) {
      return {
        success: false,
        error: new RegistryError(
          `Requirement ID '${requirement.requirementId}' not found in registry`,
          'ID_NOT_FOUND'
        ),
      };
    }

    // Check for retired-ID reactivation attempt
    if (existing.status === 'retired' && requirement.status === 'active') {
      return {
        success: false,
        error: new RegistryError(
          `Cannot reactivate retired requirement '${requirement.requirementId}'`,
          'RETIRED_ID_REUSE'
        ),
      };
    }

    // Check for cross-document conflict
    if (existing.sourceReference.documentId !== sourceDocId) {
      return {
        success: false,
        error: new RegistryError(
          `Cross-document ID conflict: requirement '${requirement.requirementId}' ` +
            `belongs to document '${existing.sourceReference.documentId}', ` +
            `cannot update from document '${sourceDocId}'`,
          'CROSS_DOCUMENT_ID_CONFLICT'
        ),
      };
    }
  }

  // Step 10: Apply the change to a copy of the registry
  const now = new Date().toISOString();
  const updatedRegistry: RequirementRegistryWithHistory = {
    schemaVersion: '1.0',
    updatedAt: now,
    requirements: { ...registry.requirements },
  };

  let resultRequirement: RequirementWithHistory;

  if (change.type === 'register') {
    resultRequirement = {
      ...requirement,
      createdAt: now,
      updatedAt: now,
    };
    if (requirement.status === 'retired') {
      resultRequirement.retiredAt = now;
      resultRequirement.retirementReason = requirement.retirementReason ?? 'Registered as retired';
    }
    updatedRegistry.requirements[requirement.requirementId] = resultRequirement;
  } else {
    // update
    const existingReq = existing!;

    if (hasContentChanged(existingReq, requirement)) {
      // Content changed - create history entry
      let historyReason = change.reason ?? 'Content updated';
      if (existingReq.status === 'active' && requirement.status === 'retired') {
        historyReason = change.reason ?? 'Retired through change';
      }

      const historyVersion = createHistoryVersion(existingReq, historyReason);

      resultRequirement = {
        ...requirement,
        createdAt: existingReq.createdAt,
        updatedAt: now,
        history: [historyVersion, ...(existingReq.history ?? [])],
      };

      if (requirement.status === 'retired') {
        if (existingReq.status === 'active') {
          resultRequirement.retiredAt = now;
          resultRequirement.retirementReason = requirement.retirementReason ?? 'Retired through change';
        } else {
          resultRequirement.retiredAt = existingReq.retiredAt ?? now;
          resultRequirement.retirementReason = requirement.retirementReason ?? existingReq.retirementReason;
        }
      }
    } else if (hasSourceReferenceChanged(existingReq, requirement)) {
      // Source reference changed only - no history entry
      resultRequirement = {
        ...existingReq,
        sourceReference: { ...requirement.sourceReference },
        updatedAt: now,
      };
    } else {
      // No changes
      resultRequirement = {
        ...existingReq,
        updatedAt: now,
      };
    }

    updatedRegistry.requirements[requirement.requirementId] = resultRequirement;
  }

  // Step 11: Save registry atomically
  try {
    saveRequirementRegistry(storagePaths.requirementsRegistryPath, updatedRegistry);
  } catch (err) {
    return {
      success: false,
      error: err instanceof RegistryError
        ? err
        : new RegistryError(
            `Failed to save registry: ${(err as Error).message}`,
            'REGISTRY_WRITE_FAILED',
            err
          ),
    };
  }

  return {
    success: true,
    requirement: resultRequirement,
  };
}

/**
 * Apply a retirement change.
 */
function applyRetireChange(
  registry: RequirementRegistryWithHistory,
  change: RetireChange,
  registryPath: string
): ChangeResult {
  const { requirementId, reason } = change;

  // Validate ID format
  const idValidation = validateRequirementId(requirementId);
  if (!idValidation.valid) {
    return {
      success: false,
      error: new RegistryError(
        `Invalid requirement ID: ${idValidation.error}`,
        'VALIDATION_FAILED'
      ),
    };
  }

  const existing = registry.requirements[requirementId];

  if (!existing) {
    return {
      success: false,
      error: new RegistryError(
        `Requirement ID '${requirementId}' not found in registry`,
        'ID_NOT_FOUND'
      ),
    };
  }

  if (existing.status === 'retired') {
    return {
      success: false,
      error: new RegistryError(
        `Requirement '${requirementId}' is already retired`,
        'RETIRED_ID_REUSE'
      ),
    };
  }

  const now = new Date().toISOString();

  // Create history entry for the pre-retirement state
  const historyVersion = createHistoryVersion(existing, reason);

  const retiredReq: RequirementWithHistory = {
    ...existing,
    status: 'retired',
    retiredAt: now,
    retirementReason: reason,
    updatedAt: now,
    history: [historyVersion, ...(existing.history ?? [])],
  };

  const updatedRegistry: RequirementRegistryWithHistory = {
    schemaVersion: '1.0',
    updatedAt: now,
    requirements: {
      ...registry.requirements,
      [requirementId]: retiredReq,
    },
  };

  try {
    saveRequirementRegistry(registryPath, updatedRegistry);
  } catch (err) {
    return {
      success: false,
      error: err instanceof RegistryError
        ? err
        : new RegistryError(
            `Failed to save registry: ${(err as Error).message}`,
            'REGISTRY_WRITE_FAILED',
            err
          ),
    };
  }

  return {
    success: true,
    requirement: retiredReq,
  };
}

// ============================================================================
// Internal Single Requirement Operations (used by import pipeline)
// ============================================================================

/**
 * Register a new requirement in the registry.
 *
 * INTERNAL: This is an in-memory operation used by the import pipeline.
 * External callers should use applyRequirementChange() for safe, validated mutations.
 *
 * Validation performed:
 * - Requirement structure and field values (via validateRequirement)
 * - ID uniqueness within the registry
 * - ID format validation
 *
 * NOT validated (requires document registry):
 * - Source reference validation against project documents
 *
 * @param registry - The registry to modify (will be mutated)
 * @param requirement - The requirement to add
 * @throws RegistryError if validation fails or ID already exists
 * @internal Exported for testing only - external callers should use applyRequirementChange()
 */
export function registerRequirement(
  registry: RequirementRegistryWithHistory,
  requirement: Requirement
): void {
  // Validate requirement structure (without source reference cross-check)
  const validationResult = validateRequirement(requirement, {
    skipSourceReferenceValidation: true,
  });
  if (!validationResult.valid) {
    throw new RegistryError(
      `Requirement validation failed: ${validationResult.errors.join('; ')}`,
      'VALIDATION_FAILED'
    );
  }

  // Check for duplicate ID
  if (requirementIdExists(registry, requirement.requirementId)) {
    throw new RegistryError(
      `Requirement ID '${requirement.requirementId}' already exists in registry`,
      'DUPLICATE_ID'
    );
  }

  // Check if ID is retired
  const existing = registry.requirements[requirement.requirementId];
  if (existing && existing.status === 'retired') {
    throw new RegistryError(
      `Cannot register new content under retired requirement ID '${requirement.requirementId}'`,
      'RETIRED_ID_REUSE'
    );
  }

  const now = new Date().toISOString();
  const reqWithHistory: RequirementWithHistory = {
    ...requirement,
    createdAt: now,
    updatedAt: now,
  };

  // Set retirement timestamps if incoming is retired
  if (requirement.status === 'retired') {
    reqWithHistory.retiredAt = now;
    reqWithHistory.retirementReason = requirement.retirementReason ?? 'Registered as retired';
  }

  registry.requirements[requirement.requirementId] = reqWithHistory;
  registry.updatedAt = now;
}

/**
 * Update an existing requirement, preserving history.
 *
 * INTERNAL: This is an in-memory operation used by the import pipeline.
 * External callers should use applyRequirementChange() for safe, validated mutations.
 *
 * Validation performed:
 * - Requirement structure and field values (via validateRequirement)
 * - ID existence check
 * - Retired-ID reactivation check (active incoming + retired existing = reject)
 *
 * NOT validated (requires document registry):
 * - Source reference validation against project documents
 *
 * @param registry - The registry to modify (will be mutated)
 * @param requirement - The updated requirement
 * @param reason - Reason for the update (optional)
 * @throws RegistryError if validation fails, ID doesn't exist, or reactivation attempted
 * @internal Exported for testing only - external callers should use applyRequirementChange()
 */
export function updateRequirement(
  registry: RequirementRegistryWithHistory,
  requirement: Requirement,
  reason?: string
): void {
  // Validate requirement structure (without source reference cross-check)
  const validationResult = validateRequirement(requirement, {
    skipSourceReferenceValidation: true,
  });
  if (!validationResult.valid) {
    throw new RegistryError(
      `Requirement validation failed: ${validationResult.errors.join('; ')}`,
      'VALIDATION_FAILED'
    );
  }

  const existing = registry.requirements[requirement.requirementId];

  if (!existing) {
    throw new RegistryError(
      `Requirement ID '${requirement.requirementId}' not found in registry`,
      'ID_NOT_FOUND'
    );
  }

  // Check for retired-ID reactivation attempt
  if (existing.status === 'retired' && requirement.status === 'active') {
    throw new RegistryError(
      `Cannot reactivate retired requirement '${requirement.requirementId}'. ` +
        `An active requirement cannot reactivate a retired registry record.`,
      'RETIRED_ID_REUSE'
    );
  }

  const now = new Date().toISOString();

  // Only create history if content actually changed
  if (hasContentChanged(existing, requirement)) {
    // Determine appropriate history reason
    let historyReason = reason ?? 'Content updated';
    if (existing.status === 'active' && requirement.status === 'retired') {
      historyReason = reason ?? 'Retired through direct update';
    }

    const historyVersion = createHistoryVersion(existing, historyReason);

    const updatedReq: RequirementWithHistory = {
      ...requirement,
      createdAt: existing.createdAt,
      updatedAt: now,
      history: [historyVersion, ...(existing.history ?? [])],
    };

    // Handle retirement timestamps
    if (requirement.status === 'retired') {
      if (existing.status === 'active') {
        // Explicit retirement
        updatedReq.retiredAt = now;
        updatedReq.retirementReason = requirement.retirementReason ?? 'Retired through update';
      } else {
        // Preserve existing retirement info
        updatedReq.retiredAt = existing.retiredAt ?? now;
        updatedReq.retirementReason = requirement.retirementReason ?? existing.retirementReason;
      }
    }

    registry.requirements[requirement.requirementId] = updatedReq;
  } else {
    // No content change, just update metadata
    registry.requirements[requirement.requirementId] = {
      ...existing,
      ...requirement,
      createdAt: existing.createdAt,
      updatedAt: now,
      history: existing.history,
    };
  }

  registry.updatedAt = now;
}

/**
 * Retire a requirement without deleting it.
 *
 * INTERNAL: This is an in-memory operation used by the import pipeline.
 * External callers should use applyRequirementChange() for safe, validated mutations.
 *
 * Per PROJECT_SPEC.md section 7.2:
 * - Obsolete requirements are marked retired, not silently deleted
 * - Retired IDs remain in history and cannot be reused
 *
 * Validation performed:
 * - ID format validation
 * - ID existence check
 * - Already-retired check
 *
 * @param registry - The registry to modify (will be mutated)
 * @param requirementId - The ID to retire
 * @param reason - Reason for retirement
 * @throws RegistryError if validation fails, ID doesn't exist, or is already retired
 * @internal Exported for testing only - external callers should use applyRequirementChange()
 */
export function retireRequirement(
  registry: RequirementRegistryWithHistory,
  requirementId: string,
  reason: string
): void {
  // Validate ID format
  const idValidation = validateRequirementId(requirementId);
  if (!idValidation.valid) {
    throw new RegistryError(
      `Invalid requirement ID: ${idValidation.error}`,
      'VALIDATION_FAILED'
    );
  }

  const existing = registry.requirements[requirementId];

  if (!existing) {
    throw new RegistryError(
      `Requirement ID '${requirementId}' not found in registry`,
      'ID_NOT_FOUND'
    );
  }

  if (existing.status === 'retired') {
    throw new RegistryError(
      `Requirement '${requirementId}' is already retired`,
      'RETIRED_ID_REUSE'
    );
  }

  const now = new Date().toISOString();

  // Create history entry for the pre-retirement state
  const historyVersion = createHistoryVersion(existing, reason);

  const retiredReq: RequirementWithHistory = {
    ...existing,
    status: 'retired',
    retiredAt: now,
    retirementReason: reason,
    updatedAt: now,
    history: [historyVersion, ...(existing.history ?? [])],
  };

  registry.requirements[requirementId] = retiredReq;
  registry.updatedAt = now;
}

// ============================================================================
// Query Operations
// ============================================================================

/**
 * Get the history of a requirement.
 *
 * @param registry - The registry to query
 * @param requirementId - The requirement ID
 * @returns Array of historical versions, newest first
 */
export function getRequirementHistory(
  registry: RequirementRegistryWithHistory,
  requirementId: string
): RequirementVersion[] {
  const existing = registry.requirements[requirementId];
  return existing?.history ?? [];
}

/**
 * Get all requirement IDs in the registry.
 */
export function getAllRequirementIds(
  registry: RequirementRegistryWithHistory
): string[] {
  return Object.keys(registry.requirements);
}

/**
 * Get count statistics for the registry.
 */
export function getRegistryStats(
  registry: RequirementRegistryWithHistory
): {
  total: number;
  active: number;
  retired: number;
  unresolved: number;
} {
  const requirements = Object.values(registry.requirements);
  return {
    total: requirements.length,
    active: requirements.filter((r) => r.status === 'active').length,
    retired: requirements.filter((r) => r.status === 'retired').length,
    unresolved: requirements.filter((r) => r.unresolved !== undefined).length,
  };
}
