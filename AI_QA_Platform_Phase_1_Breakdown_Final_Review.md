# AI QA Automation Platform — Phase 1 Mini-Task Breakdown

**Phase:** 1 — Generic Playwright Execution Engine  
**Status:** Ready to start with Task 1.0  
**Estimated effort:** 14–22 focused hours (the existing Phase 1 estimate; Task 1.5 is split into 1.5a and 1.5b without increasing its combined estimate)

This document turns Phase 1 of `docs/IMPLEMENTATION_PLAN.md` into small, independently reviewable tasks. It is based on the four Phase 0 baseline documents:

- `docs/PROJECT_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DECISIONS.md`

The prompts also follow the `reliable-ai-coding` skill: inspect the actual repository and versions first, make the smallest focused change, define observable acceptance criteria, verify with executable evidence, review the full diff, and report what was and was not verified.

## 1. Phase 1 objective

Build a reusable, deterministic Playwright execution engine that can execute tests for different web applications through one platform-owned configuration and runner. Phase 1 must work without an AI model, Playwright MCP, AI-generated code, SQLite, or a web UI.

Playwright Test is the execution engine for target applications. Vitest is for testing the QA platform's own code. These two test responsibilities must remain separate.

## 2. Task overview

| Task | Mini-task | Estimated effort | Code changes |
|---|---|---:|---|
| 1.0 | Repository and environment audit | 30–45 min | None; read-only |
| 1.1 | TypeScript foundation, platform tests, and repository instructions | 1.5–2 h | Yes |
| 1.2 | Install Playwright Test and create the permanent config entry point | 45–75 min | Yes |
| 1.3 | Execution configuration, loader, validation, and environment checks | 1.25–2 h | Yes |
| 1.4 | SauceDemo project and smoke test | 45–75 min | Yes |
| 1.5a | Generic runner and passing/failing/no-tests fixtures | Part of 3.5–5 h combined | Yes |
| 1.5b | Runner timeout, process-tree termination, and hanging fixture | Part of 3.5–5 h combined | Yes |
| 1.6 | CLI execution command with provisional result handling | 1–1.5 h | Yes |
| 1.7 | JSON/HTML report collection, parsing, and status reconciliation | 1.5–2.25 h | Yes |
| 1.8 | Final integration and Phase 1 verification | 3.5–5 h | Yes |

Task 1.5 is split for reviewability. Its two parts together retain the original 3.5–5-hour estimate. The estimate for all Phase 1 tasks remains provisional and should be updated with actual effort in Task 1.8.

## 3. Standing rules for every coding task

Task 1.1 creates or updates a short canonical root-level `AGENTS.md` and ensures the actual coding tool loads it automatically. First identify the coding tool and verify which instruction filename it reads. For example, Claude Code reads `CLAUDE.md`; in that case create a minimal root `CLAUDE.md` that points to `AGENTS.md`. Do not assume every tool reads `AGENTS.md`, and do not create several competing instruction files. Preserve any existing instructions.

- Read the relevant Phase 0 documents and `DECISIONS.md` before changing code.
- Follow the `reliable-ai-coding` skill available in the coding environment. If it is not available, say so and still follow its core practices: inspect first, change only the current task's scope, verify, review the full diff, and report evidence honestly.
- Use PowerShell and Windows-compatible commands when working on this Windows repository.
- Inspect `git status` and existing diffs before editing. Preserve pre-existing user changes.
- Never commit, push, deploy, delete user work, or perform irreversible actions. The user handles Git commits after reviewing the changes.
- Do not invent files, APIs, package versions, commands, or test results.
- Do not claim a check passed unless it was actually run and its result observed.
- Complete one task at a time. Do not implement later-phase features early.

---

# Task 1.0 — Repository and Environment Audit

**Estimated effort:** 30–45 minutes  
**Code changes:** None; strictly read-only.

## Summary

Establish the actual state of `D:\ai-qa-platform` before modifying anything. Inspect the repository, Phase 0 documents, Git state, package files, installed tools, and confirm that the old JavaScript Playwright tutorial project is separate.

**Expected output:** A factual audit report, missing-prerequisite list, and recommendation on whether Task 1.1 can safely begin. No files are changed.

## Copy-ready coding AI prompt

```text
Goal

Perform a read-only repository and development-environment audit for Phase 1 of the AI QA Automation Platform.

Project root: D:\ai-qa-platform

Context

This is a TypeScript/Node.js, local-first QA automation platform. Its initial execution engine uses Playwright Test. The completed JavaScript Playwright tutorial project is a separate reference project and must not be modified.

The repository should contain:
- docs/PROJECT_SPEC.md
- docs/ARCHITECTURE.md
- docs/IMPLEMENTATION_PLAN.md
- docs/DECISIONS.md

Requirements

1. Confirm the actual project root and inspect the directory structure.
2. Read the four Phase 0 documents. Report any missing document; do not invent its contents.
3. Inspect Git initialization, current branch, working-tree status, and existing diffs. Do not assume Git is initialized.
4. Identify the coding tool used for implementation and determine which root instruction file it automatically loads. Inspect README.md, package.json, the package lockfile, .gitignore, TypeScript configuration, and applicable AGENTS.md/CLAUDE.md instructions if present. Do not assume AGENTS.md is automatically loaded by every tool.
5. Record actual Node.js, npm, and Git versions.
6. Confirm the JavaScript tutorial project is separate and will not be modified.
7. Compare the repository against the Phase 0 acceptance checklist in IMPLEMENTATION_PLAN.md and report missing items.

Constraints

- Strictly read-only: do not create, edit, rename, delete, format, or install anything.
- Do not initialize Git, change branches, discard changes, or commit.
- Do not modify the tutorial project.

Verification

Use actual PowerShell commands and inspect their output. Do not report a check as successful unless it was performed.

Final report

Provide the repository path and directory overview; Node.js/npm/Git versions; Git branch/status/existing changes; presence or absence of the required files; Phase 0 checklist results; missing prerequisites/risks; and whether Task 1.1 can safely begin. Explicitly state that no files were modified.
```

**Completion criteria:** Repository state, installed versions, existing changes, and outstanding Phase 0 setup items are documented. No files have been modified.

---

# Task 1.1 — TypeScript Foundation, Platform Tests, and Repository Instructions

**Estimated effort:** 1.5–2 hours

## Summary

Establish the TypeScript build and type-checking foundation and keep platform tests separate from target-application Playwright tests.

- `tsconfig.build.json` emits only `src/` into `dist/`.
- `tsconfig.typecheck.json` performs no-emit type checking across the required source and test files.
- Vitest discovers only platform `.test.ts` files.
- Playwright `.spec.ts` files remain outside Vitest discovery.
- `.gitignore` excludes generated run artifacts under both `project-data/` and `tests/fixtures/` without ignoring source tests/configuration.
- Create or update a short canonical root `AGENTS.md` containing standing repository instructions, plus a minimal tool-specific pointer file only when the actual coding tool requires one (for example, `CLAUDE.md` pointing to `AGENTS.md` for Claude Code).

