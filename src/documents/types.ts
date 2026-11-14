/**
 * Document record types for Phase 2
 *
 * Documents are source files (Markdown, plain text) containing workflow
 * descriptions and requirements. The platform preserves:
 * - Original source snapshots (immutable)
 * - Version metadata and content hashes
 * - Document lifecycle status
 *
 * Storage layout (project-scoped):
 * - documents/sources/<sha256>.<ext> - immutable source snapshots
 * - documents/documents.json - document metadata registry
 *
 * See DECISIONS.md DEC-029 for storage lifecycle decisions.
 */

/**
 * Document format supported by the platform.
 * Phase 2 supports Markdown and plain text only.
 */
export type DocumentFormat = 'markdown' | 'text';

/**
 * Note: DocumentVersion.status was removed as redundant.
 *
 * The last entry in versions[] is always the current/active version.
 * Earlier entries are implicitly superseded by their position in the array.
 * This single source of truth eliminates the risk of status/position inconsistency.
 */

/**
 * A single version of a document.
 *
 * Each ingestion of changed content creates a new version.
 * Previous versions remain accessible for history and traceability.
 *
 * Version ordering: The last entry in versions[] is always the current version.
 * Earlier entries are historical versions in chronological order.
 */
export interface DocumentVersion {
  /**
   * SHA-256 hash of the document content.
   * Used for change detection and linking to immutable snapshots.
   * Format: lowercase hex string (64 characters)
   */
  contentHash: string;

  /**
   * Path to immutable snapshot relative to project documents directory.
   * Format: sources/<sha256>.<ext>
   * Example: sources/abc123...def.md
   *
   * To resolve to an absolute path, use resolveDocumentSnapshotPath()
   * from src/projects/storage.ts with the project's documents directory.
   */
  snapshotPath: string;

  /** Byte size of the document content */
  contentSize: number;

  /** ISO 8601 timestamp when this version was ingested */
  ingestedAt: string;

  /**
   * Optional version label provided by the user.
   * Not auto-generated; user-supplied when tracking releases.
   */
  versionLabel?: string;

  /**
   * Original source path relative to project workspace at ingestion time.
   * Preserved for each version since the source location may change.
   */
  sourcePath: string;

  /** Document format at ingestion time */
  format: DocumentFormat;

  /**
   * Optional notes about this version.
   */
  notes?: string;
}

/**
 * Document record tracking a logical document and all its versions.
 *
 * A documentId represents a logical document identity that persists
 * across content changes. Each content change creates a new version
 * while retaining the same documentId.
 *
 * Per PROJECT_SPEC.md section 7.2:
 * - Original source documents must be preserved
 * - Source references must be maintained
 */
export interface DocumentRecord {
  /** Unique document identifier within the project */
  documentId: string;

  /** Human-readable document name/title */
  name: string;

  /** ISO 8601 timestamp when document was first created */
  createdAt: string;

  /** ISO 8601 timestamp when document was last updated */
  updatedAt: string;

  /**
   * All versions of this document, ordered oldest to newest.
   * The last entry is the current/active version.
   *
   * This structure:
   * - Preserves all version metadata and snapshot references
   * - Supports version history navigation
   * - Never overwrites previous version data
   */
  versions: DocumentVersion[];
}

/**
 * Document registry containing all document records for a project.
 * Stored at: documents/documents.json
 *
 * Invariants:
 * - Each documentId maps to exactly one DocumentRecord
 * - DocumentRecord.versions array is never empty
 * - The last entry in versions[] is always the current version
 * - Earlier entries are historical versions in chronological order
 */
export interface DocumentRegistry {
  /** Schema version for migration support */
  schemaVersion: '1.0';

  /** ISO 8601 timestamp of last registry update */
  updatedAt: string;

  /** Map of documentId to DocumentRecord */
  documents: Record<string, DocumentRecord>;
}

/**
 * File extension for document formats.
 */
export function getExtensionForFormat(format: DocumentFormat): string {
  switch (format) {
    case 'markdown':
      return '.md';
    case 'text':
      return '.txt';
    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = format;
      throw new Error(`Unknown document format: ${_exhaustive}`);
  }
}

/**
 * Infer document format from file extension.
 *
 * Only .md and .txt are supported in Phase 2.
 * Note: .markdown is NOT supported and must be rejected.
 */
export function inferFormatFromExtension(ext: string): DocumentFormat | null {
  const normalized = ext.toLowerCase().startsWith('.')
    ? ext.toLowerCase()
    : `.${ext.toLowerCase()}`;

  switch (normalized) {
    case '.md':
      return 'markdown';
    case '.txt':
      return 'text';
    default:
      return null;
  }
}
