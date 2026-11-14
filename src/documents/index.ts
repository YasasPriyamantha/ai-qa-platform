/**
 * Document management module
 *
 * Provides types, utilities, and services for document handling in Phase 2.
 */

// Types
export type {
  DocumentFormat,
  DocumentVersion,
  DocumentRecord,
  DocumentRegistry,
} from './types.js';

export {
  getExtensionForFormat,
  inferFormatFromExtension,
} from './types.js';

// Errors
export { DocumentServiceError } from './errors.js';
export type { DocumentErrorCode } from './errors.js';

// Service
export {
  ingestDocument,
  getDocument,
  getAllDocuments,
  loadDocumentRegistry,
  getCurrentVersion,
  computeSHA256,
  verifySnapshot,
  getSnapshotAbsolutePath,
} from './service.js';

export type {
  IngestDocumentInput,
  IngestDocumentResult,
  DocumentServiceOptions,
} from './service.js';

// Atomic filesystem operations
export {
  atomicWriteRegistry,
  atomicPublishSnapshot,
  verifyRealPathContainment,
  verifySnapshotDestination,
  generateTempPath,
  cleanupTempFile,
  isSymlinkOrJunction,
} from './atomic-fs.js';

export type {
  AtomicWriteResult,
  SnapshotPublishResult,
  RegistryFsOps,
  SnapshotFsOps,
} from './atomic-fs.js';
