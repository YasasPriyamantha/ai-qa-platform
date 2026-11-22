/**
 * Tests for child environment filtering.
 *
 * Task 3.3: Verify provider secrets are stripped from child process environment.
 */

import { describe, it, expect } from 'vitest';
import {
  createFilteredChildEnv,
  getFilteredVariableNames,
  checkPreservedWindowsVariables,
} from '../../../src/provider-secrets/child-env-filter.js';

describe('createFilteredChildEnv', () => {
  describe('built-in provider key filtering', () => {
    it('should remove OPENAI_API_KEY', () => {
      const baseEnv = { OPENAI_API_KEY: 'sk-test', PATH: '/usr/bin' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.OPENAI_API_KEY).toBeUndefined();
      expect(result.PATH).toBe('/usr/bin');
    });

    it('should remove ANTHROPIC_API_KEY', () => {
      const baseEnv = { ANTHROPIC_API_KEY: 'sk-test', PATH: '/usr/bin' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    });

    it('should remove GEMINI_API_KEY', () => {
      const baseEnv = { GEMINI_API_KEY: 'sk-test', PATH: '/usr/bin' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.GEMINI_API_KEY).toBeUndefined();
    });

    it('should remove all built-in keys simultaneously', () => {
      const baseEnv = {
        OPENAI_API_KEY: 'sk-openai',
        ANTHROPIC_API_KEY: 'sk-anthropic',
        GEMINI_API_KEY: 'sk-gemini',
        PATH: '/usr/bin',
      };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.OPENAI_API_KEY).toBeUndefined();
      expect(result.ANTHROPIC_API_KEY).toBeUndefined();
      expect(result.GEMINI_API_KEY).toBeUndefined();
      expect(result.PATH).toBe('/usr/bin');
    });

    describe('case-insensitive filtering (Task 3.3 requirement 9)', () => {
      it('should remove openai_api_key (lowercase)', () => {
        const baseEnv = { openai_api_key: 'sk-test', PATH: '/usr/bin' };
        const result = createFilteredChildEnv({ baseEnv });

        expect(result.openai_api_key).toBeUndefined();
      });

      it('should remove Openai_Api_Key (mixed case)', () => {
        const baseEnv = { Openai_Api_Key: 'sk-test', PATH: '/usr/bin' };
        const result = createFilteredChildEnv({ baseEnv });

        expect(result.Openai_Api_Key).toBeUndefined();
      });

      it('should remove anthropic_api_key (lowercase)', () => {
        const baseEnv = { anthropic_api_key: 'sk-test', PATH: '/usr/bin' };
        const result = createFilteredChildEnv({ baseEnv });

        expect(result.anthropic_api_key).toBeUndefined();
      });

      it('should remove gemini_api_key (lowercase)', () => {
        const baseEnv = { gemini_api_key: 'sk-test', PATH: '/usr/bin' };
        const result = createFilteredChildEnv({ baseEnv });

        expect(result.gemini_api_key).toBeUndefined();
      });

      it('should remove mixed-case variants of all built-in keys', () => {
        const baseEnv = {
          OpenAI_API_Key: 'sk-openai',
          Anthropic_Api_KEY: 'sk-anthropic',
          GEMINI_api_key: 'sk-gemini',
          PATH: '/usr/bin',
        };
        const result = createFilteredChildEnv({ baseEnv });

        expect(result.OpenAI_API_Key).toBeUndefined();
        expect(result.Anthropic_Api_KEY).toBeUndefined();
        expect(result.GEMINI_api_key).toBeUndefined();
        expect(result.PATH).toBe('/usr/bin');
      });
    });
  });

  describe('AI_PROVIDER_* prefix filtering', () => {
    it('should remove AI_PROVIDER_* variables (uppercase)', () => {
      const baseEnv = { AI_PROVIDER_CUSTOM_API_KEY: 'secret', PATH: '/usr/bin' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.AI_PROVIDER_CUSTOM_API_KEY).toBeUndefined();
    });

    it('should remove AI_PROVIDER_* variables (lowercase)', () => {
      const baseEnv = { ai_provider_custom_api_key: 'secret', PATH: '/usr/bin' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.ai_provider_custom_api_key).toBeUndefined();
    });

    it('should remove AI_PROVIDER_* variables (mixed case)', () => {
      const baseEnv = { Ai_Provider_Custom_Api_Key: 'secret', PATH: '/usr/bin' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.Ai_Provider_Custom_Api_Key).toBeUndefined();
    });

    it('should remove deprecated AI_PROVIDER_API_KEY', () => {
      const baseEnv = { AI_PROVIDER_API_KEY: 'legacy', PATH: '/usr/bin' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.AI_PROVIDER_API_KEY).toBeUndefined();
    });
  });

  describe('registered key variable filtering', () => {
    it('should remove registered key variables', () => {
      const baseEnv = { CUSTOM_KEY: 'secret', PATH: '/usr/bin' };
      const result = createFilteredChildEnv({
        baseEnv,
        registeredKeyVars: ['CUSTOM_KEY'],
      });

      expect(result.CUSTOM_KEY).toBeUndefined();
    });

    it('should handle case-insensitive registered keys', () => {
      const baseEnv = { custom_key: 'secret', PATH: '/usr/bin' };
      const result = createFilteredChildEnv({
        baseEnv,
        registeredKeyVars: ['CUSTOM_KEY'],
      });

      expect(result.custom_key).toBeUndefined();
    });
  });

  describe('Windows system variable preservation', () => {
    it('should preserve PATH', () => {
      const baseEnv = { PATH: 'C:\\Windows\\System32', OPENAI_API_KEY: 'sk-test' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.PATH).toBe('C:\\Windows\\System32');
    });

    it('should preserve SystemRoot', () => {
      const baseEnv = { SystemRoot: 'C:\\Windows', OPENAI_API_KEY: 'sk-test' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.SystemRoot).toBe('C:\\Windows');
    });

    it('should preserve LOCALAPPDATA', () => {
      const baseEnv = { LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local', OPENAI_API_KEY: 'sk-test' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.LOCALAPPDATA).toBe('C:\\Users\\Test\\AppData\\Local');
    });

    it('should preserve USERPROFILE', () => {
      const baseEnv = { USERPROFILE: 'C:\\Users\\Test', OPENAI_API_KEY: 'sk-test' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.USERPROFILE).toBe('C:\\Users\\Test');
    });

    it('should preserve PLAYWRIGHT_BROWSERS_PATH', () => {
      const baseEnv = { PLAYWRIGHT_BROWSERS_PATH: 'C:\\Browsers', OPENAI_API_KEY: 'sk-test' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.PLAYWRIGHT_BROWSERS_PATH).toBe('C:\\Browsers');
    });

    it('should preserve TEMP and TMP', () => {
      const baseEnv = { TEMP: 'C:\\Temp', TMP: 'C:\\Temp', OPENAI_API_KEY: 'sk-test' };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.TEMP).toBe('C:\\Temp');
      expect(result.TMP).toBe('C:\\Temp');
    });
  });

  describe('additions', () => {
    it('should add additional variables after filtering', () => {
      const baseEnv = { PATH: '/usr/bin' };
      const result = createFilteredChildEnv({
        baseEnv,
        additions: { QA_PROJECT_CONFIG_PATH: '/path/to/config' },
      });

      expect(result.QA_PROJECT_CONFIG_PATH).toBe('/path/to/config');
    });

    it('should not remove additions even if they match filter patterns', () => {
      // This is an edge case - additions are added AFTER filtering
      const baseEnv = { PATH: '/usr/bin' };
      const result = createFilteredChildEnv({
        baseEnv,
        additions: { QA_RUN_DIR: '/runs/123' },
      });

      expect(result.QA_RUN_DIR).toBe('/runs/123');
    });
  });

  describe('ordinary variables preservation', () => {
    it('should preserve SAUCEDEMO_* test credentials', () => {
      const baseEnv = {
        SAUCEDEMO_STANDARD_USER_USERNAME: 'standard_user',
        SAUCEDEMO_STANDARD_USER_PASSWORD: 'secret_sauce',
        OPENAI_API_KEY: 'sk-test',
      };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.SAUCEDEMO_STANDARD_USER_USERNAME).toBe('standard_user');
      expect(result.SAUCEDEMO_STANDARD_USER_PASSWORD).toBe('secret_sauce');
      expect(result.OPENAI_API_KEY).toBeUndefined();
    });

    it('should preserve other app environment variables', () => {
      const baseEnv = {
        DATABASE_URL: 'postgres://localhost',
        NODE_ENV: 'test',
        OPENAI_API_KEY: 'sk-test',
      };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.DATABASE_URL).toBe('postgres://localhost');
      expect(result.NODE_ENV).toBe('test');
    });
  });

  describe('required variables preservation (Task 3.3 requirement 9)', () => {
    it('should preserve LOCALAPPDATA for Playwright child process', () => {
      const baseEnv = {
        LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
        OPENAI_API_KEY: 'sk-test',
      };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.LOCALAPPDATA).toBe('C:\\Users\\Test\\AppData\\Local');
    });

    it('should preserve USERPROFILE for Playwright child process', () => {
      const baseEnv = {
        USERPROFILE: 'C:\\Users\\Test',
        OPENAI_API_KEY: 'sk-test',
      };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.USERPROFILE).toBe('C:\\Users\\Test');
    });

    it('should preserve PLAYWRIGHT_BROWSERS_PATH for Playwright child process', () => {
      const baseEnv = {
        PLAYWRIGHT_BROWSERS_PATH: 'C:\\Browsers',
        OPENAI_API_KEY: 'sk-test',
      };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.PLAYWRIGHT_BROWSERS_PATH).toBe('C:\\Browsers');
    });

    it('should preserve PATH for Playwright child process', () => {
      const baseEnv = {
        PATH: 'C:\\Windows\\System32;C:\\nodejs',
        OPENAI_API_KEY: 'sk-test',
      };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.PATH).toBe('C:\\Windows\\System32;C:\\nodejs');
    });

    it('should preserve SystemRoot for Playwright child process', () => {
      const baseEnv = {
        SystemRoot: 'C:\\Windows',
        OPENAI_API_KEY: 'sk-test',
      };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.SystemRoot).toBe('C:\\Windows');
    });

    it('should preserve TEMP for Playwright child process', () => {
      const baseEnv = {
        TEMP: 'C:\\Users\\Test\\AppData\\Local\\Temp',
        OPENAI_API_KEY: 'sk-test',
      };
      const result = createFilteredChildEnv({ baseEnv });

      expect(result.TEMP).toBe('C:\\Users\\Test\\AppData\\Local\\Temp');
    });

    it('should preserve QA_PROJECT_CONFIG_PATH for runner', () => {
      const baseEnv = {
        OPENAI_API_KEY: 'sk-test',
      };
      const result = createFilteredChildEnv({
        baseEnv,
        additions: { QA_PROJECT_CONFIG_PATH: 'C:\\projects\\saucedemo\\project.config.json' },
      });

      expect(result.QA_PROJECT_CONFIG_PATH).toBe('C:\\projects\\saucedemo\\project.config.json');
    });

    it('should preserve QA_RUN_DIR for runner', () => {
      const baseEnv = {
        OPENAI_API_KEY: 'sk-test',
      };
      const result = createFilteredChildEnv({
        baseEnv,
        additions: { QA_RUN_DIR: 'C:\\projects\\saucedemo\\artifacts\\run-123' },
      });

      expect(result.QA_RUN_DIR).toBe('C:\\projects\\saucedemo\\artifacts\\run-123');
    });

    it('should preserve all required variables simultaneously', () => {
      const baseEnv = {
        LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
        USERPROFILE: 'C:\\Users\\Test',
        PLAYWRIGHT_BROWSERS_PATH: 'C:\\Browsers',
        PATH: 'C:\\Windows\\System32',
        SystemRoot: 'C:\\Windows',
        TEMP: 'C:\\Temp',
        SAUCEDEMO_STANDARD_USER_USERNAME: 'standard_user',
        SAUCEDEMO_STANDARD_USER_PASSWORD: 'secret_sauce',
        OPENAI_API_KEY: 'sk-openai',
        ANTHROPIC_API_KEY: 'sk-anthropic',
        AI_PROVIDER_CUSTOM_API_KEY: 'sk-custom',
      };
      const result = createFilteredChildEnv({
        baseEnv,
        additions: {
          QA_PROJECT_CONFIG_PATH: '/path/to/config',
          QA_RUN_DIR: '/path/to/run',
        },
      });

      // These should be preserved
      expect(result.LOCALAPPDATA).toBe('C:\\Users\\Test\\AppData\\Local');
      expect(result.USERPROFILE).toBe('C:\\Users\\Test');
      expect(result.PLAYWRIGHT_BROWSERS_PATH).toBe('C:\\Browsers');
      expect(result.PATH).toBe('C:\\Windows\\System32');
      expect(result.SystemRoot).toBe('C:\\Windows');
      expect(result.TEMP).toBe('C:\\Temp');
      expect(result.QA_PROJECT_CONFIG_PATH).toBe('/path/to/config');
      expect(result.QA_RUN_DIR).toBe('/path/to/run');
      expect(result.SAUCEDEMO_STANDARD_USER_USERNAME).toBe('standard_user');
      expect(result.SAUCEDEMO_STANDARD_USER_PASSWORD).toBe('secret_sauce');

      // These should be filtered out
      expect(result.OPENAI_API_KEY).toBeUndefined();
      expect(result.ANTHROPIC_API_KEY).toBeUndefined();
      expect(result.AI_PROVIDER_CUSTOM_API_KEY).toBeUndefined();
    });
  });
});

