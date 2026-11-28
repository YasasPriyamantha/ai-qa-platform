/**
 * Candidate stability check (Task V2, DEC-042 §3.4–§3.6).
 *
 * Deterministic, no AI. Before running, a candidate must be byte-identical to what the
 * generator renders from its plan today, and every credential variable it reads must
 * have a value. The remaining candidates run in three separate executions; the verdict
 * per candidate is taken from each execution's reconciled result and parsed report.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RunStatus, TestResult } from '../reporting/index.js';
import { renderScenario, type GenerateContext } from './generator.js';
import type { ScenarioSet, ScenarioValidation, TestScenario } from './scenario.js';

/** Separate executions per validation (§3.4). */
export const VALIDATION_RUNS = 3;

/** One execution's evidence: the reconciled run status and the parsed report's tests (empty when there is no report). */
export interface Execution {
  readonly runId: string;
  readonly runStatus: RunStatus;
  /** Why the run did not complete (primaryMessage), if known. */
  readonly message?: string;
  readonly tests: readonly TestResult[];
}

export type Verdict = Pick<ScenarioValidation, 'verdict' | 'reason' | 'runs'>;

/** Playwright colours its error text; the ANSI escape sequences are removed before storing or printing it. */
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');

/** A candidate's result in one execution, matched by file name. */
function testStatus(file: string, execution: Execution): ScenarioValidation['runs'][number]['testStatus'] {
  const results = execution.tests.filter((t) => basename(t.file.replace(/\\/g, '/')) === file);
  if (results.length === 0) return 'no-result';
  if (results.some((t) => t.status === 'failed')) return 'failed';
  return results.every((t) => t.status === 'passed') ? 'passed' : 'skipped';
}

/**
 * Verdict for one candidate file (§3.4): passed in all three → validated; failed in all
 * three → failing; mixed → unstable; any execution without a trustworthy result → blocked.
 */
export function decideVerdict(file: string, executions: readonly Execution[]): Verdict {
  const runs = executions.map((e) => ({ runId: e.runId, runStatus: e.runStatus, testStatus: testStatus(file, e) }));
  const untrusted = runs.find((r) => (r.runStatus !== 'passed' && r.runStatus !== 'failed') || (r.testStatus !== 'passed' && r.testStatus !== 'failed'));
  if (untrusted || runs.length !== VALIDATION_RUNS) {
    if (!untrusted) return { verdict: 'blocked', reason: `${runs.length} of ${VALIDATION_RUNS} executions ran`, runs };
    const execution = executions[runs.indexOf(untrusted)];
    const why = untrusted.runStatus !== 'passed' && untrusted.runStatus !== 'failed'
      ? `${untrusted.runStatus}${execution.message ? `: ${stripAnsi(execution.message)}` : ''}`
      : untrusted.testStatus === 'skipped' ? 'test skipped' : `no result for ${file}`;
    return { verdict: 'blocked', reason: `run ${untrusted.runId}: ${why}`, runs };
  }
  const passed = runs.filter((r) => r.testStatus === 'passed').length;
  if (passed === VALIDATION_RUNS) return { verdict: 'validated', reason: null, runs };
  const error = executions
    .flatMap((e) => e.tests.filter((t) => basename(t.file.replace(/\\/g, '/')) === file && t.status === 'failed'))
    .find((t) => t.error)?.error;
  const firstLine = error && stripAnsi(error).split(/\r?\n/).find((l) => l.trim() !== '')?.trim().slice(0, 300);
  const counts = `failed in ${VALIDATION_RUNS - passed} of ${VALIDATION_RUNS} executions`;
  return { verdict: passed === 0 ? 'failing' : 'unstable', reason: firstLine ? `${counts}: ${firstLine}` : counts, runs };
}

/** Result of the checks before running (§3.5, criterion 2). */
export type PreCheck =
  | { readonly ok: true; readonly file: string; readonly sha256: string }
  | { readonly ok: false; readonly sha256: string | null; readonly reason: string };

/**
 * Check one candidate before running: unchanged since generation, and every
 * `process.env.<VAR>` it reads has a value in `credentials` (names only).
 */
export function preCheck(s: TestScenario, set: ScenarioSet, ctx: GenerateContext, credentials: Readonly<Record<string, string>>): PreCheck {
  const path = join(ctx.config.projectWorkspace, s.candidateFile ?? '');
  if (!s.candidateFile || !existsSync(path)) return { ok: false, sha256: null, reason: `candidate file ${s.candidateFile} is missing; regenerate it` };
  const content = readFileSync(path);
  const sha256 = createHash('sha256').update(content).digest('hex');
  const rendered = renderScenario(s, set, ctx);
  if (!('code' in rendered)) return { ok: false, sha256, reason: `the plan no longer renders (${rendered.reasons.join('; ')}); regenerate it` };
  if (!content.equals(Buffer.from(rendered.code, 'utf-8'))) return { ok: false, sha256, reason: 'file differs from what the generator renders from its plan; regenerate it' };
  const missing = [...new Set([...rendered.code.matchAll(/process\.env\.([A-Za-z_]\w*)/g)].map((m) => m[1]))].filter((v) => !credentials[v]);
  if (missing.length > 0) return { ok: false, sha256, reason: `credential variables not set in .env or the environment: ${missing.join(', ')}` };
  return { ok: true, file: basename(path), sha256 };
}
