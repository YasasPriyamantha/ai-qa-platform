/**
 * ai-check command (Task N4)
 *
 * Without --live: prints the selected provider and model, whether AI is
 * enabled, whether the API key is present (never its value) and the budget
 * limits. Makes no network call.
 *
 * With --live: sends one bounded structured request through executeRequest()
 * with the OpenAI adapter and validates the reply locally. Limits come from
 * config/ai-budget.json and are tracked per run in memory; the usage ledger is
 * not used.
 */

import { join } from 'node:path';
import {
  createSecretResolutionContext,
  getEnabledProviders,
  getEnvSecret,
  type SecretResolutionContext,
} from '../provider-secrets/index.js';
import {
  convertProviderConfigEntry,
  loadBudgetConfig,
  createInitialBudgetState,
  globalAdapterRegistry,
  createOpenAIAdapter,
  executeRequest,
  DEFAULT_LIFECYCLE_CONFIG,
  createCanonicalSchema,
  userMessage,
  getUsageValueOrUndefined,
  z,
  type BudgetConfig,
  type BudgetState,
  type ModelRequest,
  type ProviderAdapter,
  type UsageValue,
} from '../model-providers/index.js';
import { displayError } from './output.js';
import { EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';

/** Schema for the live check reply: `{ "status": "ok" }`. */
const AI_CHECK_SCHEMA = createCanonicalSchema({
  id: 'ai-check',
  version: 1,
  name: 'ai_check',
  zodSchema: z.object({ status: z.literal('ok') }).strict(),
});

export interface AiCheckOptions {
  /** Send one live request. */
  readonly live: boolean;
  /** Directory holding .env and config/ (default: current working directory). */
  readonly rootDir?: string;
  /** Adapter override; tests inject a mock. Default: the OpenAI adapter. */
  readonly adapter?: ProviderAdapter;
}

/**
 * Execute the ai-check command.
 *
 * @returns Exit code
 */
export async function executeAiCheckCommand(options: AiCheckOptions): Promise<number> {
  const rootDir = options.rootDir ?? process.cwd();

  let secretContext: SecretResolutionContext;
  try {
    secretContext = createSecretResolutionContext({
      envFilePath: join(rootDir, '.env'),
      providerConfigPath: join(rootDir, 'config', 'ai-providers.json'),
    });
  } catch (err) {
    displayError('Cannot load AI provider configuration', (err as Error).message);
    return EXIT_FAILURE;
  }

  const entry = getEnabledProviders(secretContext.providerConfig)[0];
  if (!entry) {
    displayError('No enabled provider in config/ai-providers.json');
    return EXIT_FAILURE;
  }
  const converted = convertProviderConfigEntry(entry);
  if (!converted.success || !converted.config) {
    displayError('Invalid provider configuration', converted.errors.join('; '));
    return EXIT_FAILURE;
  }
  const provider = converted.config;

  const { enablement, envFile } = secretContext;
  const keyPresent = envFile.success && getEnvSecret(envFile.values, provider.apiKeyEnvVar) !== undefined;
  const budget = loadBudgetConfig(rootDir);

  console.log('');
  console.log('  AI check');
  console.log('');
  console.log(`  Provider:    ${provider.displayName ?? provider.providerId} (${provider.providerId}, ${provider.adapterType})`);
  console.log(`  Model:       ${provider.defaultModelId}`);
  console.log(`  AI enabled:  ${enablement.enabled ? 'yes' : 'no'} (${enablement.reason})`);
  console.log(`  API key:     ${provider.apiKeyEnvVar} ${keyPresent ? 'present' : 'missing'}`);
  if (budget.success) {
    printBudget(budget.config);
  } else {
    console.log(`  Budget:      not configured (${budget.error.message})`);
  }
  for (const warning of secretContext.warnings) {
    console.log(`  Warning:     ${warning}`);
  }
  console.log('');

  if (!options.live) {
    return EXIT_SUCCESS;
  }

  // Refuse before any network call.
  if (!enablement.enabled) {
    displayError('Live check refused: AI is disabled', 'Set AI_ENABLED=true in .env.');
    return EXIT_FAILURE;
  }
  if (!keyPresent) {
    displayError('Live check refused: API key missing', `Set ${provider.apiKeyEnvVar} in .env.`);
    return EXIT_FAILURE;
  }
  if (!budget.success) {
    displayError('Live check refused: no valid budget', [budget.error.message, ...(budget.error.details ?? [])].join(' '));
    return EXIT_FAILURE;
  }
  if (provider.adapterType !== 'openai-responses') {
    displayError(`Live check supports only the openai-responses adapter, not ${provider.adapterType}`);
    return EXIT_FAILURE;
  }

  // Per-run budget state, kept in memory only. executeRequest() does not update it.
  let budgetState: BudgetState = createInitialBudgetState(budget.config.window);
  const maxOutputTokens = budget.config.maxOutputTokensPerRequest;

  globalAdapterRegistry.register(options.adapter ?? createOpenAIAdapter());

  const request: ModelRequest = {
    providerId: provider.providerId,
    modelId: provider.defaultModelId,
    instructions: 'You are a connectivity check. Reply only with the JSON object {"status":"ok"}.',
    messages: [userMessage('Connectivity check.')],
    structuredOutput: { schema: AI_CHECK_SCHEMA },
    options: { maxTokens: maxOutputTokens },
  };

  console.log('  Sending one live request...');
  const outcome = await executeRequest(request, {
    secretContext,
    budgetConfig: budget.config,
    budgetState,
    // One bounded request: no automatic retries.
    config: { ...DEFAULT_LIFECYCLE_CONFIG, maxAttempts: 1 },
  });

  const observed = outcome.usageMetadata.observed;
  if (outcome.finalAttemptNumber > 0) {
    budgetState = {
      ...budgetState,
      requestCount: budgetState.requestCount + 1,
      // Unknown usage counts as the full reservation, never as zero.
      cumulativeInputTokens: budgetState.cumulativeInputTokens + (knownValue(observed?.inputTokens) ?? 0),
      cumulativeOutputTokens: budgetState.cumulativeOutputTokens + (knownValue(observed?.outputTokens) ?? maxOutputTokens),
    };
  }

  if (!outcome.result.success) {
    const { error } = outcome.result;
    displayError(`Live check failed: ${error.code}`, error.message);
    printRunUsage(budgetState, budget.config);
    return EXIT_FAILURE;
  }

  const { response } = outcome.result;
  const validation = AI_CHECK_SCHEMA.validate(response.structuredOutput);
  if (!validation.success) {
    displayError(
      'Live check failed: reply did not match the expected schema',
      (validation.errors ?? []).map((e) => `${e.path.join('.') || '(root)'}: ${e.message}`).join('; ')
    );
    printRunUsage(budgetState, budget.config);
    return EXIT_FAILURE;
  }

  console.log('');
  console.log('  Live check passed');
  console.log(`  Result:      ${JSON.stringify(validation.data)} (validated locally)`);
  console.log(`  Model:       ${response.identity.modelId}`);
  console.log(`  Request ID:  ${response.providerRequestId ?? 'unknown'}`);
  console.log(`  Duration:    ${outcome.diagnostics.totalDurationMs}ms`);
  console.log(
    `  Usage:       input ${formatUsage(observed?.inputTokens)}, output ${formatUsage(observed?.outputTokens)}, ` +
    `total ${formatUsage(observed?.totalTokens)}, reasoning ${formatUsage(observed?.reasoningTokens)}`
  );
  printRunUsage(budgetState, budget.config);
  console.log('');
  return EXIT_SUCCESS;
}

function printBudget(config: BudgetConfig): void {
  console.log('  Budget:      config/ai-budget.json');
  console.log(`    Requests per run:          ${config.maxTotalRequests}`);
  console.log(`    Input tokens per request:  ${config.maxInputTokensPerRequest}`);
  console.log(`    Output tokens per request: ${config.maxOutputTokensPerRequest}`);
  console.log(`    Cumulative input tokens:   ${config.maxCumulativeInputTokens}`);
  console.log(`    Cumulative output tokens:  ${config.maxCumulativeOutputTokens}`);
}

function printRunUsage(state: BudgetState, config: BudgetConfig): void {
  console.log(
    `  This run:    ${state.requestCount}/${config.maxTotalRequests} requests, ` +
    `${state.cumulativeInputTokens}/${config.maxCumulativeInputTokens} input tokens, ` +
    `${state.cumulativeOutputTokens}/${config.maxCumulativeOutputTokens} output tokens`
  );
}

function knownValue(value: UsageValue | undefined): number | undefined {
  return value ? getUsageValueOrUndefined(value) : undefined;
}

function formatUsage(value: UsageValue | undefined): string {
  const known = knownValue(value);
  return known === undefined ? 'unknown' : String(known);
}