describe('getFilteredVariableNames', () => {
  it('should return names of variables that would be removed', () => {
    const baseEnv = {
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'sk-test',
      AI_PROVIDER_CUSTOM_API_KEY: 'sk-test',
      PATH: '/usr/bin',
    };
    const result = getFilteredVariableNames(baseEnv);

    expect(result).toContain('OPENAI_API_KEY');
    expect(result).toContain('ANTHROPIC_API_KEY');
    expect(result).toContain('AI_PROVIDER_CUSTOM_API_KEY');
    expect(result).not.toContain('PATH');
  });

  it('should include registered key vars', () => {
    const baseEnv = { CUSTOM_KEY: 'secret' };
    const result = getFilteredVariableNames(baseEnv, ['CUSTOM_KEY']);

    expect(result).toContain('CUSTOM_KEY');
  });
});

describe('checkPreservedWindowsVariables', () => {
  it('should return empty array when critical vars present', () => {
    const env = {
      PATH: 'C:\\Windows',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      TMP: 'C:\\Temp',
    };
    const result = checkPreservedWindowsVariables(env);

    expect(result).toHaveLength(0);
  });

  it('should return missing critical variables', () => {
    const env = { PATH: 'C:\\Windows' };
    const result = checkPreservedWindowsVariables(env);

    expect(result).toContain('SystemRoot');
    expect(result).toContain('TEMP');
    expect(result).toContain('TMP');
  });
});
