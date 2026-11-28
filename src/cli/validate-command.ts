/**
 * validate command (Task V2, DEC-042 §3.1, §3.4–§3.6)
 *
 * Checks each selected candidate of a plan (unchanged since generation, credentials
 * set), runs the remaining ones in three separate executions of the existing runner
 * against the candidates folder with --workers=1, and records the verdict per
 * scenario in the plan file. No AI calls. Exits 0 only when every candidate is validated.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { atomicWriteRegistry } from '../documents/atomic-fs.js';
import { loadPhase2ProjectConfig, ConfigValidationError, getProjectStoragePaths } from '../projects/index.js';
import { loadRequirementRegistry } from '../requirements/index.js';
import { runPlaywrightTests, checkTargetReachable } from '../test-execution/index.js';
import { reconcileRunResult } from '../reporting/index.js';
import { SCENARIO_SET, type ScenarioSet, type ScenarioValidation } from '../planning/scenario.js';
import { decideVerdict, preCheck, VALIDATION_RUNS, type Execution } from '../planning/validator.js';
import { displayError } from './output.js';
import { EXIT_SUCCESS, EXIT_FAILURE, DEFAULT_TIMEOUT_MS, roleCredentialEnv } from './run-command.js';

export interface ValidateCommandOptions {
  readonly configPath: string;
  readonly planId: string;
  /** Only these scenarios (default: all selectable ones). */
  readonly scenarioIds?: readonly string[];
  /** Directory holding .env (default: current working directory). */
  readonly rootDir?: string;
}

const STATUS: Record<ScenarioValidation['verdict'], ScenarioSet['scenarios'][number]['status']> = {
  validated: 'validated', failing: 'needs-revision', unstable: 'needs-revision', blocked: 'blocked',
};