The chosen module system must support the root Playwright config importing a module from `src/`. Establish a small import-compatibility proof here; Task 1.2 must verify that import through the actual installed Playwright config loader once Playwright Test is installed.

**Expected output:** The platform builds and type-checks, Vitest runs only platform tests, and repository instructions are in place.

## Copy-ready coding AI prompt

```text
Goal

Establish the TypeScript build and platform-testing foundation for the AI QA Automation Platform.

Context

Read the four Phase 0 documents and inspect the actual repository state reported by Task 1.0. Use the actual package manager and existing dependency versions. Preserve existing user work.

Requirements

1. Inspect package.json, the lockfile, existing TypeScript configs, scripts, dependencies, and applicable repository instructions before editing.
2. Choose one consistent Node-compatible module system. Do not mix ESM and CommonJS without an explicit compatibility reason.
3. The chosen module system must allow the future root playwright.config.ts to import a module from src/. Prove the import path with a minimal temporary TypeScript import-compatibility probe using the selected compiler/module settings. Do not leave a redundant probe in the final project. Task 1.2 must verify the same import through the real Playwright config loader.
4. Create/configure tsconfig.json, tsconfig.build.json, and tsconfig.typecheck.json.
5. tsconfig.build.json must emit only platform source under src/ into dist/. Do not emit tests or playwright.config.ts into dist/.
6. tsconfig.typecheck.json must use noEmit and cover platform source, root playwright.config.ts, platform tests, runner fixture TypeScript files, and target-project Playwright tests.
7. Install/configure Vitest for platform tests. Restrict discovery to:
   - tests/unit/**/*.test.ts
   - tests/integration/**/*.test.ts
   Explicitly exclude tests/fixtures/** and project-data/**, plus normal exclusions such as node_modules, .git, and build output.
8. Use .test.ts for Vitest tests and .spec.ts for Playwright target/fixture tests.
9. Add package scripts for build, type-check, Vitest, and the future CLI entry point. The CLI script may be wired as a placeholder, but do not implement CLI behavior in this task. Compile platform TypeScript and execute emitted JavaScript with Node.js.
10. Identify the actual coding tool and verify which instruction file it automatically loads. Do not assume all tools read AGENTS.md. Create or update a concise canonical root AGENTS.md and preserve existing instructions. Include:
    - Read the relevant docs/ documents and DECISIONS.md before a task.
    - Follow the reliable-ai-coding skill available in the coding environment; if unavailable, follow inspect-first, smallest-change, executable-verification, full-diff-review, and honest-reporting practices.
    - Use PowerShell and Windows-compatible commands on this repository.
    - Inspect git status and preserve pre-existing changes.
    - Never commit, push, deploy, or discard user work; the user handles commits.
    - Implement only the current requested task and do not pull later-phase scope forward.
    If the actual tool uses a different filename (for example Claude Code uses CLAUDE.md), create a minimal tool-specific pointer file that directs it to AGENTS.md. Do not create unnecessary duplicate instruction files or allow conflicting copies.
11. Update .gitignore without ignoring source tests or project configuration. It must exclude dependencies, dist, coverage, temp files, .env files, Playwright authentication state, and generated run artifacts under BOTH:
    - project-data/**/artifacts/
    - tests/fixtures/**/artifacts/
    Do not blanket-ignore tests/fixtures/ because fixture source/configuration must be committed.
12. Update the existing README.md with a concise project overview.

Include:
- Project purpose
- Current development status (Phase 1)
- Links to the four Phase 0 documents:
  docs/PROJECT_SPEC.md
  docs/ARCHITECTURE.md
  docs/IMPLEMENTATION_PLAN.md
  docs/DECISIONS.md

Do not duplicate the contents of those documents.
Do not claim features have been implemented when they have not.

Verification:
Confirm README.md is no longer empty and all four relative document links resolve correctly.

Constraints / non-goals

- Do not implement the Playwright runner, CLI behavior, AI, or MCP.
- Do not create application-specific tests yet.
- Do not add unnecessary dependencies or refactor unrelated files.
- Do not commit.

Verification

Run the actual build, type-check, and Vitest commands. Confirm:
- A minimal platform TypeScript module compiles into dist/.
- Build output excludes tests and playwright.config.ts.
- No-emit type checking includes the required locations.
- Vitest discovers only platform .test.ts files and does not discover a Playwright .spec.ts fixture.
- The temporary import probe proves the chosen module settings support importing from src/; remove the probe afterward.
- Generated artifact ignore rules cover both project-data and tests/fixtures artifact folders while preserving fixture source files.

Inspect the complete Git diff.

Final report

List files changed, dependency changes, module-system choice, scripts, AGENTS.md contents, .gitignore behavior, exact commands and results, unverified items, and remaining risks. Do not claim a check passed unless it was run.
```

**Completion criteria:** Build, type-check, and Vitest commands work; test discovery is separated correctly; the import compatibility probe succeeds; `AGENTS.md` and artifact ignore rules are correct.

---

# Task 1.2 — Install Playwright Test and Create the Permanent Config Entry Point

**Estimated effort:** 45–75 minutes

## Summary

Install `@playwright/test`, verify a compatible browser can launch, and establish the one permanent root `playwright.config.ts`.

At this point the complete environment-driven config is not ready; Task 1.3 finishes it. Do not create a temporary test file or another config just to test the browser. Run a one-off `node -e` command from the repository root so Node resolves the repository's installed `@playwright/test`; do not use a temporary script stored outside the repository.

Also verify that the actual Playwright loader can load a root config that imports a trivial module from `src/`, completing the module-system proof started in Task 1.1.

**Expected output:** One root Playwright config, compatible browser launch evidence, and actual config-import compatibility evidence.

## Copy-ready coding AI prompt

