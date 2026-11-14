/**
 * Project storage layout for Phase 2
 *
 * Defines the file/JSON persistence layout for project-scoped data.
 * This module documents WHERE records live; the actual reading/writing
 * is implemented by the respective service modules.
 *
 * Storage layout (relative to project workspace):
 *
 * documents/
 *   sources/<sha256>.<ext>     - Immutable source snapshots
 *   documents.json             - Document metadata registry
 *
 * requirements/
 *   registry.json              - Authoritative requirement registry
 *   proposals/<proposal-id>.json - Proposal records
 *
 * tests/
 *   approved/                  - Approved test files (existing Phase 1)
 *   candidates/                - Candidate test files (future)
 *
 * artifacts/                   - Run artifacts (existing Phase 1)
 *
 * project.config.json          - Project configuration (existing Phase 1)
 *
 * See DECISIONS.md DEC-029 for storage lifecycle decisions.
 */

import { join, resolve } from 'node:path';

/**
 * Well-known directory names within a project workspace.
 */
export const PROJECT_DIRECTORIES = {
  /** Directory for document-related files */
  DOCUMENTS: 'documents',
  /** Subdirectory for immutable source snapshots */
  DOCUMENT_SOURCES: 'sources',
  /** Directory for requirement-related files */
  REQUIREMENTS: 'requirements',
  /** Subdirectory for proposal records */
  PROPOSALS: 'proposals',
  /** Directory for approved tests (from Phase 1) */
  TESTS_APPROVED: 'tests/approved',
  /** Directory for candidate tests (future) */
  TESTS_CANDIDATES: 'tests/candidates',
  /** Directory for run artifacts (from Phase 1) */
  ARTIFACTS: 'artifacts',
} as const;

/**
 * Well-known file names within a project workspace.
 */
export const PROJECT_FILES = {
  /** Project configuration file */
  PROJECT_CONFIG: 'project.config.json',
  /** Document registry file */
  DOCUMENTS_REGISTRY: 'documents.json',
  /** Requirement registry file */
  REQUIREMENTS_REGISTRY: 'registry.json',
} as const;

/**
 * Project storage paths.
 *
 * Provides absolute paths for all storage locations given a project workspace.
 */
export interface ProjectStoragePaths {
  /** Absolute path to project workspace */
  workspace: string;

  /** Absolute path to documents directory */
  documentsDir: string;

  /** Absolute path to document sources (snapshots) directory */
  documentSourcesDir: string;

  /** Absolute path to documents registry file */
  documentsRegistryPath: string;

  /** Absolute path to requirements directory */
  requirementsDir: string;

  /** Absolute path to requirements registry file */
  requirementsRegistryPath: string;

  /** Absolute path to proposals directory */
  proposalsDir: string;
}

/**
 * Compute all storage paths for a project workspace.
 *
 * @param projectWorkspace - Absolute path to the project workspace
 * @returns All storage paths for the project
 */
export function getProjectStoragePaths(projectWorkspace: string): ProjectStoragePaths {
  const documentsDir = join(projectWorkspace, PROJECT_DIRECTORIES.DOCUMENTS);
  const requirementsDir = join(projectWorkspace, PROJECT_DIRECTORIES.REQUIREMENTS);

  return {
    workspace: projectWorkspace,
    documentsDir,
    documentSourcesDir: join(documentsDir, PROJECT_DIRECTORIES.DOCUMENT_SOURCES),
    documentsRegistryPath: join(documentsDir, PROJECT_FILES.DOCUMENTS_REGISTRY),
    requirementsDir,
    requirementsRegistryPath: join(requirementsDir, PROJECT_FILES.REQUIREMENTS_REGISTRY),
    proposalsDir: join(requirementsDir, PROJECT_DIRECTORIES.PROPOSALS),
  };
}

/**
 * Compute the snapshot path for a document.
 *
 * @param documentSourcesDir - Absolute path to document sources directory
 * @param contentHash - SHA-256 hash of document content
 * @param extension - File extension including dot (e.g., ".md")
 * @returns Absolute path to the snapshot file
 */
