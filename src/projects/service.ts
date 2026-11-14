/**
 * Project workspace creation and loading service
 *
 * Provides functions to create and load project workspaces.
 * Uses the Phase 2 configuration loader for validation.
 *
 * Key behaviors:
 * - Default project-data root is <platform-repository-root>/project-data
 * - Root is injectable for tests via service options
 * - Project IDs are validated before use in paths
 * - All paths use path APIs with containment checks
 * - Configuration is validated BEFORE creating workspace (in-memory first)
 * - Never overwrites existing projects (atomic filesystem operations)
 * - Failed creation cleans up only the newly created workspace
 * - Config projectId must match the workspace directory name
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  statSync,
  rmSync,
} from 'node:fs';
import {
  resolve,
  dirname,
  join,
  basename,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigValidationError } from './config.js';
import { validateConfigInMemory, isRelativePathContained } from './loader.js';
import { loadPhase2ProjectConfig, validatePhase2Fields } from './phase2-loader.js';
import { getProjectStoragePaths, PROJECT_FILES } from './storage.js';
import {
  isAbsolutePath,
  isPathContained as isPathContainedShared,
} from './path-safety.js';
import {
  PROJECT_ID_PATTERN,
  validateProjectIdFormat,
} from './validation.js';
import type { Phase2ProjectConfig, ResolvedPhase2Config } from './phase2-config.js';
import type { ProjectStoragePaths } from './storage.js';

// Re-export the pattern for backward compatibility
export { PROJECT_ID_PATTERN };

/**
 * Error thrown when project operations fail.
 */
export class ProjectServiceError extends Error {
  constructor(
    message: string,
    public readonly code: ProjectErrorCode,
    public readonly projectId?: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProjectServiceError';
  }
}

/**
 * Error codes for project service operations.
 */
export type ProjectErrorCode =
  | 'INVALID_PROJECT_ID'
  | 'PROJECT_EXISTS'
  | 'PROJECT_NOT_FOUND'
  | 'CONFIG_NOT_FOUND'
  | 'INVALID_CONFIG'
  | 'PATH_TRAVERSAL'
  | 'FILESYSTEM_ERROR'
  | 'PERMISSION_ERROR'
  | 'PROJECT_ID_MISMATCH';

/**
 * Options for project service operations.
 */
export interface ProjectServiceOptions {
  /**
   * Root directory for project workspaces.
   * Defaults to <platform-repository-root>/project-data.
   * Must be an absolute path.
   */
  projectDataRoot?: string;
}

/**
 * Input for creating a new project.
 * Requires all Phase 1 fields plus optional Phase 2 fields.
 */
export interface CreateProjectInput {
  /** Unique project identifier (used as directory name) */
  projectId: string;

  /** Human-readable project name */
  name: string;

  /** Base URL for the target application */
  baseUrl: string;

  /** Target environment (local, development, demo, staging) */
  environment: 'local' | 'development' | 'demo' | 'staging';

  /** List of allowed domains for this project */
  allowedDomains: string[];

  /** Relative path to test directory from project workspace (default: 'tests/approved') */
  testDirectory?: string;

  /** Relative path to artifact directory from project workspace (default: 'artifacts') */
  artifactDirectory?: string;

  /** Optional project description */
  description?: string;

  /** Optional role profiles */
  roles?: Phase2ProjectConfig['roles'];

  /** Optional document references */
  documents?: Phase2ProjectConfig['documents'];
}

/**
 * Result of loading a project.
 */
export interface LoadedProject {
  /** Validated and resolved project configuration */
  config: ResolvedPhase2Config;

  /** Storage paths for the project workspace */
  storagePaths: ProjectStoragePaths;
}

/**
 * Get the default project-data root directory.
 * This is <platform-repository-root>/project-data.
 *
 * This function uses import.meta.url to find the platform root,
 * ensuring it works regardless of process.cwd().
 */
export function getDefaultProjectDataRoot(): string {
  // Get the directory of this module (src/projects/ or dist/projects/)
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);

  // Navigate up to platform root (projects -> src/dist -> root)
  const platformRoot = resolve(thisDir, '..', '..');

  return join(platformRoot, 'project-data');
}

/**
 * Validate a project ID for use in filesystem paths.
 *
 * Project IDs must:
 * - Be non-empty
 * - Match the lowercase slug pattern: [a-z0-9]+(?:-[a-z0-9]+)*
 * - Not be too long (max 64 characters for practical usage)
 * - Not be a reserved Windows name
 *
 * The lowercase slug convention prevents:
 * - Case-collision issues on Windows (Alpha vs alpha)
 * - Trailing period/space issues on Windows
 * - Path separator injection
 * - Path traversal attacks
 * - Invalid filesystem characters
 *
 * @param projectId - The project ID to validate
 * @throws ProjectServiceError if the ID is invalid
 */
