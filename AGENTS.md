# Agent Instructions — AI QA Automation Platform

## Project context

This is the AI-Powered QA Automation Platform, a TypeScript/Node.js project that provides AI-assisted browser test automation using Playwright Test.

**Current status:** Phase 1 implementation in progress
**Module system:** ES Modules (ESM)
**Working directory:** D:\ai-qa-platform

## Required reading before tasks

1. Read relevant Phase 0 documents from `docs/`:
   - `PROJECT_SPEC.md` — Product requirements and goals
   - `ARCHITECTURE.md` — System design and component responsibilities
   - `IMPLEMENTATION_PLAN.md` — Phased task breakdown and acceptance criteria
   - `DECISIONS.md` — Architecture and implementation decision record

2. Review the current task definition and its acceptance criteria in `IMPLEMENTATION_PLAN.md`

## Development workflow

1. **Inspect first:** Check `git status`, existing files, installed versions, and repository state before editing
2. **Use the reliable-ai-coding skill:** Available in `.claude/skills/reliable-ai-coding/SKILL.md`
   - If the skill is not available, follow its core practices:
     - Inspect actual repository state before assuming
     - Make the smallest correct change for the current task
     - Define observable acceptance criteria
     - Verify with executable commands and tests
     - Review the complete diff before finishing
     - Report what was and was not verified honestly
3. **Windows compatibility:** Use PowerShell-compatible commands on this Windows repository
4. **Preserve user work:** Inspect working tree and preserve pre-existing uncommitted changes
5. **No destructive actions:** Never commit, push, deploy, delete user work, or perform irreversible operations
6. **Task boundaries:** Implement only the current requested task; do not implement later-phase features early

## Build and test commands

```bash
npm run build      # Compile src/ to dist/
npm run typecheck  # Type-check all TypeScript (no emit)
npm test           # Run platform unit/integration tests (Vitest)
npm run qa         # Execute CLI (placeholder in Phase 1)
```

## Project structure

```
ai-qa-platform/
├── src/              # Platform source code (compiles to dist/)
├── tests/
│   ├── unit/         # Platform unit tests (.test.ts, Vitest)
│   ├── integration/  # Platform integration tests (.test.ts, Vitest)
│   └── fixtures/     # Runner test fixtures (.spec.ts, Playwright)
├── project-data/     # Target application projects (added in Phase 1)
├── dist/             # Compiled JavaScript (excluded from Git)
├── docs/             # Phase 0 baseline documents
└── playwright.config.ts  # Platform-owned Playwright configuration
```

## Module system and imports

- **Type:** ES Modules (ESM) with `"type": "module"` in package.json
- **Import paths:** Always include `.js` extension in imports from TypeScript files
  ```typescript
  // Correct
  import { VERSION } from './version.js';

  // Incorrect
  import { VERSION } from './version';
  ```
- **Root config can import from src/:** Verified compatible (Task 1.1)

## Test naming conventions

- **Platform tests:** `.test.ts` files (Vitest discovers these)
- **Playwright tests:** `.spec.ts` files (Playwright Test runs these)

Vitest is configured to discover only `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`, explicitly excluding `tests/fixtures/**` and `project-data/**`.

## Phase boundaries

- **Phase 1 (current):** Generic Playwright execution engine
  - Build system, configuration, CLI, runner, reporting
  - No AI, no MCP, no SQLite, no web UI yet
  - Deterministic execution must work without AI

Later phases add AI integration, MCP exploration, test generation, release comparison, and local UI.

## Decision record

Architecture and implementation decisions are recorded in `docs/DECISIONS.md`. When a design choice affects multiple tasks or phases, consult the decision log.

## Version control

- Git repository on branch `main`
- User handles all commits after reviewing changes
- Never use `git commit`, `git push`, or destructive Git commands

## Reporting completion

For each task, report:
- Files changed
- Commands run and their actual results
- Acceptance criteria met
- Items not verified (missing environment, blocked checks)
- Remaining risks or assumptions

Never claim a check passed unless it was actually executed and its output observed.
