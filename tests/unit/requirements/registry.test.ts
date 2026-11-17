/**
 * Tests for requirement registry service (Task 2.7)
 *
 * Verifies requirement identity and lifecycle rules per PROJECT_SPEC.md section 7.2:
 * - Duplicate ID rejection
 * - Same-ID updates (preserving ID when content changes)
 * - New IDs for new requirements
 * - Retirement retention (retired records remain)
 * - Retired-ID reuse rejection
 * - Project-level isolation
 * - Missing ID reporting (not auto-retiring)
 * - History tracking for changed requirements
 * - Import all-or-nothing semantics
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  loadRequirementRegistry,
  saveRequirementRegistry,
  requirementIdExists,
  isRetiredId,
  isActiveId,
  getActiveRequirements,
  getRetiredRequirements,
  hasContentChanged,
  registerRequirement,
  updateRequirement,
  retireRequirement,
  getRequirementHistory,
  getAllRequirementIds,
  getRegistryStats,
  importRequirements,
  applyRequirementChange,
  RegistryError,
  type RequirementRegistryWithHistory,
  type RequirementWithHistory,
} from '../../../src/requirements/registry.js';
import type { Requirement } from '../../../src/requirements/types.js';

// Valid SHA-256 hash for testing (64 hex characters)
const VALID_CONTENT_HASH = 'a'.repeat(64);
const DIFFERENT_HASH = 'b'.repeat(64);

/**
 * Compute SHA-256 hash for content
 */
function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Create a minimal valid requirement for testing.
 */
function createRequirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    projectId: 'test-project',
    requirementId: 'REQ-001',
    title: 'Test Requirement',
    description: 'A test requirement for validation',
    expectedResult: 'The expected behavior',
    negativeCases: [],
    priority: 'medium',
    status: 'active',
    sourceReference: {
      documentId: 'doc-1',
      contentHash: VALID_CONTENT_HASH,
    },
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

/**
 * Create an empty registry for testing.
 */
function createEmptyRegistry(): RequirementRegistryWithHistory {
  return {
    schemaVersion: '1.0',
    updatedAt: new Date().toISOString(),
    requirements: {},
  };
}

// ============================================================================
// loadRequirementRegistry Tests
// ============================================================================

describe('loadRequirementRegistry', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `reg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should return empty registry when file does not exist', () => {
    const registryPath = join(tempDir, 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);

    expect(registry.schemaVersion).toBe('1.0');
    expect(registry.requirements).toEqual({});
  });

  it('should load existing registry file', () => {
    const registryPath = join(tempDir, 'registry.json');
    const existingRegistry: RequirementRegistryWithHistory = {
      schemaVersion: '1.0',
      updatedAt: '2026-01-15T10:00:00Z',
      requirements: {
        'REQ-001': createRequirement() as RequirementWithHistory,
      },
    };

    writeFileSync(registryPath, JSON.stringify(existingRegistry, null, 2));

    const registry = loadRequirementRegistry(registryPath);
    expect(registry.requirements['REQ-001']).toBeDefined();
    expect(registry.requirements['REQ-001'].title).toBe('Test Requirement');
  });

  it('should throw RegistryError for invalid JSON', () => {
    const registryPath = join(tempDir, 'registry.json');
    writeFileSync(registryPath, 'not valid json');

    expect(() => loadRequirementRegistry(registryPath)).toThrow(RegistryError);
  });

  it('should throw RegistryError for unsupported schema version', () => {
    const registryPath = join(tempDir, 'registry.json');
    writeFileSync(registryPath, JSON.stringify({
      schemaVersion: '2.0',
      updatedAt: new Date().toISOString(),
      requirements: {},
    }));

    expect(() => loadRequirementRegistry(registryPath)).toThrow(RegistryError);
    expect(() => loadRequirementRegistry(registryPath)).toThrow(/schema version/i);
  });
});

// ============================================================================
// saveRequirementRegistry Tests
// ============================================================================

describe('saveRequirementRegistry', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `reg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should create directory and save registry', () => {
    const registryPath = join(tempDir, 'requirements', 'registry.json');
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement() as RequirementWithHistory;

    saveRequirementRegistry(registryPath, registry);

    expect(existsSync(registryPath)).toBe(true);

    const loaded = JSON.parse(readFileSync(registryPath, 'utf-8'));
    expect(loaded.requirements['REQ-001'].title).toBe('Test Requirement');
  });

  it('should update timestamp on save', () => {
    const registryPath = join(tempDir, 'registry.json');
    const registry = createEmptyRegistry();

    saveRequirementRegistry(registryPath, registry);

    const loaded = JSON.parse(readFileSync(registryPath, 'utf-8'));
    // Verify timestamp is a valid ISO date
    expect(loaded.updatedAt).toBeDefined();
    expect(new Date(loaded.updatedAt).toISOString()).toBe(loaded.updatedAt);
    // The timestamp should be recent (within last minute)
    const timestamp = new Date(loaded.updatedAt).getTime();
    const now = Date.now();
    expect(now - timestamp).toBeLessThan(60000);
  });
});

// ============================================================================
// requirementIdExists Tests
// ============================================================================

describe('requirementIdExists', () => {
  it('should return true for existing ID', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement() as RequirementWithHistory;

    expect(requirementIdExists(registry, 'REQ-001')).toBe(true);
  });

  it('should return false for non-existing ID', () => {
    const registry = createEmptyRegistry();

    expect(requirementIdExists(registry, 'REQ-999')).toBe(false);
  });

  it('should compare IDs as exact strings (no normalization)', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-01'] = createRequirement({ requirementId: 'REQ-01' }) as RequirementWithHistory;

    // REQ-01 and REQ-001 are different IDs
    expect(requirementIdExists(registry, 'REQ-01')).toBe(true);
    expect(requirementIdExists(registry, 'REQ-001')).toBe(false);
  });
});

// ============================================================================
// isRetiredId / isActiveId Tests
// ============================================================================

describe('isRetiredId', () => {
  it('should return true for retired requirement', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement({
      status: 'retired',
      retiredAt: new Date().toISOString(),
    }) as RequirementWithHistory;

    expect(isRetiredId(registry, 'REQ-001')).toBe(true);
  });

  it('should return false for active requirement', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement({
      status: 'active',
    }) as RequirementWithHistory;

    expect(isRetiredId(registry, 'REQ-001')).toBe(false);
  });

  it('should return false for non-existing ID', () => {
    const registry = createEmptyRegistry();

    expect(isRetiredId(registry, 'REQ-999')).toBe(false);
  });
});

describe('isActiveId', () => {
  it('should return true for active requirement', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement({
      status: 'active',
    }) as RequirementWithHistory;

    expect(isActiveId(registry, 'REQ-001')).toBe(true);
  });

  it('should return false for retired requirement', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement({
      status: 'retired',
    }) as RequirementWithHistory;

    expect(isActiveId(registry, 'REQ-001')).toBe(false);
  });
});

// ============================================================================
// registerRequirement Tests (Duplicate ID Detection)
// ============================================================================

describe('registerRequirement', () => {
  it('should add new requirement to registry', () => {
    const registry = createEmptyRegistry();
    const requirement = createRequirement({ requirementId: 'REQ-001' });

    registerRequirement(registry, requirement);

    expect(registry.requirements['REQ-001']).toBeDefined();
    expect(registry.requirements['REQ-001'].title).toBe('Test Requirement');
  });

  it('should set createdAt and updatedAt timestamps', () => {
    const registry = createEmptyRegistry();
    const requirement = createRequirement();

    registerRequirement(registry, requirement);

    expect(registry.requirements['REQ-001'].createdAt).toBeDefined();
    expect(registry.requirements['REQ-001'].updatedAt).toBeDefined();
  });

  it('should reject duplicate IDs', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement() as RequirementWithHistory;

    const duplicate = createRequirement({ requirementId: 'REQ-001' });

    expect(() => registerRequirement(registry, duplicate)).toThrow(RegistryError);
    expect(() => registerRequirement(registry, duplicate)).toThrow(/already exists/);
  });

  it('should allow genuinely new IDs', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement() as RequirementWithHistory;

    const newReq = createRequirement({ requirementId: 'REQ-002' });

    // Should not throw
    registerRequirement(registry, newReq);

    expect(registry.requirements['REQ-002']).toBeDefined();
  });
});

// ============================================================================
// updateRequirement Tests (Same-ID Updates)
// ============================================================================

describe('updateRequirement', () => {
  it('should allow updating existing requirement keeping same ID', () => {
    const registry = createEmptyRegistry();
    const original = createRequirement({
      title: 'Original Title',
      description: 'Original description',
    });
    registerRequirement(registry, original);

    // Update with same ID but different content
    const updated = createRequirement({
      title: 'Updated Title',
      description: 'Updated description',
    });

    updateRequirement(registry, updated);

    expect(registry.requirements['REQ-001'].title).toBe('Updated Title');
    expect(registry.requirements['REQ-001'].description).toBe('Updated description');
  });

  it('should preserve createdAt timestamp on update', () => {
    const registry = createEmptyRegistry();
    const original = createRequirement();
    registerRequirement(registry, original);

    const originalCreatedAt = registry.requirements['REQ-001'].createdAt;

    // Update with changed content
    const updated = createRequirement({ title: 'New Title' });
    updateRequirement(registry, updated);

    // createdAt should be preserved
    expect(registry.requirements['REQ-001'].createdAt).toBe(originalCreatedAt);
    // updatedAt should be a valid ISO timestamp (may or may not differ if test runs fast)
    expect(registry.requirements['REQ-001'].updatedAt).toBeDefined();
    expect(new Date(registry.requirements['REQ-001'].updatedAt).toISOString())
      .toBe(registry.requirements['REQ-001'].updatedAt);
  });

  it('should create history entry when content changes', () => {
    const registry = createEmptyRegistry();
    const original = createRequirement({ title: 'Original Title' });
    registerRequirement(registry, original);

    const updated = createRequirement({ title: 'Updated Title' });
    updateRequirement(registry, updated);

    const history = registry.requirements['REQ-001'].history;
    expect(history).toBeDefined();
    expect(history!.length).toBe(1);
    expect(history![0].title).toBe('Original Title');
    expect(history![0].supersededAt).toBeDefined();
  });

  it('should not create history entry when content is unchanged', () => {
    const registry = createEmptyRegistry();
    const original = createRequirement();
    registerRequirement(registry, original);

    // Update with same content
    const sameContent = createRequirement();
    updateRequirement(registry, sameContent);

    const history = registry.requirements['REQ-001'].history;
    expect(history).toBeUndefined();
  });

  it('should throw error for non-existing ID', () => {
    const registry = createEmptyRegistry();
    const requirement = createRequirement({ requirementId: 'REQ-999' });

    expect(() => updateRequirement(registry, requirement)).toThrow(RegistryError);
    expect(() => updateRequirement(registry, requirement)).toThrow(/not found/);
  });

  it('should reject updating retired requirement', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement({
      status: 'retired',
    }) as RequirementWithHistory;

    const updated = createRequirement();

    expect(() => updateRequirement(registry, updated)).toThrow(RegistryError);
    expect(() => updateRequirement(registry, updated)).toThrow(/retired/i);
  });
});

// ============================================================================
// hasContentChanged Tests
// ============================================================================

