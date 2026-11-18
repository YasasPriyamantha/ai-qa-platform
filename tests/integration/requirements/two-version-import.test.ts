/**
 * Task 2.12: Two-version end-to-end integration test
 *
 * Tests the complete document → import → registry flow across two document versions
 * to verify identity, lifecycle, and history rules per PROJECT_SPEC.md section 7.2.
 *
 * Uses real services: createProject, ingestDocument, importRequirements
 * Documents are declared in config before ingestion (DEC-030).
 * Registry files are never written by hand.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProject } from '../../../src/projects/service.js';
import { ingestDocument } from '../../../src/documents/service.js';
import {
  importRequirements,
  loadRequirementRegistry,
  isActiveId,
  getRequirement,
  getAllRequirementIds,
} from '../../../src/requirements/registry.js';

describe('Two-version end-to-end import (Task 2.12)', () => {
  let tempDir: string;
  let projectId: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `two-ver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });

    projectId = 'two-version-test';
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * V1 document content following REQUIREMENTS_AUTHORING_CONVENTION.md format.
   * Contains:
   * - REQ-001: active
   * - REQ-002: active
   * - REQ-003: active
   * - REQ-004: active
   * - REQ-005: unresolved (negative case with expected outcome)
   */
  const v1Content = `# Test Requirements V1

## REQ-001: First requirement

Status: Active
Priority: High

### Description

This is the first requirement that will remain identical in V2.

### Expected result

The first requirement produces expected behavior.

## REQ-002: Second requirement

Status: Active
Priority: Medium

### Description

This is the second requirement that will have changed content in V2.

### Expected result

The second requirement works correctly.

## REQ-003: Third requirement

Status: Active
Priority: Low

### Description

This is the third requirement that will be retired in V2.

### Expected result

The third requirement is functional.

## REQ-004: Fourth requirement

Status: Active
Priority: High

### Description

This is the fourth requirement that will be absent from V2.

### Expected result

The fourth requirement exists.

## REQ-005: Fifth requirement with unresolved behavior

Status: Active
Priority: Medium

### Description

This is the fifth requirement that has unresolved expected behavior.

### Negative cases

- Missing input: validation error is shown with helpful message.

### Unresolved

The specification does not define what happens when the user submits an empty form.
Clarification required from the product owner.
`;

  /**
   * V2 document content:
   * - REQ-001: identical content
   * - REQ-002: changed content (description different)
   * - REQ-003: Status: Retired
   * - REQ-004: absent
   * - REQ-005: still unresolved
   * - REQ-006: new requirement
   */
  const v2Content = `# Test Requirements V2

## REQ-001: First requirement

Status: Active
Priority: High

### Description

This is the first requirement that will remain identical in V2.

### Expected result

The first requirement produces expected behavior.

## REQ-002: Second requirement

Status: Active
Priority: Medium

### Description

This is the UPDATED second requirement with changed content in V2.

### Expected result

The second requirement works correctly with new behavior.

## REQ-003: Third requirement

Status: Retired
Priority: Low

### Description

This is the third requirement that will be retired in V2.

### Expected result

The third requirement is functional.

## REQ-005: Fifth requirement with unresolved behavior

Status: Active
Priority: Medium

### Description

This is the fifth requirement that has unresolved expected behavior.

### Negative cases

- Missing input: validation error is shown with helpful message.

### Unresolved

The specification does not define what happens when the user submits an empty form.
Clarification required from the product owner.

## REQ-006: Sixth requirement (new in V2)

Status: Active
Priority: High

### Description

This is a new requirement added in V2.

### Expected result

The sixth requirement provides new functionality.
`;

  it('should correctly handle two-version import with identity, lifecycle, and history rules', () => {
    // === SETUP: Create project first ===
    const project = createProject(
      {
        projectId,
        name: 'Two Version Test Project',
        baseUrl: 'https://example.com',
        environment: 'development',
        allowedDomains: ['example.com'],
        testDirectory: 'tests',
        artifactDirectory: 'artifacts',
        documents: [
          {
            documentId: 'test-reqs',
            sourcePath: 'docs/requirements.md', // Relative to workspace
            format: 'markdown',
          },
        ],
      },
      { projectDataRoot: tempDir }
    );

    expect(project.config.projectId).toBe(projectId);
    const workspace = join(tempDir, projectId);

    // Create docs directory inside workspace and write V1 content
    mkdirSync(join(workspace, 'docs'), { recursive: true });
    const docSourcePath = join(workspace, 'docs', 'requirements.md');
    writeFileSync(docSourcePath, v1Content, 'utf-8');

    // === V1: Ingest and import ===
    const v1IngestResult = ingestDocument(
      { documentId: 'test-reqs', sourcePath: 'docs/requirements.md' },
      { workspace }
    );
    expect(v1IngestResult.record.documentId).toBe('test-reqs');
    const v1Hash = v1IngestResult.version.contentHash;

    const v1ImportResult = importRequirements(projectId, {
      documentId: 'test-reqs',
      contentHash: v1Hash,
      projectServiceOptions: { projectDataRoot: tempDir },
    });
    expect(v1ImportResult.success).toBe(true);
    expect(v1ImportResult.stats?.total).toBe(5);
    expect(v1ImportResult.stats?.new).toBe(5);

    // Verify V1 registry state
    const registryPath = join(workspace, 'requirements', 'registry.json');
    let registry = loadRequirementRegistry(registryPath);

    expect(isActiveId(registry, 'REQ-001')).toBe(true);
    expect(isActiveId(registry, 'REQ-002')).toBe(true);
    expect(isActiveId(registry, 'REQ-003')).toBe(true);
    expect(isActiveId(registry, 'REQ-004')).toBe(true);
    expect(isActiveId(registry, 'REQ-005')).toBe(true);

    // REQ-005 should be unresolved
    const req005v1 = getRequirement(registry, 'REQ-005');
    expect(req005v1?.unresolved).toBeDefined();
    expect(req005v1?.unresolved?.reason).toContain('does not define');

    // === C. VERIFY VALID NEGATIVE CASE WITH EXPLICIT EXPECTED OUTCOME ===
    // REQ-005 has a genuine negative case: "Missing input: validation error is shown with helpful message."
    expect(req005v1?.negativeCases).toBeDefined();
    expect(req005v1!.negativeCases.length).toBeGreaterThanOrEqual(1);
    const negativeCaseV1 = req005v1!.negativeCases[0];
    expect(negativeCaseV1.condition).toBe('Missing input');
    expect(negativeCaseV1.expectedOutcome).toBe('validation error is shown with helpful message.');

    // === V2: Update source document, re-ingest, and re-import ===
    writeFileSync(docSourcePath, v2Content, 'utf-8');

    const v2IngestResult = ingestDocument(
      { documentId: 'test-reqs', sourcePath: 'docs/requirements.md' },
      { workspace }
    );
    expect(v2IngestResult.reused).toBe(false); // New version created
    const v2Hash = v2IngestResult.version.contentHash;
    expect(v2Hash).not.toBe(v1Hash);

    const v2ImportResult = importRequirements(projectId, {
      documentId: 'test-reqs',
      contentHash: v2Hash,
      projectServiceOptions: { projectDataRoot: tempDir },
    });
    expect(v2ImportResult.success).toBe(true);

    // === ASSERTIONS: Verify import plan and registry state ===
    const plan = v2ImportResult.plan!;

    // REQ-002 should be in updatedRequirements (content changed)
    const req002Update = plan.updatedRequirements.find(
      (u) => u.incoming.requirementId === 'REQ-002'
    );
    expect(req002Update).toBeDefined();
    expect(req002Update!.existing.description).not.toContain('UPDATED');
    expect(req002Update!.incoming.description).toContain('UPDATED');

    // REQ-001 should be in sourceUpdated (same content, new hash)
    const req001SourceUpdate = plan.sourceUpdated.find(
      (s) => s.requirementId === 'REQ-001'
    );
    expect(req001SourceUpdate).toBeDefined();
    expect(req001SourceUpdate!.previousSourceReference.contentHash).toBe(v1Hash);
    expect(req001SourceUpdate!.newSourceReference.contentHash).toBe(v2Hash);

    // REQ-003 should be in updatedRequirements (status changed to retired)
    const req003Update = plan.updatedRequirements.find(
      (u) => u.incoming.requirementId === 'REQ-003'
    );
    expect(req003Update).toBeDefined();
    expect(req003Update!.existing.status).toBe('active');
    expect(req003Update!.incoming.status).toBe('retired');

    // REQ-004 should be in missingIds (absent from V2, still active)
    const req004Missing = plan.missingIds.find(
      (m) => m.requirementId === 'REQ-004'
    );
    expect(req004Missing).toBeDefined();
    expect(req004Missing!.status).toBe('active');

    // REQ-006 should be in newRequirements
    const req006New = plan.newRequirements.find(
      (n) => n.requirementId === 'REQ-006'
    );
    expect(req006New).toBeDefined();

    // === Verify saved registry state ===
    registry = loadRequirementRegistry(registryPath);

    // === A. EXPLICIT ID SET VERIFICATION ===
    // After V2 import, the registry must contain exactly these IDs
    const expectedIds = ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005', 'REQ-006'];
    const actualIds = getAllRequirementIds(registry).sort();
    expect(actualIds).toEqual(expectedIds.sort());

    // REQ-001: active, source updated to V2 hash, NO content history entry
    const req001 = getRequirement(registry, 'REQ-001');
    expect(req001?.status).toBe('active');
    expect(req001?.sourceReference.contentHash).toBe(v2Hash);
    // Source-only update should NOT create a history entry
    expect(req001?.history?.length ?? 0).toBe(0);

    // REQ-002: active, V2 hash, HAS history with previous content
    const req002 = getRequirement(registry, 'REQ-002');
    expect(req002?.status).toBe('active');
    expect(req002?.description).toContain('UPDATED');
    expect(req002?.sourceReference.contentHash).toBe(v2Hash);
    expect(req002?.history).toBeDefined();
    expect(req002!.history!.length).toBeGreaterThanOrEqual(1);

    // === B. EXPLICIT PREVIOUS CONTENT VERIFICATION ===
    // History entry must preserve the actual V1 content fields
    const req002History = req002!.history![0];

    // Verify the actual V1 description (the field that changed)
    expect(req002History.description).toBe(
      'This is the second requirement that will have changed content in V2.'
    );

    // Verify the actual V1 expected result (also changed in V2)
    expect(req002History.expectedResult).toBe(
      'The second requirement works correctly.'
    );

    // Verify the V1 source reference
    expect(req002History.sourceReference.contentHash).toBe(v1Hash);
    expect(req002History.sourceReference.documentId).toBe('test-reqs');

    // Verify other preserved fields
    expect(req002History.title).toBe('Second requirement');
    expect(req002History.status).toBe('active');
    expect(req002History.priority).toBe('medium');

    // REQ-003: retired, HAS history with Active status
    const req003 = getRequirement(registry, 'REQ-003');
    expect(req003?.status).toBe('retired');
    expect(req003?.history).toBeDefined();
    expect(req003!.history!.length).toBeGreaterThanOrEqual(1);
    // Previous Active status should be in history
    expect(req003!.history![0].status).toBe('active');

    // REQ-004: still Active in registry, NOT retired or deleted
    // (reported as missing, not auto-modified)
    const req004 = getRequirement(registry, 'REQ-004');
    expect(req004?.status).toBe('active');
    // Still points to V1 hash since it wasn't in V2
    expect(req004?.sourceReference.contentHash).toBe(v1Hash);

    // REQ-005: still unresolved (not actionable)
    const req005 = getRequirement(registry, 'REQ-005');
    expect(req005?.status).toBe('active');
    expect(req005?.unresolved).toBeDefined();
    expect(req005?.unresolved?.reason).toContain('does not define');

    // REQ-006: new, active
    const req006 = getRequirement(registry, 'REQ-006');
    expect(req006?.status).toBe('active');
    expect(req006?.sourceReference.contentHash).toBe(v2Hash);
    expect(req006?.history?.length ?? 0).toBe(0);

    // === Re-importing V2 should produce no changes ===
    const v2ReimportResult = importRequirements(projectId, {
      documentId: 'test-reqs',
      contentHash: v2Hash,
      projectServiceOptions: { projectDataRoot: tempDir },
    });
    expect(v2ReimportResult.success).toBe(true);
    expect(v2ReimportResult.stats?.new).toBe(0);
    expect(v2ReimportResult.stats?.updated).toBe(0);
    expect(v2ReimportResult.stats?.sourceUpdated).toBe(0);
    // All imported requirements should be unchanged
    expect(v2ReimportResult.stats?.unchanged).toBe(5); // REQ-001,002,003,005,006

    // No new history entries should have been created
    const registryAfterReimport = loadRequirementRegistry(registryPath);
    const req002AfterReimport = getRequirement(registryAfterReimport, 'REQ-002');
    expect(req002AfterReimport!.history!.length).toBe(req002!.history!.length);

    // === A. EXPLICIT ID SET VERIFICATION AFTER RE-IMPORT ===
    // The ID set must remain unchanged after re-importing V2
    const idsAfterReimport = getAllRequirementIds(registryAfterReimport).sort();
    expect(idsAfterReimport).toEqual(expectedIds.sort());
  });

  it('should handle negative case - malformed requirement ID', () => {
    // Create a document with invalid requirement ID
    const invalidContent = `# Invalid Requirements

## req-001: Lowercase ID

Status: Active
Priority: High

### Description

This has an invalid lowercase ID.

### Expected result

Should fail validation.
`;

    // Create project first
    createProject(
      {
        projectId: 'invalid-test',
        name: 'Invalid Test Project',
        baseUrl: 'https://example.com',
        environment: 'development',
        allowedDomains: ['example.com'],
        testDirectory: 'tests',
        artifactDirectory: 'artifacts',
        documents: [
          {
            documentId: 'invalid-reqs',
            sourcePath: 'docs/invalid.md',
            format: 'markdown',
          },
        ],
      },
      { projectDataRoot: tempDir }
    );

    const workspace = join(tempDir, 'invalid-test');

    // Create docs directory inside workspace and write content
    mkdirSync(join(workspace, 'docs'), { recursive: true });
    writeFileSync(join(workspace, 'docs', 'invalid.md'), invalidContent, 'utf-8');

    const ingestResult = ingestDocument(
      { documentId: 'invalid-reqs', sourcePath: 'docs/invalid.md' },
      { workspace }
    );

    const importResult = importRequirements('invalid-test', {
      documentId: 'invalid-reqs',
      contentHash: ingestResult.version.contentHash,
      projectServiceOptions: { projectDataRoot: tempDir },
    });

    // Import should fail due to invalid ID format
    expect(importResult.success).toBe(false);
    expect(importResult.error?.code).toBe('PARSE_ERRORS');
  });
});
