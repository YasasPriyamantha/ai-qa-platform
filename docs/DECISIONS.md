# Architecture and Implementation Decisions

**Document status:** Initial decision record, established before Phase 1  
**Project:** AI-Powered QA Automation Platform

This file records decisions that affect multiple phases. `IMPLEMENTATION_PLAN.md` remains the single source of truth for task order, progress, and completion status. `PROJECT_SPEC.md` defines product requirements; `ARCHITECTURE.md` defines the system structure.

A decision may be revisited when evidence or requirements change. When that happens, add a new decision or mark the old one superseded; do not silently rewrite history.

---

## DEC-001 — Use TypeScript for new platform code

**Status:** Accepted

**Decision:** Build the new QA platform in TypeScript on Node.js. Keep the completed JavaScript tutorial project separate as a reference/demo; do not migrate it into the platform.

**Reason:** TypeScript provides stronger interface checking for a growing modular codebase. Choosing it now avoids a later platform-wide conversion. Playwright supports TypeScript tests and configuration, with a separate type-check step.

**Consequences:** Maintain build and type-check configurations. Platform source compiles to `dist/`; Playwright configuration and tests are loaded by Playwright and included in a separate no-emit type-check.

## DEC-002 — Start as a local-first modular monolith

**Status:** Accepted

**Decision:** Start with one local Node.js application and clear module boundaries. Do not introduce microservices or distributed agent infrastructure for the MVP.

**Reason:** A modular monolith is easier to understand, debug, test, and develop incrementally. Clear interfaces leave room for later server deployment or selective separation.

## DEC-003 — Use Playwright Test as the browser execution engine

**Status:** Accepted

**Decision:** Use the open-source Playwright Test package for repeatable browser test execution and native reporting.

**Reason:** The platform should build on Playwright's runner, browser lifecycle, assertions, fixtures, and reporters rather than reimplementing them.

**Consequences:** The platform owns project selection, process management, result normalization, and run artifacts. Playwright remains the source of browser test outcomes.

## DEC-004 — Separate browser exploration from repeatable test execution

**Status:** Accepted

**Decision:** Use Playwright MCP for AI-assisted browser exploration. Use Playwright Test to execute saved, repeatable test files.

**Reason:** Interactive exploration and automated test execution have different purposes. Browser observations help the AI plan tests, but MCP exploration is not proof that an automated test passed.

## DEC-005 — Use custom, bounded AI-agent roles

**Status:** Accepted

**Decision:** Implement agent roles as ordinary TypeScript modules/functions within a bounded orchestrator initially. One model may serve multiple roles. Do not require multiple autonomous services or a multi-agent framework.

**Reason:** The project needs explicit workflow control, inspectable tool calls, timeouts, approval gates, and reproducible outputs more than it needs agent-framework complexity.

## DEC-006 — Local AI first; hosted provider optional

**Status:** Accepted

**Decision:** No paid AI API or paid Playwright feature is mandatory. Begin with a local model provider (candidate: Ollama) behind a replaceable provider interface. An optional hosted provider may be added later.

**Reason:** The user's first implementation should run without required subscription/API spending while retaining the option to use a stronger provider later.

**Consequence:** Local model capability must be experimentally validated against browser tool use and Playwright test generation before substantial AI integration work.

## DEC-007 — Run a standalone local-model/MCP feasibility spike

**Status:** Accepted; schedule before major AI integration work

**Decision:** Run a disposable 2–4-hour proof of concept using a candidate local model, Playwright MCP, and a small client/script before committing substantial effort to Phases 3–5. The spike is separate from platform code and does not block the deterministic Phase 1 runner.

**Reason:** The platform's central AI workflow depends on the model's ability to call browser tools and generate usable Playwright tests. This risk should be tested early.

**Initial experiment:** Check hardware first; connect a local model to Playwright MCP; explore the SauceDemo login workflow; generate one Playwright test with requirement-linked assertions; run it independently.

**Initial pass criteria:**

1. MCP connection succeeds and available tools can be discovered.
2. The model explores the agreed SauceDemo workflow within a pre-agreed tool-call budget (initial target: about 15 calls; adjust if the workflow genuinely requires more).
3. The model's claims about the page are supported by returned browser observations.
4. It produces one executable Playwright test whose expected assertions trace to supplied requirement text.
5. The test runs through Playwright Test and its actual result is recorded.
6. Model/version, hardware, response time, tool-call count, corrections, errors, and outcome are documented.

**Outcome:** Green (criteria met), amber (exploration works but generation needs limited correction), or red (tool use or generation is not reliable enough). The outcome informs model choice, provider fallback, and scope; it does not silently change the zero-cost-first requirement.

## DEC-008 — Keep candidate and approved tests separate

**Status:** Accepted

**Decision:** AI-generated tests remain candidates until validated and reviewed. Only approved tests enter the active regression suite.