describe('hasContentChanged', () => {
  it('should return false when content is identical', () => {
    const existing = createRequirement() as RequirementWithHistory;
    const incoming = createRequirement();

    expect(hasContentChanged(existing, incoming)).toBe(false);
  });

  it('should detect title change', () => {
    const existing = createRequirement() as RequirementWithHistory;
    const incoming = createRequirement({ title: 'Different Title' });

    expect(hasContentChanged(existing, incoming)).toBe(true);
  });

  it('should detect description change', () => {
    const existing = createRequirement() as RequirementWithHistory;
    const incoming = createRequirement({ description: 'Different description' });

    expect(hasContentChanged(existing, incoming)).toBe(true);
  });

  it('should detect expectedResult change', () => {
    const existing = createRequirement() as RequirementWithHistory;
    const incoming = createRequirement({ expectedResult: 'Different expected result' });

    expect(hasContentChanged(existing, incoming)).toBe(true);
  });

  it('should detect priority change', () => {
    const existing = createRequirement() as RequirementWithHistory;
    const incoming = createRequirement({ priority: 'high' });

    expect(hasContentChanged(existing, incoming)).toBe(true);
  });

  it('should detect negative cases change', () => {
    const existing = createRequirement() as RequirementWithHistory;
    const incoming = createRequirement({
      negativeCases: [{ condition: 'Error case', expectedOutcome: 'Show error' }],
    });

    expect(hasContentChanged(existing, incoming)).toBe(true);
  });

  it('should detect unresolved marker change', () => {
    const existing = createRequirement() as RequirementWithHistory;
    const incoming = createRequirement({
      unresolved: { reason: 'Some ambiguity' },
    });

    expect(hasContentChanged(existing, incoming)).toBe(true);
  });

  it('should detect status change (active to retired)', () => {
    const existing = createRequirement({ status: 'active' }) as RequirementWithHistory;
    const incoming = createRequirement({ status: 'retired' });

    expect(hasContentChanged(existing, incoming)).toBe(true);
  });

  it('should detect status change (retired to active attempt)', () => {
    const existing = createRequirement({ status: 'retired' }) as RequirementWithHistory;
    const incoming = createRequirement({ status: 'active' });

    expect(hasContentChanged(existing, incoming)).toBe(true);
  });
});

// ============================================================================
// retireRequirement Tests (Retirement Retention)
// ============================================================================

describe('retireRequirement', () => {
  it('should mark requirement as retired', () => {
    const registry = createEmptyRegistry();
    const requirement = createRequirement();
    registerRequirement(registry, requirement);

    retireRequirement(registry, 'REQ-001', 'Feature removed');

    expect(registry.requirements['REQ-001'].status).toBe('retired');
    expect(registry.requirements['REQ-001'].retiredAt).toBeDefined();
    expect(registry.requirements['REQ-001'].retirementReason).toBe('Feature removed');
  });

  it('should preserve retired requirement in registry (not delete)', () => {
    const registry = createEmptyRegistry();
    const requirement = createRequirement();
    registerRequirement(registry, requirement);

    retireRequirement(registry, 'REQ-001', 'Feature removed');

    // Retired requirement should still exist
    expect(registry.requirements['REQ-001']).toBeDefined();
    expect(getAllRequirementIds(registry)).toContain('REQ-001');
  });

  it('should create history entry on retirement', () => {
    const registry = createEmptyRegistry();
    const requirement = createRequirement({ title: 'Original Title' });
    registerRequirement(registry, requirement);

    retireRequirement(registry, 'REQ-001', 'Feature removed');

    const history = registry.requirements['REQ-001'].history;
    expect(history).toBeDefined();
    expect(history!.length).toBe(1);
    expect(history![0].title).toBe('Original Title');
    expect(history![0].reason).toBe('Feature removed');
  });

  it('should throw error for non-existing ID', () => {
    const registry = createEmptyRegistry();

    expect(() => retireRequirement(registry, 'REQ-999', 'Reason')).toThrow(RegistryError);
    expect(() => retireRequirement(registry, 'REQ-999', 'Reason')).toThrow(/not found/);
  });

  it('should throw error when already retired', () => {
    const registry = createEmptyRegistry();
    const requirement = createRequirement();
    registerRequirement(registry, requirement);
    retireRequirement(registry, 'REQ-001', 'First retirement');

    expect(() => retireRequirement(registry, 'REQ-001', 'Second retirement')).toThrow(RegistryError);
    expect(() => retireRequirement(registry, 'REQ-001', 'Second retirement')).toThrow(/already retired/i);
  });
});

// ============================================================================
// Retired ID Reuse Rejection Tests
// ============================================================================

describe('Retired ID reuse rejection', () => {
  it('should reject registering a new requirement with a retired ID', () => {
    const registry = createEmptyRegistry();

    // First, register and retire a requirement
    const original = createRequirement({ requirementId: 'REQ-001' });
    registerRequirement(registry, original);
    retireRequirement(registry, 'REQ-001', 'Feature removed');

    // Attempt to register new requirement with same ID
    const newReq = createRequirement({
      requirementId: 'REQ-001',
      title: 'Completely different requirement',
    });

    // Should fail - retired IDs cannot be reused
    expect(() => registerRequirement(registry, newReq)).toThrow(RegistryError);
    expect(() => registerRequirement(registry, newReq)).toThrow(/already exists/);
  });

  it('should reject updating a retired requirement', () => {
    const registry = createEmptyRegistry();

    const original = createRequirement({ requirementId: 'REQ-001' });
    registerRequirement(registry, original);
    retireRequirement(registry, 'REQ-001', 'Feature removed');

    const updated = createRequirement({
      requirementId: 'REQ-001',
      title: 'Trying to revive retired requirement',
    });

    expect(() => updateRequirement(registry, updated)).toThrow(RegistryError);
    expect(() => updateRequirement(registry, updated)).toThrow(/retired/i);
  });
});

// ============================================================================
// History Retrieval Tests
// ============================================================================

describe('getRequirementHistory', () => {
  it('should return empty array for requirement with no history', () => {
    const registry = createEmptyRegistry();
    const requirement = createRequirement();
    registerRequirement(registry, requirement);

    const history = getRequirementHistory(registry, 'REQ-001');
    expect(history).toEqual([]);
  });

  it('should return history entries in reverse chronological order', () => {
    const registry = createEmptyRegistry();
    const original = createRequirement({ title: 'Version 1' });
    registerRequirement(registry, original);

    // First update
    const v2 = createRequirement({ title: 'Version 2' });
    updateRequirement(registry, v2);

    // Second update
    const v3 = createRequirement({ title: 'Version 3' });
    updateRequirement(registry, v3);

    const history = getRequirementHistory(registry, 'REQ-001');
    expect(history.length).toBe(2);
    expect(history[0].title).toBe('Version 2'); // Most recent superseded
    expect(history[1].title).toBe('Version 1'); // Oldest superseded
  });

  it('should return empty array for non-existing ID', () => {
    const registry = createEmptyRegistry();
    const history = getRequirementHistory(registry, 'REQ-999');
    expect(history).toEqual([]);
  });

  it('should preserve source reference in history', () => {
    const registry = createEmptyRegistry();
    const original = createRequirement({
      sourceReference: {
        documentId: 'doc-1',
        contentHash: VALID_CONTENT_HASH,
        section: 'REQ-001: Original',
        lineRange: { start: 10, end: 20 },
      },
    });
    registerRequirement(registry, original);

    const updated = createRequirement({
      title: 'Updated Title',
      sourceReference: {
        documentId: 'doc-1',
        contentHash: DIFFERENT_HASH,
        section: 'REQ-001: Updated',
        lineRange: { start: 15, end: 30 },
      },
    });
    updateRequirement(registry, updated);

    const history = getRequirementHistory(registry, 'REQ-001');
    expect(history[0].sourceReference.contentHash).toBe(VALID_CONTENT_HASH);
    expect(history[0].sourceReference.section).toBe('REQ-001: Original');
  });
});

// ============================================================================
// Query Operations Tests
// ============================================================================

describe('getActiveRequirements', () => {
  it('should return only active requirements', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement({
      requirementId: 'REQ-001',
      status: 'active',
    }) as RequirementWithHistory;
    registry.requirements['REQ-002'] = createRequirement({
      requirementId: 'REQ-002',
      status: 'retired',
    }) as RequirementWithHistory;
    registry.requirements['REQ-003'] = createRequirement({
      requirementId: 'REQ-003',
      status: 'active',
    }) as RequirementWithHistory;

    const active = getActiveRequirements(registry);
    expect(active.length).toBe(2);
    expect(active.map(r => r.requirementId).sort()).toEqual(['REQ-001', 'REQ-003']);
  });
});

describe('getRetiredRequirements', () => {
  it('should return only retired requirements', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement({
      requirementId: 'REQ-001',
      status: 'active',
    }) as RequirementWithHistory;
    registry.requirements['REQ-002'] = createRequirement({
      requirementId: 'REQ-002',
      status: 'retired',
    }) as RequirementWithHistory;

    const retired = getRetiredRequirements(registry);
    expect(retired.length).toBe(1);
    expect(retired[0].requirementId).toBe('REQ-002');
  });
});

describe('getRegistryStats', () => {
  it('should return correct statistics', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = createRequirement({
      requirementId: 'REQ-001',
      status: 'active',
    }) as RequirementWithHistory;
    registry.requirements['REQ-002'] = createRequirement({
      requirementId: 'REQ-002',
      status: 'retired',
    }) as RequirementWithHistory;
    registry.requirements['REQ-003'] = createRequirement({
      requirementId: 'REQ-003',
      status: 'active',
      unresolved: { reason: 'Ambiguous behavior' },
    }) as RequirementWithHistory;

    const stats = getRegistryStats(registry);
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(2);
    expect(stats.retired).toBe(1);
    expect(stats.unresolved).toBe(1);
  });
});

// ============================================================================
// Project Isolation Tests
// ============================================================================