export async function executeValidateCommand(options: ValidateCommandOptions): Promise<number> {
  const refuse = (title: string, details?: string) => {
    displayError(`Validation refused: ${title}`, details);
    return EXIT_FAILURE;
  };
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    return refuse(err instanceof ConfigValidationError ? 'invalid project configuration' : 'cannot load project configuration', (err as Error).message);
  }
  const planPath = join(config.projectWorkspace, 'specs', 'candidates', `${options.planId}.json`);
  if (!/^[\w-]+$/.test(options.planId) || !existsSync(planPath)) return refuse(`no plan file at ${planPath}`);
  let set: ScenarioSet;
  let requirements;
  try {
    set = SCENARIO_SET.parse(JSON.parse(readFileSync(planPath, 'utf-8')));
    requirements = loadRequirementRegistry(getProjectStoragePaths(config.projectWorkspace).requirementsRegistryPath).requirements;
  } catch (err) {
    return refuse('cannot read the plan or the requirement registry', (err as Error).message);
  }
  const unknown = (options.scenarioIds ?? []).filter((id) => !set.scenarios.some((s) => s.scenarioId === id));
  if (unknown.length > 0) return refuse(`not in plan ${set.planId}: ${unknown.join(', ')}`);
  const final = set.scenarios.filter((s) => options.scenarioIds?.includes(s.scenarioId) && (s.status === 'approved' || s.status === 'rejected' || s.status === 'retired'));
  if (final.length > 0) return refuse(`already decided (approved, rejected and retired scenarios are final): ${final.map((s) => `${s.scenarioId} (${s.status})`).join(', ')}`);

  const credentials = roleCredentialEnv(config.roles, options.rootDir ?? process.cwd());
  const ctx = { config, requirements, credentialValues: new Map<string, string>() };
  const now = new Date().toISOString();
  const results = new Map<string, ScenarioValidation>();
  const runnable = new Map<string, { file: string; sha256: string }>();
  console.log('');
  for (const s of set.scenarios) {
    if (options.scenarioIds && !options.scenarioIds.includes(s.scenarioId)) continue;
    if (s.status === 'approved' || s.status === 'rejected' || s.status === 'retired') { console.log(`  Ignored:    ${s.scenarioId} (${s.status})`); continue; }
    if (!s.candidateFile) { console.log(`  Ignored:    ${s.scenarioId} (not generated)`); continue; }
    const check = preCheck(s, set, ctx, credentials);
    if (check.ok) runnable.set(s.scenarioId, check);
    else results.set(s.scenarioId, { validatedAt: now, verdict: 'blocked', reason: check.reason, candidateSha256: check.sha256, runs: [] });
  }
  if (runnable.size + results.size === 0) return refuse(`plan ${set.planId} has no candidate to validate`);

  // Pre-flight before Playwright starts: with the target unreachable, block every runnable candidate and run nothing.
  const unreachable = runnable.size > 0 ? await checkTargetReachable(config.baseUrl) : null;
  if (unreachable) {
    for (const [scenarioId, { sha256 }] of runnable) {
      results.set(scenarioId, { validatedAt: now, verdict: 'blocked', reason: unreachable, candidateSha256: sha256, runs: [] });
    }
    runnable.clear();
  }

  // Three separate executions, one Playwright process each for all runnable candidates (§3.4).
  const executions: Execution[] = [];
  const runDirectories: string[] = [];
  for (let n = 1; runnable.size > 0 && n <= VALIDATION_RUNS; n++) {
    try {
      const metadata = await runPlaywrightTests(config, {
        testSet: 'candidates',
        timeoutMs: DEFAULT_TIMEOUT_MS,
        extraEnv: credentials,
        additionalArgs: ['--workers=1', ...[...runnable.values()].map((c) => `${c.file.replace(/\./g, '\\.')}$`)],
      });
      const result = reconcileRunResult({ processResult: metadata.processResult, runDir: metadata.runDirectory });
      executions.push({ runId: metadata.runId, runStatus: result.runStatus, message: result.primaryMessage, tests: result.parsedReport?.tests ?? [] });
      runDirectories.push(metadata.runDirectory);
      console.log(`  Execution ${n}/${VALIDATION_RUNS}: ${result.runStatus} (${metadata.runDirectory})`);
    } catch (err) {
      executions.push({ runId: `execution-${n}-not-started`, runStatus: 'infrastructure_error', message: (err as Error).message, tests: [] });
      console.log(`  Execution ${n}/${VALIDATION_RUNS}: could not start: ${(err as Error).message}`);
    }
  }
  // Credential values never reach the record or the console, even inside an error message.
  const redact = (text: string | null) => Object.values(credentials).reduce((t, v) => (t === null ? t : t.split(v).join('***')), text);
  for (const [scenarioId, { file, sha256 }] of runnable) {
    const verdict = decideVerdict(file, executions);
    results.set(scenarioId, { validatedAt: now, ...verdict, reason: redact(verdict.reason), candidateSha256: sha256 });
  }

  const updated: ScenarioSet = {
    ...set,
    scenarios: set.scenarios.map((s) => {
      const v = results.get(s.scenarioId);
      return v ? { ...s, status: STATUS[v.verdict], validation: v } : s;
    }),
  };
  const written = atomicWriteRegistry(planPath, SCENARIO_SET.parse(updated));
  if (!written.success) return refuse(`cannot write ${planPath}`, written.error?.message);

  console.log('');
  for (const [scenarioId, v] of results) {
    console.log(`  ${scenarioId}: ${STATUS[v.verdict]}${v.verdict === 'failing' || v.verdict === 'unstable' ? ` (${v.verdict})` : ''}${v.reason ? `: ${v.reason}` : ''}`);
  }
  for (const dir of runDirectories) console.log(`  Run:        ${dir}`);
  console.log(`  Plan:       ${planPath}`);
  console.log('');
  return [...results.values()].every((v) => v.verdict === 'validated') ? EXIT_SUCCESS : EXIT_FAILURE;
}
