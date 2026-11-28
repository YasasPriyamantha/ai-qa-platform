/**
 * release create command (Task R1, DEC-043 §1–§3)
 *
 * Snapshots the project's requirements into `<workspace>/releases/<release-id>.json`,
 * compares them with the previous release and lists affected tests and "needs tests".
 * No AI calls.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { atomicWriteRegistry } from '../documents/atomic-fs.js';
import { loadDocumentRegistry } from '../documents/index.js';
import { loadPhase2ProjectConfig, ConfigValidationError, getProjectStoragePaths } from '../projects/index.js';
import { loadRequirementRegistry } from '../requirements/index.js';
import { RELEASE_ID_PATTERN, RELEASE_RECORD, buildReleaseRecord, loadReleases, releasePath } from '../releases/release.js';
import { buildReleaseReport, renderReleaseReport, runState } from '../releases/report.js';
import type { TestScenario } from '../planning/scenario.js';
import { readPlanFiles, savePlans } from './approve-command.js';
import { displayError } from './output.js';
import { EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';

export interface ReleaseCreateOptions {
  readonly configPath: string;
  readonly releaseId: string;
}

export interface ReleaseReviewOptions extends ReleaseCreateOptions {
  readonly reviewer: string;
  readonly reason: string;
  /** `confirm` takes requirement IDs; `keep` and `retire` take scenario IDs. */
  readonly decision: 'confirm' | 'keep' | 'retire';
  readonly ids: readonly string[];
}

const refuse = (title: string, details?: string) => {
  displayError(title, details);
  return EXIT_FAILURE;
};

export function executeReleaseCreateCommand(options: ReleaseCreateOptions): number {
  if (!RELEASE_ID_PATTERN.test(options.releaseId)) {
    return refuse(`Release refused: invalid release ID "${options.releaseId}"`, 'Use 1–32 characters: lowercase letters, digits, "." and "-", starting with a letter or digit.');
  }
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    return refuse(`Release refused: ${err instanceof ConfigValidationError ? 'invalid' : 'cannot load'} project configuration`, (err as Error).message);
  }
  const workspace = config.projectWorkspace;
  const target = releasePath(workspace, options.releaseId);
  if (existsSync(target)) return refuse(`Release refused: release ${options.releaseId} already exists`, `${target} is never overwritten.`);

  let record;
  try {
    const paths = getProjectStoragePaths(workspace);
    const previous = loadReleases(workspace).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) ?? null;
    record = buildReleaseRecord({
      releaseId: options.releaseId,
      projectId: config.projectId,
      target: { baseUrl: config.baseUrl, environment: config.environment },
      documentRegistry: loadDocumentRegistry(paths.documentsRegistryPath),
      requirements: loadRequirementRegistry(paths.requirementsRegistryPath).requirements,
      plans: readPlanFiles(workspace).values(),
      previous,
    });
  } catch (err) {
    return refuse('Release refused: cannot read the project records', (err as Error).message);
  }
  const written = atomicWriteRegistry(target, RELEASE_RECORD.parse(record));
  if (!written.success) return refuse(`Release failed: cannot write ${target}`, written.error?.message);

  console.log('');
  console.log(`  Release ${record.releaseId} created: ${target}`);
  console.log(`  Previous release: ${record.previousReleaseId ?? 'none (first release)'}`);
  console.log('');
  for (const c of record.comparison.filter((x) => x.classification !== 'unchanged')) {
    const versions = c.classification === 'changed' ? ` (version ${c.previousContentVersion} → ${c.currentContentVersion})` : '';
    console.log(`  ${c.requirementId}: ${c.classification}${versions}${c.review ? ', pending confirmation' : ''}`);
  }
  console.log(`  Unchanged requirements: ${record.comparison.filter((x) => x.classification === 'unchanged').length}`);
  console.log('');
  console.log(`  Affected tests (pending review): ${record.affectedTests.length === 0 ? 'none' : ''}`);
  for (const t of record.affectedTests) {
    console.log(`    ${t.scenarioId} ${t.approvedFile}: ${t.requirements.map((r) => `${r.requirementId} (${r.classification})`).join(', ')}`);
  }
  console.log(`  Needs tests: ${record.needsTests.length === 0 ? 'none' : record.needsTests.join(', ')}`);
  console.log('');
  return EXIT_SUCCESS;
}

