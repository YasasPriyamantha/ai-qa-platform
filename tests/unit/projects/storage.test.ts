/**
 * Tests for project storage layout utilities
 */

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  PROJECT_DIRECTORIES,
  PROJECT_FILES,
  getProjectStoragePaths,
  getDocumentSnapshotPath,
  getRelativeSnapshotPath,
  getProposalPath,
  resolveDocumentSnapshotPath,
} from '../../../src/projects/storage.js';

describe('PROJECT_DIRECTORIES', () => {
  it('should define standard directory names', () => {
    expect(PROJECT_DIRECTORIES.DOCUMENTS).toBe('documents');
    expect(PROJECT_DIRECTORIES.DOCUMENT_SOURCES).toBe('sources');
    expect(PROJECT_DIRECTORIES.REQUIREMENTS).toBe('requirements');
    expect(PROJECT_DIRECTORIES.PROPOSALS).toBe('proposals');
    expect(PROJECT_DIRECTORIES.TESTS_APPROVED).toBe('tests/approved');
    expect(PROJECT_DIRECTORIES.TESTS_CANDIDATES).toBe('tests/candidates');
    expect(PROJECT_DIRECTORIES.ARTIFACTS).toBe('artifacts');
  });
});

describe('PROJECT_FILES', () => {
  it('should define standard file names', () => {
    expect(PROJECT_FILES.PROJECT_CONFIG).toBe('project.config.json');
    expect(PROJECT_FILES.DOCUMENTS_REGISTRY).toBe('documents.json');
    expect(PROJECT_FILES.REQUIREMENTS_REGISTRY).toBe('registry.json');
  });
});

describe('getProjectStoragePaths', () => {
  it('should compute all storage paths for a workspace', () => {
    const workspace = '/projects/saucedemo';
    const paths = getProjectStoragePaths(workspace);

    expect(paths.workspace).toBe('/projects/saucedemo');
    expect(paths.documentsDir).toBe(join('/projects/saucedemo', 'documents'));
    expect(paths.documentSourcesDir).toBe(join('/projects/saucedemo', 'documents', 'sources'));
    expect(paths.documentsRegistryPath).toBe(join('/projects/saucedemo', 'documents', 'documents.json'));
    expect(paths.requirementsDir).toBe(join('/projects/saucedemo', 'requirements'));
    expect(paths.requirementsRegistryPath).toBe(join('/projects/saucedemo', 'requirements', 'registry.json'));
    expect(paths.proposalsDir).toBe(join('/projects/saucedemo', 'requirements', 'proposals'));
  });

  it('should handle Windows-style paths', () => {
    const workspace = 'D:\\projects\\myapp';
    const paths = getProjectStoragePaths(workspace);

    expect(paths.workspace).toBe('D:\\projects\\myapp');
    expect(paths.documentsDir).toBe(join('D:\\projects\\myapp', 'documents'));
    expect(paths.requirementsDir).toBe(join('D:\\projects\\myapp', 'requirements'));
  });
});

describe('getDocumentSnapshotPath', () => {
  it('should compute absolute snapshot path', () => {
    const sourcesDir = '/projects/saucedemo/documents/sources';
    const hash = 'abc123def456';
    const ext = '.md';

    const path = getDocumentSnapshotPath(sourcesDir, hash, ext);

    expect(path).toBe(join('/projects/saucedemo/documents/sources', 'abc123def456.md'));
  });

  it('should handle different extensions', () => {
    const sourcesDir = '/projects/saucedemo/documents/sources';
    const hash = 'xyz789';

    expect(getDocumentSnapshotPath(sourcesDir, hash, '.txt')).toBe(
      join('/projects/saucedemo/documents/sources', 'xyz789.txt')
    );
    expect(getDocumentSnapshotPath(sourcesDir, hash, '.md')).toBe(
      join('/projects/saucedemo/documents/sources', 'xyz789.md')
    );
  });
});

describe('getRelativeSnapshotPath', () => {
  it('should compute relative snapshot path', () => {
    const hash = 'abc123def456';
    const ext = '.md';

    const path = getRelativeSnapshotPath(hash, ext);

    expect(path).toBe('sources/abc123def456.md');
  });

  it('should handle different extensions', () => {
    expect(getRelativeSnapshotPath('xyz', '.txt')).toBe('sources/xyz.txt');
    expect(getRelativeSnapshotPath('xyz', '.md')).toBe('sources/xyz.md');
  });
});

