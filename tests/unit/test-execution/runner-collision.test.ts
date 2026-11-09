/**
 * Unit tests for run directory collision safety
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runPlaywrightTests } from '../../../src/test-execution/runner.js';
import type { ResolvedConfig } from '../../../src/projects/config.js';

describe('runPlaywrightTests - collision safety', () => {
  let tempDir: string;
  let testProjectDir: string;
  let artifactDir: string;
  let testDir: string;
  let configPath: string;

  beforeEach(() => {
    // Create temporary project directory
    tempDir = join(tmpdir(), `qa-collision-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    testProjectDir = join(tempDir, 'test-project');
    artifactDir = join(testProjectDir, 'artifacts');
    testDir = join(testProjectDir, 'tests', 'approved');
    configPath = join(testProjectDir, 'project.config.json');

    mkdirSync(testDir, { recursive: true });
    mkdirSync(artifactDir, { recursive: true });

    // Create a minimal valid project config
    const config = {
      projectId: 'collision-test',
      name: 'Collision Test Project',
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Create an empty test file so Playwright won't exit with "no tests found"
    // This test focuses on directory collision, not test execution
    const testFile = join(testDir, 'dummy.spec.ts');
    writeFileSync(testFile, `
      import { test, expect } from '@playwright/test';
      test('dummy', async ({ page }) => {
        await page.setContent('<html><body>Test</body></html>');
        expect(true).toBe(true);
      });
    `);
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should never overwrite an existing run directory', async () => {
    // Manually create a run directory with a specific timestamp
    const manualRunId = '2026-01-01T12-00-00-000Z';
    const manualRunDir = join(artifactDir, manualRunId);
    mkdirSync(manualRunDir);

    // Create a marker file in the existing directory
    const markerPath = join(manualRunDir, 'existing-marker.txt');
    writeFileSync(markerPath, 'This directory already existed');

    // Build a mock config pointing to our test project
    const config: ResolvedConfig = {
      projectId: 'collision-test',
      name: 'Collision Test Project',
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      projectWorkspace: testProjectDir,
      resolvedTestDirectory: testDir,
      resolvedArtifactDirectory: artifactDir,
      configPath,
    };

    // Run the test - it should create a different directory
    const result = await runPlaywrightTests(config);

    // Result should have a different run ID
    expect(result.runId).not.toBe(manualRunId);

    // Manual directory should still exist with its marker file
    expect(existsSync(manualRunDir)).toBe(true);
    expect(existsSync(markerPath)).toBe(true);
    expect(readdirSync(manualRunDir)).toContain('existing-marker.txt');

    // New run directory should exist and be different
    expect(existsSync(result.runDirectory)).toBe(true);
    expect(result.runDirectory).not.toBe(manualRunDir);
  });

  it('should preserve contents of existing run directory', async () => {
    const manualRunId = '2026-01-01T12-00-00-000Z';
    const manualRunDir = join(artifactDir, manualRunId);
    mkdirSync(manualRunDir);

    // Create multiple files in the existing directory
    writeFileSync(join(manualRunDir, 'file1.txt'), 'content1');
    writeFileSync(join(manualRunDir, 'file2.txt'), 'content2');
    const subdir = join(manualRunDir, 'subdir');
    mkdirSync(subdir);
    writeFileSync(join(subdir, 'file3.txt'), 'content3');

    const originalContents = readdirSync(manualRunDir).sort();
    const originalSubContents = readdirSync(subdir).sort();

    const config: ResolvedConfig = {
      projectId: 'collision-test',
      name: 'Collision Test Project',
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      projectWorkspace: testProjectDir,
      resolvedTestDirectory: testDir,
      resolvedArtifactDirectory: artifactDir,
      configPath,
    };

    await runPlaywrightTests(config);

    // Original directory contents should be unchanged
    expect(readdirSync(manualRunDir).sort()).toEqual(originalContents);
    expect(readdirSync(subdir).sort()).toEqual(originalSubContents);
    expect(existsSync(join(manualRunDir, 'file1.txt'))).toBe(true);
    expect(existsSync(join(manualRunDir, 'file2.txt'))).toBe(true);
    expect(existsSync(join(subdir, 'file3.txt'))).toBe(true);
  });

  it('should handle multiple existing run directories with suffixes', async () => {
    const baseId = '2026-01-01T12-00-00-000Z';

    // Create base ID and several suffixed directories
    mkdirSync(join(artifactDir, baseId));
    mkdirSync(join(artifactDir, `${baseId}-2`));
    mkdirSync(join(artifactDir, `${baseId}-3`));

    const config: ResolvedConfig = {
      projectId: 'collision-test',
      name: 'Collision Test Project',
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      projectWorkspace: testProjectDir,
      resolvedTestDirectory: testDir,
      resolvedArtifactDirectory: artifactDir,
      configPath,
    };

    const result = await runPlaywrightTests(config);

    // Should not reuse any of the existing directories
    expect(result.runId).not.toBe(baseId);
    expect(result.runId).not.toBe(`${baseId}-2`);
    expect(result.runId).not.toBe(`${baseId}-3`);

    // All original directories should still exist
    expect(existsSync(join(artifactDir, baseId))).toBe(true);
    expect(existsSync(join(artifactDir, `${baseId}-2`))).toBe(true);
    expect(existsSync(join(artifactDir, `${baseId}-3`))).toBe(true);
  });

  it('should create parent artifact directory if it does not exist', async () => {
    // Remove artifact directory
    rmSync(artifactDir, { recursive: true, force: true });
    expect(existsSync(artifactDir)).toBe(false);

    const config: ResolvedConfig = {
      projectId: 'collision-test',
      name: 'Collision Test Project',
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      projectWorkspace: testProjectDir,
      resolvedTestDirectory: testDir,
      resolvedArtifactDirectory: artifactDir,
      configPath,
    };

    const result = await runPlaywrightTests(config);

    // Artifact directory should have been created
    expect(existsSync(artifactDir)).toBe(true);

    // Run directory should exist inside it
    expect(existsSync(result.runDirectory)).toBe(true);
    expect(result.runDirectory).toContain(artifactDir);
  });

});

describe('runPlaywrightTests - exhaustion handling', () => {
  // Test that the runner throws an explicit error after maximum retry attempts
  // This uses mocking to force EEXIST on every mkdirSync call for run directories

  it('should throw explicit error after 10 consecutive EEXIST collisions', async () => {
    // Create a temporary project directory
    const tempDir = join(tmpdir(), `qa-exhaustion-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const testProjectDir = join(tempDir, 'test-project');
    const artifactDir = join(testProjectDir, 'artifacts');
    const testDir = join(testProjectDir, 'tests', 'approved');
    const configPath = join(testProjectDir, 'project.config.json');

    try {
      mkdirSync(testDir, { recursive: true });
      mkdirSync(artifactDir, { recursive: true });

      const projectConfig = {
        projectId: 'exhaustion-test',
        name: 'Exhaustion Test Project',
        baseUrl: 'http://localhost',
        environment: 'local',
        allowedDomains: ['localhost'],
        testDirectory: 'tests/approved',
        artifactDirectory: 'artifacts',
      };
      writeFileSync(configPath, JSON.stringify(projectConfig, null, 2));

      const config: ResolvedConfig = {
        projectId: 'exhaustion-test',
        name: 'Exhaustion Test Project',
        baseUrl: 'http://localhost',
        environment: 'local',
        allowedDomains: ['localhost'],
        testDirectory: 'tests/approved',
        artifactDirectory: 'artifacts',
        projectWorkspace: testProjectDir,
        resolvedTestDirectory: testDir,
        resolvedArtifactDirectory: artifactDir,
        configPath,
      };

      // Mock mkdirSync to throw EEXIST for run directories (but allow artifact dir creation)
      const originalMkdirSync = mkdirSync;
      let callCount = 0;
      const mockMkdirSync = vi.fn((path: string, options?: object) => {
        // Allow artifact directory creation (recursive: true)
        if ((options as { recursive?: boolean })?.recursive === true) {
          return originalMkdirSync(path, options);
        }
        // Throw EEXIST for run directory creation (recursive: false)
        callCount++;
        const error = new Error('EEXIST: file already exists') as NodeJS.ErrnoException;
        error.code = 'EEXIST';
        throw error;
      });

      // Dynamically mock the fs module for this test
      vi.doMock('node:fs', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:fs')>();
        return {
          ...actual,
          mkdirSync: mockMkdirSync,
        };
      });

      // Re-import the runner module to pick up the mock
      const { runPlaywrightTests: mockedRunPlaywrightTests } = await import(
        '../../../src/test-execution/runner.js?mock=' + Date.now()
      );

      // Should throw after 10 attempts
      await expect(mockedRunPlaywrightTests(config)).rejects.toThrow(
        /Failed to create unique run directory after 10 attempts/
      );

      // Verify it tried 10 times
      expect(callCount).toBe(10);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });
});