**Reason:** A passing generated test may still assert the wrong behavior or encode an existing defect. Approval must check requirement traceability and meaningful assertions.

## DEC-009 — Use author-assigned stable requirement IDs

**Status:** Accepted

**Decision:** Structured workflow documents use author-assigned IDs (for example, `REQ-012`). An ID is retained for the same tracked requirement across releases; IDs are never reused for unrelated requirements. New requirements receive new IDs; retired requirements remain in history. AI-proposed IDs from unstructured documents require review before acceptance.

**Reason:** Deterministic release comparison depends on stable identity. LLM-generated identifiers can drift between independent extraction runs.

**Consequence:** Phase 2 defines/validates structured requirement records and a Markdown authoring convention. Phase 5/7 may use AI for semantic change suggestions, but human review confirms authoritative changes.

## DEC-010 — Use Git/files for durable text assets and SQLite for metadata later

**Status:** Accepted

**Decision:** Version workflow documents, approved test code, and important text artifacts in Git/files. Introduce SQLite for structured project, release, run, and approval metadata when the relevant phase is reached. Do not introduce a vector database for the MVP.

## DEC-011 — CLI first, local web UI later

**Status:** Accepted

**Decision:** Prove the workflow through a CLI before adding a local web UI. The later UI must call the same application services used by the CLI.

## DEC-012 — Use Vitest for platform tests and Playwright Test for target applications

**Status:** Accepted

**Decision:** Use Vitest for platform unit/integration tests. Use Playwright Test for tests executed against configured target applications.

**Reason:** These are different test concerns and should not discover or execute each other's tests.

**Consequences:** Restrict Vitest `include` to `tests/unit/**/*.test.ts` and `tests/integration/**/*.test.ts`; explicitly exclude fixtures and `project-data`. Use `.test.ts` for Vitest files and `.spec.ts` for Playwright tests. The Playwright configuration must set the selected project's `testDir` so it does not scan unrelated project/test files.

## DEC-013 — Compile platform TypeScript before running the CLI

**Status:** Accepted

**Decision:** Compile `src/` into `dist/` and execute the emitted JavaScript with Node.js. Do not depend on runtime TypeScript execution for the platform CLI.

**Consequences:** `tsconfig.build.json` emits only platform source. `tsconfig.typecheck.json` uses no emit and includes platform source, `playwright.config.ts`, platform tests, runner fixtures where applicable, and project Playwright tests. Playwright loads its config and tests directly; `tsc` verifies their types separately.

## DEC-014 — Use one platform-owned, environment-driven Playwright config

**Status:** Accepted

**Decision:** Maintain one `playwright.config.ts` at the platform root. The runner passes validated absolute paths through `QA_PROJECT_CONFIG_PATH` and `QA_RUN_DIR`. The config fails fast with a clear error if either variable is missing, invalid, or points outside the allowed project/run directories. It must not silently fall back to a default project.

**Reason:** The same execution path must be used for SauceDemo and local runner fixtures. It prevents each application or fixture from inventing its own Playwright configuration.

**Playwright config responsibilities:** Set the selected `testDir`, `use.baseURL`, `outputDir`, reporters, retries, and failure artifacts based on the validated project configuration and run directory.

## DEC-015 — Keep Phase 1 configuration a strict subset of the later project schema

**Status:** Accepted

**Decision:** Phase 1 uses the same eventual field names for the basic execution settings: `projectId`, `name`, `baseUrl`, `environment`, `allowedDomains`, `testDirectory`, and `artifactDirectory`. Phase 2 adds fields rather than renaming these.

**Validation rules:** Phase 1 accepts only `local`, `development`, `demo`, and `staging` for `environment`; `production` is rejected. HTTPS is required except for `localhost`, where HTTP is permitted for local fixtures.

**Path rule:** `testDirectory` and `artifactDirectory` are relative to the project workspace; the loader resolves them to absolute paths and rejects traversal outside that workspace.

## DEC-016 — Use separate per-run artifact directories

**Status:** Accepted

**Decision:** Create one unique UTC timestamp-based run directory under the project's artifact directory. A collision-safe suffix may be added. Store `results.json`, `html-report/`, `test-output/`, and logs together inside that run directory.

**Consequences:** Keep Playwright's `outputDir` at `test-output/`; keep the HTML report folder as a sibling, not inside `test-output/`. Configure the HTML reporter with `open: 'never'` so unattended runs do not start a report server or wait for user input. Do not overwrite earlier run folders.

## DEC-017 — Separate test, run, and report-collection statuses

**Status:** Accepted

**Decision:** Model individual test results, overall execution status, and report-collection status separately.

**Initial implementation:**

- Test results: passed, failed, skipped.
- Run status: passed, failed, timed out, infrastructure error.
- Report collection: complete, partial, failed.