describe('getProposalPath', () => {
  it('should compute proposal file path', () => {
    const proposalsDir = '/projects/saucedemo/requirements/proposals';
    const proposalId = 'proposal-2026-01-15-login';

    const path = getProposalPath(proposalsDir, proposalId);

    expect(path).toBe(join('/projects/saucedemo/requirements/proposals', 'proposal-2026-01-15-login.json'));
  });

  it('should handle various proposal ID formats', () => {
    const proposalsDir = '/projects/test/requirements/proposals';

    expect(getProposalPath(proposalsDir, 'p1')).toBe(
      join('/projects/test/requirements/proposals', 'p1.json')
    );
    expect(getProposalPath(proposalsDir, 'proposal-abc-123')).toBe(
      join('/projects/test/requirements/proposals', 'proposal-abc-123.json')
    );
  });
});

describe('resolveDocumentSnapshotPath', () => {
  const documentsDir = process.platform === 'win32'
    ? 'D:\\projects\\myapp\\documents'
    : '/projects/myapp/documents';

  describe('valid paths', () => {
    it('should resolve a standard snapshotPath', () => {
      const snapshotPath = 'sources/abc123def456.md';
      const result = resolveDocumentSnapshotPath(snapshotPath, documentsDir);

      expect(result.isContained).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.absolutePath).toBe(join(documentsDir, snapshotPath));
    });

    it('should resolve a .txt snapshot path', () => {
      const snapshotPath = 'sources/xyz789.txt';
      const result = resolveDocumentSnapshotPath(snapshotPath, documentsDir);

      expect(result.isContained).toBe(true);
      expect(result.absolutePath).toBe(join(documentsDir, 'sources', 'xyz789.txt'));
    });

    it('should handle Windows-style documentsDir', () => {
      const winDocsDir = 'C:\\Users\\dev\\project\\documents';
      const snapshotPath = 'sources/abc123.md';
      const result = resolveDocumentSnapshotPath(snapshotPath, winDocsDir);

      expect(result.isContained).toBe(true);
      expect(result.absolutePath).toBe(join(winDocsDir, snapshotPath));
    });
  });

  describe('invalid paths', () => {
    it('should reject empty snapshotPath', () => {
      const result = resolveDocumentSnapshotPath('', documentsDir);

      expect(result.isContained).toBe(false);
      expect(result.error).toContain('non-empty string');
    });

    it('should reject null/undefined snapshotPath', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = resolveDocumentSnapshotPath(null as any, documentsDir);

      expect(result.isContained).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject absolute paths (Unix)', () => {
      const result = resolveDocumentSnapshotPath('/etc/passwd', documentsDir);

      expect(result.isContained).toBe(false);
      expect(result.error).toContain('must be relative');
    });

    it('should reject absolute paths (Windows)', () => {
      const result = resolveDocumentSnapshotPath('C:\\Windows\\System32\\config', documentsDir);

      expect(result.isContained).toBe(false);
      expect(result.error).toContain('must be relative');
    });

    it('should reject path traversal via ../', () => {
      const result = resolveDocumentSnapshotPath('../../../etc/passwd', documentsDir);

      expect(result.isContained).toBe(false);
      expect(result.error).toContain('escapes');
    });

    it('should reject sneaky path traversal', () => {
      const result = resolveDocumentSnapshotPath('sources/../../../secrets.txt', documentsDir);

      expect(result.isContained).toBe(false);
      expect(result.error).toContain('escapes');
    });
  });

  describe('edge cases', () => {
    it('should accept path within sources subdirectory', () => {
      const snapshotPath = 'sources/subdir/file.md';
      const result = resolveDocumentSnapshotPath(snapshotPath, documentsDir);

      expect(result.isContained).toBe(true);
    });

    it('should be case-insensitive on Windows-style containment check', () => {
      // This test verifies the containment check handles case correctly
      const lowerDocs = 'd:\\projects\\myapp\\documents';
      const snapshotPath = 'sources/file.md';
      const result = resolveDocumentSnapshotPath(snapshotPath, lowerDocs);

      expect(result.isContained).toBe(true);
    });

    it('should resolve path consistently with getDocumentSnapshotPath', () => {
      const hash = 'abc123def456';
      const ext = '.md';
      const snapshotPath = getRelativeSnapshotPath(hash, ext);
      const sourcesDir = join(documentsDir, 'sources');

      const absoluteFromResolver = resolveDocumentSnapshotPath(snapshotPath, documentsDir).absolutePath;
      const absoluteFromHelper = getDocumentSnapshotPath(sourcesDir, hash, ext);

      expect(absoluteFromResolver).toBe(absoluteFromHelper);
    });
  });
});
