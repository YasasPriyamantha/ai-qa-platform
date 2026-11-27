/**
 * AI preconditions shared by the AI commands (explore, plan).
 *
 * Loads `.env` and `config/ai-providers.json`, picks the first enabled provider
 * and loads `config/ai-budget.json`. Refuses unless AI is enabled, the API key
 * is present, the budget is valid and the adapter is openai-responses (DEC-039).
 */

import { join } from 'node:path';
import { createSecretResolutionContext, getEnabledProviders, getEnvSecret, type SecretResolutionContext } from '../provider-secrets/index.js';
import { convertProviderConfigEntry, loadBudgetConfig, type BudgetConfig, type ProviderConfig } from '../model-providers/index.js';

export interface AiSetup {
  readonly secretContext: SecretResolutionContext;
  readonly provider: ProviderConfig;
  readonly budget: BudgetConfig;
}

export type AiSetupResult = { readonly ok: true; readonly setup: AiSetup } | { readonly ok: false; readonly title: string; readonly details?: string };

export function loadAiSetup(rootDir: string): AiSetupResult {
  const refuse = (title: string, details?: string): AiSetupResult => ({ ok: false, title, ...(details ? { details } : {}) });
  let secretContext: SecretResolutionContext;
  try {
    secretContext = createSecretResolutionContext({
      envFilePath: join(rootDir, '.env'),
      providerConfigPath: join(rootDir, 'config', 'ai-providers.json'),
    });
  } catch (err) {
    return refuse('cannot load AI provider configuration', (err as Error).message);
  }
  const entry = getEnabledProviders(secretContext.providerConfig)[0];
  const converted = entry ? convertProviderConfigEntry(entry) : undefined;
  if (!converted?.success || !converted.config) return refuse('no valid enabled provider in config/ai-providers.json');
  const provider = converted.config;
  const { enablement, envFile } = secretContext;
  if (!enablement.enabled) return refuse('AI is disabled', 'Set AI_ENABLED=true in .env.');
  if (!envFile.success || getEnvSecret(envFile.values, provider.apiKeyEnvVar) === undefined) {
    return refuse('API key missing', `Set ${provider.apiKeyEnvVar} in .env.`);
  }
  const budget = loadBudgetConfig(rootDir);
  if (!budget.success) return refuse('no valid budget', [budget.error.message, ...(budget.error.details ?? [])].join(' '));
  if (provider.adapterType !== 'openai-responses') {
    return refuse(`only the openai-responses adapter is supported, not ${provider.adapterType}`);
  }
  return { ok: true, setup: { secretContext, provider, budget: budget.config } };
}
