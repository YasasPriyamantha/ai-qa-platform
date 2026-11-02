# Implementation Plan — AI-Powered QA Automation Platform

**Document status:** Revised Phase 0 baseline, ready for Phase 1  
**Planning style:** Small, verifiable increments  
**Estimated focused effort:** Approximately 113–196 hours, including the separate local AI/MCP feasibility spike; re-estimate after each phase

---

## 1. How to use this plan

Build one phase at a time. Do not ask an AI coding assistant to implement the entire platform in one prompt. For each task:

1. Read the task and its acceptance criteria.
2. Ask the coding assistant to inspect the current repository, applicable documentation, installed versions, and existing changes before editing.
3. Ask it to implement only the current task.
4. Review the files changed and understand the main design decision.
5. Run the relevant automated checks and inspect the actual command output.
6. Review the complete diff and preserve unrelated work.
7. Commit a working checkpoint to Git after review.
8. Update this plan with the actual result, actual effort, issues, and the next task.

The AI coding assistant must not claim tests passed unless it actually ran them and saw successful results. Keep a known-working Git commit before risky changes. Never ask it to reveal hidden chain-of-thought; ask for concise assumptions, decisions, acceptance criteria, verification evidence, and limitations.

Use `reliable-ai-coding` as the coding-assistant skill. It reinforces repository inspection, bounded changes, acceptance criteria, executable verification, diff review, and honest reporting.

## 2. Phase overview

| Phase | Name | Estimated effort | Main outcome |
|---|---|---:|---|
| 0 | Define the project | 3–6 hours | Approved scope, architecture, and implementation plan |
| Pre-Phase 3 spike | Local AI + Playwright MCP feasibility | 2–4 hours | Evidence that a candidate local model can use MCP and generate a basic Playwright test |
| 1 | Generic Playwright execution engine | 14–22 hours | Run configured tests and collect trustworthy reports without application-specific logic in the platform core |
| 2 | Project and workflow-document management | 8–14 hours | Separate projects, read Markdown/text requirements, maintain stable IDs and project settings |
| 3 | Local AI model integration | 12–20 hours | Call a local model through a provider interface and validate structured results |
| 4 | Playwright MCP browser exploration | 12–22 hours | Platform backend can explore an approved website through MCP |
| 5 | Requirements, planning, and generation agents | 18–30 hours | Generate traceable candidate scenarios and candidate test code |
| 6 | Validation, execution, and reports | 14–24 hours | Validate generated tests, assess repeatability, execute safely, and create evidence-based reports |
| 7 | Release comparison and regression memory | 14–24 hours | Compare releases and preserve approved tests across versions |
| 8 | Local UI, CI/CD, and expansion hooks | 16–30 hours | Usable local web UI and a path to automated release triggers |

**Estimate note:** The combined estimate is provisional. The 2–4-hour feasibility spike is counted separately from the nine implementation phases. Installing software, resolving model/hardware constraints, MCP integration, and diagnosing generated-code failures can expand the schedule. Re-estimate after the feasibility spike and after each phase. The local UI is postponed until the CLI workflow is reliable.

## 3. Phase 0 — Define the project

**Goal:** Establish what is being built before generating platform code.

### Task 0.1 — Confirm the product goal

- [x] Record the goal: AI-assisted, release-aware QA automation for browser-based web applications.
- [x] Record the intended progression: personal/portfolio project, useful at work, possible future product.
- [x] Record that the system must not fabricate requirements, hide failures, or falsely claim verification.

**Done when:** The product summary and goals in `PROJECT_SPEC.md` accurately describe the intended system.

### Task 0.2 — Define the MVP scope

- [x] Focus initially on web applications, including applications with multiple roles.
- [x] Include functional, end-to-end, black-box, and regression testing purposes.
- [x] Begin with Markdown and plain-text workflow documents.
- [x] Start with a CLI prototype; add a local web UI later.
- [x] Defer native mobile, comprehensive performance/security testing, multi-user hosting, and advanced infrastructure.

**Done when:** The first version has a clear boundary and a list of features explicitly deferred.

### Task 0.3 — Choose initial technical direction

- [x] Use TypeScript for the new platform, Node.js as the runtime, and Playwright Test as the execution engine.
- [x] Keep the completed JavaScript tutorial project as a separate reference/example rather than converting it into the platform.
- [x] Use Playwright MCP for AI browser exploration and a separate Playwright Test runner for repeatable execution.
- [x] Plan for a local AI model first, behind a replaceable provider adapter; a hosted provider is optional later.
- [x] Plan to use Git/files for versioned assets and SQLite for structured metadata when needed.
- [x] Select Vitest for platform unit/integration tests, separate from Playwright tests against target applications.

