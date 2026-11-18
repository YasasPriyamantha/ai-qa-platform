# AI QA Automation Platform — Phase 2 Mini-Task Breakdown

**Phase:** 2 — Project and workflow-document management  
**Status:** Ready for Task 2.0 after the Phase 1 checkpoint is committed and verified in the repository  
**Estimated effort:** Approximately 13.5–20.5 focused hours (revised scope; the original Phase 2 estimate was 8–14 hours)  
**Implementation style:** One bounded task at a time; inspect, implement, verify, review, report

This document turns Phase 2 of `docs/IMPLEMENTATION_PLAN.md` into small, independently reviewable tasks. Its organization follows the Phase 1 mini-task breakdown: a phase objective, task overview, standing rules, pre-phase housekeeping, and for every task an estimate, summary, copy-ready coding prompt, and completion criteria.

The prompts follow the uploaded `reliable-ai-coding` skill: inspect actual repository state and installed versions, specify observable behavior, make the smallest maintainable change, verify with executable evidence, review the complete diff, preserve user work, and report uncertainty honestly. The skill does not guarantee bug-free software.

Source documents to consult in the repository:

- `docs/PROJECT_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DECISIONS.md`
- Root `AGENTS.md` and any tool-specific instruction file actually loaded by the coding tool

---

## 1. Phase 2 objective

Build the foundations for managing multiple target-application projects independently, preserving workflow documents, and representing requirements as validated, traceable records.

At the end of Phase 2, the platform should be able to:

- Create and load separate project workspaces.
- Extend the Phase 1 project configuration without renaming or breaking its existing fields.
- Keep each project's configuration, documents, requirements, tests, and artifacts isolated.
- Ingest Markdown (`.md`) and plain-text (`.txt`) workflow documents and preserve immutable, content-addressed source snapshots, document/version/hash metadata, and section references.
- Parse the documented structured-Markdown convention deterministically into requirement records, with source line/section references and explicit diagnostics for malformed content.
- Validate parsed requirement records, including uniqueness and lifecycle rules.
- Import author-structured requirements into an authoritative registry through an explicit, all-or-nothing operation.
- Represent proposed interpretations/IDs as reviewable proposals rather than authoritative records until a human accepts them.
- Represent roles and credential references safely, without putting secret values in project configuration.
- Establish safe `.env`, `.env.example`, and authentication-state conventions.
- Provide a small local demo application with reproducible V1 and V2 behavior for later Phase 7 release-comparison/regression demonstrations.

Phase 2 is deterministic and contains no model calls, API client, MCP connection, browser exploration, or AI-generated requirements. The hosted AI API direction affects credential boundaries and future Phase 3 planning, not Phase 2's project/document/requirement behavior.

## 2. AI-provider direction and its impact on Phase 2

**User decision:** The laptop hardware is not suitable for running the intended local AI model. The planned approach is to use a hosted AI model through its provider API, authenticated with an API key.

**Decision recorded:** DEC-028 in `docs/DECISIONS.md` formally records this direction. It supersedes the local-model-first requirement in DEC-006 and replaces the local-model feasibility experiment in DEC-007 with a hosted-API/Playwright-MCP feasibility experiment. The platform itself remains locally run/local-first for its CLI, project files, documents, tests, and artifacts, but model inference will be performed by an external provider when Phase 3 is implemented. This distinction must be clear: locally stored project data does not mean that all data stays on the laptop once an external model API is used.

### What changes now

- Phase 2 remains provider-neutral in code: no model SDK, API client, model call, prompt call, or API-key loading is implemented in Phase 2.
- Phase 2 must keep two secret domains separate:
  - Project/application test credentials are referenced by environment-variable name in each project's config. Raw credential values never belong in `project.config.json`.
  - The future platform-level AI provider API key belongs in platform-local environment configuration, never in `project.config.json` or project-role credential fields.
- Task 2.10 may document a generic platform-level placeholder such as `AI_PROVIDER_API_KEY` in `.env.example`. It must not contain a real key or load/use the value in Phase 2.
- The actual provider, model, API SDK/version, key naming/mapping, data-handling terms, and usage/cost limits remain to be selected in Phase 3.
- The provider adapter should receive the key explicitly from the platform configuration boundary; do not let project configuration or test-runner environment variables become an accidental credential source.

### Required documentation alignment before Phase 3

The current Phase 0 documents may still contain the older local-model-first direction in `PROJECT_SPEC.md`, `ARCHITECTURE.md` section 3.4, and the Phase 3 plan. Task 2.0 must report these inconsistencies; it is read-only and must not silently edit them.

Before substantial Phase 3 implementation, align `PROJECT_SPEC.md`, `ARCHITECTURE.md` section 3.4, `IMPLEMENTATION_PLAN.md` Phase 3, and the feasibility-spike wording with DEC-028. Preserve still-valid principles: replaceable provider interface, structured output validation, mock providers for tests, and no secret logging.

### Revised pre-Phase-3 feasibility experiment

Replace the local-model/MCP feasibility spike with a hosted-API/MCP feasibility experiment. Before substantial work in Phases 3–5:

1. Select one candidate hosted provider/model based on API tool-calling/MCP compatibility, structured-output support, latency, context limits, reliability, pricing, rate limits, data-handling terms, and available budget.
2. Use a disposable client to connect the model to Playwright MCP; keep this experiment outside `src/`.
3. Explore the agreed SauceDemo workflow with a bounded tool-call budget (the existing initial target of about 15 calls may be retained if appropriate for the workflow).
4. Generate one Playwright test from an explicit requirement and expected outcome.
5. Run that test independently through the Phase 1 CLI/Playwright engine.
6. Record provider/model/version, API usage/cost, latency, tool-call count, corrections, browser observations, errors, and the actual test result.
7. Apply a bounded spend/call limit. Never place the API key in prompts, logs, reports, source control, or browser-visible content.

The feasibility result should be classified as green, amber, or red. If the first API/model approach is unreliable, test one alternative before reducing autonomy or considering another provider. The provider choice and the actual API integration belong to Phase 3, not Phase 2.

## 3. Phase 2 boundaries

### Included

- Project workspaces and compatible project configuration.
- File/JSON persistence layout for project, document, requirement, and proposal records.
- Project isolation and path safety.
- Immutable `.md`/`.txt` source snapshots and document metadata.
- Human-authored structured Markdown convention and deterministic parser.
- Typed requirement schema, runtime validation, registry import, stable identity, and lifecycle rules.
- Minimal proposal/review boundary for future AI or free-form interpretations.
- Role profiles and safe environment-variable credential references.
- Local environment and authentication-state conventions.
- A local V1/V2 demo application with documented behavior changes.

### Explicit non-goals

Do not implement these in Phase 2:

- Hosted AI provider SDK/client, model calls, local model runtime, or AI-based document extraction (Phase 3).
- Playwright MCP connection or browser exploration (Phase 4).
- AI requirements analyst, test planner, test generator, scenario generation, or generated tests (Phase 5).
- Candidate-test validation, candidate execution, or approval of generated test code (Phase 6).
- Release-to-release requirement comparison/regression memory (Phase 7).
- Web UI, API server, CI/CD, or scheduling (Phase 8).
- Playwright setup projects or role-specific `storageState` execution flows. DEC-024 stages those for later authenticated test workflows.
- SQLite during Phase 2. Use project-scoped files and JSON for structured project/document/requirement/proposal records through Phase 5. Phase 6 introduces SQLite and migrations for structured operational metadata; documents, specs, tests, and artifacts remain file-based.

Phase 2 may define data and review boundaries needed by later AI work, but it must not pretend that AI extraction or automation exists.

## 4. Task overview

| Task | Mini-task | Estimated effort | Code changes |
|---|---|---:|---|
| 2.0 | Phase 1 handoff and repository audit | 30–45 min | None; read-only |
| 2.1 | Data contracts, JSON storage layout, and compatible config extension | 45–75 min | Yes |
| 2.2 | Project workspace creation and loading | 1–1.5 h | Yes |
| 2.3 | Cross-project isolation and path-safety tests | 45–75 min | Yes |
| 2.4 | Immutable workflow-document snapshots and ingestion | 1–1.5 h | Yes |
| 2.5 | Structured Markdown requirement authoring convention | 45–60 min | Docs/templates |
| 2.6 | Requirement schema and deterministic validation | 1–1.5 h | Yes |
| 2.6a | Deterministic structured-Markdown parser | 1–1.5 h | Yes |
| 2.7 | Requirement identity, registry import, and lifecycle rules | 1–1.5 h | Yes |
| 2.8 | Human review boundary for proposed requirements and IDs | 45–75 min | Yes |
| 2.9 | Role profiles and safe credential references | 45–75 min | Yes |
| 2.10 | Local environment and authentication-state conventions | 45–60 min | Yes/docs |
| 2.11 | Local versioned demo application with V1/V2 behavior | 2–3 h | Yes |
| 2.12 | Phase 2 integration, security review, and exit verification | 1.5–2.25 h | Yes |

The revised task estimates total approximately **13.5–20.5 focused hours**. The original 8–14-hour estimate predates the explicit parser, registry-import path, and local V1/V2 demo-app work. Task 2.12 must record this scope expansion in `docs/IMPLEMENTATION_PLAN.md`. Re-estimate from actual implementation evidence after Task 2.0; do not compress verification or skip acceptance criteria to meet the old estimate.

## 5. Standing rules for every Phase 2 coding task

- Read the relevant Phase 0 documents (`PROJECT_SPEC.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_PLAN.md`, `DECISIONS.md`) and the repository's actual `AGENTS.md`/tool-specific instruction file.
- Follow the supplied `reliable-ai-coding` skill when it is available in the coding session. If it is not mounted in that session, follow the same inspect-first, observable-acceptance, smallest-change, verification, full-diff, and honest-reporting rules.
- Inspect repository root, branch, `git status`, and existing diffs before editing. Preserve all pre-existing user changes.
- Use PowerShell and Windows-compatible commands in this Windows repository. When commands are launched from Bash, run manual PowerShell checks inside one `powershell.exe -NoProfile -Command "..."` invocation where practical.
- Do not commit, push, deploy, delete user work, or perform irreversible operations. The user reviews and commits.
- Do not invent APIs, files, dependencies, versions, commands, requirements, or test results.
- Do not silently alter Phase 1 behavior. Existing Phase 1 configuration fields and runner behavior must remain compatible.
- Do not pull Phase 3–8 functionality into Phase 2.
- Do not expose secrets in source code, project JSON, logs, reports, prompts, test output, or final reports. Never echo secret values in error messages.
- Keep platform-level AI API credentials separate from project-level application/test credentials.
- Use Vitest for platform unit/integration tests. Do not let Vitest discover Playwright fixture or target-application `.spec.ts` files.
- Run narrow relevant tests first, then broader affected checks. Inspect the complete diff before finishing.
- When reporting Vitest, include raw summary lines (test files, total tests, duration); do not produce a manually calculated per-file results table unless investigating a specific discrepancy.
- Never delete files/folders that the current task did not create. Clean up only task-owned temporary files after confirming exact paths; preserve all pre-existing user data and run artifacts.
- If a design choice is not settled by source documents, inspect the repository, choose the smallest conventional option only when safe, record the rationale, and identify it as an implementation choice rather than an existing decision.

## 6. Pre-Phase-2 housekeeping (user-controlled checkpoint)

Before asking the coding model to run Task 2.0:

1. Review and commit the completed Phase 1 work yourself, so Phase 2 starts from a known checkpoint. Do not ask the coding model to commit on your behalf.
2. Inspect root `AGENTS.md` and tool-specific instruction files. If they still describe Phase 1 as in progress or call `npm run qa` a placeholder despite the verified Phase 1 CLI, update them only after confirming the actual repository state.
3. Reconcile the Phase 0 checklist in `docs/IMPLEMENTATION_PLAN.md` against actual completed work. Tick only items supported by evidence.
4. Keep the Phase 1 final report and current Git checkpoint available for Task 2.0.
5. The hosted API direction has been recorded in `docs/DECISIONS.md` as DEC-028, which supersedes DEC-006 and DEC-007. Task 2.0 remains read-only and should report any remaining outdated local-model wording in `PROJECT_SPEC.md`, `ARCHITECTURE.md` section 3.4, and `IMPLEMENTATION_PLAN.md` Phase 3. The remaining architecture/specification alignment with DEC-028 is required before Phase 3 implementation. The coding agent must not revert to assuming a local model is required.

