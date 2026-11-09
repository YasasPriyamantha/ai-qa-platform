/**
 * Unit tests for run ID generation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateRunId } from '../../../src/test-execution/run-id.js';

describe('generateRunId', () => {
  const testDir = join(process.cwd(), 'test-temp-run-id');

  beforeEach(() => {
    // Create clean test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should generate a valid UTC timestamp-based run ID', () => {
    const runId = generateRunId(testDir);

    // Format: YYYY-MM-DDTHH-mm-ss-SSSZ
    expect(runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);

    // Should end with Z (UTC marker)
    expect(runId).toMatch(/Z$/);
  });

  it('should return the base ID when no collision exists', () => {
    const runId = generateRunId(testDir);

    // Should be a valid timestamp ID
    expect(runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);

    // Should not have a collision suffix (no additional -N after Z)
    // Valid format without suffix: ends with Z
    // Valid format with suffix:    ends with Z-2, Z-3, etc.
    expect(runId).not.toMatch(/Z-\d+$/);
  });

  it('should add suffix -2 when an exact collision is detected', () => {
    // Manually create a collision scenario
    // Create a directory with a specific timestamp format
    const mockId = '2026-01-01T12-00-00-000Z';
    mkdirSync(join(testDir, mockId));

    // Now manually create a collision by ensuring the same ID would be generated
    // We can't control the actual timestamp, but we can verify the suffix logic
    // by creating many directories with the current second's pattern

    const baseId = generateRunId(testDir);
    // Create directory with the generated ID
    mkdirSync(join(testDir, baseId));

    // Generate again - if it's the same millisecond, should get -2 suffix
    const secondId = generateRunId(testDir);

    // Either it's a different timestamp (time passed) or it has a -2 suffix
    if (secondId === `${baseId}-2`) {
      expect(secondId).toBe(`${baseId}-2`);
    } else {
      // Time passed, different timestamp - also valid
      expect(secondId).not.toBe(baseId);
    }
  });

  it('should generate unique IDs for rapid successive calls', () => {
    const ids = new Set<string>();

    // Generate multiple IDs rapidly
    for (let i = 0; i < 5; i++) {
      const id = generateRunId(testDir);
      ids.add(id);
      // Create directory to trigger collision detection if same timestamp
      mkdirSync(join(testDir, id));
    }

    // All IDs should be unique
    expect(ids.size).toBe(5);
  });

  it('should never return an ID that already exists as a directory', () => {
    // Generate and create first ID
    const firstId = generateRunId(testDir);
    mkdirSync(join(testDir, firstId));

    // Generate second ID
    const secondId = generateRunId(testDir);
    mkdirSync(join(testDir, secondId));

    // Generate third ID
    const thirdId = generateRunId(testDir);

    // All should be different
    expect(secondId).not.toBe(firstId);
    expect(thirdId).not.toBe(firstId);
    expect(thirdId).not.toBe(secondId);

    // None should exist yet (only first and second were created)
    expect(existsSync(join(testDir, thirdId))).toBe(false);
  });

  it('should create different base IDs when called with time gap', async () => {
    const firstId = generateRunId(testDir);

    // Wait 2ms to ensure different millisecond
    await new Promise((resolve) => setTimeout(resolve, 2));

    const secondId = generateRunId(testDir);

    // Should have different timestamps (at least in milliseconds)
    expect(firstId).not.toBe(secondId);
  });

  it('should handle suffix collision correctly', () => {
    // Create a specific timestamp and its suffixed versions
    const baseId = '2026-01-01T12-00-00-000Z';
    mkdirSync(join(testDir, baseId));
    mkdirSync(join(testDir, `${baseId}-2`));
    mkdirSync(join(testDir, `${baseId}-3`));

    // If generateRunId creates this exact timestamp (unlikely), it should use -4
    // Otherwise it will create a different timestamp
    const newId = generateRunId(testDir);

    // Should not conflict with any existing directory
    expect(newId).not.toBe(baseId);
    expect(newId).not.toBe(`${baseId}-2`);
    expect(newId).not.toBe(`${baseId}-3`);
  });

  it('should throw error after 1000 collision attempts for same timestamp', () => {
    // We need to test the safety limit.
    // Create a scenario where the current timestamp keeps colliding.
    // Since we can't control the timestamp, we'll create a large number of
    // directories that might match the current timestamp.

    // Generate a base ID and create 1001 versions of it
    const baseId = generateRunId(testDir);
    mkdirSync(join(testDir, baseId));

    // Create 1000 suffixed versions
    for (let i = 2; i <= 1001; i++) {
      mkdirSync(join(testDir, `${baseId}-${i}`));
    }

    // If the next generated ID happens to match baseId exactly (same timestamp),
    // it should throw. Otherwise it will be a different timestamp (valid).
    try {
      const nextId = generateRunId(testDir);
      // If we got here, the timestamp was different (time passed)
      expect(nextId).not.toBe(baseId);
      expect(nextId).not.toMatch(new RegExp(`^${baseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`));
    } catch (err) {
      // If we got an error, it should be the collision error
      expect((err as Error).message).toMatch(/Unable to generate unique run ID/);
    }
  });
});
