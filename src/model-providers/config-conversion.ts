/**
 * Provider configuration conversion.
 *
 * Task 3.3a: Explicit conversion from ProviderConfigEntry (JSON) to ProviderConfig (runtime).
 *
 * Key principles:
 * - Capabilities not declared must become 'unknown', not 'supported'
 * - Do not infer support for features merely because provider is configured
 * - One explicit conversion function
 */

import type { ProviderConfigEntry, ProviderCapabilities } from '../provider-secrets/types.js';
import type {
  ProviderConfig,
  DeclaredCapabilities,
  SchemaKeywordSupport,
  CapabilityState,
} from './types.js';
import { createUnknownCapabilities } from './types.js';

/**
 * Result of converting ProviderConfigEntry to ProviderConfig.
 */
export interface ConfigConversionResult {
  /**
   * Whether conversion succeeded.
   */
  readonly success: boolean;

  /**
   * The converted provider config (only if success).
   */
  readonly config?: ProviderConfig;

  /**
   * Conversion errors (if any).
   */
  readonly errors: readonly string[];

  /**
   * Warnings about capability inference (if any).
   */
  readonly warnings: readonly string[];
}

/**
 * Convert a ProviderConfigEntry (JSON config input) to ProviderConfig (runtime).
 *
 * This is the single explicit conversion function.
 *
 * IMPORTANT: Capabilities not declared in the input become 'unknown'.
 * We do NOT infer support for schema keywords, structured output, tool calling,
 * or other provider features merely because the provider is configured.
 *
 * @param entry - The JSON config entry to convert
 * @returns Conversion result with the runtime config or errors
 */
export function convertProviderConfigEntry(entry: ProviderConfigEntry): ConfigConversionResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate required fields
  if (!entry.providerId || entry.providerId.trim() === '') {
    errors.push('providerId is required');
  }

  if (!entry.adapterType || entry.adapterType.trim() === '') {
    errors.push('adapterType is required');
  }

  if (!entry.defaultModelId || entry.defaultModelId.trim() === '') {
    errors.push('defaultModelId is required');
  }

  if (!entry.apiKeyEnvVar || entry.apiKeyEnvVar.trim() === '') {
    errors.push('apiKeyEnvVar is required');
  }

  if (errors.length > 0) {
    return { success: false, errors, warnings };
  }

  // Convert capabilities with defaults to 'unknown'
  const capabilities = convertCapabilities(entry.capabilities, warnings);

  // Build the runtime config
  const config: ProviderConfig = {
    providerId: entry.providerId,
    adapterType: entry.adapterType,
    defaultModelId: entry.defaultModelId,
    apiKeyEnvVar: entry.apiKeyEnvVar,
    baseUrl: entry.baseUrl,
    displayName: entry.displayName,
    enabled: entry.enabled,
    capabilities,
  };

  return {
    success: true,
    config,
    errors: [],
    warnings,
  };
}

/**
 * Convert simplified ProviderCapabilities to full DeclaredCapabilities.
 *
 * Missing fields default to 'unknown', NOT 'supported'.
 *
 * @param input - Optional simplified capabilities from JSON config
 * @param warnings - Array to collect warnings
 * @returns Full DeclaredCapabilities with 'unknown' for missing fields
 */
function convertCapabilities(
  input: ProviderCapabilities | undefined,
  warnings: string[]
): DeclaredCapabilities {
  // Start with all unknown
  const result = createUnknownCapabilities();

  if (!input) {
    warnings.push('No capabilities declared - all capabilities set to unknown');
    return result;
  }

  // Apply declared values, leaving undeclared as 'unknown'
  if (input.toolCalling !== undefined) {
    result.toolCalling = input.toolCalling;
  }

  if (input.strictJsonSchema !== undefined) {
    result.strictJsonSchema = input.strictJsonSchema;
  }

  if (input.usageReporting !== undefined) {
    result.usageReporting = input.usageReporting;
  }

  if (input.reasoning !== undefined) {
    result.reasoning = input.reasoning;
  }

  if (input.streaming !== undefined) {
    result.streaming = input.streaming;
  }

  if (input.imageInput !== undefined) {
    result.imageInput = input.imageInput;
  }

  // Note: schemaKeywords is NOT in simplified ProviderCapabilities
  // so it always defaults to all 'unknown'
  // This is intentional per Task 3.3a: "Do not infer support for schema keywords"

  return result;
}

/**
 * Convert multiple provider config entries.
 *
 * @param entries - Array of JSON config entries
 * @returns Array of conversion results
 */
export function convertProviderConfigEntries(
  entries: readonly ProviderConfigEntry[]
): readonly ConfigConversionResult[] {
  return entries.map(convertProviderConfigEntry);
}

/**
 * Get successfully converted configs only.
 *
 * @param results - Conversion results
 * @returns Array of successfully converted configs
 */
export function getSuccessfulConfigs(
  results: readonly ConfigConversionResult[]
): readonly ProviderConfig[] {
  return results
    .filter((r) => r.success && r.config !== undefined)
    .map((r) => r.config!);
}

/**
 * Check if a capability is supported.
 *
 * Returns true only if the capability is explicitly 'supported'.
 * Returns false for 'unsupported' or 'unknown'.
 */
export function isCapabilitySupported(state: CapabilityState): boolean {
  return state === 'supported';
}

/**
 * Check if a capability is not supported.
 *
 * Returns true if the capability is 'unsupported'.
 * Returns false for 'supported' or 'unknown'.
 */
export function isCapabilityUnsupported(state: CapabilityState): boolean {
  return state === 'unsupported';
}

/**
 * Check if a capability state is unknown.
 *
 * Returns true if the capability is 'unknown'.
 */
export function isCapabilityUnknown(state: CapabilityState): boolean {
  return state === 'unknown';
}

/**
 * Require a capability to be supported.
 *
 * @param config - Provider configuration
 * @param capability - Capability name
 * @returns Error message if not supported, undefined if supported
 */
export function requireCapability(
  config: ProviderConfig,
  capability: keyof DeclaredCapabilities
): string | undefined {
  const state = config.capabilities[capability];

  if (typeof state === 'object') {
    // This is SchemaKeywordSupport, not a CapabilityState
    // SchemaKeywordSupport requires checking individual fields
    return `${capability} is a composite capability - check individual fields`;
  }

  if (state === 'supported') {
    return undefined;
  }

  if (state === 'unsupported') {
    return `Provider '${config.providerId}' does not support ${capability}`;
  }

  // 'unknown' - we can't verify
  return `Provider '${config.providerId}' has unknown ${capability} support - cannot verify`;
}

/**
 * Check all schema keywords for support.
 *
 * @param keywords - SchemaKeywordSupport to check
 * @returns Object with supported/unsupported/unknown keyword arrays
 */
export function categorizeSchemaKeywords(keywords: SchemaKeywordSupport): {
  supported: readonly string[];
  unsupported: readonly string[];
  unknown: readonly string[];
} {
  const supported: string[] = [];
  const unsupported: string[] = [];
  const unknown: string[] = [];

  const fields = [
    'baseTypes',
    'objectKeywords',
    'arrayKeywords',
    'stringValidation',
    'numericValidation',
    'compositionKeywords',
    'referenceKeywords',
  ] as const;

  for (const field of fields) {
    const state = keywords[field];
    if (state === 'supported') {
      supported.push(field);
    } else if (state === 'unsupported') {
      unsupported.push(field);
    } else {
      unknown.push(field);
    }
  }

  return { supported, unsupported, unknown };
}
