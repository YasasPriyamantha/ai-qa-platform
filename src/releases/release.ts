/**
 * Release records and deterministic requirement comparison (Task R1, DEC-043 §1–§3).
 *
 * A release is `<workspace>/releases/<release-id>.json`, created once and never
 * overwritten. It snapshots the requirement registry, compares it by author-assigned
 * ID with the previous release (the most recently created one) and flags approved
 * tests linked to changed, retired, missing or unresolved requirements. No AI.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from '../model-providers/index.js';
import type { DocumentRegistry } from '../documents/index.js';
import { getCurrentVersion } from '../documents/index.js';
import type { RequirementWithHistory } from '../requirements/index.js';
import type { ScenarioSet } from '../planning/scenario.js';

/** 1–32 characters: lowercase letters, digits, `.` and `-`, starting with a letter or digit (§3.1). */
export const RELEASE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,31}$/;

const CLASSIFICATIONS = ['new', 'changed', 'unchanged', 'retired', 'unresolved', 'missing'] as const;
type Classification = (typeof CLASSIFICATIONS)[number];

/** Classifications whose requirement and linked approved tests need review (§3.3). */
const FLAGGED: readonly Classification[] = ['changed', 'retired', 'missing', 'unresolved'];

const snapshotEntry = z.object({
  requirementId: z.string(),
  status: z.enum(['active', 'retired']),
  unresolved: z.boolean(),
  contentVersion: z.number().int().positive(),
  sourceContentHash: z.string(),
}).strict();

type SnapshotEntry = z.infer<typeof snapshotEntry>;

export const RELEASE_RECORD = z.object({
  schemaVersion: z.literal(1),
  releaseId: z.string().regex(RELEASE_ID_PATTERN),
  projectId: z.string(),
  createdAt: z.string(),
  previousReleaseId: z.string().nullable(),
  target: z.object({ baseUrl: z.string(), environment: z.string() }).strict(),
  documents: z.array(z.object({ documentId: z.string(), contentHash: z.string() }).strict()),
  requirements: z.array(snapshotEntry),
  comparison: z.array(z.object({
    requirementId: z.string(),
    classification: z.enum(CLASSIFICATIONS),
    previousContentVersion: z.number().int().positive().nullable(),
    currentContentVersion: z.number().int().positive(),
    /** `pending` for flagged changes awaiting confirmation; null otherwise. */
    review: z.literal('pending').nullable(),
  }).strict()),
  affectedTests: z.array(z.object({
    scenarioId: z.string(),
    approvedFile: z.string(),
    requirements: z.array(z.object({ requirementId: z.string(), classification: z.enum(CLASSIFICATIONS) }).strict()),
    review: z.literal('pending'),
  }).strict()),
  /** Active, resolved `new` or `changed` requirements without an approved test for their current content version. */
  needsTests: z.array(z.string()),
  /** Filled by `release review` (Task R2). */
  reviews: z.array(z.never()),
  /** Filled by `run --release` (Task R3). */
  runs: z.array(z.never()),
}).strict();

export type ReleaseRecord = z.infer<typeof RELEASE_RECORD>;

const releasesDir = (workspace: string) => join(workspace, 'releases');
export const releasePath = (workspace: string, releaseId: string) => join(releasesDir(workspace), `${releaseId}.json`);

/** All release records of a workspace; throws when one cannot be read or parsed. */
export function loadReleases(workspace: string): ReleaseRecord[] {
  const dir = releasesDir(workspace);
  return (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []).map((file) => {
    try {
      return RELEASE_RECORD.parse(JSON.parse(readFileSync(join(dir, file), 'utf-8')));
    } catch (err) {
      throw new Error(`cannot read release record ${join(dir, file)}: ${(err as Error).message}`);
    }
  });
}

/** Build a new release record from the registries, the plan files and the previous release. */
export function buildReleaseRecord(input: {
  releaseId: string;
  projectId: string;
  target: ReleaseRecord['target'];
  documentRegistry: DocumentRegistry;
  requirements: Record<string, RequirementWithHistory>;
  plans: Iterable<ScenarioSet>;
  previous: ReleaseRecord | null;
}): ReleaseRecord {
  const currentHashes = new Map<string, string>();
  for (const [documentId, record] of Object.entries(input.documentRegistry.documents)) {
    const version = getCurrentVersion(record);
    if (version) currentHashes.set(documentId, version.contentHash);
  }

  const snapshot: SnapshotEntry[] = Object.values(input.requirements)
    .map((r) => ({
      requirementId: r.requirementId,
      status: r.status,
      unresolved: r.unresolved !== undefined,
      contentVersion: (r.history?.length ?? 0) + 1,
      sourceContentHash: r.sourceReference.contentHash,
    }))
    .sort((a, b) => a.requirementId.localeCompare(b.requirementId));

  // Import rewrites the source hash of every requirement still in the document, so an active
  // requirement with another hash than its document's current version is absent from it.
  const missing = new Set(Object.values(input.requirements)
    .filter((r) => r.status === 'active' && r.sourceReference.contentHash !== currentHashes.get(r.sourceReference.documentId))
    .map((r) => r.requirementId));
  const before = new Map(input.previous?.requirements.map((r) => [r.requirementId, r]) ?? []);
  const comparison = snapshot.map((cur) => {
    const prev = before.get(cur.requirementId);
    const classification = classify(cur, prev, input.previous !== null, missing.has(cur.requirementId));
    return {
      requirementId: cur.requirementId,
      classification,
      previousContentVersion: prev?.contentVersion ?? null,
      currentContentVersion: cur.contentVersion,
      review: FLAGGED.includes(classification) ? ('pending' as const) : null,
    };
  });
  const classOf = new Map(comparison.map((c) => [c.requirementId, c.classification]));

  const approved = [...input.plans].flatMap((p) => p.scenarios).filter((s) => s.status === 'approved' && s.approval);
  const affectedTests = approved
    .filter((s) => s.requirementIds.some((id) => FLAGGED.includes(classOf.get(id)!)))
    .map((s) => ({
      scenarioId: s.scenarioId,
      approvedFile: s.approval!.approvedFile,
      requirements: s.requirementIds.filter((id) => classOf.has(id)).map((id) => ({ requirementId: id, classification: classOf.get(id)! })),
      review: 'pending' as const,
    }));

  const needsTests = snapshot
    .filter((r) => (classOf.get(r.requirementId) === 'new' || classOf.get(r.requirementId) === 'changed') && r.status === 'active' && !r.unresolved)
    .filter((r) => !approved.some((s) => s.requirementVersions[r.requirementId] === r.contentVersion))
    .map((r) => r.requirementId);

  return {
    schemaVersion: 1,
    releaseId: input.releaseId,
    projectId: input.projectId,
    createdAt: new Date().toISOString(),
    previousReleaseId: input.previous?.releaseId ?? null,
    target: input.target,
    documents: [...currentHashes].map(([documentId, contentHash]) => ({ documentId, contentHash })),
    requirements: snapshot,
    comparison,
    affectedTests,
    needsTests,
    reviews: [],
    runs: [],
  };
}

/** §3.2; the first release of a project has no previous release, so everything is `new`. */
function classify(cur: SnapshotEntry, prev: SnapshotEntry | undefined, hasPrevious: boolean, missing: boolean): Classification {
  if (!hasPrevious || !prev) return 'new';
  if (prev.status === 'active' && cur.status === 'retired') return 'retired';
  if (cur.unresolved && !prev.unresolved) return 'unresolved';
  if (missing) return 'missing';
  if (cur.contentVersion > prev.contentVersion) return 'changed';
  return 'unchanged';
}
