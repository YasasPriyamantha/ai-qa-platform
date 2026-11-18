/**
 * Phase 2 project configuration loader and validator
 *
 * Extends Phase 1 loader with validation for new Phase 2 fields:
 * - Role profiles (with secret-value rejection)
 * - Document references
 *
 * Phase 1 configurations remain valid without modification.
 * All new fields are optional.
 *
 * SECURITY:
 * - Rejects any value that looks like a secret (passwords, tokens, keys)
 * - Only environment-variable NAMES are allowed in credential fields
 * - Loading/validating project configuration does NOT require referenced
 *   credential environment variables to be present
 * - A separate explicit credential-presence check is provided for when
 *   credentials are actually needed (e.g., authenticated test execution)
 *
 * Task 2.9: Role profiles and safe authentication/credential references
 */

import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadProjectConfig } from './loader.js';
import { ConfigValidationError } from './config.js';
import { isRelativePathContained } from './path-safety.js';
import type {
  ResolvedPhase2Config,
  RoleProfile,
  DocumentReference,
} from './phase2-config.js';

/**
 * Role ID validation pattern.
 *
 * Role IDs must be:
 * - Lowercase alphanumeric with hyphens and underscores
 * - Start with a lowercase letter or underscore
 * - Filesystem-safe for use as authentication-state filenames
 *
 * Examples:
 * - Valid: admin, standard_user, power-user, _internal
 * - Invalid: Admin (uppercase), 123user (starts with digit), user@admin (special char)
 *
 * Note: This pattern is distinct from DEC-031's project ID pattern.
 * Project IDs use hyphen separation only (no underscores).
 * Role IDs allow underscores to support existing IDs like `standard_user`.
 */
export const ROLE_ID_PATTERN = /^[a-z_][a-z0-9_-]*$/;

/**
 * Maximum length for role IDs.
 */
export const ROLE_ID_MAX_LENGTH = 64;

/**
 * Patterns that indicate a value might be a secret.
 * These are rejected in credential reference fields.
 */
const SECRET_PATTERNS = [
  // JWT tokens
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/,
  // Base64-encoded secrets (commonly 20+ chars of base64)
  /^[A-Za-z0-9+/]{20,}={0,2}$/,
  // UUID-like tokens
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // API keys (common prefixes)
  /^(sk-|pk-|api[_-]|key[_-]|token[_-]|secret[_-]|bearer\s)/i,
  // Contains password-like patterns (actual values, not env var names)
  /password\s*[:=]\s*.+/i,
];

/**
 * Common password-like values to reject.
 * These are bare field names, not env var names.
 */
const REJECTED_VALUES = new Set([
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'api-key',
  'secretkey',
  'secret_key',
  'secret-key',
  'accesstoken',
  'access_token',
  'access-token',
  'refreshtoken',
  'refresh_token',
  'refresh-token',
  'bearer',
]);

/**
 * Check if a value looks like a secret.
 * Used to reject actual secret values in credential reference fields.
 *
 * @param value - Value to check
 * @returns true if the value appears to be a secret
 */
export function looksLikeSecret(value: string): boolean {
  // Check against common password values (case-insensitive)
  if (REJECTED_VALUES.has(value.toLowerCase())) {
    return false; // These are field names, not secrets
  }

  // Check against secret patterns
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(value)) {
      return true;
    }
  }

  // Reject values with whitespace (likely actual values, not env var names)
  if (/\s/.test(value) && value.length > 20) {
    return true;
  }

  return false;
}

/**
 * Validate that a string is a valid environment variable name.
 * Must be uppercase letters, digits, and underscores only.
 * Must start with a letter or underscore.
 *
 * Valid examples: API_TOKEN, SAUCEDEMO_STANDARD_USER, SAUCEDEMO_STANDARD_PASSWORD
 *
 * Note: Names containing PASSWORD, TOKEN, or SECRET are VALID environment
 * variable names. The concern is storing actual secret VALUES, not names
 * that describe what the variable contains.
 *
 * @param name - Environment variable name to validate
 * @returns true if valid
 */
export function isValidEnvVarName(name: string): boolean {
  // Standard convention: uppercase letters, digits, underscores
  // Must start with letter or underscore
  return /^[A-Z_][A-Z0-9_]*$/.test(name);
}

