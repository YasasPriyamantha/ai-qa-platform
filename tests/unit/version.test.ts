import { describe, it, expect } from 'vitest';
import { VERSION, PLATFORM_NAME, getVersionInfo } from '../../src/application/version.js';

describe('version', () => {
  it('should export version constant', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('should export platform name', () => {
    expect(PLATFORM_NAME).toBe('AI QA Automation Platform');
  });

  it('should format version info string', () => {
    const info = getVersionInfo();
    expect(info).toContain(PLATFORM_NAME);
    expect(info).toContain(VERSION);
  });
});