---

# Task 2.0 — Phase 1 Handoff and Repository Audit

**Estimated effort:** 30–45 minutes  
**Code changes:** None; strictly read-only

## Summary

Establish the actual repository state after Phase 1. The previous report says Phase 1 is complete, but the coding agent must verify the current checkout rather than rely on a conversation summary. Inspect the implementation plan's Phase 1 status, project configuration/loader, CLI, runner, reports, tests, package scripts, repository instructions, and Git state. Identify what Phase 2 can safely reuse.

**Expected output:** A read-only handoff report, Phase 1 verification status as evidenced in the repository, Phase 2 prerequisites, provider-direction documentation mismatches, and a recommendation on whether Task 2.1 can begin.

## Copy-ready coding AI prompt

```text
Goal

Perform a strictly read-only Phase 1 handoff audit before Phase 2 implementation.

Project root: D:\ai-qa-platform

Context

This is a TypeScript/Node.js platform that runs locally and uses Playwright Test for deterministic target-application execution. Phase 1 is reported complete. The user's current direction for future AI inference is a hosted model API authenticated with a platform-level API key because the laptop cannot run the intended local model. Phase 2 itself contains no model calls or API integration.

Read:
- docs/PROJECT_SPEC.md
- docs/ARCHITECTURE.md
- docs/IMPLEMENTATION_PLAN.md
- docs/DECISIONS.md
- root AGENTS.md and any tool-specific instruction file actually used by this coding tool

Requirements

1. Confirm the actual repository root, current branch, Git status, and existing diff. Do not assume the working tree is clean.
2. Inspect the Phase 1 implementation and tests. At minimum locate:
   - project configuration types/loader/validator under src/projects/
   - root playwright.config.ts
   - CLI and execution runner
   - report parsing/status handling, including DEC-027 interrupted-test handling
   - project-data/saucedemo/
   - Vitest configuration and relevant tests
3. Inspect docs/IMPLEMENTATION_PLAN.md and report the actual Phase 1 task status recorded there.
4. Verify the existing Phase 1 project-config field names and validation behavior. Phase 2 must extend this contract, not rename it.
5. Inspect current project workspace layout and identify which Phase 2 directories/files already exist.
6. Inspect package.json, lockfile, TypeScript configs, installed dependency versions, .gitignore, and repository instructions only as relevant to Phase 2.
7. Identify existing reusable helpers for path containment, JSON validation, file hashing, file reading, and project loading. Do not implement anything.
8. Compare the repository with the Phase 2 scope in docs/IMPLEMENTATION_PLAN.md and this breakdown. Identify missing prerequisites, ambiguities, partial implementations, and any conflict caused by the older local-model-first wording in the source documents.
9. Inspect AGENTS.md for stale Phase 1 status/placeholder instructions. Compare the Phase 0 checklist with actual evidence. Report required housekeeping; do not edit because this task is read-only.
10. Distinguish verified repository facts from claims recorded in docs or prior reports.
11. Report whether DEC-006/DEC-007, PROJECT_SPEC.md, ARCHITECTURE.md section 3.4, and the Phase 3 plan still say local-model-first. Do not change them in this task. State that they must be synchronized with the user's hosted-API decision before Phase 3.

Constraints

- Strictly read-only. Do not create, edit, rename, delete, format, install, or commit anything.
- Do not modify the separate JavaScript tutorial project.
- Do not begin Phase 2 implementation or add API/provider code.

Verification

Use actual PowerShell commands and inspect their output. Do not claim tests passed unless you run them; this is an audit, so do not run destructive or modifying checks.

Final report

Provide:
- repository path, branch, and working-tree status
- Phase 1 implementation components found
- Phase 1 status recorded in IMPLEMENTATION_PLAN.md
- stale AGENTS.md/tool-instruction references, including Phase 1 status and npm run qa wording
- Phase 0 checklist items that appear outdated, with evidence needed before changing them
- reusable modules/helpers and their paths
- Phase 2 requirements already present versus missing
- AI provider-direction document mismatches that need later synchronization
- risks, ambiguities, and prerequisites
- whether Task 2.1 can safely begin
- explicit confirmation that no files were modified
```

**Completion criteria:** The current repository state and Phase 1 handoff are understood; no files are changed.

---

# Task 2.1 — Phase 2 Data Contracts and Project-Config Extension

**Estimated effort:** 45–75 minutes  
**Code changes:** Yes

## Summary

Define the Phase 2 project and requirement data contracts, the project-scoped on-disk JSON layout, and extend the existing project configuration without breaking Phase 1.

The seven Phase 1 fields remain unchanged:

- `projectId`
- `name`
- `baseUrl`
- `environment`
- `allowedDomains`
- `testDirectory`
- `artifactDirectory`

Phase 2 may add fields for project description, workflow-document references, role profiles, and credential environment-variable references. The exact optional/required shape must be based on source documents and the actual repository. Do not add provider API settings to project config, release-comparison fields, or speculative future configuration.

**Expected output:** Typed Phase 2 contracts; a documented, implemented file/JSON persistence layout; backward-compatible config validation; focused tests; and a justified storage decision recorded in `DECISIONS.md`.

## Copy-ready coding AI prompt

```text
Goal

Define the Phase 2 project data contracts and extend the existing Phase 1 project configuration compatibly.

Context

Read all four Phase 0 documents, root repository instructions, and accepted decisions—especially DEC-015 and DEC-024. Inspect actual Phase 1 config types, loader, validator, fixtures, tests, and package versions before editing.

The existing Phase 1 config fields must retain their names and meaning:
- projectId
- name
- baseUrl
- environment
- allowedDomains
- testDirectory
- artifactDirectory

The future AI integration is planned to use a hosted provider API with a platform-level API key. Phase 2 must not implement that provider or store platform credentials in project config.

Requirements

1. Inspect current Phase 1 config implementation and tests. Do not replace or duplicate it.
2. Define the smallest typed Phase 2 project configuration contract that extends the existing contract. Preserve all seven Phase 1 fields and their existing validation rules.
3. Include only fields supported by PROJECT_SPEC.md, ARCHITECTURE.md, DECISIONS.md, and the Phase 2 plan. Do not add speculative release-comparison or AI-provider settings.
4. Declare the role-profile and credential-reference shape only: role identity plus environment-variable names. Do not implement role validation in this task; Task 2.9 owns role validation. Never store passwords, tokens, cookies, or storage-state contents.
5. Define document-reference fields for immutable source snapshots and content hashes/version metadata. Coordinate with Task 2.4; do not create a second document model.
6. Define structured requirement, document-record, proposal, and review-record types from the source requirements. Keep proposals distinct from authoritative requirements. Do not implement Markdown parsing or AI extraction in this task.
7. Define and implement the initial project-scoped file/JSON persistence layout. At minimum decide and document where these records live:
   - immutable source snapshots and document metadata;
   - authoritative requirement registry, including retired records;
   - proposed requirements and review/acceptance records.
   Evaluate these candidate paths against the actual repository:
   - documents/sources/<sha256>.<ext> for immutable source snapshots;
   - documents/documents.json for document/version metadata;
   - requirements/registry.json for authoritative requirements;
   - requirements/proposals/<proposal-id>.json for proposals/review metadata.
   These are proposed paths to validate, not permission to create unrelated directories or duplicate records. Use UTF-8 JSON with documented shapes. Do not create future directories such as requirements/releases/ before needed.
8. Record the storage lifecycle in DECISIONS.md: project/document/requirement/proposal records use files/JSON through Phase 5; Phase 6 introduces SQLite and migrations for structured operational metadata. Durable documents, specs, tests, and artifacts remain file-based. Inspect the next available DEC number; do not reuse one.
9. Keep validation at the external JSON boundary. Reuse the existing validator approach unless repository evidence justifies a change.
10. Make Phase 1 configs remain valid where new fields are optional or have safe defaults. If a new field must be required, justify it from source documents and update affected fixtures deliberately.
11. Add focused tests for legacy Phase 1 config compatibility, valid Phase 2 config, invalid new fields, and secret-value rejection.

Constraints / non-goals

- Do not implement project creation/loading services yet.
- Do not implement document parsing, requirement extraction, AI/API calls, MCP, release comparison, SQLite, or UI.
- Do not change Phase 1 runner behavior or rename existing fields.
- Do not put a future AI provider API key or provider setting in project.config.json.
- Do not add a validation dependency without a demonstrated need.
- Do not commit.

Verification

Run focused Vitest tests, full relevant Vitest tests, type-check, and build. Confirm existing Phase 1 project/fixture configs still validate and the Phase 1 runner-facing contract remains unchanged.

Inspect the complete diff.

Final report

List contract changes, exact field definitions, backward-compatibility evidence, tests/commands and observed results, decision-log changes, unverified items, and risks. Distinguish implemented behavior from behavior not yet implemented.
```

**Completion criteria:** Phase 1 config compatibility is demonstrated by tests; Phase 2 data contracts are typed and validated; no future-phase behavior is implemented.

---

# Task 2.2 — Project Workspace Creation and Loading

**Estimated effort:** 1–1.5 hours  
**Code changes:** Yes

## Summary

Implement project workspace creation and loading functions under the existing project-service boundaries. Each project must have its own workspace and configuration. Creation should establish only directories required by the current Phase 2 design; do not scaffold every future-phase folder without need. Loading must validate project config through the shared validator and return a well-defined project representation.

Project IDs and workspace paths must be validated. Existing workspaces must not be overwritten.

**Expected output:** Reusable create/load project functions, tests for valid and invalid inputs, and a minimal example of creating/loading a second project without affecting SauceDemo.

## Copy-ready coding AI prompt

```text
Goal

Implement project workspace creation and loading for the AI QA Automation Platform.

Context

Read the four Phase 0 documents, root instructions, and Phase 2 contracts implemented in Task 2.1. Inspect current src/projects/ modules, Phase 1 config loader, filesystem helpers, and tests.

Requirements

1. Define public create/load functions in the existing project module structure. Follow existing naming and error-handling conventions.
2. By default, resolve the project-data root as <platform-repository-root>/project-data, not relative to the caller's current working directory. Make the root injectable through an explicit service option for tests and controlled embedding; tests must pass a temporary directory. Do not add a user-configurable arbitrary root to project JSON.
3. Validate project IDs before using them in paths. Reject path separators, traversal segments, empty values, and other invalid forms consistent with existing project ID conventions.
4. Resolve all paths using path APIs and enforce containment with path.relative-based checks that work on Windows. Do not use naive string startsWith checks.
5. Create only directories needed for the Phase 2 workspace and current config. Do not create speculative AI, MCP, release-comparison, or UI directories.
6. Write project configuration using the existing Phase 2/Phase 1-compatible schema and shared validator.
7. Never overwrite an existing project directory or project.config.json. Return a clear conflict error.
8. Project loading must resolve the selected workspace, read project.config.json, validate it, and return a typed project object with resolved workspace paths.
9. Handle missing project, missing config, malformed JSON, invalid config, permission errors, and filesystem errors with actionable messages. Do not swallow errors.
10. Keep filesystem operations testable. Use temporary directories in tests; do not write test data into the user's real project-data directory.
11. Add tests for create/load success, duplicate project creation, invalid project IDs, missing config, malformed JSON, and path traversal.

### Additional requirements from Task 2.1 review

**1. Workspace creation and configuration validation order**

The Phase 1 configuration validator (DEC-026) requires the configured `testDirectory` to exist.

When creating a new project:

- Validate the project ID and workspace/path boundaries before performing filesystem writes.
- Create the required workspace directories before invoking the complete configuration validator.
- Ensure the configured `testDirectory` exists before validation.
- Do not weaken or bypass the existing Phase 1 filesystem validation.
- Do not create unnecessary future-phase directories merely to make validation succeed.
- If workspace creation or validation fails, handle the partially created workspace safely without deleting pre-existing user data.

Explain the creation and validation sequence in the final report.

**2. Use the correct configuration loader**

Project workspace creation and loading must use the existing Phase 2 configuration loader (`src/projects/phase2-loader.ts`), which reuses the Phase 1 loader and validates Phase 2-specific fields.

Do not call the Phase 1 loader alone for the project-management `loadProject()` operation.

Important distinction:

- Project management must validate the complete Phase 2 project configuration.
- The existing `npm run qa` execution path currently uses the Phase 1 loader and validates only the seven execution fields.
- Do not change the CLI execution path in Task 2.2.
- Record this known limitation in the final report so Task 2.9 or Task 2.12 can determine whether the CLI execution path should also perform Phase 2 validation.

Add tests proving that project loading rejects invalid Phase 2 configuration while still accepting valid legacy Phase 1 configurations.

Constraints / non-goals

- Do not add SQLite or a database.
- Do not implement document ingestion or requirement extraction here.
- Do not change the existing Phase 1 execution config contract or runner.
- Do not create a UI or add CLI commands unless existing architecture requires a thin command wrapper and the task explicitly justifies it.
- Do not commit.

Verification

Run focused project-service Vitest tests, relevant existing project-config tests, full Vitest, type-check, and build. Verify the created workspace contains only intended files/directories and a duplicate create does not overwrite existing data.

Inspect the full diff.

Final report

List functions and workspace layout, path-safety behavior, error cases tested, exact commands/results, files changed, and unverified risks.
```

