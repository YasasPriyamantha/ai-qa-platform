/**
 * Provider configuration loader.
 *
 * Task 3.3: Load provider configuration from config/ai-providers.json.
 *
 * This file is tracked in version control and contains only
 * non-secret configuration (provider IDs, adapter types, model IDs,
 * and environment variable NAMES for API keys).
 */

import { readFileSync, existsSync } from 'node:fs';
import type { ProvidersConfigFile, ProviderConfigEntry } from './types.js';
import {
  BUILT_IN_PROVIDER_KEY_NAMES,
  CUSTOM_PROVIDER_KEY_PATTERN,
} from '../model-providers/types.js';

/**
 * Default path to provider configuration file.
 */
export const DEFAULT_PROVIDERS_CONFIG_PATH = 'config/ai-providers.json';

/**
 * Error thrown when provider configuration is invalid.
 */
export class ProviderConfigError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown
  ) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

/**
 * Load provider configuration from JSON file.
 *
 * @param configPath - Path to config/ai-providers.json (default: config/ai-providers.json)
 * @returns Validated provider configuration
 * @throws ProviderConfigError if configuration is invalid
 */
export function loadProvidersConfig(
  configPath: string = DEFAULT_PROVIDERS_CONFIG_PATH
): ProvidersConfigFile {
  // Check if file exists
  if (!existsSync(configPath)) {
    throw new ProviderConfigError(
      `Provider configuration file not found: ${configPath}`,
      'configPath',
      configPath
    );
  }

  // Read and parse JSON
  let rawContent: string;
  try {
    rawContent = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new ProviderConfigError(
      `Cannot read provider configuration: ${(err as Error).message}`,
      'configPath',
      configPath
    );
  }

  let rawConfig: unknown;
  try {
    rawConfig = JSON.parse(rawContent);
  } catch {
    throw new ProviderConfigError(
      'Invalid JSON in provider configuration file',
      'configPath',
      configPath
    );
  }

  // Validate structure
  return validateProvidersConfig(rawConfig);
}

/**
 * Validate provider configuration structure.
 *
 * Note: The AI_ENABLED flag is NOT validated here because it is fixed
 * in code and cannot be redirected through configuration (Task 3.3).
 */
function validateProvidersConfig(raw: unknown): ProvidersConfigFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProviderConfigError('Provider configuration must be a JSON object');
  }

  const obj = raw as Record<string, unknown>;

  // Validate version
  if (typeof obj.version !== 'string' || obj.version.trim() === '') {
    throw new ProviderConfigError('version is required', 'version');
  }

  // Note: enableFlag is intentionally NOT validated or used.
  // Per Task 3.3: The enable variable is fixed in code as AI_ENABLED
  // and cannot be redirected through tracked provider configuration.
  // If enableFlag is present in the JSON, it is ignored.

  // Validate providers array
  if (!Array.isArray(obj.providers)) {
    throw new ProviderConfigError('providers must be an array', 'providers');
  }

  const providers: ProviderConfigEntry[] = [];
  const providerIds = new Set<string>();

  for (let i = 0; i < obj.providers.length; i++) {
    const provider = validateProviderEntry(obj.providers[i], i);

    // Check for duplicate provider IDs
    if (providerIds.has(provider.providerId)) {
      throw new ProviderConfigError(
        `Duplicate provider ID: ${provider.providerId}`,
        `providers[${i}].providerId`,
        provider.providerId
      );
    }
    providerIds.add(provider.providerId);

    providers.push(provider);
  }

  return {
    $schema: typeof obj.$schema === 'string' ? obj.$schema : undefined,
    version: obj.version as string,
    description: typeof obj.description === 'string' ? obj.description : undefined,
    providers,
  };
}

/**
 * Validate a single provider entry.
 *
 * Per Task 3.3: Validates that every enabled provider configuration entry
 * has a non-empty modelId.
 */
