/**
 * Candidate test generator (Task Q4, DEC-041 §2–§5).
 *
 * Renders each scenario of a saved plan into `tests/candidates/<scenario-id>.spec.ts`
 * with fixed templates: no AI calls and no model-written code, so the same scenario
 * always gives the same file. A scenario is skipped, with the reasons, when a step
 * locator was not observed, an assertion is not taken from an expected-result quote,
 * a literal value is not in its requirements' text, a credential placeholder is
 * unknown, the code contains a forbidden pattern, or the TypeScript check fails.
 * Only files that pass are written; `tests/approved/` is never written.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteRegistry, cleanupTempFile, generateTempPath } from '../documents/atomic-fs.js';
import { validateBaseUrl } from '../projects/loader.js';
import { PROJECT_DIRECTORIES, type ResolvedPhase2Config } from '../projects/index.js';
import type { RequirementWithHistory } from '../requirements/index.js';
import { normalise } from './planner.js';
import { SCENARIO_SET, type ScenarioSet, type TestScenario } from './scenario.js';

/** Maximum candidate files written per run. */
const MAX_FILES = 20;

/** Platform root (from src/planning or dist/planning): its tsconfig.json and node_modules are used for the check. */
const PLATFORM_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const PLACEHOLDER = /^\{\{credential:([\w-]+)\.([\w-]+)\}\}$/;

/** A TypeScript single-quoted string literal. */
const str = (s: string) => `'${JSON.stringify(s).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;

/** The domain rule shared with baseUrl and exploration (DEC-040), or null when allowed. */
function urlError(url: string, allowedDomains: readonly string[]): string | null {
  try {
    validateBaseUrl(url, [...allowedDomains]);
    return null;
  } catch (err) {
    return (err as Error).message.replace(/^baseUrl: /, '');
  }
}

export interface GenerateContext {
  readonly config: ResolvedPhase2Config;
  /** Registry requirements by ID; literal values must appear in their text. */
  readonly requirements: Readonly<Record<string, RequirementWithHistory>>;
  /** Credential values from the root .env; never allowed in a candidate file. */
  readonly credentialValues: ReadonlyMap<string, string>;
}

/** Render one scenario, or the reasons it cannot be generated (§2, §3, carry-over b–d). */
function renderScenario(s: TestScenario, set: ScenarioSet, ctx: GenerateContext): { code: string } | { reasons: string[] } {
  const { baseUrl, allowedDomains, roles = [] } = ctx.config;
  const reasons: string[] = [];
  const quotes = s.expectedResults.map((e) => normalise(e.quote));
  const covered = new Set<number>();
  const requirementText = s.requirementIds.flatMap((id) => {
    const r = ctx.requirements[id];
    return r ? [r.title, r.description, r.expectedResult ?? '', ...r.negativeCases.map((n) => `${n.condition}: ${n.expectedOutcome}`)].map(normalise) : [];
  });
  let usesCredential = false;

  /** Fill and select values: one credential placeholder, or a literal found in the requirements' text. */
  const valueExpr = (n: number, value: string): string => {
    const match = PLACEHOLDER.exec(value);
    if (match) {
      const variable = roles.find((r) => r.roleId === match[1])?.credentials[match[2]];
      if (!variable || !/^[A-Za-z_]\w*$/.test(variable)) reasons.push(`step ${n}: unknown credential ${value}`);
      usesCredential = true;
      return `credential(${str(variable ?? '')}, process.env.${variable})`;
    }
    if (value.includes('{{credential:')) reasons.push(`step ${n}: credential placeholder mixed with other text`);
    else if (!requirementText.some((t) => t.includes(normalise(value)))) reasons.push(`step ${n}: value "${value}" is not in the text of ${s.requirementIds.join(', ')}`);
    return str(value);
  };
  /** An assertion must come from an expected-result quote (§1, carry-over c). */
  const trace = (n: number, texts: string[]) => {
    const found = quotes.flatMap((q, i) => (texts.some((t) => t !== '' && q.includes(normalise(t))) ? [i] : []));
    if (found.length === 0) reasons.push(`step ${n}: expected "${texts[0]}" is not in an expected-result quote`);
    for (const i of found) covered.add(i);
  };

  const lines = s.steps.map((step, i) => {
    const n = i + 1;
    const { action, target, value, assertion } = step;
    if (step.locatorSource === 'needs-observation') reasons.push(`step ${n}: locator ${target?.role} "${target?.name}" needs observation`);
    const loc = target ? `page.getByRole(${str(target.role)}, { name: ${str(target.name)}, exact: true })` : '';
    if (action === 'goto' && value !== null && !target) {
      const error = value.startsWith('/') ? null : urlError(value, allowedDomains);
      if (error) reasons.push(`step ${n}: goto ${value}: ${error}`);
      return `await page.goto(${str(value)});`;
    }
    if ((action === 'fill' || action === 'select') && target && value !== null) {
      return `await ${loc}.${action === 'fill' ? 'fill' : 'selectOption'}(${valueExpr(n, value)});`;
    }
    if (action === 'click' && target) return `await ${loc}.click();`;
    if (action === 'press' && value) return `await ${target ? loc : 'page.keyboard'}.press(${str(value)});`;
    if (action === 'expect' && assertion === 'visible' && target) {
      trace(n, [target.name]);
      return `await expect(${loc}).toBeVisible();`;
    }
    if (action === 'expect' && assertion === 'text' && !target && value) {
      trace(n, [value]);
      return `await expect(page.getByText(${str(value)}, { exact: true })).toBeVisible();`;
    }
    if (action === 'expect' && assertion === 'url' && !target && value) {
      const error = urlError(value.startsWith('/') ? new URL(value, baseUrl).href : value, allowedDomains);
      if (error) reasons.push(`step ${n}: url ${value}: ${error}`);
      const url = error ? value : new URL(value, baseUrl).href;
      trace(n, [value, url]);
      return `await expect(page).toHaveURL(${str(url)});`;
    }
    reasons.push(`step ${n}: unsupported ${action} step (target ${target ? 'set' : 'null'}, value ${value === null ? 'null' : 'set'}, assertion ${assertion})`);
    return '';
  });
  if (quotes.length === 0) reasons.push('no expected result');
  quotes.forEach((q, i) => { if (!covered.has(i)) reasons.push(`expected result "${q}" has no expect step`); });
  if (reasons.length > 0) return { reasons };

  const code = [
    '// Candidate test generated by the AI QA platform (DEC-041). Not approved; regenerate instead of editing.',
    `// Scenario: ${s.scenarioId}`,
    normalise(`// Requirements: ${s.requirementIds.map((id) => `${id} (version ${s.requirementVersions[id]})`).join(', ')}`),
    `// Plan: ${set.planId}`,
    normalise(`// Explorations: ${set.explorationIds.join(', ')}`),
    '',
    "import { test, expect } from '@playwright/test';",
    '',
    ...(usesCredential ? [
      '/** A role credential from the environment; fails clearly when it is not set. */',
      'function credential(name: string, value: string | undefined): string {',
      '  if (!value) throw new Error(`Environment variable ${name} is not set`);',
      '  return value;',
      '}',
      '',
    ] : []),
    `test(${str(`${s.scenarioId}: ${s.title}`)}, async ({ page }) => {`,
    ...s.expectedResults.map((e) => `  ${normalise(`// Expected (${e.requirementId}): ${e.quote}`)}`),
    ...lines.map((l) => `  ${l}`),
    '});',
    '',
  ].join('\n');
  return { code };
}

const FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/ref=/, 'MCP reference (ref=)'],
  [/\.locator\(|\$\$?\(|\b(?:css|xpath)=/, 'CSS or XPath selector'],
  [/nth\(/, 'nth('],
  [/waitForTimeout/, 'waitForTimeout'],
  [/test\.only/, 'test.only'],
];

/** Forbidden patterns in rendered code (criterion 3). */
function forbiddenPatterns(code: string, ctx: GenerateContext): string[] {
  const reasons = FORBIDDEN.filter(([re]) => re.test(code)).map(([, name]) => `forbidden pattern: ${name}`);
  for (const [variable, value] of ctx.credentialValues) if (value !== '' && code.includes(value)) reasons.push(`forbidden pattern: literal value of credential ${variable}`);
  for (const url of code.match(/https?:\/\/[^\s'"`)<>]+/g) ?? []) {
    const error = urlError(url, ctx.config.allowedDomains);
    if (error) reasons.push(`forbidden pattern: absolute URL ${url} (${error})`);
  }
  return reasons;
}

/**
 * Type-check candidate files with the installed TypeScript 7 `tsc` binary (it has no
 * compiler API) and the platform tsconfig.json, in a temporary folder outside the repository.
 *
 * @returns TypeScript errors by file name
 * @throws Error when tsc cannot run or reports an error outside the candidates
 */
function typeCheck(files: ReadonlyMap<string, string>): Map<string, string[]> {
  const errors = new Map<string, string[]>();
  if (files.size === 0) return errors;
  const dir = mkdtempSync(join(tmpdir(), 'qa-candidate-check-'));
  try {
    for (const [name, code] of files) writeFileSync(join(dir, name), code);
    const modules = join(PLATFORM_ROOT, 'node_modules');
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      extends: join(PLATFORM_ROOT, 'tsconfig.json'),
      compilerOptions: { noEmit: true, rootDir: '.', typeRoots: [join(modules, '@types')], paths: { '@playwright/test': [join(modules, '@playwright', 'test')] } },
      files: [...files.keys()],
    }));
    const result = spawnSync(process.execPath, [join(modules, 'typescript', 'bin', 'tsc'), '-p', join(dir, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf-8' });
    if (result.error || result.status === null) throw new Error(`TypeScript check could not run: ${result.error?.message ?? result.signal}`);
    const unattributed: string[] = [];
    for (const line of `${result.stdout}${result.stderr}`.split(/\r?\n/).filter((l) => l.trim() !== '')) {
      const match = /([\w-]+\.spec\.ts)\((\d+),(\d+)\): error (.*)$/.exec(line);
      if (match && files.has(match[1])) errors.set(match[1], [...(errors.get(match[1]) ?? []), `line ${match[2]}: ${match[4]}`]);
      else if (/error/.test(line)) unattributed.push(line);
    }
    if (unattributed.length > 0 || (result.status !== 0 && errors.size === 0)) {
      throw new Error(`TypeScript check failed outside the candidates: ${unattributed.join('\n') || `exit ${result.status}`}`);
    }
    return errors;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write a text file through a temporary file and a rename (atomic on one filesystem). */
function writeAtomic(path: string, content: string): void {
  const temp = generateTempPath(dirname(path), 'candidate');
  try {
    writeFileSync(temp, content, 'utf-8');
    renameSync(temp, path);
  } catch (err) {
    cleanupTempFile(temp);
    throw err;
  }
}

const inside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

export interface GenerateResult {
  readonly planPath: string;
  readonly set: ScenarioSet;
  readonly generated: ReadonlyArray<{ scenarioId: string; file: string }>;
  readonly skipped: ReadonlyArray<{ scenarioId: string; reasons: string[] }>;
}

/**
 * Generate candidate files for one plan and record them in the plan file.
 *
 * @throws Error for a missing or invalid plan, a candidate folder inside the approved test folder, or a failed check run
 */
export function generateCandidates(planId: string, ctx: GenerateContext, replace: boolean): GenerateResult {
  const workspace = ctx.config.projectWorkspace;
  const planPath = join(workspace, 'specs', 'candidates', `${planId}.json`);
  if (!/^[\w-]+$/.test(planId) || !existsSync(planPath)) throw new Error(`${planId}: no plan file at ${planPath}`);
  const set = SCENARIO_SET.parse(JSON.parse(readFileSync(planPath, 'utf-8')));
  const candidatesDir = join(workspace, PROJECT_DIRECTORIES.TESTS_CANDIDATES);
  for (const approved of [join(workspace, PROJECT_DIRECTORIES.TESTS_APPROVED), ctx.config.resolvedTestDirectory]) {
    if (inside(candidatesDir, approved) || inside(approved, candidatesDir)) throw new Error(`The candidate folder ${candidatesDir} overlaps the approved test folder ${approved}; nothing written.`);
  }

  const skipped: Array<{ scenarioId: string; reasons: string[] }> = [];
  const staged = new Map<string, string>();
  for (const s of set.scenarios) {
    const name = `${s.scenarioId}.spec.ts`;
    const rendered = existsSync(join(candidatesDir, name)) && !replace
      ? { reasons: [`${PROJECT_DIRECTORIES.TESTS_CANDIDATES}/${name} exists; use --replace to overwrite it`] }
      : renderScenario(s, set, ctx);
    const reasons = 'code' in rendered ? forbiddenPatterns(rendered.code, ctx) : rendered.reasons;
    if (reasons.length === 0 && staged.size >= MAX_FILES) reasons.push(`file limit of ${MAX_FILES} per run reached`);
    if (reasons.length > 0 || !('code' in rendered)) skipped.push({ scenarioId: s.scenarioId, reasons });
    else staged.set(name, rendered.code);
  }
  for (const [name, errors] of typeCheck(staged)) {
    staged.delete(name);
    skipped.push({ scenarioId: name.replace('.spec.ts', ''), reasons: errors.map((e) => `TypeScript ${e}`) });
  }

  mkdirSync(candidatesDir, { recursive: true });
  const generated: Array<{ scenarioId: string; file: string }> = [];
  for (const [name, code] of staged) {
    writeAtomic(join(candidatesDir, name), code);
    generated.push({ scenarioId: name.replace('.spec.ts', ''), file: `${PROJECT_DIRECTORIES.TESTS_CANDIDATES}/${name}` });
  }
  const files = new Map(generated.map((g) => [g.scenarioId, g.file]));
  const updated: ScenarioSet = {
    ...set,
    status: generated.length > 0 ? 'generated' : set.status,
    scenarios: set.scenarios.map((s) => (files.has(s.scenarioId) ? { ...s, candidateFile: files.get(s.scenarioId) } : s)),
  };
  if (generated.length > 0) {
    const written = atomicWriteRegistry(planPath, SCENARIO_SET.parse(updated));
    if (!written.success) throw written.error ?? new Error(`Cannot write ${planPath}`);
  }
  return { planPath, set: updated, generated, skipped };
}