```text
Goal

Install Playwright Test and establish the permanent platform-owned root Playwright configuration.

Context

Read the four Phase 0 documents and the instruction file actually loaded by the selected coding tool (for Claude Code, follow the CLAUDE.md pointer to AGENTS.md), plus applicable decisions including DEC-003, DEC-012, and DEC-014. Inspect the actual dependencies and versions before editing.

Requirements

1. Check whether @playwright/test is already installed. Install it as a development dependency only if needed. Record the exact installed version.
2. Check whether a browser binary cached from the separate tutorial project is compatible with this Playwright version.
3. From the repository root, test browser launch and close using a one-off `node -e` command that imports the repository's installed `@playwright/test`. Do not create a test file, a temporary script outside the repository, or another Playwright config for this check. Report the actual launch/close result.
4. If the matching browser is missing or incompatible, install only the required browser version.
5. Create or complete one permanent root playwright.config.ts. Do not create per-project or fixture-specific Playwright configs.
6. Establish the QA_PROJECT_CONFIG_PATH and QA_RUN_DIR environment-variable contract. Task 1.3 will implement shared validation and fail-fast behavior. Do not add a default project fallback.
7. Keep the configuration generic. Do not include SauceDemo selectors, test paths, or application-specific behavior.
8. Verify through the actual installed Playwright config loader that the root config can import a trivial shared module from src/. Use the module system selected in Task 1.1. Remove any temporary probe after verification; retain only the real root config and genuine shared code.

Constraints / non-goals

- Do not implement the runner or CLI.
- Do not create SauceDemo tests yet.
- Do not configure JSON or HTML reporters; reporter configuration belongs only in Task 1.7.
- Do not create a second Playwright config.
- Do not add AI/MCP integration.
- Do not commit.

Verification

- Record @playwright/test version.
- Show the one-off browser launch and close result.
- Prove the actual root Playwright config loader can import from src/.
- Confirm there is one platform-owned Playwright config and no temporary test/config file remains.
- Run relevant type checking/config-load checks.

Inspect the full diff and report exact commands/results, files changed, and anything not verified.
```

**Completion criteria:** `@playwright/test` is installed, the browser launches, and the actual root Playwright config loader can import the shared module from `src/`. No duplicate config or temporary test file remains.

---

# Task 1.3 — Execution Configuration, Loader, Validation, and Environment Checks

**Estimated effort:** 1.25–2 hours

## Summary

Implement the strict Phase 1 `ExecutionConfig` schema, shared loader, runtime validation, and the environment/run-directory validation used by the root Playwright config.

The Phase 1 configuration fields are:

- `projectId`
- `name`
- `baseUrl`
- `environment`
- `allowedDomains`
- `testDirectory`
- `artifactDirectory`

Allowed environments are exactly `local`, `development`, `demo`, and `staging`; reject `production`. Require HTTPS except for `localhost`, where HTTP is allowed for local fixtures.

The coding AI must choose between a small custom validator and a schema library after inspecting the actual repository. Record the choice as a new decision in `DECISIONS.md`, including the rationale and exact package/version if applicable.

All filesystem containment checks must use `path.relative`-based logic that works on Windows; do not use naive string `startsWith` checks. Export the environment/run-directory loader as a testable function under `src/projects/` so Vitest can test it independently from Playwright's top-level config execution.

**Expected output:** One shared validation implementation used by `playwright.config.ts`, comprehensive unit tests, and a real missing-environment Playwright invocation that fails before browser launch.

## Copy-ready coding AI prompt

```text
Goal

Implement the Phase 1 execution configuration schema, shared loader, runtime validation, and testable Playwright environment/run-directory loading.

Context

Read the four Phase 0 documents, root AGENTS.md, and accepted decisions including DEC-014, DEC-015, DEC-018, and DEC-020. Inspect the actual root playwright.config.ts from Task 1.2.

The Phase 1 project config must contain exactly these required fields:
- projectId
- name
- baseUrl
- environment
- allowedDomains
- testDirectory
- artifactDirectory

Example:
{
  "projectId": "saucedemo",
  "name": "SauceDemo Demo",
  "baseUrl": "https://www.saucedemo.com/",
  "environment": "demo",
  "allowedDomains": ["www.saucedemo.com"],
  "testDirectory": "tests/approved",
  "artifactDirectory": "artifacts"
}

Requirements

1. Define the typed ExecutionConfig and implement a shared project-config loader/runtime validator under src/projects/.
2. TypeScript interfaces alone are not runtime validation.
3. Inspect existing dependencies and validation patterns. Evaluate a small custom validator versus a schema-validation library. Choose the smallest maintainable option, considering later structured AI JSON validation. Do not add a dependency without justification.
4. Record the decision as the next available DEC number in docs/DECISIONS.md. Include the chosen approach, rationale, and actual package/version if a library is selected. Do not invent a decision number; inspect the current document first.
5. Validate required fields/types, URL syntax, non-empty allowedDomains, and that baseUrl hostname matches an allowed domain.
6. Accept exactly local, development, demo, and staging. Reject production.
7. Require HTTPS except for localhost. HTTP is allowed only for localhost fixtures.
8. Resolve testDirectory and artifactDirectory relative to the directory containing project.config.json. Validate that testDirectory exists. Do not create the run directory in this loader.
9. Reject traversal outside the project workspace. Use path.resolve plus path.relative-based containment checks; do not use naive string startsWith. Ensure the implementation handles Windows paths and drive-letter case differences (for example D:\ and d:\) correctly.
10. Export a function under src/projects/ that accepts an environment object (rather than reading process.env invisibly at module top level), validates QA_PROJECT_CONFIG_PATH and QA_RUN_DIR, loads the shared project config, resolves the paths, and confirms the run directory is inside the configured artifact directory. Validate the run directory exists and is a directory; the runner/run manager creates it before launching Playwright.
11. Use that exported function from the root playwright.config.ts. Do not duplicate validation in the config file.
12. Derive testDir, use.baseURL, and outputDir from validated paths. Keep outputDir separate from the sibling HTML report directory. Set retries: 0.
13. Do not configure JSON or HTML reporters here. Reporter configuration belongs exclusively to Task 1.7.
14. Do not use --pass-with-no-tests and do not silently select a default project.

Verification

Add Vitest tests for:
- Valid project config.
- Missing required fields and malformed JSON.
- Invalid URL/domain and empty allowedDomains.
- Unsupported environment values, including production.
- Allowed localhost HTTP and rejected non-localhost HTTP.
- Missing test directory.
- Path traversal outside project workspace.
- Windows path containment, including drive-letter case differences where testable on the current Windows host.
- Missing QA_PROJECT_CONFIG_PATH and QA_RUN_DIR.
- Invalid or out-of-scope run directory.

Unit-test the exported environment-loading function directly; do not try to unit-test top-level playwright.config.ts execution only through Vitest.

Also perform one real Playwright invocation with BOTH QA_PROJECT_CONFIG_PATH and QA_RUN_DIR unset. Temporarily save their previous PowerShell values and restore them afterward. Invoke the actual root config using npx.cmd if needed. Confirm Playwright exits with the expected clear missing-environment error before browser launch. Do not leave the variables cleared in the user's shell.

Run relevant type-check and Vitest tests. Inspect the full diff and verify there is exactly one shared project-config validation implementation.

Final report

Explain the validation strategy and new DEC entry; list files/tests/commands/results; report the real missing-env invocation; state any Windows-specific behavior that could not be verified.
```

**Completion criteria:** Invalid configuration/environment fails before browser launch; paths are contained using Windows-safe logic; the root config reuses one exported shared loader; the validator choice is recorded.

---

# Task 1.4 — SauceDemo Project and Smoke Test

**Estimated effort:** 45–75 minutes

## Summary

