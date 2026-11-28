/**
 * Release report (Task R3, DEC-043 §3.6): the latest run of a release compared with the
 * latest run of its previous release (the baseline). Deterministic; no AI.
 */

import type { ScenarioSet } from '../planning/scenario.js';
import type { ReleaseRecord, ReleaseRun } from './release.js';

type TestClass = 'still passing' | 'newly failing' | 'still failing' | 'fixed' | 'new' | 'retired' | 'not run';

export interface ReportTest {
  file: string;
  title: string;
  scenarioId: string | null;
  baseline: string | null;
  latest: string | null;
  classification: TestClass;
  /** For `newly failing` only: a regression when every linked requirement is unchanged (none linked counts as unchanged). */
  regression: boolean | null;
  /** Linked requirements that are not unchanged, as `REQ-… (changed)`. */
  requirementChanges: string[];
}

/** `blocked` for a run that is not clean (timed out, infrastructure error or an incomplete report); never passing. */
export function runState(run: ReleaseRun): 'passed' | 'failed' | 'blocked' {
  if (run.reportStatus !== 'complete' || (run.runStatus !== 'passed' && run.runStatus !== 'failed')) return 'blocked';
  return run.runStatus;
}

export interface ReleaseReport {
  release: ReleaseRecord;
  latest: ReleaseRun | null;
  baseline: ReleaseRun | null;
  /** Null when the tests were not compared; the reason is in `notCompared`. */
  tests: ReportTest[] | null;
  notCompared: string | null;
  regressions: number;
  pending: string[];
  passed: boolean;
}

export function buildReleaseReport(input: {
  release: ReleaseRecord;
  previous: ReleaseRecord | null;
  plans: Iterable<ScenarioSet>;
  /** Whether a test file (as in the run summary) was retired into tests/retired/. */
  isRetired: (file: string) => boolean;
}): ReleaseReport {
  const { release, previous } = input;
  const latest = release.runs.at(-1) ?? null;
  const baselineRun = previous?.runs.at(-1) ?? null;
  const baseline = baselineRun && runState(baselineRun) !== 'blocked' ? baselineRun : null;
  const pending = [
    ...release.comparison.filter((c) => c.review === 'pending').map((c) => `${c.requirementId} (${c.classification}): confirm the requirement change`),
    ...release.affectedTests.filter((t) => t.review === 'pending').map((t) => `${t.scenarioId} (${t.requirements.map((r) => `${r.requirementId} ${r.classification}`).join(', ')}): keep or retire the test`),
  ];

  let notCompared: string | null = null;
  if (!latest) notCompared = `Release ${release.releaseId} has no run yet. Run: run --config <…> --release ${release.releaseId}`;
  else if (runState(latest) === 'blocked') notCompared = `The latest run is blocked (${latest.runStatus}, report ${latest.reportStatus}); its tests are not compared.`;

  let tests: ReportTest[] | null = null;
  if (latest && !notCompared) {
    const requirementsOf = new Map([...input.plans].flatMap((p) => p.scenarios).map((s) => [s.scenarioId, s.requirementIds]));
    const classOf = new Map(release.comparison.map((c) => [c.requirementId, c.classification]));
    // Tests match by file; the title only tells apart several tests in one file.
    const key = (t: { file: string; title: string }) => `${t.file}\n${t.title}`;
    const before = new Map((baseline?.tests ?? []).map((t) => [key(t), t]));
    const now = new Map(latest.tests.map((t) => [key(t), t]));
    tests = [...new Set([...before.keys(), ...now.keys()])].map((k) => {
      const b = before.get(k);
      const c = now.get(k);
      const t = (c ?? b)!;
      const changes = (t.scenarioId ? requirementsOf.get(t.scenarioId) ?? [] : [])
        .filter((id) => classOf.get(id) !== 'unchanged')
        .map((id) => `${id} (${classOf.get(id) ?? 'not in release'})`);
      let classification: TestClass;
      if (!b) classification = 'new';
      else if (!c) classification = input.isRetired(t.file) ? 'retired' : 'not run';
      else if (b.status === 'passed') classification = c.status === 'passed' ? 'still passing' : 'newly failing';
      else classification = c.status === 'passed' ? 'fixed' : 'still failing';
      return {
        file: t.file,
        title: t.title,
        scenarioId: t.scenarioId,
        baseline: b?.status ?? null,
        latest: c?.status ?? null,
        classification,
        regression: classification === 'newly failing' ? changes.length === 0 : null,
        requirementChanges: changes,
      };
    });
  }
  const regressions = tests?.filter((t) => t.regression).length ?? 0;
  return {
    release, latest, baseline, tests, notCompared, regressions, pending,
    passed: regressions === 0 && pending.length === 0 && latest !== null && runState(latest) === 'passed',
  };
}