/**
 * Validation result for environment variable names.
 */
export interface EnvVarNameValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate an environment variable name with detailed error message.
 *
 * Requirements:
 * - Must start with an uppercase letter or underscore
 * - Remaining characters may only be uppercase letters, digits, or underscores
 * - Lowercase and mixed-case names are rejected
 *
 * Valid examples: API_TOKEN, SAUCEDEMO_PASSWORD, SAUCEDEMO_USERNAME
 *
 * Note: Names containing PASSWORD, TOKEN, SECRET are VALID env var names.
 * The separate looksLikeSecret() check detects actual secret values.
 *
 * @param name - Environment variable name to validate
 * @returns Validation result with error message if invalid
 */
export function validateEnvVarName(name: string): EnvVarNameValidationResult {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Environment variable name cannot be empty' };
  }

  if (/^\d/.test(name)) {
    return { valid: false, error: 'Environment variable name cannot start with a digit' };
  }

  if (/\s/.test(name)) {
    return { valid: false, error: 'Environment variable name cannot contain whitespace' };
  }

  // Require uppercase letters, digits, and underscores only
  // Must start with uppercase letter or underscore
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
    return {
      valid: false,
      error: 'Environment variable name must be uppercase letters, digits, and underscores only (e.g., MY_VAR, API_TOKEN)',
    };
  }

  return { valid: true };
}

/**
 * Validate role ID format.
 *
 * Role IDs must be:
 * - Lowercase alphanumeric with hyphens and underscores
 * - Start with a lowercase letter or underscore
 * - Filesystem-safe for use as authentication-state filenames
 * - Not a Windows reserved device name
 *
 * Valid examples: admin, standard_user, power-user, _internal
 * Invalid examples: Admin (uppercase), 123user, con (reserved)
 *
 * @param roleId - Role ID to validate
 * @returns Validation result with error message if invalid
 */
export interface RoleIdValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Windows reserved device names (case-insensitive check).
 * Reused from validation.ts pattern.
 */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function validateRoleIdFormat(roleId: string): RoleIdValidationResult {
  if (!roleId || roleId.trim() === '') {
    return { valid: false, error: 'Role ID cannot be empty' };
  }

  if (roleId.length > ROLE_ID_MAX_LENGTH) {
    return { valid: false, error: `Role ID is too long (max ${ROLE_ID_MAX_LENGTH} characters)` };
  }

  // Check for path separators
  if (roleId.includes('/') || roleId.includes('\\')) {
    return { valid: false, error: 'Role ID cannot contain path separators' };
  }

  // Check for dots (not allowed in role IDs)
  if (roleId.includes('.')) {
    return { valid: false, error: 'Role ID cannot contain dots' };
  }

  // Check for whitespace
  if (/\s/.test(roleId)) {
    return { valid: false, error: 'Role ID cannot contain whitespace' };
  }

  // Check for Windows reserved names (case-insensitive)
  if (WINDOWS_RESERVED_NAMES.test(roleId)) {
    return { valid: false, error: 'Role ID cannot be a Windows reserved name' };
  }

  // Enforce lowercase pattern
  if (!ROLE_ID_PATTERN.test(roleId)) {
    return {
      valid: false,
      error: 'Role ID must be lowercase letters, digits, underscores, and hyphens only, starting with a letter or underscore (e.g., admin, standard_user, power-user)',
    };
  }

  return { valid: true };
}

/**
 * Validated Phase 2 fields (in-memory, no filesystem access).
 * Used by createProject to validate before persisting.
 */
export interface ValidatedPhase2Fields {
  roles?: RoleProfile[];
  documents?: DocumentReference[];
  description?: string;
}

/**
 * Result of credential presence check.
 * Reports which environment variables are missing, never their values.
 */
export interface CredentialPresenceResult {
  /** Whether all required credentials are present */
  allPresent: boolean;

  /** List of missing environment variable names (never values) */
  missingVariables: string[];

  /** Summary by role showing which variables are missing for each role */
  byRole: Record<string, {
    roleId: string;
    roleName: string;
    missing: string[];
    present: string[];
  }>;
}