Create the first independent target-application project under `project-data/saucedemo/` with one approved smoke test. Keep all SauceDemo-specific selectors and behavior inside this project.

The runner does not exist yet, so invoke the root config manually. Create the artifact path with the corrected PowerShell commands below. On Windows, use `npx.cmd` if PowerShell blocks `npx` due to execution policy.

**Expected output:** A valid SauceDemo project config and one smoke test that uses `page.goto('/')` and configured `baseURL`.

## Copy-ready coding AI prompt

```text
Goal

Create the first target application project and one Playwright smoke test for SauceDemo.

Context

Read the four Phase 0 documents, AGENTS.md, and the shared config loader from Task 1.3.
Target: https://www.saucedemo.com/

Requirements

Create:
project-data/saucedemo/
  project.config.json
  tests/approved/smoke.spec.ts

Use the Phase 1 schema with:
- projectId: saucedemo
- name: SauceDemo Demo
- baseUrl: https://www.saucedemo.com/
- environment: demo
- allowedDomains: ["www.saucedemo.com"]
- testDirectory: tests/approved
- artifactDirectory: artifacts

Create one smoke test that opens the login page and verifies expected login controls using suitable accessible locators and meaningful assertions. Use page.goto('/'); baseURL must come from selected project config. Keep SauceDemo-specific behavior in this project. Do not import from the separate JavaScript tutorial project. Do not create another Playwright config.

Verification

The platform runner does not exist yet. From the repository root in PowerShell, manually invoke the root config. The project directory exists, but artifacts may not exist on a fresh clone. Use:

$projectConfig = (Resolve-Path ".\project-data\saucedemo\project.config.json").Path
$runDir = Join-Path (Resolve-Path ".\project-data\saucedemo").Path "artifacts\manual-task-1-4"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$env:QA_PROJECT_CONFIG_PATH = $projectConfig
$env:QA_RUN_DIR = $runDir
npx.cmd playwright test --config=".\playwright.config.ts"

If npx.cmd is not blocked, it is the preferred Windows invocation. If it fails for a non-policy reason, inspect the actual error rather than trying unrelated commands.

After execution, remove the temporary environment variables, restoring any values that existed before the test. Do not leave the user's shell environment changed.

Constraints

- No generic core changes to accommodate SauceDemo.
- No additional tests or page-object framework.
- No runner/CLI/AI/MCP implementation.
- Do not modify the tutorial project or commit.

Report exact commands, actual result, changed files, and any external-site/network limitation. Do not claim success if the target was unreachable.
```

**Completion criteria:** SauceDemo config validates; the smoke test is in its approved directory and runs through the root config; external-site failures are reported honestly.

---

# Task 1.5a — Generic Runner and Passing/Failing/No-Tests Fixtures

**Estimated effort:** Approximately 2–3 hours (part of the original combined 3.5–5 hours for Task 1.5)

## Summary

Implement the generic Playwright runner's normal execution path and three deterministic fixture projects. The runner must create unique run folders, invoke the installed Playwright CLI safely, capture process output and exit data, and pass the correct environment variables to the single root Playwright config.

This subtask deliberately excludes runner-level timeout and process-tree termination. Those are implemented and reviewed separately in Task 1.5b.

Fixtures:

- `passing`: at least one meaningful passing assertion.
- `failing`: at least one intentional test failure.
- `no-tests`: existing but empty approved test directory.

Fixtures use `http://localhost`, `allowedDomains: ["localhost"]`, and local browser content such as `page.setContent()`; they must not depend on public network access.

**Expected output:** A reusable runner that can execute configured test directories and preserve raw process evidence, plus three local fixture projects.

## Copy-ready coding AI prompt

```text
Goal

Implement the normal execution path of the generic Playwright runner and deterministic passing, failing, and no-tests fixture projects. Do not implement runner-level timeout/process-tree termination yet; that is Task 1.5b.

Context

Read the four Phase 0 documents, AGENTS.md, and decisions DEC-014, DEC-016, DEC-017, DEC-018, and DEC-020. Reuse the shared config loader from src/projects/. Inspect the installed Playwright package metadata/version to resolve its CLI entry point; do not guess package paths.

Runner requirements

1. Implement the runner under src/test-execution/.
2. Accept a validated project execution config and run options.
3. Generate a collision-safe UTC timestamp-based run ID, adding a suffix if needed.
4. Create a unique run directory under the configured artifactDirectory. Never overwrite an earlier run.
5. Resolve the Playwright CLI entry point from the actual installed package metadata/module resolution.
6. Launch using process.execPath, an argument array, and shell:false. Do not build a shell command string from project data.
7. Set the intended repository working directory and pass absolute QA_PROJECT_CONFIG_PATH and QA_RUN_DIR values to the child process environment.
8. Capture stdout, stderr, exit code, signal, start/end times, and duration. Preserve the raw process result; do not yet implement final status/report reconciliation.
9. Keep this runner generic: no SauceDemo selectors or assumptions.
10. Timeout and process-tree cleanup are explicitly out of scope for this subtask and must be added in 1.5b. Do not add a fake timeout implementation.

Fixture requirements

Create:
tests/fixtures/runner-projects/
  passing/project.config.json
  passing/tests/approved/passing.spec.ts
  failing/project.config.json
  failing/tests/approved/failing.spec.ts
  no-tests/project.config.json
  no-tests/tests/approved/.gitkeep

Every fixture config uses the same Phase 1 schema, environment "local", baseUrl "http://localhost", allowedDomains ["localhost"], and its own test/artifact directories. No fixture creates its own Playwright config.

Use local browser content such as page.setContent(). The passing fixture has a meaningful assertion. The failing fixture has an intentional failing assertion that must not be weakened/skipped. The no-tests fixture has an existing empty approved directory. Do not use --pass-with-no-tests; a zero-test result must remain non-successful.

Add focused Vitest unit/integration coverage for run ID uniqueness, run directory creation, successful and failing child processes, output capture, process startup errors, and no-tests process evidence where practical. Integration tests that start actual Playwright processes must use a deliberately increased per-test or suite timeout; do not leave them under Vitest's very short default timeout. Keep fixture .spec.ts files excluded from Vitest and included in no-emit TypeScript checking.

Constraints

- Do not implement the CLI.
- Do not configure JSON/HTML reporters; that is Task 1.7 only.
- Do not add timeout/process-tree handling; that is Task 1.5b.
- Do not add AI, MCP, SQLite, retries, or a second config format.
- Do not commit or modify unrelated files.

Verification

Run the passing, failing, and no-tests fixtures through the same root Playwright config via the runner. Record actual process outcomes and output. Confirm each run has a unique artifact directory and previous runs are not overwritten. Confirm Vitest excludes fixture .spec.ts files and type-check includes them. Run build, type-check, and relevant Vitest tests.

Inspect the full diff. Report changed files, commands, observed process results, and remaining work for Task 1.5b.
```

