/**
 * Shared validation utilities for project configuration.
 *
 * This module provides validation patterns and helpers that are used
 * by both the Phase 1 loader (loader.ts) and the project service (service.ts).
 * It exists to avoid circular dependencies between those modules.
 */

/**
 * Project ID validation pattern.
 *
 * Convention: lowercase alphanumeric with hyphens for word separation.
 * Pattern: ^[a-z0-9]+(?:-[a-z0-9]+)*$
 *
 * Examples:
 * - Valid: saucedemo, my-project, test123, a, a1b2c3
 * - Invalid: MyProject (uppercase), my_project (underscore), -start (leading hyphen)
 *
 * Rationale:
 * - Lowercase-only prevents Windows case-collision issues (Alpha vs alpha)
 * - No trailing periods/spaces avoids Windows filesystem normalization issues
 * - Alphanumeric with hyphens is a widely-used portable convention (URL slugs, npm packages)
 * - Consistent casing improves predictability and avoids user confusion
 *
 * Compatible IDs:
 * - saucedemo (existing project)
 * - fixture-passing, fixture-failing, etc. (existing fixtures)
 */
export const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Maximum length for project IDs.
 * 64 characters is practical for UX while being well under filesystem limits.
 */
export const PROJECT_ID_MAX_LENGTH = 64;

/**
 * Reserved Windows names that cannot be used as project IDs.
 */
export const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Result of project ID validation.
 */
export interface ProjectIdValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a project ID against all rules.
 *
 * This is the single source of truth for project ID validation.
 * Both the Phase 1 loader and the project service use this function.
 *
 * @param projectId - The project ID to validate
 * @returns Validation result with error message if invalid
 */
export function validateProjectIdFormat(projectId: string): ProjectIdValidationResult {
  // Check for empty or whitespace-only
  if (!projectId || projectId.trim() === '') {
    return { valid: false, error: 'Project ID cannot be empty' };
  }

  // Check for path separators (explicit check for clear error message)
  if (projectId.includes('/') || projectId.includes('\\')) {
    return { valid: false, error: 'Project ID cannot contain path separators (/ or \\)' };
  }

  // Check for path traversal segments (explicit check for clear error message)
  if (projectId === '.' || projectId === '..') {
    return { valid: false, error: 'Project ID cannot be a path traversal segment (. or ..)' };
  }

  // Check for hidden file prefix (explicit check for clear error message)
  if (projectId.startsWith('.')) {
    return { valid: false, error: 'Project ID cannot start with a dot' };
  }

  // Check for trailing period (Windows issue: "alpha." becomes "alpha")
  if (projectId.endsWith('.')) {
    return { valid: false, error: 'Project ID cannot end with a period (Windows filesystem limitation)' };
  }

  // Check for trailing space (Windows issue: "alpha " becomes "alpha")
  if (projectId.endsWith(' ')) {
    return { valid: false, error: 'Project ID cannot end with a space (Windows filesystem limitation)' };
  }

  // Check for invalid filesystem characters (Windows-focused)
  // < > : " | ? * and control characters 0-31
  const invalidChars = /[<>:"|?*\x00-\x1f]/;
  if (invalidChars.test(projectId)) {
    return { valid: false, error: 'Project ID contains invalid filesystem characters' };
  }

  // Check for reserved Windows names
  if (WINDOWS_RESERVED_NAMES.test(projectId)) {
    return { valid: false, error: 'Project ID cannot be a reserved Windows name' };
  }

  // Check length
  if (projectId.length > PROJECT_ID_MAX_LENGTH) {
    return { valid: false, error: `Project ID is too long (max ${PROJECT_ID_MAX_LENGTH} characters)` };
  }

  // Finally, enforce the lowercase slug pattern
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    return {
      valid: false,
      error:
        'Project ID must be lowercase alphanumeric with hyphens (e.g., my-project-123). ' +
        'Uppercase letters, underscores, and special characters are not allowed.',
    };
  }

  return { valid: true };
}
