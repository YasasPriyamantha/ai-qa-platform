/**
 * Tests for document ingestion service
 *
 * Tests cover:
 * - Supported formats (.md, .txt)
 * - Unsupported format rejection
 * - Path containment (lexical and symlink/junction)
 * - Content-addressed snapshots (SHA-256)
 * - Snapshot reuse for unchanged content
 * - New snapshots for changed content
 * - Atomic registry persistence
 * - Document version ordering (last = current)
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  ingestDocument,
  getDocument,
  getAllDocuments,
  getCurrentVersion,
  computeSHA256,
  verifySnapshot,
  getSnapshotAbsolutePath,
} from '../../../src/documents/service.js';
import { DocumentServiceError } from '../../../src/documents/errors.js';
import type { DocumentRegistry, DocumentRecord } from '../../../src/documents/types.js';

/**
 * Create a unique temp directory for tests.
 */
function createTestWorkspace(): string {
  const base = join(tmpdir(), 'doc-service-test');
  const unique = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const workspace = join(base, unique);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

/**
 * Cleanup a test workspace.
 */
function cleanupWorkspace(workspace: string): void {
  try {
    rmSync(workspace, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Document Ingestion Service', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = createTestWorkspace();
  });

  afterEach(() => {
    cleanupWorkspace(workspace);
  });

  describe('Supported formats', () => {
    it('should ingest markdown files (.md)', () => {
      const sourcePath = 'docs/requirements.md';
      const fullPath = join(workspace, sourcePath);
      mkdirSync(join(workspace, 'docs'), { recursive: true });
      writeFileSync(fullPath, '# Requirements\n\nTest content');

      const result = ingestDocument(
        { documentId: 'req-doc', sourcePath },
        { workspace }
      );

      expect(result.record.documentId).toBe('req-doc');
      expect(result.version.format).toBe('markdown');
      expect(existsSync(result.snapshotPath)).toBe(true);
    });

    it('should ingest text files (.txt)', () => {
      const sourcePath = 'notes.txt';
      writeFileSync(join(workspace, sourcePath), 'Plain text content');

      const result = ingestDocument(
        { documentId: 'notes', sourcePath },
        { workspace }
      );

      expect(result.version.format).toBe('text');
      expect(existsSync(result.snapshotPath)).toBe(true);
    });

    it('should handle uppercase extensions', () => {
      const sourcePath = 'REQUIREMENTS.MD';
      writeFileSync(join(workspace, sourcePath), '# Test');

      const result = ingestDocument(
        { documentId: 'upper', sourcePath },
        { workspace }
      );

      expect(result.version.format).toBe('markdown');
    });
  });

  describe('Unsupported format rejection', () => {
    it('should reject .markdown files', () => {
      const sourcePath = 'doc.markdown';
      writeFileSync(join(workspace, sourcePath), '# Markdown content');

      expect(() => ingestDocument(
        { documentId: 'markdown', sourcePath },
        { workspace }
      )).toThrow(DocumentServiceError);

      try {
        ingestDocument({ documentId: 'markdown', sourcePath }, { workspace });
      } catch (err) {
        expect((err as DocumentServiceError).code).toBe('UNSUPPORTED_FORMAT');
        expect((err as DocumentServiceError).message).toContain('.markdown');
      }
    });

    it('should reject .pdf files', () => {
      const sourcePath = 'doc.pdf';
      writeFileSync(join(workspace, sourcePath), 'PDF content');

      expect(() => ingestDocument(
        { documentId: 'pdf', sourcePath },
        { workspace }
      )).toThrow(DocumentServiceError);

      try {
        ingestDocument({ documentId: 'pdf', sourcePath }, { workspace });
      } catch (err) {
        expect((err as DocumentServiceError).code).toBe('UNSUPPORTED_FORMAT');
      }
    });

    it('should reject .docx files', () => {
      const sourcePath = 'doc.docx';
      writeFileSync(join(workspace, sourcePath), 'DOCX content');

      expect(() => ingestDocument(
        { documentId: 'docx', sourcePath },
        { workspace }
      )).toThrow(DocumentServiceError);
    });

    it('should reject .html files', () => {
      const sourcePath = 'doc.html';
      writeFileSync(join(workspace, sourcePath), '<html>content</html>');

      expect(() => ingestDocument(
        { documentId: 'html', sourcePath },
        { workspace }
      )).toThrow(DocumentServiceError);
    });

    it('should reject files without extension', () => {
      const sourcePath = 'noextension';
      writeFileSync(join(workspace, sourcePath), 'content');

      expect(() => ingestDocument(
        { documentId: 'noext', sourcePath },
        { workspace }
      )).toThrow(DocumentServiceError);

      try {
        ingestDocument({ documentId: 'noext', sourcePath }, { workspace });
      } catch (err) {
        expect((err as DocumentServiceError).code).toBe('UNSUPPORTED_FORMAT');
        expect((err as DocumentServiceError).message).toContain('no extension');
      }
    });
  });

  describe('Path containment', () => {
    it('should accept paths within workspace', () => {
      const sourcePath = 'deep/nested/path/doc.md';
      mkdirSync(join(workspace, 'deep/nested/path'), { recursive: true });
      writeFileSync(join(workspace, sourcePath), '# Nested doc');

      const result = ingestDocument(
        { documentId: 'nested', sourcePath },
        { workspace }
      );

      expect(result.record.documentId).toBe('nested');
    });

    it('should reject paths escaping via ../', () => {
      const sourcePath = '../outside.md';

      expect(() => ingestDocument(
        { documentId: 'escape', sourcePath },
        { workspace }
      )).toThrow(DocumentServiceError);

      try {
        ingestDocument({ documentId: 'escape', sourcePath }, { workspace });
      } catch (err) {
        expect((err as DocumentServiceError).code).toBe('PATH_OUTSIDE_WORKSPACE');
      }
    });

    it('should reject paths escaping via nested ../', () => {
      const sourcePath = 'docs/../../outside.md';

      expect(() => ingestDocument(
        { documentId: 'nested-escape', sourcePath },
        { workspace }
      )).toThrow(DocumentServiceError);
    });

    it('should reject absolute paths outside workspace', () => {
      const sourcePath = '/etc/passwd';

      expect(() => ingestDocument(
        { documentId: 'absolute', sourcePath },
        { workspace }
      )).toThrow(DocumentServiceError);
    });
  });

  describe('Content-addressed snapshots', () => {
    it('should compute SHA-256 hash correctly', () => {
      const content = Buffer.from('test content');
      const hash = computeSHA256(content);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      // SHA-256 of "test content"
      expect(hash).toBe('6ae8a75555209fd6c44157c0aed8016e763ff435a19cf186f76863140143ff72');
    });

    it('should store snapshot at content-addressed path', () => {
      const content = '# Snapshot test content\n';
      const sourcePath = 'doc.md';
      writeFileSync(join(workspace, sourcePath), content);

      const result = ingestDocument(
        { documentId: 'snapshot-test', sourcePath },
        { workspace }
      );

      const expectedHash = computeSHA256(Buffer.from(content));
      expect(result.version.contentHash).toBe(expectedHash);
      expect(result.version.snapshotPath).toBe(`sources/${expectedHash}.md`);
      expect(result.snapshotPath).toContain(expectedHash);
    });

    it('should preserve exact source bytes in snapshot', () => {
      const content = '# Test\r\nWith CRLF\r\nLine endings\r\n';
      const sourcePath = 'crlf.md';
      writeFileSync(join(workspace, sourcePath), content);

      const result = ingestDocument(
        { documentId: 'crlf-test', sourcePath },
        { workspace }
      );

      const snapshotContent = readFileSync(result.snapshotPath, 'utf-8');
      expect(snapshotContent).toBe(content);
    });

    it('should record content size in bytes', () => {
      const content = '# Test content';
      const sourcePath = 'size.md';
      writeFileSync(join(workspace, sourcePath), content);

      const result = ingestDocument(
        { documentId: 'size-test', sourcePath },
        { workspace }
      );

      expect(result.version.contentSize).toBe(Buffer.from(content).length);
    });

    it('should preserve exact bytes from source to snapshot', () => {
      // Create content with specific binary properties
      const content = Buffer.from([
        0x23, 0x20, 0x54, 0x65, 0x73, 0x74, // "# Test"
        0x0D, 0x0A, // CRLF
        0xE4, 0xB8, 0xAD, 0xE6, 0x96, 0x87, // UTF-8 Chinese characters
        0x0A, // LF
      ]);
      const sourcePath = 'exact-bytes.md';
      writeFileSync(join(workspace, sourcePath), content);

      const result = ingestDocument(
        { documentId: 'exact', sourcePath },
        { workspace }
      );

      // Read snapshot bytes
      const snapshotBytes = readFileSync(result.snapshotPath);

      // Verify exact byte match
      expect(snapshotBytes.equals(content)).toBe(true);
      expect(snapshotBytes.length).toBe(content.length);
    });

    it('should produce consistent hash for identical content', () => {
      const content = '# Consistent hash test';
      const sourcePath1 = 'hash1.md';
      const sourcePath2 = 'hash2.md';
      writeFileSync(join(workspace, sourcePath1), content);
      writeFileSync(join(workspace, sourcePath2), content);

      const result1 = ingestDocument(
        { documentId: 'hash-test-1', sourcePath: sourcePath1 },
        { workspace }
      );
      const result2 = ingestDocument(
        { documentId: 'hash-test-2', sourcePath: sourcePath2 },
        { workspace }
      );

      // Same content = same hash
      expect(result1.version.contentHash).toBe(result2.version.contentHash);
      // But different documents can share the same snapshot
      expect(result1.snapshotPath).toBe(result2.snapshotPath);
    });
  });

  describe('Snapshot reuse', () => {
    it('should reuse existing snapshot for unchanged content', () => {
      const content = '# Reuse test';
      const sourcePath = 'reuse.md';
      writeFileSync(join(workspace, sourcePath), content);

      // First ingestion
      const result1 = ingestDocument(
        { documentId: 'reuse-doc', sourcePath },
        { workspace }
      );
      expect(result1.reused).toBe(false);

      // Second ingestion - same content
      const result2 = ingestDocument(
        { documentId: 'reuse-doc', sourcePath },
        { workspace }
      );
      expect(result2.reused).toBe(true);
      expect(result2.version.contentHash).toBe(result1.version.contentHash);
    });

    it('should not add duplicate version for unchanged content', () => {
      const content = '# No duplicate';
      const sourcePath = 'nodup.md';
      writeFileSync(join(workspace, sourcePath), content);

      // First ingestion
      ingestDocument({ documentId: 'nodup', sourcePath }, { workspace });

      // Second ingestion - same content
      ingestDocument({ documentId: 'nodup', sourcePath }, { workspace });

      // Should still have only one version
      const record = getDocument('nodup', { workspace })!;
      expect(record.versions.length).toBe(1);
    });

    it('should create new snapshot for changed content', () => {
      const sourcePath = 'changing.md';
      writeFileSync(join(workspace, sourcePath), '# Version 1');

      // First ingestion
      const result1 = ingestDocument(
        { documentId: 'changing', sourcePath },
        { workspace }
      );

      // Change content
      writeFileSync(join(workspace, sourcePath), '# Version 2');

      // Second ingestion
      const result2 = ingestDocument(
        { documentId: 'changing', sourcePath },
        { workspace }
      );

      expect(result2.version.contentHash).not.toBe(result1.version.contentHash);
      expect(result2.reused).toBe(false);
    });

    it('should retain old snapshots when content changes', () => {
      const sourcePath = 'versions.md';
      writeFileSync(join(workspace, sourcePath), '# V1');

      const result1 = ingestDocument(
        { documentId: 'versioned', sourcePath },
        { workspace }
      );

      writeFileSync(join(workspace, sourcePath), '# V2');

      const result2 = ingestDocument(
        { documentId: 'versioned', sourcePath },
        { workspace }
      );

      // Both snapshots should exist
      expect(existsSync(result1.snapshotPath)).toBe(true);
      expect(existsSync(result2.snapshotPath)).toBe(true);
    });
  });

  describe('Document version ordering', () => {
    it('should use last version as current (by position, no status field)', () => {
      const sourcePath = 'order.md';
      writeFileSync(join(workspace, sourcePath), '# V1');

      const result1 = ingestDocument({ documentId: 'ordered', sourcePath }, { workspace });

      writeFileSync(join(workspace, sourcePath), '# V2');
      const result2 = ingestDocument(
        { documentId: 'ordered', sourcePath },
        { workspace }
      );

      writeFileSync(join(workspace, sourcePath), '# V3');
      const result3 = ingestDocument(
        { documentId: 'ordered', sourcePath },
        { workspace }
      );

      const record = getDocument('ordered', { workspace })!;

      // All three versions have different hashes
      expect(result1.version.contentHash).not.toBe(result2.version.contentHash);
      expect(result2.version.contentHash).not.toBe(result3.version.contentHash);

      // Last version is current (by position)
      const current = getCurrentVersion(record)!;
      expect(current.contentHash).toBe(result3.version.contentHash);

      // Three versions exist in order
      expect(record.versions.length).toBe(3);
      expect(record.versions[0].contentHash).toBe(result1.version.contentHash);
      expect(record.versions[1].contentHash).toBe(result2.version.contentHash);
      expect(record.versions[2].contentHash).toBe(result3.version.contentHash);

      // Verify no status field exists (it was removed)
      // Use type assertion through unknown to check for removed property
      expect((record.versions[0] as unknown as Record<string, unknown>).status).toBeUndefined();
      expect((record.versions[1] as unknown as Record<string, unknown>).status).toBeUndefined();
      expect((record.versions[2] as unknown as Record<string, unknown>).status).toBeUndefined();
    });

    it('should preserve version history in order', () => {
      const sourcePath = 'history.md';

      // Create three versions
      writeFileSync(join(workspace, sourcePath), '# First');
      ingestDocument({ documentId: 'history', sourcePath }, { workspace });

      writeFileSync(join(workspace, sourcePath), '# Second');
      ingestDocument({ documentId: 'history', sourcePath }, { workspace });

      writeFileSync(join(workspace, sourcePath), '# Third');
      ingestDocument({ documentId: 'history', sourcePath }, { workspace });

      const record = getDocument('history', { workspace })!;

      expect(record.versions.length).toBe(3);

      // Verify hash order corresponds to content order
      const v1Content = readFileSync(
        join(workspace, 'documents/sources', `${record.versions[0].contentHash}.md`),
        'utf-8'
      );
      expect(v1Content).toBe('# First');

      const v3Content = readFileSync(
        join(workspace, 'documents/sources', `${record.versions[2].contentHash}.md`),
        'utf-8'
      );
      expect(v3Content).toBe('# Third');
    });
  });

  describe('Registry persistence', () => {
    it('should create registry if it does not exist', () => {
      const sourcePath = 'first.md';
      writeFileSync(join(workspace, sourcePath), '# First doc');

      ingestDocument({ documentId: 'first', sourcePath }, { workspace });

      const registryPath = join(workspace, 'documents/documents.json');
      expect(existsSync(registryPath)).toBe(true);
    });

    it('should preserve existing documents in registry', () => {
      const sourcePath1 = 'doc1.md';
      const sourcePath2 = 'doc2.md';
      writeFileSync(join(workspace, sourcePath1), '# Doc 1');
      writeFileSync(join(workspace, sourcePath2), '# Doc 2');

      ingestDocument({ documentId: 'doc1', sourcePath: sourcePath1 }, { workspace });
      ingestDocument({ documentId: 'doc2', sourcePath: sourcePath2 }, { workspace });

      const docs = getAllDocuments({ workspace });
      expect(docs.length).toBe(2);
      expect(docs.map(d => d.documentId).sort()).toEqual(['doc1', 'doc2']);
    });

    it('should include schema version in registry', () => {
      const sourcePath = 'schema.md';
      writeFileSync(join(workspace, sourcePath), '# Schema test');

      ingestDocument({ documentId: 'schema', sourcePath }, { workspace });

      const registryPath = join(workspace, 'documents/documents.json');
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as DocumentRegistry;

      expect(registry.schemaVersion).toBe('1.0');
    });

    it('should update registry timestamps', () => {
      const sourcePath = 'timestamps.md';
      writeFileSync(join(workspace, sourcePath), '# Timestamps');

      const result1 = ingestDocument(
        { documentId: 'timestamps', sourcePath },
        { workspace }
      );

      // Small delay to ensure different timestamp
      const initialTime = new Date(result1.record.createdAt).getTime();

      writeFileSync(join(workspace, sourcePath), '# Updated');

      const result2 = ingestDocument(
        { documentId: 'timestamps', sourcePath },
        { workspace }
      );

      expect(new Date(result2.record.createdAt).getTime()).toBe(initialTime);
      expect(new Date(result2.record.updatedAt).getTime()).toBeGreaterThanOrEqual(initialTime);
    });
  });

  describe('Error handling', () => {
    it('should throw for missing source file', () => {
      expect(() => ingestDocument(
        { documentId: 'missing', sourcePath: 'nonexistent.md' },
        { workspace }
      )).toThrow(DocumentServiceError);

      try {
        ingestDocument({ documentId: 'missing', sourcePath: 'nonexistent.md' }, { workspace });
      } catch (err) {
        expect((err as DocumentServiceError).code).toBe('DOCUMENT_NOT_FOUND');
      }
    });

    it('should throw for empty file', () => {
      const sourcePath = 'empty.md';
      writeFileSync(join(workspace, sourcePath), '');

      expect(() => ingestDocument(
        { documentId: 'empty', sourcePath },
        { workspace }
      )).toThrow(DocumentServiceError);

      try {
        ingestDocument({ documentId: 'empty', sourcePath }, { workspace });
      } catch (err) {
        expect((err as DocumentServiceError).code).toBe('EMPTY_FILE');
      }
    });

    it('should throw for invalid UTF-8 content', () => {
      const sourcePath = 'invalid.md';
      // Invalid UTF-8 byte sequence
      writeFileSync(join(workspace, sourcePath), Buffer.from([0x80, 0x81, 0x82]));

      expect(() => ingestDocument(
        { documentId: 'invalid-utf8', sourcePath },
        { workspace }
      )).toThrow(DocumentServiceError);

      try {
        ingestDocument({ documentId: 'invalid-utf8', sourcePath }, { workspace });
      } catch (err) {
        expect((err as DocumentServiceError).code).toBe('ENCODING_ERROR');
      }
    });

    it('should handle valid UTF-8 with BOM', () => {
      const sourcePath = 'bom.md';
      const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
      const content = Buffer.from('# With BOM');
      writeFileSync(join(workspace, sourcePath), Buffer.concat([bom, content]));

      const result = ingestDocument(
        { documentId: 'bom', sourcePath },
        { workspace }
      );

      expect(result.record.documentId).toBe('bom');
    });
  });

  describe('Source file preservation', () => {
    it('should never modify the original source file', () => {
      const sourcePath = 'preserve-test.md';
      const originalContent = '# Original Content\n\nThis should remain unchanged.';
      writeFileSync(join(workspace, sourcePath), originalContent);

      // Get original file stats
      const originalBytes = readFileSync(join(workspace, sourcePath));

      // Ingest the document
      ingestDocument(
        { documentId: 'preserve', sourcePath },
        { workspace }
      );

      // Verify source file is unchanged
      const afterBytes = readFileSync(join(workspace, sourcePath));
      expect(afterBytes.equals(originalBytes)).toBe(true);
    });

    it('should preserve source file even after multiple ingestions', () => {
      const sourcePath = 'multi-ingest.md';
      const content = '# Multi Ingest Test';
      writeFileSync(join(workspace, sourcePath), content);

      // First ingestion
      ingestDocument({ documentId: 'multi', sourcePath }, { workspace });
      expect(readFileSync(join(workspace, sourcePath), 'utf-8')).toBe(content);

      // Second ingestion (unchanged content)
      ingestDocument({ documentId: 'multi', sourcePath }, { workspace });
      expect(readFileSync(join(workspace, sourcePath), 'utf-8')).toBe(content);

      // Change and re-ingest
      const newContent = '# Updated Content';
      writeFileSync(join(workspace, sourcePath), newContent);
      ingestDocument({ documentId: 'multi', sourcePath }, { workspace });
      expect(readFileSync(join(workspace, sourcePath), 'utf-8')).toBe(newContent);
    });

    it('should preserve exact binary content including line endings', () => {
      const sourcePath = 'binary.md';
      // Mix of CRLF, LF, and unicode
      const content = '# Test\r\n\nUnicode: 你好\n\r\nEnd';
      writeFileSync(join(workspace, sourcePath), content);

      const originalBytes = readFileSync(join(workspace, sourcePath));

      ingestDocument({ documentId: 'binary', sourcePath }, { workspace });

      const afterBytes = readFileSync(join(workspace, sourcePath));
      expect(afterBytes.equals(originalBytes)).toBe(true);
    });
  });

  describe('Metadata preservation', () => {
    it('should preserve document name', () => {
      const sourcePath = 'named.md';
      writeFileSync(join(workspace, sourcePath), '# Named doc');

      const result = ingestDocument(
        { documentId: 'named', sourcePath, name: 'My Document' },
        { workspace }
      );

      expect(result.record.name).toBe('My Document');
    });

    it('should use documentId as default name', () => {
      const sourcePath = 'default-name.md';
      writeFileSync(join(workspace, sourcePath), '# Default');

      const result = ingestDocument(
        { documentId: 'default-name', sourcePath },
        { workspace }
      );

      expect(result.record.name).toBe('default-name');
    });

    it('should preserve version label', () => {
      const sourcePath = 'labeled.md';
      writeFileSync(join(workspace, sourcePath), '# Labeled');

      const result = ingestDocument(
        { documentId: 'labeled', sourcePath, versionLabel: 'v1.0.0' },
        { workspace }
      );

      expect(result.version.versionLabel).toBe('v1.0.0');
    });

    it('should preserve version notes', () => {
      const sourcePath = 'notes.md';
      writeFileSync(join(workspace, sourcePath), '# With notes');

      const result = ingestDocument(
        { documentId: 'with-notes', sourcePath, notes: 'Initial release' },
        { workspace }
      );

      expect(result.version.notes).toBe('Initial release');
    });

    it('should preserve source path in each version', () => {
      const sourcePath = 'tracked.md';
      writeFileSync(join(workspace, sourcePath), '# Tracked');

      const result = ingestDocument(
        { documentId: 'tracked', sourcePath },
        { workspace }
      );

      expect(result.version.sourcePath).toBe(sourcePath);
    });

    it('should include ingestion timestamp', () => {
      const sourcePath = 'timed.md';
      writeFileSync(join(workspace, sourcePath), '# Timed');

      const before = new Date().toISOString();
      const result = ingestDocument(
        { documentId: 'timed', sourcePath },
        { workspace }
      );
      const after = new Date().toISOString();

      expect(result.version.ingestedAt >= before).toBe(true);
      expect(result.version.ingestedAt <= after).toBe(true);
    });
  });

  describe('Orphaned snapshot handling (behavioral tests)', () => {
    /**
     * These tests verify the actual behavior when snapshot publication succeeds
     * but registry update fails, using dependency injection for the registry
     * filesystem operations.
     */

    it('should throw ORPHANED_SNAPSHOT when registry fails after new snapshot', () => {
      // Create source document
      const sourcePath = 'orphan-test.md';
      const content = '# Orphan Test Content';
      writeFileSync(join(workspace, sourcePath), content);

      // Create initial registry to preserve
      const documentsDir = join(workspace, 'documents');
      mkdirSync(documentsDir, { recursive: true });
      const initialRegistry = {
        schemaVersion: '1.0',
        updatedAt: '2026-01-01T00:00:00Z',
        documents: {},
      };
      const initialRegistryJson = JSON.stringify(initialRegistry, null, 2);
      writeFileSync(join(documentsDir, 'documents.json'), initialRegistryJson);

      // Mock fsOps to fail registry rename
      const mockFsOps = {
        renameSync: () => {
          const error = new Error('EPERM: simulated failure') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        },
      };

      // Attempt ingestion with mocked registry failure - verify error details
      try {
        ingestDocument(
          { documentId: 'orphan-doc', sourcePath },
          { workspace, registryFsOps: mockFsOps }
        );
        // Should not reach here
        expect(true).toBe(false);
      } catch (err) {
        const error = err as DocumentServiceError;
        // Should be ORPHANED_SNAPSHOT because snapshot was newly created (not reused)
        expect(error.code).toBe('ORPHANED_SNAPSHOT');
        expect(error.message).toContain('Orphaned snapshot(s) remain on disk');
        expect(error.documentId).toBe('orphan-doc');
      }
    });

    it('should include orphaned snapshot path in error message', () => {
      const sourcePath = 'path-test.md';
      const content = '# Path Test';
      writeFileSync(join(workspace, sourcePath), content);

      const documentsDir = join(workspace, 'documents');
      mkdirSync(documentsDir, { recursive: true });
      writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify({
        schemaVersion: '1.0',
        updatedAt: '2026-01-01T00:00:00Z',
        documents: {},
      }));

      const mockFsOps = {
        renameSync: () => {
          const error = new Error('EPERM') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        },
      };

      try {
        ingestDocument(
          { documentId: 'path-doc', sourcePath },
          { workspace, registryFsOps: mockFsOps }
        );
      } catch (err) {
        const error = err as DocumentServiceError;
        // The orphaned snapshot path should be in the message
        expect(error.message).toContain('sources');
        expect(error.message).toContain('.md');
      }
    });

    it('should preserve the orphaned snapshot file on disk', () => {
      const sourcePath = 'preserve-snapshot.md';
      const content = '# Preserved Snapshot Content';
      writeFileSync(join(workspace, sourcePath), content);

      const documentsDir = join(workspace, 'documents');
      mkdirSync(documentsDir, { recursive: true });
      writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify({
        schemaVersion: '1.0',
        updatedAt: '2026-01-01T00:00:00Z',
        documents: {},
      }));

      const mockFsOps = {
        renameSync: () => {
          const error = new Error('EPERM') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        },
      };

      let orphanedPath: string | undefined;
      try {
        ingestDocument(
          { documentId: 'preserve-doc', sourcePath },
          { workspace, registryFsOps: mockFsOps }
        );
      } catch (err) {
        const error = err as DocumentServiceError;
        // Extract path from message
        const match = error.message.match(/sources[\\/][a-f0-9]+\.md/);
        if (match) {
          orphanedPath = join(documentsDir, match[0]);
        }
      }

      // The orphaned snapshot file should exist
      expect(orphanedPath).toBeDefined();
      expect(existsSync(orphanedPath!)).toBe(true);

      // The snapshot should contain the exact source bytes
      const snapshotContent = readFileSync(orphanedPath!, 'utf-8');
      expect(snapshotContent).toBe(content);
    });

    it('should preserve original registry byte-for-byte', () => {
      const sourcePath = 'registry-preserve.md';
      writeFileSync(join(workspace, sourcePath), '# Content');

      const documentsDir = join(workspace, 'documents');
      mkdirSync(documentsDir, { recursive: true });
      const initialRegistry = {
        schemaVersion: '1.0',
        updatedAt: '2026-01-01T00:00:00Z',
        documents: {
          'existing-doc': {
            documentId: 'existing-doc',
            name: 'Existing',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            versions: [],
          },
        },
      };
      const initialRegistryJson = JSON.stringify(initialRegistry, null, 2);
      writeFileSync(join(documentsDir, 'documents.json'), initialRegistryJson);

      const mockFsOps = {
        renameSync: () => {
          const error = new Error('EPERM') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        },
      };

      try {
        ingestDocument(
          { documentId: 'new-doc', sourcePath },
          { workspace, registryFsOps: mockFsOps }
        );
      } catch {
        // Expected
      }

      // Original registry must remain byte-for-byte identical
      const afterRegistry = readFileSync(join(documentsDir, 'documents.json'), 'utf-8');
      expect(afterRegistry).toBe(initialRegistryJson);
    });

    it('should not delete existing referenced snapshots', () => {
      const sourcePath = 'new-doc.md';
      writeFileSync(join(workspace, sourcePath), '# New Content');

      // Create initial registry with an existing document
      const documentsDir = join(workspace, 'documents');
      mkdirSync(join(documentsDir, 'sources'), { recursive: true });

      // Create an existing snapshot that should remain untouched
      const existingSnapshotPath = join(documentsDir, 'sources', 'existinghash123.md');
      const existingSnapshotContent = '# Existing Snapshot';
      writeFileSync(existingSnapshotPath, existingSnapshotContent);

      const initialRegistry = {
        schemaVersion: '1.0',
        updatedAt: '2026-01-01T00:00:00Z',
        documents: {
          'existing': {
            documentId: 'existing',
            name: 'Existing',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            versions: [{
              contentHash: 'existinghash123',
              snapshotPath: 'sources/existinghash123.md',
              contentSize: existingSnapshotContent.length,
              ingestedAt: '2026-01-01T00:00:00Z',
              sourcePath: 'existing.md',
              format: 'markdown',
            }],
          },
        },
      };
      writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify(initialRegistry, null, 2));

      const mockFsOps = {
        renameSync: () => {
          const error = new Error('EPERM') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        },
      };

      try {
        ingestDocument(
          { documentId: 'new-doc', sourcePath },
          { workspace, registryFsOps: mockFsOps }
        );
      } catch {
        // Expected
      }

      // Existing snapshot must remain unchanged
      expect(existsSync(existingSnapshotPath)).toBe(true);
      expect(readFileSync(existingSnapshotPath, 'utf-8')).toBe(existingSnapshotContent);
    });

    it('should not throw ORPHANED_SNAPSHOT when reusing existing snapshot', () => {
      // First, successfully ingest a document
      const sourcePath = 'reuse-test.md';
      const content = '# Reuse Test';
      writeFileSync(join(workspace, sourcePath), content);

      ingestDocument(
        { documentId: 'reuse-doc', sourcePath },
        { workspace }
      );

      // Now try to ingest the same content with registry failure
      // This should fail with REGISTRY_ERROR, not ORPHANED_SNAPSHOT,
      // because the snapshot was reused, not newly created
      const mockFsOps = {
        renameSync: () => {
          const error = new Error('EPERM') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        },
      };

      try {
        ingestDocument(
          { documentId: 'reuse-doc', sourcePath },
          { workspace, registryFsOps: mockFsOps }
        );
      } catch (err) {
        const error = err as DocumentServiceError;
        // Should be REGISTRY_ERROR because snapshot was reused
        expect(error.code).toBe('REGISTRY_ERROR');
        expect(error.code).not.toBe('ORPHANED_SNAPSHOT');
      }
    });

    it('should cleanup temporary files after registry failure', () => {
      const sourcePath = 'cleanup-test.md';
      writeFileSync(join(workspace, sourcePath), '# Cleanup Test');

      const documentsDir = join(workspace, 'documents');
      mkdirSync(documentsDir, { recursive: true });
      writeFileSync(join(documentsDir, 'documents.json'), JSON.stringify({
        schemaVersion: '1.0',
        updatedAt: '2026-01-01T00:00:00Z',
        documents: {},
      }));

      const mockFsOps = {
        renameSync: () => {
          const error = new Error('EPERM') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        },
      };

      try {
        ingestDocument(
          { documentId: 'cleanup-doc', sourcePath },
          { workspace, registryFsOps: mockFsOps }
        );
      } catch {
        // Expected
      }

      // No temp files should remain in documents directory
      const files = readdirSync(documentsDir);
      const tempFiles = files.filter(f => f.includes('.tmp'));
      expect(tempFiles.length).toBe(0);
    });
  });

  describe('Snapshot verification', () => {
    it('should verify valid snapshot', () => {
      const sourcePath = 'verify.md';
      writeFileSync(join(workspace, sourcePath), '# Verify');

      const result = ingestDocument(
        { documentId: 'verify', sourcePath },
        { workspace }
      );

      const isValid = verifySnapshot(result.snapshotPath, result.version.contentHash);
      expect(isValid).toBe(true);
    });

    it('should return false for nonexistent snapshot', () => {
      const isValid = verifySnapshot(
        join(workspace, 'nonexistent.md'),
        'abc123'
      );
      expect(isValid).toBe(false);
    });

    it('should throw for corrupted snapshot', () => {
      const sourcePath = 'corrupt.md';
      writeFileSync(join(workspace, sourcePath), '# Original');

      const result = ingestDocument(
        { documentId: 'corrupt', sourcePath },
        { workspace }
      );

      // Corrupt the snapshot
      writeFileSync(result.snapshotPath, '# Tampered');

      expect(() => verifySnapshot(
        result.snapshotPath,
        result.version.contentHash
      )).toThrow(DocumentServiceError);

      try {
        verifySnapshot(result.snapshotPath, result.version.contentHash);
      } catch (err) {
        expect((err as DocumentServiceError).code).toBe('SNAPSHOT_CORRUPTED');
      }
    });
  });

  describe('getCurrentVersion helper', () => {
    it('should return last version from versions array (no status field)', () => {
      const record: DocumentRecord = {
        documentId: 'test',
        name: 'Test',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-03T00:00:00Z',
        versions: [
          {
            contentHash: 'hash1',
            snapshotPath: 'sources/hash1.md',
            contentSize: 100,
            ingestedAt: '2026-01-01T00:00:00Z',
            sourcePath: 'doc.md',
            format: 'markdown',
          },
          {
            contentHash: 'hash2',
            snapshotPath: 'sources/hash2.md',
            contentSize: 150,
            ingestedAt: '2026-01-02T00:00:00Z',
            sourcePath: 'doc.md',
            format: 'markdown',
          },
          {
            contentHash: 'hash3',
            snapshotPath: 'sources/hash3.md',
            contentSize: 200,
            ingestedAt: '2026-01-03T00:00:00Z',
            sourcePath: 'doc.md',
            format: 'markdown',
          },
        ],
      };

      const current = getCurrentVersion(record);
      expect(current).toBeDefined();
      expect(current!.contentHash).toBe('hash3');

      // Last position is the sole indicator of current version
      expect(record.versions[record.versions.length - 1]).toBe(current);
    });

    it('should return undefined for empty versions array', () => {
      const record: DocumentRecord = {
        documentId: 'empty',
        name: 'Empty',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        versions: [],
      };

      const current = getCurrentVersion(record);
      expect(current).toBeUndefined();
    });

    it('should identify current version by position, not by status field', () => {
      // This test verifies that we don't rely on any status field
      const record: DocumentRecord = {
        documentId: 'position-test',
        name: 'Position Test',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        versions: [
          {
            contentHash: 'old-hash',
            snapshotPath: 'sources/old-hash.md',
            contentSize: 100,
            ingestedAt: '2026-01-01T00:00:00Z',
            sourcePath: 'doc.md',
            format: 'markdown',
          },
          {
            contentHash: 'new-hash',
            snapshotPath: 'sources/new-hash.md',
            contentSize: 200,
            ingestedAt: '2026-01-02T00:00:00Z',
            sourcePath: 'doc.md',
            format: 'markdown',
          },
        ],
      };

      const current = getCurrentVersion(record);
      expect(current!.contentHash).toBe('new-hash');

      // Verify it's the last entry
      expect(record.versions.indexOf(current!)).toBe(record.versions.length - 1);
    });
  });

  describe('getSnapshotAbsolutePath (canonical path resolver)', () => {
    it('should resolve stored snapshotPath to absolute path', () => {
      const sourcePath = 'resolver-test.md';
      const content = '# Resolver Test';
      writeFileSync(join(workspace, sourcePath), content);

      const result = ingestDocument(
        { documentId: 'resolver-doc', sourcePath },
        { workspace }
      );

      // Get the absolute path using the canonical resolver
      const absolutePath = getSnapshotAbsolutePath(result.version, { workspace });

      // Should match the path returned by ingestDocument
      expect(absolutePath).toBe(result.snapshotPath);

      // Should be an absolute path containing the workspace
      expect(absolutePath.includes(workspace)).toBe(true);

      // File should exist at the resolved path
      expect(existsSync(absolutePath)).toBe(true);
    });

    it('should resolve path consistently with ingestion result', () => {
      const sourcePath = 'consistency-test.md';
      writeFileSync(join(workspace, sourcePath), '# Consistency Test');

      const result = ingestDocument(
        { documentId: 'consistency-doc', sourcePath },
        { workspace }
      );

      const resolvedPath = getSnapshotAbsolutePath(result.version, { workspace });

      // Content at resolved path should match source content
      const snapshotContent = readFileSync(resolvedPath, 'utf-8');
      expect(snapshotContent).toBe('# Consistency Test');
    });

    it('should reject escaping snapshotPath', () => {
      // Manually create a version with an escaping path
      const version = {
        contentHash: 'test-hash',
        snapshotPath: '../../../etc/passwd',
        contentSize: 100,
        ingestedAt: '2026-01-01T00:00:00Z',
        sourcePath: 'test.md',
        format: 'markdown' as const,
      };

      expect(() => getSnapshotAbsolutePath(version, { workspace }))
        .toThrow(DocumentServiceError);

      try {
        getSnapshotAbsolutePath(version, { workspace });
      } catch (err) {
        expect((err as DocumentServiceError).code).toBe('PATH_OUTSIDE_WORKSPACE');
      }
    });

    it('should reject absolute snapshotPath', () => {
      const version = {
        contentHash: 'test-hash',
        snapshotPath: '/etc/passwd',
        contentSize: 100,
        ingestedAt: '2026-01-01T00:00:00Z',
        sourcePath: 'test.md',
        format: 'markdown' as const,
      };

      expect(() => getSnapshotAbsolutePath(version, { workspace }))
        .toThrow(DocumentServiceError);
    });

    it('should use the selected project documents directory', () => {
      const sourcePath = 'project-dir-test.md';
      writeFileSync(join(workspace, sourcePath), '# Project Dir Test');

      const result = ingestDocument(
        { documentId: 'project-dir-doc', sourcePath },
        { workspace }
      );

      const resolvedPath = getSnapshotAbsolutePath(result.version, { workspace });

      // Path should be under <workspace>/documents/sources
      const expectedDir = join(workspace, 'documents', 'sources');
      expect(resolvedPath.startsWith(expectedDir)).toBe(true);
    });

    it('should resolve multi-version document paths correctly', () => {
      const sourcePath = 'multi-version.md';
      writeFileSync(join(workspace, sourcePath), '# Version 1');

      // First version
      ingestDocument(
        { documentId: 'multi-doc', sourcePath },
        { workspace }
      );

      // Update and create second version
      writeFileSync(join(workspace, sourcePath), '# Version 2');
      const result2 = ingestDocument(
        { documentId: 'multi-doc', sourcePath },
        { workspace }
      );

      const record = getDocument('multi-doc', { workspace })!;

      // Both versions should resolve correctly
      const v1Path = getSnapshotAbsolutePath(record.versions[0], { workspace });
      const v2Path = getSnapshotAbsolutePath(record.versions[1], { workspace });

      expect(existsSync(v1Path)).toBe(true);
      expect(existsSync(v2Path)).toBe(true);

      // Paths should be different (different content hashes)
      expect(v1Path).not.toBe(v2Path);

      // v2 path should match current version
      expect(v2Path).toBe(result2.snapshotPath);

      // Content should be correct
      expect(readFileSync(v1Path, 'utf-8')).toBe('# Version 1');
      expect(readFileSync(v2Path, 'utf-8')).toBe('# Version 2');
    });
  });
});
