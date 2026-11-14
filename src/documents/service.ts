/**
 * Document ingestion service
 *
 * Provides deterministic document ingestion with:
 * - Source preservation (exact byte copy to content-addressed snapshot)
 * - SHA-256 content hashing for change detection
 * - Atomic registry and snapshot writes
 * - Path containment with symlink/junction safety
 *
 * Storage layout (per DEC-029, DEC-030):
 * - documents/sources/<sha256>.<ext> - Immutable source snapshots
 * - documents/documents.json - Document metadata registry
 *
 * Key behaviors:
 * - Unchanged content reuses existing snapshots
 * - Changed content creates new snapshots (old ones retained)
 * - Corrupted snapshots are reported, never overwritten
 * - Registry updates are atomic (temp file + rename)
 * - Symlink/junction traversal is rejected
 */

import {
  readFileSync,
  existsSync,
} from 'node:fs';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  atomicWriteRegistry,
  atomicPublishSnapshot,
  verifyRealPathContainment,
  verifySnapshotDestination,
} from './atomic-fs.js';
import type { RegistryFsOps } from './atomic-fs.js';
import { DocumentServiceError } from './errors.js';
import {
  inferFormatFromExtension,
  getExtensionForFormat,
} from './types.js';
import type {
  DocumentFormat,
  DocumentVersion,
  DocumentRecord,
  DocumentRegistry,
} from './types.js';
import { getProjectStoragePaths, resolveDocumentSnapshotPath } from '../projects/storage.js';
import { isPathContained } from '../projects/path-safety.js';
import type { ProjectStoragePaths } from '../projects/storage.js';

/**
 * Input for ingesting a document.
 */
export interface IngestDocumentInput {
  /**
   * Unique document identifier within the project.
   * Must match the documentId in project.config.json documents[].
   */
  documentId: string;

  /**
   * Source path relative to project workspace.
   * Must be a .md or .txt file.
   */
  sourcePath: string;

  /**
   * Human-readable document name.
   * If not provided, defaults to documentId.
   */
  name?: string;

  /**
   * Optional version label for this ingestion.
   * User-supplied, not auto-generated.
   */
  versionLabel?: string;

  /**
   * Optional notes about this version.
   */
  notes?: string;
}

/**
 * Result of ingesting a document.
 */
export interface IngestDocumentResult {
  /**
   * The document record after ingestion.
   */
  record: DocumentRecord;

  /**
   * The version that was created or reused.
   */
  version: DocumentVersion;

  /**
   * Whether an existing snapshot was reused (content unchanged).
   */
  reused: boolean;

  /**
   * Path to the snapshot file.
   */
  snapshotPath: string;

  /**
   * Any orphaned snapshots created during a failed registry update.
   * These exist on disk but are not referenced in the registry.
   */
  orphanedSnapshots?: string[];
}

/**
 * Options for the document service.
 */
export interface DocumentServiceOptions {
  /**
   * Project workspace root path.
   */
  workspace: string;

  /**
   * Pre-computed storage paths (optional, computed from workspace if not provided).
   */
  storagePaths?: ProjectStoragePaths;

  /**
   * Optional filesystem operations for testing.
   * Allows injecting mock operations to test failure scenarios.
   */
  registryFsOps?: RegistryFsOps;
}

/**
 * Compute SHA-256 hash of content.
 *
 * @param content - Content to hash
 * @returns Lowercase hex hash string (64 characters)
 */
export function computeSHA256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Load the document registry from disk.
 *
 * @param registryPath - Path to documents.json
 * @returns The registry, or a new empty registry if file doesn't exist
 */
