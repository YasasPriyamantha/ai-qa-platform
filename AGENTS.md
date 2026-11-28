# Agent Instructions — AI QA Automation Platform

## Project context

This is the AI-Powered QA Automation Platform, a TypeScript/Node.js project that provides AI-assisted browser test automation using Playwright Test.

**Current status:** Phase 6 complete (2026-11-28; Phases 3–6 complete, MVP-first per DEC-039): candidate validation, human approval and CI with approved AI-planned tests (`docs/PHASE_6_PLAN.md`, DEC-042). Planner fix F1 done. Phase 7 in progress: release records, deterministic requirement comparison, review of affected tests and regression reports. The current task list is in `docs/PHASE_7_PLAN.md` (DEC-043). Progress is recorded only in `docs/IMPLEMENTATION_PLAN.md`.
**Module system:** ES Modules (ESM)
**Working directory:** D:\ai-qa-platform

## Required reading before tasks

1. Read relevant Phase 0 documents from `docs/`:
   - `PROJECT_SPEC.md` — Product requirements and goals
   - `ARCHITECTURE.md` — System design and component responsibilities
   - `IMPLEMENTATION_PLAN.md` — Phased task breakdown and acceptance criteria
   - `DECISIONS.md` — Architecture and implementation decision record

2. Review the current task definition and its acceptance criteria in `docs/PHASE_7_PLAN.md` (current phase) or `IMPLEMENTATION_PLAN.md`.

3. Files in `docs/archive/` are historical records. Do not treat them as instructions.

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
3. **Optional: software-engineering-best-practices skill:** Available in `.claude/skills/software-engineering-best-practices/SKILL.md`, with references in its `references/` folder. Use it only as far as the current task needs; it is not a reason to add scope.
4. **Windows compatibility:** Use PowerShell-compatible commands on this Windows repository
5. **Preserve user work:** Inspect working tree and preserve pre-existing uncommitted changes
6. **No destructive actions:** Never commit, push, deploy, delete user work, or perform irreversible operations
7. **Task boundaries:** Implement only the current requested task; do not implement later-phase features early

## Scope discipline (mandatory, DEC-039)

1. **Implement only the listed acceptance criteria.** No extra options, configuration settings, abstractions, "future-proofing" or features that nothing currently needs. If something extra seems necessary, stop and ask.
2. **Every new exported function or type needs a production caller** in this task or the next listed task. Don't build code that only tests use.
3. **Reuse existing types and helpers.** Search `src/` before creating a type, validator or utility. Never create a parallel version of an existing contract.
4. **Respect the size budget** given in the task. If the change would exceed it, stop and explain before continuing.
5. **No new dependencies** unless the task names them.
6. **Never skip, weaken or delete a test to make the suite pass.** If a test cannot pass, stop and report the root cause. Tests for behaviour that only exists on one OS may be limited to that OS with a comment explaining why.
7. **Tests must pass on Windows and Linux** (CI runs on Linux). Tests write only to `os.tmpdir()`, never into the repository.
8. **Keep tests proportionate.** Test the behaviour named in the acceptance criteria and its important failure cases. Don't add many tests for trivial type guards or constants.
9. **Don't edit `docs/DECISIONS.md` or other source documents** unless the task says to.
10. **No unrelated refactoring or cleanup.** Don't rename, reorganise, consolidate or delete existing code during a task unless a criterion requires it. List suspected dead code or duplication in the report instead.
11. **Report against the criteria:** a table of criterion → file:line → test name or command output, then raw Vitest summary lines and `git status --short`. Say "not met" for anything without evidence. Never call a task complete because a module exists or typecheck passes.

## Build and test commands

```bash
npm run build      # Compile src/ to dist/
npm run typecheck  # Type-check all TypeScript (no emit)
npm test           # All platform tests (unit + slow browser integration tests)
npm run test:unit  # Fast platform unit tests (added in Task N1)
npm run qa -- run --config <path>  # Run a project's approved Playwright tests (requires npm run build first)
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

- **Phases 1–2 (complete):** Playwright execution engine; project and requirement management.
- **Phase 3 (complete, MVP, DEC-039):** OpenAI adapter only, plus a CLI AI check. Anthropic, Gemini and OpenAI-compatible adapters, and the persistent usage ledger, are deferred. Don't extend them.
- **CI mode:** CI runs only approved Playwright tests. It never calls AI providers, MCP or the usage ledger.

- **Phase 4 (complete):** Playwright MCP read-only exploration; observations saved with evidence (DEC-040).
- **Phase 5 (complete, 2026-11-27):** requirement import, interactive exploration, requirement-traced planning and template-based candidate generation (DEC-041, `docs/PHASE_5_PLAN.md`). The AI plans; the platform writes test code. Phase 5 code never wrote to `tests/approved/` (the current rule is in the Phase 6 line).
- **Phase 6 (complete, 2026-11-28):** role credentials in runs, three-run candidate validation, human approval into `tests/approved/`, and CI running approved AI-planned tests (DEC-042, `docs/PHASE_6_PLAN.md`). `storageState` is deferred. Only `approve` writes to `tests/approved/`; never edit candidate or approved files by hand.
- **Phase 7 (current):** release records, deterministic requirement comparison, review of affected tests (keep or retire into `tests/retired/`), release runs and regression reports, and demo app V2 (DEC-043, `docs/PHASE_7_PLAN.md`). Only `approve` and `release review` change `tests/approved/`; never edit candidate, approved or retired test files by hand.

Phase 6 added candidate validation and approval. Phase 7 adds release comparison; Phase 8 adds a local UI.

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
Never delete files or folders you did not create in the current task (including artifact and run folders). Ask the user first.
