/**
 * Provider secrets module.
 *
 * Task 3.3: Multi-provider selection and secret resolution.
 *
 * This module provides:
 * - Provider configuration loading from config/ai-providers.json
 * - .env parsing using Node.js built-in util.parseEnv (no process.env mutation)
 * - Secret resolution for selected providers
 * - Child process environment filtering
 *
 * Key principles:
 * - API keys are loaded into an in-memory map, never into process.env
 * - Selecting provider A never resolves provider B's key
 * - AI must be explicitly enabled (AI_ENABLED=true) before any resolution
 * - Child processes receive a filtered environment without provider secrets
 */

// Types
export type {
  ProviderConfigEntry,
  ProviderCapabilities,
  ProvidersConfigFile,
  ParsedEnvFile,
  AiEnablementResult,
  AiEnablementReason,
  ResolvedProviderSecret,
  SecretResolutionResult,
  SecretResolutionError,
  SecretResolutionErrorCode,
  LegacyKeyWarning,
  ProviderSecretMap,
  SecureSecretStorage,
  SecretResolutionContext,
} from './types.js';

// Secure secret storage
export {
  SecureSecretStore,
  createSecureStore,
} from './secure-store.js';

// Environment file parsing
export {
  DEFAULT_ENV_PATH,
  AI_ENABLED_VAR,
  parseEnvFile,
  isAiEnabled,
  getEnvSecret,
  isPlaceholderValue,
  checkLegacyGenericKey,
} from './env-parser.js';

// Provider configuration loading
export {
  DEFAULT_PROVIDERS_CONFIG_PATH,
  ProviderConfigError,
  loadProvidersConfig,
  findProvider,
  getEnabledProviders,
  getRegisteredKeyVarNames,
} from './config-loader.js';

// Secret resolution
export {
  createSecretResolutionContext,
  resolveProviderSecret,
  isAiProviderEnabled,
  getProviderConfig,
  getAvailableProviderIds,
  getResolutionWarnings,
} from './secret-resolver.js';

// Child environment filtering
export {
  type ChildEnvFilterOptions,
  createFilteredChildEnv,
  createFilteredChildEnvFromContext,
  getFilteredVariableNames,
  checkPreservedWindowsVariables,
} from './child-env-filter.js';