**Done when:** `ARCHITECTURE.md` and `DECISIONS.md` explain these choices and their rationale.

### Task 0.4 — Define agent permissions and approval gates

- [x] Allow agents to explore approved test environments, analyze requirements, plan tests, and create candidate code.
- [x] Keep generated tests in a candidate area until reviewed.
- [x] Require approval for material changes to expected behavior, test meaning, or retired coverage.
- [x] Prevent silent assertion weakening, false reporting, and unapproved production actions.

**Done when:** Agent trust rules are included in the project specification and architecture.

### Task 0.5 — Establish source-of-truth documents

- [x] Create `PROJECT_SPEC.md`.
- [x] Create `ARCHITECTURE.md`.
- [x] Create `IMPLEMENTATION_PLAN.md`.
- [x] Save the three documents under the repository's `docs/` folder (user-reported).
- [x] Add `DECISIONS.md` as the supporting architecture/implementation decision log.
- [ ] Confirm the files are present in the actual repository and commit the reviewed baseline.

**Done when:** The documents are in the repository, reviewed, and committed before feature implementation proceeds.

### Task 0.6 — Set up the coding workflow

- [x] Create the new project folder `D:\ai-qa-platform` and its `docs/` folder (user-reported).
- [x] Place the project documents under `docs/` (user-reported).
- [ ] Confirm a Git repository exists and is separate from the JavaScript tutorial project.
- [ ] Add or review a minimal `README.md` linking to the project documents.
- [ ] Confirm `.gitignore` excludes dependencies, build output, secrets, authentication state, and generated run artifacts without excluding tests.
- [x] Use one bounded coding task per prompt, tests/checks after each change, diff review, and a commit after a working checkpoint.

**Done when:** A clean repository exists with documentation, README, appropriate ignore rules, and a baseline commit. No AI agents or UI need to exist yet.

### Phase 0 acceptance checklist

- [x] The project goal and exclusions are clear.
- [x] The first supported application type and testing purposes are defined.
- [x] The language and execution-engine decisions are recorded.
- [x] The local-first/no-required-paid-AI constraint is recorded.
- [x] Candidate versus approved tests and safety rules are documented.
- [x] The architecture separates MCP exploration from Playwright Test execution.
- [ ] Git state, README, ignore rules, and baseline commit are verified in the local repository.

## 4. Pre-Phase 3 — Local AI and Playwright MCP feasibility spike

**Estimated effort:** 2–4 focused hours. This experiment is separate from the platform code and does not block Phase 1's deterministic execution-engine work. Complete it after the initial repository audit and before committing substantial effort to Phases 3–5.

**Goal:** Test the riskiest product assumption early: whether a candidate local model can use Playwright MCP tools and produce a usable Playwright test on the available hardware.

### Spike tasks

1. Record the computer's RAM, GPU/VRAM, operating system, and available disk space.
2. Select one candidate local model based on those constraints and record its exact name/version/quantization.
3. Run the model through a local runtime such as Ollama.
4. Build or use a disposable MCP client to connect the model to Playwright MCP. Prefer a small TypeScript proof of concept representative of the planned integration; an existing MCP client may be used for initial comparison, but record any client-side prompting/retry assistance that could influence results.
5. Ask the model to explore the SauceDemo login page and a small, explicitly described workflow.
6. Give it a requirement with an explicit expected outcome and ask it to produce one Playwright Test file.
7. Run the generated test independently through Playwright Test; do not accept the model's claim that it passed.
8. Record tool-call count, response time, corrections, browser observations, errors, generated-code quality, and actual test outcome.

### Initial pass/fail criteria

- MCP connection succeeds and the client discovers the tools it needs.
- The model explores the agreed SauceDemo workflow within a pre-agreed tool-call budget (initial target: about 15 calls; adjust only when the workflow genuinely needs more).
- Claims about website elements and outcomes are supported by browser observations; invented controls or results count as a failure.
- The model produces one executable Playwright test with meaningful assertions derived from the supplied requirement.
- The test is independently executed and its actual outcome is recorded.
- The experiment records hardware, model/version/quantization, response time, tool-call count, corrections, errors, and limitations.

Classify the outcome as **green** (criteria met), **amber** (exploration works but generation needs limited correction), or **red** (tool use or generation is not reliable enough). This is a feasibility assessment, not a claim that all applications can be automated. If results are weak, reconsider model choice, the optional hosted-provider fallback, or the amount of autonomy before implementing the dependent AI phases.

**Done when:** A short feasibility note records the evidence, result, and recommended next decision. Do not copy throwaway experiment code into `src/`.

## 5. Phase 1 — Generic Playwright execution engine

