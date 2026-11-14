/**
 * Document management module
 *
 * Provides types and utilities for document handling in Phase 2.
 * Document parsing and ingestion services are implemented in later tasks.
 */

export type {
  DocumentFormat,
  DocumentStatus,
  DocumentVersion,
  DocumentRecord,
  DocumentRegistry,
} from './types.js';

export {
  getExtensionForFormat,
  inferFormatFromExtension,
} from './types.js';
