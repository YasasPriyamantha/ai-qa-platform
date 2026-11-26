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

**Status:** Superseded by DEC-028

**Supersession note:** The local-model-first requirement is superseded by DEC-028, which adopts a hosted AI provider API for model inference. The principle that paid AI usage is not mandatory without user approval remains valid.

**Original decision:** No paid AI API or paid Playwright feature is mandatory. Begin with a local model provider (candidate: Ollama) behind a replaceable provider interface. An optional hosted provider may be added later.

**Original reason:** The user's first implementation should run without required subscription/API spending while retaining the option to use a stronger provider later.

**Original consequence:** Local model capability must be experimentally validated against browser tool use and Playwright test generation before substantial AI integration work.

## DEC-007 — Run a standalone local-model/MCP feasibility spike

**Status:** Superseded by DEC-028

**Supersession note:** This local-model feasibility experiment is replaced by a hosted-API/Playwright-MCP feasibility experiment as described in DEC-028. The experimental approach, pass criteria methodology, and honest outcome reporting principles remain valid, but the experiment targets a hosted provider API rather than a local model.

**Original decision:** Run a disposable 2–4-hour proof of concept using a candidate local model, Playwright MCP, and a small client/script before committing substantial effort to Phases 3–5. The spike is separate from platform code and does not block the deterministic Phase 1 runner.

**Original reason:** The platform's central AI workflow depends on the model's ability to call browser tools and generate usable Playwright tests. This risk should be tested early.

**Original initial experiment:** Check hardware first; connect a local model to Playwright MCP; explore the SauceDemo login workflow; generate one Playwright test with requirement-linked assertions; run it independently.

**Original pass criteria:**

1. MCP connection succeeds and available tools can be discovered.
2. The model explores the agreed SauceDemo workflow within a pre-agreed tool-call budget (initial target: about 15 calls; adjust if the workflow genuinely requires more).
3. The model's claims about the page are supported by returned browser observations.
4. It produces one executable Playwright test whose expected assertions trace to supplied requirement text.
5. The test runs through Playwright Test and its actual result is recorded.
6. Model/version, hardware, response time, tool-call count, corrections, errors, and outcome are documented.

**Original outcome classification:** Green (criteria met), amber (exploration works but generation needs limited correction), or red (tool use or generation is not reliable enough). The outcome informs model choice, provider fallback, and scope; it does not silently change the zero-cost-first requirement.

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

## DEC-026 — Use custom validation for Phase 1 project configuration

**Status:** Accepted

**Decision:** Implement Phase 1 project configuration validation using custom TypeScript code without adding a schema validation library.

**Reason:** The Phase 1 configuration schema is small (7 required fields). A custom validator provides clear, field-specific error messages and avoids adding a dependency for minimal benefit at this stage. The implementation is straightforward to understand for a beginner working with AI coding assistance.

**Consequences:**

- Validation logic is explicit and testable in `src/projects/loader.ts`.
- Error messages are specific and actionable (field name + reason).
- No additional runtime dependencies are needed for Phase 1.
- When AI JSON validation is introduced in later phases, this decision may be revisited. A schema validation library (such as Zod) could be adopted if the complexity of structured output validation justifies the dependency.

**Validation rules implemented:**

1. All seven fields are required: `projectId`, `name`, `baseUrl`, `environment`, `allowedDomains`, `testDirectory`, `artifactDirectory`.
2. URL syntax validation using the URL constructor.
3. `environment` must be one of `local`, `development`, `demo`, `staging`; `production` is rejected.
4. `allowedDomains` must be a non-empty array of strings.
5. `baseUrl` hostname must appear in `allowedDomains`.
6. HTTPS required except for `localhost` (`127.0.0.1` requires HTTPS).
7. Path containment validated using `path.resolve` + `path.relative` with Windows drive-letter case normalization.
8. Test directory must exist; run directory must exist and be inside artifact directory.

## DEC-027 — Distinguish individual timedOut and interrupted Playwright test statuses

**Status:** Accepted

**Relationship:** Clarifies and amends the primary reason precedence in DEC-021.

**Decision:** Handle Playwright's individual test-level `timedOut` and `interrupted` statuses differently:

**Individual `timedOut` mapping:**
- A Playwright test that times out at the individual test level (not the runner timeout) receives status `timedOut`.
- Map `timedOut` to the normalized Phase 1 status `failed`.
- Count it as an ordinary test failure.
- Preserve the original Playwright status in diagnostic information (`originalStatus` field).
- Results in primary reason `test_failures` unless a higher-priority condition applies.

**Individual `interrupted` mapping:**
- A Playwright test marked `interrupted` indicates the worker process or execution was terminated unexpectedly (for example, SIGTERM, external kill, or internal crash).
- Do NOT count interrupted tests as ordinary test failures.
- Do NOT silently map them to `skipped`.
- Track interrupted tests separately in `ParsedReport.interruptedTests`.
- Record `tests_interrupted` as an additional finding with affected test names.

**Interrupted execution precedence:**
- If one or more tests are interrupted AND the platform's runner timeout did NOT fire:
  - Set run status to `infrastructure_error`.
  - Use primary reason `playwright_process_error`.
  - Record `tests_interrupted` as an additional finding.
  - This takes precedence over ordinary `test_failures`.

- If the platform's runner timeout DID fire:
  - Preserve `timed_out` as the run status.
  - Preserve `runner_timeout` as the primary reason.
  - Record `tests_interrupted` as an additional finding if interrupted tests appear in the JSON.

**Reason:** An interrupted test is evidence of abnormal termination, not a test logic failure. Classifying it as `infrastructure_error` with `playwright_process_error` surfaces the execution anomaly rather than hiding it as a test failure. The runner timeout remains the highest priority because the platform explicitly initiated that termination.

**Consequences:**
- The normalized Phase 1 individual test status enum remains `passed | failed | skipped`.
- Interrupted tests are tracked in a separate `interruptedTests` array, not counted in `stats.failed`.
- The amended precedence rule is: `runner_timeout` > `playwright_process_error` (spawn/exit) > `report_invalid` > `tests_interrupted` > `no_tests_found` > `test_failures` > `cleanup_failed` > `playwright_process_error` (signals/errors) > `exit_report_mismatch`.
- Note: `tests_interrupted` comes before `no_tests_found` because interrupted tests ARE discovered tests.
- An interrupted run can never become a successful or ordinary test-failure-only result.