**Goal:** Make test execution reusable without AI. Phase 1 must work with no model, no MCP server, and no AI-generated code.

**Estimated effort:** 14–22 focused hours.

### Task 1.0 — Repository and environment audit

**Effort:** 30–45 minutes. **Code changes:** None; read-only inspection.

**Goal:** Establish the actual repository state before changing files.

Tasks:

1. Confirm the project root is `D:\ai-qa-platform` and inspect the existing directory structure.
2. Read `docs/PROJECT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION_PLAN.md`, and `docs/DECISIONS.md`.
3. Inspect Git initialization, current branch, working-tree status, and existing diffs. Do not assume Git is initialized.
4. Check for `README.md`, `package.json`, lockfile, `.gitignore`, and TypeScript configuration files.
5. Record installed Node.js, npm, and Git versions.
6. Confirm the JavaScript tutorial project is separate and will not be modified.
7. Compare the repository against the Phase 0 acceptance checklist and report missing items.

**Acceptance criteria:** The current repository state, installed versions, existing changes, and outstanding Phase 0 setup items are documented. No files are modified.

**Verification:** Provide actual command output or observed results for the environment and Git checks. Do not initialize Git or overwrite files as part of this read-only task.

### Task 1.1 — TypeScript foundation and platform test setup

**Effort:** 1.5–2 hours.

**Goal:** Prepare the new repository to build TypeScript platform code and test the platform's own logic.

Tasks:

1. Inspect the existing repository and package manager before changing `package.json`.
2. Configure a consistent Node-compatible module system. Do not mix CommonJS and ESM conventions without an explicit reason.
3. Create or configure the shared `tsconfig.json`.
4. Create `tsconfig.build.json` to compile only `src/` into `dist/`; do not emit test files or `playwright.config.ts` into `dist/`.
5. Create `tsconfig.typecheck.json` with `noEmit` to type-check platform source, root Playwright configuration, platform tests, fixture TypeScript files, and target-project Playwright tests.
6. Install and configure Vitest for platform unit and integration tests.
7. Restrict Vitest `include` to `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`; explicitly exclude `tests/fixtures/**` and `project-data/**`, while retaining normal exclusions such as `node_modules`, `.git`, and build output.
8. Use `.test.ts` for Vitest tests and `.spec.ts` for Playwright target/fixture tests.
9. Add package scripts for build, type-check, Vitest, and the CLI command. Compile platform source first, then execute the emitted JavaScript with Node.js.
10. Add or update `.gitignore` for `node_modules`, `dist`, coverage, temporary files, `.env`, Playwright authentication state, and generated project artifacts. Do not ignore source tests or configurations.

**Acceptance criteria:** A minimal platform TypeScript module compiles; the CLI build output is emitted under `dist/`; no-emit type checking covers all relevant TypeScript files; Vitest discovers only platform test files; the package scripts work.

**Verification:** Run the actual build, type-check, and Vitest commands. Confirm a Playwright `.spec.ts` fixture is not picked up by Vitest.

### Task 1.2 — Install Playwright Test and create the permanent config entry point

**Effort:** 45–75 minutes.

**Goal:** Install the Playwright Test engine and establish the one platform-owned Playwright configuration. Do not create a temporary or per-project Playwright config.

Tasks:

1. Inspect package versions and install `@playwright/test` as a development dependency if it is not already installed.
2. Check whether the browser binary cached from the tutorial project is compatible with the installed Playwright version. Attempt an actual launch; install the matching browser only if absent or incompatible.
3. Create one root `playwright.config.ts` at the platform repository root. It will become the permanent platform-owned config and will be completed in Task 1.3.
4. Establish the required `QA_PROJECT_CONFIG_PATH` and `QA_RUN_DIR` environment-variable contract. The final config must fail fast if either is missing or invalid; it must not use a default project.
5. Do not put SauceDemo selectors, test paths, or application logic into the generic config.

**Acceptance criteria:** `@playwright/test` is installed; the matching browser can launch; the one root Playwright config exists; no per-project or fixture-specific Playwright config is created.

**Verification:** Record actual installed Playwright version and browser launch result. Do not assume a cached browser is compatible merely because it exists.

### Task 1.3 — Execution configuration schema, loader, and validation

**Effort:** 1.25–2 hours.

**Goal:** Make the platform load and validate which application project should run.

The Phase 1 config must be a strict subset of the later Phase 2 project schema. Use these field names:

```json
{
  "projectId": "saucedemo",
  "name": "SauceDemo Demo",
  "baseUrl": "https://www.saucedemo.com/",
  "environment": "demo",
  "allowedDomains": ["www.saucedemo.com"],
  "testDirectory": "tests/approved",
  "artifactDirectory": "artifacts"
}
```