export function validateProjectId(projectId: string): void {
  const result = validateProjectIdFormat(projectId);
  if (!result.valid) {
    throw new ProjectServiceError(
      result.error!,
      'INVALID_PROJECT_ID',
      projectId
    );
  }
}

/**
 * Check if a resolved path is contained within a base directory.
 * Uses path.relative-based checks that work on Windows.
 *
 * This is a re-export of the shared implementation from path-safety.ts
 * for backward compatibility.
 *
 * @param resolvedPath - The resolved absolute path to check
 * @param baseDir - The base directory that should contain the path
 * @returns true if resolvedPath is inside baseDir
 */
export function isPathContained(resolvedPath: string, baseDir: string): boolean {
  return isPathContainedShared(resolvedPath, baseDir);
}


/**
 * Resolve the project workspace path and verify containment.
 *
 * @param projectId - The project ID
 * @param projectDataRoot - The root directory for project data
 * @returns The resolved workspace path
 * @throws ProjectServiceError if path escapes root
 */
function resolveProjectWorkspace(
  projectId: string,
  projectDataRoot: string
): string {
  const workspace = resolve(projectDataRoot, projectId);

  if (!isPathContained(workspace, projectDataRoot)) {
    throw new ProjectServiceError(
      'Project ID resolves to a path outside the project-data directory',
      'PATH_TRAVERSAL',
      projectId
    );
  }

  return workspace;
}

/**
 * Safely remove a workspace directory that was created by this invocation.
 * Only removes if the directory is empty or contains only files we created.
 *
 * @param workspace - The workspace directory to remove
 * @param createdByUs - Whether we created this directory
 */
function cleanupWorkspace(workspace: string, createdByUs: boolean): void {
  if (!createdByUs) {
    return; // Never remove pre-existing directories
  }

  try {
    if (existsSync(workspace)) {
      rmSync(workspace, { recursive: true, force: true });
    }
  } catch {
    // Cleanup is best-effort; don't throw on failure
  }
}

/**
 * Create a new project workspace.
 *
 * Creation sequence:
 * 1. Validate project ID and input structure (no filesystem access)
 * 2. Validate Phase 1 configuration fields (URL, environment, domains) in-memory
 * 3. Validate Phase 2 configuration fields (roles, documents, secrets) in-memory
 * 4. Validate path containment for testDirectory and artifactDirectory
 * 5. Create project-data root if needed
 * 6. Create workspace directory atomically (fails if exists)
 * 7. Create testDirectory and artifactDirectory
 * 8. Write configuration file with exclusive flag (fails if exists)
 * 9. Final filesystem-dependent validation via Phase 2 loader
 * 10. Return loaded project
 *
 * If any step fails after workspace creation, cleanup removes only
 * the workspace directory that this invocation created.
 *
 * @param input - Project creation input
 * @param options - Service options (e.g., custom project-data root)
 * @returns The loaded project after creation
 * @throws ProjectServiceError for validation or filesystem failures
 */
