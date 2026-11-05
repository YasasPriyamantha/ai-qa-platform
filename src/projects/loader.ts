/**
 * Project configuration loader and validator
 *
 * Implements runtime validation for Phase 1 execution configuration.
 * TypeScript interfaces do not provide runtime validation of external JSON.
 */

import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, parse as parsePath } from 'node:path';
import {
  ExecutionConfig,
  ResolvedConfig,
  ALLOWED_ENVIRONMENTS,
  ConfigValidationError,
  type Environment,
} from './config.js';

/**
 * Load and validate a project configuration from a JSON file.
 *
 * @param configPath - Absolute path to the project.config.json file
 * @returns Validated and resolved configuration
 * @throws ConfigValidationError for validation failures
 */
export function loadProjectConfig(configPath: string): ResolvedConfig {
  // Validate config path is absolute
  if (!isAbsolutePath(configPath)) {
    throw new ConfigValidationError(
      'Config path must be absolute',
      'configPath',
      configPath
    );
  }

  // Check file exists
  if (!existsSync(configPath)) {
    throw new ConfigValidationError(
      'Config file does not exist',
      'configPath',
      configPath
    );
  }

  // Read and parse JSON
  let rawContent: string;
  try {
    rawContent = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new ConfigValidationError(
      `Cannot read config file: ${(err as Error).message}`,
      'configPath',
      configPath
    );
  }

  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(rawContent);
  } catch {
    throw new ConfigValidationError(
      'Invalid JSON in config file',
      'configPath',
      configPath
    );
  }

  // Validate structure
  const config = validateConfigStructure(rawConfig);

  // Determine project workspace (directory containing the config file)
  const projectWorkspace = dirname(configPath);

  // Resolve and validate paths
  const resolvedTestDirectory = resolveAndContain(
    config.testDirectory,
    projectWorkspace,
    'testDirectory'
  );

  const resolvedArtifactDirectory = resolveAndContain(
    config.artifactDirectory,
    projectWorkspace,
    'artifactDirectory'
  );

  // Validate test directory exists
  validateDirectoryExists(resolvedTestDirectory, 'testDirectory');

  return {
    ...config,
    projectWorkspace,
    resolvedTestDirectory,
    resolvedArtifactDirectory,
    configPath,
  };
}

/**
 * Validate the raw configuration structure and types.
 */
function validateConfigStructure(raw: unknown): ExecutionConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigValidationError('Config must be a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  // Required string fields
  const projectId = validateRequiredString(obj, 'projectId');
  const name = validateRequiredString(obj, 'name');
  const baseUrl = validateRequiredString(obj, 'baseUrl');
  const testDirectory = validateRequiredString(obj, 'testDirectory');
  const artifactDirectory = validateRequiredString(obj, 'artifactDirectory');

  // Environment validation
  const environment = validateEnvironment(obj);

  // Allowed domains validation
  const allowedDomains = validateAllowedDomains(obj);

  // URL validation
  validateBaseUrl(baseUrl, allowedDomains);

  return {
    projectId,
    name,
    baseUrl,
    environment,
    allowedDomains,
    testDirectory,
    artifactDirectory,
  };
}

/**
 * Validate a required string field.
 */
function validateRequiredString(
  obj: Record<string, unknown>,
  field: string
): string {
  const value = obj[field];
  if (value === undefined) {
    throw new ConfigValidationError(`Required field is missing`, field);
  }
  if (typeof value !== 'string') {
    throw new ConfigValidationError(
      `Must be a string, got ${typeof value}`,
      field,
      value
    );
  }
  if (value.trim() === '') {
    throw new ConfigValidationError(`Cannot be empty`, field, value);
  }
  return value;
}

/**
 * Validate the environment field.
 */
