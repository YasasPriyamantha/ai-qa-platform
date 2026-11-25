/**
 * Project workspace isolation and path safety tests
 *
 * Task 2.3: Deterministic tests proving project workspace isolation and path safety.
 *
 * Verifies:
 * - Two independent projects remain isolated
 * - Loading either project returns only its own config and resolved paths
 * - Creating/modifying files in one project does not alter the other
 * - testDirectory and artifactDirectory cannot resolve outside workspace
 * - Path traversal, sibling-prefix paths, and absolute paths are rejected
 * - Windows drive-letter/case behavior
 * - Duplicate project IDs and existing workspace conflicts
 * - Windows-safe project IDs (trailing periods, trailing spaces, case collision)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createProject,
  loadProject,
  validateProjectId,
  resolveProjectPath,
  isPathContained,
  ProjectServiceError,
  PROJECT_ID_PATTERN,
  validateProjectIdFormat,
} from '../../../src/projects/index.js';
import { isRelativePathContained } from '../../../src/projects/loader.js';
import { loadProjectConfig, validateConfigInMemory } from '../../../src/projects/loader.js';
import { ConfigValidationError } from '../../../src/projects/config.js';
import { PROJECT_FILES } from '../../../src/projects/storage.js';

describe('Project Workspace Isolation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `qa-isolation-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Two Independent Projects', () => {
    it('should create two projects with different configurations', () => {
      // Create project A
      const projectA = createProject(
        {
          projectId: 'project-alpha',
          name: 'Project Alpha',
          baseUrl: 'https://alpha.example.com/',
          environment: 'demo',
          allowedDomains: ['alpha.example.com'],
          testDirectory: 'tests/alpha-approved',
          artifactDirectory: 'artifacts/alpha',
        },
        { projectDataRoot: tempDir }
      );

      // Create project B with different configuration
      const projectB = createProject(
        {
          projectId: 'project-beta',
          name: 'Project Beta',
          baseUrl: 'https://beta.example.com/',
          environment: 'staging',
          allowedDomains: ['beta.example.com'],
          testDirectory: 'tests/beta-approved',
          artifactDirectory: 'artifacts/beta',
        },
        { projectDataRoot: tempDir }
      );

      // Verify configurations are independent
      expect(projectA.config.projectId).toBe('project-alpha');
      expect(projectB.config.projectId).toBe('project-beta');
      expect(projectA.config.baseUrl).toBe('https://alpha.example.com/');
      expect(projectB.config.baseUrl).toBe('https://beta.example.com/');
      expect(projectA.config.environment).toBe('demo');
      expect(projectB.config.environment).toBe('staging');
    });

    it('should load each project with its own configuration', () => {
      // Create both projects
      createProject(
        {
          projectId: 'loader-alpha',
          name: 'Loader Alpha',
          baseUrl: 'https://alpha.test/',
          environment: 'local',
          allowedDomains: ['alpha.test'],
        },
        { projectDataRoot: tempDir }
      );

      createProject(
        {
          projectId: 'loader-beta',
          name: 'Loader Beta',
          baseUrl: 'https://beta.test/',
          environment: 'development',
          allowedDomains: ['beta.test'],
        },
        { projectDataRoot: tempDir }
      );

      // Load each project separately
      const loadedA = loadProject('loader-alpha', { projectDataRoot: tempDir });
      const loadedB = loadProject('loader-beta', { projectDataRoot: tempDir });

      // Verify loading returns correct config
      expect(loadedA.config.projectId).toBe('loader-alpha');
      expect(loadedA.config.name).toBe('Loader Alpha');
      expect(loadedA.config.baseUrl).toBe('https://alpha.test/');

      expect(loadedB.config.projectId).toBe('loader-beta');
      expect(loadedB.config.name).toBe('Loader Beta');
      expect(loadedB.config.baseUrl).toBe('https://beta.test/');
    });

    it('should have separate resolved paths for each project', () => {
      createProject(
        {
          projectId: 'paths-alpha',
          name: 'Paths Alpha',
          baseUrl: 'http://localhost',
          environment: 'local',
          allowedDomains: ['localhost'],
        },
        { projectDataRoot: tempDir }
      );

      createProject(
        {
          projectId: 'paths-beta',
          name: 'Paths Beta',
          baseUrl: 'http://localhost',
          environment: 'local',
          allowedDomains: ['localhost'],
        },
        { projectDataRoot: tempDir }
      );

      const loadedA = loadProject('paths-alpha', { projectDataRoot: tempDir });
      const loadedB = loadProject('paths-beta', { projectDataRoot: tempDir });

      // Resolved paths should be within respective workspaces
      expect(loadedA.config.projectWorkspace).toContain('paths-alpha');
      expect(loadedB.config.projectWorkspace).toContain('paths-beta');

      expect(loadedA.config.resolvedTestDirectory).toContain('paths-alpha');
      expect(loadedB.config.resolvedTestDirectory).toContain('paths-beta');

      // Paths should not overlap
      expect(loadedA.config.projectWorkspace).not.toBe(loadedB.config.projectWorkspace);
      expect(loadedA.config.resolvedTestDirectory).not.toBe(loadedB.config.resolvedTestDirectory);
    });

    it('should not affect one project when modifying files in another', () => {
      // Create two projects
      createProject(
        {
          projectId: 'modify-alpha',
          name: 'Modify Alpha',
          baseUrl: 'http://localhost',
          environment: 'local',
          allowedDomains: ['localhost'],
        },
        { projectDataRoot: tempDir }
      );

      createProject(
        {
          projectId: 'modify-beta',
          name: 'Modify Beta',
          baseUrl: 'http://localhost',
          environment: 'local',
          allowedDomains: ['localhost'],
        },
        { projectDataRoot: tempDir }
      );

      // Modify a file in project A
      const alphaWorkspace = join(tempDir, 'modify-alpha');
      const testFilePath = join(alphaWorkspace, 'tests', 'approved', 'test.spec.ts');
      writeFileSync(testFilePath, 'export const test = "alpha";');

      // Load project B and verify it's unaffected
      const loadedB = loadProject('modify-beta', { projectDataRoot: tempDir });
      const betaTestFile = join(loadedB.config.resolvedTestDirectory, 'test.spec.ts');

      // Project B should not have the test file
      expect(existsSync(betaTestFile)).toBe(false);

      // Project A should have the test file
      expect(existsSync(testFilePath)).toBe(true);
      expect(readFileSync(testFilePath, 'utf-8')).toBe('export const test = "alpha";');
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should reject testDirectory with ../', () => {
      expect(() =>
        createProject(
          {
            projectId: 'traversal-test',
            name: 'Traversal Test',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
            testDirectory: '../outside',
          },
          { projectDataRoot: tempDir }
        )
      ).toThrow(ProjectServiceError);

      try {
        createProject(
          {
            projectId: 'traversal-test',
            name: 'Traversal Test',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
            testDirectory: '../outside',
          },
          { projectDataRoot: tempDir }
        );
      } catch (err) {
        expect((err as ProjectServiceError).code).toBe('PATH_TRAVERSAL');
      }
    });

    it('should reject artifactDirectory with ../', () => {
      expect(() =>
        createProject(
          {
            projectId: 'artifact-traversal',
            name: 'Artifact Traversal',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
            artifactDirectory: '../../escape',
          },
          { projectDataRoot: tempDir }
        )
      ).toThrow(ProjectServiceError);

      try {
        createProject(
          {
            projectId: 'artifact-traversal',
            name: 'Artifact Traversal',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
            artifactDirectory: '../../escape',
          },
          { projectDataRoot: tempDir }
        );
      } catch (err) {
        expect((err as ProjectServiceError).code).toBe('PATH_TRAVERSAL');
      }
    });

    it('should reject complex path traversal (foo/../..)', () => {
      expect(() =>
        createProject(
          {
            projectId: 'complex-traversal',
            name: 'Complex Traversal',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
            testDirectory: 'foo/../../outside',
          },
          { projectDataRoot: tempDir }
        )
      ).toThrow(ProjectServiceError);
    });

    it('should reject resolveProjectPath with path traversal', () => {
      const workspace = join(tempDir, 'test-workspace');
      mkdirSync(workspace, { recursive: true });

      expect(() => resolveProjectPath('../escape', workspace)).toThrow(ProjectServiceError);
      expect(() => resolveProjectPath('../../etc/passwd', workspace)).toThrow(ProjectServiceError);
      expect(() => resolveProjectPath('foo/../../escape', workspace)).toThrow(ProjectServiceError);
    });
  });

  describe('Sibling-Prefix Path Prevention', () => {
    it('should reject sibling directories with common prefix', () => {
      // /base-sibling is not inside /base even though it starts with /base
      expect(isPathContained('/base-other/file.txt', '/base')).toBe(false);
      expect(isPathContained('/basedir/file.txt', '/base')).toBe(false);
      expect(isPathContained('/baseapp', '/base')).toBe(false);
    });

    it('should accept actual child directories', () => {
      expect(isPathContained('/base/child', '/base')).toBe(true);
      expect(isPathContained('/base/deep/nested', '/base')).toBe(true);
      expect(isPathContained('/base', '/base')).toBe(true);
    });
  });

  describe('Absolute Path Prevention', () => {
    it('should reject absolute paths outside workspace via resolveProjectPath', () => {
      const workspace = join(tempDir, 'workspace');
      mkdirSync(workspace, { recursive: true });

      // Unix absolute path
      expect(() => resolveProjectPath('/etc/passwd', workspace)).toThrow(ProjectServiceError);

      // Windows absolute path (if on Windows)
      expect(() => resolveProjectPath('C:\\Windows\\System32', workspace)).toThrow(
        ProjectServiceError
      );
    });

    it('should reject absolute paths in testDirectory via Phase 1 loader', () => {
      const workspace = join(tempDir, 'abs-workspace');
      mkdirSync(workspace, { recursive: true });
      mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });

      const config = {
        projectId: 'abs-test',
        name: 'Absolute Test',
        baseUrl: 'http://localhost',
        environment: 'local',
        allowedDomains: ['localhost'],
        testDirectory: '/etc/tests', // Absolute path
        artifactDirectory: 'artifacts',
      };

      writeFileSync(join(workspace, PROJECT_FILES.PROJECT_CONFIG), JSON.stringify(config));

      expect(() => loadProjectConfig(join(workspace, PROJECT_FILES.PROJECT_CONFIG))).toThrow(
        ConfigValidationError
      );
    });
  });

  describe('Windows Drive Letter Case Handling', () => {
    // Windows-only: isPathContained/isAbsolutePath use the platform's own node:path.
    it.runIf(process.platform === 'win32')('should treat D: and d: as equivalent', () => {
      // D:\\projects\\sub should be inside d:\\projects
      expect(isPathContained('D:\\projects\\sub', 'd:\\projects')).toBe(true);
      expect(isPathContained('d:\\projects\\sub', 'D:\\projects')).toBe(true);
    });

    // Windows-only: isPathContained/isAbsolutePath use the platform's own node:path.
    it.runIf(process.platform === 'win32')('should handle mixed case in Windows paths', () => {
      expect(isPathContained('D:\\Projects\\Sub\\file.txt', 'd:\\projects')).toBe(true);
      expect(isPathContained('d:\\PROJECTS\\sub', 'D:\\Projects')).toBe(true);
    });

    it('should still reject different drives', () => {
      expect(isPathContained('E:\\projects\\sub', 'D:\\projects')).toBe(false);
      expect(isPathContained('C:\\Windows', 'D:\\projects')).toBe(false);
    });
  });

  describe('Duplicate Project ID Prevention', () => {
    it('should reject duplicate project creation', () => {
      createProject(
        {
          projectId: 'duplicate-test',
          name: 'First Project',
          baseUrl: 'http://localhost',
          environment: 'local',
          allowedDomains: ['localhost'],
        },
        { projectDataRoot: tempDir }
      );

      expect(() =>
        createProject(
          {
            projectId: 'duplicate-test',
            name: 'Second Project',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
          },
          { projectDataRoot: tempDir }
        )
      ).toThrow(ProjectServiceError);

      try {
        createProject(
          {
            projectId: 'duplicate-test',
            name: 'Second Project',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
          },
          { projectDataRoot: tempDir }
        );
      } catch (err) {
        expect((err as ProjectServiceError).code).toBe('PROJECT_EXISTS');
      }
    });

    it('should reject when workspace directory already exists (race condition)', () => {
      const workspace = join(tempDir, 'race-project');
      mkdirSync(workspace);

      expect(() =>
        createProject(
          {
            projectId: 'race-project',
            name: 'Race Project',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
          },
          { projectDataRoot: tempDir }
        )
      ).toThrow(ProjectServiceError);

      try {
        createProject(
          {
            projectId: 'race-project',
            name: 'Race Project',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
          },
          { projectDataRoot: tempDir }
        );
      } catch (err) {
        expect((err as ProjectServiceError).code).toBe('PROJECT_EXISTS');
      }
    });
  });

  describe('Project ID and Directory Name Consistency', () => {
    it('should reject config with mismatched projectId', () => {
      const workspace = join(tempDir, 'alpha-dir');
      mkdirSync(workspace, { recursive: true });
      mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
      mkdirSync(join(workspace, 'artifacts'), { recursive: true });

      // Config says "beta" but directory is "alpha-dir"
      writeFileSync(
        join(workspace, PROJECT_FILES.PROJECT_CONFIG),
        JSON.stringify({
          projectId: 'beta-id', // MISMATCH!
          name: 'Mismatched',
          baseUrl: 'http://localhost',
          environment: 'local',
          allowedDomains: ['localhost'],
          testDirectory: 'tests/approved',
          artifactDirectory: 'artifacts',
        })
      );

      expect(() =>
        loadProject('alpha-dir', { projectDataRoot: tempDir })
      ).toThrow(ProjectServiceError);

      try {
        loadProject('alpha-dir', { projectDataRoot: tempDir });
      } catch (err) {
        expect((err as ProjectServiceError).code).toBe('PROJECT_ID_MISMATCH');
      }
    });
  });
});

describe('Windows-Safe Project IDs', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `qa-win-id-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Trailing Period Rejection', () => {
    it('should reject project ID ending with period', () => {
      expect(() => validateProjectId('alpha.')).toThrow(ProjectServiceError);
      expect(() => validateProjectId('my-project.')).toThrow(ProjectServiceError);

      try {
        validateProjectId('alpha.');
      } catch (err) {
        expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
        expect((err as ProjectServiceError).message).toContain('period');
      }
    });

    it('should reject project ID ending with period in Phase 1 loader', () => {
      const result = validateProjectIdFormat('alpha.');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('period');
    });
  });

  describe('Trailing Space Rejection', () => {
    it('should reject project ID ending with space', () => {
      expect(() => validateProjectId('alpha ')).toThrow(ProjectServiceError);
      expect(() => validateProjectId('my-project ')).toThrow(ProjectServiceError);

      try {
        validateProjectId('alpha ');
      } catch (err) {
        expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
        expect((err as ProjectServiceError).message).toContain('space');
      }
    });

    it('should reject project ID ending with space in Phase 1 loader', () => {
      const result = validateProjectIdFormat('alpha ');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('space');
    });
  });

  describe('Case Collision Prevention', () => {
    it('should reject uppercase letters in project ID (prevents Alpha vs alpha collision)', () => {
      expect(() => validateProjectId('Alpha')).toThrow(ProjectServiceError);
      expect(() => validateProjectId('MyProject')).toThrow(ProjectServiceError);
      expect(() => validateProjectId('PROJECT')).toThrow(ProjectServiceError);

      try {
        validateProjectId('Alpha');
      } catch (err) {
        expect((err as ProjectServiceError).code).toBe('INVALID_PROJECT_ID');
        expect((err as ProjectServiceError).message).toContain('lowercase');
      }
    });

    it('should reject uppercase in Phase 1 config validation', () => {
      const result = validateProjectIdFormat('Alpha');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('lowercase');
    });

    it('should accept lowercase project IDs', () => {
      expect(() => validateProjectId('alpha')).not.toThrow();
      expect(() => validateProjectId('my-project')).not.toThrow();
      expect(() => validateProjectId('project123')).not.toThrow();
    });
  });

  describe('Lowercase Slug Convention', () => {
    it('should accept valid lowercase slugs', () => {
      const validIds = ['a', 'abc', 'my-project', 'project123', '123abc', 'a1b2c3'];
      for (const id of validIds) {
        expect(() => validateProjectId(id)).not.toThrow();
        expect(validateProjectIdFormat(id).valid).toBe(true);
      }
    });

    it('should reject invalid characters and patterns', () => {
      const invalidIds = [
        'my_project', // underscore
        'my.project', // dot (except at end)
        '-start', // leading hyphen
        'end-', // trailing hyphen
        'my--project', // consecutive hyphens
        ' space', // leading space
        'spécial', // non-ASCII
      ];

      for (const id of invalidIds) {
        const result = validateProjectIdFormat(id);
        expect(result.valid).toBe(false);
      }
    });
  });

  describe('Consistent Validation Between Phase 1 and Phase 2', () => {
    it('should reject the same invalid IDs in both validateProjectId and validateConfigInMemory', () => {
      const invalidIds = ['Alpha', 'alpha.', 'alpha ', 'my_project', 'CON'];

      for (const id of invalidIds) {
        // Phase 2 service validation
        const phase2Rejects = (() => {
          try {
            validateProjectId(id);
            return false;
          } catch {
            return true;
          }
        })();

        // Phase 1 loader validation
        const phase1Rejects = (() => {
          try {
            validateConfigInMemory({
              projectId: id,
              name: 'Test',
              baseUrl: 'http://localhost',
              environment: 'local',
              allowedDomains: ['localhost'],
              testDirectory: 'tests/approved',
              artifactDirectory: 'artifacts',
            });
            return false;
          } catch {
            return true;
          }
        })();

        expect(phase2Rejects).toBe(true);
        expect(phase1Rejects).toBe(true);
      }
    });

    it('should reject ALL lowercase Windows reserved names through both paths', () => {
      // All Windows reserved device names in lowercase
      const reservedNames = [
        'con', 'prn', 'aux', 'nul',
        'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
        'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
      ];

      for (const name of reservedNames) {
        // Phase 2 service validation
        expect(() => validateProjectId(name)).toThrow();

        // Phase 1 loader validation
        expect(() =>
          validateConfigInMemory({
            projectId: name,
            name: 'Test',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
            testDirectory: 'tests/approved',
            artifactDirectory: 'artifacts',
          })
        ).toThrow();
      }
    });

    it('should accept valid IDs that begin with reserved name prefixes through both paths', () => {
      // These should NOT be rejected - only exact matches are reserved
      const validPrefixedIds = ['console', 'content', 'printer', 'auxiliary', 'null-check'];

      for (const id of validPrefixedIds) {
        // Phase 2 service validation
        expect(() => validateProjectId(id)).not.toThrow();

        // Phase 1 loader validation
        expect(() =>
          validateConfigInMemory({
            projectId: id,
            name: 'Test',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
            testDirectory: 'tests/approved',
            artifactDirectory: 'artifacts',
          })
        ).not.toThrow();
      }
    });

    it('should accept the same valid IDs in both validateProjectId and validateConfigInMemory', () => {
      const validIds = ['saucedemo', 'my-project', 'test123', 'a'];

      for (const id of validIds) {
        // Phase 2 service validation
        expect(() => validateProjectId(id)).not.toThrow();

        // Phase 1 loader validation
        expect(() =>
          validateConfigInMemory({
            projectId: id,
            name: 'Test',
            baseUrl: 'http://localhost',
            environment: 'local',
            allowedDomains: ['localhost'],
            testDirectory: 'tests/approved',
            artifactDirectory: 'artifacts',
          })
        ).not.toThrow();
      }
    });
  });

  describe('Existing Project Compatibility', () => {
    it('should accept saucedemo (existing project ID)', () => {
      expect(() => validateProjectId('saucedemo')).not.toThrow();
      expect(PROJECT_ID_PATTERN.test('saucedemo')).toBe(true);
    });

    it('should accept fixture project IDs', () => {
      const fixtureIds = ['fixture-passing', 'fixture-failing', 'fixture-hanging'];
      for (const id of fixtureIds) {
        expect(() => validateProjectId(id)).not.toThrow();
        expect(PROJECT_ID_PATTERN.test(id)).toBe(true);
      }
    });
  });
});

describe('Path Containment Shared Helper', () => {
  describe('isRelativePathContained', () => {
    it('should return true for paths within workspace', () => {
      expect(isRelativePathContained('tests/approved', '/workspace')).toBe(true);
      expect(isRelativePathContained('deep/nested/path', '/workspace')).toBe(true);
      expect(isRelativePathContained('.', '/workspace')).toBe(true);
    });

    it('should return false for paths escaping workspace', () => {
      expect(isRelativePathContained('../outside', '/workspace')).toBe(false);
      expect(isRelativePathContained('foo/../../outside', '/workspace')).toBe(false);
    });

    it('should handle Windows paths', () => {
      expect(isRelativePathContained('tests\\approved', 'D:\\workspace')).toBe(true);
      expect(isRelativePathContained('..\\escape', 'D:\\workspace')).toBe(false);
    });
  });

  describe('isPathContained for absolute paths', () => {
    it('should handle exact match', () => {
      expect(isPathContained('/base', '/base')).toBe(true);
      expect(isPathContained('D:\\base', 'D:\\base')).toBe(true);
    });

    it('should handle nested paths', () => {
      expect(isPathContained('/base/sub/deep', '/base')).toBe(true);
      expect(isPathContained('D:\\base\\sub\\deep', 'D:\\base')).toBe(true);
    });

    it('should reject unrelated paths', () => {
      expect(isPathContained('/other', '/base')).toBe(false);
      expect(isPathContained('E:\\other', 'D:\\base')).toBe(false);
    });
  });
});

describe('Phase 1 Validation Integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `qa-phase1-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('loadProjectConfig should call validateConfigInMemory internally', () => {
    // Create a valid project structure
    const workspace = join(tempDir, 'valid-project');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    // Invalid projectId should be caught by validateConfigInMemory
    writeFileSync(
      join(workspace, PROJECT_FILES.PROJECT_CONFIG),
      JSON.stringify({
        projectId: 'Invalid_ID', // Invalid: uppercase and underscore
        name: 'Test',
        baseUrl: 'http://localhost',
        environment: 'local',
        allowedDomains: ['localhost'],
        testDirectory: 'tests/approved',
        artifactDirectory: 'artifacts',
      })
    );

    expect(() =>
      loadProjectConfig(join(workspace, PROJECT_FILES.PROJECT_CONFIG))
    ).toThrow(ConfigValidationError);

    try {
      loadProjectConfig(join(workspace, PROJECT_FILES.PROJECT_CONFIG));
    } catch (err) {
      expect((err as ConfigValidationError).field).toBe('projectId');
      expect((err as ConfigValidationError).message).toContain('lowercase');
    }
  });

  it('should preserve Phase 1 error messages for backward compatibility', () => {
    // Test that original error messages are preserved
    const testCases = [
      { config: {}, expectedField: 'projectId', expectedContains: 'missing' },
      {
        config: { projectId: '', name: 'Test', baseUrl: 'http://localhost', environment: 'local', allowedDomains: ['localhost'], testDirectory: 'tests', artifactDirectory: 'artifacts' },
        expectedField: 'projectId',
        expectedContains: 'empty',
      },
      {
        config: { projectId: 'test', name: 'Test', baseUrl: 'not-a-url', environment: 'local', allowedDomains: ['localhost'], testDirectory: 'tests', artifactDirectory: 'artifacts' },
        expectedField: 'baseUrl',
        expectedContains: 'Invalid URL',
      },
      {
        config: { projectId: 'test', name: 'Test', baseUrl: 'http://localhost', environment: 'production', allowedDomains: ['localhost'], testDirectory: 'tests', artifactDirectory: 'artifacts' },
        expectedField: 'environment',
        expectedContains: 'Production environment is not allowed',
      },
    ];

    for (const testCase of testCases) {
      try {
        validateConfigInMemory(testCase.config);
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as ConfigValidationError).field).toBe(testCase.expectedField);
        expect((err as ConfigValidationError).message).toContain(testCase.expectedContains);
      }
    }
  });
});