describe('Project isolation', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `reg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should maintain separate registries per project', () => {
    // Create two separate registry paths (simulating different projects)
    const projectAPath = join(tempDir, 'project-a', 'requirements', 'registry.json');
    const projectBPath = join(tempDir, 'project-b', 'requirements', 'registry.json');

    // Create requirement for Project A
    const registryA = createEmptyRegistry();
    registryA.requirements['REQ-001'] = createRequirement({
      projectId: 'project-a',
      title: 'Project A Requirement',
    }) as RequirementWithHistory;
    saveRequirementRegistry(projectAPath, registryA);

    // Create requirement for Project B with same ID
    const registryB = createEmptyRegistry();
    registryB.requirements['REQ-001'] = createRequirement({
      projectId: 'project-b',
      title: 'Project B Requirement',
    }) as RequirementWithHistory;
    saveRequirementRegistry(projectBPath, registryB);

    // Load and verify isolation
    const loadedA = loadRequirementRegistry(projectAPath);
    const loadedB = loadRequirementRegistry(projectBPath);

    expect(loadedA.requirements['REQ-001'].title).toBe('Project A Requirement');
    expect(loadedB.requirements['REQ-001'].title).toBe('Project B Requirement');
  });
});

// ============================================================================
// Import Operation Tests
// ============================================================================

describe('importRequirements', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Create a minimal project structure for import testing.
   * Now also creates snapshot files and declares documents in config.
   */
  function createTestProject(
    projectId: string,
    documents: Record<string, { contentHashes: string[] }> = {}
  ): string {
    const workspace = join(tempRoot, projectId);
    mkdirSync(workspace, { recursive: true });

    // Create required directories
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    // Create documents directory and sources subdirectory
    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    // Build config.documents array
    const configDocuments = Object.keys(documents).map(docId => ({
      documentId: docId,
      sourcePath: `${docId}.md`,
      format: 'markdown' as const,
    }));

    // Create project.config.json with documents declaration
    const config = {
      projectId,
      name: `Test Project ${projectId}`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: configDocuments,
    };
    writeFileSync(
      join(workspace, 'project.config.json'),
      JSON.stringify(config, null, 2)
    );

    // Create document registry
    const registry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {} as Record<string, unknown>,
    };

    for (const [docId, { contentHashes }] of Object.entries(documents)) {
      registry.documents[docId] = {
        documentId: docId,
        name: docId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: contentHashes.map((hash, i) => ({
          contentHash: hash,
          snapshotPath: `sources/${hash}.md`,
          contentSize: 100,
          ingestedAt: new Date().toISOString(),
          sourcePath: `test-${i}.md`,
          format: 'markdown',
        })),
      };
    }

    writeFileSync(
      join(documentsDir, 'documents.json'),
      JSON.stringify(registry, null, 2)
    );

    return workspace;
  }

  /**
   * Create a snapshot file for a document.
   * The content hash must match the content being written.
   */
  function createSnapshot(
    projectId: string,
    contentHash: string,
    content: string
  ): void {
    const snapshotPath = join(tempRoot, projectId, 'documents', 'sources', `${contentHash}.md`);
    writeFileSync(snapshotPath, content);
  }

  it('should require document registry for import', () => {
    // Create project WITHOUT document registry but WITH documents declared in config
    const workspace = join(tempRoot, 'no-docs-project');
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId: 'no-docs-project',
      name: 'Test Project',
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: 'doc-1', sourcePath: 'doc-1.md', format: 'markdown' }],
    };
    writeFileSync(
      join(workspace, 'project.config.json'),
      JSON.stringify(config, null, 2)
    );
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const result = importRequirements(
      'no-docs-project',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash: VALID_CONTENT_HASH,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DOCUMENT_REGISTRY_REQUIRED');
  });

  it('should reject documents with parse errors (all-or-nothing)', () => {
    // Document with unclosed fenced code block (error)
    // Note: fenced code blocks start with ``` on their own line
    const content = `## REQ-001: Test

Status: Active
Priority: High

### Description

Test requirement with unclosed code block:

\`\`\`javascript
const x = 1;
// No closing fence - this is an error!

### Expected result

Test passes.
`;
    const contentHash = computeHash(content);
    createTestProject('parse-error-project', {
      'doc-1': { contentHashes: [contentHash] },
    });
    createSnapshot('parse-error-project', contentHash, content);

    const result = importRequirements(
      'parse-error-project',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PARSE_ERRORS');
    expect(result.parseErrors).toBeDefined();
    expect(result.parseErrors!.length).toBeGreaterThan(0);
    expect(result.parseErrors!.some(e => e.message.toLowerCase().includes('unclosed'))).toBe(true);

    // Verify registry was not modified
    const registryPath = join(tempRoot, 'parse-error-project', 'requirements', 'registry.json');
    expect(existsSync(registryPath)).toBe(false);
  });

  it('should reject documents with duplicate IDs', () => {
    // Document with duplicate requirement IDs
    const content = `## REQ-001: First

Status: Active
Priority: High

### Description

First requirement.

### Expected result

Test passes.


## REQ-001: Second (Duplicate!)

Status: Active
Priority: Medium

### Description

Duplicate ID!

### Expected result

Also passes.
`;
    const contentHash = computeHash(content);
    createTestProject('dup-id-project', {
      'doc-1': { contentHashes: [contentHash] },
    });
    createSnapshot('dup-id-project', contentHash, content);

    const result = importRequirements(
      'dup-id-project',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(false);
    // Note: Parser catches duplicate IDs as parse errors before our duplicate check runs
    expect(result.error?.code).toBe('PARSE_ERRORS');
    expect(result.parseErrors).toBeDefined();
    expect(result.parseErrors!.some(e => e.message.toLowerCase().includes('duplicate'))).toBe(true);
  });

  it('should reject retired ID reuse', () => {
    // Try to import document with same ID as retired
    const content = `## REQ-001: Reusing retired ID!

Status: Active
Priority: High

### Description

Trying to reuse retired ID.

### Expected result

Should fail.
`;
    const contentHash = computeHash(content);
    const workspace = createTestProject('retired-reuse-project', {
      'doc-1': { contentHashes: [contentHash] },
    });
    createSnapshot('retired-reuse-project', contentHash, content);

    // Pre-populate registry with retired requirement
    const reqDir = join(workspace, 'requirements');
    mkdirSync(reqDir, { recursive: true });

    const existingRegistry: RequirementRegistryWithHistory = {
      schemaVersion: '1.0',
      updatedAt: new Date().toISOString(),
      requirements: {
        'REQ-001': {
          ...createRequirement({ requirementId: 'REQ-001' }),
          status: 'retired',
          retiredAt: new Date().toISOString(),
          retirementReason: 'Feature removed',
        } as RequirementWithHistory,
      },
    };
    writeFileSync(
      join(reqDir, 'registry.json'),
      JSON.stringify(existingRegistry, null, 2)
    );

    const result = importRequirements(
      'retired-reuse-project',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RETIRED_ID_REUSE');
    expect(result.retiredIdReuse).toContain('REQ-001');
  });

  it('should report missing IDs without auto-retiring', () => {
    // Import document that only contains REQ-001 (REQ-002 is missing)
    const content = `## REQ-001: Updated requirement

Status: Active
Priority: High

### Description

Updated description.

### Expected result

Updated expected result.
`;
    const contentHash = computeHash(content);
    const workspace = createTestProject('missing-id-project', {
      'doc-1': { contentHashes: [contentHash] },
    });
    createSnapshot('missing-id-project', contentHash, content);

    // Pre-populate registry with two requirements
    const reqDir = join(workspace, 'requirements');
    mkdirSync(reqDir, { recursive: true });

    const existingRegistry: RequirementRegistryWithHistory = {
      schemaVersion: '1.0',
      updatedAt: new Date().toISOString(),
      requirements: {
        'REQ-001': {
          ...createRequirement({
            requirementId: 'REQ-001',
            sourceReference: { documentId: 'doc-1', contentHash: VALID_CONTENT_HASH },
          }),
        } as RequirementWithHistory,
        'REQ-002': {
          ...createRequirement({
            requirementId: 'REQ-002',
            title: 'Second requirement',
            sourceReference: { documentId: 'doc-1', contentHash: VALID_CONTENT_HASH },
          }),
        } as RequirementWithHistory,
      },
    };
    writeFileSync(
      join(reqDir, 'registry.json'),
      JSON.stringify(existingRegistry, null, 2)
    );

    const result = importRequirements(
      'missing-id-project',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);
    expect(result.plan?.missingIds.length).toBe(1);
    expect(result.plan?.missingIds[0].requirementId).toBe('REQ-002');

    // Verify REQ-002 was NOT auto-retired
    const updatedRegistry = loadRequirementRegistry(join(reqDir, 'registry.json'));
    expect(updatedRegistry.requirements['REQ-002']).toBeDefined();
    expect(updatedRegistry.requirements['REQ-002'].status).toBe('active');
  });

  it('should preserve history when updating existing requirements', () => {
    // Import document with updated content
    const content = `## REQ-001: Updated Title

Status: Active
Priority: High

### Description

Updated description.

### Expected result

Updated expected result.
`;
    const contentHash = computeHash(content);
    const workspace = createTestProject('history-project', {
      'doc-1': { contentHashes: [contentHash] },
    });
    createSnapshot('history-project', contentHash, content);

    // Pre-populate registry with existing requirement
    const reqDir = join(workspace, 'requirements');
    mkdirSync(reqDir, { recursive: true });

    const existingRegistry: RequirementRegistryWithHistory = {
      schemaVersion: '1.0',
      updatedAt: new Date().toISOString(),
      requirements: {
        'REQ-001': {
          ...createRequirement({
            requirementId: 'REQ-001',
            title: 'Original Title',
            description: 'Original description',
            sourceReference: { documentId: 'doc-1', contentHash: VALID_CONTENT_HASH },
          }),
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        } as RequirementWithHistory,
      },
    };
    writeFileSync(
      join(reqDir, 'registry.json'),
      JSON.stringify(existingRegistry, null, 2)
    );

    const result = importRequirements(
      'history-project',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);
    expect(result.stats?.updated).toBe(1);

    // Verify history was created
    const updatedRegistry = loadRequirementRegistry(join(reqDir, 'registry.json'));
    const history = updatedRegistry.requirements['REQ-001'].history;
    expect(history).toBeDefined();
    expect(history!.length).toBe(1);
    expect(history![0].title).toBe('Original Title');
    expect(history![0].description).toBe('Original description');
    expect(history![0].sourceReference.contentHash).toBe(VALID_CONTENT_HASH);
  });

  it('should include warnings in result without blocking import', () => {
    // Document with unknown field (warning, not error)
    const content = `## REQ-001: Test

Status: Active
Priority: High
UnknownField: Some value

### Description

Test requirement.

### Expected result

Test passes.
`;
    const contentHash = computeHash(content);
    createTestProject('warnings-project', {
      'doc-1': { contentHashes: [contentHash] },
    });
    createSnapshot('warnings-project', contentHash, content);

    const result = importRequirements(
      'warnings-project',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);
    expect(result.stats?.warnings).toBeGreaterThan(0);
    expect(result.plan?.warnings.some(w => w.message.includes('Unknown field'))).toBe(true);
  });

  it('should successfully import new requirements', () => {
    const content = `## REQ-001: First requirement

Status: Active
Priority: High

### Description

First requirement description.

### Expected result

First expected result.


## REQ-002: Second requirement

Status: Active
Priority: Medium

### Description

Second requirement description.

### Expected result

Second expected result.
`;
    const contentHash = computeHash(content);
    createTestProject('new-import-project', {
      'doc-1': { contentHashes: [contentHash] },
    });
    createSnapshot('new-import-project', contentHash, content);

    const result = importRequirements(
      'new-import-project',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);
    expect(result.stats?.total).toBe(2);
    expect(result.stats?.new).toBe(2);
    expect(result.stats?.updated).toBe(0);
    expect(result.stats?.unchanged).toBe(0);

    // Verify registry was created with requirements
    const registryPath = join(tempRoot, 'new-import-project', 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);
    expect(registry.requirements['REQ-001']).toBeDefined();
    expect(registry.requirements['REQ-002']).toBeDefined();
    expect(registry.requirements['REQ-001'].title).toBe('First requirement');
    expect(registry.requirements['REQ-002'].title).toBe('Second requirement');
  });
});

// ============================================================================
// Retired-ID Re-import Behavior Tests (Task 2.7 Corrections)
// ============================================================================