Tasks:

1. Define a typed `ExecutionConfig` interface matching the Phase 1 fields.
2. Implement loading and runtime validation of project JSON. TypeScript types alone do not validate external JSON.
3. Validate required fields, URL syntax, non-empty allowed domains, and that the base URL hostname matches an allowed domain. Accept exactly `local`, `development`, `demo`, and `staging` for `environment`; reject `production` in Phase 1. Require HTTPS except for `localhost`, where plain HTTP (for example, `http://localhost`) is allowed for local fixtures.
4. Resolve `testDirectory` and `artifactDirectory` relative to the project workspace (the directory containing the project config) and reject path traversal outside it.
5. Validate that the test directory exists. Create the run artifact directory only through the run manager/runner when starting a run.
6. Return actionable validation errors that identify the invalid field.
7. Make the root `playwright.config.ts` read `QA_PROJECT_CONFIG_PATH` and `QA_RUN_DIR`, validate both, and load the selected project config through the shared loader/validator exported from `src/projects/`. Import and reuse that validator; do not reimplement or duplicate project-config validation in `playwright.config.ts`. Fail fast with a clear message if either environment variable is missing or invalid.
8. Ensure the resolved run directory is inside the project's configured artifact directory; do not silently fall back to another project or path.
9. In the same root config, derive Playwright `testDir`, `use.baseURL`, and `outputDir` from the selected project/run paths. Keep `outputDir` separate from the sibling HTML report directory.
10. Set `retries: 0` and do not use `--pass-with-no-tests`. Reporter configuration is deliberately deferred to Task 1.7; do not configure JSON or HTML reporters in Task 1.3.

**Acceptance criteria:** A valid config loads; missing/malformed config, invalid URL/domain, missing test directory, escaping path, missing environment variables, and invalid run directory all fail before browser launch. The same config file is used for all target and fixture projects.

**Verification:** Add Vitest tests for the config loader/validator, including path traversal, unsupported environment values (including `production`), allowed localhost HTTP, rejected non-localhost HTTP, and missing/invalid environment inputs. Confirm the Playwright config reports a clear failure when either required environment variable is absent.

### Task 1.4 — Create the SauceDemo example project and smoke test

**Effort:** 45–75 minutes.

**Goal:** Prove that the generic engine can execute a test against an external target application.

Create the project under:

```text
project-data/saucedemo/
├── project.config.json
└── tests/
    └── approved/
        └── smoke.spec.ts
```

Tasks:

1. Add the SauceDemo project JSON using the Phase 1 execution schema.
2. Create one approved smoke test that opens the login page and checks the expected login controls.
3. Use `page.goto('/')`; Playwright `baseURL` must come from the selected project config.
4. Use appropriate accessible locators and meaningful assertions.
5. Keep all SauceDemo-specific locators and behavior inside this project directory.
6. Do not import page objects from the separate JavaScript tutorial project.

**Acceptance criteria:** The test is located under `project-data/saucedemo/tests/approved/`; its URL comes from configuration; the test passes when the demo site is reachable; an external-site/network failure is reported honestly.

**Verification:** At this point the runner does not exist yet. From the repository root in PowerShell, manually set the two environment variables and create a run directory under the project's configured artifact directory. For example (adjust paths only if the project layout differs):

```powershell
$projectConfig = (Resolve-Path ".\project-data\saucedemo\project.config.json").Path
$runDir = Join-Path (Resolve-Path ".\project-data\saucedemo").Path "artifacts\manual-task-1-4"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$env:QA_PROJECT_CONFIG_PATH = $projectConfig
$env:QA_RUN_DIR = $runDir
npx playwright test --config=".\playwright.config.ts"
Remove-Item Env:QA_PROJECT_CONFIG_PATH
Remove-Item Env:QA_RUN_DIR
```

If PowerShell blocks `npx` with an execution-policy error, use `npx.cmd playwright test --config=".\playwright.config.ts"` instead.

Do not create a SauceDemo-specific Playwright config or invent a temporary shortcut config. Record the actual commands and result; Task 1.5 will later automate this same environment-variable path.

### Task 1.5 — Build the Playwright runner service and deterministic fixtures

**Effort:** 3.5–5 hours.

**Goal:** Execute a selected project's tests programmatically and verify process management without depending only on a public website.

Runner tasks:

1. Create the runner under `src/test-execution/`.
2. Accept a validated project execution configuration and run options.
3. Generate a collision-safe UTC timestamp-based run ID, for example `2026-10-31T19-29-05-123Z`, and create one run directory under the project's `artifactDirectory`.
4. Resolve the installed Playwright CLI entry point from the actual installed package metadata/module resolution. Do not hardcode a guessed `node_modules` path.
5. Launch Playwright by invoking `process.execPath` with the resolved CLI entry point and an argument array. Use `shell: false`; do not concatenate untrusted values into a shell command.
6. Set the working directory to the platform root and pass absolute `QA_PROJECT_CONFIG_PATH` and `QA_RUN_DIR` values in the child environment.
7. Capture stdout, stderr, exit code, signal, start/end time, duration, and timeout state.
8. Enforce a runner-level timeout. On timeout, terminate the complete process tree/group using the OS-specific strategy in `DECISIONS.md`; wait for the child exit event and report cleanup failures.
9. Return structured execution metadata without converting every non-zero exit into an ordinary test failure. Preserve raw process and report evidence for the report parser.
10. Add a configurable/internal runner timeout option for integration tests; do not add unnecessary fields to the Phase 1 project config merely to test timeouts.

Create local fixture projects under:

```text
 tests/fixtures/runner-projects/
 ├── passing/
 │   ├── project.config.json
 │   └── tests/approved/passing.spec.ts
 ├── failing/
 │   ├── project.config.json
 │   └── tests/approved/failing.spec.ts
 ├── no-tests/
 │   ├── project.config.json
 │   └── tests/approved/.gitkeep
 └── hanging/
     ├── project.config.json
     └── tests/approved/hanging.spec.ts
```

Fixture requirements:

- Every fixture has its own minimal `project.config.json` using the same Phase 1 schema. Use `environment: "local"`, `baseUrl: "http://localhost"`, and `allowedDomains: ["localhost"]` for the local `page.setContent()` fixtures; this is the sole permitted plain-HTTP case.
- No fixture has its own `playwright.config.ts`; all fixtures run through the platform-owned root config.
- The passing and failing fixtures use local browser content such as `page.setContent()` and do not require public network access.
- The no-tests fixture has an existing but empty approved test directory. The runner must not pass `--pass-with-no-tests`; zero discovered tests is classified as run status `infrastructure_error` with `reason: "no_tests_found"` (the JSON report may still be successfully collected).
- The hanging test must set `test.setTimeout(0)` before the intentional indefinite wait, ensure the browser/test has started, and be stopped by a short runner-level timeout. If that runner timeout fires, set run status to `timed_out`; if the required JSON report is absent, set report status to `failed`. The timeout remains the primary CLI outcome, rather than being masked by the missing report. This ensures the platform timeout—not Playwright's default per-test timeout—is exercised.
- Fixture projects are excluded from Vitest discovery but included in the no-emit TypeScript type-check.

Process termination requirements:

- **Windows:** on timeout, invoke `taskkill.exe /T /F /PID <pid>` without a shell, then wait for the child exit event. Manually inspect Task Manager or `tasklist` once to confirm no orphaned Playwright/browser processes remain.
- **Linux/macOS:** start the child in its own process group, send SIGTERM to the group, wait a short grace period, then send SIGKILL if needed.
- Keep OS-specific process handling isolated in a small module. Do not attempt fragile recursive process enumeration.

**Acceptance criteria:** The runner can execute the passing/failing/no-tests/hanging fixtures through the same root Playwright config; it distinguishes pass, test failure, timeout, and infrastructure/process errors; the timeout path invokes process-tree/group cleanup; no empty suite is treated as a pass.

**Verification:** Run all four fixtures and record actual results. On Windows, verify process cleanup manually. Test runner startup failure and cleanup failure handling where practical.

### Task 1.6 — Build the CLI execution command

**Effort:** 1–1.5 hours.

**Goal:** Allow users to execute a configured project through one platform command.

An example target user experience is:

```powershell
npm run qa -- run --config project-data/saucedemo/project.config.json
```

Tasks:

1. Create the CLI entry point under `src/cli/`.
2. Parse and validate the command and config path.
3. Reuse the existing config loader and runner service.
4. Display useful start/progress/final status messages.
5. Return a non-zero CLI exit code for failed execution, timeout, infrastructure errors, unverified results, or required report-collection failure.
6. Provide a concise help message for missing or invalid arguments.
7. Keep application/runner business logic out of CLI parsing code.

**Acceptance criteria:** A user can execute SauceDemo and each local fixture using the same documented CLI command shape and a different config path. Invalid configuration stops before browser launch.

**Verification:** Run valid and invalid CLI invocations and inspect their actual exit codes.

### Task 1.7 — Implement report collection, parsing, and execution summary

**Effort:** 1.5–2.25 hours.

**Goal:** Produce accurate machine-readable and human-readable results for every run.