export function getDocumentSnapshotPath(
  documentSourcesDir: string,
  contentHash: string,
  extension: string
): string {
  return join(documentSourcesDir, `${contentHash}${extension}`);
}

/**
 * Compute the relative snapshot path for storage in DocumentRecord.
 *
 * @param contentHash - SHA-256 hash of document content
 * @param extension - File extension including dot (e.g., ".md")
 * @returns Relative path for storage (e.g., "sources/abc123.md")
 */
export function getRelativeSnapshotPath(
  contentHash: string,
  extension: string
): string {
  return `${PROJECT_DIRECTORIES.DOCUMENT_SOURCES}/${contentHash}${extension}`;
}

/**
 * Compute the proposal file path.
 *
 * @param proposalsDir - Absolute path to proposals directory
 * @param proposalId - Proposal identifier
 * @returns Absolute path to the proposal file
 */
export function getProposalPath(proposalsDir: string, proposalId: string): string {
  return join(proposalsDir, `${proposalId}.json`);
}

/**
 * Result of resolving a snapshot path.
 */
export interface ResolveSnapshotPathResult {
  /** The resolved absolute path */
  absolutePath: string;
  /** Whether the path is safely contained within the documents directory */
  isContained: boolean;
  /** Error message if path is invalid or escapes containment */
  error?: string;
}

/**
 * Resolve a relative snapshotPath to an absolute filesystem path.
 *
 * This is the canonical resolver for document snapshot paths stored in
 * DocumentVersion records. All code that needs to access snapshot files
 * should use this function rather than constructing paths independently.
 *
 * snapshotPath convention:
 * - Stored relative to the project's documents/ directory
 * - Format: sources/<sha256>.<ext>
 * - Example: sources/abc123def456...xyz.md
 *
 * The actual file location is:
 * <project-workspace>/documents/sources/<sha256>.<ext>
 *
 * @param snapshotPath - Relative path as stored in DocumentVersion.snapshotPath
 * @param documentsDir - Absolute path to the project's documents directory
 * @returns Resolution result with absolute path and containment status
 */
export function resolveDocumentSnapshotPath(
  snapshotPath: string,
  documentsDir: string
): ResolveSnapshotPathResult {
  // Reject obviously invalid paths
  if (!snapshotPath || typeof snapshotPath !== 'string') {
    return {
      absolutePath: '',
      isContained: false,
      error: 'Invalid snapshotPath: must be a non-empty string',
    };
  }

  // Reject absolute paths - snapshotPath must be relative
  if (snapshotPath.startsWith('/') || /^[a-zA-Z]:/.test(snapshotPath)) {
    return {
      absolutePath: '',
      isContained: false,
      error: `Invalid snapshotPath: must be relative, got absolute path '${snapshotPath}'`,
    };
  }

  // Resolve the path
  const absolutePath = join(documentsDir, snapshotPath);

  // Check containment - the resolved path must be inside documentsDir
  // Use path normalization to handle .. traversal
  const normalizedDocs = documentsDir.replace(/\\/g, '/').toLowerCase();
  const normalizedResolved = absolutePath.replace(/\\/g, '/').toLowerCase();

  // The resolved path must start with the documents directory
  if (!normalizedResolved.startsWith(normalizedDocs + '/') &&
      normalizedResolved !== normalizedDocs) {
    return {
      absolutePath,
      isContained: false,
      error: `snapshotPath '${snapshotPath}' resolves to '${absolutePath}' ` +
             `which escapes documents directory '${documentsDir}'`,
    };
  }

  // Additional check for path traversal attempts
  if (snapshotPath.includes('..')) {
    // After normalization, check if we're still contained
    const resolved = resolve(documentsDir, snapshotPath);
    const resolvedNormalized = resolved.replace(/\\/g, '/').toLowerCase();

    if (!resolvedNormalized.startsWith(normalizedDocs + '/')) {
      return {
        absolutePath: resolved,
        isContained: false,
        error: `snapshotPath '${snapshotPath}' contains traversal and escapes ` +
               `documents directory '${documentsDir}'`,
      };
    }
  }

  return {
    absolutePath,
    isContained: true,
  };
}