/**
 * Check if all credential environment variables for a role are present.
 *
 * IMPORTANT: This function is a SEPARATE explicit check that a future
 * authenticated-run workflow can call when credentials are actually needed.
 * It is NOT called as part of ordinary project loading.
 *
 * This function:
 * - Reports missing variable NAMES only, never values
 * - Does not throw on missing credentials
 * - Is designed for pre-flight checks before authenticated test execution
 *
 * @param roles - Role profiles to check (from loaded project config)
 * @param env - Environment object to check (defaults to process.env)
 * @returns Credential presence result with missing variable names
 */
export function checkCredentialPresence(
  roles: RoleProfile[] | undefined,
  env: Record<string, string | undefined> = process.env
): CredentialPresenceResult {
  const result: CredentialPresenceResult = {
    allPresent: true,
    missingVariables: [],
    byRole: {},
  };

  if (!roles || roles.length === 0) {
    return result;
  }

  for (const role of roles) {
    const roleResult = {
      roleId: role.roleId,
      roleName: role.name,
      missing: [] as string[],
      present: [] as string[],
    };

    for (const [_credKey, envVarName] of Object.entries(role.credentials)) {
      // Check if the environment variable exists and has a non-empty value
      // A credential is considered missing when:
      // - It is undefined
      // - It is an empty string
      // - It contains whitespace only
      const value = env[envVarName];
      const isMissing = value === undefined || value === '' || value.trim() === '';

      if (isMissing) {
        roleResult.missing.push(envVarName);
        // Track all unique missing variables
        if (!result.missingVariables.includes(envVarName)) {
          result.missingVariables.push(envVarName);
        }
      } else {
        roleResult.present.push(envVarName);
      }
    }

    result.byRole[role.roleId] = roleResult;

    if (roleResult.missing.length > 0) {
      result.allPresent = false;
    }
  }

  return result;
}

/**
 * Check credential presence for a single role.
 *
 * @param role - Single role profile to check
 * @param env - Environment object to check (defaults to process.env)
 * @returns Object with missing variable names for this role
 */
export function checkRoleCredentialPresence(
  role: RoleProfile,
  env: Record<string, string | undefined> = process.env
): { roleId: string; missing: string[]; allPresent: boolean } {
  const missing: string[] = [];

  for (const [_credKey, envVarName] of Object.entries(role.credentials)) {
    // A credential is missing when undefined, empty, or whitespace-only
    const value = env[envVarName];
    const isMissing = value === undefined || value === '' || value.trim() === '';
    if (isMissing) {
      missing.push(envVarName);
    }
  }

  return {
    roleId: role.roleId,
    missing,
    allPresent: missing.length === 0,
  };
}

/**
 * Validate Phase 2-specific fields from a raw configuration object.
 * This performs in-memory validation only, with no filesystem access.
 *
 * Use this to validate configuration before persisting to disk.
 *
 * @param rawConfig - Raw configuration object to validate
 * @returns Validated Phase 2 fields
 * @throws ConfigValidationError for validation failures
 */
export function validatePhase2Fields(rawConfig: Record<string, unknown>): ValidatedPhase2Fields {
  const roles = validateRoles(rawConfig);
  const documents = validateDocuments(rawConfig);
  const description = validateDescription(rawConfig);

  return { roles, documents, description };
}

/**
 * Load and validate a Phase 2 project configuration.
 *
 * Extends Phase 1 validation with:
 * - Role profile validation
 * - Document reference validation
 * - Secret-value rejection
 *
 * Phase 1 configurations remain valid without modification.
 *
 * @param configPath - Absolute path to the project.config.json file
 * @returns Validated and resolved Phase 2 configuration
 * @throws ConfigValidationError for validation failures
 */
export function loadPhase2ProjectConfig(configPath: string): ResolvedPhase2Config {
  // First, load and validate Phase 1 fields
  const phase1Config = loadProjectConfig(configPath);

  // Read the raw JSON again for Phase 2 fields
  // (Phase 1 loader only returns Phase 1 fields)
  const rawContent = readFileSync(configPath, 'utf-8');
  const rawConfig = JSON.parse(rawContent) as Record<string, unknown>;

  // Validate and extract Phase 2 fields
  const phase2Fields = validatePhase2Fields(rawConfig);

  // Validate storageStatePath for each role if present
  // Must resolve inside the project workspace
  const projectWorkspace = dirname(configPath);
  if (phase2Fields.roles) {
    for (let i = 0; i < phase2Fields.roles.length; i++) {
      const role = phase2Fields.roles[i];
      if (role.storageStatePath) {
        validateStorageStatePath(
          role.storageStatePath,
          projectWorkspace,
          `roles[${i}].storageStatePath`
        );
      }
    }
  }

  // Return combined configuration
  return {
    ...phase1Config,
    ...phase2Fields,
  };
}

