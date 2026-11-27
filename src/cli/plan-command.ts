/**
 * plan command (Task Q3, DEC-041 §1–§5)
 *
 * Plans requirement-traced test scenarios from requirements and saved
 * observation records, and saves the checked scenario set to
 * `specs/candidates/<plan-id>.json`. Unknown or retired requirements and
 * unreadable observation records are refused before any AI request;
 * unresolved requirements are excluded and listed with the reason.
 */

import { resolve } from 'node:path';
import { loadPhase2ProjectConfig, ConfigValidationError, getProjectStoragePaths } from '../projects/index.js';
import { isActionable, loadRequirementRegistry, type RequirementWithHistory } from '../requirements/index.js';
import { createOpenAIAdapter, type ProviderAdapter } from '../model-providers/index.js';
import { loadObservation, planScenarios, type LoadedObservation } from '../planning/planner.js';
import { loadAiSetup } from './ai-setup.js';
import { displayError } from './output.js';
import { EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';

export interface PlanCommandOptions {
  readonly configPath: string;
  readonly requirementIds: readonly string[];
  readonly explorationIds: readonly string[];
  /** Directory holding .env and config/ (default: current working directory). */
  readonly rootDir?: string;
  /** Adapter override; tests inject a fake. Default: the OpenAI adapter. */
  readonly adapter?: ProviderAdapter;
}

export async function executePlanCommand(options: PlanCommandOptions): Promise<number> {
  const refuse = (title: string, details?: string) => {
    displayError(`Planning refused: ${title}`, details);
    return EXIT_FAILURE;
  };
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    return refuse(err instanceof ConfigValidationError ? 'invalid project configuration' : 'cannot load project configuration', (err as Error).message);
  }

  let stored: Record<string, RequirementWithHistory>;
  try {
    stored = loadRequirementRegistry(getProjectStoragePaths(config.projectWorkspace).requirementsRegistryPath).requirements;
  } catch (err) {
    return refuse('cannot read the requirement registry', (err as Error).message);
  }
  const unknown = options.requirementIds.filter((id) => stored[id]?.status !== 'active');
  if (unknown.length > 0) return refuse('unknown or retired requirement', unknown.join(', '));
  const requested = options.requirementIds.map((id) => stored[id]);
  const requirements = requested.filter(isActionable);
  const excluded = requested.filter((r) => !isActionable(r))
    .map((r) => ({ requirementId: r.requirementId, reason: r.unresolved?.reason ?? 'no expected result' }));
  for (const e of excluded) console.log(`  Excluded ${e.requirementId} (unresolved): ${e.reason}`);
  if (requirements.length === 0) return refuse('no active, resolved requirement to plan');

  let observations: LoadedObservation[];
  try {
    observations = options.explorationIds.map((id) => loadObservation(config.projectWorkspace, id));
  } catch (err) {
    return refuse('cannot use the observation record', (err as Error).message);
  }

  const ai = loadAiSetup(options.rootDir ?? process.cwd());
  if (!ai.ok) return refuse(ai.title, ai.details);
  const { secretContext, provider, budget } = ai.setup;
  const credentialPlaceholders = (config.roles ?? []).flatMap((role) =>
    Object.keys(role.credentials).map((k) => `{{credential:${role.roleId}.${k}}}`));

  console.log(`  Planning ${requirements.map((r) => r.requirementId).join(', ')} (${config.projectId}, ${provider.providerId} ${provider.defaultModelId})...`);
  let saved;
  try {
    saved = await planScenarios({
      projectId: config.projectId,
      projectWorkspace: config.projectWorkspace,
      requirements,
      excluded,
      observations,
      credentialPlaceholders,
      providerId: provider.providerId,
      modelId: provider.defaultModelId,
      adapter: options.adapter ?? createOpenAIAdapter(),
      secretContext,
      budgetConfig: budget,
    });
  } catch (err) {
    displayError('Planning failed', (err as Error).message);
    return EXIT_FAILURE;
  }
  const { set, path } = saved;
  console.log('');
  console.log(`  Stop reason:  ${set.stopReason}${set.error ? ` (${set.error})` : ''}`);
  console.log(`  Scenarios:    ${set.scenarios.length}/${set.limits.maxScenarios}`);
  for (const s of set.scenarios) {
    const unobserved = s.steps.filter((step) => step.locatorSource === 'needs-observation').length;
    console.log(`    - ${s.scenarioId} [${s.requirementIds.join(', ')}] ${s.title}${unobserved ? ` (needs-observation: ${unobserved} step(s))` : ''}`);
  }
  for (const r of set.rejected) console.log(`  Rejected:     ${r.title}: ${r.reasons.join('; ')}`);
  for (const n of set.notCovered) console.log(`  Not covered:  ${n.requirementId} ${n.case}`);
  for (const c of set.conflicts) console.log(`  Conflict:     ${c}`);
  for (const q of set.questions) console.log(`  Question:     ${q}`);
  console.log(`  Tokens:       input ${set.usage.inputTokens}, output ${set.usage.outputTokens} (${set.usage.aiRequests} request(s))`);
  console.log(`  Plan:         ${path}`);
  console.log('');
  return set.stopReason === 'completed' || set.stopReason === 'scenario_limit' ? EXIT_SUCCESS : EXIT_FAILURE;
}
