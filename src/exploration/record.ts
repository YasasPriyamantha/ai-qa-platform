/**
 * Observation record (Task P4, DEC-040 §3.8–3.9).
 *
 * Saves one exploration under `<project-workspace>/observations/<exploration-id>/`:
 * `evidence/<id>.txt` holds the raw snapshot text, and `observations.json`
 * (versioned, written atomically) holds the context, limits, usage, stop
 * reason, the tool-call log (no page text) and the validated summary, whose
 * claims point to evidence IDs. Model statements (the summary) are kept apart
 * from tool evidence. Conversation messages, provider continuation items and
 * secrets are never written.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicWriteRegistry } from '../documents/atomic-fs.js';
import type { BudgetConfig } from '../model-providers/index.js';
import type { CheckedSummary } from './summary.js';
import type { ExplorationResult, ExplorationStopReason, ToolCallLogEntry } from './loop.js';

/** 2: `requirementIds` and summary `actions` (Task Q2). */
export const OBSERVATION_RECORD_SCHEMA_VERSION = 2;

/** Folder of one exploration inside the project workspace. */
export function explorationDirectory(projectWorkspace: string, explorationId: string): string {
  return join(projectWorkspace, 'observations', explorationId);
}

/** A unique, sortable exploration ID, e.g. `exp-20261126T120000Z-1a2b3c`. */
export function newExplorationId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `exp-${stamp}-${randomBytes(3).toString('hex')}`;
}

export interface ExplorationContext {
  readonly explorationId: string;
  readonly projectId: string;
  readonly startUrl: string;
  /** Requirements that guided the exploration; empty when none. */
  readonly requirementIds: readonly string[];
  readonly providerId: string;
  readonly modelId: string;
  readonly startedAt: string;
  readonly limits: {
    readonly maxAiRequests: number;
    readonly maxToolCalls: number;
    readonly maxDurationMs: number;
    readonly callTimeoutMs: number;
    readonly budget: Omit<BudgetConfig, 'costEstimate' | 'unknownPricingPolicy'>;
  };
}

export interface ObservationRecord {
  readonly schemaVersion: typeof OBSERVATION_RECORD_SCHEMA_VERSION;
  readonly explorationId: string;
  readonly projectId: string;
  /** Releases arrive in Phase 7. */
  readonly releaseId: null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly startUrl: string;
  readonly requirementIds: readonly string[];
  readonly provider: { readonly providerId: string; readonly modelId: string };
  readonly limits: ExplorationContext['limits'];
  readonly usage: {
    readonly aiRequests: number;
    readonly toolCalls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly stopReason: ExplorationStopReason;
  readonly error: string | null;
  /** Pages the browser was on after successful tool calls, in first-visit order. */
  readonly pagesVisited: readonly string[];
  readonly toolCalls: readonly ToolCallLogEntry[];
  readonly evidence: readonly { readonly id: string; readonly toolName: string; readonly file: string }[];
  /** The model's statements, each claim citing evidence IDs; null when no valid summary was returned. */
  readonly summary: CheckedSummary | null;
}

/**
 * Write the evidence files, then `observations.json` atomically.
 *
 * @returns Absolute path of `observations.json`
 * @throws Error when the record cannot be written
 */
export function saveExplorationRecord(
  projectWorkspace: string,
  context: ExplorationContext,
  result: ExplorationResult,
  finishedAt: Date = new Date()
): { readonly recordPath: string; readonly record: ObservationRecord } {
  const dir = explorationDirectory(projectWorkspace, context.explorationId);
  mkdirSync(join(dir, 'evidence'), { recursive: true });
  const evidence = result.evidence.map((item) => {
    const file = `evidence/${item.id}.txt`;
    writeFileSync(join(dir, file), item.text, 'utf-8');
    return { id: item.id, toolName: item.toolName, file };
  });

  const { limits, explorationId, projectId, startedAt, startUrl, requirementIds, providerId, modelId } = context;
  const record: ObservationRecord = {
    schemaVersion: OBSERVATION_RECORD_SCHEMA_VERSION,
    explorationId,
    projectId,
    releaseId: null,
    startedAt,
    finishedAt: finishedAt.toISOString(),
    startUrl,
    requirementIds,
    provider: { providerId, modelId },
    limits,
    usage: {
      aiRequests: result.budgetState.requestCount,
      toolCalls: result.toolCalls,
      inputTokens: result.budgetState.cumulativeInputTokens,
      outputTokens: result.budgetState.cumulativeOutputTokens,
    },
    stopReason: result.stopReason,
    error: result.error ?? null,
    pagesVisited: [...new Set(result.toolLog.flatMap((e) => (e.pageUrl && e.pageUrl !== 'about:blank' ? [e.pageUrl] : [])))],
    toolCalls: result.toolLog,
    evidence,
    summary: result.summary ?? null,
  };

  const recordPath = join(dir, 'observations.json');
  const written = atomicWriteRegistry(recordPath, record);
  if (!written.success) throw written.error ?? new Error(`Cannot write ${recordPath}`);
  return { recordPath, record };
}