**Completion criteria:** Projects can be created and loaded independently; duplicate creation cannot overwrite data; path traversal is rejected and tested.

---

# Task 2.3 — Cross-Project Isolation and Path-Safety Tests

**Estimated effort:** 45–75 minutes  
**Code changes:** Yes

## Summary

Prove that two projects with different URLs, environments, documents, and configuration cannot accidentally share mutable project data or resolve paths into one another. This is a focused isolation task, not a new architecture layer. Reuse workspace and loader functions from Task 2.2.

**Expected output:** Automated tests creating two temporary projects and demonstrating configuration/data isolation, including Windows path edge cases.

## Copy-ready coding AI prompt

```text
Goal

Add deterministic tests proving project workspace isolation and path safety.

Context

Read the four Phase 0 documents, root instructions, and project workspace/configuration implementation from Tasks 2.1–2.2. Inspect existing path helpers and tests before adding code.

Requirements

1. Create two independent temporary project workspaces through the public project creation functions.
2. Give the projects different project IDs, names, base URLs, allowed domains, environments, and project-specific files.
3. Verify loading either project returns only its own config and resolved paths.
4. Verify creating or modifying a file in one project does not alter the other project's files or configuration.
5. Verify one project's testDirectory and artifactDirectory cannot resolve into another project or outside the workspace.
6. Cover path traversal, sibling-prefix paths, absolute paths, Windows drive-letter/case behavior where the existing implementation supports it, and invalid project IDs.
7. Test duplicate project IDs and existing workspace conflicts.
8. Use isolated temporary directories and clean them up safely in test teardown. Never delete user project data.
9. Keep tests deterministic and independent of public websites or external services.
10. If tests expose a real defect, make the smallest root-cause fix and add a regression assertion. Do not refactor unrelated code.

### Additional requirements from Task 2.2 review

#### 1. Consolidate path-containment logic

Task 2.2 review identified three implementations:

- `resolveAndContain()` in `src/projects/loader.ts`
- `isRelativePathContained()` in `src/projects/loader.ts`
- `isPathContained()` in `src/projects/service.ts`

Inspect their actual responsibilities.

Consolidate the underlying path-containment calculation, including Windows drive-letter case normalization, into one shared boolean helper.

Requirements:

- All three existing callers must use the shared helper.
- Each caller must retain its own path resolution and error handling.
- Preserve `ConfigValidationError` behaviour.
- Preserve `ProjectServiceError` behaviour.
- Preserve existing error messages and Phase 1 validation behaviour.
- Do not introduce a new error type solely for this refactoring.
- Avoid circular imports.
- Keep the shared helper focused on path containment rather than introducing another general-purpose validation module.

Add tests exercising the shared helper through every existing caller, not just directly.

#### 2. Phase 1 validation must have one source of truth (mandatory investigation)

Task 2.2 review found that `validateConfigInMemory()` appears only at its definition in the initial source inspection.

Inspect:

- `validateConfigInMemory()`
- `loadProjectConfig()`
- Any internal helpers called by either function.

Determine whether both functions actually share the same underlying Phase 1 non-filesystem validation implementation.

If they already share the same implementation, report the call path and do not change anything unnecessarily.

Otherwise, make `validateConfigInMemory()` the single source of Phase 1 non-filesystem validation rules, including:

- Required field presence and types.
- URL syntax.
- Environment validation.
- Allowed-domain validation.
- Other non-filesystem Phase 1 configuration rules.

Make `loadProjectConfig()` call this function before performing its filesystem-dependent checks.

Do not duplicate or independently reimplement these rules.

Preserve Phase 1 behaviour and existing error messages. Existing Phase 1 tests must pass unchanged.

#### 3. Windows-safe project IDs

Extend project-ID validation and project-isolation tests to cover:

- IDs differing only by letter case, such as `Alpha` and `alpha`.
- IDs ending in an ASCII period, such as `alpha.`.
- IDs ending in an ASCII space, such as `alpha `.
- Attempts to create two project IDs that would collide on Windows.

Inspect existing project ID conventions and all currently used IDs, including `saucedemo`.

A lowercase slug convention such as:

`^[a-z0-9]+(?:-[a-z0-9]+)*$`

is a candidate, not an automatic requirement. Justify the chosen convention and avoid restrictions beyond those needed for safe, portable project identity.

Requirements:

- Reject unsafe IDs before any filesystem operation.
- Do not rely on Windows mkdir behaviour when testing trailing periods or spaces.
- Test validation directly.
- Ensure `validateProjectId()` and the Phase 1 loader's projectId validation accept and reject the same IDs.
- Prefer one shared project-ID validation rule if practical, without introducing circular dependencies.
- Ensure the existing SauceDemo project remains valid and its QA execution still works.

Add regression tests and explain the chosen convention in the final report.

#### 4. Verification

In addition to the original Task 2.3 acceptance criteria:

- Verify two independent projects remain isolated.
- Verify both projects retain their own configuration and resolved paths.
- Verify path traversal and sibling-prefix attacks are rejected.
- Verify absolute paths cannot escape the selected workspace.
- Verify Windows drive-letter case behaviour.
- Verify the same project ID cannot be represented through conflicting filesystem names.
- Run existing Phase 1 configuration tests unchanged.
- Run the existing SauceDemo QA execution test.
- Run the complete Vitest suite, typecheck and build.

Inspect the complete diff and Git status.

Do not commit.

#### 5. Final report additions

Include:

- The previous three containment implementations and the resulting shared implementation.
- Evidence that all callers use the shared helper.
- Whether `loadProjectConfig()` now calls `validateConfigInMemory()` directly, or an explanation of the existing shared call path.
- Evidence that Phase 1 validation and error messages remain compatible.
- The selected project-ID convention and rationale.
- Tests proving consistent project-ID validation across Phase 1 and Phase 2.
- Confirmation that `saucedemo` still loads and runs.
- Remaining unverified platform-specific behaviour.

Constraints

- Do not add a new storage system or service abstraction solely for tests.
- Do not weaken existing validation.
- Do not modify the separate JavaScript tutorial project.
- Do not commit.

Verification

Run the new isolation tests repeatedly if useful, then all relevant Vitest tests, type-check, and build. Inspect test output and complete diff.

Final report

Map each isolation/path-safety requirement to a test and observed result. List platform-specific behavior not verified on Windows and any remaining risks.
```

**Completion criteria:** Automated evidence shows two projects remain isolated and path resolution cannot escape the selected workspace.

---

# Task 2.4 — Workflow-Document Ingestion and Immutable Source Records

**Estimated effort:** 1–1.5 hours  
**Code changes:** Yes

## Summary

Implement deterministic ingestion of Markdown and plain-text workflow documents by creating immutable, content-addressed snapshots inside the project workspace. Reading and hashing an external source in place is not sufficient: later edits to that source must not destroy previously ingested content.

The platform must preserve the exact ingested bytes in a project-owned snapshot, plus the original source reference and document metadata. Store snapshots under `documents/sources/<sha256>.<ext>` (or a repository-justified equivalent content-addressed path). Never overwrite an existing snapshot. If the source changes and is ingested again, create a new snapshot and metadata version while retaining the earlier snapshot. Do not rewrite or normalize source or snapshot bytes.

The source documents require version/hash preservation but do not prescribe a hash algorithm or document-version naming scheme. Inspect existing code and choose a simple, well-supported implementation; record the rationale if it is a meaningful decision.

**Expected output:** A document-ingestion service that accepts `.md` and `.txt`, rejects unsupported formats clearly, preserves the source, and returns content plus source/version/hash metadata.

## Copy-ready coding AI prompt

