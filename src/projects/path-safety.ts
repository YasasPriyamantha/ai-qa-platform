/**
 * Shared path safety utilities for project workspace operations.
 *
 * This module provides the single source of truth for path-containment
 * checking across the project system. All callers that need to verify
 * a path stays within a workspace should use these utilities.
 *
 * Key behaviors:
 * - Windows drive-letter case normalization (D: and d: are equivalent)
 * - Forward-slash normalization for consistent comparison
 * - Handles both relative and absolute path inputs
 * - Prevents path traversal attacks (.., sibling-prefix paths)
 */

import { resolve, relative, parse as parsePath } from 'node:path';

/**
 * Normalize a path for comparison.
 *
 * - Converts backslashes to forward slashes
 * - Lowercases Windows drive letters (D: -> d:)
 * - Removes trailing slashes
 *
 * This normalization ensures consistent path comparison across
 * Windows and Unix systems, especially for drive-letter case
 * differences on Windows.
 *
 * @param p - Path to normalize
 * @returns Normalized path string
 */
export function normalizePath(p: string): string {
  // Normalize path separators to forward slashes
  let normalized = p.replace(/\\/g, '/');

  // Ensure drive letter is lowercase for comparison
  if (/^[A-Z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }

  // Remove trailing slash for consistent comparison
  if (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Check if a path is absolute.
 *
 * Handles both Unix and Windows absolute path formats:
 * - Unix: /path/to/file
 * - Windows: C:\path\to\file or C:/path/to/file
 * - Windows UNC: \\server\share or //server/share
 *
 * @param p - Path to check
 * @returns true if the path is absolute
 */
export function isAbsolutePath(p: string): boolean {
  const parsed = parsePath(p);
  return (
    parsed.root !== '' ||
    p.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(p)
  );
}

/**
 * Check if a resolved path is contained within a base directory.
 *
 * This is the core path-containment check used by all callers.
 * It handles:
 * - Windows drive-letter case differences (D: and d: are equivalent)
 * - Path traversal attempts (..)
 * - Sibling-prefix attacks (/base-sibling is not inside /base)
 *
 * IMPORTANT: Both paths should already be resolved to absolute paths.
 * Use `resolve()` before calling this function if needed.
 *
 * @param resolvedPath - The resolved absolute path to check
 * @param baseDir - The base directory that should contain the path
 * @returns true if resolvedPath is inside or equal to baseDir
 */
export function isPathContained(resolvedPath: string, baseDir: string): boolean {
  // Resolve both to ensure they're absolute
  const normalizedBase = normalizePath(resolve(baseDir));
  const normalizedPath = normalizePath(resolve(resolvedPath));

  // Use path.relative to check containment
  // If the relative path starts with '..' or is absolute, it escapes
  const rel = relative(normalizedBase, normalizedPath);

  if (rel.startsWith('..') || isAbsolutePath(rel)) {
    return false;
  }

  // Also do case-insensitive prefix check for Windows drive letters
  // This catches edge cases where path.relative might not handle
  // drive letter case differences correctly
  const baseLower = normalizedBase.toLowerCase();
  const pathLower = normalizedPath.toLowerCase();

  // The path must start with the base followed by nothing or a separator
  // This prevents sibling-prefix attacks: /base-sibling should not match /base
  if (pathLower === baseLower) {
    return true; // Exact match is contained
  }

  if (!pathLower.startsWith(baseLower)) {
    return false; // Doesn't start with base at all
  }

  // Check that the character after the base is a path separator
  // This ensures /base-sibling is NOT treated as inside /base
  const charAfterBase = normalizedPath[normalizedBase.length];
  return charAfterBase === '/' || charAfterBase === undefined;
}

/**
 * Check if a relative path would be contained within a workspace
 * after resolution.
 *
 * This is a convenience wrapper that first resolves the relative path
 * against the workspace, then checks containment.
 *
 * @param relativePath - The relative path to check
 * @param workspace - The workspace directory
 * @returns true if the resolved path is contained within workspace
 */
export function isRelativePathContained(relativePath: string, workspace: string): boolean {
  const resolved = resolve(workspace, relativePath);
  return isPathContained(resolved, workspace);
}