function validateProviderEntry(raw: unknown, index: number): ProviderConfigEntry {
  const prefix = `providers[${index}]`;

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProviderConfigError(`${prefix} must be an object`);
  }

  const obj = raw as Record<string, unknown>;

  // Required string fields
  const providerId = validateRequiredString(obj, 'providerId', prefix);
  const adapterType = validateRequiredString(obj, 'adapterType', prefix);
  const defaultModelId = validateRequiredString(obj, 'defaultModelId', prefix);
  const apiKeyEnvVar = validateRequiredString(obj, 'apiKeyEnvVar', prefix);

  // Validate apiKeyEnvVar follows the allowed patterns
  validateApiKeyEnvVarName(apiKeyEnvVar, `${prefix}.apiKeyEnvVar`);

  // Optional fields
  const displayName = typeof obj.displayName === 'string' ? obj.displayName : undefined;
  const baseUrl = typeof obj.baseUrl === 'string' ? obj.baseUrl : undefined;
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : true;
  const capabilities = typeof obj.capabilities === 'object' && obj.capabilities !== null
    ? obj.capabilities as ProviderConfigEntry['capabilities']
    : undefined;

  // Per Task 3.3: Validate that every ENABLED provider has a non-empty modelId
  // (This is enforced by validateRequiredString above, but let's be explicit)
  if (enabled && defaultModelId.trim() === '') {
    throw new ProviderConfigError(
      `Enabled provider '${providerId}' must have a non-empty defaultModelId`,
      `${prefix}.defaultModelId`,
      defaultModelId
    );
  }

  return {
    providerId,
    adapterType: adapterType as ProviderConfigEntry['adapterType'],
    defaultModelId,
    apiKeyEnvVar,
    displayName,
    baseUrl,
    enabled,
    capabilities,
  };
}

/**
 * Validate a required string field.
 */
function validateRequiredString(
  obj: Record<string, unknown>,
  field: string,
  prefix: string
): string {
  const value = obj[field];
  if (value === undefined) {
    throw new ProviderConfigError(`${prefix}.${field} is required`, `${prefix}.${field}`);
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProviderConfigError(
      `${prefix}.${field} must be a non-empty string`,
      `${prefix}.${field}`,
      value
    );
  }
  return value;
}

/**
 * Validate that an API key environment variable name follows allowed patterns.
 *
 * Per DEC-034 and DEC-035:
 * - Built-in names: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY
 * - Custom providers: AI_PROVIDER_<PROVIDER_ID>_API_KEY
 */
function validateApiKeyEnvVarName(name: string, fieldPath: string): void {
  // Check built-in names
  if ((BUILT_IN_PROVIDER_KEY_NAMES as readonly string[]).includes(name)) {
    return;
  }

  // Check custom provider pattern
  if (CUSTOM_PROVIDER_KEY_PATTERN.test(name)) {
    return;
  }

  throw new ProviderConfigError(
    `API key environment variable must be one of the built-in names ` +
    `(${BUILT_IN_PROVIDER_KEY_NAMES.join(', ')}) or follow the pattern ` +
    `AI_PROVIDER_<PROVIDER_ID>_API_KEY. Got: ${name}`,
    fieldPath,
    name
  );
}

/**
 * Find a provider by ID.
 */
export function findProvider(
  config: ProvidersConfigFile,
  providerId: string
): ProviderConfigEntry | undefined {
  return config.providers.find((p) => p.providerId === providerId);
}

/**
 * Get all enabled providers.
 */
export function getEnabledProviders(config: ProvidersConfigFile): readonly ProviderConfigEntry[] {
  return config.providers.filter((p) => p.enabled !== false);
}

/**
 * Get all API key environment variable names from provider config.
 * Used for child environment filtering.
 */
export function getRegisteredKeyVarNames(config: ProvidersConfigFile): readonly string[] {
  return config.providers.map((p) => p.apiKeyEnvVar);
}