## DEC-028 — Adopt a Hosted AI Provider API for Model Inference

**Status:** Accepted

**Decision:** Use a hosted AI provider API for model inference instead of requiring a local model. The platform itself remains locally run/local-first for its CLI, project files, documents, tests, and artifacts. Model inference is performed by an external provider when implemented.

**Reason:** The development laptop's hardware is not suitable for running the intended capable local model. A hosted provider API allows using more capable models without local hardware constraints.

**Supersedes:** This decision supersedes the local-model-first requirement in DEC-006 and replaces the local-model feasibility experiment in DEC-007 with a hosted-API/Playwright-MCP feasibility experiment.

**Constraints and implementation requirements:**

1. **API key handling:**
   - Authentication uses a platform-level API key, not project-specific application credentials.
   - No real API key may be committed, logged, placed in project configuration, or exposed in prompts or reports.
   - Secret values must be separated from project/application test credentials.
   - The API key belongs in platform-local environment configuration (e.g., `.env`), never in `project.config.json` or project-role credential fields.

2. **Provider selection (deferred):**
   - The provider and model have not yet been selected.
   - Selection must evaluate tool-calling/MCP compatibility, structured-output support, latency, context limits, reliability, pricing, rate limits, and data-handling terms.
   - Provider-specific assumptions must not be added to Phase 2 project configuration.

3. **Paid usage authorization:**
   - Paid API usage is not authorized until the user explicitly approves a spending budget and usage limits.
   - The still-valid principle from DEC-006 that paid AI usage is not mandatory without user approval is preserved.

4. **Implementation architecture:**
   - The future implementation should use a replaceable provider adapter so the platform is not coupled to one vendor.
   - Structured-output validation, mock-provider testing, explicit timeouts, error handling, rate-limit handling, and honest reporting remain important.

5. **Data handling and privacy:**
   - External inference sends selected prompt/context data to a third-party provider.
   - Data minimization and provider data-handling review are required before implementation.
   - External provider calls should be controllable and capable of being disabled.

6. **Testing:**
   - Most tests should use mock providers to avoid API costs and flakiness.
   - Real provider integration tests are reserved for specific verification.

**Consequences:**

- Phase 3 will implement a hosted provider adapter instead of a local model runtime.
- The pre-Phase 3 feasibility experiment targets a hosted API + Playwright MCP instead of a local model.
- `PROJECT_SPEC.md`, `ARCHITECTURE.md` section 3.4, and `IMPLEMENTATION_PLAN.md` Phase 3 must be aligned with this decision before Phase 3 implementation.
- The platform remains local-first for all non-inference operations; only model inference crosses the external API boundary.

## DEC-029 — Project Storage Lifecycle: Files/JSON Through Phase 5, SQLite in Phase 6

**Status:** Accepted

**Decision:** Project, document, requirement, and proposal records use file-based JSON persistence through Phase 5. Phase 6 introduces SQLite for structured operational metadata alongside file-based storage for durable documents, specs, tests, and artifacts.

**Reason:** File-based storage is simpler to inspect, debug, and version-control during early development. SQLite adds value when querying structured metadata becomes important (run history, test mappings, release comparisons). Deferring SQLite avoids premature complexity.

**Storage layout (Phase 2–5, project-scoped):**

```text
<project-workspace>/
├── project.config.json             # Project configuration
├── documents/
│   ├── sources/<sha256>.<ext>      # Immutable source snapshots
│   └── documents.json              # Document metadata registry
├── requirements/
│   ├── registry.json               # Authoritative requirement registry
│   └── proposals/<proposal-id>.json # Proposal records
├── tests/
│   ├── approved/                   # Approved test files
│   └── candidates/                 # Candidate test files (future)
└── artifacts/                      # Run artifacts
```

**Storage formats:**

- **UTF-8 JSON** with documented schemas for all registry and record files
- **Immutable snapshots:** Original document content stored by content hash (SHA-256)
- **Registry files:** Single JSON file per registry type with schema version
- **Proposal files:** One JSON file per proposal containing proposed requirements and review records

**Key invariants:**

1. Immutable snapshots are never modified after creation; new content creates new snapshots
2. Registry files include `schemaVersion` for future migration support
3. Retired requirements remain in the registry; IDs are never reused
4. Proposal files preserve the complete proposal lifecycle including reviews

**Phase 6 transition:**

- SQLite database for structured operational metadata: run history, test-requirement mappings, release comparisons, approval workflows
- File-based storage continues for: source documents, document snapshots, test files, artifacts
- Migration utilities convert existing JSON registries to SQLite as needed
- Schema versioning enables forward-compatible migrations

**Directories NOT created prematurely:**

- `requirements/releases/` — Created when release comparison is implemented (Phase 7)
- Any directories for features not yet implemented

**Consequences:**

- Phase 2–5 implementations use file I/O and JSON parsing
- Schema version fields enable non-breaking format evolution
- No external database dependencies before Phase 6
- File-based approach is transparent and Git-friendly for development

## DEC-030 — Document Reference vs. Document Registry Responsibilities

**Status:** Accepted

**Decision:** The `documents` property in `project.config.json` and the `documents.json` registry serve distinct purposes:

1. **`config.documents`** (in `project.config.json`): Declaration of source documents associated with the project
   - Specifies which documents should be tracked
   - Contains: documentId, sourcePath, format
   - Represents the *intent* - "these documents belong to this project"
   - Edited by the user when adding/removing documents from the project

2. **`documents.json`** (in `documents/documents.json`): Authoritative registry of ingested document metadata
   - Contains actual ingested version data with content hashes, snapshots, timestamps
   - Represents the *state* - "these documents have been ingested with these versions"
   - Managed by the platform during document ingestion (Task 2.4)

**Relationship during document ingestion (Task 2.4):**

1. Read document entries from `config.documents`
2. For each document reference:
   - Read content from `sourcePath`
   - Compute SHA-256 content hash
   - Create immutable snapshot at `documents/sources/<hash>.<ext>`
   - Add/update `DocumentRecord` in `documents.json` registry
3. If content differs from the last ingested version, create a new `DocumentVersion`
4. Mark previous versions as `superseded`, new version as `active`

**documentId consistency:**

- The `documentId` must match between `config.documents` and `documents.json`
- `config.documents[i].documentId` corresponds to `documents[documentId]` in the registry
- This enables linking project configuration to ingested document state

