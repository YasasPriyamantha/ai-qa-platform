# Project Specification — AI-Powered QA Automation Platform

**Document status:** Phase 0 baseline; revised before Phase 1 implementation  
**Working name:** AI QA Automation Platform  
**Initial deployment:** Local-first, single-user  
**Primary language:** TypeScript for new platform code  
**Browser test runner:** Playwright Test  
**AI strategy:** Local model first; optional provider adapter later

---

## 1. Project summary

The AI QA Automation Platform helps a user test browser-based web applications by combining documented requirements, AI-assisted browser exploration, generated test candidates, repeatable test execution, and release-to-release test history.

A user supplies a project configuration, a target website, a workflow or requirements document, a release identifier, and any required test-environment details. The system turns requirements into structured records, explores the approved website through Playwright MCP, proposes test scenarios, generates candidate Playwright tests, validates them, and runs approved tests with Playwright Test. It records outcomes and preserves approved tests between releases so later versions can be checked for regressions.

The project starts as a personal learning and portfolio project, should become useful for real work, and may eventually evolve into a tool for other developers or QA teams. The initial implementation is local-first and single-user, with reasonable boundaries for later server deployment.

## 2. Problem statement

Traditional browser automation often requires people to manually design tests, write and maintain test code, decide which tests should run after a release, and inspect failures. A test suite that is regenerated and discarded for every release can lose coverage of previously working behavior.

This project uses AI to assist with discovery, planning, generation, and failure analysis while retaining a durable, reviewable set of requirements and approved tests. AI must not fabricate expected behavior, hide failures, falsely claim verification, or silently weaken tests to make a run pass.

## 3. Product goals

1. Accept workflow documents and website configuration for a web application.
2. Convert requirements into structured, traceable records and test scenarios.
3. Explore an approved target website using Playwright MCP through the platform's own agent workflow.
4. Generate candidate automated tests using Playwright Test for supported browser workflows.
5. Validate candidate code and execute it in a controlled test environment.
6. Maintain approved tests across releases and compare new requirements with earlier requirements.
7. Run approved tests against a new release, including tests for earlier behavior that should still work.
8. Produce clear reports containing outcomes, requirement links, and debugging evidence.
9. Run without a mandatory paid AI API or paid Playwright service; allow an optional hosted AI provider later.
10. Keep the codebase understandable to a beginner building the platform with AI coding assistance.

## 4. Non-goals for the initial MVP

The MVP will not attempt to:

- Guarantee successful automation of literally every website from a URL and vague instructions alone.
- Test native Android or iOS applications.
- Replace all unit-testing, load-testing, penetration-testing, or specialist security tools.
- Autonomously deploy code or change a user's application.
- Run destructive or financial actions against production systems by default.
- Accept AI-generated tests as correct without validation and an approval process.
- Require a vector database, distributed agent infrastructure, Kubernetes, or a cloud-hosted AI service.
- Support multiple concurrent users or public multi-tenant hosting in its first release.
- Parse every document format in the first version. Start with Markdown and plain text; add other formats only after the core flow works.

## 5. Intended users and use cases

### Primary user

A developer or QA practitioner who configures projects, supplies workflow documents, reviews generated tests, runs suites, and investigates reports.

### Initial use cases

- Test a demo web application while developing the platform.
- Configure a web application with different roles, such as administrator and ordinary user.
- Convert a workflow document into candidate scenarios and automated tests.
- Run existing tests against a newer staging release.
- Identify missing or changed requirement coverage.
- Review test failures with logs, screenshots, traces, and linked requirements.

### Supported initial application scope

- Browser-based web applications.
- Public and authenticated pages, provided the user supplies an approved test URL and suitable test-account setup.
- Multiple roles, where role credentials and role-specific workflows are configured safely.
- Local, development, demo, or staging environments explicitly approved for testing.
- SauceDemo as the first example target; at least one different demo web application must be used before claiming that the platform is reusable across applications.

## 6. Testing scope

The MVP must support these testing purposes:

- **Functional testing:** checks that a feature behaves according to documented requirements.
- **End-to-end testing:** checks complete user workflows across a web application.
- **Black-box testing:** checks observable behavior against expected results without requiring knowledge of internal application implementation.
- **Regression testing:** reruns approved tests after changes to detect previously working behavior that has broken.

These labels are not mutually exclusive. One scenario may have several labels. For example, a checkout test can be functional, end-to-end, black-box, and regression testing.

### Later extensions

