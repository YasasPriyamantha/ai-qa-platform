/**
 * Project configuration module
 *
 * Exports types, validation, and environment loading for project configuration.
 */

// Type-only exports (interfaces)
export type {
  ExecutionConfig,
  ResolvedConfig,
  PlaywrightEnvConfig,
  Environment,
} from './config.js';

// Value exports (classes, constants)
export {
  ConfigValidationError,
  ALLOWED_ENVIRONMENTS,
} from './config.js';

// Loading and validation
export { loadProjectConfig } from './loader.js';

// Environment loading for Playwright
export {
  loadPlaywrightConfig,
  ENV_PROJECT_CONFIG_PATH,
  ENV_RUN_DIR,
} from './environment.js';

export type { EnvironmentVariables } from './environment.js';