**Reason:** Separating declaration (config) from state (registry) allows:
- Users to declare documents before ingestion
- Platform to track version history independently
- Clear distinction between project setup and runtime state
- Re-ingestion to detect changes via content hash comparison

**Consequences:**

- `config.documents` is not redundant with `documents.json` - they serve different purposes
- Document ingestion reads from config.documents and writes to documents.json
- Version history is preserved in the registry, not in the config
- The config remains a simple declaration that doesn't change with each ingestion

## DEC-031 — Project ID Lowercase Slug Convention

**Status:** Accepted

**Amends:** DEC-026 (Phase 1 project ID validation)

**Decision:** Enforce a strict lowercase slug convention for project IDs.

**Format specification:**

- Pattern: `^[a-z0-9]+(?:-[a-z0-9]+)*$`
- Maximum length: 64 characters
- Windows reserved device names are rejected (case-insensitive check): `con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`
- Trailing periods and trailing spaces are rejected before the pattern check

**Examples:**

- Valid: `saucedemo`, `my-project`, `test123`, `a1b2c3`
- Invalid: `MyProject` (uppercase), `my_project` (underscore), `alpha.` (trailing period), `alpha ` (trailing space), `con` (reserved name)

**Rationale:**

1. **Case collision prevention:** Windows NTFS is case-insensitive by default. `Alpha` and `alpha` would resolve to the same directory, causing silent collisions. Lowercase-only IDs eliminate this risk.

2. **Filesystem normalization:** Windows silently strips trailing periods and spaces from directory names. `alpha.` becomes `alpha`, causing collisions and confusion. Rejecting these at validation time prevents filesystem-level surprises.

3. **Portable convention:** Lowercase alphanumeric slugs with hyphens are widely used for npm packages, URL paths, and Git repositories. The convention is familiar and works safely across operating systems.

4. **Predictable identity:** Consistent casing improves predictability. Users do not need to remember whether they used `MyProject`, `myProject`, or `my-project`.

**Implementation:**

- One shared validation function: `validateProjectIdFormat()` in `src/projects/validation.ts`
- Both Phase 1 loader (`validateConfigInMemory`) and Phase 2 service (`validateProjectId`) use this shared function
- Reserved name check uses case-insensitive regex: `/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i`
- Valid IDs that merely begin with reserved prefixes are accepted (e.g., `console`, `content`)

**Breaking change from DEC-026:**

Previously accepted IDs that violate the new convention are now rejected:

- Uppercase letters (e.g., `SauceDemo` → use `saucedemo`)
- Underscores (e.g., `my_project` → use `my-project`)
- Dots (e.g., `project.name` → use `project-name`)

**Existing projects:**

All existing project IDs comply with the new convention:

- `saucedemo` ✓
- `fixture-passing`, `fixture-failing`, `fixture-hanging`, etc. ✓

**Consequences:**

- Platform tests updated to expect lowercase slug validation
- Existing project configurations continue to work unchanged
- New projects must use lowercase slugs
- Error messages guide users toward valid formats

## DEC-032 — QA CLI Validates Phase 1 and Phase 2 Configuration Before Execution

**Status:** Accepted (revised)

**Decision:** The `npm run qa` CLI execution path validates both Phase 1 and Phase 2 configuration structure before Playwright starts. Invalid configuration stops execution with a clear error before tests run.

**Context:** Task 2.12a determined that Phase 2 configuration validation should be performed during CLI execution because:

1. Users normally edit `project.config.json` directly and invoke `npm run qa`. This is the main path through which configuration is checked.
2. `PROJECT_SPEC.md` §7.1 prohibits raw secrets in ordinary configuration files.
3. Phase 2 requires role and credential configuration to be represented safely using environment-variable names.
4. DEC-024 defers actual authenticated execution, not structural validation of configuration.

**Validation layers:**

| Layer | What is validated | When checked |
|-------|-------------------|--------------|
| Configuration structure | Phase 1 fields (baseUrl, testDirectory, etc.) and Phase 2 fields (roles, documents, credential env-var names) | During `loadPhase2ProjectConfig()` before Playwright starts |
| Credential names | Environment-variable names follow uppercase convention, no raw secrets | During configuration loading |
| Credential availability | Whether referenced environment variables are actually set | Only when authenticated workflow explicitly needs credentials (deferred) |
| Authenticated execution | Login scripts, setup projects, storageState generation | Deferred under DEC-024 |

**Implementation:**

The CLI `run` command (`src/cli/run-command.ts`) uses `loadPhase2ProjectConfig()` which:
1. Validates Phase 1 fields via the Phase 1 loader
2. Validates Phase 2 fields: role profiles, credential environment-variable names, document references
3. Rejects raw secret values in credential fields
4. Validates storageStatePath containment within project workspace
5. Rejects project-role references to platform-level `AI_PROVIDER_*` variables

**What is NOT checked during ordinary CLI execution:**

- Whether credential environment variables are actually set (checked only when authenticated execution needs them)
- Whether referenced documents exist in the document registry
- Actual login or authentication workflows

**Phase 1 backward compatibility:**

Phase 1-only configurations remain valid. The Phase 2 loader accepts configurations without roles, documents, or description fields—these Phase 2 fields are optional.

**Playwright configuration:**

The `playwright.config.ts` remains on the Phase 1 loader (`loadPlaywrightConfig()` → `loadProjectConfig()`). The CLI performs Phase 2 validation before launching Playwright, so invalid configs never reach Playwright. This separation keeps the Playwright configuration simple and avoids duplicating validation.

**Consequences:**

- Invalid Phase 2 configuration is rejected before Playwright starts.
- Error messages never include raw secret values (redacted to `[REDACTED]`).
- Credential presence is not checked during ordinary execution.
- Phase 1-only configurations continue to work.
- Authenticated execution remains deferred under DEC-024.

## DEC-033 — Role ID Format Convention

**Status:** Accepted

**Decision:** Role IDs use the pattern `^[a-z_][a-z0-9_-]*$` with a maximum length of 64 characters.

**Format specification:**

- Pattern: `^[a-z_][a-z0-9_-]*$`
- Maximum length: 64 characters
- Must start with a lowercase letter or underscore
- Remaining characters may be lowercase letters, digits, underscores, or hyphens
- Windows reserved device names are rejected (case-insensitive check): `con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`

