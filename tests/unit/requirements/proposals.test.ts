/**
 * Tests for Task 2.8 - Human Review Boundary (Proposal Service)
 *
 * These tests verify the trust boundary between AI-proposed requirements
 * and the authoritative requirement registry:
 *
 * 1. Proposal creation does NOT create authoritative requirements
 * 2. Valid acceptance creates authoritative requirements
 * 3. Rejection does NOT modify the authoritative registry
 * 4. Invalid acceptance is blocked (validation failures)
 * 5. Duplicate IDs are blocked
 * 6. Retired IDs are blocked
 * 7. Source references remain attached after acceptance
 * 8. Rejected proposals and review metadata remain persisted
 * 9. Proposal ID validation and path safety
 * 10. Edit audit history preservation
 * 11. Acceptance retry safety
 * 12. Final review state enforcement
 * 13. Source reference validation at proposal creation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';

import {
  createProposal,
  loadProposal,
  listProposals,
  acceptProposedRequirement,
  rejectProposedRequirement,
  editProposedRequirement,
  getProposalSummary,
  generateProposalId,
  generateReviewId,
  validateProposalId,
  resolveProposalPathSafely,
  ProposalError,
} from '../../../src/requirements/proposals.js';

import {
  loadRequirementRegistry,
  applyRequirementChange,
} from '../../../src/requirements/registry.js';

import type { DocumentRegistry } from '../../../src/documents/types.js';
import type { ProposedRequirement, SourceReference, UnresolvedMarker } from '../../../src/requirements/types.js';
import type { Phase2ProjectConfig } from '../../../src/projects/phase2-config.js';
import { isActionable } from '../../../src/requirements/validation.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTempDir(): string {
  const dir = join(tmpdir(), `proposal-test-${randomBytes(8).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupTempDir(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createTestProjectConfig(projectId: string): Phase2ProjectConfig {
  return {
    projectId,
    name: 'Test Project',
    baseUrl: 'http://localhost',
    environment: 'local' as const,
    allowedDomains: ['localhost'],
    testDirectory: 'tests/approved',
    artifactDirectory: 'artifacts',
    documents: [
      {
        documentId: 'test-doc',
        sourcePath: 'docs/requirements.md',
        format: 'markdown' as const,
      },
    ],
  };
}

function setupTestProject(tempDir: string, projectId: string): {
  workspace: string;
  projectDataRoot: string;
  contentHash: string;
} {
  const projectDataRoot = join(tempDir, 'project-data');
  const workspace = join(projectDataRoot, projectId);

  // Create project structure
  mkdirSync(join(workspace, 'tests/approved'), { recursive: true });
  mkdirSync(join(workspace, 'artifacts'), { recursive: true });
  mkdirSync(join(workspace, 'documents/sources'), { recursive: true });
  mkdirSync(join(workspace, 'requirements/proposals'), { recursive: true });

  // Create project config
  const config = createTestProjectConfig(projectId);
  writeFileSync(join(workspace, 'project.config.json'), JSON.stringify(config, null, 2));

  // Create a test document snapshot
  const docContent = '# Test Requirements\n\n## REQ-001: Test Requirement\n\nDescription here.';
  const contentHash = createHash('sha256').update(docContent).digest('hex');
  writeFileSync(join(workspace, 'documents/sources', `${contentHash}.md`), docContent);

  // Create document registry
  const docRegistry: DocumentRegistry = {
    schemaVersion: '1.0',
    updatedAt: new Date().toISOString(),
    documents: {
      'test-doc': {
        documentId: 'test-doc',
        name: 'Test Document',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: [
          {
            contentHash,
            snapshotPath: `sources/${contentHash}.md`,
            contentSize: docContent.length,
            ingestedAt: new Date().toISOString(),
            sourcePath: 'docs/requirements.md',
            format: 'markdown',
          },
        ],
      },
    },
  };
  writeFileSync(join(workspace, 'documents/documents.json'), JSON.stringify(docRegistry, null, 2));

  return { workspace, projectDataRoot, contentHash };
}

function createTestProposedRequirement(
  proposedId: string,
  sourceReference: SourceReference,
  options?: {
    expectedResult?: string;
    unresolved?: UnresolvedMarker;
  }
): ProposedRequirement {
  const req: ProposedRequirement = {
    proposedId,
    title: `Test Requirement ${proposedId}`,
    description: 'Test description',
    negativeCases: [],
    priority: 'medium',
    sourceReference,
    role: 'user',
  };

  // Apply options - default is actionable (has expectedResult)
  if (options?.unresolved !== undefined) {
    req.unresolved = options.unresolved;
  }
  if (options?.expectedResult !== undefined) {
    req.expectedResult = options.expectedResult;
  } else if (!options?.unresolved) {
    // Default to having expectedResult for actionable proposals
    req.expectedResult = 'Test expected result';
  }

  return req;
}

/**
 * Create an unresolved proposed requirement (no expectedResult, has unresolved marker)
 */