/**
 * Prefix reserved for platform-level AI provider credentials.
 * Project role credentials must not use this prefix.
 */
const AI_PROVIDER_PREFIX = 'AI_PROVIDER_';

/**
 * Check if a credential environment variable name uses the reserved AI provider prefix.
 *
 * @param envVarName - Environment variable name to check
 * @returns true if the name starts with AI_PROVIDER_
 */
export function isAiProviderCredential(envVarName: string): boolean {
  return envVarName.toUpperCase().startsWith(AI_PROVIDER_PREFIX);
}

/**
 * Validate that storageStatePath follows the documented convention.
 *
 * Per DEC-024 and Task 2.10: Authentication state files must:
 * - Be stored in the .auth/ directory inside the project workspace
 * - Use .json extension
 * - Not be absolute paths (POSIX, Windows drive, or UNC paths)
 * - Not contain path traversal segments
 *
 * Convention: .auth/<filename>.json
 *
 * @param storagePath - Relative path to storageState file
 * @param workspace - Project workspace directory
 * @param fieldPath - Field path for error messages
 * @throws ConfigValidationError if path is invalid
 */
function validateStorageStatePath(
  storagePath: string,
  workspace: string,
  fieldPath: string
): void {
  // Check for UNC path FIRST (before normalization changes \\server to //server)
  // UNC paths: \\server\share or //server/share
  if (storagePath.startsWith('\\\\') || storagePath.startsWith('//')) {
    throw new ConfigValidationError(
      `storageStatePath must be a relative path, not a UNC path.`,
      fieldPath,
      storagePath
    );
  }

  // Normalize backslashes to forward slashes for consistent validation
  // This prevents backslash from bypassing path checks
  const normalizedPath = storagePath.replace(/\\/g, '/');

  // Check for absolute POSIX path (after UNC check since // was already handled)
  if (normalizedPath.startsWith('/')) {
    throw new ConfigValidationError(
      `storageStatePath must be a relative path, not an absolute path.`,
      fieldPath,
      storagePath
    );
  }

  // Check for Windows drive-absolute path (e.g., C:/ or D:\)
  if (/^[a-zA-Z]:/.test(normalizedPath)) {
    throw new ConfigValidationError(
      `storageStatePath must be a relative path, not a Windows absolute path.`,
      fieldPath,
      storagePath
    );
  }

  // Check for path traversal segments
  const segments = normalizedPath.split('/');
  if (segments.includes('..')) {
    throw new ConfigValidationError(
      `storageStatePath must not contain path traversal segments (..).`,
      fieldPath,
      storagePath
    );
  }

  // Enforce .auth/ directory convention
  if (!normalizedPath.startsWith('.auth/')) {
    throw new ConfigValidationError(
      `storageStatePath must be inside the .auth/ directory (e.g., .auth/admin.json). ` +
      `Got: "${storagePath}"`,
      fieldPath,
      storagePath
    );
  }

  // Enforce direct-child of .auth/ (no subdirectories)
  // Convention: .auth/<filename>.json
  const afterAuth = normalizedPath.slice('.auth/'.length);
  if (afterAuth.includes('/')) {
    throw new ConfigValidationError(
      `storageStatePath must be a direct child of .auth/ (no subdirectories). ` +
      `Expected: .auth/<filename>.json, got: "${storagePath}"`,
      fieldPath,
      storagePath
    );
  }

  // Enforce .json extension
  if (!normalizedPath.toLowerCase().endsWith('.json')) {
    throw new ConfigValidationError(
      `storageStatePath must end with .json extension.`,
      fieldPath,
      storagePath
    );
  }

  // Final containment check using shared utility
  // This catches any remaining edge cases after normalization
  if (!isRelativePathContained(storagePath, workspace)) {
    throw new ConfigValidationError(
      `storageStatePath must resolve inside the project workspace. ` +
      `Path "${storagePath}" escapes the project directory.`,
      fieldPath,
      storagePath
    );
  }
}