function validateEnvironment(obj: Record<string, unknown>): Environment {
  const value = obj.environment;
  if (value === undefined) {
    throw new ConfigValidationError('Required field is missing', 'environment');
  }
  if (typeof value !== 'string') {
    throw new ConfigValidationError(
      `Must be a string, got ${typeof value}`,
      'environment',
      value
    );
  }

  // Check for production explicitly
  if (value === 'production') {
    throw new ConfigValidationError(
      'Production environment is not allowed in Phase 1',
      'environment',
      value
    );
  }

  if (!ALLOWED_ENVIRONMENTS.includes(value as Environment)) {
    throw new ConfigValidationError(
      `Must be one of: ${ALLOWED_ENVIRONMENTS.join(', ')}`,
      'environment',
      value
    );
  }

  return value as Environment;
}

/**
 * Validate the allowedDomains field.
 *
 * Each entry must be a bare hostname:
 * - No scheme (http://, https://)
 * - No path (/)
 * - No port (:8080)
 * - Valid hostname characters only
 */
function validateAllowedDomains(obj: Record<string, unknown>): string[] {
  const value = obj.allowedDomains;
  if (value === undefined) {
    throw new ConfigValidationError(
      'Required field is missing',
      'allowedDomains'
    );
  }
  if (!Array.isArray(value)) {
    throw new ConfigValidationError(
      `Must be an array, got ${typeof value}`,
      'allowedDomains',
      value
    );
  }
  if (value.length === 0) {
    throw new ConfigValidationError(
      'Must contain at least one domain',
      'allowedDomains',
      value
    );
  }

  for (let i = 0; i < value.length; i++) {
    const domain = value[i];
    if (typeof domain !== 'string' || domain.trim() === '') {
      throw new ConfigValidationError(
        `Domain at index ${i} must be a non-empty string`,
        'allowedDomains',
        value
      );
    }

    // Validate bare hostname format
    validateBareHostname(domain, i);
  }

  return value as string[];
}

/**
 * Validate that a domain entry is a bare hostname.
 *
 * Rejects:
 * - Schemes (contains "://")
 * - Paths (contains "/" after the hostname)
 * - Ports (contains ":" followed by digits)
 * - Empty or whitespace-only strings
 */
function validateBareHostname(domain: string, index: number): void {
  const trimmed = domain.trim();

  // Reject schemes (e.g., http://, https://, ftp://)
  if (trimmed.includes('://')) {
    throw new ConfigValidationError(
      `Domain at index ${index} must be a bare hostname, not a URL (contains scheme "://")`,
      'allowedDomains',
      domain
    );
  }

  // Reject paths (e.g., example.com/path)
  if (trimmed.includes('/')) {
    throw new ConfigValidationError(
      `Domain at index ${index} must be a bare hostname, not contain a path (contains "/")`,
      'allowedDomains',
      domain
    );
  }

  // Reject ports (e.g., example.com:8080)
  // Port syntax: hostname followed by : and digits
  if (/:(\d+)$/.test(trimmed) || /:(\d+)/.test(trimmed)) {
    throw new ConfigValidationError(
      `Domain at index ${index} must be a bare hostname, not contain a port (contains ":")`,
      'allowedDomains',
      domain
    );
  }

  // Validate it looks like a valid hostname
  // Allow: letters, digits, dots, hyphens
  // Must not start or end with hyphen or dot
  // Must not have consecutive dots
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(trimmed) && trimmed !== 'localhost') {
    // Single character hostnames like "a" or numeric like "1" are allowed
    if (!/^[a-zA-Z0-9]$/.test(trimmed)) {
      throw new ConfigValidationError(
        `Domain at index ${index} contains invalid hostname characters`,
        'allowedDomains',
        domain
      );
    }
  }

  // Reject consecutive dots
  if (trimmed.includes('..')) {
    throw new ConfigValidationError(
      `Domain at index ${index} contains invalid hostname (consecutive dots)`,
      'allowedDomains',
      domain
    );
  }
}

/**
 * Validate the baseUrl field.
 *
 * Hostname matching uses exact equality, case-insensitive.
 * Subdomains and parent domains are not interchangeable.
 */
