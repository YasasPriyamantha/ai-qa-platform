/**
 * Secure secret storage.
 *
 * Task 3.3: Protect secret values from exposure through serialization.
 *
 * Secret values must not be exposed by default through:
 * - JSON.stringify
 * - util.inspect
 * - String()
 * - error messages
 * - logs or diagnostics
 *
 * The underlying storage is private. Secret values are available only
 * through an explicit accessor used by the credential boundary/adapter handoff.
 */

import type { InspectOptionsStylized } from 'node:util';
import type { ResolvedProviderSecret } from './types.js';

/**
 * Redacted placeholder shown in serialization outputs.
 */
const REDACTED = '[REDACTED]';

/**
 * Custom inspect symbol for Node.js util.inspect.
 */
const customInspect = Symbol.for('nodejs.util.inspect.custom');

/**
 * Secure storage for resolved provider secrets.
 *
 * This class protects secret values from accidental exposure by:
 * - Storing secrets in a private field
 * - Returning redacted values in toJSON, toString, and inspect
 * - Requiring explicit method calls to access actual secret values
 *
 * Usage:
 * - Use `get(providerId)` to retrieve a secret for adapter handoff
 * - Use `has(providerId)` to check if a secret exists
 * - Use `size` to get the count of stored secrets
 *
 * The secret values NEVER appear in:
 * - JSON.stringify(store) - returns redacted structure
 * - util.inspect(store) - returns redacted structure
 * - String(store) - returns safe description
 * - console.log(store) - uses util.inspect
 */
export class SecureSecretStore {
  /**
   * Private storage for secrets - not accessible from outside.
   */
  readonly #secrets: Map<string, ResolvedProviderSecret>;

  constructor(secrets: Iterable<[string, ResolvedProviderSecret]> = []) {
    this.#secrets = new Map(secrets);
  }

  /**
   * Get the number of stored secrets.
   */
  get size(): number {
    return this.#secrets.size;
  }

  /**
   * Check if a secret exists for a provider ID.
   * This is safe - it does not expose the secret value.
   */
  has(providerId: string): boolean {
    return this.#secrets.has(providerId);
  }

  /**
   * Get a secret by provider ID.
   * This is the ONLY way to access the actual secret value.
   * Use this for credential boundary/adapter handoff.
   */
  get(providerId: string): ResolvedProviderSecret | undefined {
    return this.#secrets.get(providerId);
  }

  /**
   * Get all provider IDs that have secrets.
   * Safe - does not expose secret values.
   */
  keys(): IterableIterator<string> {
    return this.#secrets.keys();
  }

  /**
   * Custom JSON serialization - returns redacted structure.
   * Secret values are NEVER included in JSON output.
   */
  toJSON(): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    for (const [providerId, secret] of this.#secrets) {
      redacted[providerId] = {
        providerId: secret.providerId,
        envVarName: secret.envVarName,
        apiKey: REDACTED,
      };
    }
    return {
      type: 'SecureSecretStore',
      size: this.#secrets.size,
      secrets: redacted,
    };
  }

  /**
   * Custom string representation - safe, no secrets.
   */
  toString(): string {
    return `SecureSecretStore(${this.#secrets.size} secrets)`;
  }

  /**
   * Custom inspect implementation for util.inspect and console.log.
   * Secret values are NEVER included in inspect output.
   */
  [customInspect](_depth: number, _options: InspectOptionsStylized): string {
    const providerIds = [...this.#secrets.keys()];
    if (providerIds.length === 0) {
      return 'SecureSecretStore { empty }';
    }
    return `SecureSecretStore { providers: [${providerIds.join(', ')}], values: ${REDACTED} }`;
  }

  /**
   * Prevent accidental iteration that might expose values.
   * Use get() with specific provider IDs instead.
   */
  [Symbol.iterator](): never {
    throw new Error('SecureSecretStore cannot be iterated - use get(providerId) for explicit access');
  }
}

/**
 * Create a secure secret store from a plain Map.
 * Used during secret resolution to convert the working Map to secure storage.
 */
export function createSecureStore(
  secrets: Map<string, ResolvedProviderSecret>
): SecureSecretStore {
  return new SecureSecretStore(secrets.entries());
}
