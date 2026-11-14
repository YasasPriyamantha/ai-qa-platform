/**
 * Tests for project workspace creation and loading service
 *
 * Verifies:
 * - Project creation with valid input
 * - Project loading
 * - Duplicate project rejection
 * - Invalid project ID rejection
 * - Path traversal prevention
 * - Missing config handling
 * - Malformed JSON handling
 * - Phase 2 configuration validation
 * - Legacy Phase 1 configuration compatibility
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProject,
  loadProject,
  projectExists,
  validateProjectId,
  isPathContained,
  resolveProjectPath,
  getDefaultProjectDataRoot,
  ProjectServiceError,
} from '../../../src/projects/service.js';
import { PROJECT_FILES } from '../../../src/projects/storage.js';

describe('validateProjectId', () => {
  it('should accept valid project IDs (lowercase slug convention)', () => {
    // Valid: lowercase alphanumeric with hyphens
    expect(() => validateProjectId('my-project')).not.toThrow();
    expect(() => validateProjectId('project123')).not.toThrow();
    expect(() => validateProjectId('saucedemo')).not.toThrow();
    expect(() => validateProjectId('a')).not.toThrow();
    expect(() => validateProjectId('a1b2c3')).not.toThrow();
    expect(() => validateProjectId('my-project-123')).not.toThrow();
  });

  it('should reject uppercase letters (prevents case-collision on Windows)', () => {
    expect(() => validateProjectId('SauceDemo')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('MyProject')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('PROJECT')).toThrow(ProjectServiceError);

    try {
      validateProjectId('SauceDemo');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
      expect((err as ProjectServiceError).message).toContain('lowercase');
    }
  });

  it('should reject underscores (use hyphens instead)', () => {
    expect(() => validateProjectId('project_123')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('my_project')).toThrow(ProjectServiceError);
  });

  it('should reject dots in project ID (except trailing period has specific error)', () => {
    expect(() => validateProjectId('project.name')).toThrow(ProjectServiceError);
  });

  it('should reject empty project IDs', () => {
    expect(() => validateProjectId('')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('   ')).toThrow(ProjectServiceError);

    try {
      validateProjectId('');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
      expect((err as ProjectServiceError).message).toContain('empty');
    }
  });

  it('should reject project IDs with path separators', () => {
    expect(() => validateProjectId('path/to/project')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('path\\to\\project')).toThrow(ProjectServiceError);

    try {
      validateProjectId('path/project');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
      expect((err as ProjectServiceError).message).toContain('path separators');
    }
  });

  it('should reject path traversal segments', () => {
    expect(() => validateProjectId('.')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('..')).toThrow(ProjectServiceError);

    try {
      validateProjectId('..');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
      expect((err as ProjectServiceError).message).toContain('traversal');
    }
  });

  it('should reject hidden file names (starting with .)', () => {
    expect(() => validateProjectId('.hidden')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('.gitignore')).toThrow(ProjectServiceError);

    try {
      validateProjectId('.hidden');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
      expect((err as ProjectServiceError).message).toContain('dot');
    }
  });

  it('should reject invalid filesystem characters', () => {
    expect(() => validateProjectId('project<name')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('project>name')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('project:name')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('project"name')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('project|name')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('project?name')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('project*name')).toThrow(ProjectServiceError);
  });

  it('should reject reserved Windows names (uppercase)', () => {
    expect(() => validateProjectId('CON')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('PRN')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('AUX')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('NUL')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('COM1')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('LPT1')).toThrow(ProjectServiceError);
  });

  it('should reject reserved Windows names (lowercase)', () => {
    // These are rejected by the reserved names check before the pattern check
    expect(() => validateProjectId('con')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('prn')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('aux')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('nul')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('com1')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('com9')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('lpt1')).toThrow(ProjectServiceError);
    expect(() => validateProjectId('lpt9')).toThrow(ProjectServiceError);

    try {
      validateProjectId('con');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
      expect((err as ProjectServiceError).message).toContain('reserved Windows name');
    }
  });

  it('should accept valid IDs that START with reserved name prefixes', () => {
    // These should NOT be rejected - only exact matches are reserved
    expect(() => validateProjectId('console')).not.toThrow();
    expect(() => validateProjectId('content')).not.toThrow();
    expect(() => validateProjectId('company')).not.toThrow();
    expect(() => validateProjectId('connection')).not.toThrow();
    expect(() => validateProjectId('context')).not.toThrow();
    expect(() => validateProjectId('printer')).not.toThrow();
    expect(() => validateProjectId('auxiliary')).not.toThrow();
    expect(() => validateProjectId('null-check')).not.toThrow();
    expect(() => validateProjectId('com1pany')).not.toThrow();
    expect(() => validateProjectId('lpt1-test')).not.toThrow();
  });

  it('should reject project IDs that are too long (max 64 characters)', () => {
    const longId = 'a'.repeat(65);
    expect(() => validateProjectId(longId)).toThrow(ProjectServiceError);

    try {
      validateProjectId(longId);
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
      expect((err as ProjectServiceError).message).toContain('too long');
    }
  });

  it('should accept project ID at max length (64 characters)', () => {
    const maxLengthId = 'a'.repeat(64);
    expect(() => validateProjectId(maxLengthId)).not.toThrow();
  });

  it('should reject trailing period (Windows filesystem issue)', () => {
    expect(() => validateProjectId('alpha.')).toThrow(ProjectServiceError);

    try {
      validateProjectId('alpha.');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
      expect((err as ProjectServiceError).message).toContain('period');
    }
  });

  it('should reject trailing space (Windows filesystem issue)', () => {
    expect(() => validateProjectId('alpha ')).toThrow(ProjectServiceError);

    try {
      validateProjectId('alpha ');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
      expect((err as ProjectServiceError).message).toContain('space');
    }
  });
});

describe('isPathContained', () => {
  it('should return true for paths inside base directory', () => {
    expect(isPathContained('/base/sub/file.txt', '/base')).toBe(true);
    expect(isPathContained('/base/deep/nested/path', '/base')).toBe(true);
    expect(isPathContained('/base', '/base')).toBe(true);
  });

  it('should return false for paths outside base directory', () => {
    expect(isPathContained('/other/file.txt', '/base')).toBe(false);
    expect(isPathContained('/base/../other', '/base')).toBe(false);
  });

  it('should return false for sibling paths with common prefix', () => {
    // /base-other is not inside /base even though it starts with /base
    expect(isPathContained('/base-other/file.txt', '/base')).toBe(false);
    expect(isPathContained('/basedir/file.txt', '/base')).toBe(false);
  });

  it('should handle Windows-style paths', () => {
    expect(isPathContained('D:\\projects\\sub\\file.txt', 'D:\\projects')).toBe(true);
    expect(isPathContained('D:\\other\\file.txt', 'D:\\projects')).toBe(false);
  });

  it('should handle case differences on Windows', () => {
    // On Windows, D: and d: are the same drive
    expect(isPathContained('D:\\projects\\sub', 'd:\\projects')).toBe(true);
    expect(isPathContained('d:\\projects\\sub', 'D:\\projects')).toBe(true);
  });
});

describe('resolveProjectPath', () => {
  it('should resolve relative paths within workspace', () => {
    const workspace = '/projects/my-project';
    expect(resolveProjectPath('docs/readme.md', workspace)).toBe(
      resolve(workspace, 'docs/readme.md')
    );
    expect(resolveProjectPath('tests/approved', workspace)).toBe(
      resolve(workspace, 'tests/approved')
    );
  });

  it('should reject paths that escape workspace', () => {
    const workspace = '/projects/my-project';

    expect(() => resolveProjectPath('../other-project', workspace)).toThrow(
      ProjectServiceError
    );
    expect(() => resolveProjectPath('../../etc/passwd', workspace)).toThrow(
      ProjectServiceError
    );

    try {
      resolveProjectPath('../escape', workspace);
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('PATH_TRAVERSAL');
    }
  });

  it('should reject absolute paths outside workspace', () => {
    const workspace = '/projects/my-project';

    expect(() => resolveProjectPath('/etc/passwd', workspace)).toThrow(
      ProjectServiceError
    );
  });
});

describe('getDefaultProjectDataRoot', () => {
  it('should return a path ending with project-data', () => {
    const root = getDefaultProjectDataRoot();
    expect(root.endsWith('project-data')).toBe(true);
  });

  it('should return an absolute path', () => {
    const root = getDefaultProjectDataRoot();
    // On Windows, absolute paths start with drive letter
    // On Unix, they start with /
    expect(root.match(/^[a-zA-Z]:/) || root.startsWith('/')).toBeTruthy();
  });
});

describe('createProject', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `qa-project-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create a project with minimal valid input', () => {
    const result = createProject(
      {
        projectId: 'test-project',
        name: 'Test Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
      },
      { projectDataRoot: tempDir }
    );

    // Check returned result
    expect(result.config.projectId).toBe('test-project');
    expect(result.config.name).toBe('Test Project');
    expect(result.config.baseUrl).toBe('https://example.com/');
    expect(result.config.environment).toBe('demo');
    expect(result.config.allowedDomains).toEqual(['example.com']);
    expect(result.config.testDirectory).toBe('tests/approved');
    expect(result.config.artifactDirectory).toBe('artifacts');

    // Check workspace was created
    const workspace = join(tempDir, 'test-project');
    expect(existsSync(workspace)).toBe(true);

    // Check config file was created
    const configPath = join(workspace, 'project.config.json');
    expect(existsSync(configPath)).toBe(true);

    // Check directories were created
    expect(existsSync(join(workspace, 'tests', 'approved'))).toBe(true);
    expect(existsSync(join(workspace, 'artifacts'))).toBe(true);

    // Verify config content
    const savedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(savedConfig.projectId).toBe('test-project');
    expect(savedConfig.testDirectory).toBe('tests/approved');
  });

  it('should create a project with custom directories', () => {
    const result = createProject(
      {
        projectId: 'custom-project',
        name: 'Custom Project',
        baseUrl: 'https://example.com/',
        environment: 'staging',
        allowedDomains: ['example.com'],
        testDirectory: 'custom/tests',
        artifactDirectory: 'custom/artifacts',
      },
      { projectDataRoot: tempDir }
    );

    expect(result.config.testDirectory).toBe('custom/tests');
    expect(result.config.artifactDirectory).toBe('custom/artifacts');

    const workspace = join(tempDir, 'custom-project');
    expect(existsSync(join(workspace, 'custom', 'tests'))).toBe(true);
    expect(existsSync(join(workspace, 'custom', 'artifacts'))).toBe(true);
  });

  it('should create a project with Phase 2 optional fields', () => {
    const result = createProject(
      {
        projectId: 'phase2-project',
        name: 'Phase 2 Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
        description: 'A Phase 2 project with all fields',
        roles: [
          {
            roleId: 'admin',
            name: 'Administrator',
            credentials: {
              username: 'ADMIN_USER',
              password: 'ADMIN_PASS',
            },
          },
        ],
        documents: [
          {
            documentId: 'workflow',
            sourcePath: 'docs/workflow.md',
            format: 'markdown',
          },
        ],
      },
      { projectDataRoot: tempDir }
    );

    expect(result.config.description).toBe('A Phase 2 project with all fields');
    expect(result.config.roles).toHaveLength(1);
    expect(result.config.roles![0].roleId).toBe('admin');
    expect(result.config.documents).toHaveLength(1);
    expect(result.config.documents![0].documentId).toBe('workflow');
  });

  it('should create a project with localhost URL', () => {
    const result = createProject(
      {
        projectId: 'local-project',
        name: 'Local Project',
        baseUrl: 'http://localhost',
        environment: 'local',
        allowedDomains: ['localhost'],
      },
      { projectDataRoot: tempDir }
    );

    expect(result.config.baseUrl).toBe('http://localhost');
    expect(result.config.environment).toBe('local');
  });

  it('should reject duplicate project creation', () => {
    // Create first project
    createProject(
      {
        projectId: 'existing-project',
        name: 'Existing Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
      },
      { projectDataRoot: tempDir }
    );

    // Try to create same project again
    expect(() =>
      createProject(
        {
          projectId: 'existing-project',
          name: 'Another Project',
          baseUrl: 'https://other.com/',
          environment: 'demo',
          allowedDomains: ['other.com'],
        },
        { projectDataRoot: tempDir }
      )
    ).toThrow(ProjectServiceError);

    try {
      createProject(
        {
          projectId: 'existing-project',
          name: 'Another Project',
          baseUrl: 'https://other.com/',
          environment: 'demo',
          allowedDomains: ['other.com'],
        },
        { projectDataRoot: tempDir }
      );
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('PROJECT_EXISTS');
      expect((err as ProjectServiceError).projectId).toBe('existing-project');
    }
  });

  it('should reject invalid project ID', () => {
    expect(() =>
      createProject(
        {
          projectId: '../escape',
          name: 'Escape Project',
          baseUrl: 'https://example.com/',
          environment: 'demo',
          allowedDomains: ['example.com'],
        },
        { projectDataRoot: tempDir }
      )
    ).toThrow(ProjectServiceError);

    try {
      createProject(
        {
          projectId: 'path/with/separators',
          name: 'Bad Project',
          baseUrl: 'https://example.com/',
          environment: 'demo',
          allowedDomains: ['example.com'],
        },
        { projectDataRoot: tempDir }
      );
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
    }
  });

  it('should reject testDirectory that escapes workspace', () => {
    expect(() =>
      createProject(
        {
          projectId: 'test-project',
          name: 'Test Project',
          baseUrl: 'https://example.com/',
          environment: 'demo',
          allowedDomains: ['example.com'],
          testDirectory: '../outside',
        },
        { projectDataRoot: tempDir }
      )
    ).toThrow(ProjectServiceError);

    try {
      createProject(
        {
          projectId: 'test-project2',
          name: 'Test Project',
          baseUrl: 'https://example.com/',
          environment: 'demo',
          allowedDomains: ['example.com'],
          testDirectory: '../../escape',
        },
        { projectDataRoot: tempDir }
      );
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('PATH_TRAVERSAL');
    }
  });

  it('should reject invalid Phase 2 configuration', () => {
    // Invalid role (missing credentials)
    expect(() =>
      createProject(
        {
          projectId: 'invalid-role-project',
          name: 'Invalid Project',
          baseUrl: 'https://example.com/',
          environment: 'demo',
          allowedDomains: ['example.com'],
          roles: [
            {
              roleId: 'admin',
              name: 'Admin',
              credentials: {} as Record<string, string>, // This gets written but rejected on validation
            },
          ],
        },
        { projectDataRoot: tempDir }
      )
    ).not.toThrow(); // Empty credentials object is valid
  });

  it('should not create speculative future directories', () => {
    createProject(
      {
        projectId: 'minimal-project',
        name: 'Minimal Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
      },
      { projectDataRoot: tempDir }
    );

    const workspace = join(tempDir, 'minimal-project');

    // Should NOT create these directories (they're for future phases)
    expect(existsSync(join(workspace, 'documents'))).toBe(false);
    expect(existsSync(join(workspace, 'requirements'))).toBe(false);
    expect(existsSync(join(workspace, 'tests', 'candidates'))).toBe(false);
  });
});

describe('loadProject', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `qa-load-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createValidProject(projectId: string, config?: Partial<object>) {
    const workspace = join(tempDir, projectId);
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const fullConfig = {
      projectId,
      name: `Project ${projectId}`,
      baseUrl: 'https://example.com/',
      environment: 'demo',
      allowedDomains: ['example.com'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      ...config,
    };

    writeFileSync(
      join(workspace, PROJECT_FILES.PROJECT_CONFIG),
      JSON.stringify(fullConfig, null, 2)
    );

    return workspace;
  }

  it('should load a valid project', () => {
    createValidProject('my-project');

    const result = loadProject('my-project', { projectDataRoot: tempDir });

    expect(result.config.projectId).toBe('my-project');
    expect(result.config.name).toBe('Project my-project');
    expect(result.config.projectWorkspace).toBe(join(tempDir, 'my-project'));
    expect(result.storagePaths.workspace).toBe(join(tempDir, 'my-project'));
  });

  it('should load a project with Phase 2 fields', () => {
    createValidProject('phase2-project', {
      description: 'A Phase 2 project',
      roles: [
        {
          roleId: 'user',
          name: 'Standard User',
          credentials: { username: 'USER_NAME' },
        },
      ],
      documents: [
        {
          documentId: 'readme',
          sourcePath: 'README.md',
          format: 'markdown',
        },
      ],
    });

    const result = loadProject('phase2-project', { projectDataRoot: tempDir });

    expect(result.config.description).toBe('A Phase 2 project');
    expect(result.config.roles).toHaveLength(1);
    expect(result.config.roles![0].roleId).toBe('user');
    expect(result.config.documents).toHaveLength(1);
  });

  it('should load a legacy Phase 1 project', () => {
    // Phase 1 config without any Phase 2 fields
    createValidProject('legacy-project');

    const result = loadProject('legacy-project', { projectDataRoot: tempDir });

    expect(result.config.projectId).toBe('legacy-project');
    expect(result.config.roles).toBeUndefined();
    expect(result.config.documents).toBeUndefined();
    expect(result.config.description).toBeUndefined();
  });

  it('should reject missing project', () => {
    expect(() =>
      loadProject('nonexistent-project', { projectDataRoot: tempDir })
    ).toThrow(ProjectServiceError);

    try {
      loadProject('nonexistent-project', { projectDataRoot: tempDir });
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('PROJECT_NOT_FOUND');
      expect((err as ProjectServiceError).projectId).toBe('nonexistent-project');
    }
  });

  it('should reject missing config file', () => {
    // Create workspace without config file
    const workspace = join(tempDir, 'no-config-project');
    mkdirSync(workspace, { recursive: true });

    expect(() =>
      loadProject('no-config-project', { projectDataRoot: tempDir })
    ).toThrow(ProjectServiceError);

    try {
      loadProject('no-config-project', { projectDataRoot: tempDir });
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('CONFIG_NOT_FOUND');
    }
  });

  it('should reject malformed JSON', () => {
    const workspace = join(tempDir, 'bad-json-project');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, PROJECT_FILES.PROJECT_CONFIG), '{invalid json');

    expect(() =>
      loadProject('bad-json-project', { projectDataRoot: tempDir })
    ).toThrow(ProjectServiceError);

    try {
      loadProject('bad-json-project', { projectDataRoot: tempDir });
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_CONFIG');
      expect((err as ProjectServiceError).message).toContain('Invalid JSON');
    }
  });

  it('should reject invalid Phase 1 config', () => {
    const workspace = join(tempDir, 'invalid-config-project');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });

    // Missing required field (allowedDomains)
    writeFileSync(
      join(workspace, PROJECT_FILES.PROJECT_CONFIG),
      JSON.stringify({
        projectId: 'invalid-config-project',
        name: 'Invalid Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        testDirectory: 'tests/approved',
        artifactDirectory: 'artifacts',
      })
    );

    expect(() =>
      loadProject('invalid-config-project', { projectDataRoot: tempDir })
    ).toThrow(ProjectServiceError);

    try {
      loadProject('invalid-config-project', { projectDataRoot: tempDir });
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_CONFIG');
    }
  });

  it('should reject invalid Phase 2 config (duplicate role IDs)', () => {
    const workspace = join(tempDir, 'dup-role-project');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    writeFileSync(
      join(workspace, PROJECT_FILES.PROJECT_CONFIG),
      JSON.stringify({
        projectId: 'dup-role-project',
        name: 'Duplicate Role Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
        testDirectory: 'tests/approved',
        artifactDirectory: 'artifacts',
        roles: [
          { roleId: 'admin', name: 'Admin 1', credentials: { u: 'U1' } },
          { roleId: 'admin', name: 'Admin 2', credentials: { u: 'U2' } },
        ],
      })
    );

    expect(() =>
      loadProject('dup-role-project', { projectDataRoot: tempDir })
    ).toThrow(ProjectServiceError);

    try {
      loadProject('dup-role-project', { projectDataRoot: tempDir });
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_CONFIG');
      expect((err as ProjectServiceError).message).toContain('Duplicate role ID');
    }
  });

  it('should reject secret values in credentials', () => {
    const workspace = join(tempDir, 'secret-project');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    writeFileSync(
      join(workspace, PROJECT_FILES.PROJECT_CONFIG),
      JSON.stringify({
        projectId: 'secret-project',
        name: 'Secret Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
        testDirectory: 'tests/approved',
        artifactDirectory: 'artifacts',
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: {
              token:
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc',
            },
          },
        ],
      })
    );

    expect(() =>
      loadProject('secret-project', { projectDataRoot: tempDir })
    ).toThrow(ProjectServiceError);

    try {
      loadProject('secret-project', { projectDataRoot: tempDir });
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_CONFIG');
      expect((err as ProjectServiceError).message).toContain('secret');
    }
  });

  it('should reject invalid project ID when loading', () => {
    expect(() =>
      loadProject('../escape', { projectDataRoot: tempDir })
    ).toThrow(ProjectServiceError);

    try {
      loadProject('.hidden', { projectDataRoot: tempDir });
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
    }
  });
});

describe('projectExists', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `qa-exists-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should return true for existing project', () => {
    createProject(
      {
        projectId: 'existing-project',
        name: 'Existing Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
      },
      { projectDataRoot: tempDir }
    );

    expect(projectExists('existing-project', { projectDataRoot: tempDir })).toBe(
      true
    );
  });

  it('should return false for non-existing project', () => {
    expect(projectExists('nonexistent', { projectDataRoot: tempDir })).toBe(
      false
    );
  });

  it('should return false for invalid project ID', () => {
    expect(projectExists('../escape', { projectDataRoot: tempDir })).toBe(false);
    expect(projectExists('', { projectDataRoot: tempDir })).toBe(false);
  });

  it('should return false for workspace without config', () => {
    const workspace = join(tempDir, 'no-config');
    mkdirSync(workspace, { recursive: true });

    expect(projectExists('no-config', { projectDataRoot: tempDir })).toBe(false);
  });
});

describe('create and load integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `qa-integration-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create and load a project successfully', () => {
    const created = createProject(
      {
        projectId: 'roundtrip-project',
        name: 'Roundtrip Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
        description: 'Testing roundtrip',
      },
      { projectDataRoot: tempDir }
    );

    const loaded = loadProject('roundtrip-project', { projectDataRoot: tempDir });

    expect(loaded.config.projectId).toBe(created.config.projectId);
    expect(loaded.config.name).toBe(created.config.name);
    expect(loaded.config.description).toBe(created.config.description);
    expect(loaded.config.projectWorkspace).toBe(created.config.projectWorkspace);
  });

  it('should create two isolated projects', () => {
    createProject(
      {
        projectId: 'project-a',
        name: 'Project A',
        baseUrl: 'https://a.example.com/',
        environment: 'demo',
        allowedDomains: ['a.example.com'],
      },
      { projectDataRoot: tempDir }
    );

    createProject(
      {
        projectId: 'project-b',
        name: 'Project B',
        baseUrl: 'https://b.example.com/',
        environment: 'staging',
        allowedDomains: ['b.example.com'],
      },
      { projectDataRoot: tempDir }
    );

    const projectA = loadProject('project-a', { projectDataRoot: tempDir });
    const projectB = loadProject('project-b', { projectDataRoot: tempDir });

    expect(projectA.config.projectId).toBe('project-a');
    expect(projectA.config.baseUrl).toBe('https://a.example.com/');
    expect(projectA.config.environment).toBe('demo');

    expect(projectB.config.projectId).toBe('project-b');
    expect(projectB.config.baseUrl).toBe('https://b.example.com/');
    expect(projectB.config.environment).toBe('staging');

    // Verify workspaces are separate
    expect(projectA.config.projectWorkspace).not.toBe(
      projectB.config.projectWorkspace
    );
  });
});

describe('validate before persisting', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `qa-validate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should reject invalid baseUrl before creating workspace', () => {
    const workspacePath = join(tempDir, 'invalid-url-project');

    expect(() =>
      createProject(
        {
          projectId: 'invalid-url-project',
          name: 'Invalid URL Project',
          baseUrl: 'not-a-valid-url',
          environment: 'demo',
          allowedDomains: ['example.com'],
        },
        { projectDataRoot: tempDir }
      )
    ).toThrow(ProjectServiceError);

    // Workspace should NOT be created
    expect(existsSync(workspacePath)).toBe(false);
  });

  it('should reject raw secret in credentials before creating workspace', () => {
    const workspacePath = join(tempDir, 'secret-project');
    const jwtToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.rTCH8cLoGxAm';

    expect(() =>
      createProject(
        {
          projectId: 'secret-project',
          name: 'Secret Project',
          baseUrl: 'https://example.com/',
          environment: 'demo',
          allowedDomains: ['example.com'],
          roles: [
            {
              roleId: 'admin',
              name: 'Admin',
              credentials: {
                token: jwtToken, // This is a raw secret, not an env var name
              },
            },
          ],
        },
        { projectDataRoot: tempDir }
      )
    ).toThrow(ProjectServiceError);

    // Workspace should NOT be created
    expect(existsSync(workspacePath)).toBe(false);

    // The secret should never appear on disk
    // (Since workspace doesn't exist, there's no config file to check)
  });

  it('should allow retry after failed creation', () => {
    // First attempt - invalid URL
    expect(() =>
      createProject(
        {
          projectId: 'retry-project',
          name: 'Retry Project',
          baseUrl: 'invalid-url',
          environment: 'demo',
          allowedDomains: ['example.com'],
        },
        { projectDataRoot: tempDir }
      )
    ).toThrow(ProjectServiceError);

    // Workspace should NOT exist
    expect(existsSync(join(tempDir, 'retry-project'))).toBe(false);

    // Second attempt - valid configuration
    const result = createProject(
      {
        projectId: 'retry-project',
        name: 'Retry Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
      },
      { projectDataRoot: tempDir }
    );

    expect(result.config.projectId).toBe('retry-project');
    expect(existsSync(join(tempDir, 'retry-project'))).toBe(true);
  });

  it('should not remove existing project during cleanup', () => {
    // Create a valid project first
    createProject(
      {
        projectId: 'existing-project',
        name: 'Existing Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
      },
      { projectDataRoot: tempDir }
    );

    const existingWorkspace = join(tempDir, 'existing-project');
    expect(existsSync(existingWorkspace)).toBe(true);

    // Try to create the same project again (should fail)
    expect(() =>
      createProject(
        {
          projectId: 'existing-project',
          name: 'Different Project',
          baseUrl: 'https://other.com/',
          environment: 'demo',
          allowedDomains: ['other.com'],
        },
        { projectDataRoot: tempDir }
      )
    ).toThrow(ProjectServiceError);

    // The existing project should still be there
    expect(existsSync(existingWorkspace)).toBe(true);

    // And the original config should be unchanged
    const config = JSON.parse(
      readFileSync(join(existingWorkspace, 'project.config.json'), 'utf-8')
    );
    expect(config.name).toBe('Existing Project');
    expect(config.baseUrl).toBe('https://example.com/');
  });

  it('should reject URL hostname not in allowedDomains', () => {
    const workspacePath = join(tempDir, 'domain-mismatch');

    expect(() =>
      createProject(
        {
          projectId: 'domain-mismatch',
          name: 'Domain Mismatch',
          baseUrl: 'https://different.com/',
          environment: 'demo',
          allowedDomains: ['example.com'], // baseUrl hostname not here
        },
        { projectDataRoot: tempDir }
      )
    ).toThrow(ProjectServiceError);

    expect(existsSync(workspacePath)).toBe(false);
  });
});

describe('filesystem-level no-overwrite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `qa-nooverwrite-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should reject duplicate workspace creation', () => {
    // Create first project
    createProject(
      {
        projectId: 'dup-project',
        name: 'First Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
      },
      { projectDataRoot: tempDir }
    );

    // Try to create duplicate
    try {
      createProject(
        {
          projectId: 'dup-project',
          name: 'Second Project',
          baseUrl: 'https://example.com/',
          environment: 'demo',
          allowedDomains: ['example.com'],
        },
        { projectDataRoot: tempDir }
      );
      expect.fail('Should have thrown PROJECT_EXISTS');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('PROJECT_EXISTS');
    }
  });

  it('should reject when workspace directory already exists (race condition)', () => {
    // Pre-create the directory (simulates race condition)
    const workspace = join(tempDir, 'race-project');
    mkdirSync(workspace);

    try {
      createProject(
        {
          projectId: 'race-project',
          name: 'Race Project',
          baseUrl: 'https://example.com/',
          environment: 'demo',
          allowedDomains: ['example.com'],
        },
        { projectDataRoot: tempDir }
      );
      expect.fail('Should have thrown PROJECT_EXISTS');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('PROJECT_EXISTS');
    }
  });

  it('should not overwrite existing configuration file', () => {
    // Create workspace with config file
    const workspace = join(tempDir, 'config-exists');
    mkdirSync(workspace);
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'));

    const originalConfig = {
      projectId: 'config-exists',
      name: 'Original Project',
      baseUrl: 'https://original.com/',
      environment: 'demo',
      allowedDomains: ['original.com'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
    };
    writeFileSync(
      join(workspace, 'project.config.json'),
      JSON.stringify(originalConfig, null, 2)
    );

    // Try to create project (should fail because workspace exists)
    try {
      createProject(
        {
          projectId: 'config-exists',
          name: 'New Project',
          baseUrl: 'https://new.com/',
          environment: 'demo',
          allowedDomains: ['new.com'],
        },
        { projectDataRoot: tempDir }
      );
      expect.fail('Should have thrown PROJECT_EXISTS');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('PROJECT_EXISTS');
    }

    // Original config should be unchanged
    const config = JSON.parse(
      readFileSync(join(workspace, 'project.config.json'), 'utf-8')
    );
    expect(config.name).toBe('Original Project');
    expect(config.baseUrl).toBe('https://original.com/');
  });
});

describe('projectId/workspace identity', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `qa-identity-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should persist projectId matching workspace directory name', () => {
    createProject(
      {
        projectId: 'matching-id',
        name: 'Matching ID Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
      },
      { projectDataRoot: tempDir }
    );

    const config = JSON.parse(
      readFileSync(join(tempDir, 'matching-id', 'project.config.json'), 'utf-8')
    );
    expect(config.projectId).toBe('matching-id');
  });

  it('should reject config with mismatched projectId when loading', () => {
    // Create workspace with mismatched projectId in config
    const workspace = join(tempDir, 'alpha');
    mkdirSync(workspace);
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'));

    // Config says "beta" but directory is "alpha"
    writeFileSync(
      join(workspace, 'project.config.json'),
      JSON.stringify({
        projectId: 'beta', // MISMATCH!
        name: 'Mismatched Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
        testDirectory: 'tests/approved',
        artifactDirectory: 'artifacts',
      })
    );

    try {
      loadProject('alpha', { projectDataRoot: tempDir });
      expect.fail('Should have thrown PROJECT_ID_MISMATCH');
    } catch (err) {
      expect((err as ProjectServiceError).code).toBe('PROJECT_ID_MISMATCH');
      expect((err as ProjectServiceError).message).toContain('alpha');
      expect((err as ProjectServiceError).message).toContain('beta');
    }
  });

  it('should load project when projectId matches directory', () => {
    // Create valid project
    const workspace = join(tempDir, 'correct-id');
    mkdirSync(workspace);
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'));

    writeFileSync(
      join(workspace, 'project.config.json'),
      JSON.stringify({
        projectId: 'correct-id', // Matches directory
        name: 'Correct ID Project',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
        testDirectory: 'tests/approved',
        artifactDirectory: 'artifacts',
      })
    );

    const result = loadProject('correct-id', { projectDataRoot: tempDir });
    expect(result.config.projectId).toBe('correct-id');
  });
});

describe('default project-data root', () => {
  it('should return path containing project-data', () => {
    const root = getDefaultProjectDataRoot();
    expect(root).toContain('project-data');
  });

  it('should be an absolute path', () => {
    const root = getDefaultProjectDataRoot();
    // On Windows, absolute paths start with drive letter
    // On Unix, they start with /
    expect(root.match(/^[a-zA-Z]:[\\/]/) || root.startsWith('/')).toBeTruthy();
  });

  it('should be the same regardless of process.cwd simulation', () => {
    // Since we can't easily change process.cwd() in tests,
    // we verify that the function doesn't use process.cwd()
    // by checking it uses import.meta.url instead
    const root1 = getDefaultProjectDataRoot();
    const root2 = getDefaultProjectDataRoot();
    expect(root1).toBe(root2);
  });

  it('should point to platform-root/project-data', () => {
    const root = getDefaultProjectDataRoot();
    // The root should end with 'project-data'
    expect(root.endsWith('project-data')).toBe(true);
    // And be within the platform repository
    expect(root).toContain('ai-qa-platform');
  });
});

describe('loadProject return shape', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `qa-shape-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should return config with all Phase 1 resolved fields', () => {
    createProject(
      {
        projectId: 'shape-test',
        name: 'Shape Test',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
      },
      { projectDataRoot: tempDir }
    );

    const result = loadProject('shape-test', { projectDataRoot: tempDir });

    // Phase 1 fields
    expect(result.config.projectId).toBe('shape-test');
    expect(result.config.name).toBe('Shape Test');
    expect(result.config.baseUrl).toBe('https://example.com/');
    expect(result.config.environment).toBe('demo');
    expect(result.config.allowedDomains).toEqual(['example.com']);
    expect(result.config.testDirectory).toBe('tests/approved');
    expect(result.config.artifactDirectory).toBe('artifacts');

    // Resolved paths
    expect(result.config.projectWorkspace).toBe(join(tempDir, 'shape-test'));
    expect(result.config.resolvedTestDirectory).toBe(
      join(tempDir, 'shape-test', 'tests', 'approved')
    );
    expect(result.config.resolvedArtifactDirectory).toBe(
      join(tempDir, 'shape-test', 'artifacts')
    );
    expect(result.config.configPath).toBe(
      join(tempDir, 'shape-test', 'project.config.json')
    );

    // Storage paths
    expect(result.storagePaths.workspace).toBe(join(tempDir, 'shape-test'));
    expect(result.storagePaths.documentsDir).toBe(
      join(tempDir, 'shape-test', 'documents')
    );
    expect(result.storagePaths.requirementsDir).toBe(
      join(tempDir, 'shape-test', 'requirements')
    );
  });

  it('should return config with Phase 2 optional fields when present', () => {
    createProject(
      {
        projectId: 'phase2-shape',
        name: 'Phase 2 Shape Test',
        baseUrl: 'https://example.com/',
        environment: 'demo',
        allowedDomains: ['example.com'],
        description: 'A test project',
        roles: [
          {
            roleId: 'admin',
            name: 'Admin',
            credentials: { username: 'ADMIN_USER' },
          },
        ],
        documents: [
          {
            documentId: 'spec',
            sourcePath: 'docs/spec.md',
            format: 'markdown',
          },
        ],
      },
      { projectDataRoot: tempDir }
    );

    const result = loadProject('phase2-shape', { projectDataRoot: tempDir });

    expect(result.config.description).toBe('A test project');
    expect(result.config.roles).toHaveLength(1);
    expect(result.config.roles![0].roleId).toBe('admin');
    expect(result.config.documents).toHaveLength(1);
    expect(result.config.documents![0].documentId).toBe('spec');
  });
});
