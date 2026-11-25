/**
 * Tests for environment file parser.
 *
 * Task 3.3: Verify .env parsing using util.parseEnv without process.env mutation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseEnvFile,
  isAiEnabled,
  getEnvSecret,
  isPlaceholderValue,
  checkLegacyGenericKey,
} from '../../../src/provider-secrets/env-parser.js';

describe('parseEnvFile', () => {
  let tempDir: string;
  let envPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `qa-env-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    envPath = join(tempDir, '.env');
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should parse a simple .env file', () => {
    writeFileSync(envPath, 'FOO=bar\nBAZ=qux');
    const result = parseEnvFile(envPath);

    expect(result.success).toBe(true);
    expect(result.values.FOO).toBe('bar');
    expect(result.values.BAZ).toBe('qux');
  });

  it('should handle missing file', () => {
    const result = parseEnvFile(join(tempDir, 'nonexistent.env'));

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(result.values).toEqual({});
  });

  it('should parse AI_ENABLED flag', () => {
    writeFileSync(envPath, 'AI_ENABLED=true\nOPENAI_API_KEY=sk-test');
    const result = parseEnvFile(envPath);

    expect(result.success).toBe(true);
    expect(result.values.AI_ENABLED).toBe('true');
    expect(result.values.OPENAI_API_KEY).toBe('sk-test');
  });

  it('should handle quoted values', () => {
    writeFileSync(envPath, 'QUOTED="value with spaces"\nSINGLE=\'single quotes\'');
    const result = parseEnvFile(envPath);

    expect(result.success).toBe(true);
    expect(result.values.QUOTED).toBe('value with spaces');
    expect(result.values.SINGLE).toBe('single quotes');
  });

  it('should handle comments', () => {
    // Unquoted inline " #" handling differs between Node versions, so values
    // containing " #" must be quoted (documented in .env.example).
    writeFileSync(envPath, '# This is a comment\nKEY="value # not a comment"');
    const result = parseEnvFile(envPath);

    expect(result.success).toBe(true);
    expect(result.values.KEY).toBe('value # not a comment');
    expect(result.values['# This is a comment']).toBeUndefined();
  });

  it('should not modify process.env', () => {
    const originalEnv = { ...process.env };
    writeFileSync(envPath, 'TEST_PARSER_VAR=should_not_appear');
    parseEnvFile(envPath);

    expect(process.env.TEST_PARSER_VAR).toBeUndefined();
    expect(process.env).toEqual(originalEnv);
  });
});

describe('isAiEnabled', () => {
  // Per Task 3.3: Only the exact parsed value "true" (case-sensitive) enables provider calls
  describe('strict case-sensitive enforcement', () => {
    it('should return enabled for exact "true"', () => {
      const result = isAiEnabled({ AI_ENABLED: 'true' });
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('enabled-explicitly');
      expect(result.rawValue).toBe('true');
    });

    it('should return DISABLED for "TRUE" (case-sensitive)', () => {
      // Per Task 3.3: Only exact "true" enables, not "TRUE"
      const result = isAiEnabled({ AI_ENABLED: 'TRUE' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-malformed-flag');
      expect(result.rawValue).toBe('TRUE');
    });

    it('should return DISABLED for "True" (case-sensitive)', () => {
      const result = isAiEnabled({ AI_ENABLED: 'True' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-malformed-flag');
    });

    it('should return DISABLED for "1" (not accepted)', () => {
      // Per Task 3.3: "1" does not enable inference
      const result = isAiEnabled({ AI_ENABLED: '1' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-malformed-flag');
    });

    it('should return DISABLED for "yes" (not accepted)', () => {
      // Per Task 3.3: "yes" does not enable inference
      const result = isAiEnabled({ AI_ENABLED: 'yes' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-malformed-flag');
    });

    it('should return DISABLED for "YES" (not accepted)', () => {
      const result = isAiEnabled({ AI_ENABLED: 'YES' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-malformed-flag');
    });
  });

  describe('explicitly disabled', () => {
    it('should return disabled for "false"', () => {
      const result = isAiEnabled({ AI_ENABLED: 'false' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-explicitly');
    });

    it('should return disabled for empty string', () => {
      const result = isAiEnabled({ AI_ENABLED: '' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-explicitly');
    });

    it('should return disabled for whitespace-only value', () => {
      const result = isAiEnabled({ AI_ENABLED: '   ' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-explicitly');
    });
  });

  describe('missing flag', () => {
    it('should return disabled when AI_ENABLED is missing', () => {
      const result = isAiEnabled({});
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-missing-flag');
    });

    it('key presence alone does not enable inference', () => {
      // Per Task 3.3: Key presence alone never enables inference
      // Even if key is present but empty or malformed
      const result = isAiEnabled({ AI_ENABLED: '' });
      expect(result.enabled).toBe(false);
    });
  });

  describe('malformed values', () => {
    it('should return disabled for "maybe"', () => {
      const result = isAiEnabled({ AI_ENABLED: 'maybe' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-malformed-flag');
      expect(result.rawValue).toBe('maybe');
    });

    it('should return disabled for "0"', () => {
      const result = isAiEnabled({ AI_ENABLED: '0' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-malformed-flag');
    });

    it('should return disabled for "enabled"', () => {
      const result = isAiEnabled({ AI_ENABLED: 'enabled' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-malformed-flag');
    });

    it('should return disabled for "on"', () => {
      const result = isAiEnabled({ AI_ENABLED: 'on' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-malformed-flag');
    });
  });

  describe('fixed variable name', () => {
    // Per Task 3.3: The enable variable is fixed in code as AI_ENABLED
    it('uses fixed AI_ENABLED variable name, not configurable', () => {
      // Any other variable name should not be checked
      const result = isAiEnabled({ CUSTOM_ENABLE: 'true', AI_ENABLED: 'false' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('disabled-explicitly');
    });
  });
});

describe('getEnvSecret', () => {
  it('should return value for existing key', () => {
    const result = getEnvSecret({ API_KEY: 'secret123' }, 'API_KEY');
    expect(result).toBe('secret123');
  });

  it('should return undefined for missing key', () => {
    const result = getEnvSecret({}, 'API_KEY');
    expect(result).toBeUndefined();
  });

  it('should return undefined for empty value', () => {
    const result = getEnvSecret({ API_KEY: '' }, 'API_KEY');
    expect(result).toBeUndefined();
  });

  it('should return undefined for whitespace-only value', () => {
    const result = getEnvSecret({ API_KEY: '   ' }, 'API_KEY');
    expect(result).toBeUndefined();
  });

  describe('placeholder detection', () => {
    // Per Task 3.3: Placeholder values must never count as usable API keys
    it('should return undefined for replace-with-* patterns', () => {
      expect(getEnvSecret({ KEY: 'replace-with-your-openai-api-key' }, 'KEY')).toBeUndefined();
      expect(getEnvSecret({ KEY: 'replace-with-your-anthropic-api-key' }, 'KEY')).toBeUndefined();
      expect(getEnvSecret({ KEY: 'replace-with-your-gemini-api-key' }, 'KEY')).toBeUndefined();
      expect(getEnvSecret({ KEY: 'replace-with-test-password' }, 'KEY')).toBeUndefined();
      expect(getEnvSecret({ KEY: 'Replace-With-Key' }, 'KEY')).toBeUndefined(); // case-insensitive
    });

    it('should return undefined for do-not-use patterns', () => {
      expect(getEnvSecret({ KEY: 'do-not-use-deprecated' }, 'KEY')).toBeUndefined();
      expect(getEnvSecret({ KEY: 'Do-Not-Use' }, 'KEY')).toBeUndefined();
    });

    it('should return undefined for insert-* patterns', () => {
      expect(getEnvSecret({ KEY: 'insert-your-key' }, 'KEY')).toBeUndefined();
      expect(getEnvSecret({ KEY: 'Insert-Key-Here' }, 'KEY')).toBeUndefined();
    });

    it('should return undefined for <placeholder> patterns', () => {
      expect(getEnvSecret({ KEY: '<your-key-here>' }, 'KEY')).toBeUndefined();
      expect(getEnvSecret({ KEY: '<API_KEY>' }, 'KEY')).toBeUndefined();
    });

    it('should return undefined for [placeholder] patterns', () => {
      expect(getEnvSecret({ KEY: '[insert-key]' }, 'KEY')).toBeUndefined();
      expect(getEnvSecret({ KEY: '[YOUR_KEY]' }, 'KEY')).toBeUndefined();
    });

    it('should return undefined for xxx placeholder patterns', () => {
      expect(getEnvSecret({ KEY: 'xxx' }, 'KEY')).toBeUndefined();
      expect(getEnvSecret({ KEY: 'XXXX' }, 'KEY')).toBeUndefined();
      expect(getEnvSecret({ KEY: 'xxxxxxxx' }, 'KEY')).toBeUndefined();
    });

    it('should return undefined for literal "placeholder"', () => {
      expect(getEnvSecret({ KEY: 'placeholder' }, 'KEY')).toBeUndefined();
      expect(getEnvSecret({ KEY: 'PLACEHOLDER' }, 'KEY')).toBeUndefined();
    });

    it('should return valid keys that happen to contain placeholder-like substrings', () => {
      // Real keys that contain "replace" or similar but are not placeholders
      expect(getEnvSecret({ KEY: 'sk-proj-xxxREALKEYxxx' }, 'KEY')).toBe('sk-proj-xxxREALKEYxxx');
      expect(getEnvSecret({ KEY: 'my-real-replacement-key' }, 'KEY')).toBe('my-real-replacement-key');
    });
  });
});

describe('isPlaceholderValue', () => {
  it('should identify empty/whitespace as placeholder', () => {
    expect(isPlaceholderValue('')).toBe(true);
    expect(isPlaceholderValue('   ')).toBe(true);
    expect(isPlaceholderValue('\t\n')).toBe(true);
  });

  it('should identify replace-with-* as placeholder', () => {
    expect(isPlaceholderValue('replace-with-your-key')).toBe(true);
    expect(isPlaceholderValue('REPLACE-WITH-KEY')).toBe(true);
  });

  it('should identify <> and [] delimited as placeholder', () => {
    expect(isPlaceholderValue('<your-key>')).toBe(true);
    expect(isPlaceholderValue('[your-key]')).toBe(true);
  });

  it('should NOT identify real API keys as placeholder', () => {
    expect(isPlaceholderValue('sk-proj-abc123xyz')).toBe(false);
    expect(isPlaceholderValue('anthropic-key-12345')).toBe(false);
    expect(isPlaceholderValue('AIzaSy123456789')).toBe(false);
  });
});

describe('checkLegacyGenericKey', () => {
  it('should return warning when legacy key is present', () => {
    const result = checkLegacyGenericKey({ AI_PROVIDER_API_KEY: 'some-key' });
    expect(result).toBeDefined();
    expect(result).toContain('Deprecated');
    expect(result).toContain('AI_PROVIDER_API_KEY');
  });

  it('should return undefined when legacy key is absent', () => {
    const result = checkLegacyGenericKey({ OPENAI_API_KEY: 'sk-test' });
    expect(result).toBeUndefined();
  });

  it('should return undefined when legacy key is empty', () => {
    const result = checkLegacyGenericKey({ AI_PROVIDER_API_KEY: '' });
    expect(result).toBeUndefined();
  });

  it('should return undefined when legacy key is whitespace', () => {
    const result = checkLegacyGenericKey({ AI_PROVIDER_API_KEY: '   ' });
    expect(result).toBeUndefined();
  });
});