```text
Goal

Implement deterministic ingestion and source preservation for Markdown and plain-text workflow documents.

Context

Read the four Phase 0 documents and root instructions. Inspect current project workspace, document-reference contract from Task 2.1, project loader, and existing filesystem utilities.

The initial supported formats are .md and .txt. The original source document and source text must be preserved. Structured records must be able to refer to the source document and relevant section/heading where available.

Requirements

1. Implement document ingestion under the existing documents/project-service module boundaries.
2. Accept only supported .md and .txt extensions for this phase. Reject unsupported extensions with a clear error; do not silently parse them as text.
3. Resolve document paths relative to the selected project workspace and reject paths outside that workspace using path.relative-based containment checks.
4. Read source bytes without modifying the original file. Copy those exact bytes into a content-addressed snapshot inside the project workspace; the snapshot is the durable source used by later phases.
5. Return a typed document record containing project/document identity, original source reference, immutable snapshot-relative path, format, content, content hash (SHA-256 unless existing repository conventions justify another standard hash), and ingestion/version metadata.
6. Preserve enough source information for later requirement records to refer to the exact source and, where available, a Markdown heading/section.
7. Record a content hash for the exact source bytes. Use a standard Node.js crypto hash unless the repository has an established alternative. State the algorithm and rationale in the implementation report and decision log if appropriate.
8. Make repeated ingestion of unchanged bytes resolve to the same content-addressed snapshot. If a snapshot path already exists, verify its bytes/hash and reuse it; never overwrite it. Changed bytes must create a distinct snapshot while retaining earlier versions.
9. Do not invent semantic document versions or compare releases in this task. If a version identifier is needed, use only the smallest deterministic/source-version metadata supported by the current model and explain it.
10. Handle missing files, unreadable files, invalid paths, empty files, unsupported formats, malformed text decoding, and snapshot-write failures deliberately. Do not swallow errors.
11. Add tests using temporary .md/.txt files, including changed content and attempted path traversal.

### Additional requirements from previous task reviews

#### 1. Symbolic-link and junction safety

Task 2.3 did not verify symbolic-link traversal.

Use the shared containment utilities in `src/projects/path-safety.ts`.

For existing source files:

1. Check lexical path containment first.
2. Resolve the real project workspace path using `fs.realpath`.
3. Resolve the real source file path using `fs.realpath`.
4. Verify that the source's real path remains inside the real project workspace.
5. Reject files whose actual paths escape the selected workspace.

Apply equivalent protection to the snapshot destination directory:

- Verify that the actual `documents/sources/` directory remains inside the real project workspace.
- Do not write snapshots through a symbolic link or junction that redirects outside the workspace.
- Resolve and verify the real destination directory before writing.

Testing requirements:

- On Windows, attempt to create a directory junction pointing outside the project workspace using `fs.symlinkSync(target, linkPath, 'junction')`. Use an absolute target.
- Test that document ingestion rejects a source reached through that junction.
- Test that snapshot creation rejects a redirected snapshot destination directory.
- Also test an individual file symlink pointing outside the workspace where the environment permits it.
- If a test cannot be performed, report the exact reason and error. Do not silently mark it as passed.

Never modify original source files.

#### 2. One source of truth for the current document version

Inspect the existing `DocumentVersion`, `DocumentStatus`, and `DocumentRecord` types and all their consumers.

The existing model contains both per-version `active/superseded` status and an ordering rule where the last entry in `versions[]` is the current version.

Prefer the ordered versions list as the single source of truth:

- The last entry represents the current document version.
- Earlier entries represent historical versions.
- Remove the redundant per-version status field if no existing consumer genuinely requires it.

If status must be retained for a demonstrated reason, enforce that exactly one version is active and it is always the final entry.

Add regression tests for the chosen invariant.

Do not introduce semantic document versions, release comparison, or unnecessary lifecycle states.

Repeated ingestion of unchanged bytes must reuse the existing content-addressed snapshot.

#### 3. Atomic registry persistence

`documents/documents.json` is the authoritative registry of ingested document metadata under DEC-030.

Protect registry updates against partial or truncated writes.

Implement the following sequence:

1. Build and validate the new registry in memory.
2. Serialize the complete registry.
3. Create a uniquely named temporary file in the same directory as `documents.json`.
4. Write the complete contents to the temporary file.
5. Replace the existing registry using an appropriate filesystem replacement operation only after the temporary write succeeds.
6. Clean up only the temporary file created by the current operation when an error occurs.

Failure handling:

- If replacement fails with errors such as `EPERM` or `EBUSY`, preserve the previous registry byte-for-byte.
- Do not delete the existing registry before attempting replacement.
- Do not implement an automatic retry loop.
- Return a clear, actionable error identifying the registry update failure.
- Remove the temporary file created by the failed operation.

Add tests simulating failed registry replacement, including `EPERM` and `EBUSY`.

Verify that the original registry remains unchanged and the failed operation's temporary files are cleaned up.

#### 4. Safe and immutable snapshot writes

Do not write snapshot contents directly to their final content-addressed filenames.

For each new snapshot:

1. Calculate SHA-256 from the exact original source bytes.
2. Determine the expected snapshot path under `documents/sources/`.
3. If the snapshot already exists:
   - Read its actual bytes.
   - Verify its content hash against the expected hash.
   - Reuse it only when the bytes and hash match.
   - If verification fails, stop with a clear corrupted-snapshot error that identifies the path.
   - Never overwrite or silently repair a corrupted existing snapshot.
4. If the snapshot does not exist:
   - Write the complete source bytes to a uniquely named temporary file in the same snapshot directory.
   - Publish the completed file under its final content-addressed name only after the write succeeds.
   - Use an atomic no-overwrite publication mechanism. Do not assume ordinary `rename()` cannot overwrite an existing destination on POSIX systems.
   - If another operation creates the destination first, verify the existing snapshot and reuse it only if it matches.
5. Clean up only temporary files created by the current operation after failures.

A same-directory hard-link publication using `fs.link()` is one possible atomic create-if-absent approach, provided it is supported by the target filesystem. Another approach is acceptable if its no-overwrite behaviour is demonstrated and justified across the supported platforms.

Testing requirements:

- Matching existing snapshots are reused.
- Mismatched existing snapshots produce an explicit corruption error.
- Corrupted snapshots are never overwritten.
- Interrupted/failed temporary snapshot writing does not leave a partial file under the final hash-based name.
- Existing snapshots remain byte-for-byte unchanged.
- Concurrent destination creation or an `EEXIST` condition is handled without overwriting existing data.

#### 5. Snapshot and registry failure interaction

Consider the case where a snapshot has been successfully published but the subsequent registry update fails.

- Do not corrupt or overwrite the immutable snapshot.
- Do not destroy the previous registry.
- Report any newly created snapshot that remains unreferenced.
- Do not delete a snapshot that may already be referenced elsewhere.
- Keep the recovery behaviour explicit and limited to this task.

Do not introduce a general-purpose transaction system or database.

#### 6. Final verification

In addition to the original Task 2.4 acceptance criteria, verify:

- Exact source bytes are preserved.
- Snapshot bytes match the calculated SHA-256 hash.
- Source files remain unchanged.
- Lexical and real-path containment work.
- Symbolic-link and junction traversal is rejected where tested.
- Existing matching snapshots are reused.
- Corrupted snapshots are reported without overwriting them.
- Failed snapshot writes cannot leave truncated final snapshots.
- Failed registry replacements preserve the old registry.
- Document version ordering remains consistent.

Run focused document-service tests, relevant project tests, the full Vitest suite, typecheck, and build.

Inspect the complete diff.

Do not commit.

#### 7. Final report additions

Include:

- Symlink and junction test results, including the operating system and any unverified cases.
- The selected DocumentVersion model and justification.
- Registry atomic-write implementation and failure-test results.
- Snapshot atomic-publication implementation and no-overwrite evidence.
- Results for `EPERM`, `EBUSY`, and existing corrupted snapshots.
- Snapshot/registry failure interaction and orphaned snapshot handling.
- Exact test counts and raw Vitest summary.
- Typecheck and build results.
- Anything remaining unverified.

Constraints / non-goals

- Do not extract structured requirements in this task.
- Do not use an AI model/API or infer business rules.
- Do not modify the source document.
- Do not add PDF, DOCX, HTML, or other formats.
- Do not add SQLite or a vector database.
- Do not commit.

Verification

Run focused document-service tests, relevant project tests, full Vitest, type-check, and build. Verify original source bytes remain unchanged; snapshot bytes exactly match ingested bytes; existing snapshots are never overwritten; and re-ingesting changed source content retains both old and new snapshots.

Inspect the complete diff.

Final report

List supported formats, source-preservation behavior, metadata/hash fields and algorithm, exact test commands/results, unverified cases, and any decisions added.
```

**Completion criteria:** `.md` and `.txt` sources are ingested into immutable content-addressed snapshots; metadata points to the exact snapshot and original source; changed documents create new retained versions; path containment and byte preservation are tested.

---

# Task 2.5 — Structured Markdown Requirement Authoring Convention

**Estimated effort:** 45–60 minutes  
**Code changes:** Documentation/templates

## Summary

Define a human-readable Markdown convention for structured requirements and provide a template/example.

The source specification gives an illustrative requirement format containing an author-assigned ID, status, priority, role, description, expected result, and negative cases. Preserve this framing. Make clear that every negative case must state its expected outcome.

This task defines the authoring contract; it does not build an AI extractor or silently infer missing business rules.

**Expected output:** A concise document in the project's documentation area and a realistic example template that users can author manually.

## Copy-ready coding AI prompt

```text
Goal

Document a structured Markdown authoring convention for workflow requirements and add a reusable example template.

Context

Read PROJECT_SPEC.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, DECISIONS.md, and root instructions. Review the Phase 2 document/requirement contracts and document-ingestion behavior already implemented.

Requirements

1. Define a structured Markdown convention that preserves the source specification's terminology and intent.
2. Each requirement must have an author-assigned stable ID. State that the same requirement retains its ID across releases, new requirements receive new IDs, and retired IDs are never reused.
3. Include fields supported by PROJECT_SPEC.md, including status, priority, role where relevant, description, and expected result.
4. Define how negative cases are written. Every negative case must state both the condition and the expected outcome.
5. Explain how to represent missing, ambiguous, or contradictory expected behavior: mark it unresolved and seek clarification; do not infer a business rule from current website behavior.
6. Define the minimum heading/section structure and required/optional fields. Keep it easy for a human to write and for a deterministic parser to validate later.
7. Add one reusable template and one illustrative example. Clearly label example business rules as examples, not universal requirements. Keep syntax deliberately regular (requirement heading, named fields/sections, explicit negative-case entries) so a deterministic parser can report exact source line numbers.
8. Explain how source headings/sections should be retained so later structured records can point back to the original source.
9. Do not define AI prompt behavior, extraction heuristics, or release-comparison semantics beyond stable-ID rules already in the source docs.
10. Keep the convention consistent with the requirement schema planned for Task 2.6. If a schema decision is necessary, state it before making incompatible changes.
11. Define an explicit policy for unknown fields/sections: report a diagnostic and preserve the text; never silently discard meaningful content. Task 2.6a depends on this policy.
12. Keep lifecycle status (for example Active/Retired, as used in PROJECT_SPEC.md) separate from the unresolved marker. Unresolved describes missing/ambiguous expected behavior; it is not a lifecycle state. Release classifications (new/changed/unchanged) belong to Phase 7 and must not appear in the authoring convention.

Constraints

- Documentation/template task only unless a small necessary type correction is identified and justified.
- Do not implement AI extraction, model/API integration, or test generation.
- Do not invent domain-specific business requirements.
- Do not commit.

Additional schema-alignment constraints
- Inspect src/requirements/types.ts and src/requirements/validation.ts before writing the convention.
- Lifecycle status is active or retired only.
- Unresolved is a separate marker containing a reason, not a lifecycle status.
- expectedResult may be absent only when the requirement is marked unresolved.
- Every negative case must contain both its condition and expected outcome.
- The convention must match the existing types. Do not modify the implementation or schema during Task 2.5.
- If the convention requires a field that the existing types do not support, or exposes a mismatch with the specification, record it as an open schema question for Task 2.6.
- Support only .md and .txt documents. Document identity comes from the caller-supplied documentId, not the filename.

Verification

Check the template against the documented convention. Confirm every required field is represented and every negative case has an explicit expected-outcome example. Run documentation/link checks only if the repository has them; do not invent a documentation-check script.

Final report

List files added/changed, convention required/optional fields, example/template coverage, checks actually run, and open schema questions.
```

**Completion criteria:** A human can author a structured Markdown requirement document unambiguously, including stable IDs and explicit negative-case outcomes.

---

# Task 2.6 — Requirement Schema and Deterministic Validation

**Estimated effort:** 1–1.5 hours  
**Code changes:** Yes

## Summary

Define and implement the structured requirement schema and validate records deterministically. Validation must reject missing or duplicate IDs and malformed required fields. It must preserve source references and distinguish unresolved requirements from valid, actionable expected behavior. Do not make the validator decide whether a business rule is true.

Use the Task 2.5 convention and actual source document model. Do not introduce AI or semantic validation.

**Expected output:** Typed requirement records, runtime validation, and comprehensive unit tests for valid, invalid, unresolved, and negative-case inputs.

## Copy-ready coding AI prompt