The architecture should not prevent adding API/integration tests, smoke tests, accessibility checks, visual regression, performance testing, or security testing. These are not all MVP requirements. Playwright Test is the main runner for browser tests and can also support API checks; specialist areas may use separate free/open-source tools when appropriate.

## 7. Core product behavior

### 7.1 Project setup

A project has a stable project ID and includes:

- Project name and description.
- Base URL and allowed target domains.
- Environment label (for example, local, development, demo, or staging).
- Current release identifier when release management is introduced.
- Workflow/requirements document references.
- Authentication and test-account setup references (never raw secrets in ordinary configuration files).
- Test-run settings and artifact locations.

A project configuration must not contain assumptions or locators specific to SauceDemo. SauceDemo is an example/demo project only.

### 7.2 Requirements and requirement identity

Requirements must be traceable across releases. The following rules apply:

1. **Author-assigned stable IDs are the source of identity for structured workflow documents.** A requirement that continues across releases keeps its ID when its wording or acceptance criteria change.
2. IDs must be unique within a project and must not be reused for an unrelated requirement. Retired IDs remain in history.
3. A new requirement receives a new ID. An obsolete requirement is marked retired; it is not silently deleted.
4. The AI must not independently assign authoritative IDs to free-form documents. It may propose IDs while converting an unstructured document into the structured format, but those proposed IDs must be reviewed and accepted by a user before becoming authoritative.
5. The original source document and source text must be preserved. Structured records must identify their source document and relevant section/heading where available.
6. Each requirement used to generate an assertion must state an expected outcome. Each negative case must also state its expected outcome.
7. If expected behavior is missing, ambiguous, or contradictory, the system marks the requirement unresolved and asks for clarification. It must not infer a business rule merely from what the current website happens to do.
8. AI-suggested requirement changes and release classifications remain proposals until reviewed.

The first supported document formats are Markdown (`.md`) and plain text (`.txt`). A structured Markdown template with explicit requirement IDs is the preferred input. For example:

```markdown
## REQ-012: Shipping information is required

Status: Active
Priority: High
Role: Customer

### Description
A customer must provide valid shipping information before completing an order.

### Expected result
The application must prevent checkout from proceeding when required shipping information is missing.

### Negative cases
- Missing shipping address: checkout is prevented and a validation message is shown.
```

The example is illustrative. A real project author must supply the correct business rule and exact messages when those details matter.

### 7.3 Browser exploration

- The AI uses the Playwright MCP server through an MCP client owned by the platform, not only through an IDE extension.
- Exploration is restricted to project-approved domains and environments.
- Exploration observations can include page structure, accessible names, forms, navigation, potential locators, observed behavior, and blockers.
- Observations are evidence for planning, not proof that every requirement is satisfied.
- Ephemeral MCP snapshot element references must not be saved as durable locators in generated test code.
- Website content is untrusted input and cannot change the platform's instructions, permissions, or allowed domains.

### 7.4 Test planning

The planner generates structured candidate test scenarios. Each scenario should include:

- Stable scenario/test ID.
- One or more requirement IDs.
- One or more testing-purpose labels (functional, end-to-end, black-box, regression, etc.).
- Role, preconditions, and test-data needs.
- Steps or actions.
- Expected results/assertions derived from requirement text.
- Priority and risk.
- Known dependencies and unresolved questions.
- Candidate/approved/retired status.

Testing categories belong to test scenarios, not to the underlying business requirement record. A single scenario may have multiple categories.

### 7.5 Test generation, validation, and review

- Generated code is written to a candidate area, separate from approved tests.
- The generator uses Playwright Test for browser automation and stable, user-facing locators where possible.
- Candidate tests must be syntactically and type checked, then executed in a controlled environment before approval.
- A passing test is not automatically considered a good test.
- Reviewers must verify that important assertions trace to explicit requirement text, not merely to behavior observed during exploration.
- Reviewers must check that tests detect meaningful incorrect outcomes rather than only checking that a page or control exists.
- Candidate stability validation will initially run each candidate in three separate executions with retries disabled. This is evidence of repeatability, not a guarantee that a test is permanently non-flaky. The number of validation runs may later be configurable.
- Failed tests, unstable results, unresolved requirements, and missing coverage must remain visible in reports.

### 7.6 Authentication and roles

The platform must support authenticated workflows and multiple roles through project-specific configuration.