export function createProject(
  input: CreateProjectInput,
  options?: ProjectServiceOptions
): LoadedProject {
  // === PHASE 1: In-memory validation (no filesystem access) ===

  // Validate project ID first
  validateProjectId(input.projectId);

  // Resolve project-data root
  const projectDataRoot = options?.projectDataRoot ?? getDefaultProjectDataRoot();
  if (!isAbsolutePath(projectDataRoot)) {
    throw new ProjectServiceError(
      'Project data root must be an absolute path',
      'INVALID_PROJECT_ID',
      input.projectId
    );
  }

  // Resolve workspace path with containment check
  const workspace = resolveProjectWorkspace(input.projectId, projectDataRoot);

  // Prepare config with defaults
  const testDirectory = input.testDirectory ?? 'tests/approved';
  const artifactDirectory = input.artifactDirectory ?? 'artifacts';

  // Build the configuration object
  const config: Phase2ProjectConfig = {
    projectId: input.projectId,
    name: input.name,
    baseUrl: input.baseUrl,
    environment: input.environment,
    allowedDomains: input.allowedDomains,
    testDirectory,
    artifactDirectory,
  };

  // Add optional fields if provided
  if (input.description) {
    config.description = input.description;
  }
  if (input.roles && input.roles.length > 0) {
    config.roles = input.roles;
  }
  if (input.documents && input.documents.length > 0) {
    config.documents = input.documents;
  }

  // Validate Phase 1 configuration fields in-memory (URL, environment, domains, etc.)
  // This catches invalid baseUrl, missing allowedDomains, etc. BEFORE any filesystem writes
  try {
    validateConfigInMemory(config);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      throw new ProjectServiceError(
        `Invalid configuration: ${err.message}`,
        'INVALID_CONFIG',
        input.projectId,
        err
      );
    }
    throw err;
  }

  // Validate Phase 2 configuration fields in-memory (roles, documents, secrets)
  // This catches raw secrets in credentials BEFORE any filesystem writes
  try {
    validatePhase2Fields(config as unknown as Record<string, unknown>);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      throw new ProjectServiceError(
        `Invalid configuration: ${err.message}`,
        'INVALID_CONFIG',
        input.projectId,
        err
      );
    }
    throw err;
  }

  // Validate path containment for testDirectory and artifactDirectory
  // Use a placeholder workspace path for containment check
  if (!isRelativePathContained(testDirectory, workspace)) {
    throw new ProjectServiceError(
      `testDirectory '${testDirectory}' would escape the project workspace`,
      'PATH_TRAVERSAL',
      input.projectId
    );
  }
  if (!isRelativePathContained(artifactDirectory, workspace)) {
    throw new ProjectServiceError(
      `artifactDirectory '${artifactDirectory}' would escape the project workspace`,
      'PATH_TRAVERSAL',
      input.projectId
    );
  }

  // === PHASE 2: Filesystem operations ===

  // Calculate paths
  const configPath = join(workspace, PROJECT_FILES.PROJECT_CONFIG);
  const resolvedTestDir = resolve(workspace, testDirectory);
  const resolvedArtifactDir = resolve(workspace, artifactDirectory);

  // Track whether we created the workspace (for cleanup)
  let workspaceCreated = false;

  try {
    // Ensure project-data root exists
    mkdirSync(projectDataRoot, { recursive: true });

    // Create workspace directory atomically (without recursive: true)
    // This fails with EEXIST if directory already exists
    try {
      mkdirSync(workspace);
      workspaceCreated = true;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'EEXIST') {
        throw new ProjectServiceError(
          `Project '${input.projectId}' already exists at ${workspace}`,
          'PROJECT_EXISTS',
          input.projectId
        );
      }
      throw err;
    }

    // Create test directory (required for Phase 1 validation)
    mkdirSync(resolvedTestDir, { recursive: true });

    // Create artifact directory
    mkdirSync(resolvedArtifactDir, { recursive: true });

    // Write configuration file with exclusive flag (fails if exists)
    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2), {
        encoding: 'utf-8',
        flag: 'wx', // Exclusive write - fails if file exists
      });
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'EEXIST') {
        throw new ProjectServiceError(
          `Project configuration already exists at ${configPath}`,
          'PROJECT_EXISTS',
          input.projectId
        );
      }
      throw err;
    }
  } catch (err) {
    // On any failure, cleanup the workspace we created
    cleanupWorkspace(workspace, workspaceCreated);

    // Re-throw ProjectServiceError as-is
    if (err instanceof ProjectServiceError) {
      throw err;
    }

    // Wrap other errors
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw new ProjectServiceError(
        `Permission denied creating project workspace: ${error.message}`,
        'PERMISSION_ERROR',
        input.projectId,
        error
      );
    }
    throw new ProjectServiceError(
      `Failed to create project workspace: ${error.message}`,
      'FILESYSTEM_ERROR',
      input.projectId,
      error
    );
  }

  // === PHASE 3: Final validation and return ===

  // Now validate the configuration using Phase 2 loader
  // This performs complete filesystem-dependent validation
  try {
    return loadProject(input.projectId, options);
  } catch (err) {
    // If validation fails, cleanup the workspace
    cleanupWorkspace(workspace, workspaceCreated);

    if (err instanceof ConfigValidationError) {
      throw new ProjectServiceError(
        `Configuration validation failed: ${err.message}`,
        'INVALID_CONFIG',
        input.projectId,
        err
      );
    }
    if (err instanceof ProjectServiceError) {
      throw err;
    }
    throw err;
  }
}

/**
 * Load an existing project.
 *
 * This function:
 * 1. Validates the project ID
 * 2. Resolves the workspace path
 * 3. Verifies the workspace and config exist
 * 4. Validates the configuration using the Phase 2 loader
 * 5. Verifies config.projectId matches the directory name
 * 6. Returns the loaded project with resolved paths
 *
 * @param projectId - The project ID to load
 * @param options - Service options (e.g., custom project-data root)
 * @returns The loaded project
 * @throws ProjectServiceError for validation or filesystem failures
 */