/**
 * release review (Task R2, DEC-043 §4): confirm pending requirement changes, or keep or
 * retire pending affected tests, with a named reviewer and a reason. Retiring moves the
 * approved file to `<workspace>/tests/retired/` (never deleting it) and marks the scenario
 * `retired` in its plan; if a record cannot be written, the moves and plan writes are undone.
 */
export function executeReleaseReviewCommand(options: ReleaseReviewOptions): number {
  if (!/\S/.test(options.reviewer) || /[\x00-\x1f\x7f]/.test(options.reviewer)) return refuse('Review refused: --reviewer must be a name on one line');
  if (!/\S/.test(options.reason)) return refuse('Review refused: --reason is required');
  if (!RELEASE_ID_PATTERN.test(options.releaseId)) return refuse(`Review refused: invalid release ID "${options.releaseId}"`);
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    return refuse(`Review refused: ${err instanceof ConfigValidationError ? 'invalid' : 'cannot load'} project configuration`, (err as Error).message);
  }
  const workspace = config.projectWorkspace;
  let release, plans;
  try {
    release = loadReleases(workspace).find((r) => r.releaseId === options.releaseId);
    plans = readPlanFiles(workspace);
  } catch (err) {
    return refuse('Review refused: cannot read the project records', (err as Error).message);
  }
  if (!release) return refuse(`Review refused: release ${options.releaseId} does not exist`);

  // Only items pending in this release can be decided (criterion 1).
  const items = options.decision === 'confirm'
    ? release.comparison.map((c) => ({ id: c.requirementId, review: c.review }))
    : release.affectedTests.map((t) => ({ id: t.scenarioId, review: t.review }));
  const unknown = options.ids.filter((id) => !items.some((i) => i.id === id));
  if (unknown.length > 0) return refuse(`Review refused: not in release ${release.releaseId}${options.decision === 'confirm' ? '' : "'s affected tests"}: ${unknown.join(', ')}`);
  const notPending = options.ids.filter((id) => items.find((i) => i.id === id)!.review !== 'pending');
  if (notPending.length > 0) return refuse(`Review refused: not pending in release ${release.releaseId}: ${notPending.join(', ')}`);

  const reviewer = options.reviewer.trim();
  const reason = options.reason.trim();
  const decidedAt = new Date().toISOString();
  const originals = new Map<string, TestScenario>();
  const updates = new Map<string, TestScenario>();
  const moves: { from: string; to: string }[] = [];
  if (options.decision !== 'confirm') {
    for (const set of plans.values()) for (const s of set.scenarios) if (options.ids.includes(s.scenarioId)) originals.set(s.scenarioId, s);
    const notApproved = options.ids.filter((id) => originals.get(id)?.status !== 'approved' || !originals.get(id)?.approval);
    if (notApproved.length > 0) return refuse(`Review refused: not an approved scenario in the plans (retired scenarios are final): ${notApproved.map((id) => `${id} (${originals.get(id)?.status ?? 'not found'})`).join(', ')}`);
  }
  if (options.decision === 'retire') {
    const retiredDir = join(workspace, 'tests', 'retired');
    const inside = relative(config.resolvedTestDirectory, retiredDir);
    if (inside === '' || !inside.startsWith('..')) return refuse(`Review refused: ${retiredDir} is inside the test folder ${config.resolvedTestDirectory}, so retired tests would still run`);
    for (const id of options.ids) {
      const from = join(workspace, originals.get(id)!.approval!.approvedFile);
      const to = join(retiredDir, `${id}.spec.ts`);
      if (!existsSync(from)) return refuse(`Review refused: approved file ${from} is missing`);
      if (existsSync(to)) return refuse(`Review refused: ${to} already exists and is never overwritten`);
      moves.push({ from, to });
      updates.set(id, { ...originals.get(id)!, status: 'retired', retirement: { reviewer, decidedAt, reason, releaseId: release.releaseId } });
    }
    mkdirSync(retiredDir, { recursive: true });
  }

  const decided = new Set(options.ids);
  const updated = RELEASE_RECORD.parse({
    ...release,
    comparison: release.comparison.map((c) => (options.decision === 'confirm' && decided.has(c.requirementId) ? { ...c, review: 'reviewed' } : c)),
    affectedTests: release.affectedTests.map((t) => (options.decision !== 'confirm' && decided.has(t.scenarioId) ? { ...t, review: 'reviewed' } : t)),
    reviews: [...release.reviews, ...options.ids.map((itemId) => ({ itemId, action: options.decision, reviewer, decidedAt, reason }))],
  });

  const undo = () => {
    if (updates.size > 0) savePlans(plans, originals);
    for (const m of moves.filter((x) => existsSync(x.to))) renameSync(m.to, m.from);
  };
  try {
    for (const m of moves) renameSync(m.from, m.to);
  } catch (err) {
    undo();
    return refuse('Review failed: cannot move an approved file; nothing was changed', (err as Error).message);
  }
  const error = savePlans(plans, updates) ?? (() => {
    const written = atomicWriteRegistry(releasePath(workspace, release.releaseId), updated);
    return written.success ? null : `cannot write the release record: ${written.error?.message}`;
  })();
  if (error) {
    // No file move may exist without its record (criterion 4).
    undo();
    return refuse(`Review failed: ${error}`, 'Moved files were moved back to the approved folder.');
  }

  console.log('');
  const verb = { confirm: 'confirmed', keep: 'kept (stays active)', retire: 'retired' }[options.decision];
  for (const id of options.ids) console.log(`  ${id}: ${verb}${options.decision === 'retire' ? ` → tests/retired/${id}.spec.ts` : ''}`);
  const pending = updated.comparison.filter((c) => c.review === 'pending').length + updated.affectedTests.filter((t) => t.review === 'pending').length;
  console.log(`  Still pending in release ${updated.releaseId}: ${pending}`);
  console.log('');
  return EXIT_SUCCESS;
}