describe('Retired-ID re-import behavior', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `retired-reimport-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createTestProjectWithRegistry(
    projectId: string,
    documents: Record<string, { contentHashes: string[] }>,
    existingRequirements?: Record<string, RequirementWithHistory>
  ): string {
    const workspace = join(tempRoot, projectId);
    mkdirSync(workspace, { recursive: true });

    // Build config.documents array
    const configDocuments = Object.keys(documents).map(docId => ({
      documentId: docId,
      sourcePath: `${docId}.md`,
      format: 'markdown' as const,
    }));

    // Create project.config.json with documents declaration
    const config = {
      projectId,
      name: `Test Project ${projectId}`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: configDocuments,
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    // Create required directories
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    // Create document registry and sources directory
    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {} as Record<string, unknown>,
    };

    for (const [docId, { contentHashes }] of Object.entries(documents)) {
      docRegistry.documents[docId] = {
        documentId: docId,
        name: docId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: contentHashes.map((hash, i) => ({
          contentHash: hash,
          snapshotPath: `sources/${hash}.md`,
          contentSize: 100,
          ingestedAt: new Date().toISOString(),
          sourcePath: `test-${i}.md`,
          format: 'markdown',
        })),
      };
    }

    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    // Create requirements registry if provided
    if (existingRequirements) {
      const reqDir = join(workspace, 'requirements');
      mkdirSync(reqDir, { recursive: true });
      const reqRegistry: RequirementRegistryWithHistory = {
        schemaVersion: '1.0',
        updatedAt: new Date().toISOString(),
        requirements: existingRequirements,
      };
      writeFileSync(join(reqDir, 'registry.json'), JSON.stringify(reqRegistry, null, 2));
    }

    return workspace;
  }

  /**
   * Create a snapshot file for a document in the retired-reimport test suite.
   */
  function createSnapshotForRetired(
    projectId: string,
    contentHash: string,
    content: string
  ): void {
    const snapshotPath = join(tempRoot, projectId, 'documents', 'sources', `${contentHash}.md`);
    writeFileSync(snapshotPath, content);
  }

  it('should allow first import of a document containing a retired requirement', () => {
    const content = `## REQ-001: Retired requirement
Status: Retired
Priority: Medium

### Description

This requirement is retired.
`;
    const contentHash = computeHash(content);
    createTestProjectWithRegistry('retired-first', { 'doc-1': { contentHashes: [contentHash] } });
    createSnapshotForRetired('retired-first', contentHash, content);

    const result = importRequirements(
      'retired-first',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);
    expect(result.stats?.new).toBe(1);

    const registryPath = join(tempRoot, 'retired-first', 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);
    expect(registry.requirements['REQ-001']).toBeDefined();
    expect(registry.requirements['REQ-001'].status).toBe('retired');
  });

  it('should allow re-importing the same retired requirement document', () => {
    const content = `## REQ-001: Retired requirement
Status: Retired
Priority: Medium

### Description

A test requirement for validation

### Expected result

The expected behavior
`;
    const contentHash = computeHash(content);
    // Create existing requirement that matches the content we'll import
    const existingReqs: Record<string, RequirementWithHistory> = {
      'REQ-001': {
        projectId: 'retired-reimport',
        requirementId: 'REQ-001',
        title: 'Retired requirement',
        description: 'A test requirement for validation',
        expectedResult: 'The expected behavior',
        negativeCases: [],
        priority: 'medium',
        status: 'retired',
        sourceReference: { documentId: 'doc-1', contentHash },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        retiredAt: '2026-01-01T00:00:00Z',
        retirementReason: 'Original retirement',
      } as RequirementWithHistory,
    };
    createTestProjectWithRegistry('retired-reimport', { 'doc-1': { contentHashes: [contentHash] } }, existingReqs);
    createSnapshotForRetired('retired-reimport', contentHash, content);

    const result = importRequirements(
      'retired-reimport',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);
    // Content is unchanged but source reference may be updated (section/lineRange added)
    // The sum of unchanged + sourceUpdated should be 1
    expect((result.stats?.unchanged ?? 0) + (result.stats?.sourceUpdated ?? 0)).toBe(1);
    expect(result.stats?.updated).toBe(0);
  });

  it('should not create duplicate history entry when re-importing unchanged retired requirement', () => {
    const content = `## REQ-001: Test Requirement
Status: Retired
Priority: Medium

### Description

A test requirement for validation

### Expected result

The expected behavior
`;
    const contentHash = computeHash(content);
    const existingReqs: Record<string, RequirementWithHistory> = {
      'REQ-001': {
        ...createRequirement({
          requirementId: 'REQ-001',
          status: 'retired',
          sourceReference: { documentId: 'doc-1', contentHash },
        }),
        status: 'retired',
        retiredAt: '2026-01-01T00:00:00Z',
        history: [{
          title: 'Test Requirement',
          description: 'A test requirement for validation',
          expectedResult: 'The expected behavior',
          negativeCases: [],
          priority: 'medium',
          role: undefined,
          unresolved: undefined,
          status: 'active',
          sourceReference: { documentId: 'doc-1', contentHash: VALID_CONTENT_HASH },
          supersededAt: '2026-01-01T00:00:00Z',
          reason: 'Original retirement',
        }],
      } as RequirementWithHistory,
    };
    createTestProjectWithRegistry('retired-no-dup', { 'doc-1': { contentHashes: [contentHash] } }, existingReqs);
    createSnapshotForRetired('retired-no-dup', contentHash, content);

    const result = importRequirements(
      'retired-no-dup',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);

    const registryPath = join(tempRoot, 'retired-no-dup', 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);
    // History should still have only 1 entry (no duplicate)
    expect(registry.requirements['REQ-001'].history?.length).toBe(1);
  });

  it('should reject active incoming requirement trying to reactivate retired registry record', () => {
    // Try to import with Active status (reactivation attempt)
    const content = `## REQ-001: Trying to reactivate
Status: Active
Priority: High

### Description

Attempting to reactivate retired requirement.

### Expected result

Should fail.
`;
    const contentHash = computeHash(content);
    const existingReqs: Record<string, RequirementWithHistory> = {
      'REQ-001': {
        ...createRequirement({
          requirementId: 'REQ-001',
          status: 'retired',
          sourceReference: { documentId: 'doc-1', contentHash },
        }),
        status: 'retired',
        retiredAt: '2026-01-01T00:00:00Z',
        retirementReason: 'Feature removed',
      } as RequirementWithHistory,
    };
    const workspace = createTestProjectWithRegistry('reject-react', { 'doc-1': { contentHashes: [contentHash] } }, existingReqs);
    createSnapshotForRetired('reject-react', contentHash, content);

    // Save a copy of the registry before import
    const registryPath = join(workspace, 'requirements', 'registry.json');
    const originalContent = readFileSync(registryPath, 'utf-8');

    const result = importRequirements(
      'reject-react',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RETIRED_ID_REUSE');
    expect(result.retiredIdReuse).toContain('REQ-001');

    // Verify registry bytes are unchanged
    const afterContent = readFileSync(registryPath, 'utf-8');
    expect(afterContent).toBe(originalContent);
  });

  it('should reject entire import when any reactivation is attempted', () => {
    // Document contains both a valid new requirement and a reactivation attempt
    const content = `## REQ-001: Reactivation attempt
Status: Active
Priority: High

### Description

Reactivating retired.

### Expected result

Should fail.


## REQ-002: Valid new requirement
Status: Active
Priority: Medium

### Description

This one is valid.

### Expected result

Would succeed normally.
`;
    const contentHash = computeHash(content);
    const existingReqs: Record<string, RequirementWithHistory> = {
      'REQ-001': {
        ...createRequirement({
          requirementId: 'REQ-001',
          status: 'retired',
          sourceReference: { documentId: 'doc-1', contentHash },
        }),
        status: 'retired',
        retiredAt: '2026-01-01T00:00:00Z',
      } as RequirementWithHistory,
    };
    const workspace = createTestProjectWithRegistry('reject-all', { 'doc-1': { contentHashes: [contentHash] } }, existingReqs);
    createSnapshotForRetired('reject-all', contentHash, content);

    const registryPath = join(workspace, 'requirements', 'registry.json');
    const originalContent = readFileSync(registryPath, 'utf-8');

    const result = importRequirements(
      'reject-all',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RETIRED_ID_REUSE');

    // Verify registry is unchanged - REQ-002 should NOT be added
    const afterContent = readFileSync(registryPath, 'utf-8');
    expect(afterContent).toBe(originalContent);

    const registry = loadRequirementRegistry(registryPath);
    expect(registry.requirements['REQ-002']).toBeUndefined();
  });
});

// ============================================================================
// Explicit Retirement Through Import Tests
// ============================================================================

describe('Explicit retirement through import', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `explicit-retire-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createTestProjectWithRegistry(
    projectId: string,
    documents: Record<string, { contentHashes: string[] }>,
    existingRequirements?: Record<string, RequirementWithHistory>
  ): string {
    const workspace = join(tempRoot, projectId);
    mkdirSync(workspace, { recursive: true });

    // Build config.documents array
    const configDocuments = Object.keys(documents).map(docId => ({
      documentId: docId,
      sourcePath: `${docId}.md`,
      format: 'markdown' as const,
    }));

    const config = {
      projectId,
      name: `Test Project ${projectId}`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: configDocuments,
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {} as Record<string, unknown>,
    };

    for (const [docId, { contentHashes }] of Object.entries(documents)) {
      docRegistry.documents[docId] = {
        documentId: docId,
        name: docId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: contentHashes.map((hash, i) => ({
          contentHash: hash,
          snapshotPath: `sources/${hash}.md`,
          contentSize: 100,
          ingestedAt: new Date().toISOString(),
          sourcePath: `test-${i}.md`,
          format: 'markdown',
        })),
      };
    }

    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    if (existingRequirements) {
      const reqDir = join(workspace, 'requirements');
      mkdirSync(reqDir, { recursive: true });
      const reqRegistry: RequirementRegistryWithHistory = {
        schemaVersion: '1.0',
        updatedAt: new Date().toISOString(),
        requirements: existingRequirements,
      };
      writeFileSync(join(reqDir, 'registry.json'), JSON.stringify(reqRegistry, null, 2));
    }

    return workspace;
  }

  function createSnapshotForExplicitRetire(
    projectId: string,
    contentHash: string,
    content: string
  ): void {
    const snapshotPath = join(tempRoot, projectId, 'documents', 'sources', `${contentHash}.md`);
    writeFileSync(snapshotPath, content);
  }

  it('should apply explicit retirement from active to retired through import', () => {
    // Import with Status: Retired
    const content = `## REQ-001: Original active requirement
Status: Retired
Priority: Medium

### Description

A test requirement for validation

### Expected result

The expected behavior
`;
    const contentHash = computeHash(content);
    const existingReqs: Record<string, RequirementWithHistory> = {
      'REQ-001': {
        ...createRequirement({
          requirementId: 'REQ-001',
          status: 'active',
          title: 'Original active requirement',
          sourceReference: { documentId: 'doc-1', contentHash: VALID_CONTENT_HASH },
        }),
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as RequirementWithHistory,
    };
    createTestProjectWithRegistry('explicit-retire', { 'doc-1': { contentHashes: [contentHash] } }, existingReqs);
    createSnapshotForExplicitRetire('explicit-retire', contentHash, content);

    const result = importRequirements(
      'explicit-retire',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);
    expect(result.stats?.updated).toBe(1);

    const registryPath = join(tempRoot, 'explicit-retire', 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);

    // Should now be retired
    expect(registry.requirements['REQ-001'].status).toBe('retired');
    expect(registry.requirements['REQ-001'].retiredAt).toBeDefined();
    expect(registry.requirements['REQ-001'].retirementReason).toBeDefined();
  });

  it('should preserve previous active version in history when explicitly retired', () => {
    const content = `## REQ-001: Original active title
Status: Retired
Priority: Medium

### Description

A test requirement for validation

### Expected result

The expected behavior
`;
    const contentHash = computeHash(content);
    const existingReqs: Record<string, RequirementWithHistory> = {
      'REQ-001': {
        ...createRequirement({
          requirementId: 'REQ-001',
          status: 'active',
          title: 'Original active title',
          sourceReference: { documentId: 'doc-1', contentHash: VALID_CONTENT_HASH },
        }),
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as RequirementWithHistory,
    };
    createTestProjectWithRegistry('retire-history', { 'doc-1': { contentHashes: [contentHash] } }, existingReqs);
    createSnapshotForExplicitRetire('retire-history', contentHash, content);

    importRequirements(
      'retire-history',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    const registryPath = join(tempRoot, 'retire-history', 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);

    // Check history
    const history = registry.requirements['REQ-001'].history;
    expect(history).toBeDefined();
    expect(history!.length).toBe(1);
    expect(history![0].status).toBe('active'); // Previous status was active
    expect(history![0].title).toBe('Original active title');
    expect(history![0].reason).toContain('Retired');
  });

  it('should detect active-to-retired transition as content change', () => {
    const existing: RequirementWithHistory = {
      ...createRequirement({ status: 'active' }),
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const incoming = createRequirement({ status: 'retired' });

    expect(hasContentChanged(existing, incoming)).toBe(true);
  });
});

// ============================================================================
// Multiple-Document Import Behavior Tests
// ============================================================================

describe('Multiple-document import behavior', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `multi-doc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createMultiDocProject(
    projectId: string,
    docConfigs: Record<string, string[]>
  ): string {
    const workspace = join(tempRoot, projectId);
    mkdirSync(workspace, { recursive: true });

    // Build config.documents array
    const configDocuments = Object.keys(docConfigs).map(docId => ({
      documentId: docId,
      sourcePath: `${docId}.md`,
      format: 'markdown' as const,
    }));

    const config = {
      projectId,
      name: `Multi-doc Project ${projectId}`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: configDocuments,
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {} as Record<string, unknown>,
    };

    for (const [docId, hashes] of Object.entries(docConfigs)) {
      docRegistry.documents[docId] = {
        documentId: docId,
        name: docId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: hashes.map((hash, i) => ({
          contentHash: hash,
          snapshotPath: `sources/${hash}.md`,
          contentSize: 100,
          ingestedAt: new Date().toISOString(),
          sourcePath: `test-${i}.md`,
          format: 'markdown',
        })),
      };
    }

    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    return workspace;
  }

  function createMultiDocSnapshot(
    projectId: string,
    contentHash: string,
    content: string
  ): void {
    const snapshotPath = join(tempRoot, projectId, 'documents', 'sources', `${contentHash}.md`);
    writeFileSync(snapshotPath, content);
  }

  it('should maintain document ownership and not report other documents requirements as missing', () => {
    // First, import document A with REQ-001 and REQ-002
    const contentA = `## REQ-001: Requirement from Doc A
Status: Active
Priority: High

### Description

First requirement from document A.

### Expected result

Expected result A1.


## REQ-002: Second from Doc A
Status: Active
Priority: Medium

### Description

Second requirement from document A.

### Expected result

Expected result A2.
`;
    const hashA = computeHash(contentA);

    // Now import document B with REQ-003 and REQ-004
    const contentB = `## REQ-003: Requirement from Doc B
Status: Active
Priority: High

### Description

First requirement from document B.

### Expected result

Expected result B1.


## REQ-004: Second from Doc B
Status: Active
Priority: Medium

### Description

Second requirement from document B.

### Expected result

Expected result B2.
`;
    const hashB = computeHash(contentB);

    createMultiDocProject('multi-doc-test', {
      'doc-a': [hashA],
      'doc-b': [hashB],
    });
    createMultiDocSnapshot('multi-doc-test', hashA, contentA);
    createMultiDocSnapshot('multi-doc-test', hashB, contentB);

    let result = importRequirements(
      'multi-doc-test',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-a',
        contentHash: hashA,
      }
    );

    expect(result.success).toBe(true);
    expect(result.stats?.new).toBe(2);

    result = importRequirements(
      'multi-doc-test',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-b',
        contentHash: hashB,
      }
    );

    expect(result.success).toBe(true);
    expect(result.stats?.new).toBe(2);
    // Document B should NOT report doc-a's requirements as missing
    expect(result.plan?.missingIds.length).toBe(0);

    // Re-import document A - should not report B's requirements as missing
    result = importRequirements(
      'multi-doc-test',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-a',
        contentHash: hashA,
      }
    );

    expect(result.success).toBe(true);
    expect(result.plan?.missingIds.length).toBe(0);
  });

  it('should reject cross-document ID conflict', () => {
    // Import document A with REQ-001
    const contentA = `## REQ-001: Requirement from Doc A
Status: Active
Priority: High

### Description

Requirement from document A.

### Expected result

Expected result.
`;
    const hashA = computeHash(contentA);

    // Attempt to import REQ-001 from document B (conflict!)
    const contentB = `## REQ-001: Same ID from Doc B!
Status: Active
Priority: Medium

### Description

This should conflict with doc-a's REQ-001.

### Expected result

Should be rejected.
`;
    const hashB = computeHash(contentB);

    const workspace = createMultiDocProject('cross-doc-conflict', {
      'doc-a': [hashA],
      'doc-b': [hashB],
    });
    createMultiDocSnapshot('cross-doc-conflict', hashA, contentA);
    createMultiDocSnapshot('cross-doc-conflict', hashB, contentB);

    let result = importRequirements(
      'cross-doc-conflict',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-a',
        contentHash: hashA,
      }
    );

    expect(result.success).toBe(true);

    // Save registry state before attempting conflict
    const registryPath = join(workspace, 'requirements', 'registry.json');
    const originalContent = readFileSync(registryPath, 'utf-8');

    result = importRequirements(
      'cross-doc-conflict',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-b',
        contentHash: hashB,
      }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CROSS_DOCUMENT_ID_CONFLICT');
    expect(result.crossDocumentConflicts).toBeDefined();
    expect(result.crossDocumentConflicts![0].requirementId).toBe('REQ-001');
    expect(result.crossDocumentConflicts![0].incomingDocumentId).toBe('doc-b');
    expect(result.crossDocumentConflicts![0].existingDocumentId).toBe('doc-a');

    // Verify registry is unchanged
    const afterContent = readFileSync(registryPath, 'utf-8');
    expect(afterContent).toBe(originalContent);
  });
});

// ============================================================================
// Public Mutator Validation Tests
// ============================================================================

describe('Public mutator validation', () => {
  it('registerRequirement should reject invalid requirement structure', () => {
    const registry = createEmptyRegistry();
    const invalid = createRequirement({
      title: '', // Invalid: empty title
    });

    expect(() => registerRequirement(registry, invalid)).toThrow(RegistryError);
    expect(() => registerRequirement(registry, invalid)).toThrow(/validation failed/i);
  });

  it('registerRequirement should reject invalid requirement ID format', () => {
    const registry = createEmptyRegistry();
    const invalid = createRequirement({
      requirementId: 'invalid-id', // lowercase
    });

    expect(() => registerRequirement(registry, invalid)).toThrow(RegistryError);
    expect(() => registerRequirement(registry, invalid)).toThrow(/validation failed/i);
  });

  it('registerRequirement should reject registering content under retired ID', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = {
      ...createRequirement({ status: 'retired' }),
      status: 'retired',
      retiredAt: new Date().toISOString(),
    } as RequirementWithHistory;

    const newReq = createRequirement({ requirementId: 'REQ-001' });

    expect(() => registerRequirement(registry, newReq)).toThrow(RegistryError);
    expect(() => registerRequirement(registry, newReq)).toThrow(/already exists|retired/i);
  });

  it('updateRequirement should reject invalid requirement structure', () => {
    const registry = createEmptyRegistry();
    registerRequirement(registry, createRequirement());

    const invalid = createRequirement({
      description: '', // Invalid: empty description
    });

    expect(() => updateRequirement(registry, invalid)).toThrow(RegistryError);
    expect(() => updateRequirement(registry, invalid)).toThrow(/validation failed/i);
  });

  it('updateRequirement should reject reactivating retired requirement', () => {
    const registry = createEmptyRegistry();
    registry.requirements['REQ-001'] = {
      ...createRequirement({ status: 'retired' }),
      status: 'retired',
      retiredAt: new Date().toISOString(),
    } as RequirementWithHistory;

    const reactivation = createRequirement({ status: 'active' });

    expect(() => updateRequirement(registry, reactivation)).toThrow(RegistryError);
    expect(() => updateRequirement(registry, reactivation)).toThrow(/reactivate|retired/i);
  });

  it('retireRequirement should reject invalid requirement ID format', () => {
    const registry = createEmptyRegistry();

    expect(() => retireRequirement(registry, 'invalid-id', 'reason')).toThrow(RegistryError);
    expect(() => retireRequirement(registry, 'invalid-id', 'reason')).toThrow(/Invalid requirement ID/i);
  });

  it('public mutators should not modify registry when validation fails', () => {
    const registry = createEmptyRegistry();
    registerRequirement(registry, createRequirement({ requirementId: 'REQ-001' }));

    const originalReq = { ...registry.requirements['REQ-001'] };

    const invalid = createRequirement({
      requirementId: 'REQ-001',
      title: '', // Invalid
    });

    try {
      updateRequirement(registry, invalid);
    } catch {
      // Expected to throw
    }

    // Registry should be unchanged
    expect(registry.requirements['REQ-001'].title).toBe(originalReq.title);
  });
});

// ============================================================================
// Unresolved Requirement Import Tests
// ============================================================================

describe('Unresolved requirement import', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `unresolved-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createSimpleProject(projectId: string, contentHash: string): void {
    const workspace = join(tempRoot, projectId);
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId,
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: 'doc-1', sourcePath: 'doc-1.md', format: 'markdown' as const }],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        'doc-1': {
          documentId: 'doc-1',
          name: 'doc-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [{
            contentHash,
            snapshotPath: `sources/${contentHash}.md`,
            contentSize: 100,
            ingestedAt: new Date().toISOString(),
            sourcePath: 'test.md',
            format: 'markdown',
          }],
        },
      },
    };

    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));
  }

  function createSimpleSnapshot(projectId: string, contentHash: string, content: string): void {
    const snapshotPath = join(tempRoot, projectId, 'documents', 'sources', `${contentHash}.md`);
    writeFileSync(snapshotPath, content);
  }

  it('should import structurally valid unresolved requirement', () => {
    const content = `## REQ-001: Unresolved requirement
Status: Active
Priority: High

### Description

This requirement has unclear expected behavior.

### Unresolved

The specification does not define what should happen when the user submits an empty form.
`;
    const contentHash = computeHash(content);
    createSimpleProject('unresolved-project', contentHash);
    createSimpleSnapshot('unresolved-project', contentHash, content);

    const result = importRequirements(
      'unresolved-project',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);
    expect(result.stats?.new).toBe(1);

    const registryPath = join(tempRoot, 'unresolved-project', 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);

    // Should be in registry
    expect(registry.requirements['REQ-001']).toBeDefined();
    // Should remain unresolved
    expect(registry.requirements['REQ-001'].unresolved).toBeDefined();
    expect(registry.requirements['REQ-001'].unresolved?.reason).toContain('does not define');
  });

  it('should not invent expected result for unresolved requirement', () => {
    const content = `## REQ-001: Missing expected behavior
Status: Active
Priority: High

### Description

User submits a form.

### Unresolved

Expected behavior not specified.
`;
    const contentHash = computeHash(content);
    createSimpleProject('no-invent', contentHash);
    createSimpleSnapshot('no-invent', contentHash, content);

    const result = importRequirements(
      'no-invent',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);

    const registryPath = join(tempRoot, 'no-invent', 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);

    // expectedResult should be undefined or empty, not invented
    expect(registry.requirements['REQ-001'].expectedResult).toBeFalsy();
  });
});

