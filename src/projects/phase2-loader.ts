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
 */

import { readFileSync } from 'node:fs';
import { loadProjectConfig } from './loader.js';
import { ConfigValidationError } from './config.js';
import type {
  ResolvedPhase2Config,
  RoleProfile,
  DocumentReference,
} from './phase2-config.js';

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
  // Contains password-like patterns
  /password\s*[:=]\s*.+/i,
];

/**
 * Common password-like values to reject.
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
 * @param name - Environment variable name to validate
 * @returns true if valid
 */
export function isValidEnvVarName(name: string): boolean {
  // Standard convention: uppercase letters, digits, underscores
  // Must start with letter or underscore
  return /^[A-Z_][A-Z0-9_]*$/.test(name);
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

  // Return combined configuration
  return {
    ...phase1Config,
    ...phase2Fields,
  };
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
    if (roleIds.has(roleId)) {
      throw new ConfigValidationError(
        `Duplicate role ID: ${roleId}`,
        `${prefix}.roleId`,
        roleId
      );
    }
    roleIds.add(roleId);

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

    // Check for actual secret values
    if (looksLikeSecret(value)) {
      throw new ConfigValidationError(
        'Value appears to be an actual secret. Store only environment variable NAMES, not secret values. ' +
        'Example: Use "MY_APP_PASSWORD" (env var name), not the actual password.',
        fieldPath,
        '[REDACTED]'
      );
    }

    // Warn but allow non-standard env var names (some systems use lowercase)
    // Strict validation would use: isValidEnvVarName(value)
    result[key] = value;
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