**Completion criteria:** Normal runner execution works for passing/failing/no-tests projects; output and process data are captured; each run has a unique artifact directory.

---

# Task 1.5b — Runner Timeout, Process-Tree Termination, and Hanging Fixture

**Estimated effort:** Approximately 1.5–2 hours (part of the original combined 3.5–5 hours for Task 1.5)

## Summary

Add the difficult process-lifecycle behavior separately from normal execution. A runner-level timeout must terminate the full Playwright process tree/group and wait for the child process exit event. The hanging fixture must prove that the browser/page actually started before the timeout fires.

Platform-specific behavior:

- **Windows:** Do not use `detached: true`; it can open a separate console window. Use `taskkill.exe /T /F /PID <pid>` with `shell: false`, then wait for child exit.
- **Linux/macOS:** Use `detached: true` only on these platforms to create a process group; send SIGTERM to the group, wait a grace period, then SIGKILL if necessary.

The integration test must observe a readiness marker emitted by the hanging fixture after the page has loaded, before the runner timeout is allowed to complete. Real Playwright-process integration tests need a deliberately increased Vitest timeout.

**Expected output:** Timeout behavior, cross-platform cleanup strategy, and a verified hanging fixture, with evidence that the browser reached the readiness point before termination.

## Copy-ready coding AI prompt

```text
Goal

Add runner-level timeout handling, cross-platform process-tree/group termination, and the hanging fixture to the runner implemented in Task 1.5a. Use a timeout long enough for a real browser to start on a slower development machine; the default hanging-fixture runner timeout should be at least 30 seconds unless measured startup evidence justifies a larger value.

Context

Read the four Phase 0 documents, AGENTS.md, and DEC-017/DEC-019/DEC-021. Inspect the existing runner and its tests. Make the smallest focused extension; do not rewrite the runner.

Requirements

1. Add a configurable runner-level timeout through run options/internal test configuration. For the hanging-fixture integration test, use a runner timeout of at least 30 seconds by default (or larger if measured browser startup requires it); do not use an ultra-short timeout that can expire before the browser becomes ready. Do not add a timeout field to project.config.json unless the baseline documents explicitly require it.
2. On timeout, request termination of the complete process tree/group and wait for the child process exit event. Capture timeout and cleanup outcomes separately.
3. Windows:
   - Do not set detached:true; that can open a separate console window.
   - Invoke taskkill.exe with argument array ["/T", "/F", "/PID", String(pid)] and shell:false.
   - Wait for the child exit event after requesting termination.
   - Surface taskkill/cleanup failures; do not silently claim cleanup succeeded.
4. Linux/macOS:
   - Set detached:true only on Linux/macOS to establish a process group.
   - Send SIGTERM to the process group, wait a short grace period, then SIGKILL if necessary.
   - Wait for child exit and surface cleanup failure.
5. Keep OS-specific termination logic in a small isolated module. Avoid fragile recursive process enumeration.
6. Create the hanging fixture under tests/fixtures/runner-projects/hanging/ using the same project config rules as other local fixtures. It must use local browser content, set test.setTimeout(0) before its intentional wait, and emit a unique readiness marker only after page.setContent()/page load has completed (for example FIXTURE_PAGE_READY).
7. Add the smallest runner output-stream hook needed for the integration test to observe that readiness marker while the process is still running. Do not build a general event system.
8. The hanging integration test must wait until it observes the readiness marker before allowing/asserting the runner timeout. It must not merely wait for a timeout and then inspect buffered output after the fact.
9. Increase the Vitest timeout for integration tests that start real Playwright processes, using a deliberate per-test timeout that exceeds the runner timeout plus browser-startup and cleanup margin (for example, at least 45–60 seconds for a 30-second runner timeout). Do not globally increase every unit test timeout without reason.
10. The integration test must observe the readiness marker while the child process is still running, before the runner timeout fires. Give the marker wait a clear timeout/error path so a missing marker fails with a useful diagnostic rather than hanging indefinitely.
11. Test timeout with the configured hanging-fixture timeout. Verify run status/timeout evidence is available to the caller; final report-status reconciliation remains Task 1.7.

Constraints

- Windows spawn options must not use detached:true.
- Do not create a fixture-specific Playwright config.
- Do not add AI/MCP/SQLite, retries, or reporters.
- Do not commit, alter user files, or refactor unrelated runner code.

Verification

- Run passing/failing/no-tests fixtures to ensure normal behavior remains unchanged.
- Run the hanging fixture and prove the readiness marker was observed before timeout termination.
- On Windows, inspect tasklist or Task Manager after the run to check for orphaned Playwright/browser processes.
- Test cleanup failure handling where practical and report exactly what was simulated/observed.
- Run relevant Vitest, type-check, and build commands.

Inspect the complete diff. Report platform-specific behavior actually tested, commands/results, cleanup evidence, and any OS behavior not verified on this machine.
```

**Completion criteria:** The hanging fixture reaches its readiness marker, the runner times out, the correct OS-specific termination path is used, the process exits, and cleanup results are reported honestly.

---

# Task 1.6 — CLI Execution Command with Provisional Result Handling

**Estimated effort:** 1–1.5 hours

## Summary

Expose the runner through one CLI command. At this point the final JSON/HTML reconciliation logic does not exist; that arrives in Task 1.7. Therefore Task 1.6 must label results as **provisional** and apply only the raw runner rule: exit code 0 and no timeout may produce CLI exit 0; any non-zero process exit, timeout, startup/configuration error, or unverified runner outcome must produce a non-zero CLI exit.

Expected command:

```powershell
npm run qa -- run --config project-data/saucedemo/project.config.json
```

**Expected output:** A consistent command to run SauceDemo and every fixture project, with explicit provisional status and correct process exit codes.

## Copy-ready coding AI prompt