```text
Goal

Implement the Phase 2 structured requirement schema and deterministic runtime validation.

Context

Read all four Phase 0 documents, root instructions, Task 2.5 structured Markdown convention, Task 2.4 document/source model, and Task 2.1 types. Inspect existing validation patterns and dependencies.

Requirements

1. Define a typed Requirement record that follows the documented authoring convention and PROJECT_SPEC.md. The Task 2.6a parser must produce this exact input shape; avoid a parallel parser-only representation.
2. Include a stable requirement ID, project association, title/description, expected result, lifecycle/status information, priority/role where defined by the convention, source document reference, and source section/heading reference where available.
3. Model negative cases so each has a condition and explicit expected outcome. Reject a negative case that omits its expected outcome.
4. Validate external/untrusted data at runtime. TypeScript interfaces alone are insufficient.
5. Reject missing IDs, empty/invalid IDs, duplicate IDs within a project, missing required fields, invalid field values, malformed source references, and invalid negative cases.
6. Preserve author-supplied IDs exactly according to the convention. Do not generate or silently rewrite authoritative IDs.
7. Represent missing, ambiguous, or contradictory expected behavior as unresolved rather than inventing expected results. Define the validation distinction between a structurally valid unresolved record and a record invalid because required structure is malformed.
8. Validate that each source reference points to a document belonging to the same project and to an available source/version record, using the current document model.
9. Keep categories such as functional, end-to-end, black-box, and regression out of the underlying Requirement record; the architecture assigns those labels to test scenarios in a later phase.
10. Reuse the current validation approach. Add a dependency only if repository evidence demonstrates a concrete need and record the decision.
11. Add tests for valid records, missing/duplicate IDs, invalid field types, absent expected result, negative case without expected outcome, unresolved requirements, and invalid/cross-project source references.

Notes from previous task reviews — important requirements:

1. Authoring convention
   - Follow docs/REQUIREMENTS_AUTHORING_CONVENTION.md exactly.
   - Requirement ID syntax: ^[A-Z][A-Z0-9]*-\d+$
   - Compare IDs as exact strings. Never normalize or silently rewrite them.
   - Negative cases use:
     - <condition>: <expected outcome>
   - Split on the first ": " after the list marker.
   - Status is Active or Retired only.
   - Unresolved is a separate marker containing a reason.

2. Existing implementation
   - Extend src/requirements/types.ts and
     src/requirements/validation.ts from Task 2.1.
   - Do not create a second schema or validator.
   - Inspect the actual implementation and tests before modifying them.
   - Preserve existing validation behavior unless it conflicts
     with the now-finalized authoring convention or specification.

3. Expected result and Unresolved precedence
   - A requirement containing an unresolved marker is never actionable,
     even when it also contains an Expected result section.
   - isActionable() must check the unresolved marker.
   - Preserve the expected-result text, but do not treat it as actionable.
   - Add an explicit test for a requirement containing both fields.

4. Requirement identity
   - Add projectId to Requirement.
   - Preserve author-supplied IDs exactly.
   - Validate the finalized ID regular expression.
   - Reject missing, malformed and duplicate IDs within a project.

5. Source references
   - Include documentId, the exact version hash, original heading/section
     text, and 1-based source line range where available.
   - Use contentHash as the canonical hash property, consistent with
     DocumentVersion in src/documents/types.ts.
   - Validate that the referenced documentId belongs to the same project.
   - Validate that the exact contentHash exists in that document's
     versions array in documents.json.
   - Do not accept a reference merely because the documentId exists;
     the referenced version must also exist.

6. Snapshot resolution
   - Resolve snapshot paths only through
     resolveDocumentSnapshotPath() in src/projects/storage.ts.
   - Do not create a duplicate path resolver.
   - Preserve project/workspace containment protections.

7. Validation behavior
   - Distinguish structurally invalid requirements from valid unresolved
     requirements.
   - Every negative case must have a non-empty condition and expected outcome.
   - Unknown fields and sections must follow the convention's diagnostic
     and preservation policy.
   - Do not infer missing business rules.

8. Scope
   - Do not implement the Markdown parser in Task 2.6; that is Task 2.6a.
   - Do not implement requirement registry import; that is Task 2.7.
   - Do not introduce AI, SQLite, release comparisons or test generation.
   
Constraints / non-goals

- Do not implement AI extraction or semantic interpretation.
- Do not implement test scenarios or test generation.
- Do not infer expected behavior from a website.
- Do not add release comparison or SQLite.
- Do not commit.

Verification

Run focused requirement-validator tests, document/project tests, full Vitest, type-check, and build. Confirm invalid records are rejected and unresolved-but-well-formed records remain explicitly unresolved.

Inspect the full diff.

Final report

List schema fields and validation rules, unresolved-versus-invalid behavior, tests and exact observed results, decision changes, and remaining limitations.
```

**Completion criteria:** Requirement records have a documented typed schema and runtime validation; missing/duplicate IDs and incomplete negative cases are rejected; unresolved requirements remain visible without fabricated behavior.

---

# Task 2.6a — Deterministic Structured-Markdown Parser

**Estimated effort:** 1–1.5 hours  
**Code changes:** Yes

## Summary

Parse the structured Markdown convention defined in Task 2.5 into candidate requirement records that conform to the schema defined in Task 2.6. This is deterministic parsing, not AI extraction.

The parser must preserve source document/version and section references, provide line-numbered diagnostics for malformed sections, and never invent expected behavior. A missing or ambiguous expected result must be represented as unresolved for review, while structurally malformed syntax must produce a clear diagnostic.

**Dependency:** Task 2.6 must establish the requirement type/schema and validator before Task 2.6a implements parsing against that contract.

**Expected output:** A parser service, typed parse result, line-numbered diagnostics, and tests covering multiple requirements, malformed sections, negative cases, unresolved expected results, and source references.

## Copy-ready coding AI prompt

```text
Goal

Implement a deterministic parser for the structured Markdown requirement convention. Convert authored Markdown into candidate requirement records that are accepted by the Task 2.6 validator.

Context

Read the four Phase 0 documents, root instructions, Task 2.4 immutable document snapshot model, Task 2.5 authoring convention/template, and the Requirement type/schema contract and validator from Task 2.6. Inspect existing Markdown utilities before adding dependencies.

Requirements

1. Parse only the exact structured Markdown convention documented in Task 2.5. Do not attempt general-purpose Markdown understanding.
2. Parse multiple requirement sections identified by the documented heading syntax (for example, ## REQ-012: ... ) and documented named fields/sections.
3. Produce candidate records in the same typed shape expected by the Task 2.6 runtime validator. Do not create a second competing requirement schema.
4. Preserve project ID, source document ID, immutable snapshot path/hash/version, requirement heading, section/heading reference, and source line ranges wherever available.
5. Report malformed or duplicate sections with actionable diagnostics containing line numbers and affected requirement ID/heading where known.
6. Distinguish malformed structure from unresolved business behavior:
   - malformed heading/field syntax or invalid field encoding produces a parse diagnostic;
   - missing, ambiguous, or contradictory expected behavior must never be guessed or filled in;
   - where the convention permits, emit a structurally valid unresolved candidate with an explicit unresolved status/reason so a human can clarify it.
7. Parse every negative case with its condition and explicit expected outcome. If an outcome is missing, report a line-numbered diagnostic and ensure the resulting record cannot pass the Task 2.6 validator as actionable.
8. Preserve original text and source; never rewrite the Markdown file or snapshot.
9. Make parser behavior deterministic and independent of AI, browser state, website content, or external services.
10. Handle empty documents, no requirement sections, malformed headings, missing required sections, repeated fields, unknown fields, malformed list items, and Unicode text deliberately. Follow Task 2.5's documented policy for unknown fields; do not silently discard meaningful content.
11. Add tests for one and multiple valid requirements, exact source-line references, malformed section diagnostics, duplicate IDs, missing expected result, unresolved expected result, negative cases with/without outcomes, and content containing multiple Markdown headings.
12. Keep parser output separate from authoritative requirement storage. This task only parses candidate records; Task 2.6 validates them; Task 2.7 provides the explicit import operation that registers validated records from an author's structured document. Task 2.8's proposal/review path is for AI-proposed or free-form interpretations, not for the author's own structured document.

## Additional requirements from previous task reviews

1. **Follow the finalized authoring convention**
   - Follow `docs/REQUIREMENTS_AUTHORING_CONVENTION.md` exactly.
   - Negative cases use `- <condition>: <expected outcome>`, splitting at the first `: ` after the list marker.
   - Apply the Expected result + Unresolved precedence rule.
   - Apply the unknown-field policy: report diagnostics and preserve unknown text. Never silently discard meaningful content.

2. **Document and project identity**
   - Receive `projectId`, `documentId`, and `contentHash` through the caller's project/document ingestion context.
   - Never derive these values from filenames, file paths, or requirement text.
   - Do not invent document identities or hashes.

3. **Read immutable snapshots**
   - Parse the immutable document snapshot, not the original source file.
   - Resolve the snapshot using `resolveDocumentSnapshotPath()` from `src/projects/storage.ts`.
   - Do not introduce another snapshot-path resolver.

4. **Requirement output and source references**
   - Produce exactly the existing Task 2.6 `Requirement` type. Do not create a parallel parser-only schema.
   - `SourceReference.section` and `SourceReference.lineRange` are optional in the general type, but the parser must always populate both for every successfully parsed structured requirement.
   - `section` must preserve the exact original requirement heading text.
   - `lineRange` must be 1-based and inclusive, starting at the requirement heading line and ending at the last line belonging to that requirement.
   - Add tests for exact line numbers for at least two requirements in one document, including a later requirement after a multiline section.

5. **Validation**
   - Validate parsed output using `validateRequirementsForProject()`.
   - Do not duplicate validation rules or introduce parser-only validation rules.
   - Keep unresolved requirements non-actionable, even when expected-result text is present.
   - Keep parser output separate from the authoritative requirement registry. Registry import belongs to Task 2.7.

Constraints / non-goals

- No AI/model/API calls, semantic inference, website exploration, or test generation.
- Do not invent expected outcomes or authoritative IDs.
- Do not write parser output into the authoritative registry from the parser itself; registration happens only through Task 2.7 import.
- Do not add a Markdown parsing dependency unless the documented syntax and existing utilities demonstrate a need.
- Do not commit.

Verification

Run focused parser tests, requirement-validator tests, document snapshot tests, full Vitest, type-check, and build. Demonstrate malformed sections return line-numbered diagnostics and missing expected behavior is not guessed.

Inspect the complete diff.

Final report

Describe accepted Markdown grammar, parser output contract, diagnostic format/line-number accuracy, unresolved behavior, exact commands/results, and limitations.
```

**Completion criteria:** A structured Markdown document produces candidate requirement records that pass the Task 2.6 validator when valid; malformed sections have line-numbered diagnostics; unresolved behavior remains unresolved; no AI is involved.

---

# Task 2.7 — Requirement Identity, Duplicate Detection, and Lifecycle Rules

**Estimated effort:** 1–1.5 hours  
**Code changes:** Yes

## Summary

Implement project-level requirement identity rules and lifecycle handling.

A requirement that continues across releases retains its ID; a new requirement receives a new ID; retired IDs remain in history and cannot be reused for unrelated requirements. Phase 7 will implement release-to-release comparison, so Phase 2 should enforce identity/lifecycle invariants without building a release comparator.

`PROJECT_SPEC.md` section 7.2 makes author-assigned IDs in a structured document authoritative. This task therefore also provides the explicit import operation that takes validated records parsed from an author's structured document (Task 2.6a) and registers them. Without it, no Phase 2 path turns a structured document into authoritative requirements.

**Expected output:** Deterministic requirement registry operations, an explicit structured-document import operation, and tests proving IDs cannot be duplicated or reused after retirement.

## Copy-ready coding AI prompt

```text
Goal

Implement requirement identity and lifecycle rules for a project, without implementing release comparison.

Context

Read the four Phase 0 documents, root instructions, and requirement schema/validator from Task 2.6. Pay particular attention to PROJECT_SPEC.md section 7.2 and the Phase 2 plan.

Requirements

1. Implement the smallest project-scoped requirement collection/registry needed to validate and retain requirement identity.
2. Enforce unique author-assigned requirement IDs within a project.
3. Allow an existing requirement to retain its ID when its description or expected result changes; do not derive identity from text or content hashes.
4. Allow a genuinely new requirement only with a new ID.
5. Preserve retired requirement records. Do not delete them as a way to remove them from the active set.
6. Reject attempts to reuse a retired ID for an unrelated requirement.
7. Define allowed lifecycle/status values from source documents and Task 2.5 convention. Do not add speculative states.
8. Make status transitions explicit and validate invalid transitions where the source model provides enough information. If transition rules are not specified, do not invent a complicated state machine; record the ambiguity and use minimum safe behavior.
9. Keep requirement categories out of this registry; testing-purpose categories belong to scenarios in a later phase.
10. Add tests for duplicate IDs, same-ID updates, new IDs, retirement retention, retired-ID reuse rejection, and project-level isolation.
11. Preserve source references and history metadata already supported by the current model.
12. Persist the registry in the project-scoped location agreed in Task 2.1 (for example requirements/registry.json). Write it so a failed write cannot leave a truncated registry (for example, write a temporary file in the same directory and then rename).
13. Provide an explicit import operation for a validated, author-structured document: run the Task 2.6 validator on Task 2.6a output, then register new IDs and update continuing IDs while preserving each record's source document/snapshot reference. Reject the whole import, with clear diagnostics, if any record is invalid or would reuse a retired ID; do not partially apply it.
14. Treat parse diagnostics as blocking for affected records. Unresolved-but-well-formed records may be registered, but must remain marked unresolved.
15. If an ID present in the registry is absent from a newly imported document, do not retire or delete it automatically. Report it as a finding for human attention; release-aware retirement decisions belong to Phase 7.
16. When an existing ID's content changes on import, keep the previous version's content and source reference retrievable (for example, a per-requirement history list). Keep this minimal; do not build release comparison.

## Notes from Previous Task Reviews — Mandatory Integration Requirements

These requirements carry forward from Tasks 2.4, 2.6, and 2.6a. Preserve the existing architecture and reuse implemented functionality.

### 1. Always load the project's document registry

- The import operation must always load and require the selected project's `documents/documents.json`.
- This applies even when the incoming requirement list is empty or contains no source references.
- Do not rely on the conditional document-registry loading shortcut currently used by `validateRequirementsForProject()`.
- A missing, unreadable, or invalid document registry must result in a clear import failure.
- Do not proceed with persistence when the document registry cannot be verified.

### 2. Reuse the existing atomic filesystem implementation

- Reuse the existing filesystem utilities in `src/documents/atomic-fs.ts` when persisting `requirements/registry.json`.
- Do not implement a second atomic-write or safe-write mechanism.
- Inspect the existing helper API and follow its established error-handling and failure semantics.
- A failed write must not leave a truncated or partially updated authoritative registry.

### 3. Enforce the Task 2.6a parser-result contract

Follow the documented contract on `parseRequirementContent()`:

- Any error-severity parser diagnostic blocks the entire document import.
- The import must be all-or-nothing. No requirement records may be partially applied.
- Warnings alone, such as unknown fields or sections, do not block import.
- Include non-blocking warnings in the import result/report so the user can review them.
- An unclosed fenced code block is an error and therefore blocks the entire import.

### 4. Validate before persistence and preserve exact IDs

- Validate parsed records using `validateRequirementsForProject()` before writing anything.
- Complete parsing, diagnostic checks, project-scoped validation, duplicate detection, lifecycle checks, and import planning before modifying the authoritative registry.
- Store and compare author-assigned requirement IDs as exact text.
- Do not normalize IDs, change their case, or silently rewrite their formatting.
- Preserve the existing Task 2.6 validation rules and source-reference checks.

### 5. All-or-nothing import boundary

Before writing:

1. Load the selected project's document registry.
2. Parse the structured document.
3. Reject the operation if any error-severity parser diagnostic exists.
4. Validate all candidate records against the selected project.
5. Check requirement identity, duplicate IDs, lifecycle rules, and retired-ID reuse.
6. Build the complete proposed registry update in memory.
7. Persist the completed registry using the existing atomic filesystem utility.

If any blocking step fails, the authoritative registry must remain unchanged.

Constraints / non-goals

- Do not compare two releases or classify requirements as new/changed/unchanged/retired by AI; that belongs to Phase 7.
- Do not generate IDs automatically.
- Do not implement test-to-requirement mapping.
- Do not add SQLite unless already required by a recorded accepted decision.
- Do not commit.

Verification

Run focused requirement-registry and import tests, related project/document/parser tests, full Vitest, type-check, and build. Verify retired records remain retrievable and their IDs cannot be reused; an invalid import changes nothing; a missing ID is reported, not retired; and previous versions of changed requirements remain retrievable.

Inspect the full diff.

Final report

Describe identity/lifecycle operations, exact status rules, tests/results, and lifecycle behavior intentionally deferred to Phase 7.
```