// ============================================================================
// History Status Field Tests
// ============================================================================

describe('History status field', () => {
  it('should include status in historical version', () => {
    const registry = createEmptyRegistry();
    registerRequirement(registry, createRequirement({ status: 'active', title: 'Version 1' }));

    // Retire the requirement
    retireRequirement(registry, 'REQ-001', 'Feature removed');

    const history = getRequirementHistory(registry, 'REQ-001');
    expect(history.length).toBe(1);
    expect(history[0].status).toBe('active'); // Was active before retirement
    expect(history[0].title).toBe('Version 1');
  });

  it('should preserve status through multiple updates', () => {
    const registry = createEmptyRegistry();
    registerRequirement(registry, createRequirement({ status: 'active', title: 'Version 1' }));

    // Update with new title
    updateRequirement(registry, createRequirement({ title: 'Version 2' }));

    // Retire
    retireRequirement(registry, 'REQ-001', 'No longer needed');

    const history = getRequirementHistory(registry, 'REQ-001');
    expect(history.length).toBe(2);

    // Most recent history entry (Version 2 -> retired)
    expect(history[0].status).toBe('active');
    expect(history[0].title).toBe('Version 2');

    // Older history entry (Version 1 -> Version 2)
    expect(history[1].status).toBe('active');
    expect(history[1].title).toBe('Version 1');
  });
});

