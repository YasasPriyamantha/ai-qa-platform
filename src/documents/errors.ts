/**
 * Document service error types
 *
 * Provides typed error classes for document operations.
 */

/**
 * Error codes for document operations.
 */
export type DocumentErrorCode =
  | 'DOCUMENT_NOT_FOUND'
  | 'UNSUPPORTED_FORMAT'
  | 'PATH_TRAVERSAL'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'SYMLINK_ESCAPE'
  | 'READ_ERROR'
  | 'WRITE_ERROR'
  | 'SNAPSHOT_CORRUPTED'
  | 'REGISTRY_ERROR'
  | 'EMPTY_FILE'
  | 'ENCODING_ERROR'
  | 'PERMISSION_ERROR'
  | 'ORPHANED_SNAPSHOT';

/**
 * Error thrown when document operations fail.
 */
export class DocumentServiceError extends Error {
  constructor(
    message: string,
    public readonly code: DocumentErrorCode,
    public readonly documentId?: string,
    public readonly path?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DocumentServiceError';
  }
}
