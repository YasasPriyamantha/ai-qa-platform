/**
 * Test scenario schemas (Task Q3, DEC-037, DEC-041 §2–§5).
 *
 * The model returns SCENARIO_PLAN_SCHEMA: scenarios without IDs, versions or
 * status. The platform checks them and stores TestScenario records, adding the
 * allocated `SCN-0001`-style ID, each requirement's content version, the source
 * of each step's locator and the lifecycle status, in a ScenarioSet file at
 * `<workspace>/specs/candidates/<plan-id>.json`.
 */

import { createCanonicalSchema, z } from '../model-providers/index.js';

const level = z.enum(['high', 'medium', 'low']);

/** Fixed action set (§2); `target` is a role and accessible name as observed (§3). */
const step = z.object({
  action: z.enum(['goto', 'fill', 'click', 'select', 'press', 'expect']),
  target: z.object({ role: z.string(), name: z.string() }).strict().nullable(),
  /** goto: path or URL; fill: text; select: option; press: key; expect text/url: the expected text or URL. */
  value: z.string().nullable(),
  /** Only for `expect`. */
  assertion: z.enum(['visible', 'text', 'url']).nullable(),
}).strict();

const plannedScenario = z.object({
  title: z.string(),
  requirementIds: z.array(z.string()),
  categories: z.array(z.enum(['functional', 'end-to-end', 'black-box', 'regression'])),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  risk: level,
  /** Role ID from the project config, or null for no role. */
  role: z.string().nullable(),
  preconditions: z.array(z.string()),
  testData: z.array(z.string()),
  steps: z.array(step),
  /** Each quote is text copied from that requirement's expected result or a negative case (§1). */
  expectedResults: z.array(z.object({ requirementId: z.string(), quote: z.string() }).strict()),
  /** Unresolved questions about this scenario. */
  questions: z.array(z.string()),
}).strict();

export type PlannedScenario = z.infer<typeof plannedScenario>;

/** The planner's structured output. */
export const SCENARIO_PLAN_SCHEMA = createCanonicalSchema({
  id: 'scenario-plan',
  version: 1,
  name: 'scenario_plan',
  zodSchema: z.object({
    scenarios: z.array(plannedScenario),
    conflicts: z.array(z.string()),
    questions: z.array(z.string()),
  }).strict(),
});

/** Where a step's locator was observed; `needs-observation` when it was not (§3). */
const LOCATOR_SOURCES = ['summary', 'evidence', 'needs-observation'] as const;

/** Scenario lifecycle (DEC-042 §3.6); "awaiting approval" is `validated`. */
export const SCENARIO_STATUSES = ['draft', 'validated', 'needs-revision', 'blocked', 'approved', 'rejected'] as const;

/** The last `validate` result (DEC-042 §3.4): `failing` and `unstable` are the two kinds of needs-revision. */
const validation = z.object({
  validatedAt: z.string(),
  verdict: z.enum(['validated', 'failing', 'unstable', 'blocked']),
  reason: z.string().nullable(),
  /** SHA-256 of the candidate file that was checked, or null when it was missing. */
  candidateSha256: z.string().nullable(),
  runs: z.array(z.object({
    runId: z.string(),
    runStatus: z.enum(['passed', 'failed', 'timed_out', 'infrastructure_error']),
    testStatus: z.enum(['passed', 'failed', 'skipped', 'no-result']),
  }).strict()),
}).strict();

export type ScenarioValidation = z.infer<typeof validation>;

/** The canonical stored scenario. */
export const TEST_SCENARIO = plannedScenario.extend({
  scenarioId: z.string().regex(/^SCN-\d{4,}$/),
  /** Content version of each requirement when the scenario was planned (§4). */
  requirementVersions: z.record(z.string(), z.number().int().positive()),
  steps: z.array(step.extend({ locatorSource: z.enum(LOCATOR_SOURCES).nullable() }).strict()),
  status: z.enum(SCENARIO_STATUSES),
  /** Workspace-relative candidate file, set by `generate` (Task Q4). */
  candidateFile: z.string().optional(),
  /** Set by `validate` (Task V2). */
  validation: validation.optional(),
  /** Set by `approve` (Task V3, DEC-042 §3.7); `approvedFile` is workspace-relative. */
  approval: z.object({ reviewer: z.string(), decidedAt: z.string(), approvedFile: z.string(), approvedSha256: z.string() }).strict().optional(),
  /** Set by `reject` (Task V3); the candidate file is kept. */
  rejection: z.object({ reviewer: z.string(), decidedAt: z.string(), reason: z.string() }).strict().optional(),
}).strict();

export type TestScenario = z.infer<typeof TEST_SCENARIO>;

export const SCENARIO_SET_SCHEMA_VERSION = 1;

export const PLAN_STOP_REASONS = ['completed', 'scenario_limit', 'budget_limit', 'ai_error', 'invalid_output'] as const;

/** One plan file (§5). */
export const SCENARIO_SET = z.object({
  schemaVersion: z.literal(SCENARIO_SET_SCHEMA_VERSION),
  planId: z.string(),
  projectId: z.string(),
  status: z.enum(['draft', 'generated']),
  createdAt: z.string(),
  requirementIds: z.array(z.string()),
  /** Requested requirements that were not planned (unresolved), with the reason. */
  excluded: z.array(z.object({ requirementId: z.string(), reason: z.string() }).strict()),
  explorationIds: z.array(z.string()),
  provider: z.object({ providerId: z.string(), modelId: z.string() }).strict(),
  limits: z.object({ maxScenarios: z.number(), maxAiRequests: z.number() }).strict(),
  usage: z.object({ aiRequests: z.number(), inputTokens: z.number(), outputTokens: z.number() }).strict(),
  stopReason: z.enum(PLAN_STOP_REASONS),
  error: z.string().nullable(),
  scenarios: z.array(TEST_SCENARIO),
  /** Model scenarios that failed a deterministic check; not given an ID. */
  rejected: z.array(z.object({ title: z.string(), reasons: z.array(z.string()) }).strict()),
  /** Expected results and negative cases of planned requirements that no kept scenario quotes. */
  notCovered: z.array(z.object({ requirementId: z.string(), case: z.string() }).strict()),
  conflicts: z.array(z.string()),
  questions: z.array(z.string()),
}).strict();

export type ScenarioSet = z.infer<typeof SCENARIO_SET>;
