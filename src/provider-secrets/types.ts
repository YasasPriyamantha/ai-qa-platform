/**
 * Provider secrets configuration types.
 *
 * Task 3.3: Multi-provider selection and secret resolution.
 *
 * This module defines types for:
 * - Provider configuration from config/ai-providers.json (extends shared base)
 * - Secret resolution without mutating process.env
 * - AI_ENABLED flag handling
 *
 * Per Task 3.3 type consistency requirements:
 * - Shared provider identity fields are defined in ProviderConfigBase (model-providers/types.ts)
 * - ProviderConfigEntry extends the base and adds optional simplified capabilities
 * - This avoids duplicating field definitions across modules
 */

import type { ProviderConfigBase, CapabilityState } from '../model-providers/types.js';

/**
 * Provider entry in config/ai-providers.json.
 *
 * Extends ProviderConfigBase with optional simplified capabilities suitable
 * for JSON configuration. The full DeclaredCapabilities (with schemaKeywords)
 * is not required in the JSON config file; defaults are applied at runtime
 * when full capabilities are needed.
 *
 * Fields inherited from ProviderConfigBase:
 * - providerId: Unique identifier
 * - adapterType: API protocol adapter
 * - defaultModelId: Default model for this provider
 * - baseUrl?: Optional API base URL
 * - apiKeyEnvVar: Environment variable name for API key
 * - displayName?: Human-readable name
 * - enabled?: Whether provider is active (default: true)
 */
export interface ProviderConfigEntry extends ProviderConfigBase {
  /**
   * Declared capabilities for this provider/model.
   * Optional in JSON config - simplified structure without schemaKeywords.
   * Full DeclaredCapabilities are computed at runtime when needed.
   */
  readonly capabilities?: ProviderCapabilities;
}

/**
 * Simplified capabilities in provider config JSON.
 */
export interface ProviderCapabilities {
  toolCalling?: CapabilityState;
  strictJsonSchema?: CapabilityState;
  usageReporting?: CapabilityState;
  reasoning?: CapabilityState;
  streaming?: CapabilityState;
  imageInput?: CapabilityState;
}

/**
 * Root structure of config/ai-providers.json.
 *
 * Note: The AI_ENABLED flag is NOT configurable through this file.
 * Per Task 3.3 security requirements, the enable variable is fixed
 * in code as AI_ENABLED and cannot be redirected through configuration.
 */
export interface ProvidersConfigFile {
  /** Schema reference */
  readonly $schema?: string;

  /** Configuration version */
  readonly version: string;

  /** Description */
  readonly description?: string;

  /** Provider entries */
  readonly providers: readonly ProviderConfigEntry[];
}

/**
 * Result of parsing the .env file.
 * Contains only the parsed values, never mutates process.env.
 */
export interface ParsedEnvFile {
  /** Parsed key-value pairs */
  readonly values: Readonly<Record<string, string>>;

  /** Whether the file was successfully parsed */
  readonly success: boolean;

  /** Error message if parsing failed */
  readonly error?: string;

  /** Path to the .env file (for diagnostics) */
  readonly filePath: string;
}

/**
 * Result of resolving AI provider enablement.
 */
export interface AiEnablementResult {
  /** Whether AI provider calls are enabled */
  readonly enabled: boolean;

  /** Reason for the enablement state */
  readonly reason: AiEnablementReason;

  /** Original value of AI_ENABLED from .env (for diagnostics) */
  readonly rawValue?: string;
}

/**
 * Reasons for AI enablement state.
 */
export type AiEnablementReason =
  | 'enabled-explicitly'      // AI_ENABLED=true
  | 'disabled-explicitly'     // AI_ENABLED=false
  | 'disabled-missing-flag'   // AI_ENABLED not set
  | 'disabled-malformed-flag' // AI_ENABLED set to invalid value
  | 'disabled-env-missing'    // .env file doesn't exist
  | 'disabled-env-error';     // .env file couldn't be parsed

/**
 * Resolved secret for a specific provider.
 * Contains the API key value (sensitive - never log or serialize).
 */
export interface ResolvedProviderSecret {
  /** Provider ID this secret is for */
  readonly providerId: string;

  /** Environment variable name */
  readonly envVarName: string;

  /** The actual API key value (SENSITIVE - never log) */
  readonly apiKey: string;
}

/**
 * Result of resolving a provider's secret.
 */
export interface SecretResolutionResult {
  /** Whether the secret was successfully resolved */
  readonly success: boolean;

  /** The resolved secret (only if success) */
  readonly secret?: ResolvedProviderSecret;

  /** Error if resolution failed */
  readonly error?: SecretResolutionError;
}

/**
 * Error during secret resolution.
 */
export interface SecretResolutionError {
  /** Error code */
  readonly code: SecretResolutionErrorCode;

  /** Human-readable error message (never contains the secret value) */
  readonly message: string;

  /** Environment variable name involved (safe to log) */
  readonly envVarName?: string;

  /** Provider ID involved (safe to log) */
  readonly providerId?: string;
}

/**
 * Error codes for secret resolution.
 */
export type SecretResolutionErrorCode =
  | 'provider-not-found'
  | 'provider-disabled'
  | 'ai-not-enabled'
  | 'env-var-missing'
  | 'env-var-empty'
  | 'env-file-missing'
  | 'env-file-error'
  | 'invalid-key-name';

/**
 * Legacy generic key warning.
 */
export interface LegacyKeyWarning {
  /** The legacy variable name */
  readonly variableName: 'AI_PROVIDER_API_KEY';

  /** Warning message */
  readonly message: string;
}

/**
 * Map of provider secrets (in-memory, never serialized).
 * Key is provider ID, value is the resolved secret.
 *
 * @deprecated Use SecureSecretStore for new code - it prevents serialization leaks.
 */
export type ProviderSecretMap = ReadonlyMap<string, ResolvedProviderSecret>;

/**
 * Interface for secure secret storage.
 *
 * This abstraction allows the context to hold secrets without
 * coupling to the concrete SecureSecretStore class.
 *
 * Secret values are protected from serialization and can only
 * be accessed through explicit get() calls.
 */
export interface SecureSecretStorage {
  /** Number of stored secrets */
  readonly size: number;
  /** Check if a secret exists for a provider */
  has(providerId: string): boolean;
  /** Get a secret (explicit access only) */
  get(providerId: string): ResolvedProviderSecret | undefined;
  /** Get all provider IDs that have secrets */
  keys(): IterableIterator<string>;
}

/**
 * Full secret resolution context.
 * Contains all resolved information needed for provider selection.
 */
export interface SecretResolutionContext {
  /** Parsed .env file */
  readonly envFile: ParsedEnvFile;

  /** AI enablement result */
  readonly enablement: AiEnablementResult;

  /** Provider configuration */
  readonly providerConfig: ProvidersConfigFile;

  /**
   * Resolved secrets (only populated if AI is enabled).
   *
   * This is a secure store that protects secret values from
   * serialization. Use secrets.get(providerId) for explicit access.
   */
  readonly secrets: SecureSecretStorage;

  /** Warnings (e.g., legacy key detected) */
  readonly warnings: readonly string[];

  /** Registered provider key variable names (for child env filtering) */
  readonly registeredKeyVars: readonly string[];
}
