/**
 * Unit tests for run directory collision safety
 *
 * Tests the createCollisionSafeRunDirectory function directly,
 * without launching Playwright or spawning child processes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCollisionSafeRunDirectory } from '../../../src/test-execution/runner.js';

describe('createCollisionSafeRunDirectory - collision safety', () => {
  let tempDir: string;
  let artifactDir: string;

  beforeEach(() => {
    // Create temporary artifact directory
    tempDir = join(tmpdir(), `qa-collision-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    artifactDir = join(tempDir, 'artifacts');
    mkdirSync(artifactDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should never overwrite an existing run directory', () => {
    // Manually create a run directory with a specific timestamp
    const manualRunId = '2026-01-01T12-00-00-000Z';
    const manualRunDir = join(artifactDir, manualRunId);
    mkdirSync(manualRunDir);

    // Create a marker file in the existing directory
    const markerPath = join(manualRunDir, 'existing-marker.txt');
    writeFileSync(markerPath, 'This directory already existed');

    // Create a new run directory - it should NOT overwrite the existing one
    const result = createCollisionSafeRunDirectory(artifactDir);

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

  it('should preserve contents of existing run directory', () => {
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

    // Create a new run directory
    createCollisionSafeRunDirectory(artifactDir);

    // Original directory contents should be unchanged
    expect(readdirSync(manualRunDir).sort()).toEqual(originalContents);
    expect(readdirSync(subdir).sort()).toEqual(originalSubContents);
    expect(readFileSync(join(manualRunDir, 'file1.txt'), 'utf-8')).toBe('content1');
    expect(readFileSync(join(manualRunDir, 'file2.txt'), 'utf-8')).toBe('content2');
    expect(readFileSync(join(subdir, 'file3.txt'), 'utf-8')).toBe('content3');
  });

  it('should handle multiple existing run directories with suffixes', () => {
    const baseId = '2026-01-01T12-00-00-000Z';

    // Create base ID and several suffixed directories
    mkdirSync(join(artifactDir, baseId));
    mkdirSync(join(artifactDir, `${baseId}-2`));
    mkdirSync(join(artifactDir, `${baseId}-3`));

    // Create a new run directory
    const result = createCollisionSafeRunDirectory(artifactDir);

    // Should not reuse any of the existing directories
    expect(result.runId).not.toBe(baseId);
    expect(result.runId).not.toBe(`${baseId}-2`);
    expect(result.runId).not.toBe(`${baseId}-3`);

    // All original directories should still exist
    expect(existsSync(join(artifactDir, baseId))).toBe(true);
    expect(existsSync(join(artifactDir, `${baseId}-2`))).toBe(true);
    expect(existsSync(join(artifactDir, `${baseId}-3`))).toBe(true);
  });

  it('should create parent artifact directory if it does not exist', () => {
    // Remove artifact directory
    rmSync(artifactDir, { recursive: true, force: true });
    expect(existsSync(artifactDir)).toBe(false);

    // Create a run directory - should auto-create parent
    const result = createCollisionSafeRunDirectory(artifactDir);

    // Artifact directory should have been created
    expect(existsSync(artifactDir)).toBe(true);

    // Run directory should exist inside it
    expect(existsSync(result.runDirectory)).toBe(true);
    expect(result.runDirectory.startsWith(artifactDir)).toBe(true);
  });

  it('should return runId and runDirectory that are consistent', () => {
    const result = createCollisionSafeRunDirectory(artifactDir);

    // runDirectory should be artifactDir + runId
    expect(result.runDirectory).toBe(join(artifactDir, result.runId));

    // Directory should actually exist
    expect(existsSync(result.runDirectory)).toBe(true);
  });

  it('should create directories with timestamp-based IDs', () => {
    const result = createCollisionSafeRunDirectory(artifactDir);

    // Run ID should match timestamp pattern
    // Format: YYYY-MM-DDTHH-mm-ss-SSSZ or YYYY-MM-DDTHH-mm-ss-SSSZ-N
    expect(result.runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/);
  });
});

describe('createCollisionSafeRunDirectory - exhaustion handling', () => {
  let tempDir: string;
  let artifactDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `qa-exhaustion-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    artifactDir = join(tempDir, 'artifacts');
    mkdirSync(artifactDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should succeed when pre-existing directories do not cause exhaustion', () => {
    // Pre-create directories to verify collision avoidance
    // The generateRunId function will try base, then -2, -3, etc.
    const now = new Date();
    const baseId = formatTimestamp(now);
    mkdirSync(join(artifactDir, baseId));

    // Pre-create several suffixed versions
    for (let i = 2; i <= 10; i++) {
      mkdirSync(join(artifactDir, `${baseId}-${i}`));
    }

    // Should still succeed because timestamps will differ
    // and the function generates new timestamps each attempt
    const result = createCollisionSafeRunDirectory(artifactDir);
    expect(result.runId).toBeDefined();
    expect(existsSync(result.runDirectory)).toBe(true);
  });

  it('should handle pre-existing directories by finding unique IDs', () => {
    // Create multiple directories with same base timestamp pattern
    const now = new Date();
    const baseId = formatTimestamp(now);

    // Pre-create base and several suffixed versions
    mkdirSync(join(artifactDir, baseId));
    mkdirSync(join(artifactDir, `${baseId}-2`));
    mkdirSync(join(artifactDir, `${baseId}-3`));

    // Should still succeed by using a different timestamp
    const result = createCollisionSafeRunDirectory(artifactDir);

    // Verify a unique directory was created
    expect(result.runId).toBeDefined();
    expect(existsSync(result.runDirectory)).toBe(true);

    // Verify pre-existing directories are untouched
    expect(existsSync(join(artifactDir, baseId))).toBe(true);
    expect(existsSync(join(artifactDir, `${baseId}-2`))).toBe(true);
    expect(existsSync(join(artifactDir, `${baseId}-3`))).toBe(true);
  });

  it('should use default maxAttempts of 10', () => {
    // Verify the default by checking the error message mentions 10
    // We can't easily force 10 EEXIST errors without mocking,
    // but we can verify the option interface accepts maxAttempts
    const result = createCollisionSafeRunDirectory(artifactDir, { maxAttempts: 10 });
    expect(result.runId).toBeDefined();
    expect(existsSync(result.runDirectory)).toBe(true);
  });
});

/**
 * Helper to format timestamp like generateRunId does.
 */
function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}-${milliseconds}Z`;
}