Flaky test handling is introduced when retries are enabled. Workflow-level states such as blocked are not implemented by the Phase 1 runner.

**Success invariant:** Never report a verified pass if the process exit code and JSON report are missing, malformed, empty, contradictory, or contain top-level Playwright run errors. A non-zero process exit remains non-success even if all individual tests show passed; parse and display top-level JSON errors to explain likely setup/teardown/worker failures. A zero-test run is `infrastructure_error` with `reason: "no_tests_found"`; the JSON report may still have been collected successfully. Every non-passed run includes a machine-readable `reason` (initial values: `test_failures` (one or more individual tests failed), `no_tests_found`, `exit_report_mismatch`, `cleanup_failed`, `runner_timeout`, `playwright_process_error`, `report_invalid`) and a separate human-readable message. If the runner-level timeout fires, run status is `timed_out`; if required JSON is absent, report status is `failed`, and timeout is the primary CLI outcome rather than a generic missing-report error. Incomplete required report collection produces a non-zero CLI exit.

## DEC-018 — Disable retries and empty-suite success in Phase 1

**Status:** Accepted

**Decision:** Set Playwright `retries: 0` for the initial engine. Do not pass `--pass-with-no-tests`. Treat zero discovered tests as an unsuccessful/invalid execution.

**Reason:** The first runner should expose the actual result without hiding first-attempt failures or accidentally treating an empty suite as success.

## DEC-019 — Use safe, cross-platform child-process management

**Status:** Accepted

**Decision:** Launch Node.js directly with `process.execPath`, a resolved Playwright CLI entry point, and an argument array; do not construct shell command strings or rely on `shell: true`.

**Termination strategy:**

- Windows: on runner timeout, invoke `taskkill /T /F /PID <pid>` and wait for the child process exit event. Manually inspect Task Manager or `tasklist` during verification for orphaned Playwright/browser processes.
- Linux/macOS: start the child in a dedicated process group; send SIGTERM to the group, wait a short grace period, then send SIGKILL if it has not exited.

Cleanup failures must be surfaced. Cross-platform logic should be isolated behind a small process-management module.

## DEC-020 — Keep target-app tests and platform tests in separate locations

**Status:** Accepted

**Decision:** Platform tests live under `tests/unit/` and `tests/integration/`. Fixture Playwright projects live under `tests/fixtures/runner-projects/`. Application-specific approved and candidate tests live under each project workspace, for example `project-data/saucedemo/tests/approved/` and `project-data/saucedemo/tests/candidates/`.

**Consequence:** Vitest must not discover runner fixtures or project Playwright specs. Playwright must execute only the `testDir` selected by the platform-owned config.

## DEC-021 — Use consistent report and process outcomes

**Status:** Accepted

**Relationship:** This decision provides the detailed process/report consistency rules that implement the separate status model established in DEC-017.

**Decision:** Parse the Playwright JSON report, including its top-level `errors` array, as well as test results and statistics. Apply an explicit result matrix rather than guessing from the process exit code alone.

**Minimum rules:**

- Exit 0 + valid report + at least one test + no top-level errors + no test failures: run may pass.
- Any test failure: run fails.
- Non-zero exit with all tests marked passed: run does not pass; parse and display top-level errors, and classify as infrastructure error when the report indicates a global/setup/teardown/worker issue or the cause otherwise cannot be verified.
- Missing/malformed JSON or zero tests: never pass; mark report collection or execution as unsuccessful.
- Exit/report disagreement: preserve both pieces of evidence, explain the discrepancy, and return non-zero from the CLI.

## DEC-022 — Keep Phase 1 reporting distinct from Phase 6 reporting

**Status:** Accepted

**Decision:** Phase 1 implements basic native JSON/HTML report collection, parsing, and CLI summaries. Phase 6 adds candidate-validation reporting, requirement/test traceability, richer evidence presentation, AI failure analysis, and candidate approval workflows.

## DEC-023 — Require candidate assertion review and repeatability checks

**Status:** Accepted for Phase 6

**Decision:** Before a generated candidate is approved, reviewers must verify that meaningful assertions trace to documented requirement text, not merely observed website behavior. Initially run the candidate in three separate executions with retries disabled and flag inconsistent outcomes as unstable. Three successful runs are evidence, not a guarantee of no future flakiness.

## DEC-024 — Add authentication support in stages

**Status:** Accepted

**Decision:** Define role profiles, environment-variable credential references, and authentication-state handling during Phase 2. Implement Playwright setup projects and role-specific `storageState` workflows when test generation and authenticated scenarios are introduced. Never commit authentication-state files or secrets.

## DEC-025 — Maintain implementation scope by phase

**Status:** Accepted

**Decision:** Phase 1 contains no AI or MCP integration. The deterministic execution engine must work without any AI model. Each task is small, tested, and reviewed before the next task begins.