export function loadDocumentRegistry(registryPath: string): DocumentRegistry {
  if (!existsSync(registryPath)) {
    return {
      schemaVersion: '1.0',
      updatedAt: new Date().toISOString(),
      documents: {},
    };
  }

  try {
    const content = readFileSync(registryPath, 'utf-8');
    const parsed = JSON.parse(content) as DocumentRegistry;

    // Validate schema version
    if (parsed.schemaVersion !== '1.0') {
      throw new DocumentServiceError(
        `Unsupported registry schema version: ${parsed.schemaVersion}`,
        'REGISTRY_ERROR',
        undefined,
        registryPath
      );
    }

    return parsed;
  } catch (err) {
    if (err instanceof DocumentServiceError) {
      throw err;
    }

    if (err instanceof SyntaxError) {
      throw new DocumentServiceError(
        `Invalid JSON in document registry: ${err.message}`,
        'REGISTRY_ERROR',
        undefined,
        registryPath,
        err
      );
    }

    throw new DocumentServiceError(
      `Failed to read document registry: ${(err as Error).message}`,
      'READ_ERROR',
      undefined,
      registryPath,
      err as Error
    );
  }
}

/**
 * Get the current (active) version of a document.
 *
 * The last entry in versions[] is always the current version.
 * This is the single source of truth for document currency (per task requirements).
 *
 * @param record - Document record
 * @returns The current version, or undefined if no versions exist
 */
export function getCurrentVersion(record: DocumentRecord): DocumentVersion | undefined {
  if (record.versions.length === 0) {
    return undefined;
  }
  return record.versions[record.versions.length - 1];
}

/**
 * Validate and infer document format from file extension.
 *
 * @param sourcePath - Source file path
 * @returns Inferred format
 * @throws DocumentServiceError for unsupported formats
 */
function validateDocumentFormat(sourcePath: string): DocumentFormat {
  const ext = extname(sourcePath).toLowerCase();

  if (ext === '') {
    throw new DocumentServiceError(
      `Source file has no extension. Only .md and .txt files are supported.`,
      'UNSUPPORTED_FORMAT',
      undefined,
      sourcePath
    );
  }

  const format = inferFormatFromExtension(ext);

  if (format === null) {
    throw new DocumentServiceError(
      `Unsupported file format '${ext}'. Only .md and .txt files are supported.`,
      'UNSUPPORTED_FORMAT',
      undefined,
      sourcePath
    );
  }

  return format;
}

/**
 * Read source file bytes with validation.
 *
 * @param absolutePath - Absolute path to source file
 * @param documentId - Document ID for error reporting
 * @returns File content as Buffer
 * @throws DocumentServiceError for missing, unreadable, or empty files
 */
function readSourceBytes(
  absolutePath: string,
  documentId: string
): Buffer {
  if (!existsSync(absolutePath)) {
    throw new DocumentServiceError(
      `Source file not found: ${absolutePath}`,
      'DOCUMENT_NOT_FOUND',
      documentId,
      absolutePath
    );
  }

  try {
    const content = readFileSync(absolutePath);

    // Check for empty file
    if (content.length === 0) {
      throw new DocumentServiceError(
        `Source file is empty: ${absolutePath}`,
        'EMPTY_FILE',
        documentId,
        absolutePath
      );
    }

    return content;
  } catch (err) {
    if (err instanceof DocumentServiceError) {
      throw err;
    }

    const error = err as NodeJS.ErrnoException;

    if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw new DocumentServiceError(
        `Permission denied reading source file: ${absolutePath}`,
        'PERMISSION_ERROR',
        documentId,
        absolutePath,
        error
      );
    }

    throw new DocumentServiceError(
      `Failed to read source file: ${error.message}`,
      'READ_ERROR',
      documentId,
      absolutePath,
      error
    );
  }
}

/**
 * Validate that content can be decoded as UTF-8 text.
 *
 * @param content - Content to validate
 * @param documentId - Document ID for error reporting
 * @param path - File path for error reporting
 * @throws DocumentServiceError if content contains invalid UTF-8
 */
function validateTextEncoding(
  content: Buffer,
  documentId: string,
  path: string
): void {
  // Check for UTF-8 BOM and strip it for validation
  let checkContent = content;
  if (content[0] === 0xEF && content[1] === 0xBB && content[2] === 0xBF) {
    checkContent = content.subarray(3);
  }

  // Try to decode as UTF-8
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    decoder.decode(checkContent);
  } catch {
    throw new DocumentServiceError(
      `Source file contains invalid UTF-8 encoding: ${path}`,
      'ENCODING_ERROR',
      documentId,
      path
    );
  }
}