Run directory layout:

```text
project-data/saucedemo/artifacts/<run-id>/
├── results.json
├── html-report/
├── test-output/
└── logs/
```

Tasks:

1. Configure the built-in Playwright JSON reporter to write `results.json` in the run directory.
2. Configure the HTML reporter to write to the sibling `html-report/` directory with `open: 'never'`. This is the only task that configures reporters; Task 1.3 must not configure reporters.
3. Keep Playwright `outputDir` at `test-output/`; do not place the HTML report inside this directory because Playwright may clean `outputDir` before a run.
4. Capture failure traces/screenshots under Playwright's output directory where supported by the installed version.
5. Parse and validate the JSON report, including test statistics/results and the top-level `errors` array. Do not infer a missing error list as proof that there were no errors if the report is malformed or incomplete.
6. Model individual test status, run status, and report-collection status separately as defined in `DECISIONS.md`.
7. Apply the explicit exit-code/report consistency rules. A non-zero exit with all individual tests passed must never pass; show top-level Playwright errors such as setup, teardown, or worker errors when present. If no cause is available, preserve the non-zero exit as an infrastructure error rather than inventing an explanation.
8. Assign `reason: "test_failures"` when the run status is `failed` because one or more individual tests failed. Keep the machine-readable reason separate from its human-readable message; use the other defined reason codes for their corresponding infrastructure, timeout, cleanup, report, or exit/report-mismatch conditions.
9. Treat missing/malformed JSON, zero tests, conflicting exit/report evidence, or required report collection failure as unsuccessful verification. A zero-test run is `infrastructure_error` with `reason: "no_tests_found"`; if the runner-level timeout fired, report `timed_out` as the run status and `failed` as report status when JSON is absent, with timeout shown as the primary CLI outcome.
10. Display total/passed/failed/skipped counts, run status, report status, duration, run ID, and report location. Do not claim that an HTML report exists unless the expected file/folder was verified.
11. Ensure a previous run's directory is never overwritten.

**Acceptance criteria:** JSON and HTML reports are generated and retained; the parser accurately reports test counts and top-level errors; status is consistent with both process and report evidence; the CLI exits non-zero for any unverified or incomplete outcome.

**Verification:** Test passing, failing, no-tests, and hanging fixtures. Include a parser test for a valid report with a top-level error and a deliberately inconsistent process/report combination. Confirm the HTML reporter does not open a browser or leave the process waiting for user input.

### Task 1.8 — Final Phase 1 integration and verification

**Effort:** 3.5–5 hours.

**Goal:** Confirm the complete generic execution engine works and its parts are integrated without SauceDemo-specific assumptions in the platform core.

Tasks:

1. Inspect the full Phase 1 implementation and Git diff.
2. Fill any test gaps for configuration validation, CLI arguments, runner outcomes, report parsing, and process cleanup.
3. Verify Vitest does not discover Playwright fixture or project tests.
4. Verify the no-emit type-check includes platform code, root Playwright config, Vitest tests, fixtures, and project Playwright tests.
5. Verify the build emits only `src/` code to `dist/`.
6. Run the complete local fixture suite.
7. Run the SauceDemo smoke test through the CLI and platform-owned Playwright config.
8. Inspect JSON and HTML report artifacts.
9. Confirm `.gitignore` excludes generated artifacts and secrets but does not exclude project tests/configuration.
10. Review the complete diff for unrelated changes, unsafe shell invocation, swallowed errors, missing cleanup, hardcoded SauceDemo behavior, and accidental secrets.
11. Update this plan with actual task status, actual effort, issues, and remaining limitations.

**Acceptance criteria / Phase 1 exit criteria:**

- A configured project can be executed through the platform CLI.
- The same platform-owned Playwright config is used for SauceDemo and runner fixtures.
- The generic platform core contains no SauceDemo-specific selectors or page objects.
- Invalid project config or missing required environment variables stops execution before browser launch.
- Passing, failing, no-tests, and hanging fixtures produce the expected outcomes.
- Timeout cleanup uses the OS-specific process-tree/group strategy.
- JSON/HTML reporting works; top-level JSON errors are displayed; missing or contradictory evidence never results in a pass.
- Platform tests and target-application Playwright tests are discovered by their correct runners only.
- Build, type-check, and relevant tests pass with observed evidence.

**Final output from the coding assistant:** List changed files, commands actually run, test/build/type-check results, artifacts produced, unverified items, and remaining risks. Do not state that Phase 1 is complete unless all exit criteria are met.

## 6. Phase 2 — Project and workflow-document management

**Goal:** Represent different application projects independently and make requirements traceable.

Tasks:

1. Extend the Phase 1 execution config using the same existing field names; add fields rather than rename/rewrite the schema.
2. Create project workspace creation and loading functions.
3. Store project data in separate directories and test cross-project isolation.
4. Load Markdown and plain-text documents and preserve original document versions/hashes and source references.
5. Define the structured Markdown requirement authoring convention, including author-assigned stable IDs, expected results, and expected outcomes for every negative case.
6. Define and validate the requirement schema. Reject missing/duplicate IDs; never reuse retired IDs.
7. Define how AI-proposed IDs and structured interpretations from free-form documents enter a human review/approval process.
8. Add role profiles and authentication configuration. Store credential environment-variable names, not secret values, in project config.
9. Support local `.env` only when Git-ignored and provide `.env.example` with names/placeholders only.
10. Define role-specific setup and authentication-state storage conventions. Treat Playwright `storageState` files as secrets and exclude them from Git and logs.
11. Add tests for missing documents, malformed configs, path handling, duplicate IDs, and cross-project isolation.

**Exit criteria:** Create two projects with different URLs and documents without mixing settings or requirements. A structured document yields validated stable requirement records. Role/credential configuration is represented safely. AI extraction may remain a reviewed proposal until the relevant AI phase.

## 7. Phase 3 — Local AI model integration

**Goal:** Let the platform call a local model through one replaceable interface.

Tasks:

1. Use the feasibility-spike evidence to check RAM/GPU and choose a feasible local model/runtime.
2. Install and run the local model runtime (candidate: Ollama).
3. Re-test structured-output and tool-call behavior using the selected model/version.
4. Define a provider interface independent of the chosen vendor.
5. Implement the local adapter.
6. Define request/response schemas and validate all model outputs.
7. Handle model-unavailable, timeout, cancellation, malformed-output, and context-limit errors.
8. Store model/provider name and prompt/schema version for reproducibility, but never log secrets.
9. Add tests using a mock provider so most tests do not require a running model.
10. Keep optional hosted-provider support behind the same interface; do not make it mandatory.

**Exit criteria:** The CLI can send a structured task to the local model and validate the returned result. The system reports uncertainty or malformed output rather than silently accepting it.

## 8. Phase 4 — Playwright MCP browser exploration

**Goal:** Let the platform's own backend call browser tools.

Tasks:

1. Read the current official Playwright MCP instructions and current MCP TypeScript SDK documentation.
2. Install and configure the Playwright MCP server in a development environment.
3. Build a standalone MCP client check that connects, lists tools, and closes cleanly.
4. Wrap the connection in the platform MCP adapter.
5. Validate tool arguments and apply timeouts/cancellation.
6. Enforce approved domains before navigation and re-check navigation destinations where possible; do not rely only on a prompt for domain security.
7. Ask the selected local model to perform a limited read-only exploration of a demo site.
8. Store returned observations as structured records with project/release context and evidence metadata.
9. Test connection failure, tool error, wrong domain, prompt-injection content, timeout, and browser cleanup behavior.

**Exit criteria:** A command run by the platform backend explores an approved demo site and saves observations. It must work independently of VS Code's MCP configuration.

## 9. Phase 5 — Requirements, test-planning, and generation agents

**Goal:** Turn requirements and observations into candidate test cases and code.

Tasks:

1. Implement structured requirement ingestion using the Phase 2 schema and stable author-assigned IDs.
2. For unstructured documents, let AI propose a structured version and IDs for human approval; preserve the original source.
3. Flag missing, ambiguous, or conflicting expected results.
4. Add release-aware requirement classifications: new, changed, unchanged, retired, unresolved.
5. Define a test scenario schema and test category labels. Categories belong to scenarios, not requirements.
6. Implement the planner prompt/module and validate its output.
7. Link every candidate scenario to one or more requirement IDs.
8. Require explicit expected outcomes for positive and negative scenarios; assertions must trace to requirement text.
9. Implement candidate test generation using a small set of templates and conventions.
10. Generate tests in a restricted candidate workspace, not the approved directory.
11. Use stable Playwright locators; never persist temporary MCP snapshot references.
12. Add code/schema validation, file-count limits, tool-call limits, and generation stop conditions.
13. Test on SauceDemo and at least one different demo application as capability improves.

**Exit criteria:** A workflow document plus exploration observations produce traceable candidate scenarios and test files. Candidate output is not automatically promoted to the approved suite.

## 10. Phase 6 — Validation, execution, and reporting

**Goal:** Execute generated tests safely and produce evidence.

Tasks:

