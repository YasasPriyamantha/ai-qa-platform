/**
 * approve and reject commands (Task V3, DEC-042 §3.6–§3.7)
 *
 * A named reviewer promotes validated candidates into the project's approved test
 * folder, or rejects scenarios with a reason. `approve` is the only platform code that
 * writes to the approved folder. Decisions are recorded on the scenario in its plan
 * file; approved and rejected scenarios are final. No AI calls.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { atomicWriteRegistry } from '../documents/atomic-fs.js';
import { loadPhase2ProjectConfig, ConfigValidationError, getProjectStoragePaths } from '../projects/index.js';
import { loadRequirementRegistry, type RequirementWithHistory } from '../requirements/index.js';
import { SCENARIO_SET, type ScenarioSet, type TestScenario } from '../planning/scenario.js';
import { displayError } from './output.js';
import { EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';

export interface DecisionCommandOptions {
  readonly configPath: string;
  readonly scenarioIds: readonly string[];
  readonly reviewer: string;
  /** reject only. */
  readonly reason?: string;
}

const refuse = (title: string, details?: string) => {
  displayError(title, details);
  return EXIT_FAILURE;
};

/** Load the project and the plans holding the requested scenarios, or the refusal message. */
function loadPlans(options: DecisionCommandOptions, verb: string) {
  if (!/\S/.test(options.reviewer) || /[\x00-\x1f\x7f]/.test(options.reviewer)) return `${verb} refused: --reviewer must be a name on one line`;
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    return `${verb} refused: ${err instanceof ConfigValidationError ? 'invalid' : 'cannot load'} project configuration: ${(err as Error).message}`;
  }
  const dir = join(config.projectWorkspace, 'specs', 'candidates');
  const plans = new Map<string, ScenarioSet>();
  try {
    for (const file of existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []) {
      plans.set(join(dir, file), SCENARIO_SET.parse(JSON.parse(readFileSync(join(dir, file), 'utf-8'))));
    }
  } catch (err) {
    return `${verb} refused: cannot read a plan file in ${dir}: ${(err as Error).message}`;
  }
  const found = new Map<string, { planPath: string; scenario: TestScenario }>();
  for (const [planPath, set] of plans) for (const s of set.scenarios) if (options.scenarioIds.includes(s.scenarioId)) found.set(s.scenarioId, { planPath, scenario: s });
  const unknown = options.scenarioIds.filter((id) => !found.has(id));
  if (unknown.length > 0) return `${verb} refused: not in any plan of ${config.projectId}: ${unknown.join(', ')}`;
  const decided = [...found.values()].filter(({ scenario: s }) => s.status === 'approved' || s.status === 'rejected');
  if (decided.length > 0) return `${verb} refused: already decided (approved and rejected scenarios are final): ${decided.map(({ scenario: s }) => `${s.scenarioId} (${s.status})`).join(', ')}`;
  return { config, plans, found };
}

/** Write each changed plan atomically; returns the error message of the first failure. */
function savePlans(plans: Map<string, ScenarioSet>, updates: Map<string, TestScenario>): string | null {
  for (const [planPath, set] of plans) {
    if (!set.scenarios.some((s) => updates.has(s.scenarioId))) continue;
    const updated = { ...set, scenarios: set.scenarios.map((s) => updates.get(s.scenarioId) ?? s) };
    const written = atomicWriteRegistry(planPath, SCENARIO_SET.parse(updated));
    if (!written.success) return `cannot write ${planPath}: ${written.error?.message}`;
  }
  return null;
}

/** One line per expect step, as the reviewer should read it. */
function describeCheck(step: TestScenario['steps'][number]): string {
  if (step.assertion === 'visible') return `${step.target?.role} "${step.target?.name}" is visible`;
  if (step.assertion === 'text') return `text "${step.value}" is shown`;
  return `page URL is ${step.value}`;
}

/** Reasons a scenario cannot be approved (criterion 2); empty when it can. */
function approvalBlockers(s: TestScenario, workspace: string, requirements: Record<string, RequirementWithHistory>, target: string): string[] {
  const reasons: string[] = [];
  if (s.status !== 'validated') reasons.push(`status is ${s.status}, not validated`);
  const candidate = join(workspace, s.candidateFile ?? '');
  if (!s.candidateFile || !existsSync(candidate)) reasons.push(`candidate file ${s.candidateFile ?? '(none)'} is missing`);
  else if (createHash('sha256').update(readFileSync(candidate)).digest('hex') !== s.validation?.candidateSha256) reasons.push('candidate file changed since validation; regenerate and validate it');
  for (const id of s.requirementIds) {
    const r = requirements[id];
    if (!r || r.status !== 'active' || (r.history?.length ?? 0) + 1 !== s.requirementVersions[id]) reasons.push(`${id}: requirement changed since planning; re-plan`);
  }
  if (existsSync(target)) reasons.push(`${target} already exists`);
  return reasons;
}