/**
 * Validate role profiles if present.
 */
function validateRoles(raw: Record<string, unknown>): RoleProfile[] | undefined {
  if (!('roles' in raw)) {
    return undefined;
  }

  const roles = raw.roles;

  if (roles === undefined || roles === null) {
    return undefined;
  }

  if (!Array.isArray(roles)) {
    throw new ConfigValidationError(
      'Must be an array of role profiles',
      'roles',
      roles
    );
  }

  const roleIds = new Set<string>();
  const validatedRoles: RoleProfile[] = [];

  for (let i = 0; i < roles.length; i++) {
    const role = roles[i];
    const prefix = `roles[${i}]`;

    if (typeof role !== 'object' || role === null || Array.isArray(role)) {
      throw new ConfigValidationError(
        'Role must be an object',
        prefix,
        role
      );
    }

    const roleObj = role as Record<string, unknown>;

    // Validate roleId
    const roleId = validateRequiredString(roleObj, 'roleId', prefix);

    // Validate role ID format
    const roleIdResult = validateRoleIdFormat(roleId);
    if (!roleIdResult.valid) {
      throw new ConfigValidationError(
        roleIdResult.error!,
        `${prefix}.roleId`,
        roleId
      );
    }

    // Check for duplicate role IDs (case-insensitive for uniqueness)
    const roleIdLower = roleId.toLowerCase();
    if (roleIds.has(roleIdLower)) {
      throw new ConfigValidationError(
        `Duplicate role ID: ${roleId}`,
        `${prefix}.roleId`,
        roleId
      );
    }
    roleIds.add(roleIdLower);

    // Validate name
    const name = validateRequiredString(roleObj, 'name', prefix);

    // Validate optional description
    const description = validateOptionalString(roleObj, 'description', prefix);

    // Validate credentials
    const credentials = validateCredentials(roleObj, prefix);

    // Validate optional storageStatePath
    const storageStatePath = validateOptionalString(roleObj, 'storageStatePath', prefix);

    validatedRoles.push({
      roleId,
      name,
      description,
      credentials,
      storageStatePath,
    });
  }

  return validatedRoles.length > 0 ? validatedRoles : undefined;
}

/**
 * Validate credentials object.
 * Keys are credential identifiers, values are environment variable names.
 * Rejects secret values.
 */
function validateCredentials(
  roleObj: Record<string, unknown>,
  prefix: string
): Record<string, string> {
  const credentials = roleObj.credentials;

  if (credentials === undefined) {
    throw new ConfigValidationError(
      'credentials is required for role profiles',
      `${prefix}.credentials`
    );
  }

  if (typeof credentials !== 'object' || credentials === null || Array.isArray(credentials)) {
    throw new ConfigValidationError(
      'credentials must be an object mapping credential names to environment variable names',
      `${prefix}.credentials`,
      credentials
    );
  }

  const credObj = credentials as Record<string, unknown>;
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(credObj)) {
    const fieldPath = `${prefix}.credentials.${key}`;

    if (typeof value !== 'string') {
      throw new ConfigValidationError(
        `Must be a string (environment variable name), got ${typeof value}`,
        fieldPath,
        value
      );
    }

    if (value.trim() === '') {
      throw new ConfigValidationError(
        'Environment variable name cannot be empty',
        fieldPath,
        value
      );
    }

    // VALIDATION PRECEDENCE (Task 2.10):
    // 1. Check if value is a valid uppercase env var name
    // 2. If valid, check for reserved AI_PROVIDER_ prefix
    // 3. If NOT valid, use secret detection for a more helpful error
    //
    // This ensures valid env var names like API_TOKEN, SECRET_KEY are accepted,
    // while actual secret values like JWTs and UUIDs are rejected.

    const envVarResult = validateEnvVarName(value);

    if (envVarResult.valid) {
      // Valid env var name - check for reserved prefix
      if (isAiProviderCredential(value)) {
        throw new ConfigValidationError(
          `Project role credentials must not reference platform AI provider variables. ` +
          `Environment variable names starting with "AI_PROVIDER_" are reserved for platform use.`,
          fieldPath,
          '[REDACTED]'
        );
      }
      // Accept this valid env var name
      result[key] = value;
    } else {
      // Not a valid env var name - check if it looks like a secret for better error
      if (looksLikeSecret(value)) {
        throw new ConfigValidationError(
          'Value appears to be an actual secret. Store only environment variable NAMES, not secret values. ' +
          'Example: Use "MY_APP_PASSWORD" (env var name), not the actual password.',
          fieldPath,
          '[REDACTED]'
        );
      }
      // Not a secret, just an invalid env var name
      throw new ConfigValidationError(
        envVarResult.error!,
        fieldPath,
        value
      );
    }
  }

  return result;
}