**Valid examples:** `admin`, `standard_user`, `power-user`, `_internal`, `user123`

**Invalid examples:** `Admin` (uppercase), `123user` (starts with digit), `con` (reserved name), `user.admin` (contains dot)

**Uniqueness:** Role IDs must be unique within a project. Uniqueness is checked case-insensitively to prevent collisions on case-insensitive filesystems.

**Distinction from DEC-031 (project IDs):**

This convention differs from DEC-031's project ID pattern:

| Aspect | Project ID (DEC-031) | Role ID (DEC-033) |
|--------|---------------------|-------------------|
| Pattern | `^[a-z0-9]+(?:-[a-z0-9]+)*$` | `^[a-z_][a-z0-9_-]*$` |
| Underscores | Not allowed | Allowed |
| Start character | Lowercase letter or digit | Lowercase letter or underscore |
| Use case | Directory names, URL paths | Authentication-state filenames |

**Rationale:**

1. **Underscore support:** Existing role IDs like `standard_user` use underscores. Allowing underscores maintains backward compatibility with common naming conventions.

2. **Filesystem safety:** Role IDs are used as filenames for authentication-state files (`.auth/<role-id>.json`). The pattern ensures safe filenames on Windows and POSIX systems.

3. **Case sensitivity:** Lowercase-only IDs with case-insensitive uniqueness checks prevent collisions on Windows NTFS.

4. **Leading underscore:** Allows internal/system role IDs to be visually distinguished (e.g., `_system`, `_internal`).

**Implementation:**

- Validation function: `validateRoleIdFormat()` in `src/projects/phase2-loader.ts`
- Pattern constant: `ROLE_ID_PATTERN` in the same file
- Duplicate detection uses case-insensitive comparison

**Consequences:**

- Role IDs like `standard_user` are valid
- Role IDs are distinct from project IDs in allowed characters
- Authentication-state files are safe on all supported platforms

## DEC-034 — Multi-Provider AI API Support

**Status:** Accepted

**Decision:** The platform supports multiple AI provider APIs through direct provider adapters and a separate configurable OpenAI-compatible adapter. Multiple provider-specific API keys may coexist; no universal API key, universal API protocol, or mandatory gateway is assumed.

**Built-in direct API adapters:**

- **OpenAI:** Direct integration with OpenAI Responses API (native OpenAI adapter)
- **Anthropic Claude:** Direct integration with Anthropic Messages API
- **Google Gemini:** Direct integration with Google AI Gemini API

Model IDs (such as specific OpenAI, Anthropic, or Gemini model names) are configuration values selected per provider entry, not hardcoded in business logic or architecture.

**Configurable OpenAI-compatible adapter:**

A separate configurable adapter supports providers implementing the OpenAI-compatible Chat Completions API dialect. This adapter is distinct from the native OpenAI Responses adapter. Feature support (tool use, structured output, streaming) is verified per provider/model, not assumed from API compatibility.

**Credential architecture:**

- Multiple company-specific keys can coexist in the platform environment.
- Each configured provider ID maps to its own secret environment variable:
  - `OPENAI_API_KEY` for OpenAI
  - `ANTHROPIC_API_KEY` for Anthropic
  - `GEMINI_API_KEY` for Google Gemini
  - `AI_PROVIDER_<PROVIDER_ID>_API_KEY` for custom providers (must use reserved namespace)
- Custom provider key names outside the reserved `AI_PROVIDER_` namespace are not allowed.
- The reserved `AI_PROVIDER_` prefix enables project-role validation and Playwright child-process environment filtering to protect custom provider secrets.
- Credentials are platform secrets stored in `.env`, never in project-role configuration.
- Provider calls are disabled by default through `AI_ENABLED=false`.
- Enforcement of the default-disabled flag is implemented in Task 3.3, not yet in the current code.
- Paid API calls remain disabled until explicitly approved by the user.

**Provider extension:**

- Providers using another API protocol require a provider-specific adapter.
- Switching provider does not require changes to business/agent logic.
- No silent fallback between providers; explicit provider selection is required.

**Supersedes:** This decision extends DEC-028 by specifying the multi-provider architecture. DEC-028's core principles (hosted provider APIs, paid usage approval, platform-local for non-inference, provider-neutral interface) remain valid.

**Consequences:**

- Phase 3 implements the multi-provider adapter interface.
- `PROJECT_SPEC.md`, `ARCHITECTURE.md`, and `IMPLEMENTATION_PLAN.md` have been aligned with this decision.
- The generic `AI_PROVIDER_API_KEY` placeholder has been retired; provider-specific keys are used.
- Each provider adapter handles its own authentication, schema conversion, and error normalization.

## DEC-035 — Block Built-In Provider Key Names in Project-Role Credentials

**Status:** Accepted (not enforced at acceptance; implementation completed in Task 3.3)

**Amends:** DEC-032 (CLI validates Phase 2 config before execution)

**Decision:** In addition to the reserved `AI_PROVIDER_*` namespace established in DEC-032, the following built-in provider-specific key names shall be blocked as project-role credential environment variable references:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

**Reason:** These environment variables contain platform-level AI provider secrets. Allowing them as project-role credential references would:

1. Risk exposing provider API keys through project-level credential handling.
2. Create confusion between platform AI credentials and application test credentials.
3. Potentially log or transmit provider keys through test credential workflows.

**Specification:**

The Phase 2 loader (`loadPhase2ProjectConfig()`) shall reject configurations where any role's `credentials` values match these blocked names. The validation error message shall indicate the blocked name and explain that these are reserved for platform AI provider credentials. This check shall run alongside the existing `AI_PROVIDER_*` pattern check from DEC-032.

**Historical note:** This decision was accepted during Task 3.1 (hosted provider feasibility) before the enforcement code was written. DEC-032 established the `AI_PROVIDER_*` namespace reservation; DEC-035 adds the specific built-in provider key names as additional blocked references.

**Implementation status:** Implementation completed in Task 3.3. The Phase 2 loader (`src/projects/phase2-loader.ts`) now rejects built-in provider keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) in addition to `AI_PROVIDER_*` prefixed variables.

**Consequences:**

- Project configurations cannot reference `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GEMINI_API_KEY` as test credentials.
- Project test credentials must use a different naming pattern (e.g., `MYAPP_ADMIN_PASSWORD`).
- Platform provider keys remain isolated from project credential workflows.