// ============================================================================
// Idempotent Import Tests
// ============================================================================

describe('Idempotent imports', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `idempotent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createSimpleProject(projectId: string, contentHash: string): void {
    const workspace = join(tempRoot, projectId);
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId,
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: 'doc-1', sourcePath: 'doc-1.md', format: 'markdown' as const }],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        'doc-1': {
          documentId: 'doc-1',
          name: 'doc-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [{
            contentHash,
            snapshotPath: `sources/${contentHash}.md`,
            contentSize: 100,
            ingestedAt: new Date().toISOString(),
            sourcePath: 'test.md',
            format: 'markdown',
          }],
        },
      },
    };

    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));
  }

  function createIdempotentSnapshot(projectId: string, contentHash: string, content: string): void {
    const snapshotPath = join(tempRoot, projectId, 'documents', 'sources', `${contentHash}.md`);
    writeFileSync(snapshotPath, content);
  }

  it('should produce no updates when re-importing exact same content', () => {
    const content = `## REQ-001: Test requirement
Status: Active
Priority: High

### Description

Test description.

### Expected result

Test result.
`;
    const contentHash = computeHash(content);
    createSimpleProject('idempotent-test', contentHash);
    createIdempotentSnapshot('idempotent-test', contentHash, content);

    // First import
    let result = importRequirements(
      'idempotent-test',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);
    expect(result.stats?.new).toBe(1);

    // Second import of exact same content
    result = importRequirements(
      'idempotent-test',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    expect(result.success).toBe(true);
    expect(result.stats?.new).toBe(0);
    expect(result.stats?.updated).toBe(0);
    expect(result.stats?.unchanged).toBe(1);
  });

  it('should not create additional history entries on unchanged re-import', () => {
    const content = `## REQ-001: Test requirement
Status: Active
Priority: High

### Description

Test description.

### Expected result

Test result.
`;
    const contentHash = computeHash(content);
    createSimpleProject('no-extra', contentHash);
    createIdempotentSnapshot('no-extra', contentHash, content);

    // First import
    importRequirements(
      'no-extra',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    // Second import
    importRequirements(
      'no-extra',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    // Third import
    importRequirements(
      'no-extra',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash,
      }
    );

    const registryPath = join(tempRoot, 'no-extra', 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);

    // No history should be created for unchanged imports
    expect(registry.requirements['REQ-001'].history).toBeUndefined();
  });

  it('should create history entry when content actually changes', () => {
    // First version
    const content1 = `## REQ-001: Original title
Status: Active
Priority: High

### Description

Original description.

### Expected result

Original result.
`;
    const contentHash1 = computeHash(content1);

    // Second version with changed content
    const content2 = `## REQ-001: Updated title
Status: Active
Priority: High

### Description

Updated description.

### Expected result

Updated result.
`;
    const contentHash2 = computeHash(content2);

    // Create project with both hashes
    const workspace = join(tempRoot, 'content-change');
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId: 'content-change',
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: 'doc-1', sourcePath: 'doc-1.md', format: 'markdown' as const }],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        'doc-1': {
          documentId: 'doc-1',
          name: 'doc-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [
            { contentHash: contentHash1, snapshotPath: `sources/${contentHash1}.md`, contentSize: 100, ingestedAt: new Date().toISOString(), sourcePath: 'v1.md', format: 'markdown' },
            { contentHash: contentHash2, snapshotPath: `sources/${contentHash2}.md`, contentSize: 100, ingestedAt: new Date().toISOString(), sourcePath: 'v2.md', format: 'markdown' },
          ],
        },
      },
    };

    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    // Create snapshot files
    writeFileSync(join(sourcesDir, `${contentHash1}.md`), content1);
    writeFileSync(join(sourcesDir, `${contentHash2}.md`), content2);

    // First import - version 1
    importRequirements(
      'content-change',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash: contentHash1,
      }
    );

    // Second import - version 2 with changed content
    const result = importRequirements(
      'content-change',
      {
        projectServiceOptions: { projectDataRoot: tempRoot },
        documentId: 'doc-1',
        contentHash: contentHash2,
      }
    );

    expect(result.success).toBe(true);
    expect(result.stats?.updated).toBe(1);

    const registryPath = join(workspace, 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);

    // History should have previous version
    expect(registry.requirements['REQ-001'].history).toBeDefined();
    expect(registry.requirements['REQ-001'].history!.length).toBe(1);
    expect(registry.requirements['REQ-001'].history![0].title).toBe('Original title');
    expect(registry.requirements['REQ-001'].history![0].sourceReference.contentHash).toBe(contentHash1);

    // Current version should be updated
    expect(registry.requirements['REQ-001'].title).toBe('Updated title');
    expect(registry.requirements['REQ-001'].sourceReference.contentHash).toBe(contentHash2);
  });
});

// ============================================================================
// Task 2.7 - Snapshot Integrity Tests
// ============================================================================

describe('Snapshot integrity (Task 2.7)', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `snapshot-integrity-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createProjectWithVersions(
    projectId: string,
    docId: string,
    versions: Array<{ content: string; hash: string }>
  ): string {
    const workspace = join(tempRoot, projectId);
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId,
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: docId, sourcePath: `${docId}.md`, format: 'markdown' as const }],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    // Write snapshot files
    for (const version of versions) {
      writeFileSync(join(sourcesDir, `${version.hash}.md`), version.content);
    }

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        [docId]: {
          documentId: docId,
          name: docId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: versions.map((v, i) => ({
            contentHash: v.hash,
            snapshotPath: `sources/${v.hash}.md`,
            contentSize: v.content.length,
            ingestedAt: new Date().toISOString(),
            sourcePath: `v${i + 1}.md`,
            format: 'markdown',
          })),
        },
      },
    };

    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    return workspace;
  }

  it('should use actual snapshot bytes, not arbitrary caller content', () => {
    const realContent = `## REQ-001: Real requirement
Status: Active
Priority: High

### Description

This is the real content from the snapshot.

### Expected result

Real expected result.
`;
    const realHash = computeHash(realContent);
    createProjectWithVersions('snapshot-test', 'doc-1', [{ content: realContent, hash: realHash }]);

    // The import reads from disk, not from caller-supplied content
    // This signature no longer accepts content as a parameter
    const result = importRequirements('snapshot-test', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: realHash,
    });

    expect(result.success).toBe(true);
    expect(result.stats?.new).toBe(1);

    const registryPath = join(tempRoot, 'snapshot-test', 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);
    expect(registry.requirements['REQ-001'].title).toBe('Real requirement');
    expect(registry.requirements['REQ-001'].description).toBe('This is the real content from the snapshot.');
  });

  it('should import older version explicitly by its hash', () => {
    const v1Content = `## REQ-001: Version 1 Title
Status: Active
Priority: High

### Description

Version 1 description.

### Expected result

Version 1 result.
`;
    const v2Content = `## REQ-001: Version 2 Title
Status: Active
Priority: High

### Description

Version 2 description.

### Expected result

Version 2 result.
`;
    const v1Hash = computeHash(v1Content);
    const v2Hash = computeHash(v2Content);

    createProjectWithVersions('version-select', 'doc-1', [
      { content: v1Content, hash: v1Hash },
      { content: v2Content, hash: v2Hash },
    ]);

    // Import the OLDER version explicitly
    const result = importRequirements('version-select', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: v1Hash,  // Explicitly selecting v1
    });

    expect(result.success).toBe(true);

    const registryPath = join(tempRoot, 'version-select', 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);

    // Should have v1 content
    expect(registry.requirements['REQ-001'].title).toBe('Version 1 Title');
    expect(registry.requirements['REQ-001'].sourceReference.contentHash).toBe(v1Hash);
  });

  it('should reference the selected documentId and contentHash in every imported record', () => {
    const content = `## REQ-001: First
Status: Active
Priority: High

### Description

First requirement.

### Expected result

First result.


## REQ-002: Second
Status: Active
Priority: Medium

### Description

Second requirement.

### Expected result

Second result.
`;
    const hash = computeHash(content);
    createProjectWithVersions('multi-req', 'my-doc', [{ content, hash }]);

    const result = importRequirements('multi-req', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'my-doc',
      contentHash: hash,
    });

    expect(result.success).toBe(true);

    const registryPath = join(tempRoot, 'multi-req', 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);

    // Both requirements should reference the same document and hash
    expect(registry.requirements['REQ-001'].sourceReference.documentId).toBe('my-doc');
    expect(registry.requirements['REQ-001'].sourceReference.contentHash).toBe(hash);
    expect(registry.requirements['REQ-002'].sourceReference.documentId).toBe('my-doc');
    expect(registry.requirements['REQ-002'].sourceReference.contentHash).toBe(hash);
  });

  it('should reject with SNAPSHOT_CORRUPTED when hash does not match content', () => {
    const realContent = `## REQ-001: Real content
Status: Active
Priority: High

### Description

Real description.

### Expected result

Real result.
`;
    const realHash = computeHash(realContent);
    const tamperedContent = realContent + '\n\n// Tampered!';

    // Create project but write tampered content under real hash
    const workspace = join(tempRoot, 'corrupted');
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId: 'corrupted',
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: 'doc-1', sourcePath: 'doc-1.md', format: 'markdown' as const }],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    // Write TAMPERED content under the real hash filename
    writeFileSync(join(sourcesDir, `${realHash}.md`), tamperedContent);

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        'doc-1': {
          documentId: 'doc-1',
          name: 'doc-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [{
            contentHash: realHash,
            snapshotPath: `sources/${realHash}.md`,
            contentSize: 100,
            ingestedAt: new Date().toISOString(),
            sourcePath: 'test.md',
            format: 'markdown',
          }],
        },
      },
    };
    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    const result = importRequirements('corrupted', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: realHash,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SNAPSHOT_CORRUPTED');
  });

  it('should reject with SNAPSHOT_NOT_FOUND when snapshot file is missing', () => {
    const hash = 'a'.repeat(64);

    // Create project without snapshot file
    const workspace = join(tempRoot, 'missing-snap');
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId: 'missing-snap',
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: 'doc-1', sourcePath: 'doc-1.md', format: 'markdown' as const }],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    // Document registry references snapshot that doesn't exist
    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        'doc-1': {
          documentId: 'doc-1',
          name: 'doc-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [{
            contentHash: hash,
            snapshotPath: `sources/${hash}.md`,
            contentSize: 100,
            ingestedAt: new Date().toISOString(),
            sourcePath: 'test.md',
            format: 'markdown',
          }],
        },
      },
    };
    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    const result = importRequirements('missing-snap', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: hash,
    });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SNAPSHOT_NOT_FOUND');
  });

  it('should leave registry unchanged on failed import', () => {
    // First, create a successful import
    const validContent = `## REQ-001: Valid requirement
Status: Active
Priority: High

### Description

Valid description.

### Expected result

Valid result.
`;
    const validHash = computeHash(validContent);
    createProjectWithVersions('unchanged-test', 'doc-1', [{ content: validContent, hash: validHash }]);

    importRequirements('unchanged-test', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: validHash,
    });

    // Record the registry state
    const registryPath = join(tempRoot, 'unchanged-test', 'requirements', 'registry.json');
    const beforeContent = readFileSync(registryPath, 'utf-8');

    // Now add a corrupted version
    const corruptedHash = 'b'.repeat(64);
    const documentsPath = join(tempRoot, 'unchanged-test', 'documents', 'documents.json');
    const docRegistry = JSON.parse(readFileSync(documentsPath, 'utf-8'));
    docRegistry.documents['doc-1'].versions.push({
      contentHash: corruptedHash,
      snapshotPath: `sources/${corruptedHash}.md`,
      contentSize: 100,
      ingestedAt: new Date().toISOString(),
      sourcePath: 'corrupted.md',
      format: 'markdown',
    });
    writeFileSync(documentsPath, JSON.stringify(docRegistry, null, 2));

    // Write wrong content to the snapshot file
    writeFileSync(
      join(tempRoot, 'unchanged-test', 'documents', 'sources', `${corruptedHash}.md`),
      'wrong content that does not match hash'
    );

    // Try to import the corrupted version
    const result = importRequirements('unchanged-test', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: corruptedHash,
    });

    expect(result.success).toBe(false);

    // Verify registry is unchanged
    const afterContent = readFileSync(registryPath, 'utf-8');
    expect(afterContent).toBe(beforeContent);
  });
});

