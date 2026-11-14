/**
 * Atomic filesystem operations for document service
 *
 * Provides safe file writing operations that prevent:
 * - Partial/truncated writes
 * - Overwriting existing files unintentionally
 * - Registry corruption during updates
 *
 * Key patterns:
 * - Write to temp file, then rename (atomic on same filesystem)
 * - Use fs.link() for atomic create-if-absent snapshot publication
 * - Cleanup only temp files created by current operation
 */

import {
  writeFileSync,
  renameSync,  // Used only by atomicWriteRegistry
  unlinkSync,
  linkSync,
  readFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  lstatSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { isPathContained } from '../projects/path-safety.js';
import { DocumentServiceError } from './errors.js';

/**
 * Generate a unique temporary filename.
 *
 * @param basePath - Directory for the temp file
 * @param prefix - Optional prefix for the temp filename
 * @returns Full path to a unique temp file
 */
export function generateTempPath(basePath: string, prefix = 'tmp'): string {
  const randomSuffix = randomBytes(8).toString('hex');
  const timestamp = Date.now();
  return join(basePath, `${prefix}-${timestamp}-${randomSuffix}.tmp`);
}

/**
 * Safely cleanup a temp file, ignoring errors.
 *
 * @param tempPath - Path to the temp file to remove
 */
export function cleanupTempFile(tempPath: string): void {
  try {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
  } catch {
    // Cleanup is best-effort
  }
}

/**
 * Result of an atomic registry write operation.
 */
export interface AtomicWriteResult {
  success: boolean;
  error?: Error;
  tempPath?: string;
}

/**
 * Filesystem operations for registry writes.
 * Used for dependency injection in tests.
 */
export interface RegistryFsOps {
  renameSync: typeof renameSync;
}

/**
 * Default filesystem operations using real fs module.
 */
const defaultRegistryFsOps: RegistryFsOps = {
  renameSync,
};

/**
 * Filesystem operations for snapshot publication.
 * Used for dependency injection in tests.
 */
export interface SnapshotFsOps {
  linkSync: typeof linkSync;
}

/**
 * Default snapshot filesystem operations using real fs module.
 */
const defaultSnapshotFsOps: SnapshotFsOps = {
  linkSync,
};

/**
 * Atomically write a JSON registry file.
 *
 * Sequence:
 * 1. Serialize and validate content
 * 2. Write to unique temp file in same directory
 * 3. Rename temp file to target (atomic on same filesystem)
 * 4. Cleanup temp file on failure
 *
 * On failure (EPERM, EBUSY, etc.):
 * - Preserves the original registry byte-for-byte
 * - Removes the temp file
 * - Returns clear error identifying the failure
 *
 * @param targetPath - Path to the registry file
 * @param content - Content to write (will be JSON-serialized)
 * @param fsOps - Optional filesystem operations for testing
 * @returns Result indicating success or failure with error details
 */
export function atomicWriteRegistry(
  targetPath: string,
  content: unknown,
  fsOps: RegistryFsOps = defaultRegistryFsOps
): AtomicWriteResult {
  const dir = dirname(targetPath);
  const tempPath = generateTempPath(dir, 'registry');

  try {
    // Ensure directory exists
    mkdirSync(dir, { recursive: true });

    // Serialize content
    const serialized = JSON.stringify(content, null, 2);

    // Write to temp file
    writeFileSync(tempPath, serialized, { encoding: 'utf-8' });

    // Attempt atomic rename
    try {
      fsOps.renameSync(tempPath, targetPath);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      cleanupTempFile(tempPath);

      // Return clear error for known failure modes
      if (error.code === 'EPERM' || error.code === 'EBUSY') {
        return {
          success: false,
          error: new DocumentServiceError(
            `Registry update failed: ${error.code} - file may be locked or in use. ` +
            `Original registry preserved at ${targetPath}`,
            'REGISTRY_ERROR',
            undefined,
            targetPath,
            error
          ),
          tempPath,
        };
      }

      return {
        success: false,
        error: new DocumentServiceError(
          `Registry update failed: ${error.message}. Original registry preserved.`,
          'REGISTRY_ERROR',
          undefined,
          targetPath,
          error
        ),
        tempPath,
      };
    }

    return { success: true };
  } catch (err) {
    cleanupTempFile(tempPath);

    const error = err as NodeJS.ErrnoException;
    return {
      success: false,
      error: new DocumentServiceError(
        `Failed to write registry: ${error.message}`,
        'WRITE_ERROR',
        undefined,
        targetPath,
        error
      ),
      tempPath,
    };
  }
}

/**
 * Result of an atomic snapshot publish operation.
 */
export interface SnapshotPublishResult {
  success: boolean;
  path: string;
  reused: boolean;
  error?: DocumentServiceError;
  tempPath?: string;
}

/**
 * Atomically publish a content-addressed snapshot.
 *
 * For new snapshots:
 * 1. Write to temp file in same directory
 * 2. Use fs.link() to create the final file (atomic create-if-absent)
 * 3. Remove temp file
 *
 * For existing snapshots:
 * 1. Read existing bytes
 * 2. Verify content hash matches
 * 3. Reuse if valid, error if corrupted
 *
 * Never overwrites an existing snapshot file.
 *
 * @param content - Content bytes to publish
 * @param expectedHash - Expected SHA-256 hash of content
 * @param targetPath - Final snapshot path
 * @param computeHash - Function to compute hash of bytes
 * @param fsOps - Optional filesystem operations for testing
 * @returns Result indicating success, reuse, or failure
 */
export function atomicPublishSnapshot(
  content: Buffer,
  expectedHash: string,
  targetPath: string,
  computeHash: (data: Buffer) => string,
  fsOps: SnapshotFsOps = defaultSnapshotFsOps
): SnapshotPublishResult {
  const dir = dirname(targetPath);
  let tempPath: string | undefined;

  try {
    // Ensure directory exists
    mkdirSync(dir, { recursive: true });

    // Check if snapshot already exists
    if (existsSync(targetPath)) {
      // Read existing bytes and verify
      const existingBytes = readFileSync(targetPath);
      const existingHash = computeHash(existingBytes);

      if (existingHash === expectedHash) {
        // Existing snapshot matches - reuse it
        return {
          success: true,
          path: targetPath,
          reused: true,
        };
      } else {
        // Corrupted snapshot - do NOT overwrite
        return {
          success: false,
          path: targetPath,
          reused: false,
          error: new DocumentServiceError(
            `Snapshot file is corrupted: expected hash ${expectedHash}, ` +
            `found ${existingHash}. File at ${targetPath} was NOT overwritten. ` +
            `Manual investigation required.`,
            'SNAPSHOT_CORRUPTED',
            undefined,
            targetPath
          ),
        };
      }
    }

    // Create temp file
    tempPath = generateTempPath(dir, 'snapshot');
    writeFileSync(tempPath, content);

    // Try to hard-link to final path (atomic create-if-absent)
    try {
      fsOps.linkSync(tempPath, targetPath);
      cleanupTempFile(tempPath);
      return {
        success: true,
        path: targetPath,
        reused: false,
      };
    } catch (err) {
      const error = err as NodeJS.ErrnoException;

      if (error.code === 'EEXIST') {
        // Another process created the file - verify and reuse
        cleanupTempFile(tempPath);

        const existingBytes = readFileSync(targetPath);
        const existingHash = computeHash(existingBytes);

        if (existingHash === expectedHash) {
          return {
            success: true,
            path: targetPath,
            reused: true,
          };
        } else {
          return {
            success: false,
            path: targetPath,
            reused: false,
            error: new DocumentServiceError(
              `Concurrent snapshot creation resulted in hash mismatch: ` +
              `expected ${expectedHash}, found ${existingHash}`,
              'SNAPSHOT_CORRUPTED',
              undefined,
              targetPath
            ),
          };
        }
      }

      // Fail closed for all non-EEXIST errors - NO FALLBACK TO RENAME
      //
      // Known hard-link compatibility error codes:
      // - EXDEV: Cross-device link (temp and target on different filesystems)
      // - EPERM: Operation not permitted (may indicate link not supported)
      // - ENOTSUP: Operation not supported (explicit lack of support)
      //
      // These codes suggest the filesystem may not support hard links,
      // but we do NOT fall back to rename because:
      // 1. rename() can overwrite existing files on some platforms
      // 2. A check-before-rename approach has a TOCTOU race condition
      // 3. Overwriting an existing snapshot violates the immutability guarantee
      //
      // Other error codes (EACCES, EIO, ENOSPC, etc.) indicate different
      // failure modes and should also fail closed with the original error.
      cleanupTempFile(tempPath);

      // Determine if this is likely a hard-link compatibility issue
      const hardLinkCompatibilityErrors = ['EXDEV', 'EPERM', 'ENOTSUP'];
      const isLikelyHardLinkIssue = hardLinkCompatibilityErrors.includes(error.code ?? '');

      const errorMessage = isLikelyHardLinkIssue
        ? `Snapshot publication failed: fs.link() returned ${error.code}. ` +
          `This may indicate the filesystem does not support hard links. ` +
          `No fallback to rename is attempted because it cannot guarantee ` +
          `atomic create-if-absent semantics. Target: ${targetPath}`
        : `Snapshot publication failed: ${error.message} (${error.code}). ` +
          `Target: ${targetPath}`;

      return {
        success: false,
        path: targetPath,
        reused: false,
        error: new DocumentServiceError(
          errorMessage,
          'WRITE_ERROR',
          undefined,
          targetPath,
          error
        ),
        tempPath,
      };
    }
  } catch (err) {
    if (tempPath) {
      cleanupTempFile(tempPath);
    }

    const error = err as NodeJS.ErrnoException;
    return {
      success: false,
      path: targetPath,
      reused: false,
      error: new DocumentServiceError(
        `Failed to publish snapshot: ${error.message}`,
        'WRITE_ERROR',
        undefined,
        targetPath,
        error
      ),
      tempPath,
    };
  }
}

/**
 * Verify that a path's real location is contained within a workspace.
 *
 * This checks both lexical containment and real-path containment,
 * protecting against symlink/junction traversal attacks.
 *
 * Sequence:
 * 1. Check lexical path containment
 * 2. Resolve real path of workspace
 * 3. Resolve real path of target
 * 4. Verify real target is inside real workspace
 *
 * @param targetPath - Path to verify (must exist for realpath check)
 * @param workspace - Workspace that should contain the path
 * @returns true if the real path is safely contained
 * @throws DocumentServiceError if path escapes via symlink/junction
 */
export function verifyRealPathContainment(
  targetPath: string,
  workspace: string
): boolean {
  // First check lexical containment
  if (!isPathContained(targetPath, workspace)) {
    throw new DocumentServiceError(
      `Path '${targetPath}' is lexically outside workspace '${workspace}'`,
      'PATH_OUTSIDE_WORKSPACE',
      undefined,
      targetPath
    );
  }

  // Check if target exists (needed for realpath)
  if (!existsSync(targetPath)) {
    // For non-existent paths, check parent directory
    const parentDir = dirname(targetPath);
    if (existsSync(parentDir)) {
      return verifyRealPathContainment(parentDir, workspace);
    }
    // If parent doesn't exist either, lexical check is sufficient
    return true;
  }

  // Resolve real paths
  let realWorkspace: string;
  let realTarget: string;

  try {
    realWorkspace = realpathSync(workspace);
  } catch {
    // Workspace doesn't exist or can't be resolved - this is an error
    throw new DocumentServiceError(
      `Cannot resolve real path of workspace '${workspace}'`,
      'PATH_TRAVERSAL',
      undefined,
      workspace
    );
  }

  try {
    realTarget = realpathSync(targetPath);
  } catch {
    // Target can't be resolved - might be broken symlink
    throw new DocumentServiceError(
      `Cannot resolve real path of '${targetPath}' - may be a broken symlink`,
      'SYMLINK_ESCAPE',
      undefined,
      targetPath
    );
  }

  // Verify real path containment
  if (!isPathContained(realTarget, realWorkspace)) {
    throw new DocumentServiceError(
      `Path '${targetPath}' resolves to '${realTarget}' which escapes ` +
      `workspace '${workspace}' (real path: '${realWorkspace}')`,
      'SYMLINK_ESCAPE',
      undefined,
      targetPath
    );
  }

  return true;
}

/**
 * Check if a path is a symbolic link or junction.
 *
 * @param path - Path to check
 * @returns true if the path is a symlink or junction
 */
export function isSymlinkOrJunction(path: string): boolean {
  try {
    const lstats = lstatSync(path);
    return lstats.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Verify that the snapshot destination directory is safe.
 *
 * Checks that the sources directory itself is not a symlink/junction
 * pointing outside the workspace.
 *
 * @param sourcesDir - Path to the document sources directory
 * @param workspace - Project workspace root
 * @throws DocumentServiceError if the directory escapes the workspace
 */
export function verifySnapshotDestination(
  sourcesDir: string,
  workspace: string
): void {
  // If the sources dir doesn't exist yet, that's fine
  if (!existsSync(sourcesDir)) {
    // Check parent directory
    const parent = dirname(sourcesDir);
    if (existsSync(parent)) {
      verifyRealPathContainment(parent, workspace);
    }
    return;
  }

  // Verify the sources directory itself
  verifyRealPathContainment(sourcesDir, workspace);

  // Additional check: is the sources directory a symlink?
  if (isSymlinkOrJunction(sourcesDir)) {
    const realSourcesDir = realpathSync(sourcesDir);
    const realWorkspace = realpathSync(workspace);

    if (!isPathContained(realSourcesDir, realWorkspace)) {
      throw new DocumentServiceError(
        `Document sources directory '${sourcesDir}' is a symlink/junction ` +
        `pointing outside workspace to '${realSourcesDir}'`,
        'SYMLINK_ESCAPE',
        undefined,
        sourcesDir
      );
    }
  }
}