```text
Goal

Implement the Phase 1 CLI execution command using the shared project-config loader and generic runner.

Context

Read the four Phase 0 documents, AGENTS.md, and implementations from Tasks 1.1–1.5b. The final report parsing/status reconciliation is not implemented until Task 1.7.

Requirements

1. Implement the CLI entry point under src/cli/.
2. Support: npm run qa -- run --config <project-config-path>.
3. Parse and validate command arguments. Provide concise help for missing/unknown arguments.
4. Reuse the shared config loader and runner; do not duplicate validation or launch Playwright directly from the CLI.
5. Display selected project, run start, available progress, provisional final outcome, run ID, and artifact directory.
6. Until Task 1.7, label the result explicitly as PROVISIONAL. Exit 0 only when the runner process exit code is 0 and the run did not time out or encounter startup/cleanup errors. Return non-zero for any non-zero runner exit, timeout, invalid config, spawn error, cleanup failure, or unverified result.
7. Do not claim a final verified pass before report reconciliation exists.
8. Keep CLI argument parsing/output separate from runner and application logic.
9. Compile platform TypeScript to dist/ and execute emitted JavaScript with Node.js, following the package setup from Task 1.1.

Expected fixture behavior at this interim stage:
- passing: provisional success, CLI exit 0 if runner exit code is 0 and no timeout/runner error.
- failing: provisional failure, non-zero CLI exit.
- no-tests: provisional failure, non-zero CLI exit; do not label an empty suite successful.
- hanging: timeout outcome, non-zero CLI exit.
- invalid config/startup error: non-zero CLI exit.

Do not assign the final reason/status model here; that belongs to Task 1.7.

Constraints

- Do not reimplement the runner or config validator.
- Do not implement JSON/HTML parsing yet.
- Do not add AI/MCP/SQLite or unrelated CLI commands.
- Do not commit.

Verification

Run the CLI against SauceDemo and all four fixtures when available. Test missing command, unknown command, missing --config, invalid path, and invalid project config. Inspect actual process exit codes. Run build, type-check, and relevant Vitest tests. Confirm all output is labeled provisional before Task 1.7.

Inspect the full diff and report actual commands/results and limitations.
```

**Completion criteria:** One CLI command runs configured projects through the shared runner. Provisional output and exit codes are correct without claiming final report verification.

---

# Task 1.7 — JSON/HTML Report Collection, Parsing, and Status Reconciliation

**Estimated effort:** 1.5–2.25 hours

## Summary