- Credentials are supplied through environment variables or an appropriate secret mechanism, not committed configuration files.
- `.env` may be used for local development only when it is ignored by Git; `.env.example` may document variable names without values.
- Project configuration may refer to environment-variable names but must not contain passwords, tokens, or session cookies.
- Role profiles may identify a role and the environment-variable names that provide its credentials.
- Playwright setup projects and `storageState` may be used to establish and reuse authenticated sessions.
- Authentication state files may contain cookies or tokens. They must be treated as secrets, excluded from Git, stored within a restricted project/run area, and never printed in logs or prompts.
- Different roles should use separate authentication state where appropriate. Shared accounts must not be used for parallel tests that can mutate the same state unless the test design explicitly handles that concurrency.
- If login requires CAPTCHA, MFA, SSO, or another unsupported interaction, the platform must surface the blocker and require user-provided setup rather than pretending authentication succeeded.

### 7.7 Execution

- Playwright Test executes approved automated browser tests.
- The platform records run ID, project ID, release ID when available, start/end time, test status, duration, errors, and artifact locations.
- The platform should support running a selected test, a selected category, or the active approved suite as those capabilities are introduced.
- Runner output is the source of truth for test outcomes. AI explanations are advisory and must be labeled as such.
- A zero-test run must never be treated as a successful verification.
- Retries are disabled in the initial execution engine (`retries: 0`). Flaky-test behavior can be introduced later with explicit reporting.

### 7.8 Reports and status separation

Reports should include, where available:

- Total, passed, failed, skipped, and (when retries are introduced) flaky test counts.
- Test and requirement IDs.
- Test category and priority.
- Release and environment tested.
- Duration and error details, including Playwright's top-level run errors when present.
- Paths to screenshots, traces, and relevant logs.
- Requirement coverage and uncovered requirements.
- New, changed, unchanged, retired, and unresolved requirement summaries for releases.
- Comparison with previous runs.
- AI failure analysis clearly separated from observed facts.

The platform must distinguish three levels of status:

1. **Individual test status:** outcomes such as passed, failed, or skipped. Flaky is only produced when retry-based behavior is introduced.
2. **Execution run status:** outcomes such as passed, failed, timed out, or infrastructure error. Workflow states such as blocked belong to the higher-level workflow, not the initial runner.
3. **Report-collection status:** complete, partial, or failed.

A successful run requires a valid machine-readable report, at least one discovered test, a successful process exit, no top-level Playwright run errors, and consistent report/process outcomes. Missing or malformed required JSON, a zero-test run, a non-zero exit, top-level run errors, or contradictory evidence must never be reported as a verified pass. A zero-test run is classified as `infrastructure_error` with `reason: "no_tests_found"`. The run result must include a concise machine-readable reason when it is not passed (for example, `test_failures` for ordinary failed tests, `no_tests_found`, `exit_report_mismatch`, or `cleanup_failed`). If the runner-level timeout fires, `runStatus` takes precedence as `timed_out` and `reportStatus` is `failed` when the required report is absent; the CLI must report the timeout as the primary cause rather than masking it as a generic missing-report error. The CLI must return a non-zero exit code when the run is not verified as successful or required report collection is incomplete.

### 7.9 Release and regression behavior

For each new release:

1. Save the new source workflow document and release identifier.
2. Compare structured requirement records using their stable, author-assigned IDs.
3. Classify requirements as new, changed, unchanged, retired, or unresolved. AI may suggest semantic changes, but a reviewer confirms them.
4. Propose new tests for new requirements.
5. Flag tests affected by changed or retired requirements for review.
6. Preserve valid tests for unchanged requirements.
7. Run the active approved suite against the new target release.
8. Compare results with previous runs and save a release report.

Approved tests must not be silently deleted, weakened, or replaced by newly generated tests. Retiring a requirement, changing expected behavior, or substantially changing a test requires an auditable review/approval step. Old requirement and test versions and the reason for a change must remain available in history.

## 8. AI-agent behavior and trust rules

Agents may assist with requirements analysis, exploration, planning, generation, and failure triage. The initial implementation can use one local model for multiple agent roles; separate models or services are not required.

The following rules are mandatory:

1. **Never fabricate:** do not invent requirements, expected outcomes, observed browser results, successful test runs, or evidence.
2. **Never hide:** show failures, blockers, ambiguous requirements, missing coverage, and tool errors.
3. **Never fake verification:** state that a test passed only when the runner actually completed it and reported success under the platform's success rules.
4. **No silent assertion weakening:** do not alter expected results simply to make a failing test pass.
5. **Separate candidate and approved assets:** generated tests remain candidates until reviewed and approved according to project policy.
6. **Human approval for semantic changes:** changing expected business behavior, retiring coverage, or accepting major test changes requires review.
7. **Evidence-based failure analysis:** distinguish observed facts from hypotheses and provide evidence for explanations.
8. **Bound tool calls:** use timeouts, iteration limits, maximum generated files, and clear stop conditions.
9. **Prompt-injection awareness:** treat website content and uploaded documents as untrusted input. Content discovered on a website must not override platform safety rules or expand tool permissions.
10. **Least privilege:** the agent gets only the tools and URLs needed for its task.
11. **No hidden actions:** agent tool calls, generated changes, test outcomes, and material decisions must be inspectable in logs or reports, with secrets redacted.

## 9. Cost and licensing constraints

- The project should run without paid Playwright features or a mandatory paid AI API.
- Use Playwright Test and freely available/open-source components where practical, checking each dependency's current license before adopting it.
- Start with a local model provider such as Ollama, subject to hardware and model capability testing.
- Design a provider adapter so a compatible hosted provider can optionally be added later, but never make it mandatory for the MVP.
- Document that local operation can still require computer hardware, electricity, storage, and setup effort; zero-cost means no required paid service/API subscription, not literally zero operating cost.

## 10. Technical direction

- **Language:** TypeScript for all new platform code, including agent orchestration and new Playwright tests.
- **Runtime:** Node.js.
- **Browser/test runner:** Playwright Test (`@playwright/test`).
- **Platform unit/integration test framework:** Vitest, explicitly restricted to platform test directories.
- **Browser exploration:** Playwright MCP server connected through the platform's own MCP client.
- **AI integration:** provider adapter; local model first.
- **Initial interface:** command-line prototype.
- **Later interface:** local web UI after the CLI workflow is reliable.
- **Persistence:** Git/files for version-controlled documents and test code; SQLite for structured project and execution metadata when persistence is introduced.
- **Reports/artifacts:** local filesystem in the initial version.
- **TypeScript build:** compile platform source code to `dist/` before executing the CLI.
- **TypeScript checking:** separately type-check platform code, Playwright config, platform tests, fixture tests, and project Playwright tests without emitting output.

The completed JavaScript tutorial project remains a separate learning/demo reference. It does not need to be converted or imported into the platform. Playwright can load TypeScript configuration and test files directly; the platform must still run a separate type-check command.

The final frontend framework, backend web framework, and local model must be chosen or validated when their phase begins rather than added prematurely.

## 11. Initial success criteria

The prototype is successful when it can:

1. Create a project with a target URL and a Markdown/text workflow document.
2. Extract structured requirements and flag unclear expectations.
3. Explore a controlled demo/staging website through Playwright MCP from the platform backend.
4. Generate candidate test scenarios for functional, E2E, black-box, and regression purposes.
5. Generate candidate Playwright Test files and validate them.
6. Keep candidate tests separate from approved tests.
7. Execute approved tests and produce an accurate report with artifacts for failures.
8. Accept a second release document, compare it with the prior release, and preserve valid existing regression tests.
9. Demonstrate the process on SauceDemo and at least one different demo web application before claiming the framework is reusable.
10. Operate without mandatory paid AI API calls or paid Playwright services.

## 12. Assumptions and open decisions

- The first release is local-first and single-user.
- Initial scope is browser-based web applications, including role-based workflows.
- Initial documents are Markdown and plain text; a structured Markdown requirements template is preferred.
- Author-assigned requirement IDs are authoritative; AI-proposed IDs require human approval.
- A human approves new generated tests and material changes to approved tests.
- Release execution is initially started manually; automation via CI/CD is added later.
- Model choice depends on available hardware and must be benchmarked for structured output, tool use, exploration, and test generation before commitment.
- Authentication and test-data setup may require project-specific configuration. The platform must surface blockers instead of claiming universal support.
- Additional document parsers, test runners, multi-user features, and remote deployment are later extensions.

---

## References

- Playwright TypeScript support: https://playwright.dev/docs/test-typescript
- Playwright configuration: https://playwright.dev/docs/test-configuration
- Playwright authentication: https://playwright.dev/docs/auth
- Playwright reporters: https://playwright.dev/docs/test-reporters
- Playwright best practices: https://playwright.dev/docs/best-practices
- Playwright MCP: https://playwright.dev/docs/getting-started-mcp
- Model Context Protocol TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/v2/
