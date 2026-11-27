/**
 * requirements propose | review (Task Q5, DEC-041 §1)
 *
 * propose: ingestDocument (original snapshot preserved) -> one structured AI
 *          request -> deterministic checks -> createProposal(). The registry
 *          is not touched.
 * review:  acceptProposedRequirement / rejectProposedRequirement for the
 *          listed IDs; only accepted items reach the registry.
 */

import { dirname, resolve } from 'node:path';
import { loadPhase2ProjectConfig, getProjectStoragePaths } from '../projects/index.js';
import { ingestDocument, type IngestDocumentResult } from '../documents/index.js';
import { createOpenAIAdapter, type ProviderAdapter } from '../model-providers/index.js';
import { acceptProposedRequirement, loadRequirementRegistry, rejectProposedRequirement } from '../requirements/index.js';
import { proposeRequirements } from '../requirements/proposer.js';
import { loadAiSetup } from './ai-setup.js';
import { displayError } from './output.js';
import { EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';

export interface ProposeCommandOptions {
  readonly configPath: string;
  readonly documentId: string;
  /** Directory holding .env and config/ (default: current working directory). */
  readonly rootDir?: string;
  /** Adapter override; tests inject a fake. Default: the OpenAI adapter. */
  readonly adapter?: ProviderAdapter;
}

export async function executeProposeCommand(options: ProposeCommandOptions): Promise<number> {
  const refuse = (title: string, details?: string) => {
    displayError(`Proposal refused: ${title}`, details);
    return EXIT_FAILURE;
  };
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    return refuse('cannot load project configuration', (err as Error).message);
  }
  const declared = (config.documents ?? []).find((d) => d.documentId === options.documentId);
  if (!declared) return refuse(`document '${options.documentId}' is not declared in the project's documents list`);

  let existingIds: Set<string>;
  try {
    existingIds = new Set(Object.keys(loadRequirementRegistry(getProjectStoragePaths(config.projectWorkspace).requirementsRegistryPath).requirements));
  } catch (err) {
    return refuse('cannot read the requirement registry', (err as Error).message);
  }

  const ai = loadAiSetup(options.rootDir ?? process.cwd());
  if (!ai.ok) return refuse(ai.title, ai.details);
  const { secretContext, provider, budget } = ai.setup;

  let ingested: IngestDocumentResult;
  try {
    ingested = ingestDocument({ documentId: declared.documentId, sourcePath: declared.sourcePath }, { workspace: config.projectWorkspace });
  } catch (err) {
    return refuse(`cannot ingest document '${options.documentId}'`, (err as Error).message);
  }

  console.log(`  Proposing requirements from '${options.documentId}' (${ingested.version.contentHash.slice(0, 12)}, ${provider.providerId} ${provider.defaultModelId})...`);
  let outcome;
  try {
    outcome = await proposeRequirements({
      projectId: config.projectId,
      projectWorkspace: config.projectWorkspace,
      ingested,
      existingIds,
      providerId: provider.providerId,
      modelId: provider.defaultModelId,
      adapter: options.adapter ?? createOpenAIAdapter(),
      secretContext,
      budgetConfig: budget,
    });
  } catch (err) {
    displayError('Proposal failed', (err as Error).message);
    return EXIT_FAILURE;
  }
  console.log('');
  console.log(`  Stop reason:  ${outcome.stopReason}${outcome.error ? ` (${outcome.error})` : ''}`);
  for (const p of outcome.proposed) {
    const range = p.sourceReference.lineRange!;
    console.log(`    - ${p.proposedId} (lines ${range.start}-${range.end}) ${p.title}${p.unresolved ? `  [unresolved: ${p.unresolved.reason}]` : ''}`);
  }
  for (const r of outcome.rejected) console.log(`  Rejected:     ${r.proposedId}: ${r.reasons.join('; ')}`);
  console.log(`  Tokens:       input ${outcome.usage.inputTokens}, output ${outcome.usage.outputTokens} (${outcome.usage.aiRequests} request(s))`);
  if (outcome.saved?.success) console.log(`  Proposal:     ${outcome.saved.proposalId} (${outcome.saved.proposalPath})`);
  console.log('');
  return outcome.stopReason === 'completed' ? EXIT_SUCCESS : EXIT_FAILURE;
}

export interface ReviewCommandOptions {
  readonly configPath: string;
  readonly proposalId: string;
  readonly accept: readonly string[];
  readonly reject: readonly string[];
}

export function executeReviewCommand(options: ReviewCommandOptions): number {
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    displayError('Cannot load project configuration', (err as Error).message);
    return EXIT_FAILURE;
  }
  const projectServiceOptions = { projectDataRoot: dirname(config.projectWorkspace) };
  let failed = false;
  console.log('');
  for (const id of options.accept) {
    const result = acceptProposedRequirement(config.projectId, options.proposalId, id, { reviewer: 'cli', projectServiceOptions });
    if (result.success) console.log(`  ${id.padEnd(12)} accepted${result.wasRetry ? ' (already in the registry)' : ''}`);
    else {
      failed = true;
      console.log(`  ${id.padEnd(12)} not accepted: ${[result.error?.message, ...(result.validationErrors ?? [])].join('; ')}`);
    }
  }
  for (const id of options.reject) {
    const result = rejectProposedRequirement(config.projectId, options.proposalId, id, { reviewer: 'cli', reason: 'Rejected in requirements review', projectServiceOptions });
    if (result.success) console.log(`  ${id.padEnd(12)} rejected`);
    else {
      failed = true;
      console.log(`  ${id.padEnd(12)} not rejected: ${result.error?.message}`);
    }
  }
  console.log('');
  return failed ? EXIT_FAILURE : EXIT_SUCCESS;
}