## DEC-036 — Direct Official SDKs with Thin Adapters (ACCEPTED for OpenAI; PROVISIONAL for others)

**Status:** ACCEPTED for OpenAI (Task N3, 2026-11-25); PROVISIONAL for Anthropic and Google (deferred, DEC-039)

**OpenAI (Task N3):** `openai` 7.64.0 is installed (`package.json`: `^7.64.0`) and used by `src/model-providers/openai-adapter.ts` with the Responses API, `store: false` and `maxRetries: 0`. The API was checked against the installed SDK types.

**Decision:** Use direct official provider SDKs (`openai`, `@anthropic-ai/sdk`, `@google/genai`) behind provider-specific adapters, rather than a unified multi-provider SDK like Vercel AI SDK.

**Verified SDK versions (checked 2026-11-21 via npm):**

- `openai`: 7.62.0 (Responses API, requires Node ≥20 for latest features)
- `@anthropic-ai/sdk`: 1.12.0 (Messages API, TypeScript ≥5.0)
- `@google/genai`: 3.6.1 GA (replaces deprecated `@google/generative-ai`)

Actual installed versions will be verified and pinned when provider adapters are implemented (Tasks 3.4–3.6a).

**Why Vercel AI SDK was not selected:**

The Vercel AI SDK provides a unified abstraction across providers, which offers convenience but conflicts with platform requirements:

1. **Protocol separation (DEC-034):** The platform requires distinct API protocols (OpenAI Responses, Anthropic Messages, Gemini native). A unified SDK may mask these differences.

2. **Opaque continuation state:** Provider-specific thinking blocks, reasoning items, and thought signatures must be preserved exactly. Unified SDKs may normalize or discard this state.

3. **Full error visibility:** Direct SDKs expose provider-specific error codes, rate limit headers (Retry-After), and response metadata needed for accurate normalization.

4. **Feature access:** Provider-unique features (OpenAI web_search/file_search, Anthropic prompt caching, Gemini MCP support) are directly accessible without waiting for unified SDK updates.

**Responsibility clarification:**

Official SDKs provide:
- HTTP transport and connection management
- Authentication header injection
- Vendor-specific API types and serialization

Provider adapters (platform-owned) are responsible for:
- Translating between platform message contracts and provider-specific formats
- Multi-turn tool-call and tool-result message correlation
- Preserving opaque continuation state across turns
- Extracting and normalizing finish reasons, usage, errors
- Schema conversion (Task 3.2a)
- Disabling SDK automatic retries (see below)

**Retry policy ownership:**

IMPORTANT: The shared request lifecycle (Task 3.3a) is the sole owner of retry policy.

- SDK automatic retries must be disabled in provider adapters:
  - OpenAI: `maxRetries: 0`
  - Anthropic: `maxRetries: 0`
  - Google: Configure for single attempt (verify SDK documentation at implementation time)
- Provider adapters must NOT independently implement retry logic
- Adapters expose retry safety metadata (not prescriptive policy) in normalized errors
- Task 3.3a decides retries based on: provider response evidence, request acceptance ambiguity, Retry-After headers, usage budgets, and attempt limits

**Impact on Tasks 3.4–3.6a:**

Each adapter translates between platform contracts and provider API, with SDK retries disabled:

- **Task 3.4 (OpenAI adapter):** Translates to Responses API. Extracts encrypted reasoning items for continuation. Maps function_call/function_call_output correlation. Disables `maxRetries`.

- **Task 3.5 (Anthropic adapter):** Translates to Messages API. Handles tool_use/tool_result blocks. Extracts thinking/redacted-thinking for continuation. Disables `maxRetries`.

- **Task 3.5a (OpenAI-compatible adapter):** Translates to Chat Completions protocol. Maps tool_calls/tool message correlation. Configured per endpoint. Disables retries.

- **Task 3.6/3.6a (Gemini adapter):** Translates to Gemini API (Generate Content or Interactions API, to be evaluated in Task 3.6). Handles function declarations and thought signatures. Disables automatic retries.

**Gemini API selection:**

The choice between Gemini Generate Content API and Interactions API is deferred to Task 3.6, where current official documentation and capabilities will be evaluated.

**PROVISIONAL status:**

This decision remains PROVISIONAL because Task 3.0b has not yet demonstrated:
- The hosted model itself requesting page snapshots via MCP
- Generating a test candidate from observed page content

If Task 3.0b fails or reveals SDK limitations, this decision may be revisited. The contracts defined in Task 3.2 are designed to accommodate either SDK strategy.

**Consequences:**

- Each provider adapter directly depends on its official SDK
- No single unified SDK dependency
- Platform contracts (Task 3.2) remain SDK-agnostic
- Adapters own message/tool translation, NOT retry policy
- SDK version selection may be adjusted when Tasks 3.4–3.6a are implemented

## DEC-037 — Zod 4 for AI Structured-Output Schemas

**Status:** Accepted

**Decision:** Use Zod 4 as the single source of truth for AI structured-output schemas. Both provider JSON Schema generation and local runtime validation derive from the same Zod schema definition.

**Package and Version:** `zod@^4.6.7` (installed as a runtime dependency)

**Exact Resolved Version:** `4.6.7` (verified from `package-lock.json` on 2026-11-22)

**Compatibility Verification:**

| Requirement | Evidence |
|-------------|----------|
| Node.js 22.11.0 | Zod 4 requires Node ≥18 (verified in environment) |
| TypeScript 7.0.2 | Zod 4 provides TypeScript types; tested compatible |
| ESM/NodeNext | Zod 4 exports ESM (`type: 'module'`, proper `import/require` exports) |
| ES2022 build target | Compatible; Zod 4 uses modern JS features |

**Input-Side JSON Schema Generation:**

JSON Schema is generated using `z.toJSONSchema(schema, { io: "input" })`. This produces the schema that describes what the model is allowed to produce (the input to Zod parsing), not the post-transform output. This distinction matters for:

- **Optional fields:** The model may omit them; the generated schema reflects this.
- **Defaulted fields:** The model may omit them; local parsing applies the defaults.
- **Transforms:** Cannot be represented in JSON Schema; conversion returns an unsupported result rather than silently losing semantics.

The `unrepresentable: "throw"` option ensures that schemas containing types that cannot be expressed in JSON Schema (such as `z.date()` or transforms) result in a typed unsupported conversion result, rather than silently weakening constraints.

**Scope:**