/**
 * Validate document references if present.
 */
function validateDocuments(raw: Record<string, unknown>): DocumentReference[] | undefined {
  if (!('documents' in raw)) {
    return undefined;
  }

  const documents = raw.documents;

  if (documents === undefined || documents === null) {
    return undefined;
  }

  if (!Array.isArray(documents)) {
    throw new ConfigValidationError(
      'Must be an array of document references',
      'documents',
      documents
    );
  }

  const documentIds = new Set<string>();
  const validatedDocs: DocumentReference[] = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const prefix = `documents[${i}]`;

    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
      throw new ConfigValidationError(
        'Document reference must be an object',
        prefix,
        doc
      );
    }

    const docObj = doc as Record<string, unknown>;

    // Validate documentId
    const documentId = validateRequiredString(docObj, 'documentId', prefix);
    if (documentIds.has(documentId)) {
      throw new ConfigValidationError(
        `Duplicate document ID: ${documentId}`,
        `${prefix}.documentId`,
        documentId
      );
    }
    documentIds.add(documentId);

    // Validate sourcePath
    const sourcePath = validateRequiredString(docObj, 'sourcePath', prefix);

    // Validate format
    const format = validateDocumentFormat(docObj, prefix);

    validatedDocs.push({
      documentId,
      sourcePath,
      format,
    });
  }

  return validatedDocs.length > 0 ? validatedDocs : undefined;
}

/**
 * Validate document format field.
 */
function validateDocumentFormat(
  docObj: Record<string, unknown>,
  prefix: string
): 'markdown' | 'text' {
  const format = docObj.format;

  if (format === undefined) {
    throw new ConfigValidationError(
      'format is required for document references',
      `${prefix}.format`
    );
  }

  if (typeof format !== 'string') {
    throw new ConfigValidationError(
      `format must be a string, got ${typeof format}`,
      `${prefix}.format`,
      format
    );
  }

  if (format !== 'markdown' && format !== 'text') {
    throw new ConfigValidationError(
      'format must be "markdown" or "text"',
      `${prefix}.format`,
      format
    );
  }

  return format;
}

/**
 * Validate optional description field.
 */
function validateDescription(raw: Record<string, unknown>): string | undefined {
  if (!('description' in raw)) {
    return undefined;
  }

  const description = raw.description;

  if (description === undefined || description === null) {
    return undefined;
  }

  if (typeof description !== 'string') {
    throw new ConfigValidationError(
      `description must be a string, got ${typeof description}`,
      'description',
      description
    );
  }

  return description.trim() === '' ? undefined : description;
}

/**
 * Validate a required string field.
 */
function validateRequiredString(
  obj: Record<string, unknown>,
  field: string,
  prefix: string
): string {
  const value = obj[field];

  if (value === undefined) {
    throw new ConfigValidationError(
      `Required field is missing`,
      `${prefix}.${field}`
    );
  }

  if (typeof value !== 'string') {
    throw new ConfigValidationError(
      `Must be a string, got ${typeof value}`,
      `${prefix}.${field}`,
      value
    );
  }

  if (value.trim() === '') {
    throw new ConfigValidationError(
      'Cannot be empty',
      `${prefix}.${field}`,
      value
    );
  }

  return value;
}

/**
 * Validate an optional string field.
 */
function validateOptionalString(
  obj: Record<string, unknown>,
  field: string,
  prefix: string
): string | undefined {
  const value = obj[field];

  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new ConfigValidationError(
      `Must be a string if provided, got ${typeof value}`,
      `${prefix}.${field}`,
      value
    );
  }

  return value.trim() === '' ? undefined : value;
}
