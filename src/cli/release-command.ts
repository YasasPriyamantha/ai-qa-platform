/**
 * release create command (Task R1, DEC-043 §1–§3)
 *
 * Snapshots the project's requirements into `<workspace>/releases/<release-id>.json`,
 * compares them with the previous release and lists affected tests and "needs tests".
 * No AI calls.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicWriteRegistry } from '../documents/atomic-fs.js';
import { loadDocumentRegistry } from '../documents/index.js';
import { loadPhase2ProjectConfig, ConfigValidationError, getProjectStoragePaths } from '../projects/index.js';
import { loadRequirementRegistry } from '../requirements/index.js';
import { RELEASE_ID_PATTERN, RELEASE_RECORD, buildReleaseRecord, loadReleases, releasePath } from '../releases/release.js';
import { readPlanFiles } from './approve-command.js';
import { displayError } from './output.js';
import { EXIT_SUCCESS, EXIT_FAILURE } from './run-command.js';

export interface ReleaseCreateOptions {
  readonly configPath: string;
  readonly releaseId: string;
}

const refuse = (title: string, details?: string) => {
  displayError(title, details);
  return EXIT_FAILURE;
};

export function executeReleaseCreateCommand(options: ReleaseCreateOptions): number {
  if (!RELEASE_ID_PATTERN.test(options.releaseId)) {
    return refuse(`Release refused: invalid release ID "${options.releaseId}"`, 'Use 1–32 characters: lowercase letters, digits, "." and "-", starting with a letter or digit.');
  }
  let config;
  try {
    config = loadPhase2ProjectConfig(resolve(process.cwd(), options.configPath));
  } catch (err) {
    return refuse(`Release refused: ${err instanceof ConfigValidationError ? 'invalid' : 'cannot load'} project configuration`, (err as Error).message);
  }
  const workspace = config.projectWorkspace;
  const target = releasePath(workspace, options.releaseId);
  if (existsSync(target)) return refuse(`Release refused: release ${options.releaseId} already exists`, `${target} is never overwritten.`);

  let record;
  try {
    const paths = getProjectStoragePaths(workspace);
    const previous = loadReleases(workspace).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1) ?? null;
    record = buildReleaseRecord({
      releaseId: options.releaseId,
      projectId: config.projectId,
      target: { baseUrl: config.baseUrl, environment: config.environment },
      documentRegistry: loadDocumentRegistry(paths.documentsRegistryPath),
      requirements: loadRequirementRegistry(paths.requirementsRegistryPath).requirements,
      plans: readPlanFiles(workspace).values(),
      previous,
    });
  } catch (err) {
    return refuse('Release refused: cannot read the project records', (err as Error).message);
  }
  const written = atomicWriteRegistry(target, RELEASE_RECORD.parse(record));
  if (!written.success) return refuse(`Release failed: cannot write ${target}`, written.error?.message);

  console.log('');
  console.log(`  Release ${record.releaseId} created: ${target}`);
  console.log(`  Previous release: ${record.previousReleaseId ?? 'none (first release)'}`);
  console.log('');
  for (const c of record.comparison.filter((x) => x.classification !== 'unchanged')) {
    const versions = c.classification === 'changed' ? ` (version ${c.previousContentVersion} → ${c.currentContentVersion})` : '';
    console.log(`  ${c.requirementId}: ${c.classification}${versions}${c.review ? ', pending confirmation' : ''}`);
  }
  console.log(`  Unchanged requirements: ${record.comparison.filter((x) => x.classification === 'unchanged').length}`);
  console.log('');
  console.log(`  Affected tests (pending review): ${record.affectedTests.length === 0 ? 'none' : ''}`);
  for (const t of record.affectedTests) {
    console.log(`    ${t.scenarioId} ${t.approvedFile}: ${t.requirements.map((r) => `${r.requirementId} (${r.classification})`).join(', ')}`);
  }
  console.log(`  Needs tests: ${record.needsTests.length === 0 ? 'none' : record.needsTests.join(', ')}`);
  console.log('');
  return EXIT_SUCCESS;
}
