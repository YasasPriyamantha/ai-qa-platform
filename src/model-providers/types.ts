/**
 * Provider configuration and capability types.
 *
 * Implements the provider-neutral multi-provider interface from DEC-034 and Task 3.2.
 *
 * Key principles:
 * - Multiple provider entries/keys may coexist
 * - No business logic depends on a specific provider ID
 * - Capabilities are model-specific, not provider-wide guarantees
 * - Credentials are environment variables, never direct values
 */

/**
 * Built-in adapter types for direct provider integrations.
 *
 * Per DEC-034:
 * - openai-responses: Native OpenAI Responses API
 * - openai-chat-completions: OpenAI-compatible Chat Completions API (separate adapter)
 * - anthropic-messages: Native Anthropic Messages API
 * - google-gemini: Native Google Gemini API
 */
export type BuiltInAdapterType =
  | 'openai-responses'
  | 'openai-chat-completions'
  | 'anthropic-messages'
  | 'google-gemini';

/**
 * Adapter type including custom adapters.
 */
export type AdapterType = BuiltInAdapterType | `custom:${string}`;

/**
 * Base provider configuration fields shared between JSON input and runtime types.
 *
 * This interface contains all provider identity and credential fields that are
 * shared between the JSON config representation (ProviderConfigEntry) and the
 * runtime representation (ProviderConfig).
 *
 * Per Task 3.3: This base type enables composition/extension rather than
 * duplicating field definitions across provider-secrets and model-providers.
 */
export interface ProviderConfigBase {
  /**
   * Unique identifier for this provider configuration.
   * Used to reference the provider in workflows and requests.
   * Must be a lowercase slug (same pattern as project IDs).
   */
  readonly providerId: string;

  /**
   * Adapter type that handles this provider's API protocol.
   */
  readonly adapterType: AdapterType;

  /**
   * Default model ID for this provider.
   * Can be overridden per request.
   */
  readonly defaultModelId: string;

  /**
   * Optional base URL for API requests.
   * Required for OpenAI-compatible endpoints that aren't OpenAI.
   * Must be a valid URL without trailing slash.
   */
  readonly baseUrl?: string;

  /**
   * Environment variable name containing the API key.
   * Per DEC-034/DEC-035: Must be one of the built-in names
   * (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY)
   * or follow the AI_PROVIDER_<ID>_API_KEY pattern for custom providers.
   * Never contains the actual secret value.
   */
  readonly apiKeyEnvVar: string;

  /**
   * Optional display name for the provider.
   */
  readonly displayName?: string;

  /**
   * Whether this provider is enabled for use.
   * @default true
   */
  readonly enabled?: boolean;
}

/**
 * Full provider configuration with required capabilities.
 *
 * Used at runtime when full capability information is required.
 * Extends ProviderConfigBase with required DeclaredCapabilities.
 */
export interface ProviderConfig extends ProviderConfigBase {
  /**
   * Declared capabilities for this provider/model combination.
   * These are configuration-time declarations; actual support is
   * verified at runtime by the adapter.
   */
  readonly capabilities: DeclaredCapabilities;
}

/**
 * Capability state indicating support level.
 *
 * - 'supported': Feature is known to work with this provider/model
 * - 'unsupported': Feature is known not to work
 * - 'unknown': Feature support has not been verified
 */
export type CapabilityState = 'supported' | 'unsupported' | 'unknown';

/**
 * Declared capabilities for a provider/model combination.
 *
 * Per Task 3.2 requirement 7: These are not provider-wide guarantees;
 * capabilities vary by model and API version.
 */
export interface DeclaredCapabilities {
  /**
   * Tool/function calling support.
   */
  toolCalling: CapabilityState;

  /**
   * Strict JSON schema enforcement in structured output.
   * Some providers support 'strict: true' schema validation.
   */
  strictJsonSchema: CapabilityState;

  /**
   * Which JSON Schema keywords are supported.
   * Different providers support different subsets of JSON Schema.
   */
  schemaKeywords: SchemaKeywordSupport;