/**
 * Ingest a document into the project workspace.
 *
 * Sequence:
 * 1. Validate format (only .md and .txt supported)
 * 2. Resolve and verify path containment (lexical and real-path)
 * 3. Read source bytes (preserves exact content)
 * 4. Validate text encoding (must be valid UTF-8)
 * 5. Compute SHA-256 hash
 * 6. Publish snapshot atomically (create-if-absent, verify-if-exists)
 * 7. Update registry atomically (temp + rename)
 * 8. Return result with version and snapshot info
 *
 * @param input - Ingestion input
 * @param options - Service options
 * @returns Ingestion result
 * @throws DocumentServiceError for validation or I/O failures
 */
export function ingestDocument(
  input: IngestDocumentInput,
  options: DocumentServiceOptions
): IngestDocumentResult {
  const { workspace } = options;
  const storagePaths = options.storagePaths ?? getProjectStoragePaths(workspace);

  // Step 1: Validate format
  const format = validateDocumentFormat(input.sourcePath);
  const extension = getExtensionForFormat(format);

  // Step 2: Resolve and verify path containment
  const absoluteSourcePath = resolve(workspace, input.sourcePath);

  // Lexical containment check
  if (!isPathContained(absoluteSourcePath, workspace)) {
    throw new DocumentServiceError(
      `Source path '${input.sourcePath}' escapes project workspace`,
      'PATH_OUTSIDE_WORKSPACE',
      input.documentId,
      input.sourcePath
    );
  }

  // Real-path containment check (symlink/junction safety)
  verifyRealPathContainment(absoluteSourcePath, workspace);

  // Step 3: Read source bytes
  const sourceBytes = readSourceBytes(absoluteSourcePath, input.documentId);

  // Step 4: Validate text encoding
  validateTextEncoding(sourceBytes, input.documentId, absoluteSourcePath);

  // Step 5: Compute content hash
  const contentHash = computeSHA256(sourceBytes);

  // Step 6: Verify snapshot destination is safe
  verifySnapshotDestination(storagePaths.documentSourcesDir, workspace);

  // Step 7: Publish snapshot atomically
  const snapshotFilename = `${contentHash}${extension}`;
  const absoluteSnapshotPath = resolve(storagePaths.documentSourcesDir, snapshotFilename);
  const relativeSnapshotPath = `sources/${snapshotFilename}`;

  const snapshotResult = atomicPublishSnapshot(
    sourceBytes,
    contentHash,
    absoluteSnapshotPath,
    computeSHA256
  );

  if (!snapshotResult.success) {
    throw snapshotResult.error!;
  }

  // Step 8: Load and update registry
  const now = new Date().toISOString();
  const registry = loadDocumentRegistry(storagePaths.documentsRegistryPath);

  // Check if document already exists
  const existingRecord = registry.documents[input.documentId];

  // Create new version
  // Note: No status field - the last entry in versions[] is always the current version
  const newVersion: DocumentVersion = {
    contentHash,
    snapshotPath: relativeSnapshotPath,
    contentSize: sourceBytes.length,
    ingestedAt: now,
    sourcePath: input.sourcePath,
    format,
    versionLabel: input.versionLabel,
    notes: input.notes,
  };

  let record: DocumentRecord;
  let wasReused = snapshotResult.reused;

  if (existingRecord) {
    // Check if content is unchanged (same hash as current version)
    const currentVersion = getCurrentVersion(existingRecord);

    if (currentVersion && currentVersion.contentHash === contentHash) {
      // Content unchanged - reuse existing record, just update timestamps
      // Note: We don't add a new version entry for unchanged content
      record = {
        ...existingRecord,
        updatedAt: now,
      };
      wasReused = true;
    } else {
      // Content changed - add new version (last entry is always current)
      // Previous versions are implicitly superseded by their position
      record = {
        ...existingRecord,
        updatedAt: now,
        versions: [...existingRecord.versions, newVersion],
      };
    }
  } else {
    // New document
    record = {
      documentId: input.documentId,
      name: input.name ?? input.documentId,
      createdAt: now,
      updatedAt: now,
      versions: [newVersion],
    };
  }

  // Step 9: Update registry atomically
  registry.documents[input.documentId] = record;
  registry.updatedAt = now;

  const registryResult = atomicWriteRegistry(
    storagePaths.documentsRegistryPath,
    registry,
    options.registryFsOps
  );

  if (!registryResult.success) {
    // Registry update failed - snapshot may be orphaned
    const orphanedSnapshots: string[] = [];

    if (!snapshotResult.reused) {
      // We created a new snapshot that is now unreferenced
      orphanedSnapshots.push(absoluteSnapshotPath);
    }

    const error = registryResult.error as DocumentServiceError;
    if (orphanedSnapshots.length > 0) {
      throw new DocumentServiceError(
        `${error.message} Orphaned snapshot(s) remain on disk: ${orphanedSnapshots.join(', ')}. ` +
        `These snapshots are not referenced in the registry and may be safely deleted after investigation.`,
        'ORPHANED_SNAPSHOT',
        input.documentId,
        error.path,
        error
      );
    }

    throw error;
  }

  // Get the final version (current) from the record
  const finalVersion = getCurrentVersion(record)!;

  return {
    record,
    version: finalVersion,
    reused: wasReused,
    snapshotPath: absoluteSnapshotPath,
  };
}

