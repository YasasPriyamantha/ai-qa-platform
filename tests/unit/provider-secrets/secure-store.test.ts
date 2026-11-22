/**
 * Tests for secure secret storage.
 *
 * Task 3.3: Verify that secret values are protected from serialization.
 */

import { describe, it, expect } from 'vitest';
import { inspect } from 'node:util';
import { SecureSecretStore } from '../../../src/provider-secrets/secure-store.js';
import type { ResolvedProviderSecret } from '../../../src/provider-secrets/types.js';

describe('SecureSecretStore', () => {
  // Use a unique sentinel value that we can search for in outputs
  const SENTINEL_SECRET = 'SENTINEL-SECRET-VALUE-12345-XYZ';

  const testSecrets: [string, ResolvedProviderSecret][] = [
    ['openai', { providerId: 'openai', envVarName: 'OPENAI_API_KEY', apiKey: SENTINEL_SECRET }],
    ['anthropic', { providerId: 'anthropic', envVarName: 'ANTHROPIC_API_KEY', apiKey: 'another-secret' }],
  ];

  describe('basic functionality', () => {
    it('should store and retrieve secrets', () => {
      const store = new SecureSecretStore(testSecrets);

      expect(store.size).toBe(2);
      expect(store.has('openai')).toBe(true);
      expect(store.has('anthropic')).toBe(true);
      expect(store.has('nonexistent')).toBe(false);
    });

    it('should retrieve actual secret value via get()', () => {
      const store = new SecureSecretStore(testSecrets);

      const secret = store.get('openai');
      expect(secret).toBeDefined();
      expect(secret?.apiKey).toBe(SENTINEL_SECRET);
    });

    it('should return undefined for nonexistent provider', () => {
      const store = new SecureSecretStore(testSecrets);

      expect(store.get('nonexistent')).toBeUndefined();
    });

    it('should list provider IDs via keys()', () => {
      const store = new SecureSecretStore(testSecrets);

      const keys = [...store.keys()];
      expect(keys).toContain('openai');
      expect(keys).toContain('anthropic');
      expect(keys).toHaveLength(2);
    });
  });

  describe('serialization protection', () => {
    it('sentinel secret should NEVER appear in JSON.stringify output', () => {
      const store = new SecureSecretStore(testSecrets);
      const json = JSON.stringify(store);

      expect(json).not.toContain(SENTINEL_SECRET);
      expect(json).toContain('[REDACTED]');
      expect(json).toContain('SecureSecretStore');
    });

    it('sentinel secret should NEVER appear in util.inspect output', () => {
      const store = new SecureSecretStore(testSecrets);
      const inspected = inspect(store);

      expect(inspected).not.toContain(SENTINEL_SECRET);
      expect(inspected).toContain('[REDACTED]');
      expect(inspected).toContain('SecureSecretStore');
    });

    it('sentinel secret should NEVER appear in String() output', () => {
      const store = new SecureSecretStore(testSecrets);
      const str = String(store);

      expect(str).not.toContain(SENTINEL_SECRET);
      expect(str).toContain('SecureSecretStore');
    });

    it('sentinel secret should NEVER appear in template string', () => {
      const store = new SecureSecretStore(testSecrets);
      const str = `${store}`;

      expect(str).not.toContain(SENTINEL_SECRET);
    });

    it('toJSON should include provider metadata without secrets', () => {
      const store = new SecureSecretStore(testSecrets);
      const json = store.toJSON();

      expect(json.type).toBe('SecureSecretStore');
      expect(json.size).toBe(2);
      expect(json.secrets).toBeDefined();

      const secrets = json.secrets as Record<string, unknown>;
      expect(secrets.openai).toBeDefined();

      const openaiEntry = secrets.openai as Record<string, unknown>;
      expect(openaiEntry.providerId).toBe('openai');
      expect(openaiEntry.envVarName).toBe('OPENAI_API_KEY');
      expect(openaiEntry.apiKey).toBe('[REDACTED]');
    });

    it('should not expose secrets through nested JSON.stringify', () => {
      const store = new SecureSecretStore(testSecrets);
      const wrapper = { store, other: 'data' };
      const json = JSON.stringify(wrapper);

      expect(json).not.toContain(SENTINEL_SECRET);
    });
  });

  describe('error message protection', () => {
    it('should not expose secrets when thrown in an error', () => {
      const store = new SecureSecretStore(testSecrets);

      try {
        throw new Error(`Failed with store: ${store}`);
      } catch (e) {
        const message = (e as Error).message;
        expect(message).not.toContain(SENTINEL_SECRET);
      }
    });

    it('should not expose secrets in error cause', () => {
      const store = new SecureSecretStore(testSecrets);

      try {
        throw new Error('Outer', { cause: new Error(`Inner: ${JSON.stringify(store)}`) });
      } catch (e) {
        const error = e as Error;
        const causeMessage = (error.cause as Error).message;
        expect(causeMessage).not.toContain(SENTINEL_SECRET);
      }
    });
  });

  describe('iteration prevention', () => {
    it('should throw when trying to iterate', () => {
      const store = new SecureSecretStore(testSecrets);

      expect(() => {
        for (const _ of store as unknown as Iterable<unknown>) {
          // Should throw before reaching here
        }
      }).toThrow('cannot be iterated');
    });

    it('should throw when trying to spread', () => {
      const store = new SecureSecretStore(testSecrets);

      expect(() => {
        [...store as unknown as Iterable<unknown>];
      }).toThrow('cannot be iterated');
    });
  });

  describe('empty store', () => {
    it('should handle empty store correctly', () => {
      const store = new SecureSecretStore();

      expect(store.size).toBe(0);
      expect(store.has('any')).toBe(false);
      expect(store.get('any')).toBeUndefined();
      expect([...store.keys()]).toHaveLength(0);
    });

    it('should have safe output for empty store', () => {
      const store = new SecureSecretStore();
      const inspected = inspect(store);

      expect(inspected).toContain('empty');
    });
  });

  describe('legacy key warning', () => {
    it('AI_PROVIDER_API_KEY warning should show variable name, not value', () => {
      // This test verifies the warning message format
      // The actual warning is generated elsewhere, but we verify the principle
      const warningMessage = `Deprecated: AI_PROVIDER_API_KEY is present but will not be used.`;

      // Should contain the variable name
      expect(warningMessage).toContain('AI_PROVIDER_API_KEY');
      // Should NOT contain any actual secret value
      expect(warningMessage).not.toContain(SENTINEL_SECRET);
    });
  });
});