export function executeApproveCommand(options: DecisionCommandOptions): number {
  const loaded = loadPlans(options, 'Approval');
  if (typeof loaded === 'string') return refuse(loaded);
  const { config, plans, found } = loaded;
  let requirements;
  try {
    requirements = loadRequirementRegistry(getProjectStoragePaths(config.projectWorkspace).requirementsRegistryPath).requirements;
  } catch (err) {
    return refuse('Approval refused: cannot read the requirement registry', (err as Error).message);
  }

  // Show the documented behaviour next to the checks before deciding (criterion 1).
  console.log('');
  for (const { scenario: s } of found.values()) {
    console.log(`  ${s.scenarioId}: ${s.title}`);
    console.log(`    Requirements: ${s.requirementIds.map((id) => `${id} (version ${s.requirementVersions[id]})`).join(', ')}`);
    for (const e of s.expectedResults) console.log(`    Expected (${e.requirementId}): "${e.quote}"`);
    for (const step of s.steps.filter((x) => x.action === 'expect')) console.log(`    Check:        ${describeCheck(step)}`);
    console.log('');
  }

  const now = new Date().toISOString();
  const updates = new Map<string, TestScenario>();
  const written: string[] = [];
  for (const { scenario: s } of found.values()) {
    const target = join(config.resolvedTestDirectory, `${s.scenarioId}.spec.ts`);
    const reasons = approvalBlockers(s, config.projectWorkspace, requirements, target);
    if (reasons.length > 0) {
      for (const reason of reasons) console.log(`  ${s.scenarioId}: not approved: ${reason}`);
      continue;
    }
    const candidate = readFileSync(join(config.projectWorkspace, s.candidateFile!), 'utf-8');
    const runIds = s.validation!.runs.map((r) => r.runId).join(', ');
    const header = `// Approved test (DEC-042): approved by ${options.reviewer.trim()} on ${now.slice(0, 10)} after validation runs ${runIds}. Do not edit; re-plan instead.`;
    const content = header + candidate.slice(candidate.indexOf('\n'));
    try {
      writeFileSync(target, content, { encoding: 'utf-8', flag: 'wx' });
    } catch (err) {
      console.log(`  ${s.scenarioId}: not approved: cannot write ${target}: ${(err as Error).message}`);
      continue;
    }
    written.push(target);
    const approvedFile = relative(config.projectWorkspace, target).replace(/\\/g, '/');
    const approvedSha256 = createHash('sha256').update(content, 'utf-8').digest('hex');
    updates.set(s.scenarioId, { ...s, status: 'approved', approval: { reviewer: options.reviewer.trim(), decidedAt: now, approvedFile, approvedSha256 } });
    console.log(`  ${s.scenarioId}: approved → ${approvedFile}`);
  }

  const error = savePlans(plans, updates);
  if (error) {
    // Without the plan record the approval did not happen: remove the files written in this call.
    for (const file of written) rmSync(file, { force: true });
    return refuse(`Approval failed: ${error}`, 'No approved file was kept.');
  }
  console.log('');
  return updates.size === found.size ? EXIT_SUCCESS : EXIT_FAILURE;
}

export function executeRejectCommand(options: DecisionCommandOptions): number {
  if (!options.reason || !/\S/.test(options.reason)) return refuse('Rejection refused: --reason is required');
  const loaded = loadPlans(options, 'Rejection');
  if (typeof loaded === 'string') return refuse(loaded);
  const decidedAt = new Date().toISOString();
  const rejection = { reviewer: options.reviewer.trim(), decidedAt, reason: options.reason.trim() };
  const updates = new Map([...loaded.found.values()].map(({ scenario: s }) => [s.scenarioId, { ...s, status: 'rejected' as const, rejection }]));
  const error = savePlans(loaded.plans, updates);
  if (error) return refuse(`Rejection failed: ${error}`);
  console.log('');
  for (const id of updates.keys()) console.log(`  ${id}: rejected (candidate file kept)`);
  console.log('');
  return EXIT_SUCCESS;
}
