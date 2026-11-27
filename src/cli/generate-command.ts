/**
 * generate command (Task Q4, DEC-041 §2–§5)
 *
 * Writes type-checked candidate files to `tests/candidates/` from a saved plan
 * with deterministic templates (no AI), reports each skipped scenario with the
 * reasons, and marks the plan `generated` with each candidate file path.
 */

import { join, resolve } from 'node:path';
import { loadPhase2ProjectConfig, ConfigValidationError, getProjectStoragePaths } from '../projects/index.js';
import { loadRequirementRegistry } from '../requirements/index.js';
import { getEnvSecret, parseEnvFile } from '../provider-secrets/index.js';
import { generateCandidates } from '../planning/generator.js';
import { displayError } from './output.js';
import { EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';

export interface GenerateCommandOptions {
  readonly configPath: string;
  readonly planId: string;
  /** Overwrite existing candidate files. */
  readonly replace: boolean;
  /** Directory holding .env (default: current working directory). */
  readonly rootDir?: string;
}

export function executeGenerateCommand(options: GenerateCommandOptions): number {
  const refuse = (title: string, details?: string) => {
    displayError(`Generation refused: ${title}`, details);
    return EXIT_FAILURE;
  };
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    return refuse(err instanceof ConfigValidationError ? 'invalid project configuration' : 'cannot load project configuration', (err as Error).message);
  }
  let requirements;
  try {
    requirements = loadRequirementRegistry(getProjectStoragePaths(config.projectWorkspace).requirementsRegistryPath).requirements;
  } catch (err) {
    return refuse('cannot read the requirement registry', (err as Error).message);
  }
  // Credential values are read only to refuse any candidate that contains one (never written or printed).
  const envFile = parseEnvFile(join(options.rootDir ?? process.cwd(), '.env'));
  const credentialValues = new Map<string, string>();
  for (const variable of (config.roles ?? []).flatMap((r) => Object.values(r.credentials))) {
    const value = envFile.success ? getEnvSecret(envFile.values, variable) : undefined;
    if (value !== undefined) credentialValues.set(variable, value);
  }

  let result;
  try {
    result = generateCandidates(options.planId, { config, requirements, credentialValues }, options.replace);
  } catch (err) {
    return refuse('cannot generate candidates', (err as Error).message);
  }
  console.log('');
  for (const g of result.generated) console.log(`  Generated:  ${g.scenarioId} -> ${g.file}`);
  for (const s of result.skipped) console.log(`  Skipped:    ${s.scenarioId}: ${s.reasons.join('; ')}`);
  console.log(`  Candidates: ${result.generated.length} written, ${result.skipped.length} skipped`);
  console.log(`  Plan:       ${result.planPath} (status ${result.set.status})`);
  console.log('');
  return result.generated.length > 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
