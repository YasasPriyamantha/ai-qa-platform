/**
 * Tests for shared path safety utilities
 *
 * Verifies the core path-containment logic used by all callers.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  isAbsolutePath,
  isPathContained,
  isRelativePathContained,
} from '../../../src/projects/path-safety.js';

describe('normalizePath', () => {
  it('should convert backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\test')).toBe('c:/Users/test');
    expect(normalizePath('path\\to\\file')).toBe('path/to/file');
  });

  it('should lowercase Windows drive letters', () => {
    expect(normalizePath('D:\\projects')).toBe('d:/projects');
    expect(normalizePath('C:\\Windows')).toBe('c:/Windows');
  });

  it('should preserve lowercase drive letters', () => {
    expect(normalizePath('d:\\projects')).toBe('d:/projects');
  });

  it('should remove trailing slashes', () => {
    expect(normalizePath('path/to/')).toBe('path/to');
    expect(normalizePath('D:\\projects\\')).toBe('d:/projects');
  });

  it('should not remove root slash', () => {
    expect(normalizePath('/')).toBe('/');
  });

  it('should handle Unix paths', () => {
    expect(normalizePath('/home/user/project')).toBe('/home/user/project');
    expect(normalizePath('/home/user/')).toBe('/home/user');
  });
});

describe('isAbsolutePath', () => {
  describe('Unix paths', () => {
    it('should recognize Unix absolute paths', () => {
      expect(isAbsolutePath('/home/user')).toBe(true);
      expect(isAbsolutePath('/etc/passwd')).toBe(true);
      expect(isAbsolutePath('/')).toBe(true);
    });

    it('should recognize Unix relative paths', () => {
      expect(isAbsolutePath('relative/path')).toBe(false);
      expect(isAbsolutePath('./relative')).toBe(false);
      expect(isAbsolutePath('../parent')).toBe(false);
    });
  });

  describe('Windows paths', () => {
    it('should recognize Windows drive paths with backslash', () => {
      expect(isAbsolutePath('C:\\')).toBe(true);
      expect(isAbsolutePath('D:\\projects')).toBe(true);
      expect(isAbsolutePath('c:\\users')).toBe(true);
    });

    it('should recognize Windows drive paths with forward slash', () => {
      expect(isAbsolutePath('C:/')).toBe(true);
      expect(isAbsolutePath('D:/projects')).toBe(true);
    });

    it('should recognize Windows UNC paths', () => {
      // Note: These would be handled by parsePath detecting root
      expect(isAbsolutePath('\\\\server\\share')).toBe(true);
    });

    it('should recognize Windows relative paths', () => {
      expect(isAbsolutePath('relative\\path')).toBe(false);
      expect(isAbsolutePath('.\\relative')).toBe(false);
    });
  });
});

describe('isPathContained', () => {
  describe('basic containment', () => {
    it('should return true for exact match', () => {
      expect(isPathContained('/base', '/base')).toBe(true);
      expect(isPathContained('D:\\base', 'D:\\base')).toBe(true);
    });

    it('should return true for direct children', () => {
      expect(isPathContained('/base/child', '/base')).toBe(true);
      expect(isPathContained('D:\\base\\child', 'D:\\base')).toBe(true);
    });

    it('should return true for nested paths', () => {
      expect(isPathContained('/base/deep/nested/path', '/base')).toBe(true);
      expect(isPathContained('D:\\base\\deep\\nested', 'D:\\base')).toBe(true);
    });
  });

  describe('path traversal prevention', () => {
    it('should return false for paths escaping via ../', () => {
      expect(isPathContained('/base/../other', '/base')).toBe(false);
      expect(isPathContained('/base/foo/../..', '/base')).toBe(false);
    });

    it('should return false for sibling directories', () => {
      expect(isPathContained('/other', '/base')).toBe(false);
      expect(isPathContained('D:\\other', 'D:\\base')).toBe(false);
    });
  });

  describe('sibling-prefix attack prevention', () => {
    it('should return false for paths with common prefix but different directory', () => {
      // /base-sibling is NOT inside /base
      expect(isPathContained('/base-other', '/base')).toBe(false);
      expect(isPathContained('/basedir', '/base')).toBe(false);
      expect(isPathContained('/baseapp', '/base')).toBe(false);
      expect(isPathContained('D:\\base-sibling', 'D:\\base')).toBe(false);
    });
  });

  describe('Windows drive letter handling', () => {
    it('should treat D: and d: as equivalent', () => {
      expect(isPathContained('D:\\projects\\sub', 'd:\\projects')).toBe(true);
      expect(isPathContained('d:\\projects\\sub', 'D:\\projects')).toBe(true);
    });

    it('should handle mixed case paths', () => {
      expect(isPathContained('D:\\Projects\\Sub', 'd:\\projects')).toBe(true);
      expect(isPathContained('d:\\PROJECTS\\sub', 'D:\\Projects')).toBe(true);
    });

    it('should return false for different drives', () => {
      expect(isPathContained('E:\\projects', 'D:\\projects')).toBe(false);
      expect(isPathContained('C:\\Windows', 'D:\\base')).toBe(false);
    });
  });

  describe('path separator normalization', () => {
    it('should handle mixed separators', () => {
      expect(isPathContained('D:\\base/child', 'D:\\base')).toBe(true);
      expect(isPathContained('D:/base\\child', 'D:/base')).toBe(true);
    });
  });
});

describe('isRelativePathContained', () => {
  it('should return true for simple relative paths within workspace', () => {
    expect(isRelativePathContained('tests/approved', '/workspace')).toBe(true);
    expect(isRelativePathContained('deep/nested/path', '/workspace')).toBe(true);
    expect(isRelativePathContained('.', '/workspace')).toBe(true);
  });

  it('should return false for paths escaping via ../', () => {
    expect(isRelativePathContained('../outside', '/workspace')).toBe(false);
    expect(isRelativePathContained('foo/../../outside', '/workspace')).toBe(false);
  });

  it('should return false for absolute paths outside workspace', () => {
    expect(isRelativePathContained('/etc/passwd', '/workspace')).toBe(false);
    expect(isRelativePathContained('C:\\Windows', 'D:\\workspace')).toBe(false);
  });

  it('should handle Windows relative paths', () => {
    expect(isRelativePathContained('tests\\approved', 'D:\\workspace')).toBe(true);
    expect(isRelativePathContained('..\\escape', 'D:\\workspace')).toBe(false);
  });
});
