/**
 * Integration test for role credentials in `run` (Task V1, DEC-042 §3.2).
 *
 * Runs real Playwright against a temp workspace whose fixture test checks process.env
 * and prints nothing. The workspace links the repository node_modules so the spec can
 * import @playwright/test (a junction on Windows needs no admin rights).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { executeRunCommand } from '../../../src/cli/run-command.js';

const ENV_ONLY = 'sentinel-env-only-7f3a';
const INHERITED_ONLY = 'sentinel-inherited-only-9c1d';
const BOTH_ENV = 'sentinel-both-from-env-2b8e';
const BOTH_INHERITED = 'sentinel-both-inherited-5e4f';
const AI_KEY = 'sentinel-openai-key-6a0c';

// The spec reads its expected values from a file outside the run directory, so no
// sentinel appears in the spec source (which Playwright reports may embed).
const SPEC = `import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
test('role credentials reach Playwright', () => {
  const expected = JSON.parse(readFileSync(join(dirname(test.info().file), '..', '..', '..', 'expected.json'), 'utf-8'));
  expect(process.env.V1_ENV_ONLY === expected.envOnly).toBe(true);
  expect(process.env.V1_INHERITED_ONLY === expected.inheritedOnly).toBe(true);
  expect(process.env.V1_BOTH === expected.both).toBe(true);
  expect(process.env.OPENAI_API_KEY).toBeUndefined();
  expect(process.env.V1_MISSING || undefined).toBeUndefined();
});
`;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

describe('run: role credentials (V1)', () => {
  let workspace: string;
  let output: string;
  let exitCode: number;

  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), 'qa-v1-credentials-'));
    symlinkSync(resolve(process.cwd(), 'node_modules'), join(workspace, 'node_modules'), 'junction');
    mkdirSync(join(workspace, 'project', 'tests', 'approved'), { recursive: true });
    writeFileSync(join(workspace, 'project', 'tests', 'approved', 'credentials.spec.ts'), SPEC);
    writeFileSync(join(workspace, 'project', 'project.config.json'), JSON.stringify({
      projectId: 'v1-credentials',
      name: 'V1 Credentials',
      baseUrl: 'http://localhost',
      environment: 'local',
      allowedDomains: ['localhost'],
      testDirectory: 'tests/approved',
      artifactDirectory: 'artifacts',
      roles: [{
        roleId: 'tester',
        name: 'Tester',
        credentials: { a: 'V1_ENV_ONLY', b: 'V1_INHERITED_ONLY', c: 'V1_BOTH', d: 'V1_MISSING' },
      }],
    }));
    writeFileSync(join(workspace, 'expected.json'), JSON.stringify({ envOnly: ENV_ONLY, inheritedOnly: INHERITED_ONLY, both: BOTH_ENV }));
    writeFileSync(join(workspace, '.env'), [
      `V1_ENV_ONLY=${ENV_ONLY}`,
      `V1_BOTH=${BOTH_ENV}`,
      `OPENAI_API_KEY=${AI_KEY}`,
      'V1_MISSING=',
    ].join('\n'));

    vi.stubEnv('V1_INHERITED_ONLY', INHERITED_ONLY);
    vi.stubEnv('V1_BOTH', BOTH_INHERITED);
    vi.stubEnv('V1_MISSING', '');
    vi.stubEnv('OPENAI_API_KEY', '');

    const chunks: string[] = [];
    const capture = (chunk: unknown): boolean => { chunks.push(String(chunk)); return true; };
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => { chunks.push(args.join(' ')); });
    const err = vi.spyOn(console, 'error').mockImplementation((...args) => { chunks.push(args.join(' ')); });
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    const errWrite = vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    try {
      exitCode = await executeRunCommand(join(workspace, 'project', 'project.config.json'), workspace);
    } finally {
      log.mockRestore(); err.mockRestore(); out.mockRestore(); errWrite.mockRestore();
      vi.unstubAllEnvs();
    }
    output = chunks.join('');
  }, 120000);

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('passes .env values, falls back to inherited values, prefers .env, and never passes AI keys', () => {
    // The fixture test asserts each value inside Playwright; a pass means all checks held.
    expect(output).toContain('1 passed');
    expect(exitCode).toBe(0);
  });

  it('warns about missing role credential variables by name only', () => {
    expect(output).toMatch(/Warning: role credential variables not set in \.env or the environment: V1_MISSING\s/);
  });

  it('prints no credential value and writes none into the run directory', () => {
    const sentinels = [ENV_ONLY, INHERITED_ONLY, BOTH_ENV, BOTH_INHERITED, AI_KEY];
    for (const s of sentinels) expect(output).not.toContain(s);
    const files = listFiles(join(workspace, 'project', 'artifacts'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(file).toString('latin1');
      for (const s of sentinels) expect(content, `${file} contains ${s}`).not.toContain(s);
    }
  });
});