const cell = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

/** Markdown for `releases/<id>-report.md`: headings and tables, no ANSI codes. */
export function renderReleaseReport(report: ReleaseReport, previous: ReleaseRecord | null, generatedAt: string): string {
  const { release, latest, baseline } = report;
  const baselineRun = previous?.runs.at(-1) ?? null;
  const lines: string[] = [
    `# Release report: ${release.releaseId}`,
    '',
    `Project: ${release.projectId} · Previous release: ${release.previousReleaseId ?? 'none (first release)'} · Generated: ${generatedAt}`,
    '',
    '## Result',
    '',
    `**${report.passed ? 'PASS' : 'FAIL'}**: ${report.regressions} regression(s), ${report.pending.length} pending review(s), latest run ${latest ? runState(latest) : 'missing'}.`,
    '',
    '## Runs',
    '',
    '| Run | Release | Run ID | Finished | Run status | Report | Clean |',
    '|---|---|---|---|---|---|---|',
  ];
  const runRow = (label: string, releaseId: string, run: ReleaseRun | null) =>
    run
      ? `| ${label} | ${releaseId} | ${run.runId} | ${run.finishedAt} | ${run.runStatus} | ${run.reportStatus} | ${runState(run) === 'blocked' ? 'no (blocked)' : 'yes'} |`
      : `| ${label} | ${releaseId} | none | | | | |`;
  lines.push(runRow('Latest', release.releaseId, latest));
  if (previous) lines.push(runRow('Baseline', previous.releaseId, baselineRun));
  lines.push('');
  if (!previous) lines.push('No baseline: this release has no previous release.', '');
  else if (!baselineRun) lines.push(`No baseline: release ${previous.releaseId} has no run.`, '');
  else if (!baseline) lines.push(`No baseline: the latest run of release ${previous.releaseId} is blocked.`, '');

  lines.push('## Tests', '');
  if (report.notCompared || !report.tests) {
    lines.push(report.notCompared ?? '', '');
  } else {
    lines.push('| Test | Scenario | Baseline | Latest | Classification |', '|---|---|---|---|---|');
    for (const t of report.tests) {
      const detail = t.classification !== 'newly failing' ? t.classification
        : t.regression ? '**newly failing: regression**' : `newly failing: affected by requirement change (${t.requirementChanges.join(', ')})`;
      lines.push(`| ${cell(t.title)} | ${t.scenarioId ?? 'none'} | ${t.baseline ?? '-'} | ${t.latest ?? '-'} | ${detail} |`);
    }
    lines.push('');
  }

  lines.push('## Requirement changes', '', '| Requirement | Classification | Content version | Review |', '|---|---|---|---|');
  for (const c of release.comparison.filter((x) => x.classification !== 'unchanged')) {
    lines.push(`| ${c.requirementId} | ${c.classification} | ${c.previousContentVersion ?? '-'} → ${c.currentContentVersion} | ${c.review ?? '-'} |`);
  }
  lines.push('', `Unchanged requirements: ${release.comparison.filter((x) => x.classification === 'unchanged').length}`, '');
  lines.push('## Pending reviews', '', ...(report.pending.length ? report.pending.map((p) => `- ${p}`) : ['None.']), '');
  lines.push('## Needs tests', '', ...(release.needsTests.length ? release.needsTests.map((id) => `- ${id}`) : ['None.']), '');
  return lines.join('\n');
}
