/**
 * Provider secret resolution.
 *
 * Task 3.3: Resolve provider API keys from .env without mutating process.env.
 *
 * Key principles:
 * - Secrets are resolved into an in-memory map
 * - Never log or serialize the secret map
 * - Selecting provider A never resolves provider B's key
 * - AI must be explicitly enabled before any resolution
 */

import type {
  ProvidersConfigFile,
  ProviderConfigEntry,
  AiEnablementResult,
  ResolvedProviderSecret,
  SecretResolutionResult,
  SecretResolutionContext,
  SecureSecretStorage,
  AiEnablementReason,
} from './types.js';
import { parseEnvFile, isAiEnabled, getEnvSecret, checkLegacyGenericKey, AI_ENABLED_VAR } from './env-parser.js';
import { loadProvidersConfig, getRegisteredKeyVarNames } from './config-loader.js';
import { SecureSecretStore } from './secure-store.js';

/**
 * Create a full secret resolution context.
 *
 * This is the main entry point for secret resolution. It:
 * 1. Loads provider configuration
 * 2. Parses .env file without mutating process.env
 * 3. Checks AI enablement
 * 4. Resolves secrets for enabled providers (only if AI is enabled)
 *
 * @param options - Resolution options
 * @returns Full resolution context
 */
export function createSecretResolutionContext(options: {
  envFilePath?: string;
  providerConfigPath?: string;
} = {}): SecretResolutionContext {
  const warnings: string[] = [];

  // Load provider configuration (tracked file)
  const providerConfig = loadProvidersConfig(options.providerConfigPath);

  // Parse .env file (without mutating process.env)
  const envFile = parseEnvFile(options.envFilePath);

  // Check AI enablement using fixed AI_ENABLED variable
  // Per Task 3.3: The enable variable is fixed in code, not configurable
  let enablement: AiEnablementResult;
  if (!envFile.success) {
    enablement = {
      enabled: false,
      reason: envFile.error?.includes('not found') ? 'disabled-env-missing' : 'disabled-env-error',
    };
  } else {
    // Uses fixed AI_ENABLED_VAR from env-parser.ts
    const { enabled, reason, rawValue } = isAiEnabled(envFile.values);
    enablement = {
      enabled,
      reason: reason as AiEnablementReason,
      rawValue,
    };
  }

  // Check for legacy generic key
  if (envFile.success) {
    const legacyWarning = checkLegacyGenericKey(envFile.values);
    if (legacyWarning) {
      warnings.push(legacyWarning);
    }
  }

  // Get registered key variable names (for child env filtering)
  const registeredKeyVars = getRegisteredKeyVarNames(providerConfig);

  // Only resolve secrets if AI is enabled
  // Use SecureSecretStore to protect values from serialization
  let secrets: SecureSecretStorage;
  if (enablement.enabled && envFile.success) {
    const secretMap = resolveAllProviderSecrets(providerConfig, envFile.values);
    secrets = new SecureSecretStore(secretMap.entries());
  } else {
    secrets = new SecureSecretStore();
  }

  return {
    envFile,
    enablement,
    providerConfig,
    secrets,
    warnings,
    registeredKeyVars,
  };
}

/**
 * Resolve secrets for all enabled providers.
 *
 * @param config - Provider configuration
 * @param envValues - Parsed environment values
 * @returns Map of provider ID to resolved secret
 */
function resolveAllProviderSecrets(
  config: ProvidersConfigFile,
  envValues: Readonly<Record<string, string>>
): Map<string, ResolvedProviderSecret> {
  const secrets = new Map<string, ResolvedProviderSecret>();

  for (const provider of config.providers) {
    // Skip disabled providers
    if (provider.enabled === false) {
      continue;
    }

    // Try to resolve secret
    const apiKey = getEnvSecret(envValues, provider.apiKeyEnvVar);
    if (apiKey) {
      secrets.set(provider.providerId, {
        providerId: provider.providerId,
        envVarName: provider.apiKeyEnvVar,
        apiKey,
      });
    }
  }

  return secrets;
}

/**
 * Resolve a secret for a specific provider.
 *
 * This function enforces all safety checks:
 * - AI must be enabled
 * - Provider must exist and be enabled
 * - API key must be present and non-empty
 *
 * @param context - Secret resolution context
 * @param providerId - Provider ID to resolve
 * @returns Resolution result
 */
export function resolveProviderSecret(
  context: SecretResolutionContext,
  providerId: string
): SecretResolutionResult {
  // Check AI enablement first (using fixed AI_ENABLED variable)
  if (!context.enablement.enabled) {
    return {
      success: false,
      error: {
        code: 'ai-not-enabled',
        message: `AI provider calls are disabled. ` +
          `Set ${AI_ENABLED_VAR}=true in .env to enable (exact case-sensitive value required). ` +
          `Reason: ${context.enablement.reason}`,
        providerId,
      },
    };
  }

  // Find provider
  const provider = context.providerConfig.providers.find((p) => p.providerId === providerId);
  if (!provider) {
    return {
      success: false,
      error: {
        code: 'provider-not-found',
        message: `Provider not found: ${providerId}`,
        providerId,
      },
    };
  }

  // Check provider enabled
  if (provider.enabled === false) {
    return {
      success: false,
      error: {
        code: 'provider-disabled',
        message: `Provider is disabled: ${providerId}`,
        providerId,
      },
    };
  }

  // Get from pre-resolved secrets
  const secret = context.secrets.get(providerId);
  if (!secret) {
    return {
      success: false,
      error: {
        code: 'env-var-missing',
        message: `API key not found for provider ${providerId}. ` +
          `Set ${provider.apiKeyEnvVar} in .env`,
        envVarName: provider.apiKeyEnvVar,
        providerId,
      },
    };
  }

  return {
    success: true,
    secret,
  };
}

/**
 * Check if AI provider calls are enabled.
 *
 * Quick check without resolving secrets.
 */
export function isAiProviderEnabled(context: SecretResolutionContext): boolean {
  return context.enablement.enabled;
}

/**
 * Get provider configuration by ID.
 */
export function getProviderConfig(
  context: SecretResolutionContext,
  providerId: string
): ProviderConfigEntry | undefined {
  return context.providerConfig.providers.find((p) => p.providerId === providerId);
}

/**
 * Get list of available (enabled and configured) provider IDs.
 */
export function getAvailableProviderIds(context: SecretResolutionContext): readonly string[] {
  if (!context.enablement.enabled) {
    return [];
  }

  return context.providerConfig.providers
    .filter((p) => p.enabled !== false && context.secrets.has(p.providerId))
    .map((p) => p.providerId);
}

/**
 * Get all warnings from the resolution context.
 */
export function getResolutionWarnings(context: SecretResolutionContext): readonly string[] {
  return context.warnings;
}