**Completion criteria:** Project-scoped stable IDs are enforced, retired records are preserved, retired IDs cannot be reused, and a validated structured document can be imported into the registry all-or-nothing.

---

# Task 2.8 — Human Review Boundary for Proposed Requirements and IDs

**Estimated effort:** 45–75 minutes  
**Code changes:** Yes

## Summary

Define how proposed structured interpretations and AI-proposed IDs enter a human review/approval process.

Phase 2 establishes the data boundary even though AI extraction belongs to Phase 5. A proposed requirement/ID (from AI or interpretation of a free-form document) must not become authoritative merely because it was generated. Requirements parsed from an author's own structured document are registered through the Task 2.7 import operation because `PROJECT_SPEC.md` treats author-assigned IDs as authoritative. The original source remains preserved; a human acceptance action is required before a proposal enters the authoritative requirement registry.

Implement only the smallest non-UI review operation needed to represent and accept/reject a proposal. Do not build a full approval dashboard or AI workflow.

**Expected output:** A proposal representation and explicit accept/reject operations with tests proving proposals do not mutate authoritative requirements until accepted.

## Copy-ready coding AI prompt

```text
Goal

Implement the minimal human-review boundary for proposed structured requirements and proposed IDs.

Context

Read all four Phase 0 documents, root instructions, DEC-024 where relevant, and Task 2.4–2.7 document/requirement models. AI extraction itself belongs to Phase 5; this task prepares the trust boundary only.

Requirements

1. Define a proposal representation that can hold proposed structured requirement data, proposed IDs where applicable, source document/version/section references, proposal status, and review metadata.
2. Clearly distinguish a proposal from an authoritative Requirement record in types and storage.
3. A proposal must not enter or mutate the authoritative requirement registry until an explicit human acceptance operation is invoked.
4. Provide minimal accept and reject operations. Record review action and relevant proposal/requirement identity using existing project data conventions.
5. Acceptance must run the normal requirement validator and stable-ID registry rules. It must fail if the proposed ID is missing, duplicated, or retired/reused.
6. Rejection must preserve original source document and enough proposal/review metadata to explain that the proposal was rejected. Do not silently delete the evidence.
7. A human may edit/correct proposed content before acceptance if current architecture supports that cleanly. Do not build an elaborate workflow engine.
8. Do not treat browser observations as business requirements. Any proposal must cite requirement source text; website observations may be separate evidence later.
9. Add tests proving: proposal creation does not create an authoritative requirement; valid acceptance does; rejection does not; invalid acceptance is blocked; duplicate/retired IDs are blocked; source references remain attached.
10. Keep review operations callable from platform code. No UI is required in Phase 2.

### Notes from Task 2.7 Review

1. **Authoritative registry boundary**
   - Proposal acceptance must modify the authoritative requirement registry only through `applyRequirementChange()` imported from `src/requirements` (the public barrel).
   - Never import internal mutation helpers directly from `src/requirements/registry.ts`.
   - Never write to `requirements/registry.json` directly.
   - Preserve Task 2.7's project, document, source-reference, identity and lifecycle validation.

2. **Proposal persistence**
   - Store proposals as individual JSON files under `requirements/proposals/<proposal-id>.json`, as specified in DEC-029.
   - Use the existing atomic file-writing utility in `src/documents/atomic-fs.ts`.
   - Keep proposal storage separate from the authoritative requirement registry.

3. **Minimal review actions**
   - Implement only `accept` and `reject` for this task.
   - Do not introduce additional review states such as `request_revision` or `defer` without a demonstrated requirement.
   - A human can edit proposed content before invoking acceptance; an additional `accept_with_changes` action is not necessary unless the existing architecture requires it.

4. **Source traceability**
   - Each proposal must preserve its source document ID, immutable content hash, and relevant section/heading and line range where available.
   - An accepted requirement must retain its source reference.
   - Do not infer missing business requirements from website observations.

5. **Acceptance and rejection**
   - Acceptance must use `applyRequirementChange()` and pass the normal requirement validator and Task 2.7 identity/lifecycle checks.
   - Invalid, duplicate or retired/reused IDs must be rejected without partially changing the authoritative registry.
   - Rejection must preserve the proposal file and its review record, including reviewer identity, timestamp and rejection reason. Never delete rejected proposal evidence.

6. **Required tests**
   - Creating a proposal does not modify the authoritative registry.
   - Accepting a valid proposal creates the authoritative requirement.
   - Rejecting a proposal does not modify the authoritative registry.
   - Invalid, duplicate and retired IDs cannot be accepted.
   - Source references remain attached after acceptance.
   - Rejected proposals and their review metadata remain persisted and retrievable.

7. **Scope restrictions**
   - No AI/model/API integration or extraction workflow.
   - No web UI or approval dashboard.
   - No SQLite or general-purpose workflow engine.
   - Do not implement Phase 5 AI agents or Phase 6 candidate-test approvals.
   - Do not commit.

Constraints / non-goals

- Do not call a model/API or create prompts for AI extraction.
- Do not implement Phase 5 agents or Phase 6 candidate-test approvals.
- Do not add a web UI, SQLite, or a general-purpose workflow engine.
- Do not commit.

Verification

Run focused proposal/review tests, requirement-registry tests, full Vitest, type-check, and build. Inspect persisted records to confirm proposals and authoritative requirements are separate.

Inspect the full diff.

Final report

Describe proposal versus authoritative states, acceptance/rejection behavior, source traceability, exact commands/results, and deferred AI/UI work.
```

**Completion criteria:** Proposed requirements and IDs cannot become authoritative without explicit human acceptance and normal validation.

---

# Task 2.9 — Role Profiles and Safe Credential References

**Estimated effort:** 45–75 minutes  
**Code changes:** Yes

## Summary

Add project-specific role profiles and authentication configuration references.

Project config may identify roles and the environment-variable names that contain credentials. It must never store raw usernames/passwords/tokens/cookies. Keep role/test credentials separate from the future platform-level AI provider API key. The exact fields should remain minimal and should follow the source specification.

This task defines configuration and validation only. Actual Playwright authentication setup is later work under DEC-024.

**Expected output:** Typed role profiles, credential-reference validation, safe example configuration, and tests that reject secret values in configuration.

## Copy-ready coding AI prompt

```text
Goal

Implement Phase 2 role profiles and safe authentication/credential references in project configuration.

Context

Read all four Phase 0 documents, root instructions, and DEC-024. Inspect Phase 2 config contract and existing validation from Tasks 2.1 onward.

Requirements

1. Own all runtime validation of role profiles declared in Task 2.1: validate role identity, required variable-name fields, and project-scoped uniqueness.
2. Keep the model minimal and aligned with PROJECT_SPEC.md. Do not invent a complex permission/authorization model.
3. Project configuration may store environment-variable names, but must not store credential values.
4. Validate role identifiers/names and referenced environment-variable names.
5. Reject or explicitly detect raw password/token/cookie/secret fields in project config. Do not echo secret values in validation errors.
6. Support multiple roles within a project and prevent accidental duplicate role identifiers.
7. Ensure roles and credential references are scoped to their project and cannot leak into another project's configuration.
8. Provide an example configuration containing placeholder variable names only; do not add real credentials.
9. Loading/validating project configuration must not require referenced credential environment variables to be present. A project must remain loadable on a machine where its test credentials are not configured.
10. Implement a separate explicit credential-presence/resolution check that a future authenticated-run workflow can call when credentials are actually needed. It must report missing variable names only, never values; do not invoke it as part of ordinary project loading.
11. Add tests for valid multiple roles, duplicate role IDs, malformed environment-variable names, project config loading when referenced variables are absent, the separate explicit presence check reporting missing variable names, and attempted raw secret storage.
12. Keep platform-level AI provider credentials entirely separate: do not put the AI provider key in project role definitions or project.config.json.
13. Record a decision only if a real unresolved design choice must be settled. Do not add an unnecessary dependency.

### Notes from Earlier Reviews — Task 2.9

1. **Reuse the existing role model**
   - Role types already exist from Task 2.1 (`src/projects/phase2-types.ts` and `src/projects/phase2-loader.ts`).
   - Extend and validate the existing types. Do not create a second role model.

2. **Validate environment-variable references**
   - Validate credential references as environment-variable names using a pattern such as `^[A-Z_][A-Z0-9_]*$`.
   - Valid names such as `API_TOKEN`, `SAUCEDEMO_STANDARD_USER` and `SAUCEDEMO_STANDARD_PASSWORD` must be accepted.
   - Do not reject a valid variable name solely because it contains words such as PASSWORD, TOKEN or SECRET.
   - Actual raw credential values must still be rejected without echoing them in errors or logs.

3. **Authentication-state paths**
   - If `storageStatePath` remains in the existing role model, validate that it resolves inside the owning project workspace using `src/projects/path-safety.ts`.
   - Do not implement Playwright login scripts, setup projects, storageState generation or authenticated test execution. These are deferred under DEC-024.

4. **Credential availability**
   - Loading and validating project configuration must not require referenced environment variables to be present.
   - Implement a separate explicit credential-presence/resolution check.
   - It must report missing variable names only, never secret values.

5. **QA CLI compatibility**
   - `npm run qa` currently uses the Phase 1 loader, which validates Phase 1 configuration fields and ignores additional Phase 2 fields.
   - The Phase 2 loader separately validates Phase 2-specific fields.
   - Report whether the QA CLI validates role configuration.
   - Do not change the Phase 1 loader or CLI unless a concrete requirement justifies it.

6. **Credential separation**
   - Project configuration stores test-account environment-variable names only, never credential values.
   - Platform-level AI provider credentials must remain separate from project-level application/test credentials.
   - No AI provider integration belongs in Task 2.9.
   
Constraints / non-goals

- Do not implement Playwright setup projects, login scripts, storageState generation, or authenticated test execution.
- Do not add a secret manager or hosted vault.
- Do not add real credentials to fixtures, docs, logs, or prompts.
- Do not commit.

Verification

Run role/config tests, project isolation tests, full Vitest, type-check, and build. Inspect example config and test output to ensure secret values are never printed.

Inspect the full diff.

Final report

List role/credential fields, validation and secret-handling behavior, tests/results, and authentication functionality intentionally deferred under DEC-024.
```