/**
 * release report (Task R3, DEC-043 §3.6): compares the release's latest run with its previous
 * release's latest run, writes `releases/<id>-report.md` and exits 0 only with no regression,
 * no pending review and a passing latest run.
 */
export function executeReleaseReportCommand(options: ReleaseCreateOptions): number {
  if (!RELEASE_ID_PATTERN.test(options.releaseId)) return refuse(`Report refused: invalid release ID "${options.releaseId}"`);
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    return refuse(`Report refused: ${err instanceof ConfigValidationError ? 'invalid' : 'cannot load'} project configuration`, (err as Error).message);
  }
  const workspace = config.projectWorkspace;
  let releases, plans;
  try {
    releases = loadReleases(workspace);
    plans = readPlanFiles(workspace);
  } catch (err) {
    return refuse('Report refused: cannot read the project records', (err as Error).message);
  }
  const release = releases.find((r) => r.releaseId === options.releaseId);
  if (!release) return refuse(`Report refused: release ${options.releaseId} does not exist`);
  const previous = releases.find((r) => r.releaseId === release.previousReleaseId) ?? null;

  const report = buildReleaseReport({
    release,
    previous,
    plans: plans.values(),
    isRetired: (file) => existsSync(join(workspace, 'tests', 'retired', basename(file))),
  });
  const target = join(workspace, 'releases', `${release.releaseId}-report.md`);
  try {
    writeFileSync(target, renderReleaseReport(report, previous, new Date().toISOString()), 'utf-8');
  } catch (err) {
    return refuse(`Report failed: cannot write ${target}`, (err as Error).message);
  }

  console.log('');
  console.log(`  Release ${release.releaseId} report: ${target}`);
  console.log(`  Latest run: ${report.latest ? `${report.latest.runId} (${runState(report.latest)})` : 'none'}`);
  console.log(`  Baseline: ${report.baseline ? `${previous!.releaseId} run ${report.baseline.runId}` : 'no baseline'}`);
  if (report.notCompared) console.log(`  ${report.notCompared}`);
  if (report.tests) {
    const counts = new Map<string, number>();
    for (const t of report.tests) counts.set(t.classification, (counts.get(t.classification) ?? 0) + 1);
    console.log(`  Tests: ${[...counts].map(([c, n]) => `${n} ${c}`).join(', ') || 'none'}`);
    for (const t of report.tests.filter((x) => x.regression)) console.log(`  REGRESSION: ${t.title}`);
  }
  console.log(`  Pending reviews: ${report.pending.length}; needs tests: ${report.needsTests.length === 0 ? 'none' : report.needsTests.join(', ')}`);
  console.log(`  Result: ${report.passed ? 'PASS' : 'FAIL'} (${report.regressions} regression(s))`);
  console.log('');
  return report.passed ? EXIT_SUCCESS : EXIT_FAILURE;
}
