/**
 * Tests for document type utilities and structure
 */

import { describe, it, expect } from 'vitest';
import {
  getExtensionForFormat,
  inferFormatFromExtension,
} from '../../../src/documents/types.js';
import type {
  DocumentVersion,
  DocumentRecord,
  DocumentRegistry,
} from '../../../src/documents/types.js';

describe('getExtensionForFormat', () => {
  it('should return .md for markdown format', () => {
    expect(getExtensionForFormat('markdown')).toBe('.md');
  });

  it('should return .txt for text format', () => {
    expect(getExtensionForFormat('text')).toBe('.txt');
  });

  it('should throw for unknown format', () => {
    // TypeScript should prevent this at compile time,
    // but runtime check is still present
    expect(() => getExtensionForFormat('unknown' as 'markdown')).toThrow();
  });
});

describe('inferFormatFromExtension', () => {
  it('should infer markdown from .md', () => {
    expect(inferFormatFromExtension('.md')).toBe('markdown');
    expect(inferFormatFromExtension('md')).toBe('markdown');
  });

  it('should infer markdown from .markdown', () => {
    expect(inferFormatFromExtension('.markdown')).toBe('markdown');
    expect(inferFormatFromExtension('markdown')).toBe('markdown');
  });

  it('should infer text from .txt', () => {
    expect(inferFormatFromExtension('.txt')).toBe('text');
    expect(inferFormatFromExtension('txt')).toBe('text');
  });

  it('should handle case-insensitivity', () => {
    expect(inferFormatFromExtension('.MD')).toBe('markdown');
    expect(inferFormatFromExtension('.Md')).toBe('markdown');
    expect(inferFormatFromExtension('.TXT')).toBe('text');
    expect(inferFormatFromExtension('.Txt')).toBe('text');
  });

  it('should return null for unsupported formats', () => {
    expect(inferFormatFromExtension('.pdf')).toBeNull();
    expect(inferFormatFromExtension('.doc')).toBeNull();
    expect(inferFormatFromExtension('.docx')).toBeNull();
    expect(inferFormatFromExtension('.html')).toBeNull();
    expect(inferFormatFromExtension('.json')).toBeNull();
    expect(inferFormatFromExtension('')).toBeNull();
  });
});

describe('DocumentVersion structure', () => {
  it('should support complete version metadata', () => {
    const version: DocumentVersion = {
      contentHash: 'abc123def456',
      snapshotPath: 'sources/abc123def456.md',
      contentSize: 1024,
      ingestedAt: '2026-01-15T10:00:00Z',
      versionLabel: 'v1.0',
      sourcePath: 'docs/requirements.md',
      format: 'markdown',
      status: 'active',
      notes: 'Initial version',
    };

    expect(version.contentHash).toBe('abc123def456');
    expect(version.status).toBe('active');
    expect(version.versionLabel).toBe('v1.0');
  });

  it('should allow minimal version without optional fields', () => {
    const version: DocumentVersion = {
      contentHash: 'xyz789',
      snapshotPath: 'sources/xyz789.txt',
      contentSize: 512,
      ingestedAt: '2026-01-16T10:00:00Z',
      sourcePath: 'notes.txt',
      format: 'text',
      status: 'superseded',
    };

    expect(version.versionLabel).toBeUndefined();
    expect(version.notes).toBeUndefined();
  });
});

describe('DocumentRecord structure', () => {
  it('should support document with multiple versions', () => {
    const record: DocumentRecord = {
      documentId: 'login-requirements',
      name: 'Login Requirements',
      createdAt: '2026-01-10T10:00:00Z',
      updatedAt: '2026-01-20T10:00:00Z',
      versions: [
        {
          contentHash: 'hash-v1',
          snapshotPath: 'sources/hash-v1.md',
          contentSize: 800,
          ingestedAt: '2026-01-10T10:00:00Z',
          sourcePath: 'docs/login.md',
          format: 'markdown',
          status: 'superseded',
          versionLabel: 'v1.0',
        },
        {
          contentHash: 'hash-v2',
          snapshotPath: 'sources/hash-v2.md',
          contentSize: 1200,
          ingestedAt: '2026-01-20T10:00:00Z',
          sourcePath: 'docs/login.md',
          format: 'markdown',
          status: 'active',
          versionLabel: 'v2.0',
        },
      ],
    };

    expect(record.versions).toHaveLength(2);
    expect(record.versions[0].status).toBe('superseded');
    expect(record.versions[1].status).toBe('active');
  });

  it('should preserve version history without overwriting', () => {
    const record: DocumentRecord = {
      documentId: 'doc-1',
      name: 'Document 1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-03T00:00:00Z',
      versions: [],
    };

    // Simulate adding versions
    const v1: DocumentVersion = {
      contentHash: 'hash1',
      snapshotPath: 'sources/hash1.md',
      contentSize: 100,
      ingestedAt: '2026-01-01T00:00:00Z',
      sourcePath: 'doc.md',
      format: 'markdown',
      status: 'active',
    };
    record.versions.push(v1);

    // Add second version - first becomes superseded
    v1.status = 'superseded';
    const v2: DocumentVersion = {
      contentHash: 'hash2',
      snapshotPath: 'sources/hash2.md',
      contentSize: 150,
      ingestedAt: '2026-01-02T00:00:00Z',
      sourcePath: 'doc.md',
      format: 'markdown',
      status: 'active',
    };
    record.versions.push(v2);

    // Both versions retained
    expect(record.versions).toHaveLength(2);
    expect(record.versions[0].contentHash).toBe('hash1');
    expect(record.versions[1].contentHash).toBe('hash2');
  });
});

describe('DocumentRegistry structure', () => {
  it('should map documentId to DocumentRecord', () => {
    const registry: DocumentRegistry = {
      schemaVersion: '1.0',
      updatedAt: '2026-01-20T10:00:00Z',
      documents: {
        'doc-a': {
          documentId: 'doc-a',
          name: 'Document A',
          createdAt: '2026-01-10T10:00:00Z',
          updatedAt: '2026-01-10T10:00:00Z',
          versions: [
            {
              contentHash: 'hash-a',
              snapshotPath: 'sources/hash-a.md',
              contentSize: 500,
              ingestedAt: '2026-01-10T10:00:00Z',
              sourcePath: 'a.md',
              format: 'markdown',
              status: 'active',
            },
          ],
        },
        'doc-b': {
          documentId: 'doc-b',
          name: 'Document B',
          createdAt: '2026-01-15T10:00:00Z',
          updatedAt: '2026-01-15T10:00:00Z',
          versions: [
            {
              contentHash: 'hash-b',
              snapshotPath: 'sources/hash-b.txt',
              contentSize: 300,
              ingestedAt: '2026-01-15T10:00:00Z',
              sourcePath: 'b.txt',
              format: 'text',
              status: 'active',
            },
          ],
        },
      },
    };

    expect(Object.keys(registry.documents)).toHaveLength(2);
    expect(registry.documents['doc-a'].versions).toHaveLength(1);
    expect(registry.documents['doc-b'].versions).toHaveLength(1);
  });
});