**Completion criteria:** Project roles and credential environment-variable references are represented and validated without storing or exposing secret values.

---

# Task 2.10 — Local Environment and Authentication-State Conventions

**Estimated effort:** 45–60 minutes  
**Code changes:** Yes/docs

## Summary

Establish safe local `.env` support and authentication-state storage conventions.

The source specification allows `.env` for local development only when Git-ignored, and `.env.example` with names/placeholders only. Authentication-state files may contain cookies/tokens and must be Git-ignored, access-restricted, and excluded from logs/prompts. DEC-024 defers actual role-specific Playwright setup projects and `storageState` workflows.

Because the user has chosen a hosted AI provider API-key approach, the platform-level `.env.example` may document a generic placeholder such as `AI_PROVIDER_API_KEY=`. This is only a safe template convention: Phase 2 must not load the key, make API calls, install a provider SDK, or add provider-specific wiring. The actual provider/model and provider-specific settings are selected in Phase 3.

Inspect existing `.gitignore` and environment-loading code first. Do not add a dotenv package. If local `.env` loading is needed at all in Phase 2, prefer Node's built-in support after confirming the installed Node version supports the relevant API/startup option.

**Expected output:** Verified ignore rules, a safe `.env.example` distinguishing platform AI API credentials from project role credentials, documented authentication-state conventions, and tests/checks where the repository supports them.

## Copy-ready coding AI prompt

```text
Goal

Establish safe local environment-variable and authentication-state conventions for Phase 2, including a platform-level placeholder for the future hosted AI provider API key.

Context

Read the four Phase 0 documents, root instructions, and DEC-024. Inspect current .gitignore, package scripts, environment loading, project workspace layout, installed Node version, and existing authentication-related paths.

The user has decided to use a hosted AI model API authenticated with an API key because local model execution is unsuitable for the available laptop hardware. This does not authorize API integration in Phase 2.

Requirements

1. Inspect existing environment-file handling before changing it. Determine whether local .env loading already exists and whether a dependency is necessary. Do not add dotenv without justification.
2. Ensure real .env files are Git-ignored. Preserve .env.example as a tracked template.
3. Add or update .env.example with variable names and obvious placeholders only. Include a generic platform-level placeholder such as AI_PROVIDER_API_KEY=replace-with-your-provider-api-key, clearly marked for future Phase 3 use. Do not select a provider-specific SDK or variable name in this task.
4. Keep platform-level AI provider credentials separate from project role credentials. The provider API key belongs in platform-local environment configuration, not in project.config.json or per-project role records. Project configs store only test-role environment-variable names.
5. Do not load/use AI_PROVIDER_API_KEY, make model/API calls, install a provider SDK, or wire an AI provider in Phase 2. The provider/model selection and API-client integration belong to Phase 3.
6. Ensure Playwright authentication-state files (including storageState JSON) are ignored by Git in appropriate project/run locations. Do not broadly ignore legitimate source/config files.
7. Ensure logs, reports, error messages, and any future prompt/context construction do not include project credential values, cookie/token contents, or platform provider API keys. Inspect existing code paths; make only focused fixes needed for Phase 2.
8. Document that authentication-state files are sensitive, must be stored in a restricted project/run area, must not be committed, and must not be included in prompts or ordinary logs.
9. Document the convention for role-specific state paths without implementing Playwright setup projects or state generation.
10. Document that CAPTCHA, MFA, SSO, or unsupported login interactions must be surfaced as blockers requiring user-provided setup rather than falsely reported as authenticated.
11. Verify ignore rules preserve source files and .env.example while excluding real .env and authentication-state files.
12. Confirm installed Node version and existing startup flow before using built-in .env loading. Do not add dotenv. Add tests for any new environment parsing/redaction behavior if code is changed.

**Notes from previous Task 2.9 reviews — carry into Task 2.10**

- Create or update one repository-root `.env.example`. Include `AI_PROVIDER_API_KEY=replace-with-your-provider-api-key` as a platform-level placeholder for Phase 3 only. Include example project credential variable names such as `SAUCEDEMO_USERNAME` and `SAUCEDEMO_PASSWORD`, with obvious placeholder values only. Keep the two categories clearly separated.
- Do not create or populate a real `.env` file. Ensure `.env` is Git-ignored and `.env.example` remains tracked. Do not put environment templates inside `project-data/`.
- Keep project role credentials separate from platform AI-provider credentials. Do not load `AI_PROVIDER_API_KEY`, make provider API calls, install a provider SDK, or add provider-specific wiring in Phase 2.
- Use `.auth/<role-id>.json` inside each project's workspace as the documented convention for role-specific authentication state. Make sure the corresponding paths are Git-ignored without broadly ignoring legitimate source or configuration files.
- Task 2.9 currently checks that `storageStatePath` stays inside the project workspace; it does not necessarily restrict it to `.auth/`. Do not claim that every arbitrary in-workspace path is ignored. Make the intended convention explicit and ensure the ignore rule protects the chosen location.
- Verify with `git check-ignore` using dummy paths only:
  - `.env` is ignored.
  - `.env.example` is not ignored.
  - `project-data/<project>/.auth/<role-id>.json` is ignored.
  - Legitimate source and configuration files are not accidentally ignored.
- Do not add `dotenv` without a concrete justification. Inspect the existing environment-loading behavior and installed Node version first; use built-in Node support if loading is genuinely needed and supported.
- Do not implement Playwright setup projects, login scripts, storageState generation, or authenticated test execution. DEC-024 defers those workflows.
- Authentication-state files may contain cookies and tokens. They must not be committed, logged, included in reports, or sent to AI prompts.
- Document that CAPTCHA, MFA, SSO, and unsupported authentication flows must be surfaced as blockers rather than falsely treated as successful authentication.

Constraints / non-goals

- Do not create or populate a real .env file.
- Do not create real authentication-state files or credentials.
- Do not implement browser login, Playwright setup projects, or role-specific storageState execution.
- Do not add a secret-management service.
- Do not add AI API client/provider code or load the API key in Phase 2.
- Do not commit.

Verification

Use git check-ignore or equivalent commands to verify intended paths are ignored and .env.example is not ignored. Use safe dummy paths only. Run relevant tests, type-check, and build if code changes. Inspect the complete diff.

Final report

List ignore-rule behavior, environment-template changes, separation of platform/provider and project/test credentials, documented security conventions, exact checks/results, and unverified security assumptions.
```

**Completion criteria:** Real local secrets and authentication-state files are excluded from Git and sensitive output; `.env.example` remains safe and trackable; the future provider API-key placeholder is platform-level only; actual API integration and login setup remain deferred.

---

# Task 2.11 — Local Versioned Demo Application (V1 and V2)

Status: Deferred on 2026-11-18; complete before Phase 7. If this application is not ready for Phase 5 task 13, use a different demo application for that cross-application validation. See docs/IMPLEMENTATION_PLAN.md.

**Estimated effort:** 2–3 hours  
**Code changes:** Yes

## Summary

Create a small, local-only demo web application with reproducible V1 and V2 versions. This task was added during the Phase 2 breakdown review; it is not in the original `docs/IMPLEMENTATION_PLAN.md` Phase 2 list, so Task 2.12 must record it there. It supports the project's second-demo-application goal and gives Phase 7 a controlled V1/V2 target. Do not replace it with a second public website.

The app exists to provide a controlled target whose behavior can be deliberately changed between releases. V1 and V2 must be reproducible and documented. V2 must contain at least one intentional change to existing behavior and at least one new behavior. Keep the app deliberately small; Phase 7 will use it to demonstrate release comparison and regression preservation.

SauceDemo remains the first external demo target. This local app is a separate controlled target and must not introduce SauceDemo-specific assumptions into platform core.

**Expected output:** A runnable local demo app with reproducible V1/V2 modes, concise V1/V2 workflow documents, and a clear record of the intentional behavior change and new behavior.

## Copy-ready coding AI prompt

```text
Goal

Create the small local versioned demo web application agreed for Phase 2, with reproducible V1 and V2 behavior for later Phase 7 release-regression demonstrations.

Context

Read the four Phase 0 documents, root instructions, and Phase 2 task breakdown. This breakdown adds a local demo app with reproducible V1/V2 versions, an intentional behavior change, and at least one new behavior. SauceDemo remains the first external demo app. Do not replace this app with a second public website.

Inspect repository examples/, package scripts, Node version, and existing dependencies before choosing the smallest implementation.

Requirements

1. Create the demo app in an appropriate examples/ location consistent with ARCHITECTURE.md. Keep it separate from platform source and the JavaScript tutorial project.
2. Make V1 and V2 deterministic and reproducible. Prefer a simple explicit version selector (for example, separate routes or a startup option) rather than editing source files between runs.
3. V1 must implement a small, clearly documented workflow with stable requirement IDs.
4. V2 must preserve at least one V1 workflow while introducing:
   - at least one intentional change to an existing requirement/behavior, retaining that requirement's ID;
   - at least one genuinely new behavior with a new requirement ID.
5. Provide separate V1 and V2 structured Markdown workflow documents using the Task 2.5 convention. Every requirement and negative case must state explicit expected outcomes.
6. Keep the app local-only. Bind to localhost, use safe deterministic test data, and do not expose it to the public network by default.
7. Provide simple, documented run instructions for starting/accessing V1 and V2. Prefer existing runtime capabilities and dependencies; do not add a web framework or UI library unless there is a concrete need.
8. Keep the app small and focused on demonstrating release-aware QA behavior, not building a production product. Avoid authentication unless a minimal role is genuinely needed for the chosen workflow.
9. Add a concise README explaining the app, version selection, V1/V2 differences, and exact local run commands.
10. Verify both versions can be started and reached locally and that the intentional behavior change/new behavior are observable and deterministic. If browser-based checks are practical with the existing Playwright setup, use them; otherwise provide a repeatable smoke-check procedure and state what was not automated.
11. Do not wire the app into platform core or add application-specific logic to generic services. It is a target application/fixture.
12. Keep V1/V2 requirements and app behavior aligned. Do not claim a requirement changed if only wording changed, and do not assign a new ID to a continuing requirement.
13. Run both V1 and V2 workflow documents through the Task 2.6a parser and Task 2.6 validator. Both must produce valid records with no blocking diagnostics, and continuing/changed/new IDs must match the README.
14. Any server started for verification must be stopped afterward, including on failure. Confirm no demo-app process is left running on its port.
15. Decide explicitly whether demo-app files are included in type-checking and excluded from platform build (dist/) and Vitest discovery, and report the choice. Do not let demo-app files change platform build output.

**Task 2.11 — Additional notes from previous reviews**

- Use Node's built-in `http` module. Do not add a web framework or a new dependency.
- Bind the demo server explicitly to `127.0.0.1`. Make the port configurable with a sensible default. Avoid exposing the application to the public network.
- Put the demo app under `examples/`. Keep application files out of the platform production build output (`dist/`) and out of Vitest test discovery. Do not silently exclude the application from all TypeScript checking: either include it in the existing type-check process or provide a focused example-specific type-check. Report the relevant TypeScript and Vitest configuration decisions.
- Use the exact structure documented in `docs/REQUIREMENTS_AUTHORING_CONVENTION.md`, including lifecycle status (`Active`/`Retired`) and negative cases in the `- <condition>: <expected outcome>` format.
- Run both V1 and V2 workflow documents through the existing deterministic parser and `validateRequirementsForProject()` using a properly initialized temporary project. Both should produce valid requirement records without blocking diagnostics.
- Inspect the actual validator API and project-service options before writing the test. The validator loads the temporary project's own document registry, so initialize the project and register the relevant source documents using existing project/document services. Do not create a parallel validation implementation or substitute a manually constructed registry.
- Continuing requirements retain their IDs. A changed behaviour retains the original requirement ID. A genuinely new behaviour receives a new ID. Document these mappings in the README.
- Any server started for tests or smoke checks must be stopped even when a test fails. Use `try/finally` or appropriate test cleanup hooks. Confirm the process started by the test is no longer listening on its port. Do not terminate unrelated processes. Prefer an ephemeral port for automated tests when practical to avoid port conflicts.
- Do not create a demo project workspace under the real `project-data/` directory. Task 2.12 will perform the end-to-end integration check using a temporary directory.
- Keep the demo app independent of platform-core services and avoid SauceDemo-specific assumptions.

Constraints / non-goals

- Do not modify SauceDemo or the separate JavaScript tutorial project.
- Do not implement Phase 7 release comparison.
- Do not add AI/API, MCP, database, or platform UI functionality.
- Do not introduce paid services or external runtime dependencies.
- Do not commit.

Verification

Run the app in both V1 and V2 modes using documented commands. Verify expected routes/content and intentional changed/new behavior. Run relevant platform checks if shared files or scripts changed. Inspect the full diff and ensure no platform-core code contains demo-specific selectors or rules.

Final report

List files added, exact V1/V2 start commands, workflow requirement IDs, behavior changed while retaining its ID, new behavior and new ID, observed smoke/browser test results, and unverified cases.
```