Configure the built-in JSON and HTML reporters (this is the only Phase 1 task that configures reporters), parse results, and reconcile Playwright test outcomes with the runner process result. Keep a terminal reporter active as well so progress and test output remain available. Task 1.5b's hanging-fixture readiness marker must still reach the runner's live stdout hook after JSON and HTML reporters are added. Include a terminal reporter (for example Playwright's `list` reporter) and verify actual marker forwarding with the installed Playwright version; do not assume it works without an integration check.

Both reports are required for overall CLI success:

- `results.json` is required for machine-readable result verification.
- `html-report/index.html` is required for the human-readable report.
- `test-output/` remains separate from the sibling `html-report/` directory.
- HTML reporter must use `open: 'never'`.

A valid JSON report with a missing HTML report is `partial` and causes a non-zero CLI exit. Malformed JSON, or missing JSON despite a zero process exit, produces `infrastructure_error` with primary reason `report_invalid` unless there is a runner timeout. A spawn failure or non-zero Playwright exit with missing JSON produces primary reason `playwright_process_error`, with `report_invalid` recorded as an additional finding. Timeout always takes precedence over other primary reasons.

**Expected output:** An evidence-based result model with separate test, run, and report statuses; one primary reason; secondary findings; correct CLI exit behavior.

## Status model

**Individual test status:** `passed`, `failed`, `skipped`  
**Run status:** `passed`, `failed`, `timed_out`, `infrastructure_error`  
**Report status:** `complete`, `partial`, `failed`

**Report status rules:**

- `complete`: valid JSON report and expected HTML `index.html` both exist and are verified.
- `partial`: JSON is valid, but the HTML report/index is missing or cannot be verified.
- `failed`: JSON is missing or malformed. An HTML file alone is not sufficient for machine-readable result verification.

Both report outputs are required for CLI exit 0. The terminal reporter is additional live progress/output; it does not replace either required file report. A valid passing test run with `report_status: partial` remains a passed test run but is an incomplete overall CLI outcome and exits non-zero. Record an `html_report_missing` report finding; do not pretend the test itself failed.

**Primary reason precedence (first applicable rule wins):**

1. `runner_timeout` — run status `timed_out`; overrides missing reports, cleanup errors, and other simultaneous findings.
2. `playwright_process_error` — primary when the child process cannot be spawned, or when Playwright exits non-zero and `results.json` is missing. Include captured stderr in the human-readable message when available. For missing JSON with a non-zero exit, also record `report_invalid` as an additional finding; the missing report is evidence of the process failure, not the primary explanation.
3. `report_invalid` — primary when JSON is malformed, or when JSON is missing despite a zero process exit code, unless rule 1 (runner timeout) applies. Run status is `infrastructure_error`. Malformed JSON remains the primary explanation even if the child also exited non-zero; retain the process exit/stderr evidence as an additional finding. Rule 2 is specifically for confirmed spawn failure or missing JSON combined with non-zero exit.
4. `no_tests_found` — valid report shows zero discovered tests; run status `infrastructure_error`.
5. `test_failures` — one or more individual tests failed; run status `failed`.
6. `cleanup_failed` — process cleanup failed and no higher-priority condition applies; run status `infrastructure_error`.
7. `playwright_process_error` — a confirmed process signal or top-level Playwright infrastructure error not already handled by rule 2; run status `infrastructure_error`.
8. `exit_report_mismatch` — process exit and otherwise-valid report contradict each other without a more specific explanation; run status `infrastructure_error`.

Every non-passed run has exactly one primary machine-readable reason and a separate human-readable message. Record all secondary problems in a separate `additionalFindings` (or equivalently named) list; examples include cleanup failure after a timeout, `report_invalid` after a non-zero exit with missing JSON, exit/report mismatch alongside test failures, and missing HTML after a valid JSON report. Do not emit multiple primary reasons. Do not replace a confirmed startup/process failure with the generic message that JSON is missing.

## Copy-ready coding AI prompt

```text
Goal

Implement Playwright JSON/HTML report collection, JSON parsing, deterministic status/reason reconciliation, and final CLI summary.

Context

Read the four Phase 0 documents, AGENTS.md, and decisions DEC-016, DEC-017, DEC-018, and DEC-021. Inspect the installed Playwright version and actual reporter APIs before coding. Reuse the runner and CLI; do not duplicate execution logic.

Requirements

REPORTER SETUP
1. This is the only Phase 1 task that configures reporters. Do not configure reporters in Task 1.3 or elsewhere.
2. Configure built-in JSON reporter to write results.json inside the current run directory.
3. Configure a terminal reporter (for example the built-in `list` reporter) alongside JSON and HTML so live progress and test output remain available. Confirm that the Task 1.5b readiness marker is forwarded to runner-captured stdout while the hanging child is still running. If the built-in terminal reporter does not forward worker output with the installed Playwright version, add the smallest custom reporter that forwards the reporter API's `onStdOut` and `onStdErr` chunks to the child process stdout/stderr while retaining the `list` reporter for test progress. Do not assume this works without evidence.
4. Configure built-in HTML reporter to write to the sibling html-report/ directory with open: 'never'.
5. Keep Playwright outputDir at test-output/, separate from html-report/ because Playwright may clean outputDir before a run.
6. Preserve relevant traces/screenshots under test-output where supported by the installed Playwright version.

PARSING
7. Parse and validate the JSON report, including statistics, discovered tests, individual outcomes, skipped tests, failures, and top-level errors.
8. Treat missing or malformed JSON as invalid. Do not infer that absent error fields prove there were no errors if the report is malformed/incomplete.
9. Verify the expected HTML report entry file (index.html) exists before claiming an HTML report was produced.

STATUS MODEL
10. Keep three distinct statuses:
   - Individual test: passed | failed | skipped
   - Run: passed | failed | timed_out | infrastructure_error
   - Report: complete | partial | failed
11. Report status definitions:
   - complete: valid JSON and expected HTML index.html both verified.
   - partial: JSON is valid but HTML report/index is missing or cannot be verified.
   - failed: JSON is missing or malformed, whether or not an HTML file exists.
   Both JSON and HTML are required for overall CLI exit 0. A valid passing run with partial report collection may retain run status passed, but overall CLI exit must be non-zero. Add report finding html_report_missing. Do not falsely change the individual test outcome to failed merely because HTML is absent.

PRIMARY REASON AND PRECEDENCE
12. Every non-passed run must have exactly one primary machine-readable reason and a separate human-readable message. Keep additional findings in a separate list; do not assign multiple primary reasons.
13. Implement this fixed precedence order and cover overlaps in tests (first applicable wins):
    1. runner_timeout -> run timed_out. Timeout always wins over report errors and cleanup failures.
    2. playwright_process_error -> primary when spawning Playwright fails, or when Playwright exits non-zero and results.json is missing. Include captured stderr in the message when available. For missing JSON plus non-zero exit, add report_invalid as a secondary finding.
    3. report_invalid -> infrastructure_error when JSON is malformed, or when JSON is missing despite exit code 0, unless rule 1 (runner timeout) applies. Malformed JSON remains primary even if the child also exited non-zero; retain process exit/stderr evidence separately. Rule 2 is specifically for confirmed spawn failure or missing JSON combined with non-zero exit.
    4. no_tests_found -> infrastructure_error when valid JSON shows zero discovered tests.
    5. test_failures -> failed when one or more individual tests failed.
    6. cleanup_failed -> infrastructure_error when cleanup failed and no higher rule applies.
    7. playwright_process_error -> infrastructure_error for a confirmed signal or top-level Playwright infrastructure error not already handled by rule 2.
    8. exit_report_mismatch -> infrastructure_error when exit code and otherwise-valid report contradict without a more specific explanation.
14. Preserve secondary issues in additionalFindings. Examples: timeout plus cleanup failure (primary runner_timeout, additional cleanup_failed); non-zero exit plus missing JSON (primary playwright_process_error, additional report_invalid); test failures plus non-zero/report mismatch (primary test_failures, mismatch additional); valid JSON but missing HTML (report partial, html_report_missing finding).
15. Specific cases:
    - Spawn failure: run infrastructure_error, primary reason playwright_process_error; include the actual spawn error in the message.
    - Missing JSON with a non-zero Playwright exit: run infrastructure_error, primary reason playwright_process_error; include stderr when available and add report_invalid as a secondary finding.
    - Malformed JSON without timeout or confirmed spawn failure: run infrastructure_error, primary reason report_invalid; report failed.
    - Missing JSON despite exit code 0 and no timeout: run infrastructure_error, primary reason report_invalid; report failed.
    - Zero tests in valid JSON: run infrastructure_error, reason no_tests_found; report may be complete if both required reports exist.
    - Runner timeout: run timed_out, primary reason runner_timeout. If JSON is absent/malformed, report failed; timeout remains the primary CLI outcome.
    - Ordinary test failures: run failed, primary reason test_failures.
    - Non-zero exit with valid JSON and all individual tests apparently passed: never pass; use confirmed top-level/process error as playwright_process_error, otherwise exit_report_mismatch.
    - Any report status other than complete causes non-zero CLI exit, even if run status is passed.
16. Initial primary reason codes are runner_timeout, report_invalid, no_tests_found, test_failures, cleanup_failed, playwright_process_error, and exit_report_mismatch. Use report findings for secondary issues such as report_invalid after a non-zero exit with missing JSON and html_report_missing; do not make an HTML-only reporting gap a false test failure.

CLI SUMMARY
17. Display project ID/name, run ID, total/passed/failed/skipped counts, run status, report status, primary reason/message when applicable, additional findings, duration, artifact directory, and HTML report location only after verifying it exists.
18. Never overwrite prior run artifacts. Never claim a report exists without checking it.
19. CLI exit 0 only if run status is passed AND report status is complete. All other outcomes exit non-zero.

Constraints

- Do not add SQLite, approval workflows, AI failure analysis, retries, or release comparison.
- Do not change the accepted status dimensions.
- Do not use --pass-with-no-tests.
- Do not duplicate status-classification logic.
- Do not commit.

Verification

Add parser/status tests for:
- Valid passing JSON + HTML.
- Valid JSON with individual test failures.
- Valid JSON with top-level errors.
- Spawn failure (primary playwright_process_error with actual error in the message).
- Missing JSON with non-zero Playwright exit (primary playwright_process_error; report_invalid additional).
- Missing JSON despite exit code 0 (primary report_invalid).
- Malformed JSON without timeout (primary report_invalid).
- Zero-test report.
- Non-zero exit with valid JSON and apparently passing individual tests.
- Exit/report disagreement.
- Timeout with missing JSON.
- Timeout plus cleanup failure (timeout remains primary; cleanup is additional).
- Test failure plus secondary mismatch (test_failures remains primary).
- Valid JSON with missing HTML (report partial, html_report_missing, CLI non-zero).
- HTML present but JSON missing/malformed (report failed; never pass).

Run all four fixtures and inspect actual results.json and html-report/index.html paths. Confirm the terminal reporter is active alongside JSON and HTML, and the Task 1.5b readiness marker still reaches the runner's captured stdout while the hanging child is active. Confirm HTML does not open a browser or leave the process waiting. Run build, type-check, and relevant Vitest tests. Inspect the full diff.

Final report

List status rules implemented, precedence order, test cases, fixture outcomes, exact commands/results, report paths actually verified, unverified behavior, and risks.
```

**Completion criteria:** The run/report status model is deterministic; precedence and secondary findings are tested; both reports are required for CLI exit 0; no missing, malformed, empty, contradictory, or incomplete evidence can become an overall pass.

---

# Task 1.8 — Final Integration and Phase 1 Verification

**Estimated effort:** 3.5–5 hours

## Summary

Verify all Phase 1 pieces together, close only genuine Phase 1 gaps, inspect the complete Git diff, and update the implementation plan with actual outcomes and effort.

The platform must execute SauceDemo and all local fixtures through the same root config. Build, type-check, Vitest discovery, timeout cleanup, JSON/HTML reports, CLI exit codes, invalid configuration behavior, and artifact ignores must all be checked.

**Expected output:** A complete Phase 1 evidence report and a clear complete/incomplete decision. Do not commit; the user reviews and commits afterward.

## Copy-ready coding AI prompt

```text
Goal

Perform final Phase 1 integration, regression testing, and verification for the AI QA Automation Platform.

Context

Read the four Phase 0 documents, root AGENTS.md, and all Phase 1 implementation. Review Task 1.5a and 1.5b as separate changes. This is an integration/verification task, not a redesign.

Requirements

1. Inspect the full implementation and current Git status/diff before editing.
2. Verify the shared config loader and validator; root playwright.config.ts must reuse it.
3. Verify the root Playwright config is the only platform-owned config and is used for SauceDemo and all fixtures.
4. Verify the CLI calls shared services and does not duplicate runner/config/report logic.
5. Verify safe process launch, timeout behavior, OS-specific cleanup, readiness-marker test, and cleanup evidence.
6. Verify the Task 1.7 reporter set includes terminal progress/output plus JSON and HTML; HTML uses open: never; test-output and html-report are siblings. Confirm the Task 1.5b readiness marker reaches the runner's captured stdout while the hanging process is active after all reporters are configured.
7. Verify status precedence, including spawn failure and missing JSON with non-zero exit mapping to primary playwright_process_error; verify report_invalid remains primary for malformed JSON or missing JSON with exit code 0. Verify additional findings, the required-report rule, terminal marker forwarding, and all CLI exit codes.
8. Verify Vitest includes only tests/unit/**/*.test.ts and tests/integration/**/*.test.ts and excludes tests/fixtures/** and project-data/**.
9. Verify no-emit type checking includes src/, root Playwright config, Vitest tests, fixtures, and target-project Playwright tests.
10. Verify production build emits only src/ into dist/.
11. Verify .gitignore excludes generated artifacts under both project-data/**/artifacts/ and tests/fixtures/**/artifacts/, while preserving fixture source/configuration and approved project tests.
12. Verify AGENTS.md contains concise standing rules, preserves other instructions, and does not claim a skill file is available if it is not.
13. Run passing, failing, no-tests, and hanging fixtures through the CLI.
14. Run SauceDemo smoke test through the CLI and root config.
15. Verify invalid config and missing environment variables stop before browser launch.
16. Inspect results.json and html-report/index.html. Verify missing HTML yields report partial and non-zero CLI; missing JSON with non-zero process exit yields primary playwright_process_error plus report_invalid additional; missing JSON with exit code 0 or malformed JSON without timeout yields primary report_invalid; timeout remains primary when it overlaps other problems.
17. On Windows, inspect tasklist or Task Manager after timeout to check for orphaned Playwright/browser processes.
18. Inspect the full diff for unrelated edits, duplicate validators, duplicate run/status logic, unsafe shell use, Windows detached:true, swallowed errors, missing cleanup, hardcoded SauceDemo logic in core, ignored fixture source, or secrets.
19. Fix only genuine Phase 1 defects. Document items belonging to later phases rather than expanding scope.
20. Update docs/IMPLEMENTATION_PLAN.md with actual task status, actual effort where known, verification results, limitations, and deferred issues.

Phase 1 exit criteria

- A configured project can be executed through the platform CLI.
- SauceDemo and local fixtures use the same platform-owned Playwright config.
- Generic platform core has no SauceDemo selectors/page objects.
- Invalid configuration and missing env vars fail before browser launch.
- Passing, failing, no-tests, and hanging fixtures have expected results.
- Timeout cleanup follows the OS-specific process strategy and has observed evidence on Windows.
- JSON and HTML reports are verified; both are required for CLI exit 0.
- Top-level errors and secondary findings are retained.
- Missing/malformed JSON, zero tests, timeout, process/report mismatch, or incomplete required reports never produce an overall CLI success.
- Platform tests and target-app Playwright tests are discovered by their correct runners only.
- Build, type-check, and relevant tests pass with actual observed evidence.

Constraints

- No AI/MCP, SQLite, web UI, approval workflow, or release comparison.
- Do not weaken/delete assertions to make tests pass.
- Preserve all pre-existing user changes.
- Do not commit, push, or deploy. Provide a suggested commit message only.

Verification

Run build, type-check, Vitest, all fixtures, SauceDemo CLI execution, invalid config/env checks, report checks, and Windows process cleanup inspection. Record exact commands, actual outputs, and exit codes. If network/service limitations block a test, state exactly what was and was not verified.

Inspect the complete final Git diff and map each exit criterion to evidence.

Final report

State Phase 1 complete or incomplete; provide an exit-criteria checklist with evidence; group changed files by component; list actual commands/results, fixture outcomes, SauceDemo outcome, report artifacts verified, remaining issues/limitations, actual effort if known, and a suggested Git commit message. Do not declare complete unless every exit criterion is supported by evidence.
```

**Completion criteria:** Every Phase 1 exit criterion has concrete verification evidence. If any criterion is unverified or fails, Phase 1 remains incomplete.

---

## 4. Rules and decisions that remain in force throughout Phase 1

| Area | Rule |
|---|---|
| AI models / MCP | Not implemented in Phase 1 |
| Storage | No SQLite in Phase 1 |
| Platform test runner | Vitest |
| Target application test runner | Playwright Test |
| Playwright config | One root platform-owned config |
| Project config | Shared schema/loader/validator from `src/projects/` |
| Allowed environments | `local`, `development`, `demo`, `staging`; reject `production` |
| HTTP | Only localhost fixtures may use HTTP; other targets require HTTPS |
| Retries | `retries: 0` |
| Empty test suite | Never a successful run; `infrastructure_error`, `no_tests_found` |
| Reporter setup | Task 1.7 only: terminal reporter for live output plus required JSON and HTML file reporters |
| Report requirement | Both valid JSON and HTML report are required for overall CLI exit 0 |
| Failure classification | Spawn failure or missing JSON with non-zero exit: primary `playwright_process_error` (and `report_invalid` additional); malformed JSON or missing JSON with exit 0: primary `report_invalid` |
| Timeout | `timed_out` and `runner_timeout` take precedence over concurrent failures |
| Process handling | `shell: false`; Windows does not use `detached: true`; Linux/macOS may use it for process groups |
| Generated artifacts | Ignored under both `project-data/` and `tests/fixtures/` artifact folders |
| Git commits | User reviews and commits; coding AI never commits |

## 5. Recommended working sequence

1. Paste only Task 1.0 into the coding AI. It is read-only.
2. Review the audit before allowing Task 1.1 to edit files.
3. Run one task at a time. Do not paste the entire Phase 1 plan into the coding AI as a single implementation request.
4. After each task, inspect the changed files and complete diff, run the stated checks, and confirm the acceptance criteria with actual evidence.
5. Review and commit a coherent checkpoint yourself before moving to the next task.

**Immediate next step:** Task 1.0 — Repository and Environment Audit. The next phase is not Phase 2; Phase 1 must first be implemented and pass its exit criteria.