- **In scope:** AI structured-output schemas for model responses (Task 3.2a and future adapter tasks)
- **Out of scope:** Phase 1 project configuration validation (unchanged per DEC-026)
- **Out of scope:** Phase 2 requirement/document schemas (not migrated as part of this task)

**Rationale:**

1. **Single source of truth:** Zod 4's native `z.toJSONSchema()` function generates JSON Schema directly from the same schema used for runtime parsing. This eliminates the risk of drift between independently maintained schema definitions.

2. **Distinct validation results:** Zod's `safeParse()` returns structured errors with path information, enabling distinct classification of invalid JSON, schema-invalid data, refusal, and incomplete output.

3. **Provider-neutral:** The canonical schema is a Zod schema; JSON Schema conversion happens per-provider with optional filtering for unsupported keywords.

4. **Future extensibility:** Zod supports complex schema compositions (unions, discriminated unions, recursive schemas) that may be needed for tool definitions.

**DEC-026 Relationship:**

DEC-026 established custom validation for Phase 1 project configuration. That decision remains unchanged. This new Zod dependency is strictly for AI structured-output schemas, not for migrating existing Phase 1/Phase 2 validation logic.

**Implementation:**

- `src/model-providers/schema.ts`: Canonical schema abstraction using Zod
- `CanonicalSchema<T>`: Generic interface wrapping a Zod schema with JSON Schema generation
- `StructuredOutputValidator`: Validates responses with distinct error categories
- Schema conversion interface for provider-specific JSON Schema adaptation

**Structured Output vs. Tool Parameter Schemas:**

The canonical-schema-only requirement applies specifically to structured output schemas (`StructuredOutputMode.schema`). These schemas define the shape of AI model responses and require local runtime validation.

Tool parameter schemas (`ToolDefinition.parameters`) have a different requirement:

- **Platform-defined tools:** Use `CanonicalSchema` to get local validation of tool arguments.
- **External tools (MCP, OpenAPI):** Use `ExternalToolSchema`, which wraps externally supplied JSON Schema with explicit provenance metadata.

This distinction exists because:

1. External tool servers (e.g., Playwright MCP) supply their parameter schemas as JSON Schema at runtime. Requiring manual Zod schema creation for every external tool is impractical.

2. Tool-call arguments returned by the model are untrusted JSON. Their validation belongs to the tool owner/orchestrator before execution, not to the structured-output validator.

3. Structured output validation ensures the AI response matches what the platform code expects. Tool argument validation ensures the tool receives valid inputs—these are different trust boundaries.

The `ExternalToolSchema` type explicitly identifies externally sourced schemas:

```typescript
interface ExternalToolSchema {
  readonly kind: 'external_json_schema';
  readonly source: string;  // e.g., 'mcp:playwright'
  readonly jsonSchema: Readonly<Record<string, unknown>>;
}
```

Plain JSON Schema objects without this wrapper are rejected. This prevents implicit acceptance of arbitrary objects while enabling MCP integration.

**Consequences:**

- Zod is a runtime dependency (2kb gzipped core)
- AI structured-output schemas are defined once in Zod, not duplicated
- Provider adapters receive JSON Schema from the canonical schema, not raw Zod schemas
- Tool parameters accept both canonical and external schemas via discriminated union
- External tool argument validation is deferred to the tool owner/orchestrator (Phase 4)
- Phase 1 and Phase 2 validators remain unchanged

## DEC-038 — Request Lifecycle, Budget Controls, and Usage Ledger

**Status:** Accepted

**Decision:** Implement a shared request lifecycle service that enforces budget controls, bounded retry, and safe diagnostics before any external provider request.

### Budget Configuration and Default-Deny Behaviour

**Location:** Budget configuration is loaded from `config/ai-budget.json` (platform-level, tracked in Git but not containing secrets).

**Default-deny:** If no valid budget configuration exists, all external provider requests are denied. The platform does not invent permissive fallback limits.

**Required fields:**

```typescript
interface BudgetConfig {
  maxTotalRequests: number;           // Per-window request count limit
  maxInputTokensPerRequest: number;   // Hard per-request input ceiling
  maxOutputTokensPerRequest: number;  // Hard per-request output ceiling
  maxCumulativeInputTokens: number;   // Window-wide input ceiling
  maxCumulativeOutputTokens: number;  // Window-wide output ceiling
  window: BudgetWindow;               // Rolling or fixed window
  costEstimate?: CostEstimateConfig;  // Optional dated pricing
}
```

### Budget Window and Reset

**Window types:** `rolling` (N hours from first request) or `fixed` (calendar-aligned).

**Reset policy:** Budget resets require explicit user action. The ledger records reset history with:
- Timestamp
- Reason (`user_requested`, `window_expired`, `budget_config_changed`)
- Previous state before reset
- Initiator

**No silent reset:** Process startup, budget load failure, or other errors do not automatically reset the ledger.

### Usage Ledger Persistence

**Path:** `.qa-platform/usage-ledger.json` (per-project, Git-ignored via `.gitignore`).

**Format:** JSON with schema version for forward compatibility.

**Atomic writes:** Uses temp-file-and-rename pattern for Windows compatibility. Never leaves a partial write visible.

**Concurrency protection:** Version-based optimistic concurrency control. Concurrent writes from separate processes receive `VERSION_CONFLICT` errors; callers must reload and retry.

**Exclusive lock-file mechanism:** Cross-process locking uses `fs.open()` with the `'wx'` (write exclusive) flag for atomic lock file creation. Lock files are stored at `<ledger-path>.lock` and contain JSON with PID, timestamp, and hostname.

**Stale-lock detection:** A lock is considered stale if older than 5 minutes (configurable). Stale locks may be forcibly removed. The check compares both the file modification time and the timestamp inside the lock content. A legitimate live lock (held by a process actively performing a read-modify-write operation) must NOT be reclaimed merely because it exceeds the threshold—the threshold exists for crashed processes, not slow operations. The lock protects only the ledger read-modify-write operation, NOT the duration of external provider requests.

**Data stored:** Request metadata only (platform request ID, provider ID, model ID, timestamps, token counts, error codes). No prompts, outputs, API keys, tool arguments, or continuation payloads.

### Retry Policy

**Single retry owner:** The lifecycle service owns retry decisions. Provider adapters must NOT implement independent retries or timeout enforcement.

**Permitted classifications:**

