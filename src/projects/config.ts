/**
 * Phase 1 execution configuration types
 *
 * These field names are the subset used by Phase 1.
 * Phase 2 will add fields without renaming these.
 */

/**
 * Supported environment values for Phase 1.
 * Production is explicitly rejected.
 */
export const ALLOWED_ENVIRONMENTS = ['local', 'development', 'demo', 'staging'] as const;
export type Environment = (typeof ALLOWED_ENVIRONMENTS)[number];

/**
 * Raw project configuration as loaded from JSON.
 * All fields are required for Phase 1.
 */
export interface ExecutionConfig {
  /** Unique project identifier */
  projectId: string;

  /** Human-readable project name */
  name: string;

  /** Base URL for the target application */
  baseUrl: string;

  /** Target environment (local, development, demo, staging) */
  environment: Environment;

  /** List of allowed domains for this project */
  allowedDomains: string[];

  /** Relative path to test directory from project workspace */
  testDirectory: string;

  /** Relative path to artifact directory from project workspace */
  artifactDirectory: string;
}

/**
 * Validated and resolved project configuration with absolute paths.
 */
export interface ResolvedConfig extends ExecutionConfig {
  /** Absolute path to the project workspace (directory containing config) */
  projectWorkspace: string;

  /** Absolute path to the test directory */
  resolvedTestDirectory: string;

  /** Absolute path to the artifact directory */
  resolvedArtifactDirectory: string;

  /** Absolute path to the config file */
  configPath: string;
}

/**
 * Result of loading configuration from environment variables.
 */
export interface PlaywrightEnvConfig {
  /** Validated and resolved project configuration */
  config: ResolvedConfig;

  /** Absolute path to the run directory for this execution */
  runDir: string;

  /** Derived testDir for Playwright */
  testDir: string;

  /** Derived baseURL for Playwright */
  baseURL: string;

  /** Derived outputDir for Playwright (test-output within runDir) */
  outputDir: string;
}

/**
 * Validation error with field-specific information.
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown
  ) {
    super(field ? `${field}: ${message}` : message);
    this.name = 'ConfigValidationError';
  }
}
