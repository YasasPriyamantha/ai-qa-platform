/**
 * Unit tests for the requirements command (Task Q1): import and list over the
 * Phase 2 document and requirement services, in a temporary workspace.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeRequirementsCommand } from '../../../src/cli/requirements-command.js';

const req = (id: string, title: string, expected: string) => `## ${id}: ${title}

Status: Active
Priority: High

### Description

${title} description.

### Expected result

${expected}
`;

const UNRESOLVED = `## REQ-003: Sort order

Status: Active
Priority: Low

### Description

Products can be sorted.

### Unresolved

The default sort order is not specified.
`;

describe('executeRequirementsCommand', () => {
  let root: string;
  let workspace: string;
  let configPath: string;
  let out: string;
  let errors: string;

  beforeEach(() => {
    root = join(tmpdir(), `qa-req-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    workspace = join(root, 'demo');
    mkdirSync(join(workspace, 'docs'), { recursive: true });
    mkdirSync(join(workspace, 'tests', 'approved'), { recursive: true });
    configPath = join(workspace, 'project.config.json');
    writeFileSync(configPath, JSON.stringify({
      projectId: 'demo', name: 'Demo', baseUrl: 'https://www.example.com/', environment: 'demo',
      allowedDomains: ['www.example.com'], testDirectory: 'tests/approved', artifactDirectory: 'artifacts',
      documents: [{ documentId: 'reqs', sourcePath: 'docs/requirements.md', format: 'markdown' }],
    }));
    out = '';
    errors = '';
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { out += args.join(' ') + '\n'; });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors += args.join(' ') + '\n'; });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  const writeDoc = (content: string) => writeFileSync(join(workspace, 'docs', 'requirements.md'), content);
  const importDoc = () => executeRequirementsCommand({ action: 'import', configPath, documentId: 'reqs' });
  const list = () => executeRequirementsCommand({ action: 'list', configPath });
  const registryPath = () => join(workspace, 'requirements', 'registry.json');

  it('imports a clean document and lists it', () => {
    writeDoc(req('REQ-001', 'Login', 'The inventory page is shown.') + '\n' + req('REQ-002', 'Logout', 'The login page is shown.'));
    expect(importDoc()).toBe(0);
    expect(out).toMatch(/REQ-001\s+new\n/);
    expect(out).toMatch(/REQ-002\s+new\n/);
    expect(existsSync(registryPath())).toBe(true);

    out = '';
    expect(list()).toBe(0);
    expect(out).toMatch(/REQ-001\s+active\s+Login/);
    expect(out).toMatch(/REQ-002\s+active\s+Logout/);
  });

  it('classifies a second import with one changed and one new requirement', () => {
    writeDoc(req('REQ-001', 'Login', 'The inventory page is shown.') + '\n' + req('REQ-002', 'Logout', 'The login page is shown.'));
    expect(importDoc()).toBe(0);

    writeDoc(
      req('REQ-001', 'Login', 'The inventory page is shown.') + '\n' +
      req('REQ-002', 'Logout', 'The login page is shown with an empty form.') + '\n' +
      req('REQ-004', 'Cart', 'The cart badge shows 1.')
    );
    out = '';
    expect(importDoc()).toBe(0);
    expect(out).toMatch(/REQ-001\s+source updated\n/);
    expect(out).toMatch(/REQ-002\s+changed\n/);
    expect(out).toMatch(/REQ-004\s+new\n/);
  });

  it('prints line-numbered diagnostics and leaves the registry unchanged on parse errors', () => {
    writeDoc(req('REQ-001', 'Login', 'The inventory page is shown.'));
    expect(importDoc()).toBe(0);
    const before = readFileSync(registryPath(), 'utf-8');

    writeDoc(req('REQ-001', 'Login', 'Changed.') + '\n## REQ-002: Broken\n\nStatus: Maybe\nPriority: High\n');
    expect(importDoc()).toBe(1);
    expect(errors).toMatch(/parse errors; the registry was not changed/);
    expect(errors).toMatch(/ERROR \[REQ-002\] at line \d+:/);
    expect(readFileSync(registryPath(), 'utf-8')).toBe(before);
  });

  it('flags an unresolved requirement with its reason on import and in the list', () => {
    writeDoc(req('REQ-001', 'Login', 'The inventory page is shown.') + '\n' + UNRESOLVED);
    expect(importDoc()).toBe(0);
    expect(out).toMatch(/REQ-003\s+new {2}\[unresolved: The default sort order is not specified\.\]/);

    out = '';
    expect(list()).toBe(0);
    expect(out).toMatch(/REQ-003\s+unresolved \(The default sort order is not specified\.\)\s+Sort order/);
  });

  it('refuses a document that is not declared in the config', () => {
    expect(executeRequirementsCommand({ action: 'import', configPath, documentId: 'other' })).toBe(1);
    expect(errors).toMatch(/'other' is not declared/);
    expect(existsSync(registryPath())).toBe(false);
  });
});