1. Add candidate-test syntax and TypeScript checks.
2. Run candidate tests in a controlled subprocess/workspace with timeouts.
3. Validate test IDs, requirement links, and assertion-to-requirement traceability.
4. Run each candidate in three separate executions initially, with Playwright retries disabled for each execution. Flag inconsistent outcomes as unstable; three successful runs are evidence, not a guarantee of no future flakiness.
5. Require human review to confirm assertions represent documented expected behavior rather than merely observed current website behavior.
6. Parse Playwright JSON including top-level errors and retain native HTML output.
7. Capture traces/screenshots/logs according to configuration.
8. Normalize test, run, and report statuses without collapsing distinct failure causes.
9. Separate observed facts from AI failure hypotheses.
10. Add approval/rejection workflow for candidate tests.
11. Test that a failed run, missing report, empty test suite, or inconsistent process/report result is never reported as passing and that artifacts are not fabricated.

**Exit criteria:** A candidate test can be validated and run; a report shows actual outcomes and available evidence; reviewers control promotion to approved.

## 11. Phase 7 — Release comparison and regression memory

**Goal:** Preserve valid tests and compare releases.

Tasks:

1. Define release records and stable project/test/requirement IDs.
2. Store document versions, hashes, release metadata, and source references.
3. Implement deterministic requirement comparison using author-assigned IDs and structured fields.
4. Use AI to suggest semantic changes only where deterministic comparison is insufficient.
5. Preserve comparison evidence and let a reviewer correct classifications.
6. Map approved tests to requirements and retain test/requirement history.
7. Select the active approved suite for a release.
8. Run the active suite against the new target release.
9. Compare current and prior results and highlight newly failing tests.
10. Record approvals and reasons for changed/retired requirements and tests.
11. Demonstrate V1 and V2 workflow documents: stable IDs persist for the same requirement, new IDs are added for new requirements, and valid V1 tests remain active.

**Exit criteria:** A V2 run keeps valid V1 coverage, adds approved tests for new behavior, flags changed/retired requirements for review, and compares results with the V1 baseline.

## 12. Phase 8 — Local UI, CI/CD, and expansion hooks

**Goal:** Make the prototype easier to use and prepare it for repeatable release operation.

Tasks:

1. Design a small dashboard around proven CLI workflows.
2. Add a local API layer that calls existing application services.
3. Add screens for projects, document upload, exploration, requirement/test-plan review, approvals, runs, and reports.
4. Add user-visible progress, cancellation, and explicit error states.
5. Add CI workflow to execute approved tests after a manual or configured release trigger.
6. Store CI artifacts and link them to release/run records.
7. Add optional integrations for accessibility, visual, performance, or security tools only when needed.
8. Review secrets handling, filesystem permissions, allowed-domain controls, process isolation, and generated-code isolation before exposing the app beyond localhost.

**Exit criteria:** A user can manage a project and view reports through the local UI, and an approved release trigger runs the intended automated pipeline reliably.

## 13. Development rules for every phase

- Keep the last working commit before a feature change.
- Prefer small pull-request-sized changes, even when working alone.
- Inspect the repository, versions, instructions, and working tree before editing.
- Write automated tests for business logic and validation as part of the task that introduces them; do not defer all tests to a final phase task.
- Use mocked model/MCP adapters for most unit tests; reserve real model/browser checks for integration tests.
- Keep real model calls out of routine unit tests to reduce flakiness and cost.
- Do not introduce a database, abstraction, or agent library before a current requirement justifies it.
- Make generated output inspectable and reproducible where possible.
- Record what failed, what was not tested, and what remains uncertain.
- Update this document after each task/phase with actual effort, outcome, and lessons learned. This is the single source of truth for implementation progress.

## 14. Immediate next actions

1. Confirm the four documents are present in `D:\ai-qa-platform\docs\`.
2. Run Task 1.0, the read-only repository and environment audit.
3. Resolve any missing Phase 0 setup items without overwriting existing work.
4. Begin Task 1.1 only after the audit is reviewed.
5. Schedule the local AI/MCP feasibility spike after the repository audit and before substantial implementation in Phases 3–5. It does not block Phase 1.

## References

- Playwright TypeScript: https://playwright.dev/docs/test-typescript
- Playwright configuration: https://playwright.dev/docs/test-configuration
- Playwright running tests: https://playwright.dev/docs/running-tests
- Playwright reporters: https://playwright.dev/docs/test-reporters
- Playwright authentication: https://playwright.dev/docs/auth
- Playwright MCP: https://playwright.dev/docs/getting-started-mcp
- Vitest configuration: https://vitest.dev/config/
- MCP TypeScript SDK v2 client: https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-client.html
- Ollama tool support: https://registry.ollama.com/blog/tool-support
- Node.js child processes: https://nodejs.org/api/child_process.html
