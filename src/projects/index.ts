/**
 * Project configuration module
 *
 * Exports types, validation, and environment loading for project configuration.
 *
 * Phase 1 exports:
 * - ExecutionConfig, ResolvedConfig, PlaywrightEnvConfig - config types
 * - loadProjectConfig - Phase 1 config loader
 * - loadPlaywrightConfig - Playwright environment loader
 *
 * Phase 2 additions:
 * - Phase2ProjectConfig, ResolvedPhase2Config - extended config types
 * - RoleProfile, DocumentReference - new field types
 * - loadPhase2ProjectConfig - Phase 2 config loader
 * - Storage utilities for project file layout
 */

// Phase 1 type-only exports (interfaces)
export type {
  ExecutionConfig,
  ResolvedConfig,
  PlaywrightEnvConfig,
  Environment,
} from './config.js';

// Phase 1 value exports (classes, constants)
export {
  ConfigValidationError,
  ALLOWED_ENVIRONMENTS,
} from './config.js';

// Phase 1 loading and validation
export {
  loadProjectConfig,
  validateConfigInMemory,
  isRelativePathContained,
} from './loader.js';

// Environment loading for Playwright
export {
  loadPlaywrightConfig,
  ENV_PROJECT_CONFIG_PATH,
  ENV_RUN_DIR,
} from './environment.js';

export type { EnvironmentVariables } from './environment.js';

// Phase 2 type exports
export type {
  Phase2ProjectConfig,
  ResolvedPhase2Config,
  RoleProfile,
  DocumentReference,
} from './phase2-config.js';

// Phase 2 loading and validation
export {
  loadPhase2ProjectConfig,
  validatePhase2Fields,
  looksLikeSecret,
  isValidEnvVarName,
  validateEnvVarName,
  validateRoleIdFormat,
  checkCredentialPresence,
  checkRoleCredentialPresence,
  isAiProviderCredential,
  isBuiltInProviderKey,
  ROLE_ID_PATTERN,
  ROLE_ID_MAX_LENGTH,
} from './phase2-loader.js';

export type {
  ValidatedPhase2Fields,
  CredentialPresenceResult,
  EnvVarNameValidationResult,
  RoleIdValidationResult,
} from './phase2-loader.js';

// Project storage layout
export {
  PROJECT_DIRECTORIES,
  PROJECT_FILES,
  getProjectStoragePaths,
  getDocumentSnapshotPath,
  getRelativeSnapshotPath,
  getProposalPath,
} from './storage.js';

export type { ProjectStoragePaths } from './storage.js';

// Project workspace service
export {
  createProject,
  loadProject,
  projectExists,
  validateProjectId,
  isPathContained,
  resolveProjectPath,
  getDefaultProjectDataRoot,
  ProjectServiceError,
  PROJECT_ID_PATTERN,
} from './service.js';

export type {
  ProjectServiceOptions,
  CreateProjectInput,
  LoadedProject,
  ProjectErrorCode,
} from './service.js';

// Path safety utilities
export {
  normalizePath,
  isAbsolutePath,
  isPathContained as isPathContainedShared,
  isRelativePathContained as isRelativePathContainedShared,
} from './path-safety.js';

// Validation utilities
export {
  PROJECT_ID_PATTERN as PROJECT_ID_VALIDATION_PATTERN,
  PROJECT_ID_MAX_LENGTH,
  WINDOWS_RESERVED_NAMES,
  validateProjectIdFormat,
} from './validation.js';

export type { ProjectIdValidationResult } from './validation.js';