**Completion criteria:** The local demo app has reproducible V1/V2 behavior; V2 contains one real changed behavior and one new behavior; and both versions have structured source documents ready for later Phase 7 regression demonstrations.

---

# Task 2.12 — Phase 2 Integration, Security Review, and Exit Verification

**Estimated effort:** 1.5–2.25 hours  
**Code changes:** Yes, only for genuine Phase 2 defects

## Summary

Verify all Phase 2 components together, close only genuine Phase 2 defects, inspect the complete diff, and update `docs/IMPLEMENTATION_PLAN.md` with actual results and effort.

The exit criteria come from the source plan plus the agreed local-demo addition: two independent projects with different URLs/documents; validated structured requirement records with stable IDs; immutable source snapshots; safe role/credential configuration; and a reproducible local V1/V2 target for later release-regression demonstrations. AI extraction remains deferred to Phase 5; hosted API integration remains deferred to Phase 3.

**Expected output:** A Phase 2 evidence report and an explicit complete/incomplete decision. No commit.

## Copy-ready coding AI prompt

```text
Goal

Perform final Phase 2 integration, regression, security, and exit-criteria verification.

Context

Read the four Phase 0 documents, root repository instructions, all Phase 2 implementation, and Phase 1 implementation. This is an integration/verification task, not a redesign. The user's future AI direction is hosted API-key authentication, but Phase 2 contains no provider SDK or model/API calls.

Requirements

1. Inspect Git status and the complete diff before editing. Preserve pre-existing user changes.
2. Verify the Phase 1 config contract is unchanged and existing Phase 1 execution behavior remains compatible.
3. Verify project creation/loading and two-project isolation using different URLs, environments, documents, and requirements.
4. Verify workspace and document path containment, including traversal and sibling-prefix cases.
5. Verify Markdown and plain-text ingestion creates immutable content-addressed snapshots, preserves original source bytes, and records source/version/hash metadata.
6. Verify structured Markdown convention and template match the actual requirement schema, and the deterministic parser produces records with accurate source references and line-numbered diagnostics.
7. Verify requirement runtime validation, including missing/duplicate IDs, malformed fields, explicit expected outcomes, and negative-case expected outcomes.
8. Verify unresolved requirements remain explicitly unresolved rather than receiving invented expected behavior.
9. Verify stable IDs are preserved, retired IDs remain in history, and retired IDs cannot be reused.
10. Verify proposed requirements/IDs remain separate from authoritative requirements until explicit human acceptance.
11. Verify role profiles and project credential environment-variable references are scoped to each project.
12. Verify raw secrets are not stored in project JSON, logs, reports, prompts, or test output. Verify the future platform API-key placeholder is only in platform-local environment template/configuration, not project config.
13. Verify `.env` is ignored, `.env.example` is not ignored, and authentication-state files are ignored without excluding legitimate source files.
14. Verify the documented authentication-state convention is present and no Playwright login/setup-project behavior was pulled into Phase 2.
15. Verify local demo app V1 and V2 modes, including intentional changed behavior and new behavior.
16. Run all relevant Vitest tests, type-check, and build. Confirm Vitest still excludes Playwright fixture/project specs.
17. Inspect test results and full diff for unsafe path handling, accidental overwrites, secret leakage, duplicate validation logic, silent error handling, and unrelated refactors.
18. Fix only genuine Phase 2 defects. Record Phase 3–8 items as deferred rather than implementing them.
19. Using temporary directories only, run one end-to-end check: create a project workspace, ingest the demo app's V1 structured document, parse it, validate it, and import it into that project's registry. Do not write this check's data into the real project-data directory.
20. Update docs/IMPLEMENTATION_PLAN.md with actual task status, actual effort where known, verification evidence, limitations, and deferred work. Record that Phase 2 scope was expanded with Tasks 2.6a and 2.11 and the registry import operation, and record the revised estimate.
21. Report the status of the hosted-API decision synchronization. Do not implement the provider/API client in Phase 2. Identify any stale local-model-first wording that must be updated before Phase 3.

Phase 2 exit criteria

- Two projects can be created with different URLs and documents without mixing settings or requirements.
- Project workspace creation/loading works and paths remain within the correct workspace.
- Markdown and plain-text source documents are preserved as immutable content-addressed snapshots with version/hash metadata and source references.
- A structured document convention is documented; a deterministic parser converts it into requirement records with line-numbered diagnostics; parsed records validate; and a validated document can be imported into the project registry all-or-nothing.
- Missing/duplicate IDs and invalid requirement structures are rejected.
- Stable author-assigned IDs are retained; retired IDs are not reused.
- AI-proposed IDs/interpretations remain proposals until human review/acceptance. No AI extraction is claimed in this phase.
- Role and credential configuration is represented safely using environment-variable names, not secret values; missing environment variables do not prevent ordinary project loading.
- The local demo app provides reproducible V1/V2 versions, at least one changed behavior retaining its requirement ID, and at least one new behavior with a new ID.
- Project/document/requirement/proposal metadata uses agreed file/JSON layout through Phase 5; SQLite is deferred to Phase 6.
- `.env` and authentication-state security conventions are enforced and documented.
- Platform-level AI API credential convention is separate from project/test credentials; no AI provider is integrated in Phase 2.
- Existing Phase 1 behavior remains compatible.

Constraints

- No hosted provider SDK/API calls, local model/provider integration, Playwright MCP, AI extraction, test planning/generation, candidate execution/approval, release comparison, SQLite, web UI, CI/CD, or scheduling.
- Do not weaken/delete assertions to make tests pass.
- Preserve all pre-existing user changes.
- Do not commit, push, or deploy.

Verification

Run and record exact commands and observed outputs for:
- build
- type-check
- full Vitest suite
- project creation/loading and cross-project isolation tests
- document ingestion/hash/source-preservation tests
- structured-Markdown parser tests, including line-numbered diagnostics
- requirement validation, registry import, and identity/lifecycle tests
- proposal accept/reject tests
- role/config and secret-handling tests
- local demo app V1/V2 start/stop and behavior checks
- temporary-directory end-to-end check (workspace, ingest, parse, validate, import)
- .gitignore checks

If any check cannot run, state exactly why and what remains unverified.

Inspect the complete final Git diff and map every exit criterion to code/test/document evidence.

Final report

State Phase 2 complete or incomplete; provide an exit-criteria checklist with evidence; group changed files by component; list exact commands/results; report security or compatibility risks; identify deferred Phase 3–8 work; update implementation-plan status; and suggest a Git commit message. Do not declare completion unless every exit criterion is supported by evidence.
```

**Completion criteria:** Every Phase 2 exit criterion has concrete repository/test/document evidence. If any criterion is unverified or fails, Phase 2 remains incomplete.

---

## 7. Recommended execution order

1. Complete the user-controlled Phase 1 checkpoint/housekeeping above.
2. Task 2.0 — read-only handoff audit.
3. Resolve any housekeeping prerequisites reported by Task 2.0; keep the audit itself read-only.
4. Task 2.1 — data contracts, file/JSON layout, and backward-compatible config extension.
5. Task 2.2 — workspace creation/loading.
6. Task 2.3 — cross-project isolation proof.
7. Task 2.4 — immutable source snapshots and document ingestion.
8. Task 2.5 — structured Markdown authoring convention.
9. Task 2.6 — requirement schema and runtime validation.
10. Task 2.6a — deterministic Markdown parser against the established Task 2.6 schema.
11. Task 2.7 — stable identity, registry import, and lifecycle.
12. Task 2.8 — human review boundary for proposals.
13. Task 2.9 — role profiles and safe credential references.
14. Task 2.10 — local environment/authentication-state and platform API-key placeholder conventions.
15. Task 2.11 — local V1/V2 demo application.
16. Task 2.12 — integration and Phase 2 exit verification.

Do not paste the entire breakdown into the coding agent as one implementation request. Give it only the current task prompt. Review the report, changed files, tests, and full diff before moving on. Commit a reviewed checkpoint yourself when satisfied.

## 8. Phase 2 scope guardrails and handoff to later phases

| Concern | Phase 2 outcome | Deferred phase |
|---|---|---|
| Project configuration | Extend existing schema compatibly | Later release metadata as needed |
| Project workspaces | Create/load and isolate projects | UI management in Phase 8 |
| Workflow documents | Snapshot `.md`/`.txt` immutably; retain hashes and source refs | AI interpretation in Phase 5 |
| Structured requirements | Authoring convention, deterministic parser, schema validation, all-or-nothing registry import | AI extraction in Phase 5 |
| Stable IDs | Enforce uniqueness and retired-ID preservation | Cross-release comparison in Phase 7 |
| Proposed interpretations | Human review/acceptance boundary | AI-generated proposals in Phase 5 |
| Roles/credentials | Safe project-scoped environment-variable references | Playwright authentication setup in later authenticated workflows |
| Authentication state | Secure storage/ignore conventions | Setup projects and actual `storageState` workflows |
| Local demo target | Reproducible V1/V2 app with one changed and one new behavior | Phase 7 uses it for release-regression demonstration |
| Persistence | Project-scoped files/JSON through Phase 5 | SQLite plus migrations for structured operational metadata in Phase 6; durable assets remain files |
| Hosted AI provider | Decision: API-key-based hosted inference; Phase 2 defines only secret separation/template convention | API client/provider adapter and model selection in Phase 3 |
| MCP | None | Phase 4 |
| AI agents | None | Phase 5 |
| Candidate validation/approval | None | Phase 6 |

**Important:** Phase 2 does not prove that the platform can understand free-form business requirements. It proves that it can preserve immutable source documents, deterministically parse explicitly authored structured requirements, validate and review them safely, and demonstrate project/version separation with a controlled local V1/V2 target. AI-assisted interpretation begins only after the hosted API provider and MCP foundations are implemented and verified.

## 9. Before Phase 3: required provider-decision synchronization

Before starting substantial Phase 3 implementation:

1. Verify that DEC-028 in `docs/DECISIONS.md` remains the latest applicable provider-direction decision. DEC-028 already documents the hosted API-key approach and supersedes DEC-006 and DEC-007. No additional decision creation is needed unless requirements change.
2. Update `PROJECT_SPEC.md`, `ARCHITECTURE.md` section 3.4, `IMPLEMENTATION_PLAN.md` Phase 3, and relevant roadmap wording to align with DEC-028 so none require a local model as the primary deployment path. Preserve the provider-adapter, structured-output, mock-testing, and honest-verification principles that remain valid.
3. Record that model inference sends selected prompt/context data to an external provider. Define data minimization, secret redaction, provider data-handling review, usage/cost limits, timeout/rate-limit handling, and a way to disable external calls.
4. Choose the concrete provider/model only after comparing tool calling/MCP compatibility, structured output, context limits, reliability, latency, cost, rate limits, and data terms. Do not put provider-specific assumptions into Phase 2 project config.
5. Paid feasibility testing must wait until the user approves a spending budget and usage limits.

Do not let this documentation/provider work expand Phase 2 implementation. It is a required architecture alignment before Phase 3, after the user has reviewed the provider choice and the Phase 2 foundation.