function validateBaseUrl(baseUrl: string, allowedDomains: string[]): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ConfigValidationError(
      'Invalid URL syntax',
      'baseUrl',
      baseUrl
    );
  }

  // Check protocol
  // HTTP is only allowed for the hostname 'localhost' exactly.
  // 127.0.0.1 and other non-localhost hosts require HTTPS.
  const isLocalhost = url.hostname === 'localhost';

  if (url.protocol === 'http:' && !isLocalhost) {
    throw new ConfigValidationError(
      'HTTP is only allowed for localhost. Use HTTPS for non-localhost URLs (including 127.0.0.1)',
      'baseUrl',
      baseUrl
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigValidationError(
      'URL must use http or https protocol',
      'baseUrl',
      baseUrl
    );
  }

  // Check hostname is in allowed domains using case-insensitive exact match.
  // URL.hostname is already normalized to lowercase by the URL constructor.
  // We compare with lowercased allowedDomains entries for case-insensitivity.
  const urlHostnameLower = url.hostname.toLowerCase();
  const isAllowed = allowedDomains.some(
    (domain) => domain.toLowerCase() === urlHostnameLower
  );

  if (!isAllowed) {
    throw new ConfigValidationError(
      `URL hostname '${url.hostname}' is not in allowedDomains (exact match required)`,
      'baseUrl',
      baseUrl
    );
  }
}

/**
 * Check if a path is absolute.
 * Handles both Unix and Windows paths.
 */
function isAbsolutePath(p: string): boolean {
  // Windows absolute paths: C:\ or \\server
  // Unix absolute paths: /
  const parsed = parsePath(p);
  return (
    parsed.root !== '' ||
    p.startsWith('/') ||
    /^[a-zA-Z]:[\\/]/.test(p)
  );
}

/**
 * Resolve a relative path and ensure it stays within the workspace.
 * Uses path.resolve + path.relative containment check.
 * Handles Windows drive-letter case differences.
 */
function resolveAndContain(
  relativePath: string,
  workspace: string,
  field: string
): string {
  // Resolve to absolute path
  const resolved = resolve(workspace, relativePath);

  // Check containment using path.relative
  // If the relative path starts with '..' or is absolute, it escapes
  const rel = relative(workspace, resolved);

  if (rel.startsWith('..') || isAbsolutePath(rel)) {
    throw new ConfigValidationError(
      `Path escapes project workspace`,
      field,
      relativePath
    );
  }

  // Also normalize and compare for Windows drive-letter case differences
  // Both paths should be under the same root when normalized
  const normalizedWorkspace = normalizeWindowsPath(workspace);
  const normalizedResolved = normalizeWindowsPath(resolved);

  if (!normalizedResolved.toLowerCase().startsWith(normalizedWorkspace.toLowerCase())) {
    throw new ConfigValidationError(
      `Path escapes project workspace (drive-letter case mismatch)`,
      field,
      relativePath
    );
  }

  return resolved;
}

/**
 * Normalize a Windows path for comparison.
 * Converts to lowercase drive letter and forward slashes.
 */
function normalizeWindowsPath(p: string): string {
  // Normalize path separators
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
 * Validate that a directory exists.
 */
function validateDirectoryExists(dirPath: string, field: string): void {
  if (!existsSync(dirPath)) {
    throw new ConfigValidationError(
      `Directory does not exist: ${dirPath}`,
      field,
      dirPath
    );
  }

  try {
    const stat = statSync(dirPath);
    if (!stat.isDirectory()) {
      throw new ConfigValidationError(
        `Path exists but is not a directory: ${dirPath}`,
        field,
        dirPath
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ConfigValidationError(
        `Cannot access directory: ${(err as Error).message}`,
        field,
        dirPath
      );
    }
    throw new ConfigValidationError(
      `Directory does not exist: ${dirPath}`,
      field,
      dirPath
    );
  }
}
