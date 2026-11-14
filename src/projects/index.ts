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
export { loadProjectConfig } from './loader.js';

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
  looksLikeSecret,
  isValidEnvVarName,
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