| `RetrySafety` | Retry Allowed | Rationale |
|---------------|---------------|-----------|
| `retryable_safe` | Yes | Request definitely did not complete |
| `retryable_with_delay` | Yes (after delay) | Rate limited; respect Retry-After |
| `retryable_ambiguous` | **NO** | Request may have been accepted |
| `unknown` | **NO** | Cannot determine safety |
| `not_retryable` | **NO** | Credentials invalid, content filtered, etc. |

**Maximum attempts:** Configurable, default 3.

**Retry-After cap:** Respects `Retry-After` headers up to a configured maximum (default 60 seconds). Longer delays are capped.

**Budget per attempt:** Every actual external attempt counts against the request budget and is recorded in the ledger.

**Per-attempt reservations:** Each outgoing retry attempt obtains its own budget reservation BEFORE making the external call. If the reservation would exceed any budget ceiling, the retry is refused and the request fails with the last error. This ensures budget protection even under retry scenarios.

**Timeout is not cancellation:** A timeout error is classified as `retryable_ambiguous`, NOT as caller cancellation. The request may have been accepted by the provider. Timeouts are NEVER automatically retried.

**No cross-provider fallback:** If a request fails for one provider, it is not automatically retried against a different provider. Cross-provider fallback requires explicit orchestrator logic.

### Cost Estimation

**Cost is an estimate, not a hard spend cap.** The platform provides cost estimates for informational purposes only.

**Requirements:**
- Pricing requires a trusted source and effective date.
- If pricing is unavailable or outdated, cost is `unknown`, not zero.
- Estimates are clearly marked as estimates in all outputs.

**Example:**

```typescript
interface CostEstimateConfig {
  inputPricePerKToken: number;
  outputPricePerKToken: number;
  pricingSource: string;    // e.g., "OpenAI pricing page"
  pricingDate: string;      // ISO 8601 date
  modelId: string;          // Model this pricing applies to
  maxEstimatedCostUsd?: number;  // Optional soft limit
}
```

### Unknown or Stale Pricing with Monetary Limits

**Invariant:** If a monetary limit (`maxEstimatedCostUsd`) is configured and model pricing is unknown or stale, the request is DENIED before the adapter is called. No configuration value may bypass this rule.

**Pricing staleness:** Pricing is considered stale if the `pricingDate` is more than 90 days old. Stale pricing is treated the same as unknown pricing when a monetary limit exists.

**Without monetary limits:** If no `maxEstimatedCostUsd` is configured:
- Cost may remain `unknown`
- Request and token ceilings must still be enforced independently
- The request may proceed without cost enforcement

This policy is NOT configurable. The `UnknownPricingPolicy` type does not apply when monetary limits are present.

### Budget Loading and Error Codes

**Single location:** Budget configuration is loaded ONLY from `config/ai-budget.json`. There is no fallback to `.qa-platform/budget.json` or any other location. The `.qa-platform/` directory is reserved for runtime data (usage ledger), not configuration.

**Error codes:**
- `BUDGET_NOT_CONFIGURED`: No budget configuration file exists. All requests denied.
- `BUDGET_INVALID`: Budget file exists but contains invalid JSON or fails validation. All requests denied.
- `BUDGET_FILE_NOT_FOUND`: Configuration file path does not exist.
- `BUDGET_FILE_READ_ERROR`: I/O error reading the configuration file.
- `BUDGET_FILE_MALFORMED_JSON`: File content is not valid JSON.
- `BUDGET_VALIDATION_ERROR`: JSON is valid but values fail validation rules.

The adapter is NEVER called for any of these failures. Validation failures surface immediately and explicitly.

### Pre-Request Gate Order

Before invoking any adapter, the lifecycle checks gates in this order:

1. `AI_ENABLED` — Provider inference enabled via `.env`
2. `PROVIDER_CONFIG` — Provider and model configuration valid
3. `API_KEY` — Matching API key present and not a placeholder
4. `CAPABILITIES` — Required provider/model capabilities supported
5. `BUDGET` — Budget available and reservation recorded

If any gate fails, the adapter is never called.

### Safe Diagnostics

Diagnostic output (`LifecycleDiagnostics`) contains only:
- Platform request ID
- Provider/model identifiers
- Timing and duration
- Error codes and retry safety
- Budget check status

Diagnostics never contain:
- API keys or authorization data
- Prompt content or model output
- Tool arguments
- Continuation payloads

**Consequences:**

- No external request without explicit budget approval
- Usage is tracked and bounded at multiple dimensions
- Failed requests due to ambiguous errors preserve at-most-once semantics
- Cost visibility exists but users must understand estimates are not guarantees
- Concurrent CLI usage detects version conflicts rather than corrupting the ledger
- Provider adapters (Tasks 3.4–3.6a) implement only translation, not lifecycle policy

## DEC-039 — MVP-First Scope Reset

**Status:** Accepted

**Date:** 2026-11-24

**Context:** By the end of Task 3.3a the provider infrastructure (`src/model-providers`, `src/provider-secrets`) had grown to about 10,000 source lines, about 40% of the platform, while no provider adapter, MCP integration or AI workflow existed. An audit of the repository found that the command-line tool reaches only about 29% of the source code, that the usage ledger built in Task 3.3a is not called by the request lifecycle, and that Task 3.3a needed six correction rounds. The product goal is a QA tool whose approved tests can run in a CI/CD pipeline. That goal was being delayed by infrastructure for future scenarios.

**Decision:** Deliver the smallest working product first and add infrastructure only when a working feature needs it.

1. **Two operating modes.** AI-assisted test authoring runs on demand and may be slow. CI execution runs only approved Playwright tests, with no AI calls, MCP exploration or usage ledger. This makes the intent of DEC-004 and DEC-008 explicit.
2. **Approved-test CI is brought forward.** A CI pipeline that builds the platform and runs approved project tests is delivered now, before the provider adapters. It is no longer deferred to Phase 8. Phase 8 keeps the local UI and release triggers.
3. **One provider first.** Phase 3 implements only the OpenAI adapter (Responses API) and a CLI AI check with one live smoke test. DEC-034 remains the target architecture. The Anthropic, Gemini and OpenAI-compatible adapters (old Tasks 3.5, 3.6 and 3.6a) are deferred until AI-generated tests have proved useful with one provider.
4. **Budget controls for the MVP.** Per-run limits from `config/ai-budget.json` (requests, input size, output tokens), enforced by the existing lifecycle gate, plus the provider's own account spend limit, are sufficient for a single user. The persistent cross-run ledger, cross-process locking and per-attempt reservation accounting from DEC-038 are frozen: the code stays, but it is not wired in or extended. Only one AI session per workspace is supported. DEC-038 is revisited only if CI or concurrent AI sessions are introduced.
5. **Task 3.0b is superseded.** Instead of rerunning the disposable spike, the first live smoke test goes through the platform's own CLI path. The first model-driven MCP exploration happens in Phase 4 inside the platform. Accepted risk: if the model still does not request page observations, this is found in Phase 4 instead of beforehand.
6. **Scope discipline.** New code must have a production caller within the same task or the next listed task. A task has at most about six acceptance criteria. Each task allows at most one correction round, and correction rounds add no new requirements. Rules are recorded in `AGENTS.md` and `docs/REVIEW_RULES.md`.

