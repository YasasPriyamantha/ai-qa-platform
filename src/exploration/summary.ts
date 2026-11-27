/**
 * Exploration summary schema (Task P3, DEC-037, DEC-040 §3.9).
 *
 * The model's final answer is structured output validated locally with this
 * canonical schema. Every claim cites the evidence IDs it is based on; a claim
 * citing no evidence or unknown evidence is kept and marked `unsupported`.
 * An element, form field or action is also `unsupported` unless its accessible
 * name appears in the text of a cited evidence file (Task Q2, DEC-041 §8).
 */

import { createCanonicalSchema, z } from '../model-providers/index.js';
import type { Evidence } from '../mcp/tool-gateway.js';

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
    /** Buttons and links the user can act on, by role and accessible name. */
    actions: z.array(z.object({ ...roleAndName, evidenceIds }).strict()),
  }).strict()),
  blockers: z.array(z.object({ description: text, evidenceIds }).strict()),
}).strict();

export type ExplorationSummary = z.infer<typeof summarySchema>;

export const EXPLORATION_SUMMARY_SCHEMA = createCanonicalSchema({
  id: 'exploration-summary',
  version: 2,
  name: 'exploration_summary',
  zodSchema: summarySchema,
});

type Page = ExplorationSummary['pages'][number];
type Form = Page['forms'][number];
type Checked<T> = T & { readonly unsupported: boolean };

/** The validated summary with each claim marked supported or not. */
export interface CheckedSummary {
  readonly pages: readonly (Checked<Omit<Page, 'elements' | 'forms' | 'links' | 'actions'>> & {
    readonly elements: readonly Checked<Page['elements'][number]>[];
    readonly forms: readonly (Checked<Omit<Form, 'fields'>> & { readonly fields: readonly Checked<Form['fields'][number]>[] })[];
    readonly links: readonly Checked<Page['links'][number]>[];
    readonly actions: readonly Checked<Page['actions'][number]>[];
  })[];
  readonly blockers: readonly Checked<ExplorationSummary['blockers'][number]>[];
}

const normalise = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Mark each claim `unsupported` when it cites no evidence or evidence not in
 * `evidence`; an element, form field or action also when its name is not in
 * the text of any evidence it (or its form) cites (§8).
 */
export function checkEvidence(summary: ExplorationSummary, evidence: readonly Evidence[]): CheckedSummary {
  const texts = new Map(evidence.map((e) => [e.id, normalise(e.text)]));
  const cited = (ids: string[]) => ids.length > 0 && ids.every((id) => texts.has(id));
  const named = (name: string, ids: string[]) => normalise(name) !== '' && ids.some((id) => texts.get(id)?.includes(normalise(name)));
  const check = <T extends { evidenceIds: string[] }>(claim: T): Checked<T> => ({ ...claim, unsupported: !cited(claim.evidenceIds) });
  const checkNamed = <T extends { name: string; evidenceIds: string[] }>(claim: T): Checked<T> =>
    ({ ...claim, unsupported: !cited(claim.evidenceIds) || !named(claim.name, claim.evidenceIds) });
  return {
    pages: summary.pages.map((page) => ({
      ...check(page),
      elements: page.elements.map(checkNamed),
      forms: page.forms.map((form) => ({
        ...check(form),
        fields: form.fields.map((field) => ({ ...field, unsupported: !cited(form.evidenceIds) || !named(field.name, form.evidenceIds) })),
      })),
      links: page.links.map(check),
      actions: page.actions.map(checkNamed),
    })),
    blockers: summary.blockers.map(check),
  };
}