  /**
   * Token usage reporting in responses.
   */
  usageReporting: CapabilityState;

  /**
   * Extended reasoning or thinking capability.
   * Includes OpenAI reasoning items, Anthropic thinking blocks, etc.
   */
  reasoning: CapabilityState;

  /**
   * Whether conversation continuation requires opaque state preservation.
   * Some providers require passing back reasoning/thinking state.
   */
  continuationRequired: CapabilityState;

  /**
   * Maximum context window size in tokens.
   * 0 or undefined means unknown/not specified.
   */
  maxContextTokens?: number;

  /**
   * Maximum output tokens per response.
   * 0 or undefined means unknown/not specified.
   */
  maxOutputTokens?: number;

  /**
   * Streaming response support.
   */
  streaming: CapabilityState;

  /**
   * Image input support (vision).
   */
  imageInput: CapabilityState;
}

/**
 * JSON Schema keyword support levels.
 *
 * Different providers support different JSON Schema draft versions
 * and keyword subsets.
 */
export interface SchemaKeywordSupport {
  /**
   * Base type keywords: type, enum, const.
   */
  baseTypes: CapabilityState;

  /**
   * Object keywords: properties, required, additionalProperties.
   */
  objectKeywords: CapabilityState;

  /**
   * Array keywords: items, minItems, maxItems.
   */
  arrayKeywords: CapabilityState;

  /**
   * String validation: minLength, maxLength, pattern, format.
   */
  stringValidation: CapabilityState;

  /**
   * Numeric validation: minimum, maximum, multipleOf.
   */
  numericValidation: CapabilityState;

  /**
   * Composition keywords: anyOf, oneOf, allOf.
   */
  compositionKeywords: CapabilityState;

  /**
   * Reference keywords: $ref, $defs.
   */
  referenceKeywords: CapabilityState;
}

/**
 * Create default capabilities with all states set to 'unknown'.
 */
export function createUnknownCapabilities(): DeclaredCapabilities {
  return {
    toolCalling: 'unknown',
    strictJsonSchema: 'unknown',
    schemaKeywords: {
      baseTypes: 'unknown',
      objectKeywords: 'unknown',
      arrayKeywords: 'unknown',
      stringValidation: 'unknown',
      numericValidation: 'unknown',
      compositionKeywords: 'unknown',
      referenceKeywords: 'unknown',
    },
    usageReporting: 'unknown',
    reasoning: 'unknown',
    continuationRequired: 'unknown',
    streaming: 'unknown',
    imageInput: 'unknown',
  };
}

/**
 * Built-in provider key names that cannot be used as custom provider keys.
 * Per DEC-034 and DEC-035.
 */
export const BUILT_IN_PROVIDER_KEY_NAMES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
] as const;

/**
 * Pattern for custom provider API key environment variables.
 * Per DEC-034: AI_PROVIDER_<PROVIDER_ID>_API_KEY
 */
export const CUSTOM_PROVIDER_KEY_PATTERN = /^AI_PROVIDER_[A-Z][A-Z0-9_]*_API_KEY$/;

/**
 * Check if an environment variable name is a valid provider API key name.
 */
export function isValidProviderKeyName(envVarName: string): boolean {
  // Built-in names
  if ((BUILT_IN_PROVIDER_KEY_NAMES as readonly string[]).includes(envVarName)) {
    return true;
  }

  // Custom provider pattern
  return CUSTOM_PROVIDER_KEY_PATTERN.test(envVarName);
}

/**
 * Provider configuration identity tuple.
 * Used to scope opaque continuation state.
 */
export interface ProviderIdentity {
  readonly providerId: string;
  readonly adapterType: AdapterType;
  readonly modelId: string;
}

/**
 * Check if two provider identities match exactly.
 */
export function providerIdentitiesMatch(
  a: ProviderIdentity,
  b: ProviderIdentity
): boolean {
  return (
    a.providerId === b.providerId &&
    a.adapterType === b.adapterType &&
    a.modelId === b.modelId
  );
}