/**
 * Get a document record from the registry.
 *
 * @param documentId - Document ID to retrieve
 * @param options - Service options
 * @returns Document record or undefined if not found
 */
export function getDocument(
  documentId: string,
  options: DocumentServiceOptions
): DocumentRecord | undefined {
  const storagePaths = options.storagePaths ?? getProjectStoragePaths(options.workspace);
  const registry = loadDocumentRegistry(storagePaths.documentsRegistryPath);
  return registry.documents[documentId];
}

/**
 * Get all document records from the registry.
 *
 * @param options - Service options
 * @returns Array of document records
 */
export function getAllDocuments(
  options: DocumentServiceOptions
): DocumentRecord[] {
  const storagePaths = options.storagePaths ?? getProjectStoragePaths(options.workspace);
  const registry = loadDocumentRegistry(storagePaths.documentsRegistryPath);
  return Object.values(registry.documents);
}

/**
 * Resolve a snapshot path from a document version to an absolute filesystem path.
 *
 * This uses the canonical resolveDocumentSnapshotPath() from storage.ts,
 * ensuring containment validation is applied consistently.
 *
 * @param version - Document version containing the snapshotPath
 * @param options - Service options (workspace required)
 * @returns Absolute path to the snapshot file
 * @throws DocumentServiceError if path escapes containment
 */
export function getSnapshotAbsolutePath(
  version: DocumentVersion,
  options: DocumentServiceOptions
): string {
  const storagePaths = options.storagePaths ?? getProjectStoragePaths(options.workspace);
  const result = resolveDocumentSnapshotPath(version.snapshotPath, storagePaths.documentsDir);

  if (!result.isContained) {
    throw new DocumentServiceError(
      result.error ?? `Snapshot path '${version.snapshotPath}' escapes containment`,
      'PATH_OUTSIDE_WORKSPACE',
      undefined,
      version.snapshotPath
    );
  }

  return result.absolutePath;
}

/**
 * Verify a snapshot file's integrity.
 *
 * @param snapshotPath - Absolute path to snapshot
 * @param expectedHash - Expected SHA-256 hash
 * @returns true if snapshot exists and hash matches
 * @throws DocumentServiceError if corrupted
 */
export function verifySnapshot(
  snapshotPath: string,
  expectedHash: string
): boolean {
  if (!existsSync(snapshotPath)) {
    return false;
  }

  const content = readFileSync(snapshotPath);
  const actualHash = computeSHA256(content);

  if (actualHash !== expectedHash) {
    throw new DocumentServiceError(
      `Snapshot corrupted: expected hash ${expectedHash}, found ${actualHash}`,
      'SNAPSHOT_CORRUPTED',
      undefined,
      snapshotPath
    );
  }

  return true;
}