function createUnresolvedProposedRequirement(
  proposedId: string,
  sourceReference: SourceReference,
  unresolvedReason: string
): ProposedRequirement {
  return createTestProposedRequirement(proposedId, sourceReference, {
    unresolved: { reason: unresolvedReason },
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('Proposal Service - Human Review Boundary', () => {
  let tempDir: string;
  let projectId: string;
  let workspace: string;
  let projectDataRoot: string;
  let contentHash: string;
  let testSourceRef: SourceReference;

  beforeEach(() => {
    tempDir = createTempDir();
    projectId = `test-project-${randomBytes(4).toString('hex')}`;
    const setup = setupTestProject(tempDir, projectId);
    workspace = setup.workspace;
    projectDataRoot = setup.projectDataRoot;
    contentHash = setup.contentHash;

    testSourceRef = {
      documentId: 'test-doc',
      contentHash,
      section: 'REQ-001: Test Requirement',
      lineRange: { start: 3, end: 5 },
    };
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  // ==========================================================================
  // ID Generation Tests (Section 2)
  // ==========================================================================

  describe('ID Generation', () => {
    it('generates unique proposal IDs', () => {
      // This test verifies generateProposalId() creates PROPOSAL file IDs
      // NOT requirement IDs. Proposal IDs are for naming proposal files.
      const id1 = generateProposalId();
      const id2 = generateProposalId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^prop-\d+-[a-f0-9]+$/);
      expect(id2).toMatch(/^prop-\d+-[a-f0-9]+$/);
    });

    it('generates unique review IDs', () => {
      // This test verifies generateReviewId() creates REVIEW record IDs
      // NOT requirement IDs. Review IDs are for tracking review history.
      const id1 = generateReviewId();
      const id2 = generateReviewId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^rev-\d+-[a-f0-9]+$/);
    });
  });

  // ==========================================================================
  // Proposal ID Validation and Path Safety (Section 3)
  // ==========================================================================

  describe('Proposal ID Validation and Path Safety', () => {
    it('rejects empty proposal ID', () => {
      const result = validateProposalId('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('rejects proposal ID with forward slash', () => {
      const result = validateProposalId('prop/123');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('path separator');
    });

    it('rejects proposal ID with backslash', () => {
      const result = validateProposalId('prop\\123');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('path separator');
    });

    it('rejects proposal ID with path traversal (..)', () => {
      const result = validateProposalId('..');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('rejects proposal ID containing traversal sequence', () => {
      const result = validateProposalId('prop-...-test');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('rejects Windows reserved name CON', () => {
      const result = validateProposalId('con');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reserved Windows name');
    });

    it('rejects Windows reserved name PRN', () => {
      const result = validateProposalId('prn');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reserved Windows name');
    });

    it('rejects Windows reserved name COM1', () => {
      const result = validateProposalId('com1');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reserved Windows name');
    });

    it('rejects Windows reserved name LPT1', () => {
      const result = validateProposalId('lpt1');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('reserved Windows name');
    });

    it('rejects proposal ID starting with dot', () => {
      const result = validateProposalId('.hidden');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dot');
    });

    it('rejects proposal ID with invalid filesystem characters', () => {
      const result = validateProposalId('prop<test>');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('invalid filesystem character');
    });

    it('accepts valid proposal ID', () => {
      const result = validateProposalId('prop-1699543210123-a1b2c3d4');
      expect(result.valid).toBe(true);
    });

    it('resolveProposalPathSafely throws for invalid ID', () => {
      const proposalsDir = join(workspace, 'requirements/proposals');

      expect(() => {
        resolveProposalPathSafely(proposalsDir, '../escape');
      }).toThrow(ProposalError);
    });

    it('resolveProposalPathSafely returns contained path for valid ID', () => {
      const proposalsDir = join(workspace, 'requirements/proposals');
      const path = resolveProposalPathSafely(proposalsDir, 'valid-id');

      expect(path).toContain(proposalsDir);
      expect(path).toContain('valid-id.json');
    });

    it('createProposal rejects invalid proposal ID', () => {
      const proposedReq = createTestProposedRequirement('REQ-001', testSourceRef);

      const result = createProposal(projectId, {
        proposalId: '../escape',
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('INVALID_PROPOSAL_ID');
    });

    it('loadProposal rejects invalid proposal ID', () => {
      expect(() => {
        loadProposal(projectId, '../escape', {
          projectServiceOptions: { projectDataRoot },
        });
      }).toThrow(ProposalError);
    });
  });

  // ==========================================================================
  // Trust Boundary Tests
  // ==========================================================================

  describe('Proposal Creation - Trust Boundary', () => {
    it('creating a proposal does NOT create authoritative requirements', () => {
      const proposedReq = createTestProposedRequirement('REQ-001', testSourceRef);

      const result = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(result.success).toBe(true);
      expect(result.proposalId).toBeDefined();

      // Verify authoritative registry is EMPTY
      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      expect(Object.keys(registry.requirements)).toHaveLength(0);

      // Verify proposal was created
      const proposal = loadProposal(projectId, result.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });
      expect(proposal.proposedRequirements).toHaveLength(1);
      expect(proposal.proposedRequirements[0].individualStatus).toBe('pending');
      expect(proposal.createdBy).toBe('test-user');
    });

    it('proposal contains all source reference information', () => {
      const proposedReq = createTestProposedRequirement('REQ-002', testSourceRef);

      const result = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(result.success).toBe(true);

      const proposal = loadProposal(projectId, result.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      expect(proposal.sourceDocumentId).toBe('test-doc');
      expect(proposal.sourceContentHash).toBe(contentHash);

      const propReq = proposal.proposedRequirements[0];
      expect(propReq.sourceReference.documentId).toBe('test-doc');
      expect(propReq.sourceReference.contentHash).toBe(contentHash);
      expect(propReq.sourceReference.section).toBe('REQ-001: Test Requirement');
      expect(propReq.sourceReference.lineRange).toEqual({ start: 3, end: 5 });
    });
  });

  // ==========================================================================
  // Acceptance Tests
  // ==========================================================================

  describe('Proposal Acceptance - Valid Cases', () => {
    it('accepting a valid proposal creates authoritative requirement', () => {
      const proposedReq = createTestProposedRequirement('REQ-001', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(createResult.success).toBe(true);

      const acceptResult = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-001',
        {
          reviewer: 'test-user',
          reason: 'Looks good',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(acceptResult.success).toBe(true);
      expect(acceptResult.requirementId).toBe('REQ-001');

      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      expect(Object.keys(registry.requirements)).toHaveLength(1);

      const authReq = registry.requirements['REQ-001'];
      expect(authReq).toBeDefined();
      expect(authReq.requirementId).toBe('REQ-001');
      expect(authReq.title).toBe('Test Requirement REQ-001');
      expect(authReq.status).toBe('active');
    });

    it('source references remain attached after acceptance', () => {
      const proposedReq = createTestProposedRequirement('REQ-003', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      const acceptResult = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-003',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(acceptResult.success).toBe(true);

      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      const authReq = registry.requirements['REQ-003'];

      expect(authReq.sourceReference).toBeDefined();
      expect(authReq.sourceReference.documentId).toBe('test-doc');
      expect(authReq.sourceReference.contentHash).toBe(contentHash);
      expect(authReq.sourceReference.section).toBe('REQ-001: Test Requirement');
      expect(authReq.sourceReference.lineRange).toEqual({ start: 3, end: 5 });
    });

    it('acceptance updates proposal status and records review', () => {
      const proposedReq = createTestProposedRequirement('REQ-004', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-004',
        {
          reviewer: 'test-reviewer',
          reason: 'Approved after review',
          projectServiceOptions: { projectDataRoot },
        }
      );

      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      expect(proposal.status).toBe('accepted');
      expect(proposal.proposedRequirements[0].individualStatus).toBe('accepted');
      expect(proposal.proposedRequirements[0].acceptedRequirementId).toBe('REQ-004');
      expect(proposal.proposedRequirements[0].reviews).toHaveLength(1);
      expect(proposal.proposedRequirements[0].reviews[0].reviewer).toBe('test-reviewer');
      expect(proposal.proposedRequirements[0].reviews[0].action).toBe('accept');
    });
  });

  // ==========================================================================
  // Rejection Tests
  // ==========================================================================

  describe('Proposal Rejection - Trust Boundary', () => {
    it('rejecting a proposal does NOT modify authoritative registry', () => {
      const proposedReq = createTestProposedRequirement('REQ-005', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      const rejectResult = rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-005',
        {
          reviewer: 'test-user',
          reason: 'Does not meet requirements',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(rejectResult.success).toBe(true);

      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      expect(Object.keys(registry.requirements)).toHaveLength(0);
    });

    it('rejected proposals preserve evidence and review metadata', () => {
      const proposedReq = createTestProposedRequirement('REQ-006', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-006',
        {
          reviewer: 'senior-reviewer',
          reason: 'Requirement is too vague, needs clarification',
          projectServiceOptions: { projectDataRoot },
        }
      );

      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      expect(proposal.status).toBe('rejected');
      expect(proposal.proposedRequirements[0].individualStatus).toBe('rejected');
      expect(proposal.proposedRequirements[0].reviews).toHaveLength(1);

      const review = proposal.proposedRequirements[0].reviews[0];
      expect(review.reviewer).toBe('senior-reviewer');
      expect(review.action).toBe('reject');
      expect(review.reason).toBe('Requirement is too vague, needs clarification');
      expect(review.reviewedAt).toBeDefined();
      expect(review.reviewId).toBeDefined();

      expect(proposal.sourceDocumentId).toBe('test-doc');
      expect(proposal.sourceContentHash).toBe(contentHash);
    });

    it('rejected proposals remain retrievable', () => {
      const proposedReq = createTestProposedRequirement('REQ-007', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-007',
        {
          reviewer: 'reviewer',
          reason: 'Rejected',
          projectServiceOptions: { projectDataRoot },
        }
      );

      const proposals = listProposals(projectId, {
        projectServiceOptions: { projectDataRoot },
      });
      expect(proposals).toContain(createResult.proposalId);

      const summary = getProposalSummary(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });
      expect(summary.status).toBe('rejected');
      expect(summary.counts.rejected).toBe(1);
    });
  });

  // ==========================================================================
  // Invalid Acceptance Tests
  // ==========================================================================

  describe('Invalid Acceptance - Validation Failures', () => {
    it('acceptance fails for invalid requirement ID format', () => {
      const proposedReq: ProposedRequirement = {
        proposedId: 'req-invalid',
        title: 'Invalid Requirement',
        description: 'Test',
        expectedResult: 'Test',
        negativeCases: [],
        priority: 'medium',
        sourceReference: testSourceRef,
      };

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      const acceptResult = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'req-invalid',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(acceptResult.success).toBe(false);
      expect(acceptResult.error?.code).toBe('VALIDATION_FAILED');
      expect(acceptResult.validationErrors).toBeDefined();

      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      expect(Object.keys(registry.requirements)).toHaveLength(0);
    });

    it('creation fails for missing expected result without unresolved marker', () => {
      // Per new validation: proposals must have either expectedResult or unresolved marker
      // This test verifies creation-time rejection (not acceptance-time)
      const proposedReq: ProposedRequirement = {
        proposedId: 'REQ-100',
        title: 'Missing Expected Result',
        description: 'Test',
        expectedResult: '', // empty string is treated as missing
        negativeCases: [],
        priority: 'medium',
        sourceReference: testSourceRef,
      };

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      // Validation now happens at creation time
      expect(createResult.success).toBe(false);
      expect(createResult.error?.code).toBe('VALIDATION_FAILED');
      expect(createResult.validationErrors?.[0].errors.some((e: string) =>
        e.includes('expectedResult') || e.includes('unresolved')
      )).toBe(true);
    });

    it('acceptance fails for missing proposed ID', () => {
      const proposedReq: ProposedRequirement = {
        proposedId: '',
        title: 'Missing ID',
        description: 'Test',
        expectedResult: 'Test',
        negativeCases: [],
        priority: 'medium',
        sourceReference: testSourceRef,
      };

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      const acceptResult = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        '',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(acceptResult.success).toBe(false);
      expect(acceptResult.error?.code).toBe('VALIDATION_FAILED');
    });
  });

  // ==========================================================================
  // Duplicate ID Tests
  // ==========================================================================

  describe('Duplicate ID Prevention', () => {
    it('acceptance fails if proposed ID already exists in registry', () => {
      const firstReq = createTestProposedRequirement('REQ-200', testSourceRef);

      const firstCreateResult = createProposal(projectId, {
        name: 'First Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [firstReq],
        projectServiceOptions: { projectDataRoot },
      });

      const firstAccept = acceptProposedRequirement(
        projectId,
        firstCreateResult.proposalId!,
        'REQ-200',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );
      expect(firstAccept.success).toBe(true);

      const duplicateReq = createTestProposedRequirement('REQ-200', testSourceRef);
      duplicateReq.title = 'Different title'; // Different content

      const secondCreateResult = createProposal(projectId, {
        name: 'Second Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [duplicateReq],
        projectServiceOptions: { projectDataRoot },
      });

      const secondAccept = acceptProposedRequirement(
        projectId,
        secondCreateResult.proposalId!,
        'REQ-200',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(secondAccept.success).toBe(false);
      expect(secondAccept.error?.code).toBe('DUPLICATE_ID');

      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      expect(Object.keys(registry.requirements)).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Retired ID Tests
  // ==========================================================================

  describe('Retired ID Reuse Prevention', () => {
    it('acceptance fails if proposed ID was previously retired', () => {
      const firstReq = createTestProposedRequirement('REQ-300', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'First Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [firstReq],
        projectServiceOptions: { projectDataRoot },
      });

      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-300',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      applyRequirementChange(
        projectId,
        {
          type: 'retire',
          requirementId: 'REQ-300',
          reason: 'No longer needed',
        },
        { projectServiceOptions: { projectDataRoot } }
      );

      const newReq = createTestProposedRequirement('REQ-300', testSourceRef);
      newReq.title = 'Different requirement with same ID';

      const newCreateResult = createProposal(projectId, {
        name: 'New Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [newReq],
        projectServiceOptions: { projectDataRoot },
      });

      const newAccept = acceptProposedRequirement(
        projectId,
        newCreateResult.proposalId!,
        'REQ-300',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(newAccept.success).toBe(false);
      expect(newAccept.error?.code).toBe('RETIRED_ID_REUSE');
      expect(newAccept.error?.message).toContain('retired');

      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      expect(Object.keys(registry.requirements)).toHaveLength(1);
      expect(registry.requirements['REQ-300'].status).toBe('retired');
    });
  });

  // ==========================================================================
  // Edit Audit History Tests (Section 5)
  // ==========================================================================

  describe('Edit Audit History', () => {
    it('edit creates history entry with before-snapshot', () => {
      const proposedReq = createTestProposedRequirement('REQ-400', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      // Edit the proposed requirement
      editProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-400',
        {
          title: 'Updated Title',
          expectedResult: 'Updated expected result',
        },
        {
          editor: 'editor-user',
          reason: 'Clarifying requirement',
          projectServiceOptions: { projectDataRoot },
        }
      );

      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      // Verify edits applied
      expect(proposal.proposedRequirements[0].title).toBe('Updated Title');
      expect(proposal.proposedRequirements[0].expectedResult).toBe('Updated expected result');

      // Verify history entry with before-snapshot
      expect(proposal.proposedRequirements[0].reviews).toHaveLength(1);
      const editReview = proposal.proposedRequirements[0].reviews[0];
      expect(editReview.action).toBe('edit');
      expect(editReview.reviewer).toBe('editor-user');
      expect(editReview.reason).toBe('Clarifying requirement');

      // Verify before-snapshot
      expect(editReview.beforeSnapshot).toBeDefined();
      expect(editReview.beforeSnapshot?.title).toBe('Test Requirement REQ-400');
      expect(editReview.beforeSnapshot?.expectedResult).toBe('Test expected result');
    });

    it('edit history is preserved after acceptance', () => {
      const proposedReq = createTestProposedRequirement('REQ-401', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      // Edit the proposed requirement
      editProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-401',
        { title: 'Edited Title' },
        {
          editor: 'editor-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Accept the requirement
      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-401',
        {
          reviewer: 'reviewer-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Load and verify history is preserved
      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      expect(proposal.proposedRequirements[0].reviews).toHaveLength(2);

      const editReview = proposal.proposedRequirements[0].reviews[0];
      expect(editReview.action).toBe('edit');
      expect(editReview.reviewer).toBe('editor-user');
      expect(editReview.beforeSnapshot?.title).toBe('Test Requirement REQ-401');

      const acceptReview = proposal.proposedRequirements[0].reviews[1];
      expect(acceptReview.action).toBe('accept');
      expect(acceptReview.reviewer).toBe('reviewer-user');
    });

    it('failed edit does not create history entry', () => {
      const proposedReq = createTestProposedRequirement('REQ-402', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      // Accept first so edit will fail
      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-402',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Try to edit - should fail
      expect(() => {
        editProposedRequirement(
          projectId,
          createResult.proposalId!,
          'REQ-402',
          { title: 'Should fail' },
          {
            editor: 'editor-user',
            projectServiceOptions: { projectDataRoot },
          }
        );
      }).toThrow(ProposalError);

      // Verify no additional history entry (only the accept)
      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });
      expect(proposal.proposedRequirements[0].reviews).toHaveLength(1);
      expect(proposal.proposedRequirements[0].reviews[0].action).toBe('accept');
    });
  });

  // ==========================================================================
  // Acceptance Retry Safety Tests (Section 4)
  // ==========================================================================

  describe('Acceptance Retry Safety', () => {
    it('retry succeeds when registry was written but proposal file update failed', () => {
      const proposedReq = createTestProposedRequirement('REQ-500', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      // First, manually create the authoritative requirement using applyRequirementChange
      // This simulates the case where registry was written but proposal update failed
      const now = new Date().toISOString();
      const requirement = {
        projectId,
        requirementId: 'REQ-500',
        title: proposedReq.title,
        description: proposedReq.description,
        expectedResult: proposedReq.expectedResult,
        negativeCases: proposedReq.negativeCases,
        priority: proposedReq.priority,
        status: 'active' as const,
        sourceReference: proposedReq.sourceReference,
        role: proposedReq.role,
        createdAt: now,
        updatedAt: now,
      };

      applyRequirementChange(
        projectId,
        { type: 'register', requirement },
        { projectServiceOptions: { projectDataRoot } }
      );

      // Verify requirement was written
      const checkRegistry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      expect(checkRegistry.requirements['REQ-500']).toBeDefined();

      // Proposal should still be pending (we didn't update it)
      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });
      expect(proposal.proposedRequirements[0].individualStatus).toBe('pending');

      // Retry acceptance - should succeed without duplicate error because
      // the requirement matches exactly
      const retryAccept = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-500',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(retryAccept.success).toBe(true);
      expect(retryAccept.wasRetry).toBe(true);

      // Verify proposal is now accepted
      const updatedProposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });
      expect(updatedProposal.proposedRequirements[0].individualStatus).toBe('accepted');

      // Registry should still have exactly one requirement
      const finalRegistry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      expect(Object.keys(finalRegistry.requirements)).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Source Reference Validation at Creation (Section 7)
  // ==========================================================================

  describe('Source Reference Validation at Creation', () => {
    it('rejects proposal with missing sourceReference', () => {
      // Create a requirement with undefined sourceReference
      const proposedReq = {
        proposedId: 'REQ-600',
        title: 'Missing Source',
        description: 'Test',
        expectedResult: 'Test',
        negativeCases: [],
        priority: 'medium' as const,
        sourceReference: undefined as unknown,
        // sourceReference intentionally missing/undefined
      } as ProposedRequirement;

      const result = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SOURCE_REFERENCE_INVALID');
    });

    it('rejects proposal with undeclared document ID', () => {
      const proposedReq: ProposedRequirement = {
        proposedId: 'REQ-601',
        title: 'Undeclared Doc',
        description: 'Test',
        expectedResult: 'Test',
        negativeCases: [],
        priority: 'medium',
        sourceReference: {
          documentId: 'unknown-doc', // Not in project config
          contentHash,
          section: 'Test',
        },
      };

      const result = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SOURCE_REFERENCE_INVALID');
      // Check that validation errors contain info about the document
      expect(result.validationErrors?.[0].errors.length).toBeGreaterThan(0);
      expect(result.validationErrors?.[0].errors.some((e: string) =>
        e.includes('not declared') || e.includes('unknown-doc')
      )).toBe(true);
    });

    it('rejects proposal with unknown content hash', () => {
      const fakeHash = 'a'.repeat(64);
      const proposedReq: ProposedRequirement = {
        proposedId: 'REQ-602',
        title: 'Unknown Hash',
        description: 'Test',
        expectedResult: 'Test',
        negativeCases: [],
        priority: 'medium',
        sourceReference: {
          documentId: 'test-doc',
          contentHash: fakeHash, // Not in document versions
          section: 'Test',
        },
      };

      const result = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SOURCE_REFERENCE_INVALID');
    });

    it('accepts proposal with valid source reference', () => {
      const proposedReq = createTestProposedRequirement('REQ-603', testSourceRef);

      const result = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Unresolved Proposal Support (Section 2 - Follow-up)
  // ==========================================================================

  describe('Unresolved Proposal Support', () => {
    it('creates unresolved proposal without expectedResult', () => {
      const unresolvedReq = createUnresolvedProposedRequirement(
        'UNRES-001',
        testSourceRef,
        'Business rule is ambiguous - awaiting stakeholder clarification'
      );

      const result = createProposal(projectId, {
        name: 'Unresolved Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [unresolvedReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(result.success).toBe(true);
      expect(result.proposalId).toBeDefined();
    });

    it('accepts unresolved proposal and preserves unresolved marker in registry', () => {
      const unresolvedReq = createUnresolvedProposedRequirement(
        'UNRES-002',
        testSourceRef,
        'Expected behavior not specified in source document'
      );

      const createResult = createProposal(projectId, {
        name: 'Unresolved Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [unresolvedReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(createResult.success).toBe(true);
      expect(createResult.proposalId).toBeDefined();

      const acceptResult = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'UNRES-002',
        {
          reviewer: 'test-reviewer',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(acceptResult.success).toBe(true);
      expect(acceptResult.requirementId).toBe('UNRES-002');

      // Verify the registry contains the unresolved marker
      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      const req = registry.requirements['UNRES-002'];

      expect(req).toBeDefined();
      expect(req.unresolved).toBeDefined();
      expect(req.unresolved?.reason).toBe('Expected behavior not specified in source document');
      expect(req.expectedResult).toBeUndefined();
    });

    it('accepted unresolved requirement is non-actionable', () => {
      const unresolvedReq = createUnresolvedProposedRequirement(
        'UNRES-003',
        testSourceRef,
        'Contradictory requirements in source'
      );

      const createResult = createProposal(projectId, {
        name: 'Unresolved Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [unresolvedReq],
        projectServiceOptions: { projectDataRoot },
      });

      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'UNRES-003',
        {
          reviewer: 'test-reviewer',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Verify requirement is non-actionable
      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      const req = registry.requirements['UNRES-003'];

      expect(isActionable(req)).toBe(false);
    });

    it('rejects proposal without expectedResult AND without unresolved marker', () => {
      // Create a requirement with neither expectedResult nor unresolved
      const invalidReq: ProposedRequirement = {
        proposedId: 'INVALID-001',
        title: 'Invalid Requirement',
        description: 'Has neither expectedResult nor unresolved marker',
        // expectedResult intentionally omitted
        // unresolved intentionally omitted
        negativeCases: [],
        priority: 'medium',
        sourceReference: testSourceRef,
      };

      const result = createProposal(projectId, {
        name: 'Invalid Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [invalidReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_FAILED');
      expect(result.validationErrors?.[0].errors.some((e: string) =>
        e.includes('expectedResult') || e.includes('unresolved')
      )).toBe(true);
    });

    it('rejects proposal with empty unresolved reason', () => {
      const invalidReq: ProposedRequirement = {
        proposedId: 'INVALID-002',
        title: 'Invalid Requirement',
        description: 'Has unresolved marker with empty reason',
        unresolved: { reason: '   ' }, // whitespace-only reason
        negativeCases: [],
        priority: 'medium',
        sourceReference: testSourceRef,
      };

      const result = createProposal(projectId, {
        name: 'Invalid Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [invalidReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(result.success).toBe(false);
      expect(result.validationErrors?.[0].errors.some((e: string) =>
        e.includes('meaningful reason')
      )).toBe(true);
    });

    it('existing actionable proposal creation and acceptance still works', () => {
      // Verify the standard (non-unresolved) flow still works
      const actionableReq = createTestProposedRequirement('ACT-001', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Actionable Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [actionableReq],
        projectServiceOptions: { projectDataRoot },
      });

      expect(createResult.success).toBe(true);

      const acceptResult = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'ACT-001',
        {
          reviewer: 'test-reviewer',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(acceptResult.success).toBe(true);

      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      const req = registry.requirements['ACT-001'];

      expect(req.expectedResult).toBe('Test expected result');
      expect(req.unresolved).toBeUndefined();
      expect(isActionable(req)).toBe(true);
    });

    it('unresolved proposal with expectedResult preserves both on acceptance', () => {
      // Per types.ts: when both expectedResult AND unresolved are present,
      // the requirement is unresolved and the expectedResult is preserved but NOT actionable
      const req = createTestProposedRequirement('BOTH-001', testSourceRef, {
        expectedResult: 'Partial expected behavior',
        unresolved: { reason: 'Need clarification on edge cases' },
      });

      const createResult = createProposal(projectId, {
        name: 'Partial Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req],
        projectServiceOptions: { projectDataRoot },
      });

      expect(createResult.success).toBe(true);

      const acceptResult = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'BOTH-001',
        {
          reviewer: 'test-reviewer',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(acceptResult.success).toBe(true);

      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      const accepted = registry.requirements['BOTH-001'];

      // Both are preserved
      expect(accepted.expectedResult).toBe('Partial expected behavior');
      expect(accepted.unresolved?.reason).toBe('Need clarification on edge cases');

      // But requirement is non-actionable because unresolved takes precedence
      expect(isActionable(accepted)).toBe(false);
    });
  });

  // ==========================================================================
  // Edit Snapshot Completeness
  // ==========================================================================

  describe('Edit Snapshot Completeness', () => {
    it('edit snapshot preserves all mutable fields including optional ones', () => {
      const req = createTestProposedRequirement('SNAP-001', testSourceRef, {
        expectedResult: 'Original expected result',
        unresolved: { reason: 'Original unresolved reason' },
      });
      req.role = 'admin';
      req.originalSourceText = 'Original source text';
      req.confidence = 0.85;
      req.extractionNotes = 'Original notes';

      const createResult = createProposal(projectId, {
        name: 'Snapshot Test',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req],
        projectServiceOptions: { projectDataRoot },
      });

      // Edit multiple fields
      editProposedRequirement(
        projectId,
        createResult.proposalId!,
        'SNAP-001',
        {
          title: 'Updated Title',
          description: 'Updated description',
          expectedResult: 'Updated expected result',
          priority: 'critical',
          role: 'user',
          confidence: 0.95,
        },
        {
          editor: 'editor-user',
          reason: 'Major revision',
          projectServiceOptions: { projectDataRoot },
        }
      );

      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      const editReview = proposal.proposedRequirements[0].reviews[0];
      expect(editReview.action).toBe('edit');
      expect(editReview.beforeSnapshot).toBeDefined();

      // Verify all original values are preserved in snapshot
      const snapshot = editReview.beforeSnapshot!;
      expect(snapshot.title).toBe('Test Requirement SNAP-001');
      expect(snapshot.description).toBe('Test description');
      expect(snapshot.expectedResult).toBe('Original expected result');
      expect(snapshot.priority).toBe('medium');
      expect(snapshot.role).toBe('admin');
      expect(snapshot.unresolved?.reason).toBe('Original unresolved reason');
      expect(snapshot.originalSourceText).toBe('Original source text');
      expect(snapshot.confidence).toBe(0.85);
      expect(snapshot.extractionNotes).toBe('Original notes');
      expect(snapshot.sourceReference).toEqual(testSourceRef);
      expect(snapshot.negativeCases).toEqual([]);
    });

    it('edit snapshot preserves absent optional fields as undefined', () => {
      // Create requirement without optional fields
      const req = createTestProposedRequirement('SNAP-002', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Snapshot Test',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req],
        projectServiceOptions: { projectDataRoot },
      });

      editProposedRequirement(
        projectId,
        createResult.proposalId!,
        'SNAP-002',
        { title: 'Updated Title' },
        {
          editor: 'editor-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      const snapshot = proposal.proposedRequirements[0].reviews[0].beforeSnapshot!;

      // Optional fields should be undefined (not invented)
      expect(snapshot.unresolved).toBeUndefined();
      expect(snapshot.originalSourceText).toBeUndefined();
      expect(snapshot.confidence).toBeUndefined();
      expect(snapshot.extractionNotes).toBeUndefined();
    });

    it('audit history is retrievable after acceptance', () => {
      const req = createTestProposedRequirement('SNAP-003', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Audit Test',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req],
        projectServiceOptions: { projectDataRoot },
      });

      // First edit
      editProposedRequirement(
        projectId,
        createResult.proposalId!,
        'SNAP-003',
        { title: 'First edit' },
        {
          editor: 'editor-1',
          reason: 'First correction',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Second edit
      editProposedRequirement(
        projectId,
        createResult.proposalId!,
        'SNAP-003',
        { title: 'Second edit' },
        {
          editor: 'editor-2',
          reason: 'Second correction',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Accept
      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'SNAP-003',
        {
          reviewer: 'reviewer-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Load and verify full audit history
      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      const reviews = proposal.proposedRequirements[0].reviews;
      expect(reviews).toHaveLength(3);

      // First edit
      expect(reviews[0].action).toBe('edit');
      expect(reviews[0].reviewer).toBe('editor-1');
      expect(reviews[0].beforeSnapshot?.title).toBe('Test Requirement SNAP-003');

      // Second edit
      expect(reviews[1].action).toBe('edit');
      expect(reviews[1].reviewer).toBe('editor-2');
      expect(reviews[1].beforeSnapshot?.title).toBe('First edit');

      // Accept
      expect(reviews[2].action).toBe('accept');
      expect(reviews[2].reviewer).toBe('reviewer-user');
    });
  });

  // ==========================================================================
  // requirementsMatch Comparison Tests
  // ==========================================================================

  describe('requirementsMatch Comparison', () => {
    it('retry fails when existing requirement has different status (retired)', () => {
      const req = createTestProposedRequirement('MATCH-001', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Match Test',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req],
        projectServiceOptions: { projectDataRoot },
      });

      // Accept the requirement first
      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'MATCH-001',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Retire it
      applyRequirementChange(
        projectId,
        {
          type: 'retire',
          requirementId: 'MATCH-001',
          reason: 'No longer needed',
        },
        { projectServiceOptions: { projectDataRoot } }
      );

      // Create new proposal with same ID
      const newReq = createTestProposedRequirement('MATCH-001', testSourceRef);
      const newCreateResult = createProposal(projectId, {
        name: 'New Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [newReq],
        projectServiceOptions: { projectDataRoot },
      });

      // This should fail because the ID is retired (not a retry scenario)
      const result = acceptProposedRequirement(
        projectId,
        newCreateResult.proposalId!,
        'MATCH-001',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RETIRED_ID_REUSE');
    });

    it('retry fails when existing requirement has different unresolved marker', () => {
      // First create and accept an actionable requirement
      const req1 = createTestProposedRequirement('MATCH-002', testSourceRef);

      const create1 = createProposal(projectId, {
        name: 'First',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1],
        projectServiceOptions: { projectDataRoot },
      });

      acceptProposedRequirement(
        projectId,
        create1.proposalId!,
        'MATCH-002',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Now try to "retry" with same ID but unresolved marker
      const unresolvedReq = createUnresolvedProposedRequirement(
        'MATCH-002',
        testSourceRef,
        'Some unresolved reason'
      );

      const create2 = createProposal(projectId, {
        name: 'Second',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [unresolvedReq],
        projectServiceOptions: { projectDataRoot },
      });

      // This should fail because the content differs (unresolved marker mismatch)
      const result = acceptProposedRequirement(
        projectId,
        create2.proposalId!,
        'MATCH-002',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DUPLICATE_ID');
    });

    it('retry fails when existing requirement has different expectedResult', () => {
      const req1 = createTestProposedRequirement('MATCH-003', testSourceRef);

      const create1 = createProposal(projectId, {
        name: 'First',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1],
        projectServiceOptions: { projectDataRoot },
      });

      acceptProposedRequirement(
        projectId,
        create1.proposalId!,
        'MATCH-003',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Create proposal with same ID but different expectedResult
      const req2 = createTestProposedRequirement('MATCH-003', testSourceRef, {
        expectedResult: 'Different expected result',
      });

      const create2 = createProposal(projectId, {
        name: 'Second',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req2],
        projectServiceOptions: { projectDataRoot },
      });

      const result = acceptProposedRequirement(
        projectId,
        create2.proposalId!,
        'MATCH-003',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('DUPLICATE_ID');
    });
  });

  // ==========================================================================
  // Final Review State Enforcement (Section 8)
  // Deterministic error codes per error policy:
  // A. Finished proposal (all requirements processed) → PROPOSAL_FINISHED
  // B. Partially reviewed proposal, target already processed → REQUIREMENT_ALREADY_PROCESSED
  // C. Pending requirement in partially reviewed proposal → allowed
  // ==========================================================================

  describe('Final Review State Enforcement', () => {
    // --- Finished proposal tests (single-requirement) → PROPOSAL_FINISHED ---

    it('accept on finished proposal returns PROPOSAL_FINISHED', () => {
      const proposedReq = createTestProposedRequirement('REQ-700', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      // First acceptance succeeds
      const first = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-700',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );
      expect(first.success).toBe(true);

      // Proposal is now finished (all requirements processed)
      // Second attempt returns exactly PROPOSAL_FINISHED
      const second = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-700',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );
      expect(second.success).toBe(false);
      expect(second.error?.code).toBe('PROPOSAL_FINISHED');
    });

    it('reject on finished proposal returns PROPOSAL_FINISHED', () => {
      const proposedReq = createTestProposedRequirement('REQ-701', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-701',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Proposal is now finished
      const reject = rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-701',
        {
          reviewer: 'test-user',
          reason: 'Changed mind',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(reject.success).toBe(false);
      expect(reject.error?.code).toBe('PROPOSAL_FINISHED');
    });

    it('edit on finished proposal throws PROPOSAL_FINISHED', () => {
      const proposedReq = createTestProposedRequirement('REQ-702', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [proposedReq],
        projectServiceOptions: { projectDataRoot },
      });

      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-702',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Proposal is now finished
      try {
        editProposedRequirement(
          projectId,
          createResult.proposalId!,
          'REQ-702',
          { title: 'Should fail' },
          {
            editor: 'test-user',
            projectServiceOptions: { projectDataRoot },
          }
        );
        expect.fail('Should have thrown ProposalError');
      } catch (err) {
        expect(err).toBeInstanceOf(ProposalError);
        expect((err as ProposalError).code).toBe('PROPOSAL_FINISHED');
      }
    });

    // --- Partially reviewed proposal tests → REQUIREMENT_ALREADY_PROCESSED ---

    it('accepting already-accepted requirement in partial proposal returns REQUIREMENT_ALREADY_PROCESSED', () => {
      const req1 = createTestProposedRequirement('REQ-710', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-711', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Multi Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1, req2],
        projectServiceOptions: { projectDataRoot },
      });

      // Accept first requirement (proposal still pending because req2 is pending)
      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-710',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Try to re-accept first requirement → REQUIREMENT_ALREADY_PROCESSED
      const reAccept = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-710',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(reAccept.success).toBe(false);
      expect(reAccept.error?.code).toBe('REQUIREMENT_ALREADY_PROCESSED');
    });

    it('rejecting already-accepted requirement in partial proposal returns REQUIREMENT_ALREADY_PROCESSED', () => {
      const req1 = createTestProposedRequirement('REQ-712', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-713', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Multi Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1, req2],
        projectServiceOptions: { projectDataRoot },
      });

      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-712',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Try to reject the already-accepted requirement → REQUIREMENT_ALREADY_PROCESSED
      const reject = rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-712',
        {
          reviewer: 'test-user',
          reason: 'Changed mind',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(reject.success).toBe(false);
      expect(reject.error?.code).toBe('REQUIREMENT_ALREADY_PROCESSED');
    });

    it('accepting already-rejected requirement in partial proposal returns REQUIREMENT_ALREADY_PROCESSED', () => {
      const req1 = createTestProposedRequirement('REQ-714', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-715', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Multi Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1, req2],
        projectServiceOptions: { projectDataRoot },
      });

      rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-714',
        {
          reviewer: 'test-user',
          reason: 'Not needed',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Try to accept the already-rejected requirement → REQUIREMENT_ALREADY_PROCESSED
      const accept = acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-714',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(accept.success).toBe(false);
      expect(accept.error?.code).toBe('REQUIREMENT_ALREADY_PROCESSED');
    });

    it('rejecting already-rejected requirement in partial proposal returns REQUIREMENT_ALREADY_PROCESSED', () => {
      const req1 = createTestProposedRequirement('REQ-716', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-717', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Multi Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1, req2],
        projectServiceOptions: { projectDataRoot },
      });

      rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-716',
        {
          reviewer: 'test-user',
          reason: 'Not needed',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Try to reject again → REQUIREMENT_ALREADY_PROCESSED
      const reReject = rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-716',
        {
          reviewer: 'test-user',
          reason: 'Double rejection',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(reReject.success).toBe(false);
      expect(reReject.error?.code).toBe('REQUIREMENT_ALREADY_PROCESSED');
    });

    it('editing already-accepted requirement in partial proposal throws REQUIREMENT_ALREADY_PROCESSED', () => {
      const req1 = createTestProposedRequirement('REQ-718', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-719', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Multi Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1, req2],
        projectServiceOptions: { projectDataRoot },
      });

      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-718',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Try to edit the already-accepted requirement → REQUIREMENT_ALREADY_PROCESSED
      try {
        editProposedRequirement(
          projectId,
          createResult.proposalId!,
          'REQ-718',
          { title: 'Should fail' },
          {
            editor: 'test-user',
            projectServiceOptions: { projectDataRoot },
          }
        );
        expect.fail('Should have thrown ProposalError');
      } catch (err) {
        expect(err).toBeInstanceOf(ProposalError);
        expect((err as ProposalError).code).toBe('REQUIREMENT_ALREADY_PROCESSED');
      }
    });

    it('editing already-rejected requirement in partial proposal throws REQUIREMENT_ALREADY_PROCESSED', () => {
      const req1 = createTestProposedRequirement('REQ-720', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-721', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Multi Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1, req2],
        projectServiceOptions: { projectDataRoot },
      });

      rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-720',
        {
          reviewer: 'test-user',
          reason: 'Not needed',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Try to edit the already-rejected requirement → REQUIREMENT_ALREADY_PROCESSED
      try {
        editProposedRequirement(
          projectId,
          createResult.proposalId!,
          'REQ-720',
          { title: 'Should fail' },
          {
            editor: 'test-user',
            projectServiceOptions: { projectDataRoot },
          }
        );
        expect.fail('Should have thrown ProposalError');
      } catch (err) {
        expect(err).toBeInstanceOf(ProposalError);
        expect((err as ProposalError).code).toBe('REQUIREMENT_ALREADY_PROCESSED');
      }
    });

    // --- Pending requirement in partial proposal → allowed ---

    it('successfully reviews pending requirement when another is already processed', () => {
      const req1 = createTestProposedRequirement('REQ-730', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-731', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Multi Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1, req2],
        projectServiceOptions: { projectDataRoot },
      });

      // Accept first requirement
      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-730',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Can still reject second (pending) requirement
      const reject = rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-731',
        {
          reviewer: 'test-user',
          reason: 'Not needed',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(reject.success).toBe(true);

      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      expect(proposal.proposedRequirements[0].individualStatus).toBe('accepted');
      expect(proposal.proposedRequirements[1].individualStatus).toBe('rejected');
    });

    it('successfully edits pending requirement when another is already processed', () => {
      const req1 = createTestProposedRequirement('REQ-732', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-733', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Multi Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1, req2],
        projectServiceOptions: { projectDataRoot },
      });

      // Accept first requirement
      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-732',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      // Can still edit second (pending) requirement
      const updated = editProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-733',
        { title: 'Updated pending requirement' },
        {
          editor: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      expect(updated.proposedRequirements[1].title).toBe('Updated pending requirement');
      expect(updated.proposedRequirements[1].reviews).toHaveLength(1);
      expect(updated.proposedRequirements[1].reviews[0].action).toBe('edit');
    });
  });

  // ==========================================================================
  // Multiple Requirements in Proposal
  // ==========================================================================

  describe('Multiple Requirements in Proposal', () => {
    it('handles partial acceptance (some accepted, some rejected)', () => {
      const req1 = createTestProposedRequirement('REQ-800', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-801', testSourceRef);
      const req3 = createTestProposedRequirement('REQ-802', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Multi Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1, req2, req3],
        projectServiceOptions: { projectDataRoot },
      });

      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-800',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-801',
        {
          reviewer: 'test-user',
          reason: 'Not needed',
          projectServiceOptions: { projectDataRoot },
        }
      );

      const summary = getProposalSummary(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      expect(summary.counts.total).toBe(3);
      expect(summary.counts.accepted).toBe(1);
      expect(summary.counts.rejected).toBe(1);
      expect(summary.counts.pending).toBe(1);
      expect(summary.status).toBe('pending');

      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      expect(Object.keys(registry.requirements)).toHaveLength(1);
      expect(registry.requirements['REQ-800']).toBeDefined();
      expect(registry.requirements['REQ-801']).toBeUndefined();
    });

    it('updates proposal status to accepted when all requirements processed with some accepts', () => {
      const req1 = createTestProposedRequirement('REQ-803', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-804', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1, req2],
        projectServiceOptions: { projectDataRoot },
      });

      acceptProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-803',
        {
          reviewer: 'test-user',
          projectServiceOptions: { projectDataRoot },
        }
      );

      rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-804',
        {
          reviewer: 'test-user',
          reason: 'Rejected',
          projectServiceOptions: { projectDataRoot },
        }
      );

      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      expect(proposal.status).toBe('accepted');
    });

    it('updates proposal status to rejected when all requirements are rejected', () => {
      const req1 = createTestProposedRequirement('REQ-805', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-806', testSourceRef);

      const createResult = createProposal(projectId, {
        name: 'Test Proposal',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1, req2],
        projectServiceOptions: { projectDataRoot },
      });

      rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-805',
        {
          reviewer: 'test-user',
          reason: 'Rejected',
          projectServiceOptions: { projectDataRoot },
        }
      );

      rejectProposedRequirement(
        projectId,
        createResult.proposalId!,
        'REQ-806',
        {
          reviewer: 'test-user',
          reason: 'Also rejected',
          projectServiceOptions: { projectDataRoot },
        }
      );

      const proposal = loadProposal(projectId, createResult.proposalId!, {
        projectServiceOptions: { projectDataRoot },
      });

      expect(proposal.status).toBe('rejected');

      const registry = loadRequirementRegistry(
        join(workspace, 'requirements/registry.json')
      );
      expect(Object.keys(registry.requirements)).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Proposal Listing
  // ==========================================================================

  describe('Proposal Listing', () => {
    it('lists all proposals for a project', () => {
      const req1 = createTestProposedRequirement('REQ-900', testSourceRef);
      const req2 = createTestProposedRequirement('REQ-901', testSourceRef);

      const create1 = createProposal(projectId, {
        name: 'Proposal 1',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req1],
        projectServiceOptions: { projectDataRoot },
      });

      const create2 = createProposal(projectId, {
        name: 'Proposal 2',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [req2],
        projectServiceOptions: { projectDataRoot },
      });

      const proposals = listProposals(projectId, {
        projectServiceOptions: { projectDataRoot },
      });

      expect(proposals).toContain(create1.proposalId);
      expect(proposals).toContain(create2.proposalId);
      expect(proposals).toHaveLength(2);
    });

    it('returns empty array for project with no proposals', () => {
      const proposals = listProposals(projectId, {
        projectServiceOptions: { projectDataRoot },
      });

      expect(proposals).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('Error Handling', () => {
    it('fails gracefully for non-existent proposal', () => {
      expect(() => {
        loadProposal(projectId, 'non-existent-proposal', {
          projectServiceOptions: { projectDataRoot },
        });
      }).toThrow(ProposalError);
    });

    it('fails gracefully for non-existent project', () => {
      const result = createProposal('non-existent-project', {
        name: 'Test',
        createdBy: 'test-user',
        sourceDocumentId: 'test-doc',
        sourceContentHash: contentHash,
        proposedRequirements: [],
        projectServiceOptions: { projectDataRoot },
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PROJECT_LOAD_FAILED');
    });
  });
});