export function loadProject(
  projectId: string,
  options?: ProjectServiceOptions
): LoadedProject {
  // Validate project ID first
  validateProjectId(projectId);

  // Resolve project-data root
  const projectDataRoot = options?.projectDataRoot ?? getDefaultProjectDataRoot();
  if (!isAbsolutePath(projectDataRoot)) {
    throw new ProjectServiceError(
      'Project data root must be an absolute path',
      'INVALID_PROJECT_ID',
      projectId
    );
  }

  // Resolve workspace path with containment check
  const workspace = resolveProjectWorkspace(projectId, projectDataRoot);

  // Check if workspace exists
  if (!existsSync(workspace)) {
    throw new ProjectServiceError(
      `Project '${projectId}' not found at ${workspace}`,
      'PROJECT_NOT_FOUND',
      projectId
    );
  }

  // Check if it's a directory
  try {
    const stat = statSync(workspace);
    if (!stat.isDirectory()) {
      throw new ProjectServiceError(
        `Project path exists but is not a directory: ${workspace}`,
        'PROJECT_NOT_FOUND',
        projectId
      );
    }
  } catch (err) {
    if (err instanceof ProjectServiceError) {
      throw err;
    }
    if ((err as NodeJS.ErrnoException).code === 'EACCES') {
      throw new ProjectServiceError(
        `Permission denied accessing project: ${projectId}`,
        'PERMISSION_ERROR',
        projectId,
        err as Error
      );
    }
    throw err;
  }

  // Check config file exists
  const configPath = join(workspace, PROJECT_FILES.PROJECT_CONFIG);
  if (!existsSync(configPath)) {
    throw new ProjectServiceError(
      `Project configuration not found: ${configPath}`,
      'CONFIG_NOT_FOUND',
      projectId
    );
  }

  // Load and validate configuration using Phase 2 loader
  let config: ResolvedPhase2Config;
  try {
    config = loadPhase2ProjectConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      throw new ProjectServiceError(
        `Invalid project configuration: ${err.message}`,
        'INVALID_CONFIG',
        projectId,
        err
      );
    }
    if (err instanceof SyntaxError) {
      throw new ProjectServiceError(
        `Malformed JSON in project configuration: ${err.message}`,
        'INVALID_CONFIG',
        projectId,
        err
      );
    }
    throw new ProjectServiceError(
      `Failed to load project configuration: ${(err as Error).message}`,
      'FILESYSTEM_ERROR',
      projectId,
      err as Error
    );
  }

  // Verify projectId in config matches the directory name
  const directoryName = basename(workspace);
  if (config.projectId !== directoryName) {
    throw new ProjectServiceError(
      `Project ID mismatch: directory is '${directoryName}' but config contains '${config.projectId}'`,
      'PROJECT_ID_MISMATCH',
      projectId
    );
  }

  // Get storage paths
  const storagePaths = getProjectStoragePaths(workspace);

  return {
    config,
    storagePaths,
  };
}

/**
 * Check if a project exists.
 *
 * @param projectId - The project ID to check
 * @param options - Service options
 * @returns true if the project workspace and config exist
 */
export function projectExists(
  projectId: string,
  options?: ProjectServiceOptions
): boolean {
  try {
    validateProjectId(projectId);
  } catch {
    return false;
  }

  const projectDataRoot = options?.projectDataRoot ?? getDefaultProjectDataRoot();
  if (!isAbsolutePath(projectDataRoot)) {
    return false;
  }

  try {
    const workspace = resolveProjectWorkspace(projectId, projectDataRoot);
    const configPath = join(workspace, PROJECT_FILES.PROJECT_CONFIG);
    return existsSync(workspace) && existsSync(configPath);
  } catch {
    return false;
  }
}

/**
 * Resolve a path relative to a project workspace with containment check.
 *
 * @param relativePath - Path relative to the workspace
 * @param workspace - The project workspace path
 * @returns The resolved absolute path
 * @throws ProjectServiceError if path escapes workspace
 */
export function resolveProjectPath(
  relativePath: string,
  workspace: string
): string {
  const resolved = resolve(workspace, relativePath);

  if (!isPathContained(resolved, workspace)) {
    throw new ProjectServiceError(
      `Path '${relativePath}' escapes the project workspace`,
      'PATH_TRAVERSAL'
    );
  }

  return resolved;
}
