/**
 * Exploration summary schema (Task P3, DEC-037, DEC-040 §3.9).
 *
 * The model's final answer is structured output validated locally with this
 * canonical schema. Every claim cites the evidence IDs it is based on; a claim
 * citing no evidence or unknown evidence is kept and marked `unsupported`.
 */

import { createCanonicalSchema, z } from '../model-providers/index.js';

/** MCP element references (e.g. `ref=e12`) are temporary and must not appear in the summary (§3.9). */
const ELEMENT_REFERENCE = /\bref\s*=\s*e\d+/i;

const text = z.string().refine((s) => !ELEMENT_REFERENCE.test(s), 'must not contain MCP element references (ref=…)');
const evidenceIds = z.array(z.string());
const roleAndName = { role: text, name: text };

const summarySchema = z.object({
  pages: z.array(z.object({
    url: text,
    title: text,
    evidenceIds,
    elements: z.array(z.object({ ...roleAndName, evidenceIds }).strict()),
    forms: z.array(z.object({
      name: text,
      fields: z.array(z.object(roleAndName).strict()),
      evidenceIds,
    }).strict()),
    links: z.array(z.object({ name: text, url: text, evidenceIds }).strict()),
  }).strict()),
  blockers: z.array(z.object({ description: text, evidenceIds }).strict()),
}).strict();

export type ExplorationSummary = z.infer<typeof summarySchema>;

export const EXPLORATION_SUMMARY_SCHEMA = createCanonicalSchema({
  id: 'exploration-summary',
  version: 1,
  name: 'exploration_summary',
  zodSchema: summarySchema,
});

type Page = ExplorationSummary['pages'][number];
type Checked<T> = T & { readonly unsupported: boolean };

/** The validated summary with each claim marked supported or not. */
export interface CheckedSummary {
  readonly pages: readonly (Checked<Omit<Page, 'elements' | 'forms' | 'links'>> & {
    readonly elements: readonly Checked<Page['elements'][number]>[];
    readonly forms: readonly Checked<Page['forms'][number]>[];
    readonly links: readonly Checked<Page['links'][number]>[];
  })[];
  readonly blockers: readonly Checked<ExplorationSummary['blockers'][number]>[];
}

/** Mark each claim `unsupported` when it cites no evidence or evidence not in `knownIds`. */
export function checkEvidence(summary: ExplorationSummary, knownIds: ReadonlySet<string>): CheckedSummary {
  const check = <T extends { evidenceIds: string[] }>(claim: T): Checked<T> => ({
    ...claim,
    unsupported: claim.evidenceIds.length === 0 || claim.evidenceIds.some((id) => !knownIds.has(id)),
  });
  return {
    pages: summary.pages.map((page) => ({
      ...check(page),
      elements: page.elements.map(check),
      forms: page.forms.map(check),
      links: page.links.map(check),
    })),
    blockers: summary.blockers.map(check),
  };
}