// ============================================================================
// Task 2.7 - Safe Public Mutation API Tests (applyRequirementChange)
// ============================================================================

describe('Safe public mutation API (Task 2.7)', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `safe-api-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function createProjectWithDoc(projectId: string, docId: string, hash: string): string {
    const workspace = join(tempRoot, projectId);
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId,
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: docId, sourcePath: `${docId}.md`, format: 'markdown' as const }],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        [docId]: {
          documentId: docId,
          name: docId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [{
            contentHash: hash,
            snapshotPath: `sources/${hash}.md`,
            contentSize: 100,
            ingestedAt: new Date().toISOString(),
            sourcePath: 'test.md',
            format: 'markdown',
          }],
        },
      },
    };

    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    return workspace;
  }

  // Note: We import applyRequirementChange via the index.ts exports
  // These tests verify that the safe mutation API enforces all required validations

  it('should reject invalid requirement structure', () => {
    const hash = 'a'.repeat(64);
    createProjectWithDoc('invalid-struct', 'doc-1', hash);

    // Import the applyRequirementChange function
    
    const result = applyRequirementChange(
      'invalid-struct',
      {
        type: 'register',
        requirement: createRequirement({
          projectId: 'invalid-struct',
          title: '', // Invalid: empty title
          sourceReference: { documentId: 'doc-1', contentHash: hash },
        }),
      },
      { projectServiceOptions: { projectDataRoot: tempRoot } }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_FAILED');
  });

  it('should reject project ID mismatch', () => {
    const hash = 'a'.repeat(64);
    createProjectWithDoc('project-mismatch', 'doc-1', hash);

    
    const result = applyRequirementChange(
      'project-mismatch',
      {
        type: 'register',
        requirement: createRequirement({
          projectId: 'different-project', // Mismatch!
          sourceReference: { documentId: 'doc-1', contentHash: hash },
        }),
      },
      { projectServiceOptions: { projectDataRoot: tempRoot } }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('PROJECT_ID_MISMATCH');
  });

  it('should reject unknown source document ID', () => {
    const hash = 'a'.repeat(64);
    createProjectWithDoc('unknown-doc', 'doc-1', hash);

    const result = applyRequirementChange(
      'unknown-doc',
      {
        type: 'register',
        requirement: createRequirement({
          projectId: 'unknown-doc',
          sourceReference: { documentId: 'nonexistent-doc', contentHash: hash },
        }),
      },
      { projectServiceOptions: { projectDataRoot: tempRoot } }
    );

    expect(result.success).toBe(false);
    // Validation catches unknown document before specific error code
    expect(result.error?.code).toBe('VALIDATION_FAILED');
    expect(result.error?.message).toContain('nonexistent-doc');
  });

  it('should reject unknown content hash', () => {
    const realHash = 'a'.repeat(64);
    const fakeHash = 'b'.repeat(64);
    createProjectWithDoc('unknown-hash', 'doc-1', realHash);

    const result = applyRequirementChange(
      'unknown-hash',
      {
        type: 'register',
        requirement: createRequirement({
          projectId: 'unknown-hash',
          sourceReference: { documentId: 'doc-1', contentHash: fakeHash },
        }),
      },
      { projectServiceOptions: { projectDataRoot: tempRoot } }
    );

    expect(result.success).toBe(false);
    // Validation catches unknown hash before specific error code
    expect(result.error?.code).toBe('VALIDATION_FAILED');
    expect(result.error?.message).toContain(fakeHash);
  });

  it('should reject duplicate requirement ID on register', () => {
    const hash = 'a'.repeat(64);
    const workspace = createProjectWithDoc('dup-id', 'doc-1', hash);

    // Create existing requirement
    const reqDir = join(workspace, 'requirements');
    mkdirSync(reqDir, { recursive: true });
    const registry: RequirementRegistryWithHistory = {
      schemaVersion: '1.0',
      updatedAt: new Date().toISOString(),
      requirements: {
        'REQ-001': {
          ...createRequirement({
            projectId: 'dup-id',
            sourceReference: { documentId: 'doc-1', contentHash: hash },
          }),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as RequirementWithHistory,
      },
    };
    writeFileSync(join(reqDir, 'registry.json'), JSON.stringify(registry, null, 2));

    
    const result = applyRequirementChange(
      'dup-id',
      {
        type: 'register',
        requirement: createRequirement({
          projectId: 'dup-id',
          requirementId: 'REQ-001', // Already exists!
          sourceReference: { documentId: 'doc-1', contentHash: hash },
        }),
      },
      { projectServiceOptions: { projectDataRoot: tempRoot } }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('DUPLICATE_ID');
  });

  it('should reject retired-ID reactivation on update', () => {
    const hash = 'a'.repeat(64);
    const workspace = createProjectWithDoc('retired-react', 'doc-1', hash);

    // Create retired requirement
    const reqDir = join(workspace, 'requirements');
    mkdirSync(reqDir, { recursive: true });
    const registry: RequirementRegistryWithHistory = {
      schemaVersion: '1.0',
      updatedAt: new Date().toISOString(),
      requirements: {
        'REQ-001': {
          ...createRequirement({
            projectId: 'retired-react',
            status: 'retired',
            sourceReference: { documentId: 'doc-1', contentHash: hash },
          }),
          status: 'retired',
          retiredAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as RequirementWithHistory,
      },
    };
    writeFileSync(join(reqDir, 'registry.json'), JSON.stringify(registry, null, 2));

    
    const result = applyRequirementChange(
      'retired-react',
      {
        type: 'update',
        requirement: createRequirement({
          projectId: 'retired-react',
          requirementId: 'REQ-001',
          status: 'active', // Trying to reactivate!
          sourceReference: { documentId: 'doc-1', contentHash: hash },
        }),
      },
      { projectServiceOptions: { projectDataRoot: tempRoot } }
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('RETIRED_ID_REUSE');
  });

  it('should successfully register valid requirement', () => {
    const hash = 'a'.repeat(64);
    createProjectWithDoc('valid-register', 'doc-1', hash);

    
    const result = applyRequirementChange(
      'valid-register',
      {
        type: 'register',
        requirement: createRequirement({
          projectId: 'valid-register',
          sourceReference: { documentId: 'doc-1', contentHash: hash },
        }),
      },
      { projectServiceOptions: { projectDataRoot: tempRoot } }
    );

    expect(result.success).toBe(true);
    expect(result.requirement?.requirementId).toBe('REQ-001');
  });

  it('should successfully retire via applyRequirementChange', () => {
    const hash = 'a'.repeat(64);
    const workspace = createProjectWithDoc('retire-change', 'doc-1', hash);

    // Create existing active requirement
    const reqDir = join(workspace, 'requirements');
    mkdirSync(reqDir, { recursive: true });
    const registry: RequirementRegistryWithHistory = {
      schemaVersion: '1.0',
      updatedAt: new Date().toISOString(),
      requirements: {
        'REQ-001': {
          ...createRequirement({
            projectId: 'retire-change',
            sourceReference: { documentId: 'doc-1', contentHash: hash },
          }),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as RequirementWithHistory,
      },
    };
    writeFileSync(join(reqDir, 'registry.json'), JSON.stringify(registry, null, 2));


    const result = applyRequirementChange(
      'retire-change',
      {
        type: 'retire',
        requirementId: 'REQ-001',
        reason: 'No longer needed',
      },
      { projectServiceOptions: { projectDataRoot: tempRoot } }
    );

    expect(result.success).toBe(true);
    expect(result.requirement?.status).toBe('retired');
    expect(result.requirement?.retirementReason).toBe('No longer needed');
  });

  // =========================================================================
  // Task 2.7 Final Tests - Cross-document conflict and valid update
  // =========================================================================

  it('Test A: should reject cross-document ownership conflict via applyRequirementChange', () => {
    // Create project with TWO declared and ingested documents
    const hash1 = 'a'.repeat(64);
    const hash2 = 'b'.repeat(64);

    const workspace = join(tempRoot, 'cross-doc-conflict');
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId: 'cross-doc-conflict',
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [
        { documentId: 'doc-A', sourcePath: 'doc-A.md', format: 'markdown' as const },
        { documentId: 'doc-B', sourcePath: 'doc-B.md', format: 'markdown' as const },
      ],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    // Create document registry with both documents
    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        'doc-A': {
          documentId: 'doc-A',
          name: 'doc-A',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [{
            contentHash: hash1,
            snapshotPath: `sources/${hash1}.md`,
            contentSize: 100,
            ingestedAt: new Date().toISOString(),
            sourcePath: 'doc-A.md',
            format: 'markdown',
          }],
        },
        'doc-B': {
          documentId: 'doc-B',
          name: 'doc-B',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [{
            contentHash: hash2,
            snapshotPath: `sources/${hash2}.md`,
            contentSize: 100,
            ingestedAt: new Date().toISOString(),
            sourcePath: 'doc-B.md',
            format: 'markdown',
          }],
        },
      },
    };
    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    // Create requirement registry with REQ-001 owned by doc-A
    const reqDir = join(workspace, 'requirements');
    mkdirSync(reqDir, { recursive: true });
    const registryPath = join(reqDir, 'registry.json');
    const registry: RequirementRegistryWithHistory = {
      schemaVersion: '1.0',
      updatedAt: new Date().toISOString(),
      requirements: {
        'REQ-001': {
          ...createRequirement({
            projectId: 'cross-doc-conflict',
            requirementId: 'REQ-001',
            sourceReference: { documentId: 'doc-A', contentHash: hash1 },
          }),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as RequirementWithHistory,
      },
    };
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));

    // Capture registry state before the operation
    const beforeContent = readFileSync(registryPath, 'utf-8');

    // Attempt to register/update the same ID from doc-B (should fail)
    const result = applyRequirementChange(
      'cross-doc-conflict',
      {
        type: 'update',
        requirement: createRequirement({
          projectId: 'cross-doc-conflict',
          requirementId: 'REQ-001',
          title: 'Updated from wrong document',
          sourceReference: { documentId: 'doc-B', contentHash: hash2 },
        }),
      },
      { projectServiceOptions: { projectDataRoot: tempRoot } }
    );

    // Assert rejection with cross-document conflict
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CROSS_DOCUMENT_ID_CONFLICT');
    expect(result.error?.message).toContain('doc-A');
    expect(result.error?.message).toContain('doc-B');

    // Assert registry is byte-for-byte unchanged
    const afterContent = readFileSync(registryPath, 'utf-8');
    expect(afterContent).toBe(beforeContent);
  });

  it('Test B: should successfully update requirement and preserve history via applyRequirementChange', () => {
    const hash = 'a'.repeat(64);
    const workspace = join(tempRoot, 'valid-update-history');
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId: 'valid-update-history',
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: 'doc-1', sourcePath: 'doc-1.md', format: 'markdown' as const }],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        'doc-1': {
          documentId: 'doc-1',
          name: 'doc-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [{
            contentHash: hash,
            snapshotPath: `sources/${hash}.md`,
            contentSize: 100,
            ingestedAt: new Date().toISOString(),
            sourcePath: 'doc-1.md',
            format: 'markdown',
          }],
        },
      },
    };
    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    // Step 1: Register a valid active requirement using applyRequirementChange
    const registerResult = applyRequirementChange(
      'valid-update-history',
      {
        type: 'register',
        requirement: createRequirement({
          projectId: 'valid-update-history',
          requirementId: 'REQ-001',
          title: 'Original Title',
          description: 'Original description',
          priority: 'medium',
          status: 'active',
          sourceReference: { documentId: 'doc-1', contentHash: hash },
        }),
      },
      { projectServiceOptions: { projectDataRoot: tempRoot } }
    );

    expect(registerResult.success).toBe(true);

    // Step 2: Update the same requirement ID with valid changed content
    const updateResult = applyRequirementChange(
      'valid-update-history',
      {
        type: 'update',
        requirement: createRequirement({
          projectId: 'valid-update-history',
          requirementId: 'REQ-001',
          title: 'Updated Title',
          description: 'Updated description with more details',
          priority: 'high',
          status: 'active',
          sourceReference: { documentId: 'doc-1', contentHash: hash },
        }),
        reason: 'Content improved after review',
      },
      { projectServiceOptions: { projectDataRoot: tempRoot } }
    );

    // Assert update succeeds
    expect(updateResult.success).toBe(true);

    // Assert the current record contains updated content
    expect(updateResult.requirement?.title).toBe('Updated Title');
    expect(updateResult.requirement?.description).toBe('Updated description with more details');
    expect(updateResult.requirement?.priority).toBe('high');

    // Assert history is preserved
    const history = updateResult.requirement?.history;
    expect(history).toBeDefined();
    expect(history!.length).toBe(1);

    // Assert previous version contains original content
    const previousVersion = history![0];
    expect(previousVersion.title).toBe('Original Title');
    expect(previousVersion.description).toBe('Original description');
    expect(previousVersion.priority).toBe('medium');
    expect(previousVersion.status).toBe('active');
    expect(previousVersion.sourceReference.documentId).toBe('doc-1');
    expect(previousVersion.sourceReference.contentHash).toBe(hash);
    expect(previousVersion.supersededAt).toBeDefined();
    expect(previousVersion.reason).toBe('Content improved after review');
  });
});

// ============================================================================
// Task 2.7 - Source Reference Update Tests
// ============================================================================

describe('Source reference updates (Task 2.7)', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `source-ref-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should classify as sourceUpdated when content unchanged but hash changes', () => {
    // Create content that will parse identically but have different hashes
    // by adding whitespace that gets normalized away during parsing
    const content1 = `## REQ-001: Test requirement
Status: Active
Priority: High

### Description

Test description.

### Expected result

Test result.
`;
    // Same logical content but extra trailing newline creates different hash
    const content2 = `## REQ-001: Test requirement
Status: Active
Priority: High

### Description

Test description.

### Expected result

Test result.

`;
    const hash1 = computeHash(content1);
    const hash2 = computeHash(content2);

    // Verify the hashes are different
    expect(hash1).not.toBe(hash2);

    // Create project with both versions
    const workspace = join(tempRoot, 'src-update');
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId: 'src-update',
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: 'doc-1', sourcePath: 'doc-1.md', format: 'markdown' as const }],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    // Write both snapshots
    writeFileSync(join(sourcesDir, `${hash1}.md`), content1);
    writeFileSync(join(sourcesDir, `${hash2}.md`), content2);

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        'doc-1': {
          documentId: 'doc-1',
          name: 'doc-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [
            { contentHash: hash1, snapshotPath: `sources/${hash1}.md`, contentSize: content1.length, ingestedAt: new Date().toISOString(), sourcePath: 'v1.md', format: 'markdown' },
            { contentHash: hash2, snapshotPath: `sources/${hash2}.md`, contentSize: content2.length, ingestedAt: new Date().toISOString(), sourcePath: 'v2.md', format: 'markdown' },
          ],
        },
      },
    };
    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    // First import with hash1
    let result = importRequirements('src-update', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: hash1,
    });
    expect(result.success).toBe(true);
    expect(result.stats?.new).toBe(1);

    // Second import with hash2 (effectively same content, different hash)
    result = importRequirements('src-update', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: hash2,
    });

    expect(result.success).toBe(true);
    // Content parsed identically but source reference hash changed
    // This should be sourceUpdated, not unchanged (hash differs)
    expect(result.stats?.sourceUpdated).toBe(1);
    expect(result.stats?.unchanged).toBe(0);
    expect(result.stats?.updated).toBe(0);

    // Verify no history entry was created (source-only update)
    const registryPath = join(workspace, 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);
    expect(registry.requirements['REQ-001'].history).toBeUndefined();
    expect(registry.requirements['REQ-001'].sourceReference.contentHash).toBe(hash2);
  });

  it('should create history entry when content actually changes', () => {
    const content1 = `## REQ-001: Original title
Status: Active
Priority: High

### Description

Original description.

### Expected result

Original result.
`;
    const content2 = `## REQ-001: Updated title
Status: Active
Priority: High

### Description

Updated description.

### Expected result

Updated result.
`;
    const hash1 = computeHash(content1);
    const hash2 = computeHash(content2);

    const workspace = join(tempRoot, 'content-history');
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId: 'content-history',
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: 'doc-1', sourcePath: 'doc-1.md', format: 'markdown' as const }],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    writeFileSync(join(sourcesDir, `${hash1}.md`), content1);
    writeFileSync(join(sourcesDir, `${hash2}.md`), content2);

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        'doc-1': {
          documentId: 'doc-1',
          name: 'doc-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [
            { contentHash: hash1, snapshotPath: `sources/${hash1}.md`, contentSize: 100, ingestedAt: new Date().toISOString(), sourcePath: 'v1.md', format: 'markdown' },
            { contentHash: hash2, snapshotPath: `sources/${hash2}.md`, contentSize: 100, ingestedAt: new Date().toISOString(), sourcePath: 'v2.md', format: 'markdown' },
          ],
        },
      },
    };
    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    // First import
    importRequirements('content-history', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: hash1,
    });

    // Second import with actual content changes
    const result = importRequirements('content-history', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: hash2,
    });

    expect(result.success).toBe(true);
    expect(result.stats?.updated).toBe(1);

    // Verify history entry was created with previous content and source reference
    const registryPath = join(workspace, 'requirements', 'registry.json');
    const registry = loadRequirementRegistry(registryPath);
    expect(registry.requirements['REQ-001'].history).toBeDefined();
    expect(registry.requirements['REQ-001'].history!.length).toBe(1);
    expect(registry.requirements['REQ-001'].history![0].title).toBe('Original title');
    expect(registry.requirements['REQ-001'].history![0].sourceReference.contentHash).toBe(hash1);
  });

  it('should produce no changes when re-importing exact same version', () => {
    const content = `## REQ-001: Test requirement
Status: Active
Priority: High

### Description

Test description.

### Expected result

Test result.
`;
    const hash = computeHash(content);

    const workspace = join(tempRoot, 'exact-same');
    mkdirSync(workspace, { recursive: true });

    const config = {
      projectId: 'exact-same',
      name: `Test Project`,
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      documents: [{ documentId: 'doc-1', sourcePath: 'doc-1.md', format: 'markdown' as const }],
    };
    writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    mkdirSync(join(workspace, 'artifacts'), { recursive: true });

    const documentsDir = join(workspace, 'documents');
    const sourcesDir = join(documentsDir, 'sources');
    mkdirSync(sourcesDir, { recursive: true });

    writeFileSync(join(sourcesDir, `${hash}.md`), content);

    const docRegistry = {
      schemaVersion: '1.0' as const,
      updatedAt: new Date().toISOString(),
      documents: {
        'doc-1': {
          documentId: 'doc-1',
          name: 'doc-1',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versions: [{
            contentHash: hash,
            snapshotPath: `sources/${hash}.md`,
            contentSize: 100,
            ingestedAt: new Date().toISOString(),
            sourcePath: 'test.md',
            format: 'markdown',
          }],
        },
      },
    };
    writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(docRegistry, null, 2));

    // First import
    importRequirements('exact-same', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: hash,
    });

    const registryPath = join(workspace, 'requirements', 'registry.json');

    // Second import of exact same version
    const result = importRequirements('exact-same', {
      projectServiceOptions: { projectDataRoot: tempRoot },
      documentId: 'doc-1',
      contentHash: hash,
    });

    expect(result.success).toBe(true);
    expect(result.stats?.unchanged).toBe(1);
    expect(result.stats?.sourceUpdated).toBe(0);
    expect(result.stats?.updated).toBe(0);

    // No history entry
    const registry = loadRequirementRegistry(registryPath);
    expect(registry.requirements['REQ-001'].history).toBeUndefined();
  });
});