**Supersedes in part:** DEC-034 (implementation order only; the architecture is unchanged), DEC-038 (ledger, locking and cross-run budgets are frozen, not removed), and the Task 3.0b gate in the Phase 3 breakdown.

**Consequences:**

- Remaining Phase 3 work and its order are defined in `docs/PHASE_3_PLAN.md`. The original long breakdowns are archived in `docs/archive/` as historical records and are no longer instructions.
- Code already written for deferred features is kept but frozen. It is removed only by a later explicit decision.
- Phase 3 exits when the OpenAI adapter passes mock tests and one approved live smoke test runs through the platform CLI.

## DEC-040 — Playwright MCP Integration (Phase 4)

**Status:** Accepted

**Date:** 2026-11-26

**Context:** Phase 4 lets the configured AI model explore an approved website read-only through Playwright MCP. The design choices below are fixed for the whole phase (`docs/PHASE_4_PLAN.md` §3) so that P1–P4 and Phases 5–7 stay compatible. Package versions and APIs were verified in the installed packages (type definitions, `--help` output and source), not from memory.

**Decision:**

1. **Packages (verified 2026-11-26, pinned exactly in `package.json` and the lockfile):**
   - `@playwright/mcp` **0.0.86** (npm `latest`). It depends on `playwright`/`playwright-core` **1.66.0-alpha-2026-11-18**, which needs Chromium build **v1255**; the runner's `@playwright/test` 1.64.1 uses v1248. The README documents the separate install (`node node_modules/@playwright/mcp/cli.js install-browser --no-remove chromium`). `@playwright/test` is not upgraded.
   - `@modelcontextprotocol/client` **2.4.0** (MCP TypeScript SDK v2). **Reason:** its npm `latest` tag is a stable, non-prerelease 2.x (2.4.0), which is the condition in §3.1; v1 (`@modelcontextprotocol/sdk` 1.32.2) is therefore not used. The client uses the SDK's default version negotiation mode (`legacy`, plain `initialize` handshake), which starts no probe process.
   - Never `npx …@latest` at runtime.
2. **Process model.** The server is started as `process.execPath` plus the package's `cli.js` (resolved from the installed package), an argument array, no shell (DEC-019), detached into its own process group on Linux/macOS only (as the runner does). The environment comes from `createFilteredChildEnv()`, so provider API keys never reach the server or browser. The platform uses its own small stdio transport (`src/mcp/stdio-transport.ts`) that implements the SDK's `Transport` interface with the SDK's `ReadBuffer` and `serializeMessage`. The SDK's `StdioClientTransport` is not used because it hides the child process, creates no process group on Linux and signals only the direct child. Close ends the server's stdin (Playwright MCP then closes its browser and exits); if the server has not exited within 5 seconds, `terminateProcessTree()` stops the whole tree. A failed start (spawn error, early exit, or no handshake within the startup timeout, default 30 seconds) stops the process and raises an error with the exit code and the server's stderr.
3. **Browser settings (verified CLI flags):** `--headless`, `--isolated` (in-memory profile), `--browser chromium` (maps to Playwright's bundled Chromium, `chrome-for-testing`; the server's default would be the Chrome channel), `--image-responses omit`, `--allowed-origins` built from the project's `allowedDomains` (`https://<host>`; for `localhost` also `http://localhost:*`, as in DEC-015) and `--output-dir` set to the exploration's own folder, which is also the server's working directory and therefore its file-access root. The server documents that `--allowed-origins` is not a security boundary and does not affect redirects; it is extra protection only.
4. **Tool allowlist (read-only):** only `browser_navigate`, `browser_snapshot`, `browser_navigate_back` and `browser_wait_for` (exact names from the installed server's `tools/list`) are offered to the model. All other tools are not offered and are refused if requested. Interaction tools and logged-in exploration are deferred to Phase 5 (interaction policy, DEC-024 role credentials).
5. **Domain guard in platform code:** before navigate, the URL must parse, use HTTPS (HTTP only for `localhost`, DEC-015) and have a hostname in `allowedDomains`. After every tool call the page URL is checked again; off-domain stops exploration with `domain_violation`, and the off-domain content is not sent to the model.
6. **Tool definitions** are passed to the model as `ExternalToolSchema` (DEC-037, `strict: false`, schema unchanged); tool results become `ToolResultMessage` text, with MCP errors written as `Tool error: …`.
7. **AI requests** go through `executeRequest()` and the OpenAI adapter, with `config/ai-budget.json` limits and per-run in-memory counting (DEC-039), no ledger. The `ai-check` per-run counter becomes one shared helper in P3.
8. **Observation storage:** `<project-workspace>/observations/<exploration-id>/` with versioned `observations.json` and `evidence/`, git-ignored. It records project, `releaseId` (null until Phase 7), provider and model, limits and usage, stop reason, visited pages and the model summary; model statements are separate from tool evidence and cite evidence IDs.
9. **MCP element references** (for example `ref=e12`) may appear only in raw evidence files, never in the summary or any field meant to become a locator.
10. **CI stays AI-free:** no MCP or AI step in CI. Unit tests use no real MCP server; real-server tests are integration tests (`npm run test:integration`) and run locally.

**Consequences:**

- The platform's MCP server is independent of any IDE MCP configuration.
- Two Chromium builds are installed side by side until `@playwright/test` and `@playwright/mcp` use the same Playwright version.
- `@playwright/mcp` is pre-1.0 and pinned exactly; upgrading it is a deliberate change that re-checks tool names and CLI flags.
