/**
 * requirements command (Task Q1, DEC-041)
 *
 * A thin CLI over the Phase 2 document and requirement services:
 *   import: ingestDocument -> importRequirements (which parses the snapshot and is all-or-nothing)
 *   list:   reads the requirement registry
 * No parsing, classification or storage logic lives here.
 */

import { dirname, resolve } from 'node:path';
import { loadPhase2ProjectConfig, getProjectStoragePaths } from '../projects/index.js';
import { ingestDocument } from '../documents/index.js';
import {
  importRequirements,
  loadRequirementRegistry,
  formatDiagnostic,
  type ImportResult,
} from '../requirements/index.js';
import { displayError } from './output.js';
import { EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';

export interface RequirementsOptions {
  readonly action: 'import' | 'list';
  readonly configPath: string;
  /** Required for import: a documentId declared in the project config. */
  readonly documentId?: string;
}

export function executeRequirementsCommand(options: RequirementsOptions): number {
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    displayError('Cannot load project configuration', (err as Error).message);
    return EXIT_FAILURE;
  }
  return options.action === 'import'
    ? importDocument(config.projectId, config.projectWorkspace, config.documents ?? [], options.documentId ?? '')
    : listRequirements(config.projectWorkspace);
}

function importDocument(
  projectId: string,
  workspace: string,
  documents: ReadonlyArray<{ documentId: string; sourcePath: string }>,
  documentId: string
): number {
  const declared = documents.find((d) => d.documentId === documentId);
  if (!declared) {
    displayError(`Document '${documentId}' is not declared in the project's documents list`);
    return EXIT_FAILURE;
  }

  let contentHash: string;
  try {
    contentHash = ingestDocument({ documentId, sourcePath: declared.sourcePath }, { workspace }).version.contentHash;
  } catch (err) {
    displayError(`Cannot ingest document '${documentId}'`, (err as Error).message);
    return EXIT_FAILURE;
  }

  const result = importRequirements(projectId, {
    documentId,
    contentHash,
    projectServiceOptions: { projectDataRoot: dirname(workspace) },
  });
  if (!result.success) {
    printImportFailure(result);
    return EXIT_FAILURE;
  }

  // The import has been saved; read the stored records for status and unresolved flags.
  const stored = loadRequirementRegistry(getProjectStoragePaths(workspace).requirementsRegistryPath).requirements;
  const plan = result.plan!;
  console.log('');
  console.log(`  Imported '${documentId}' (${contentHash.slice(0, 12)}) into ${projectId}:`);
  for (const w of plan.warnings) console.log(`    ${formatDiagnostic(w)}`);
  const line = (label: string, id: string) => {
    const req = stored[id];
    const shown = req?.status === 'retired' && label !== 'missing from document' ? 'retired' : label;
    const flag = req?.unresolved ? `  [unresolved: ${req.unresolved.reason}]` : '';
    console.log(`    ${id.padEnd(12)} ${shown}${flag}`);
  };
  for (const r of plan.newRequirements) line('new', r.requirementId);
  for (const u of plan.updatedRequirements) line('changed', u.incoming.requirementId);
  for (const s of plan.sourceUpdated) line('source updated', s.requirementId);
  for (const r of plan.unchangedRequirements) line('unchanged', r.requirementId);
  for (const m of plan.missingIds) line('missing from document', m.requirementId);
  console.log('');
  return EXIT_SUCCESS;
}

function printImportFailure(result: ImportResult): void {
  if (result.parseErrors?.length) {
    displayError('Import failed: the document has parse errors; the registry was not changed');
    for (const d of result.parseErrors) console.error(`  ${formatDiagnostic(d)}`);
    return;
  }
  displayError('Import failed; the registry was not changed', result.error?.message);
  for (const v of result.validationErrors ?? []) console.error(`  ${v.requirementId}: ${v.errors.join('; ')}`);
}

function listRequirements(workspace: string): number {
  let registry;
  try {
    registry = loadRequirementRegistry(getProjectStoragePaths(workspace).requirementsRegistryPath);
  } catch (err) {
    displayError('Cannot read the requirement registry', (err as Error).message);
    return EXIT_FAILURE;
  }
  const requirements = Object.values(registry.requirements).sort((a, b) =>
    a.requirementId.localeCompare(b.requirementId, 'en', { numeric: true })
  );
  console.log('');
  if (requirements.length === 0) console.log('  No requirements in the registry.');
  for (const req of requirements) {
    const status = req.status === 'active' && req.unresolved ? `unresolved (${req.unresolved.reason})` : req.status;
    console.log(`  ${req.requirementId.padEnd(12)} ${status.padEnd(10)} ${req.title}`);
  }
  console.log('');
  return EXIT_SUCCESS;
}
