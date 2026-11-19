# AI QA Automation Platform — Phase 3 Mini-Task Breakdown

**Phase:** 3 — Hosted AI Provider Integration  
**Status:** Ready for Task 3.0a after the Phase 2 checkpoint and current repository state are verified  
**Estimated focused effort:** Approximately 21.5–34 hours, including provider research, schema work, and the gated hosted-provider/MCP experiment; re-estimate after Tasks 3.0a–3.0b  
**Implementation style:** One bounded task at a time; inspect, implement, verify, review, report

This document turns Phase 3 of `docs/IMPLEMENTATION_PLAN.md` into small, independently reviewable tasks. Its structure follows the reviewed Phase 1 and Phase 2 breakdowns: phase objective, task overview, standing rules, pre-phase housekeeping, and for each task an estimate, summary, copy-ready coding prompt, and completion criteria.

The prompts follow the supplied `reliable-ai-coding` skill and `software-engineering-best-practices` skill. They require repository inspection, observable acceptance criteria, bounded changes, executable verification, full-diff review, preservation of existing work, and honest reporting. They do not assume that longer prompts or additional abstractions automatically produce better code.

## Source documents and references

Read the current repository versions before implementation. The following Library/review copies were used to prepare this breakdown; the checked-out repository files remain authoritative for implementation:

- `docs/PROJECT_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DECISIONS.md`
- `AI_QA_Platform_Nine_Phase_Roadmap.md` (where present in the repository or project documentation)
- `docs/REQUIREMENTS_AUTHORING_CONVENTION.md`
- `docs/AUTHENTICATION_AND_CREDENTIALS.md`
- `.env.example`, `.gitignore`, `AGENTS.md`, and the tool-specific instruction file actually loaded (for example, `CLAUDE.md`)
- `package.json`, the lockfile, TypeScript/Vitest configuration, existing `src/model-providers/` contents (if any), CLI/application services, and relevant tests
- `AI_QA_Platform_Phase_1_Breakdown_Final_Review.md` — reviewed Phase 1 task breakdown
- the latest reviewed Phase 2 mini-task breakdown actually available in the repository/library (locate its real filename; do not assume a particular suffix or copy name)

The actual repository, package versions, latest decision log, Git state, current environment-loading behaviour, and existing implementation must be checked again in Task 3.0a. The available review material records a discrepancy of 999 versus 996 tests across 27 files; Task 3.1 must reconcile this against a fresh full-suite run. The earlier correction report is not a repository dependency and must not be referenced by its ChatGPT-only pasted filename. This plan is not evidence that any code exists or that tests pass.

---

## 1. Phase 3 objective

Connect the locally run AI QA Platform to hosted model APIs through one replaceable, provider-neutral interface. The user must be able to configure multiple companies' separate API keys concurrently, select one provider/model for each operation, and switch providers without rewriting application or future agent logic. The system must never assume one company's key authenticates another company's API.

The initial built-in providers are:

- **OpenAI API** — including models made available through OpenAI's API platform (often described by users as ChatGPT models).
- **Anthropic Claude API**.
- **Google Gemini API**.

The platform must not be restricted to one company or one API key. It must support multiple provider-specific API keys being configured at the same time, select the requested provider/model for an operation, and pass only that provider’s matching key to its adapter. The initial built-in direct providers are OpenAI, Anthropic, and Google Gemini. In addition, Phase 3 includes a configurable **OpenAI-compatible Chat Completions adapter** so one adapter can support multiple companies that implement that protocol (for example, compatible services such as Groq). Each compatible provider is configured separately with its own provider ID, model ID, base URL, and key environment-variable name.

This is not a universal API key or a promise that every AI company uses the same protocol. If a company implements the supported OpenAI-compatible Chat Completions dialect, it can use the compatibility adapter subject to its actual feature support. If it uses a different protocol, it needs a dedicated adapter. The platform must not silently assume full compatibility: tool calling, structured output, usage reporting, model identifiers, and request options are declared and tested per provider/model. Adding an adapter must not require changes to requirements, planning, orchestration, or other business logic.

The platform remains **local-first for non-inference operations**: CLI, project workspaces, source documents, tests, and artifacts remain local. Model inference crosses an external provider boundary when enabled. This is the meaning of DEC-028 and must not be confused with the superseded local-model-first approach.

At the end of Phase 3, the platform should be able to:

- Select a supported provider and a provider-specific model ID through platform-level configuration.
- Resolve the matching provider API key securely from the platform environment, without storing the key in project configuration.
- Submit a bounded, typed request through one internal model-provider interface.
- Normalize text output, structured output, tool-call requests, completion/stop reasons, token usage, provider metadata, and errors where the provider exposes them.
- Validate structured model output with the project's chosen runtime validation approach. Provider-side JSON/schema enforcement is useful but does not replace local validation.
- Handle missing credentials, invalid credentials, unsupported model/features, malformed or incomplete responses, rate limits, quota/billing exhaustion, context limits, timeouts, cancellation, and provider outages explicitly.
- Keep most tests deterministic and free of external API costs by using mock providers and mocked SDK responses.
- Perform a small real-provider smoke test only when a valid key is configured and the user has approved any applicable usage/budget limit.
- Keep provider/model identity, schema/prompt version, request correlation metadata, duration, token usage, and safe error metadata available for diagnosis without recording secrets or full sensitive payloads by default.

## 2. Provider and key-handling decisions

### 2.1 Decisions already made

**DEC-028 is accepted and controls this phase.** It supersedes the local-model-first direction in DEC-006 and replaces the local-model feasibility experiment in DEC-007 with a hosted-provider/Playwright-MCP experiment.

The following DEC-028 rules remain mandatory:

- Provider credentials are platform-level secrets, separate from project/application test credentials.
- A real provider key must never be committed, logged, placed in `project.config.json`, exposed in prompts, or written into reports.
- External inference sends selected prompt/context data to a third party. Use data minimization and review provider data-handling terms before sending project material.
- Provider calls must be controllable and disableable.
- Paid API usage is not authorised until the user explicitly approves a spending budget and usage limits.
- Use a replaceable provider adapter, structured-output validation, mock-provider tests, explicit timeouts, rate-limit/error handling, and honest reporting.

DEC-029 also remains applicable: Phase 3 uses the Phase 2–5 file/JSON storage approach. Do not introduce SQLite in this phase; SQLite belongs to Phase 6.

### 2.2 Multi-company provider and credential requirement

The platform must not be locked to a single provider, a single company’s key, or one hard-coded provider list. It must support the three initial direct providers (OpenAI, Anthropic, Gemini) plus a configurable OpenAI-compatible Chat Completions adapter for additional companies that implement that API dialect. Multiple provider keys may coexist. The active provider is selected explicitly; the adapter resolves only the key mapped to that provider. Switching providers must not require editing application or future agent/business logic.

For built-in providers, use clear provider-specific environment names such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`. For every additional provider entry, require a distinct provider-specific secret environment-variable name following the reserved `AI_PROVIDER_<PROVIDER_ID>_API_KEY` convention. Do not allow custom provider-key names outside the `AI_PROVIDER_` namespace. This makes the name enforceable by project-role validation and child-process secret filtering. A key is never interchangeable between companies unless the provider itself explicitly documents that credential. The old generic Phase 2 placeholder `AI_PROVIDER_API_KEY` must not be treated as a universal key or silently reused for every provider.

Provider selection and model selection are separate settings. Do not hardcode model names in business logic. Do not require a third-party gateway key or a Vercel AI Gateway account. A unified SDK such as the Vercel AI SDK may be evaluated only as an implementation option, using direct provider credentials. If selected, Task 3.2 must explain which vendor-specific translation work becomes thin adapter configuration and which compatibility work remains. The OpenAI-compatible Chat Completions adapter remains a distinct protocol adapter from a native OpenAI Responses adapter, even if a shared SDK or HTTP client is reused underneath.

**Important account distinction:** “ChatGPT API key” means an OpenAI API-platform key, not a ChatGPT web-session cookie or subscription login. OpenAI documents separate billing for ChatGPT and the API platform. Claude web subscriptions and the Claude API Console are also distinct, and Gemini API keys are provisioned through Google's developer tooling. The platform must not attempt to convert a consumer subscription login into an API credential.

### 2.3 Provider capabilities are model-specific

Do not assume every model exposed by a provider supports every capability. Tool calling, structured outputs, context size, streaming, usage reporting, and limits can vary by provider, API version, and model. The provider layer must represent capability support (including unsupported or unknown) and fail clearly when a requested capability is unavailable. Do not silently downgrade a structured-output request into unvalidated plain text or silently omit requested tools.

The Phase 3 provider layer may normalize tool-call requests and tool results, but it does **not** connect to or execute Playwright MCP tools. Actual MCP integration is Phase 4. Phase 3 must not implement requirements agents, planners, generators, or generated tests; those belong to Phase 5 and Phase 6.

---

## 3. Phase 3 boundaries

### Included

- Phase 2 handoff and hosted API + Playwright MCP feasibility experiment.
- Alignment of source documentation with DEC-028 and the user's multi-provider requirement.
- A recorded decision for built-in provider support and the selected integration approach.
- Provider-neutral TypeScript request/response/error contracts.
- Platform-level provider/model configuration and safe API-key resolution.
- Direct OpenAI, Anthropic, and Gemini adapters.
- A configurable OpenAI-compatible Chat Completions adapter for other companies that implement that dialect.
- One-source structured-output schemas, provider-specific schema lowering, and local validation.
- Multi-turn assistant tool-call/tool-result message contracts and opaque provider continuation state for later phases.
- Shared timeout, cancellation, retry, rate-limit, persistent usage-budget, and safe-diagnostics handling built before the provider adapters.
- Mock-provider and provider-contract tests, plus controlled live smoke testing where authorised.
- A small CLI diagnostic/test path for checking the currently selected provider.

### Explicit non-goals

Do not implement these in Phase 3:

- Local model runtimes such as Ollama, local model installation, or GPU/RAM tuning as the primary inference path.
- Playwright MCP server/client integration in platform source code. That is Phase 4. The Phase 3 feasibility task may use a disposable client outside `src/` only.
- AI requirements analyst, explorer, planner, generator, failure analyst, autonomous agent workflows, or prompt libraries. Those are Phase 5.
- AI document extraction or changes to Phase 2 requirement parsing, registry, proposal acceptance, or stable-ID behaviour.
- Generated Playwright test execution, candidate validation, approvals, or richer AI reporting. Those are Phase 6.
- Release comparison/regression memory (Phase 7), UI/API server or CI/CD (Phase 8), SQLite (Phase 6), or multi-user hosting.
- Provider credentials in `project.config.json`, role credentials, browser storage state, test files, or child-process command-line arguments.
- Automatic cross-provider fallback. Sending a user's project context to a different company can change privacy, cost, and data-handling terms; any fallback must be an explicit future policy, not a silent retry.

A provider can return a tool-call request in Phase 3, but Phase 3 must not execute that tool. The future orchestrator/MCP layer owns tool permission checks and execution.

---

## 4. Task overview

| Task | Mini-task | Estimated effort | Code changes |
|---|---|---:|---|
| 3.0a | Phase 2 handoff audit and provider capability/documentation comparison | 1.5–2.5 h | Read-only; no platform code or live calls |
| 3.0b | Gated hosted-provider + Playwright MCP feasibility experiment | 2–4 h | Disposable files/dependencies outside the repository only |
| 3.1 | Source-document, credential-document, and architecture alignment | 2–3 h | Yes; documentation/decision record |
| 3.2 | Provider SDK strategy and multi-turn contracts | 1.5–2 h | Yes |
| 3.2a | Single-source structured-output schemas and generic conversion | 1.5–2.5 h | Yes |
| 3.3 | Platform provider configuration and isolated API-key handling | 2–3 h | Yes |
| 3.3a | Shared request lifecycle, retry policy, cumulative usage controls, and safe diagnostics | 2.5–3.5 h | Yes; before vendor adapters |
| 3.4 | Direct OpenAI provider adapter | 1.5–2.5 h | Yes |
| 3.5 | Direct Anthropic Claude provider adapter | 1.5–2.5 h | Yes |
| 3.6 | Direct Google Gemini provider adapter | 1.5–2.5 h | Yes |
| 3.6a | Configurable OpenAI-compatible Chat Completions adapter | 2–3 h | Yes |
| 3.7 | CLI integration, live verification, and Phase 3 exit checks | 2–3 h | Yes |

The revised estimate includes a separate read-only audit and a separately gated live experiment, three direct providers, an additional compatibility adapter, a separate schema-source task, a shared request lifecycle, secure multi-key handling, and cumulative usage controls. Re-estimate after Tasks 3.0a–3.0b and inspect actual package/runtime versions before choosing dependencies. Do not compress verification or remove the multi-provider requirement simply to meet an older estimate.

---

## 5. Standing rules for every Phase 3 coding task

- Read the four source documents and `DECISIONS.md`, plus relevant Phase 1/Phase 2 deliverables and the actual repository instructions.
- Follow `reliable-ai-coding` and the supplied `software-engineering-best-practices` SKILL.md when they are actually available in the coding session. Do not assume `software-engineering-best-practices/references/security.md` or any other reference file exists in the repository; the supplied skill material currently establishes the core skill but not an installed reference directory. Do not create a partial skill installation with broken relative links. If the skill is unavailable, apply the security and engineering requirements stated in these prompts and use current official documentation.
- Inspect the actual repository root, branch, `git status`, and existing diffs before editing. Preserve all pre-existing user changes. Never delete files or folders that the current task did not create; never clean up pre-existing artifacts or user-owned temporary files.
- Use PowerShell and Windows-compatible commands for this Windows repository. Do not assume Bash-only commands work in PowerShell. When running manual PowerShell checks from a Bash-based coding tool, group them inside one `powershell.exe -NoProfile -Command "..."` invocation.
- Inspect `package.json`, the lockfile, installed Node.js/npm versions, TypeScript settings, existing validation utilities, CLI command conventions, and tests before adding packages or commands.
- Verify provider SDK APIs and model capabilities against the current official provider documentation and installed package versions. Do not copy stale examples or invent model IDs, endpoints, headers, request properties, or package versions.
- Prefer a common provider interface and small provider adapters. Do not import provider SDKs into CLI handlers, requirements logic, or future agent/business modules.
- Do not add LangChain, an agent framework, a gateway service, or several overlapping abstractions without a demonstrated need. Evaluate a unified provider SDK against direct provider SDKs and choose one approach based on actual support and maintenance, not familiarity alone.
- The selected implementation must use direct provider credentials for OpenAI, Anthropic, and Gemini. A gateway may be an optional future integration, not a required dependency.
- Keep provider settings and keys at the platform boundary. Do not put them in project config, per-project roles, requirement files, prompts, reports, or generated tests.
- Do not expose provider keys to Playwright child processes, browser pages, or test fixtures. Preserve the runner’s existing inherited child-process environment and existing project test-credential behaviour, removing only registered platform-provider secret variables, the reserved `AI_PROVIDER_*` namespace, and built-in provider key names. This is a preservation rule, not a request to load role credentials from project configuration or add a new injection path. Do not replace inheritance with a short allowlist.
- Do not log API keys, authorization headers, complete request bodies, document content, full prompts, or raw model output by default. Record safe metadata and redact credentials in errors.
- Treat API responses, structured model output, tool-call arguments, and provider error bodies as untrusted input. Validate at runtime before use.
- Do not automatically send private project documents to another provider or silently fall back between providers.
- Use mocked provider clients for routine tests. Run live provider requests only with a configured key and an explicitly authorised provider, model, request count, per-request input/output ceilings, cumulative input/output token ceilings, and monetary budget. A missing key or approval means “not live-verified,” not “passed.”
- Keep real API calls out of routine Vitest tests. Do not make tests dependent on network connectivity, paid quotas, or provider availability.
- Do not commit, push, deploy, rotate or delete credentials, or perform irreversible operations. The user reviews and commits.
- Run narrow tests first, then broader affected tests, type-check and build. Inspect the complete diff before finishing.
- When reporting Vitest, include raw summary lines (test files, tests, duration) and exact commands/results. Do not manually invent counts.
- Report each provider entry separately: mock-tested, live-tested, or not live-verified. Never imply that all providers were live-verified if credentials or approval were unavailable. At least one live verification of the implemented platform path is required to close Phase 3.

---

## 6. Pre-Phase-3 housekeeping and dependency checks

Before starting Task 3.0a:

1. The latest handoff indicates Phase 2 has already been committed/tagged. Verify the actual commit and tag in the repository and confirm the working tree state. Do not ask the user to make a duplicate checkpoint if the intended Phase 2 checkpoint is present. If it is absent or the worktree contains unreviewed changes, report the exact state and let the user decide the checkpoint. The coding model must never commit or tag.
2. Keep the Phase 2 completion/correction report and the verified Git checkpoint available.
3. Phase 2 is recorded as complete in the latest implementation-plan copy, but Task 2.11 (the local V1/V2 demo app) is explicitly deferred. Task 3.0a must confirm the actual repository status and report this accurately. Task 2.11 is not a prerequisite for provider integration; it must be completed before the Phase 7 release-comparison demonstration. Phase 5 must still demonstrate against SauceDemo and at least one other suitable application as specified by the roadmap.
4. DEC-028 supersedes DEC-006 and DEC-007. Do not reintroduce local-model-first implementation or assume local inference is required.
5. The source documents still contain local-model-first wording. Task 3.1 must align the specification, architecture, implementation plan, and active repository instructions with DEC-028. Update a separate roadmap only if an authoritative roadmap file is actually present; never invent a missing roadmap.
6. The user wants to configure multiple company-specific keys concurrently, use direct OpenAI, Anthropic, and Gemini adapters, and support additional companies through an OpenAI-compatible adapter where possible or a new native adapter when necessary. The reviewed decision log currently ends at DEC-033; verify the actual repository log before adding the next sequential decision. Do not assume the next number is still free.
7. No live API experiment or integration test may run until the approval fields are explicitly filled by the user. A documentation-only assessment can proceed without spend approval. The approved amount may be zero only if the provider confirms that the selected request is within a genuinely free quota and the current terms permit the data use. If Task 3.0b remains blocked/deferred, Task 3.1 may proceed because it is documentation-only. Tasks 3.2 and 3.2a may proceed as provisional contract/schema design, but provider SDK selection must be marked provisional. Do not begin provider adapter implementation (Tasks 3.4–3.6a) until Task 3.0b succeeds or the user explicitly accepts a new decision that records the spike deferral, the evidence gap, and the risk being accepted. Task 3.7 still requires a separate live smoke test through the implemented platform CLI; the disposable spike cannot satisfy that exit gate.
8. Phase 2 added a generic `AI_PROVIDER_API_KEY` placeholder but did not load or use it. Retire that placeholder as a default in favour of distinct provider credentials. Never auto-map the old generic variable to every provider. Preserve the user’s real `.env` file; do not delete or rewrite its contents without explicit approval. Extend DEC-032/project-role validation so built-in provider keys and the reserved `AI_PROVIDER_<PROVIDER_ID>_API_KEY` namespace cannot be referenced as project-role credentials.

---

# Task 3.0a — Phase 2 Handoff Audit and Provider Capability Comparison

**Estimated effort:** 1.5–2.5 hours  
**Code changes:** None; read-only audit and documentation research only

## Summary

Establish the actual Phase 2 handoff and compare the current official API capabilities, data terms, credential requirements, and SDK behaviours for OpenAI, Anthropic, Gemini, and representative OpenAI-compatible providers. This task does not install anything, create a spike, edit project files, or make live API calls. It is safe to run without provider keys or spending approval.

The audit must separate repository facts from claims in the implementation plan and prior reports. In particular, the latest Phase 2 correction report records 999 tests across 27 files while the implementation plan still records 996. The repository's current test output is the deciding evidence for any later documentation correction.

**Expected output:** Phase 2 handoff report; provider comparison matrix with official URLs and access date; exact SDK retry/timeout configuration findings; current Node version/environment-loading findings; and a clear recommendation for Task 3.0b without running it.

## Copy-ready coding AI prompt

```text
Goal

Perform a read-only Phase 2 handoff audit and compare current hosted-provider API capabilities before any Phase 3 implementation.

Project root: D:\ai-qa-platform

Context

DEC-028 selects hosted inference while keeping non-inference platform operations local. The required initial direct providers are OpenAI, Anthropic, and Gemini. The product must also support more than one company-specific key at a time and must not be architecturally locked to one company. A configurable OpenAI-compatible Chat Completions adapter is planned for additional companies that implement that dialect; providers using different protocols require dedicated adapters.

Requirements

1. Confirm repository root, branch, Git status, Phase 2 commit/tag, current diffs, Node/npm versions, and package scripts. Preserve all existing work. Do not create a commit or tag.
2. Inspect the current CLI, Phase 1 runner/child-process environment handling, Phase 2 config loader, .env.example, .gitignore, package.json, lockfile, TypeScript/Vitest configuration, and available provider-related code. Report verified facts separately from plan/report claims.
3. Read DEC-028 through DEC-033 and identify the current highest decision number. Confirm the generic AI_PROVIDER_API_KEY placeholder's documented status and that it is not loaded/used by Phase 2.
4. Read the latest Phase 1 and Phase 2 breakdowns using the actual files found. Do not assume a particular filename suffix. Do not edit historical breakdowns.
5. Compare current official provider documentation for direct OpenAI, Anthropic, and Gemini APIs and at least one OpenAI-compatible provider. For each, report credential creation/authentication, tool/function calling, structured output, supported API dialect, context/output limits, usage reporting, quota/rate-limit behaviour, pricing/billing, data handling, and whether the model/API choice changes capability.
6. Inspect official SDK documentation/source for automatic retries and timeouts. Record the actual defaults and how to disable SDK retries for OpenAI, Anthropic, Google Gen AI, and any candidate unified SDK. Do not assume the SDKs share defaults.
7. Check current official Node documentation and the installed Node version for util.parseEnv. Distinguish parsing .env into a separate object from APIs such as process.loadEnvFile that mutate process.env. Do not change environment handling.
8. Evaluate (documentation only) a direct-provider SDK strategy versus a unified SDK and an OpenAI-compatible Chat Completions adapter. Note that an OpenAI-compatible endpoint does not guarantee support for all OpenAI features.
9. Do not install dependencies, create a disposable project, run a live API request, invoke the coding assistant's own model as the model under test, or modify any file.

Verification and final report

Provide repository/branch/tag/status; Phase 2 completion and deferred items; current Node and env-loading facts; latest test-count evidence and inconsistencies; a provider capability/credential/billing/data comparison; exact SDK retry defaults and controls; source links/access dates; recommended live-spike provider candidates; blockers; and explicit confirmation that no files or network API requests were created/run. This task must remain read-only.
```

**Completion criteria:** Actual repository and Phase 2 state are documented; current official provider capabilities and SDK retry defaults are compared; no dependencies, project files, or live API calls are used.

---

# Task 3.0b — Gated Hosted-Provider and Playwright MCP Feasibility Experiment

**Estimated effort:** 2–4 hours  
**Code changes:** None in the platform; all spike dependencies and generated files must be outside the repository

## Summary

Run a tightly bounded proof of concept using one selected provider/model, a disposable client, and Playwright MCP. This task runs only after the user selects a provider/model and explicitly fills the approval block below. The coding assistant may prepare and execute the harness but must not act as the model under test: Claude Code (or any other coding-agent LLM/tool session) must not perform the website exploration, make the browser decisions, call MCP tools on behalf of the tested model, or generate the candidate test itself. If this experiment is blocked because the user has not approved a provider/model and usage budget, report it as deferred; do not pressure the user to approve paid usage.

All spike-only dependencies (MCP SDK, Playwright MCP client/server dependencies, and the selected provider SDK) must be installed in a dedicated directory outside the repository, for example `D:\ai-qa-spike`. Never add them to the platform's package.json or lockfile. Do not put generated tests in `project-data/saucedemo/tests/approved` or alter the real SauceDemo project config. Use a disposable temporary project workspace/config and a candidate test directory owned by the spike. The temporary config must point to the approved SauceDemo target but must not modify the real project configuration. Run the candidate independently through the Phase 1 CLI only after confirming that its testDirectory and artifact paths resolve entirely inside the disposable workspace. If that cannot be achieved safely, stop and report the blocker; do not fall back to the approved test directory.

## User approval block — must be completed before any live call

```text
Approved provider: ____________________
Approved model ID: ____________________
Maximum total requests for this spike (recommended maximum 20 for up to 15 MCP tool calls): ____________________
Maximum input tokens per request: ____________________
Maximum output tokens per request: ____________________
Maximum cumulative input tokens for this spike: ____________________
Maximum cumulative output tokens for this spike: ____________________
Maximum spend (currency and amount): ____________________
Provider pricing/quota and data-use/retention terms reviewed (link/date): ____________________
```

An empty field means no live request is authorised. A “free tier” claim is not sufficient on its own: verify current provider pricing/quota and data-use terms for the chosen API and account. Use public SauceDemo content only; do not upload private project documents.

## Copy-ready coding AI prompt

```text
Goal

Run a bounded hosted-provider + Playwright MCP feasibility spike using the provider/model and budget explicitly approved in the filled approval block. Do not implement platform code.

Project root: D:\ai-qa-platform
Preferred spike directory: D:\ai-qa-spike (outside the repository). Before using it, inspect whether it already exists. If it contains pre-existing files not created by this task, leave it untouched and choose a new unused sibling directory (for example, D:\ai-qa-spike-20261119-<unique-suffix>).

Approval block (the user must fill every field before execution)

Approved provider: [FILL IN]
Approved model ID: [FILL IN]
Maximum total requests (recommended maximum 20 for up to 15 MCP tool calls): [FILL IN]
Maximum input tokens per request: [FILL IN]
Maximum output tokens per request: [FILL IN]
Maximum cumulative input tokens: [FILL IN]
Maximum cumulative output tokens: [FILL IN]
Maximum spend and currency: [FILL IN]
Provider pricing/quota and data-use/retention terms reviewed (URL/date): [FILL IN]

Context

The tested model must be the selected hosted API model accessed through its actual API key. Claude Code or another coding-assistant LLM is only the harness operator; it must not perform model-under-test exploration or tool calls.

Requirements

1. Before execution, verify that every approval field is non-empty, the provider/model match the user's approval, a matching provider-specific key is available through a secret-safe environment path, and the approved provider quota/budget controls have been considered. If any check fails, do not call the API.
2. Create D:\ai-qa-spike if needed. Install all spike-only dependencies in that folder only. Do not install dependencies in D:\ai-qa-platform, modify the platform package.json/lockfile, or globally install packages.
3. Use the provider and model selected in the approval block only. Do not silently switch models, providers, gateways, or accounts. Keep the key out of shell arguments, files, prompts, logs, generated reports, and browser content.
4. Connect the hosted model-under-test to Playwright MCP through the disposable client. The coding assistant must not browse the site, decide the interactions, or invoke MCP tools itself. The model-under-test must issue the tool requests through the spike harness.
5. Use one bounded, non-destructive SauceDemo workflow and no private documents. Bound wall-clock time, MCP tool calls (initial target no more than 15 unless the user separately approves a different ceiling), provider requests (recommended cap 20 for up to 15 tool calls), input tokens per request, output tokens per request, cumulative input tokens, and cumulative output tokens. Enforce a hard local input-size/character guard and use a conservative character-based input-token reservation before each request; reconcile with provider-reported input usage afterward and clearly distinguish estimates from observed usage. Tool-call count and provider-request count are separate limits; do not assume a one-to-one relationship. Stop immediately when any cap is reached.
6. Generate one candidate Playwright test into the spike-owned candidate directory. Do not write to the real SauceDemo project's tests/approved directory, candidate directory, or project.config.json.
7. Create a disposable temporary project workspace and config that points to the approved SauceDemo target and the spike candidate directory. Inspect the Phase 1 CLI path rules first. Ensure its run/artifact paths stay in the disposable workspace. If the CLI cannot run a test from that isolated workspace without changing the real project, stop and document the blocker; do not use the real approved test directory as a shortcut.
8. Run the candidate independently through the Phase 1 CLI. The runner's result is the only evidence of pass/fail; do not accept the model's claim.
9. Track actual requests, tool-call count, input/output tokens when reported, latency, provider/model IDs, errors, and cost if the provider reports it. Unknown usage/cost must remain unknown, not estimated as observed fact.
10. Clean up only files/directories this spike created and only after confirming ownership. Do not delete pre-existing directories or user files. Keep the concise report outside the repository unless the user asks otherwise.

Constraints

- No platform source/config/docs/package changes.
- No dependencies inside the repository.
- No live request without the completed approval block.
- No coding-assistant model acting as the model under test.
- No use of project-data/saucedemo/tests/approved for generated code.
- No automatic provider/model fallback.

Final report

Give the exact selected provider/model; approval values; dependency versions and isolated path; request/tool-call/input-token/output-token/latency/cost observations; MCP interaction quality; candidate test path; temporary project config path; exact Phase 1 CLI command and observed outcome; cleanup performed; limitations; and green/amber/red/blocked verdict. Explicitly state that the model under test, not Claude Code, performed exploration and generated the test. If live execution was blocked, report blocked rather than green.
```

**Completion criteria:** The experiment is either completed within all approved caps with an independently verified CLI result, or clearly marked blocked/not run. The platform repository and real SauceDemo project remain unchanged.

---

# Task 3.1 — Source-Document and Architecture Alignment with Hosted Multi-Provider Inference

**Estimated effort:** 2–3 hours  
**Code changes:** Yes; documentation and decision record only

## Summary

Synchronise the actual source-of-truth documents with DEC-028 and the expanded multi-company provider requirement before implementation. This task must fix known mismatches rather than merely search for the phrase “local model”. Update the nine-phase roadmap only if an authoritative roadmap file is actually present; do not invent or create a missing roadmap. Locate the actual current Phase 1/2 breakdown filenames rather than relying on stale copied names, and keep historical breakdowns read-only.

The reviewed decision log currently ends at DEC-033; verify the repository's actual last decision before using the next number. The new decision must say that multiple company-specific keys can coexist; three native providers are included directly; other OpenAI-compatible Chat Completions services may use a configurable shared adapter; and providers with another protocol need their own adapter. It must not describe a universal key or universal API.

**Expected output:** Updated project spec, architecture, implementation plan, authentication/credential documentation, active repository instructions, and sequential decision entries for multi-provider support and the DEC-032 amendment. The Phase 1 summary's incorrect DEC-027 description and the Phase 2 test-count discrepancy must be reconciled using the actual decision log and real test output. Include `docs/AUTHENTICATION_AND_CREDENTIALS.md` §2 because it documents the legacy generic provider key.

## Known source-document issues to verify and address

- **PROJECT_SPEC.md:** Header still says local model first/optional provider later; §3 goal 9 and §11 criterion 10 currently overstate independence from paid AI for AI functionality; clarify that only the non-AI platform core is free of a mandatory paid AI service; §4 says a cloud-hosted AI service is a non-goal and must be clarified so it does not contradict optional hosted API inference; §8 refers to one local model across agent roles; §9/§10 retain local-model-first wording; §12 says model choice depends on local hardware, which is no longer the selection criterion.
- **ARCHITECTURE.md:** The §2 diagram contains “Local Model Runtime”; §3.4 describes the first local provider and optional hosted provider; §10 refers to local-model quality; §11 includes the Ollama tool-support reference.
- **IMPLEMENTATION_PLAN.md:** Header/phase summary, phase overview table, pre-Phase-3 feasibility wording, current Phase 3 section (the reviewed copy labels it Phase 3 — Local AI model integration), and later cross-references must be found by inspecting the actual current headings. Replace local-model implementation with hosted multi-provider integration. Do not insert made-up section numbers or reuse section numbers from another revision.
- **Phase 1 completion summary inside IMPLEMENTATION_PLAN.md:** Its DEC-027 summary currently says that individual `interrupted` and `timedOut` statuses map to run-level `timed_out` when the runner timeout fires. That is incorrect. DEC-027 says individual `timedOut` maps to normalized test status `failed`; individual `interrupted` remains separately tracked and causes `infrastructure_error` / `playwright_process_error` when the platform runner timeout did not fire; when the platform runner timeout did fire, run status remains `timed_out` with primary reason `runner_timeout`.
- **Phase 2 test count:** IMPLEMENTATION_PLAN.md records 996 tests/27 files, while separate review material records 999/27 files. Re-run the repository's actual current full suite before updating the source-of-truth count. Record the raw observed output and update the plan only to that verified result. Do not refer to a ChatGPT-only pasted report filename or treat an earlier report as repository evidence.
- **Phase 2 key placeholder:** The latest Phase 2 breakdown says `AI_PROVIDER_API_KEY` was a generic future placeholder only and was not loaded or used. Phase 3 must replace the default template with provider-specific credentials and explicitly deprecate the generic placeholder; do not claim Phase 2 already supports provider-key loading.
- **AGENTS.md:** The reviewed version says Phase 1 complete/Phase 2 next and refers only to `reliable-ai-coding`. Align status with the actual repository and clarify how the supplied `software-engineering-best-practices` SKILL.md is used if available. Do not reference a `references/security.md` file unless that exact file is present. Do not install a partial skill folder with broken relative links.

## Copy-ready coding AI prompt

```text
Goal

Align the platform's source documentation and active repository instructions with DEC-028, multiple provider-specific API keys, native provider adapters, and an OpenAI-compatible adapter.

Context

Read docs/PROJECT_SPEC.md, docs/ARCHITECTURE.md, docs/IMPLEMENTATION_PLAN.md, docs/DECISIONS.md, docs/AUTHENTICATION_AND_CREDENTIALS.md (especially §2), root AGENTS.md, the actual tool-specific instruction file, and available Phase 1/Phase 2 completion evidence. Do not refer to or attempt to open ChatGPT-only pasted files that are not in the repository. Locate the actual current Phase 1 and Phase 2 mini-task breakdown filenames; do not assume a suffix such as Revised (1). Inspect the complete working tree and preserve existing work.

Requirements

1. Preserve the valid local-first platform architecture for CLI, files, docs, tests, and artifacts. Clarify that model inference is remote and occurs only when explicitly enabled. Multiple provider-specific keys may coexist; one selected provider's key is used for a request.
2. Update PROJECT_SPEC.md precisely:
   - Replace the header's local-model-first/optional-hosted direction.
   - Rewrite §3 goal 9 and §11 criterion 10 to distinguish the non-AI platform core from AI features: the non-AI platform can operate without paid AI services; hosted AI inference requires a configured provider and may incur charges; all paid calls remain disabled until explicitly approved. Do not imply AI features can run without a provider.
   - Clarify §4's cloud-hosted-AI-service non-goal: the platform itself is not deployed as a cloud AI service; optional hosted provider API calls are supported when enabled.
   - Replace §8's one-local-model wording.
   - Replace local-model-first wording in §9 and §10.
   - Replace §12's hardware-dependent model-selection assumption with provider/model capability, tool use, structured output, reliability, context, pricing, quotas, data terms, and latency.
3. Update ARCHITECTURE.md precisely:
   - Replace the §2 “Local Model Runtime” diagram component with a hosted provider boundary.
   - Rewrite §3.4 as a provider-neutral port with direct provider adapters and a separate OpenAI-compatible Chat Completions adapter.
   - Document provider-specific credential mapping, model-level capability checks, structured-output schema conversion/local validation, multi-turn tool-call/tool-result messages, opaque provider continuation state, request lifecycle, and data minimization.
   - Replace §10 local-model limitations and remove/update the §11 Ollama reference.
4. Update IMPLEMENTATION_PLAN.md by inspecting its real current headings and numbering. Align the header, overview/phase table, feasibility task, Phase 3, phase exit criteria, and all remaining hosted/local-provider references. Do not fabricate section numbers. Keep Phase 4 MCP, Phase 5 agents, Phase 6 candidate validation/approval, Phase 7 release comparison, and Phase 8 UI boundaries intact.
5. Update a separate roadmap only if an authoritative roadmap file is actually present in the repo. If absent, do not create it; state that IMPLEMENTATION_PLAN.md remains the current source of phase progress. Treat historical Phase 1/2 breakdowns as read-only records.
6. Correct the Phase 1 completion-summary DEC-027 sentence to match docs/DECISIONS.md exactly: individual timedOut => normalized test failed; individual interrupted is kept separately and is not an ordinary failure/skipped; interrupted without platform timeout => infrastructure_error with playwright_process_error; platform runner timeout => timed_out with runner_timeout.
7. Reconcile the Phase 2 test count. The implementation plan says 996/27 files, while the later correction report says 999/27 files. Run the actual full suite using the repository's documented command and record the raw summary. Update the plan only to the verified current result; do not copy a prior report without checking.
8. Add sequential decision-log entries after checking the actual latest decision number. Do not edit old decisions in place. Record one decision for multi-provider support and a separate explicit amendment/extension to DEC-032 that blocks built-in provider-key names (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) as project-role credential references in addition to the reserved `AI_PROVIDER_*` namespace. State clearly that this amends DEC-032 without rewriting its historical entry. The multi-provider decision must record:
   - Built-in direct API adapters: OpenAI, Anthropic Claude, Google Gemini.
   - Multiple company-specific keys can coexist; each configured provider ID maps to its own secret environment variable and model ID.
   - A configurable OpenAI-compatible Chat Completions adapter supports providers implementing that dialect, but feature support is verified per provider/model.
   - Providers using another API protocol require a provider-specific adapter.
   - No universal API key or universal API protocol is assumed; no mandatory gateway.
   - Switching provider does not require changes to business/agent logic; no silent fallback.
   - Credentials are platform secrets, never project-role config; calls default disabled; paid use requires explicit approval.
9. Update docs/AUTHENTICATION_AND_CREDENTIALS.md §2 to retire the generic `AI_PROVIDER_API_KEY` placeholder and document distinct built-in/custom provider-key names, platform-only storage, and the fact that Phase 2 did not load or use the generic placeholder. Preserve the original Phase 2 history; update current guidance rather than rewriting completed task history.
10. Update AGENTS.md status and practical instructions based on actual repository state. Mention `software-engineering-best-practices` only as an optional skill if available in the coding session/repository. Do not refer to missing references/security.md. Do not copy an incomplete skill bundle or create broken links. Keep the reliable-ai-coding guidance.
11. Do not add provider clients, live API calls, MCP code, agent code, SQLite, UI, or any implementation dependency in this documentation-only task.

Verification

Search the entire source docs and active instructions for stale Ollama/local-model-first/provider-optional-only wording. Check all phase references, decision numbering, DEC-027 accuracy, test-count evidence, and whether the roadmap file exists. Run build/typecheck only if the full test command or doc changes require it; record exact commands and observed outputs. Inspect the complete diff. Never delete files/folders not created by this task. Run manual PowerShell checks in one powershell.exe -NoProfile -Command invocation.

Final report

List exact files changed, decision number, source sections corrected, test-count command and raw summary, DEC-027 correction, whether a roadmap existed, whether skill references are actually available, remaining inconsistencies, and verification results. Do not claim alignment if any of the named locations was not checked.
```

**Completion criteria:** The source documents and active instructions agree with DEC-028 and the user's multi-company requirement; DEC-027 is described correctly; test count matches current observed evidence; missing roadmaps/skill references are not invented; no implementation code is added.

---

# Task 3.2 — Provider Strategy and Multi-Turn Provider Contracts

**Estimated effort:** 1.5–2 hours  
**Code changes:** Yes

## Summary

Choose the smallest maintainable SDK/client strategy and define the provider-neutral request, response, error, capability, and conversation contracts. The contract must support direct OpenAI Responses, Anthropic Messages, Gemini's selected API, configurable OpenAI-compatible Chat Completions services, and future adapters without leaking vendor-specific types into business logic.

The conversation format must represent assistant tool-call turns and the corresponding tool-result messages, allowing the model to continue after tool execution in Phase 4. It must also carry opaque provider continuation state, such as Gemini thought signatures, Anthropic thinking/redacted-thinking blocks, and OpenAI encrypted reasoning items. The matching provider adapter alone interprets this state; preserve it unchanged and do not log, expose, or persist it by default.

This task defines the contract and SDK strategy only. Schema generation and runtime validation are split into Task 3.2a. Do not implement provider-specific JSON Schema conversion here.

**Expected output:** SDK/transport decision; provider-neutral request/response/error/capability types; multi-turn assistant-tool-call/tool-result message types; and an in-memory, provider/model-scoped opaque continuation-state contract.

## Copy-ready coding AI prompt

```text
Goal

Choose the provider SDK/client strategy and implement provider-neutral multi-turn request/response/error/capability contracts for multiple AI companies.

Context

Read DEC-028, the multi-provider decision from Task 3.1, DEC-026, current AGENTS.md/tool instructions, package.json/lockfile, runtime and TypeScript versions, current validation utilities, and actual provider-related source. Do not assume paths or dependencies exist.

Requirements

1. Evaluate a maintained unified TypeScript provider SDK (including direct OpenAI, Anthropic, Google, and OpenAI-compatible Chat Completions support where available) against direct official SDKs behind small adapters. Do not require a hosted gateway or gateway key. Verify tool round-trips, cancellation, usage metadata, opaque continuation support, retry controls, Node compatibility, maintenance, license, transitive dependencies, and error visibility.
2. Record whether the chosen SDK changes the work in Tasks 3.4–3.6a. If it owns translation, make those provider tasks thin adapters/configuration/capability tests; do not reimplement translation unnecessarily. Identify functionality still requiring provider-specific code. Record the choice in the next sequential DEC entry after inspecting the actual latest number.
3. Define common provider configuration identity: provider ID, adapter type, model ID, optional base URL for compatible endpoints, API-key environment-variable name, and declared capabilities. Multiple provider entries/keys must coexist. No business logic may depend on a specific provider ID.
4. Define a typed conversation message union with at least:
   - system/developer instructions where supported;
   - user messages;
   - assistant text/content messages;
   - assistant tool-call messages containing one or more stable call IDs, tool names, and untrusted JSON arguments;
   - tool-result messages linked to the originating call ID and tool name;
   - assistant turn/continuation metadata needed to resume the same provider conversation.
   Tool results must be appendable while preserving the preceding assistant tool-call turn.
5. Define an opaque provider continuation-state slot associated with the provider ID, adapter type, and model ID that created it. Only that matching adapter may interpret it. Preserve the bytes/structured payload exactly across subsequent turns; reject or explicitly clear it when switching to an incompatible provider/model. It may carry Gemini thought signatures, Anthropic thinking/redacted-thinking blocks, OpenAI encrypted reasoning items, or future provider state. Do not parse, edit, reorder, truncate, log, expose in reports/prompts, or persist this payload by default. Keep it in in-memory conversation/request context unless a later decision authorises secure persistence.
6. Define the common request/response/error/capability contract. Include instructions/messages, bounded request options, structured-output mode/schema handle (without defining schema conversion here), tool definitions/tool-choice policy, text/structured output, tool calls, finish/stop/refusal/incomplete state, usage, provider/model/request ID, timing, cancellation, and timeout. Preserve provider metadata only where useful and non-sensitive.
7. Define capability states (supported, unsupported, unknown) at provider/model/API level. Tool calling, strict JSON schema, schema keywords, usage reporting, reasoning/continuation requirements, and context size are not provider-wide guarantees.
8. Define normalized errors for missing/invalid credentials, unsupported provider/model/feature, rate limit, quota/billing exhaustion, context limit, provider unavailable, timeout/cancel, refusal, incomplete/truncated response, malformed response/tool arguments, and unknown provider errors.
9. Keep vendor SDK types inside adapters. Add tests for message union validation, multi-turn tool-call/result correlation, opaque state preservation/provider mismatch, capabilities, and errors.
10. Record the chosen SDK/direct-client strategy and exact versions. Do not implement credentials, schema generation/conversion, shared request lifecycle, vendor adapters, MCP, agent workflows, or live API tests in this task.

Constraints / non-goals

- Do not add LangChain or a general agent framework.
- Do not couple the common interface to OpenAI Responses, Chat Completions, Anthropic Messages, or Gemini-specific structures.
- Do not execute tool calls in Phase 3.
- Do not store raw thinking/continuation payloads in reports or logs.
- Do not implement JSON Schema dialect conversion in this task; that belongs to provider adapters.
- Do not commit.

Verification

Run focused contract/message tests, related Vitest tests, type-check, and build. Test tool-call/result loops and mismatched continuation providers. Inspect dependency/lockfile changes and full diff.

Final report

Describe provider config and conversation types; how tool-call/result loops work; how opaque state is preserved and scoped; provider/model capability differences; chosen SDK and versions; how that choice changes adapter task sizes; exact tests/results; and remaining limitations.
```

**Completion criteria:** The common contract supports multi-turn tool round-tripping and opaque provider continuation state; provider capabilities/errors are explicit; vendor SDK types remain behind adapters; SDK/transport choice and versions are recorded.

---

# Task 3.2a — Single-Source Structured-Output Schemas and Generic Schema Conversion

**Estimated effort:** 1.5–2.5 hours  
**Code changes:** Yes; schema dependency and contract only, no vendor adapter conversion

## Summary

Define one canonical runtime schema source for AI structured outputs and use that same definition for local response validation and provider-side JSON Schema generation. Zod 4 is the preferred choice because it supports runtime parsing and JSON Schema conversion. Verify compatibility with the repository's installed Node.js/TypeScript versions and the chosen provider SDK before adopting it.

If Zod 4 is suitable, add it as a deliberate runtime dependency for AI output schemas and record a new decision explaining the scope. This does **not** replace the custom Phase 1 project-config validator described by DEC-026. If Zod 4 is not suitable, record why and choose another single-source mechanism rather than maintaining duplicated schemas.

This task defines a generic conversion extension point only. OpenAI strict-mode requirements, Anthropic-specific output schema handling, Gemini's supported subset, and OpenAI-compatible endpoint differences belong in their respective adapter tasks (3.4–3.6a), not the shared schema layer.

**Expected output:** A canonical schema definition/registry, local validation using that same schema, generated JSON Schema, a generic adapter conversion interface, and a sequential decision documenting the schema-library choice.

## Copy-ready coding AI prompt

```text
Goal

Implement one source of truth for AI structured-output schemas, deriving both provider JSON Schema and local runtime validation from the same schema definition.

Context

Read Task 3.2 contracts and SDK decision, DEC-026, package.json/lockfile, installed Node.js/TypeScript versions, the selected SDK's schema interfaces, and current official Zod 4 documentation. Inspect existing validation patterns. Do not change Phase 1 project-config validation.

Requirements

1. Evaluate Zod 4 compatibility with the actual runtime, TypeScript version, build target, ESM setup, and selected SDK. Prefer Zod 4 if compatible because `z.toJSONSchema()` and runtime parsing can derive from one schema definition.
2. If compatible, add Zod 4 as a runtime dependency for AI structured outputs only. Record a new sequential DEC entry with the rationale, package/version, scope, and explicit statement that DEC-026's Phase 1 custom project-config validator is unchanged. If incompatible, document the exact incompatibility and select a maintained alternative that still derives JSON Schema and local validation from one canonical definition; record that decision instead.
3. Define a canonical schema abstraction/registry accepted by the provider-neutral request contract. The canonical source must be the same object/definition used to create provider JSON Schema and validate the returned value locally.
4. Add a generic schema-export/conversion interface that takes the canonical generated JSON Schema plus provider/model capability context and returns either a provider-ready representation or a typed unsupported-schema result. Do not place OpenAI, Anthropic, Gemini, or compatibility-endpoint rules in this shared module.
5. Validate every returned structured result locally with the canonical runtime schema, even when provider-side structured output is enabled. Distinguish invalid JSON, schema-invalid data, refusal, and incomplete output.
6. Keep schema definitions versionable and deterministic. Do not persist full provider prompts or raw model output as part of the schema registry.
7. Add tests proving JSON Schema generation and local validation derive from the same schema, including required/optional/null handling, nested objects/arrays/enums, invalid data, and an unsupported conversion result.
8. Keep the Phase 1 custom project-config validator and DEC-026 behaviour unchanged. Do not migrate Phase 1 or Phase 2 schemas to Zod as part of this task.
9. Do not implement vendor adapters or provider-specific schema lowering; Tasks 3.4–3.6a own those.

Constraints / non-goals

- No vendor-specific schema dialect logic in the shared schema module.
- No general agent framework, MCP integration, or live provider calls.
- Do not keep independently maintained runtime and JSON schemas for the same output contract.
- Do not commit.

Verification

Run focused schema tests, related Vitest tests, type-check, and build. Inspect dependency/lockfile changes, generated schema examples, local validation results, and the full diff.

Final report

State whether Zod 4 was adopted, exact package/version and compatibility evidence, the schema registry/conversion contract, local validation evidence, tests/results, and any provider-specific conversion work deferred to adapter tasks.
```

**Completion criteria:** The same canonical definition generates JSON Schema and validates model output locally; a generic conversion contract exists; no provider dialect details leak into the shared schema module; DEC-026's Phase 1 validator remains unchanged; the schema-library decision is recorded.

---

# Task 3.3 — Platform Provider Configuration and Isolated API-Key Handling

**Estimated effort:** 2–3 hours  
**Code changes:** Yes

## Summary

Allow several company-specific API keys to coexist in platform-local configuration. Store non-secret provider entries in tracked `config/ai-providers.json`; store actual keys and the explicit enable flag in the ignored root `.env` file (parsed into a separate object); and store the cumulative ledger in ignored `.qa-platform/usage-ledger.json`. The active provider entry maps to exactly one matching key environment variable and model ID. Direct providers use conventional variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`; every additional provider must use its own `AI_PROVIDER_<PROVIDER_ID>_API_KEY` variable. Do not allow custom provider-key names outside the `AI_PROVIDER_` namespace. Do not introduce or automatically use a universal `AI_PROVIDER_API_KEY` value.

A critical security boundary is environment loading. Do not load the platform `.env` using `process.loadEnvFile()` or `dotenv.config()` if that places provider secrets in `process.env` and then exposes them through child-process inheritance. Prefer parsing `.env` into a separate object (`util.parseEnv` when supported by the installed Node version) and keeping provider secrets in a dedicated in-memory secret map. OS environment variables may also contain provider keys, so when building the Playwright child environment, start from the environment the runner currently inherits and remove every registered provider-secret variable name plus every case-insensitive variable name beginning `AI_PROVIDER_`. Also explicitly remove the built-in key names `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY` even if a config entry is malformed or missing. Preserve unrelated inherited Windows variables (including those needed for browser discovery such as `LOCALAPPDATA`, `USERPROFILE`, and `PLAYWRIGHT_BROWSERS_PATH`). Preserve the existing Phase 1/2 test-credential behaviour exactly. Do not create a new project credential-loading or injection mechanism in Phase 3, and do not assume that role declarations in project configuration cause credentials to be loaded into the Playwright child environment. Do not blanket-clear or replace the child environment with a short allowlist.

AI calls must be disabled by default: if the enable flag is absent, malformed, or false, no network request is allowed. The user must explicitly enable provider calls and have a valid selected provider/model/key. Extend DEC-032 through a new sequential decision-log amendment; do not rewrite the historical DEC-032 entry. Project-role environment references must not point to built-in platform provider keys or the reserved custom-provider key namespace.

**Expected output:** Tracked `config/ai-providers.json` with provider metadata only; ignored `.env` for actual provider keys and the default-off enable flag; ignored `.qa-platform/usage-ledger.json`; isolated secret loading; provider-secret removal from inherited Playwright child environments without breaking unrelated Windows variables; and regression evidence for the existing test-credential behaviour.

## Copy-ready coding AI prompt

```text
Goal

Implement platform-level multi-provider selection and secret resolution without leaking provider API keys into process-wide or Playwright child-process environments.

Context

Read DEC-028, the multi-provider decision, the Task 3.2 contract/SDK decision, Task 3.2a schema decision, DEC-032, docs/AUTHENTICATION_AND_CREDENTIALS.md, Phase 2 .env conventions, .gitignore, actual Node version, startup path, project config loader, Playwright process runner, and tests. Inspect the actual .env.example and whether a real .env file exists. Preserve its contents unless the user explicitly authorises a change.

Requirements

1. Use these explicit platform paths unless repository inspection reveals a concrete conflict and a replacement is recorded before implementation:
   - `config/ai-providers.json`: tracked, non-secret provider entries (provider ID, adapter type, model, base URL where applicable, and secret environment-variable name only).
   - root `.env`: Git-ignored, user-managed provider key values plus `AI_ENABLED=false` by default. Parse without mutating `process.env`; a missing, malformed, or false enable flag means disabled. Never edit/delete an existing real `.env` file or its contents without explicit user approval.
   - `.qa-platform/usage-ledger.json`: runtime-created cumulative request/input/output usage ledger; add `.qa-platform/` (or at minimum this ledger path) to `.gitignore`. This file must never be committed.
2. Support multiple provider entries/keys concurrently. Each provider entry includes a stable provider ID, adapter type, model ID, secret environment-variable name, and (for compatible providers) base URL. Selecting provider A must never resolve provider B's key. No business/agent code should need editing when switching providers.
3. Direct built-in keys must use the conventional names `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`. Every additional provider entry must use a distinct provider-specific key variable following `AI_PROVIDER_<PROVIDER_ID>_API_KEY`. Do not allow custom provider-key names outside the reserved `AI_PROVIDER_` namespace in Phase 3.
4. Deprecate the old generic Phase 2 placeholder `AI_PROVIDER_API_KEY`. Do not treat it as a universal key, do not silently copy it to provider-specific variables, and do not automatically fall back to it. Update `.env.example` to show `AI_ENABLED=false` and separate provider variables with placeholders only. Preserve a user's real `.env` file and all real values; do not delete/rewrite/migrate the real file without explicit permission. If the legacy variable is present, report a redacted migration warning only.
5. Inspect installed Node version. Prefer `util.parseEnv(fileContent)` where available because it returns a separate object. Do not use `process.loadEnvFile()` or `dotenv.config()` for provider-key loading if it mutates `process.env`. If `util.parseEnv` is unavailable, choose a safe parser that returns a separate object without side effects; verify its behaviour and version. Do not add dotenv without explicit technical justification.
6. Resolve secrets into a dedicated in-memory secret map and pass the selected key explicitly to the provider adapter. Avoid logging or serializing the map. Do not put values in command-line arguments, project config, role config, prompts, tests, reports, or generated files.
7. Set provider calls disabled by default. Key presence alone must never enable inference. If the enable flag is absent, malformed, or false, or provider/model/key/configuration is invalid, fail before network activity.
8. Extend DEC-032/project-role validation through the new sequential amendment recorded in Task 3.1: reject references to `AI_PROVIDER_*` and the built-in provider key variables `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`. Preserve ordinary project credentials such as `SAUCEDEMO_USERNAME` and `SAUCEDEMO_PASSWORD`. For custom providers, use the reserved `AI_PROVIDER_<PROVIDER_ID>_API_KEY` prefix so the platform-secret rule remains enforceable.
9. Inspect how the Phase 1 runner currently constructs the Playwright child environment. Start from its current inherited environment and remove every registered platform provider-secret environment-variable name, every variable name beginning `AI_PROVIDER_` (case-insensitive), and the built-in names `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GEMINI_API_KEY`, even if a provider entry is missing or malformed. Do not use a short allowlist: preserve unrelated inherited Windows variables, including `LOCALAPPDATA`, `USERPROFILE`, `PLAYWRIGHT_BROWSERS_PATH`, `PATH`, `SystemRoot`, and required temp/profile variables. Preserve only the current target-app test-credential behaviour; do not load role credentials from project config or `.env`, add a new credential-injection path, or strip ordinary inherited environment variables. Verify what the runner actually does rather than assuming project declarations are injected.
10. Keep provider API keys out of browser content, project documents, role configuration, authentication state, and child-process command arguments. Redact secret names/values in diagnostics where appropriate.
11. Add tests for multiple keys present, selecting each provider, missing/invalid key, wrong-provider key mapping, disabled-by-default behaviour, legacy generic placeholder handling, DEC-032 amendment coverage, provider-secret stripping from inherited child env, preservation of unrelated Windows variables, unchanged current test-credential behaviour, and redaction.

Constraints / non-goals

- Do not make provider requests or implement vendor adapters.
- Do not put keys in project.config.json or role credentials.
- Do not load provider keys into global process.env.
- Do not remove unrelated environment variables required by target test execution.
- Do not automatically use AI_PROVIDER_API_KEY.
- Do not commit.

Verification

Run focused config/secret/runner tests; confirm actual Node/env parsing behaviour; use `git check-ignore -v` to verify `.env` and `.qa-platform/usage-ledger.json` are ignored and `config/ai-providers.json` plus `.env.example` are not ignored; verify the ledger path cannot be committed; run all four existing Phase 1 runner fixtures (passing, failing, no-tests, hanging) and the SauceDemo CLI smoke test with the actual repository configs; then run full relevant Vitest, type-check, and build. Run any manual PowerShell checks in one `powershell.exe -NoProfile -Command` invocation. Inspect logs/test output to ensure no secret values appear. Inspect the full diff.

Final report

List provider configuration shape, all default/custom key env names, `.env` parsing method and Node compatibility, default-disabled proof, new DEC-032 amendment, tracked/ignored file locations and `git check-ignore` evidence, inherited child-env secret filtering, preserved Windows variables and unchanged test-credential behaviour, four-fixture and SauceDemo regression results, test commands/results, and unresolved limitations.
```

**Completion criteria:** Multiple provider-specific keys can coexist; only the selected adapter receives its matching key; keys do not enter global `process.env` or Playwright child processes; existing project test-credential behaviour is unchanged and no new credential injection path is added; API calls default to disabled.

---

# Task 3.3a — Shared Request Lifecycle, Retry Policy, Cumulative Usage Controls, and Safe Diagnostics

**Estimated effort:** 2.5–3.5 hours  
**Code changes:** Yes

## Summary

Implement the shared request lifecycle before any vendor adapters are added. Adapters must only translate provider-specific requests/responses into the common contract; they must not implement their own timeout/retry/usage policy. The shared layer owns timeout, cancellation, retry, rate limits, normalised errors, usage metadata, cumulative budgets, safe logs, and provider disablement.

Retries must be bounded and based on the actual provider error/`Retry-After` information. Do not automatically retry ambiguous network timeouts if the request may already have been accepted and billed. Do not automatically switch to a different provider. Usage safeguards must persist across CLI invocations and process restarts; per-run counters alone are not a budget. Track cumulative requests and observed token usage in a local JSON ledger consistent with DEC-029 (no SQLite). Apply hard per-request input-size (character) and output-token maximums, plus separate cumulative request, input-token-estimate, and output-token ceilings for the approved budget window. Where a provider offers account-level spend/quota controls, require the user to configure them when available and record the setting; do not claim that every provider offers an enforceable dollar cap. Cost estimates must be labelled estimates and never presented as a guaranteed hard spend cap.

**Expected output:** One shared request lifecycle used by every adapter, SDK-level retries disabled, bounded retries owned by one layer, cross-run request/token accounting, per-request output caps, useful non-sensitive diagnostics, and no silent fallback or unbounded retries.

## Copy-ready coding AI prompt

```text
Goal

Implement shared provider request lifecycle, bounded usage controls, rate-limit/error handling, and safe diagnostics before any provider adapter is implemented.

Context

Read DEC-028, the provider contract/SDK decision from Task 3.2, canonical schema/conversion contract from Task 3.2a, provider config and file-path decisions from Task 3.3, the selected SDK's current official retry/timeout/cancellation documentation, and existing CLI/logging conventions. Provider adapters have not been implemented yet; do not assume they exist. Inspect how the current app handles AbortSignal, child processes and environment variables. Preserve existing Phase 1 test-runner behaviour.

Requirements

1. Add a shared request lifecycle contract/service before provider adapters exist: per-request timeout, caller cancellation, bounded attempt count, and a consistent completion/error result. Vendor adapters will call through this service later and must not duplicate lifecycle logic.
2. Map provider-specific errors into the shared categories without discarding safe diagnostic codes, response/request IDs, HTTP status, or Retry-After where available.
3. Establish one retry owner: disable automatic retries in underlying SDKs (for example, configure OpenAI/Anthropic `maxRetries: 0`; configure Google Gen AI SDK retry attempts to one total attempt where the installed SDK supports that option). Verify the exact option for the selected SDK/version. If a unified SDK is chosen, verify and disable its underlying provider transport retries too. The shared service alone may retry. Respect Retry-After only for response classes known to be safe to retry; do not retry an ambiguous timeout/network disconnect if the request may already have been accepted or billed.
4. Never silently fall back to another provider/model. Cross-provider fallback changes data recipient, privacy terms, capabilities, and cost, so it must remain disabled unless a future explicit policy and user consent authorise it.
5. Collect available request usage metadata: input/output tokens or provider-equivalent counts, provider/model, request ID, duration, attempt count, stop reason, and safe error category. Missing usage data must remain unknown, not be estimated as an observed fact.
6. Enforce a hard per-request input-size ceiling in characters and a hard maximum output-token count before sending. Track cumulative request count and provider-reported input/output token usage across multiple CLI invocations in the ignored `.qa-platform/usage-ledger.json` (DEC-029; no SQLite). For preflight, use a documented conservative character-based input-token estimate with a safety margin; token-counting API calls are not required. Reserve the estimated input amount plus the requested maximum output tokens before sending, then reconcile input/output reservations against provider-reported usage. Keep estimated and observed usage as separate fields; never label an estimate as actual usage. The estimate is a local safeguard, not a guaranteed tokenizer-exact cap, so retain the hard input-character limit and provider-side account quota/spend controls where available. If provider usage is missing, retain the reservation or mark it unknown conservatively rather than freeing budget. The ledger must not contain prompts, outputs, keys, or other sensitive payloads. Define the budget window/reset mechanism explicitly; do not reset counters automatically on each process start. Use an atomic/concurrency-safe update appropriate to the single-user CLI. Keep budgets at platform scope, not project config or role credentials. If the provider offers account-level budget/quota limits, record that the user configured them; where unavailable, say so. Cost estimates must state price source/date and remain estimates.
7. Add a central disable switch that prevents external provider requests before network activity. Missing credentials or disabled configuration must fail before a request is sent.
8. Log safe operational metadata only. Do not log API key values, authorization headers, full prompts, uploaded documents, complete request/response bodies, tool arguments that may contain secrets, or unredacted provider error bodies. Include enough correlation metadata to diagnose a failure.
9. Preserve refusal, incomplete/truncated output, unsupported capability, invalid structured output, rate-limit, quota/credit exhaustion, timeout, cancellation, and provider-unavailable distinctions.
10. Define a deliberate budget-ledger reset/rollover operation that requires explicit user action and records which budget window was reset. No silent reset at process start or on a failed request.
11. Keep monetary cost as a separately labelled estimate based on dated provider pricing; do not make local token estimates look like provider invoices.
12. Test cross-provider contract consistency with fake clients, including timeout, abort, rate-limit/Retry-After, quota exhaustion, malformed provider bodies, safe redaction, usage missing/present, request ceiling reached, token ceiling reached, and disabled provider.
13. Verify that Playwright child-process environments remain free of platform provider secrets and that existing project test-credential behaviour is unchanged. Do not create a new credential-loading or injection path in Phase 3, and do not assume that credentials declared in project configuration are automatically present in the child environment.

Constraints / non-goals

- Do not add a database or persist full model prompts/responses.
- Do not make provider calls during ordinary unit tests.
- Do not promise exact cost accounting for providers/models without verified pricing and usage data.
- Do not add silent retries or alternate-provider fallback.
- Do not weaken any test to obtain a passing result.
- Do not commit.

Verification

Run focused lifecycle/usage tests with fake provider clients, common-contract tests, relevant Phase 1 runner security tests, full relevant Vitest, type-check, and build. Do not claim vendor adapter integration is verified in this task; Tasks 3.4–3.6a must prove each adapter uses this lifecycle. Review logs/test output for accidental secret or payload exposure. Inspect the full diff.

Final report

List retry/timeout/usage policies, normalised errors, diagnostic metadata, cost-estimation limitations, secret-redaction evidence, test commands/results, and anything not verified.
```

**Completion criteria:** Every adapter will use one shared bounded lifecycle; SDK retries are disabled; shared retry policy is the only retry owner; per-request input-size/output-token and cross-run cumulative request/input-estimate/output-token ceilings work; disabled mode blocks network calls; logs contain safe metadata only; no silent provider fallback or unbounded retry exists.

---

# Task 3.4 — OpenAI Provider Adapter

**Estimated effort:** 1.5–2.5 hours  
**Code changes:** Yes

## Summary

Implement the OpenAI adapter against the current supported OpenAI API and SDK. Use the provider-neutral contract from Task 3.2, canonical schema contract from Task 3.2a, platform credentials from Task 3.3, and shared lifecycle from Task 3.3a. This adapter must be a translation layer, not a second implementation of timeout/retry/budget logic. Verify the current official API path (for example, the Responses API where appropriate) rather than copying legacy Chat Completions or Assistants examples without justification.

Translate supported structured-output requests, text responses, tool-call requests/results, finish reasons, usage metadata, request IDs, and errors into the shared contract. The adapter may request tool execution, but must return the normalised tool call to the caller; it must not execute browser or MCP tools itself.

**Expected output:** An OpenAI adapter with mocked request/response tests and a controlled live smoke test only when an OpenAI API key and usage approval are available.

## Copy-ready coding AI prompt

```text
Goal

Implement the direct OpenAI API adapter using the Phase 3 provider-neutral contract.

Context

Read the provider port/SDK decision from Task 3.2, provider configuration from Task 3.3, DEC-028, and current official OpenAI API documentation for authentication, Responses, function calling, structured outputs, usage, errors, and rate limits. Inspect the installed SDK version and nearby adapter/test patterns before editing.

Requirements

1. Implement only the OpenAI adapter under the existing model-provider module boundary. Do not add OpenAI-specific code to CLI handlers or business logic.
2. Use the current supported native OpenAI API/SDK path after checking official documentation and migration/deprecation guidance. Record the exact package version. Prefer the currently recommended Responses API where appropriate; this direct adapter is distinct from the separate OpenAI-compatible Chat Completions adapter in Task 3.6a.
3. Receive the API key explicitly from the platform credential boundary. Do not read or log arbitrary environment values inside business logic.
4. For the Responses API, set `store: false` on every request to avoid server-side response-state storage by default. Map the common multi-turn message contract to OpenAI request structures and normalise text/content, assistant tool calls, tool results, finish reason, request ID, usage, and safe error metadata. Preserve all returned output items needed for continuation in their original order. Current OpenAI documentation states that stateless responses include encrypted reasoning content by default; use `include: ["reasoning.encrypted_content"]` only where the selected API/SDK version requires or documents it for compatibility, rather than assuming the legacy include flag is always mandatory.
5. Implement OpenAI-specific schema lowering from the canonical schema/conversion interface in Task 3.2a. For strict Structured Outputs, verify current API requirements, including `additionalProperties: false` for objects and every property required; represent semantically optional values with an appropriate nullable representation. Reject schemas whose meaning cannot be preserved. Retain local runtime validation against the canonical schema after receiving the result; do not trust provider-side constraints as the only validation.
6. Map function/tool definitions and tool-call responses into the provider-neutral tool-call structure. Preserve provider call IDs and argument text/JSON safely. Do not execute tool calls or connect to Playwright MCP.
7. Translate provider errors, refusals, incomplete/truncated responses, unsupported features, malformed arguments, authentication failures, rate limits, quota/billing errors, and context limits into the shared error contract. Delegate timeout, cancellation, retry, and request-budget policy to Task 3.3a.
8. Add mocked tests for a normal text response, valid structured output, multiple tool calls where supported, malformed/invalid arguments, refusal/incomplete response, usage metadata, auth/rate-limit/quota errors, timeout/cancellation, and request ID propagation.
9. Preserve and replay returned reasoning items (including any `encrypted_content`) unchanged in the next stateless Responses request, interleaved with tool-call and tool-result items in their original order. Treat the item as opaque continuation state: do not parse, log, display, persist, or expose it outside the provider adapter. Add mock tests for a reasoning response followed by a tool call/result and a second model response, asserting `store: false` on both requests and exact continuation-item preservation.
10. Configure the official SDK with automatic retries disabled (`maxRetries: 0`, or the exact equivalent in the selected installed version) so Task 3.3a is the sole retry owner. Do not assume a global SDK default is safe.
11. Add no live API test to routine Vitest. A controlled smoke test may run only when `OPENAI_API_KEY` (or the explicitly mapped secret) is present, provider calls are enabled, and the user has approved request, per-request input/output, cumulative input/output-token, and budget limits. Report if not run.

Constraints / non-goals

- Do not add OpenAI-specific assumptions to shared interfaces.
- Do not store full request/response bodies by default.
- Do not make automatic fallback to Anthropic or Gemini.
- Do not change Phase 1 Playwright execution semantics except for the secret boundary established in Task 3.3.
- Do not commit.

Verification

Run adapter contract tests, relevant shared provider tests, full relevant Vitest, type-check, and build. If a live smoke test is authorised, record model ID, request count, usage/cost data returned, and actual result without exposing the key or private prompt content.

Final report

List files and package versions, supported OpenAI behaviours, unsupported capabilities/limitations, mocked test results, whether a live test ran, exact commands/results, and remaining risks.
```

**Completion criteria:** OpenAI requests/responses conform to the shared contract; structured outputs are locally validated; tool calls are returned but not executed; mocked failure and success cases pass; live verification is accurately reported.

---

# Task 3.5 — Anthropic Claude Provider Adapter

**Estimated effort:** 1.5–2.5 hours  
**Code changes:** Yes

## Summary

Implement a direct Anthropic Claude API adapter using the current Messages API and current structured-output/tool-use capabilities supported by the selected models. Anthropic's request format, tool-use blocks, tool-result messages, stop reasons, and authentication differ from OpenAI; map them into the same provider-neutral contract without leaking Anthropic types outside the adapter.

**Expected output:** An Anthropic adapter with mocked request/response tests and a controlled live smoke test only when an Anthropic API key and usage approval are available.

## Copy-ready coding AI prompt

```text
Goal

Implement the direct Anthropic Claude API adapter using the Phase 3 provider-neutral contract.

Context

Read the provider port/SDK decision from Task 3.2, canonical schema contract from Task 3.2a, provider configuration from Task 3.3, shared lifecycle from Task 3.3a, DEC-028, the OpenAI adapter as a pattern (not as a protocol to copy), and current official Anthropic documentation for API-key authentication, Messages API, tool use, structured outputs, usage, errors, and rate limits. Inspect installed package versions before editing.

Requirements

1. Implement only the Anthropic adapter inside the existing model-provider boundary. Keep Anthropic message/content block types inside the adapter.
2. Use the current supported Claude API/SDK and model-ID conventions. Verify current version/headers through official docs and installed SDK source. Do not copy obsolete beta headers or an out-of-date structured-output request shape.
3. Receive the Anthropic API key explicitly through the platform credential boundary. Support any additional workspace/header requirement only when the selected key/configuration requires it; do not expose key values.
4. Normalise user/system messages, returned text/content blocks, stop reason, request ID, usage, and provider errors into the shared contract.
5. Map tool-use blocks and tool-result round trips to the shared tool-call representation. Preserve each tool-use ID and JSON input. Do not execute tool calls or connect to Playwright MCP.
6. Implement Anthropic-specific schema lowering from the canonical Task 3.2a schema/conversion interface, following the current Messages API and structured-output requirements for the selected model. Validate the resulting object locally against the canonical runtime schema. If a selected Claude model or endpoint does not support the requested schema feature or constraint, return an explicit unsupported-schema/feature error; do not silently downgrade or drop constraints.
7. Translate refusals, incomplete output, malformed tool input, authentication/permission failures, rate limits, quota/credit exhaustion, context limits, and provider errors into the shared error model. Delegate timeout, cancellation, retry, and budget policy to Task 3.3a.
8. Add mocked tests for normal text, structured output, tool-use request/result, multiple tool calls where supported, missing/invalid arguments, stop reasons, usage, auth/permission/rate-limit/credit errors, and opaque thinking/redacted-thinking continuation blocks preserved byte-for-byte/semantically unchanged where required by the API.
9. Configure the official Anthropic SDK with automatic retries disabled (`maxRetries: 0`, or the exact current option). Task 3.3a is the only retry owner. Verify the installed SDK version and do not rely on defaults.
10. Keep live API tests outside routine Vitest. Run a bounded smoke test only when `ANTHROPIC_API_KEY` (or the agreed mapped secret) is present, provider calls are enabled, and user-approved limits exist for total requests, maximum input tokens per request, maximum output tokens per request, cumulative input tokens, cumulative output tokens, and spend. Otherwise record not live-verified.

Constraints / non-goals

- Do not make all models appear to have identical capabilities.
- Do not add a separate Claude agent framework or MCP implementation.
- Do not log full prompt/response content or secret values.
- Do not add automatic cross-provider fallback.
- Do not commit.

Verification

Run Anthropic adapter contract tests, including provider-specific schema conversion and rejection of unsupported constraints, shared provider tests, full relevant Vitest, type-check, and build. If live testing is authorised, record model ID, request count, usage/cost metadata returned, and observed outcome without exposing the key or private prompt content.

Final report

List files/package versions, supported Claude behaviours and model constraints, mocked test results, whether a live test ran, exact commands/results, and remaining limitations.
```

**Completion criteria:** Claude requests/responses are correctly normalised; tool-use requests are preserved for later orchestrator handling; structured outputs are locally validated; mocked success/failure cases pass; live verification is accurately reported.

---

# Task 3.6 — Google Gemini Provider Adapter

**Estimated effort:** 1.5–2.5 hours  
**Code changes:** Yes

## Summary

Implement a direct Google Gemini API adapter using the currently recommended Google GenAI SDK/API. Gemini has its own function-call/function-response structures, schema subset, finish reasons, and API key header; normalise these differences through the common provider contract.

Verify which current Gemini API mode and SDK should be used (for example, the currently documented Interactions or Generate Content APIs) rather than blindly copying older `generateContent` examples. Feature support may differ across Gemini model generations; represent unsupported combinations explicitly.

**Expected output:** A Gemini adapter with mocked request/response tests and a controlled live smoke test only when a Gemini API key and usage approval are available.

## Copy-ready coding AI prompt

```text
Goal

Implement the direct Google Gemini API adapter using the Phase 3 provider-neutral contract.

Context

Read the provider port/SDK decision from Task 3.2, canonical schema contract from Task 3.2a, provider configuration from Task 3.3, shared lifecycle from Task 3.3a, DEC-028, the existing provider adapters, and current official Google Gemini API documentation for API keys, SDK/API selection, function calling, structured output, usage, errors, and quotas. Inspect the current installed SDK and version before coding.

Requirements

1. Implement only the Gemini adapter within the existing provider boundary. Keep Gemini request/response types out of shared business logic.
2. Use the currently recommended supported Google GenAI SDK/API after comparing current official documentation and the installed package. Determine whether the Interactions API or Generate Content API is appropriate for the required text, tool and structured-output round trips. Do not assume an older endpoint is still the best option.
3. Receive the Gemini API key explicitly from the platform credential boundary. Use the current SDK's supported authentication mechanism; do not place the key in prompts, logs or command-line arguments.
4. Normalise message/content parts, text response, finish reason, response ID, usage metadata, and safe provider diagnostics into the shared contract.
5. Map function-call and function-response structures into the common tool-call representation, preserving call IDs and arguments. Do not execute tools or connect to Playwright MCP. Preserve Gemini thought-signature data exactly as returned (including signatures carried on content/function-call parts or dedicated thought steps, depending on the selected API). For stateless multi-turn flows, resend the exact preceding model parts/steps with signatures in their original order alongside the tool result; never strip, rewrite, merge, or reorder signed parts.
6. Implement Gemini-specific schema lowering from the canonical Task 3.2a schema/conversion interface, using the exact selected API/model-supported JSON Schema subset. Run local runtime validation after the response. If the schema is unsupported or too complex, return an explicit typed error; do not silently drop constraints.
7. Represent model/API capability differences, including structured output/tool support. Do not mark all Gemini models as supporting all features merely because the provider family supports them.
8. Translate missing/invalid key, invalid model, unsupported feature, malformed response, safety/refusal finish reasons, rate limit/quota exhaustion, context limit, and provider outage into the shared error model. Delegate timeout, cancellation, retry, and budget policy to Task 3.3a.
9. Configure the selected Google Gen AI SDK's automatic retry mechanism to one total attempt (for the current SDK family, verify the installed version's `httpOptions.retryOptions.attempts` behaviour and set it to `1` when applicable). Do not let the SDK retry independently of Task 3.3a. If a unified SDK is used, verify and disable the underlying Google transport retries as well. Add a test or client-construction assertion proving the effective retry setting.
10. Add mocked tests for text responses, structured JSON, function calls and function responses, malformed arguments, unsupported schema/model feature, safety/refusal response, usage metadata, auth/quota/rate-limit errors, and timeout/cancellation. Include an explicit stateless function-call round-trip test where a returned Gemini thought signature is preserved byte-for-byte/in the exact SDK response-part structure and sent back unchanged with the corresponding tool result on the next request; test that removing/reordering the signed part is detected as a failure. Cover the selected API's exact signature representation (for example `thoughtSignature`/SDK equivalent, or Interactions API thought-step `signature`) rather than hardcoding one name across all APIs.
11. Do not put live API calls in routine Vitest. Run a bounded smoke test only when `GEMINI_API_KEY` (or the agreed mapped secret) exists and user-approved usage limits are configured. If not available, state that the adapter is mock-tested but not live-verified.

Constraints / non-goals

- Do not require Google Vertex AI or a Google Cloud project unless a separate provider option is explicitly chosen; the initial requested provider is direct Gemini API access.
- Do not add a general agent framework or implement MCP.
- Do not assume all JSON Schema features are supported by Gemini.
- Do not add automatic provider fallback.
- Do not commit.

Verification

Run Gemini adapter contract tests, shared provider tests, full relevant Vitest, type-check, and build. If live testing is authorised, record the model ID, request count, usage/quota metadata available, and actual result without exposing the key or private request content.

Final report

List files/package versions, selected Gemini API/SDK and reason, supported capabilities/limitations, mocked test results, whether live testing ran, exact commands/results, and remaining risks.
```

**Completion criteria:** Gemini requests/responses conform to the shared contract; function calls are returned but not executed; structured outputs are validated locally; provider/model capability differences are explicit; mocked success/failure tests pass.

---

# Task 3.6a — Configurable OpenAI-Compatible Chat Completions Adapter

**Estimated effort:** 2–3 hours  
**Code changes:** Yes

## Summary

Add a distinct adapter for additional AI companies/services that expose an OpenAI-compatible Chat Completions API. A single adapter can serve multiple configured provider entries with separate provider IDs, base URLs, model IDs, and API-key environment variables. Examples may include compatible services such as Groq, but each company's current compatibility documentation and feature support must be checked before claiming it works.

This adapter is intentionally separate from the native OpenAI adapter, which may use the Responses API. It must translate the Chat Completions dialect into the common conversation contract. It must not assume perfect feature parity: structured-output formats, tool calling, stop reasons, usage metadata, request headers, and model names vary by provider. Capabilities must be confirmed/documented per configured provider/model.

Because the base URL is configurable, treat endpoint configuration as a security boundary. External URLs must use HTTPS; reject URL credentials, unexpected query/fragment data, and cross-origin redirects that could disclose an Authorization header. Local/private endpoints may be allowed only through an explicit, documented opt-in rather than silently bypassing network restrictions. Endpoint configuration is platform-level and must never be loaded from project documents or browser content.

**Expected output:** One tested compatibility adapter that can be instantiated for multiple provider configurations without changing business logic, plus provider-specific capability profiles and safe endpoint validation.

## Copy-ready coding AI prompt

```text
Goal

Implement a configurable OpenAI-compatible Chat Completions adapter for additional AI companies/services without coupling the application to any one company.

Context

Read the Task 3.2 provider/conversation contract, Task 3.2a canonical schema/conversion contract, Task 3.3 platform provider registry and key mapping, Task 3.3a shared lifecycle, the direct OpenAI adapter, and current official documentation for the candidate company/API. Inspect the current compatibility adapter support in any selected unified SDK before adding transport code.

Requirements

1. Implement one adapter type for the documented OpenAI-compatible Chat Completions dialect. It must support multiple separately configured provider entries with distinct provider IDs, API-key env names, base URLs, and model IDs. Do not hard-code a fixed list of companies into business logic.
2. Use the installed/selected SDK or a small typed HTTP client to call Chat Completions. Do not route this adapter through native OpenAI Responses request translation. Reuse low-level utilities only where they do not erase protocol differences.
3. Treat compatibility as a dialect contract, not as full OpenAI equivalence. Verify each configured provider's official docs for authentication, model ID format, tool calling, JSON/schema mode, usage, finish reasons, and request options. Represent unsupported/unknown capabilities honestly and reject unsupported requests instead of silently downgrading.
4. Support common messages and assistant tool-call/tool-result round-trips where that provider supports them. Preserve call IDs and untrusted arguments. Also preserve provider-specific continuation extensions required for a subsequent turn rather than dropping unknown response fields. In particular, Google documents Gemini 3 thought-signature support through its OpenAI-compatible Chat Completions endpoint; verify the exact field/SDK representation against current Google documentation and raw request/response fixtures, then carry it unchanged through the next tool-result turn. Do not execute tools.
5. Support structured output only when the configured endpoint/model supports the required schema mode. Use the Task 3.2a canonical schema and local validator. Apply a provider-specific schema compatibility check; do not silently strip constraints.
6. Resolve the provider-specific key through the Task 3.3 secret map and pass it explicitly. Never read a generic universal key. Never log credentials or full payloads.
7. Validate base URL: require HTTPS for external endpoints; reject URL userinfo, query strings, and fragments; block cross-origin redirects from forwarding authorization; define a deliberate explicit opt-in for loopback/private custom endpoints if the project needs them. Never take base URL from a project document or tool result. Prevent endpoint settings from becoming an SSRF or credential-exfiltration path.
8. Disable the underlying client's automatic retries so Task 3.3a is the single retry owner. Use the shared timeout, cancellation, usage ledger, output-token cap, and error handling.
9. Add mocked contract tests for at least two distinct provider configurations, key isolation, valid/invalid base URLs, redirects, text response, tool-call/result round-trip, provider-specific continuation-extension preservation, usage/missing usage, malformed responses, unsupported structured schema, unsupported capabilities, auth/rate-limit/quota errors, and retry configuration. Include a Gemini OpenAI-compatibility fixture with a thought-signature extension if the selected Gemini model/API returns one; assert that it survives the response-to-next-request round trip unchanged.
10. Include a short provider onboarding checklist: evidence of compatibility, capability tests, environment variable name, base URL validation, model ID, data terms, pricing/quota, and mock/live test status.
11. Optional interoperability smoke test: Google currently documents its Gemini API behind an OpenAI-compatible Chat Completions endpoint (`https://generativelanguage.googleapis.com/v1beta/openai/`) using a Gemini API key, and documents function calling and Gemini 3 thought-signature compatibility on that endpoint. If a Gemini key is already configured and the user explicitly approves testing this compatibility endpoint/model under the same applicable request/input/output/spend caps, the live test may exercise this adapter too. Where the selected model returns a thought-signature extension, verify it is preserved through a stateless tool-call/tool-result round trip; do not assume the OpenAI SDK exposes every provider extension without loss. Count it against the approved budget; do not assume it is free or run it automatically. Verify only the features currently documented by Google; do not infer full OpenAI feature parity. This optional check does not replace the native Gemini adapter test or create another Phase 3 live-test requirement. Although it reuses a Gemini key and endpoint, it still consumes Gemini quota and may incur charges; count every request against the same approved cumulative request/input/output/spend caps.

Constraints / non-goals

- Do not claim every AI company is supported by this adapter.
- Do not use the native OpenAI Responses API for the Chat Completions compatibility protocol.
- Do not use automatic cross-provider fallback or send a request to another endpoint after failure.
- Do not store provider keys/endpoints in project config.
- Do not commit.

Verification

Run focused compatibility adapter tests, common provider contract tests, relevant security/config tests, full relevant Vitest, type-check, and build. Verify two configured companies use their own keys and no secret leaks to the Playwright child process. Inspect the full diff.

Final report

List supported compatibility features and known limitations, provider configs exercised, SDK/client and versions, key/base-URL isolation evidence, retry settings, tests and commands/results, and which specific third-party providers were actually verified. Do not present examples as verified integrations unless tested.
```

**Completion criteria:** Multiple compatible provider entries can use the same adapter with separate keys and model IDs; capability differences are visible; unsupported features fail explicitly; endpoint credentials and child-process boundaries are protected.

---

# Task 3.7 — CLI Integration, Live Verification, and Phase 3 Exit Checks

**Estimated effort:** 2–3 hours  
**Code changes:** Yes

## Summary

Integrate provider selection into the CLI through the common provider service, expose a safe provider diagnostic/smoke-test command, and perform the final security, compatibility, regression, and live-verification checks. The CLI must not require all provider keys to be present. It must use only the selected provider's key and must not silently fall back.

All providers and the compatibility adapter must be mock-tested. To mark Phase 3 complete, at least one implemented adapter must pass a bounded live smoke test through the actual platform CLI/provider path, using an explicitly approved provider/model and budget. Do not force paid usage: if no live test is authorised or a verified free quota is unavailable, leave Phase 3 implementation status incomplete/blocked for live verification instead of claiming full completion. Live tests for the other providers are reported individually and are not required unless their keys and approvals are available.

## Copy-ready coding AI prompt

```text
Goal

Integrate the provider-neutral service into the CLI, verify all adapters, run one authorised live smoke test through the actual platform path, and assess Phase 3 exit criteria.

Context

Read source docs and DEC-028 through the latest provider decisions; all adapters from Tasks 3.4, 3.5, 3.6, and 3.6a; Task 3.2 conversation contract and Task 3.2a schema contract; Task 3.3 key isolation; Task 3.3a lifecycle/budget ledger; and current CLI/logging conventions. Inspect current repository state and pre-change test baseline.

Requirements

1. Add or complete a narrow CLI command for provider status/diagnostic and an explicit smoke-test request. The diagnostic must show provider ID, model ID, capability status, enabled/disabled state, key-present/missing (never key value), and safe endpoint details. It must not make a network request unless the user explicitly invokes the smoke-test action.
2. Fail before network activity if provider inference is disabled, no provider/model is selected, the matching provider key is missing, configured endpoint/model is invalid, or budget approval/counters do not permit the request.
3. Verify switching among OpenAI, Anthropic, Gemini, and at least two distinct OpenAI-compatible provider entries requires configuration changes only. No agent/business logic edits, shared code forks, or accidental key swapping.
4. Verify all provider adapters and the compatibility adapter with mock contract tests for success, structured output, tool-call/result round-trip, continuation-state preservation, unsupported capability/schema, malformed response, refusal/incomplete output, missing/invalid credentials, quota/rate-limit errors, timeout/cancellation, and safe redaction.
5. Verify SDK automatic retries are disabled for every provider; only Task 3.3a's shared retry policy may retry. Verify per-request input-size and output-token limits and persistent cumulative request/input-estimate/output-token ceilings remain enforced across separate CLI invocations and process restarts. Verify the budget ledger does not contain prompt/output content or secrets.
6. Verify AI calls default to disabled and that `AI_PROVIDER_API_KEY` is not silently used. Verify direct providers use their matching keys and custom providers use their configured provider-specific environment-variable name.
7. Verify no platform provider key or opaque provider continuation state reaches project.config.json, role configs, prompts/reports, browser context, logs, or Playwright child-process environments. Verify that existing target-app test-credential behaviour is unchanged; do not add a new credential-loading or injection path, and do not assume project-declared credentials are automatically injected into the test process.
8. Run one live smoke test through the platform CLI using the user-approved provider/model and approval values. The approval must explicitly state:
   - provider and model ID;
   - maximum number of requests;
   - maximum input tokens per request (backed by the platform's hard input-size/character guard);
   - maximum output tokens per request;
   - maximum cumulative input tokens for the approved test window;
   - maximum cumulative output tokens for the approved test window;
   - maximum spend and currency;
   - current provider-side spend/quota setting where the provider offers one, or an explicit note that no enforceable account-level cap exists.
   Stop at the first reached cap. Do not use a live API request in routine Vitest.
9. At least one implemented provider must pass the live CLI smoke test to mark Phase 3 complete. If no live request is authorised, or every live test is blocked/fails, state “implementation checks may pass, but Phase 3 is not complete — live verification outstanding/failed.” Never bypass this gate by counting the earlier disposable 3.0b experiment as an implemented-platform-path verification.
10. Additional provider live tests may run only with separate user approval and matching keys. Clearly distinguish for each provider: adapter implemented, mock-tested, live pass, live fail, or not live-verified.
11. Run full relevant Vitest, type-check, build, and a Phase 1 CLI regression test plus Phase 2 project/document/requirement regression coverage. Compare with the verified baseline and report raw test summary lines.
12. Update docs/IMPLEMENTATION_PLAN.md with task statuses, actual effort, actual test counts, provider-by-provider live state, and any remaining limitations. Do not change any completed historical task semantics.
13. Inspect the complete diff; preserve user work. Do not commit or tag.

Constraints / non-goals

- No Playwright MCP implementation (Phase 4), AI agents/planning/generation (Phase 5), candidate validation/approval or SQLite (Phase 6), release comparison (Phase 7), or UI/API server (Phase 8).
- No mandatory hosted gateway.
- No automatic cross-provider/model fallback.
- No API requests in routine Vitest.
- No provider key or raw continuation state in logs/reports.
- No unbounded requests, tokens, retries, or silent budget reset.

Verification

Run focused CLI/provider tests, full relevant Vitest, `npm run typecheck`, `npm run build`, Phase 1 CLI regression, Phase 2 regression, and the authorised live provider test. Check process exit codes and actual CLI output. Verify no test/key environment leakage and inspect the complete diff.

Final report

State Phase 3 complete or incomplete; list all changed files; exact package versions; provider-by-provider adapter/mock/live state; exact approved request/per-request-input/per-request-output/cumulative-input/cumulative-output limits and actual observed usage/cost data; budget ledger behaviour; CLI commands and raw verification results; regression results; items not verified; and remaining security/privacy/cost limitations. A live API test is passed only if it was actually executed through the platform CLI and its response was checked.
```

**Completion criteria:** CLI uses the shared provider service; all direct and compatibility adapters pass mock contract tests; at least one implemented adapter passes a user-authorised live CLI smoke test; cross-run budgets and per-request output caps work; secret and continuation-state isolation is verified; Phase 1/2 regressions pass; implementation plan records observed evidence.

---

## 7. Recommended execution order

1. Task 3.0a — read-only Phase 2 handoff audit and provider capability comparison.
2. Task 3.0b — gated disposable hosted-provider + Playwright MCP spike, only after the user completes the approval block.
3. Task 3.1 — align source documents and record the multi-company provider requirement.
4. Task 3.2 — choose the provider SDK strategy and define provider-neutral multi-turn contracts.
5. Task 3.2a — define the single-source structured-output schema and generic conversion interface.
6. Task 3.3 — implement multi-provider configuration, file locations, and isolated secret handling.
7. Task 3.3a — implement shared timeout/retry/usage-budget lifecycle before adapters.
8. Task 3.4 — implement the OpenAI Responses adapter.
9. Task 3.5 — implement the Anthropic adapter.
10. Task 3.6 — implement the Gemini adapter.
11. Task 3.6a — implement the OpenAI-compatible Chat Completions adapter for additional configured providers.
12. Task 3.7 — integrate the CLI, run at least one authorised live provider smoke test, and complete regression checks/phase gate.

Do not give the coding model the entire breakdown as one implementation request. Run one task at a time. Review its report, changed files, tests, and full diff before proceeding. If Task 3.0b is blocked, follow the explicit deferral gate in Section 6; do not silently skip the feasibility experiment before adapter implementation. The user handles commits/tags after review. Do not repeat the Phase 2 commit/tag step if Task 3.0a confirms that the intended checkpoint already exists.

---

## 8. Phase 3 scope guardrails and handoff to later phases

| Concern | Phase 3 outcome | Deferred phase |
|---|---|---|
| Model inference | Hosted direct-provider API adapters | None; this is Phase 3's core |
| Supported providers | Direct OpenAI, Anthropic, Gemini plus configurable OpenAI-compatible Chat Completions adapter; native adapters for other protocols | Further native protocols when requested and implemented |
| Model selection | Platform-level provider/model selection; multiple configured companies/keys can coexist | UI-based selection in Phase 8 if needed |
| API keys | Multiple provider-specific platform secrets may coexist; only the selected provider key is injected into its adapter | Dedicated credential UI/secret manager if later justified |
| Structured output | One canonical runtime schema generates provider JSON Schema and validates locally; each provider adapter performs its own dialect lowering and rejects unsupported constraints | AI requirement extraction and domain schemas in Phase 5 |
| Tool calling | Typed assistant tool-call/tool-result multi-turn messages plus opaque provider continuation state; returned but not executed | Actual MCP tool discovery/execution in Phase 4 |
| MCP | Disposable feasibility test only; no platform MCP client | Phase 4 |
| AI agents | No agent workflow implementation | Phase 5 |
| Candidate tests | None | Test validation/approval in Phase 6 |
| Persistence | Small local JSON usage ledger for cross-run budgets; no prompt/output or key storage | SQLite operational metadata in Phase 6 |
| UI/API server | None | Phase 8 |

## 9. Phase 3 exit criteria

Phase 3 is complete only when all applicable items below have repository and test evidence:

- [ ] The latest source documents and active instructions agree with DEC-028; no local-model-first wording remains as the primary inference path.
- [ ] The multi-provider decision records direct OpenAI, Anthropic, and Gemini support, multiple concurrently configured company-specific keys, and the OpenAI-compatible adapter plus native-adapter extension mechanism.
- [ ] The chosen SDK/direct-client strategy and exact dependency versions are recorded in `DECISIONS.md`.
- [ ] Shared model-provider request/response/error/capability contracts exist and are used by all adapters, including the OpenAI-compatible Chat Completions adapter.
- [ ] Multi-turn message types explicitly represent assistant tool calls and correlated tool results; opaque provider continuation state is preserved only by the matching provider/model adapter and is not logged.
- [ ] OpenAI, Anthropic, and Gemini each have a direct provider adapter; each adapter owns its provider-specific schema conversion and continuation mapping; no provider SDK types leak into business logic.
- [ ] Each direct provider adapter and the OpenAI-compatible adapter are covered by mock success, failure, structured-output, and tool-call contract tests; the compatibility adapter is exercised with at least two separately configured provider entries.
- [ ] Provider/model selection and matching keys can be changed without editing application/agent business logic.
- [ ] API keys remain platform-level secrets and never enter project JSON, prompts, reports, logs, browser content, or Playwright child-process environments.
- [ ] One canonical schema source generates provider JSON Schema and performs local validation; the schema-library choice/dependency is recorded; generic conversion is separate from provider-specific schema lowering; each adapter rejects unsupported constraints rather than silently dropping them.
- [ ] Structured output is validated locally. Unsupported model/provider capabilities are explicit errors, not silent fallbacks.
- [ ] Tool-call requests can be normalised and round-tripped, but no Playwright MCP tool is executed in Phase 3.
- [ ] Shared lifecycle is implemented before adapters; SDK retries are disabled so there is only one retry owner.
- [ ] Timeouts, cancellation, bounded retry policy, rate-limit/quota errors, per-request input-size/output-token caps, persistent cross-run request/input-estimate/output-token budgets, and default-disabled provider calls are tested.
- [ ] The cumulative usage ledger persists across process restarts, contains no prompts/outputs/secrets, and has an explicit user-controlled reset/rollover.
- [ ] At least one implemented adapter passes a bounded, user-authorised live smoke test through the platform CLI before Phase 3 is marked complete.
- [ ] Real-provider smoke-test status is reported separately per provider; no missing key or unrun test is described as passed. If live authorisation is unavailable, Phase 3 remains incomplete/blocked for live verification.
- [ ] Build, type-check, and relevant Vitest tests pass with observed evidence; prior Phase 1 and Phase 2 tests remain compatible.
- [ ] `IMPLEMENTATION_PLAN.md` records actual task outcomes, effort, limitations, and the next phase.

---

## 10. Provider and engineering references

Use current official documentation during implementation. API versions, models, pricing, quotas, and SDK APIs change; the coding model must verify exact details at the time of each task.

### Provider APIs and authentication

- [OpenAI API — Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI API — Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI Help — ChatGPT and API billing are separate](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)
- [Anthropic Claude API — Tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Anthropic Claude API — Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Anthropic Claude API — Get an API key](https://platform.claude.com/docs/en/get-api-key)
- [Anthropic Help — Claude subscription and API usage](https://support.anthropic.com/en/articles/9876003-i-subscribe-to-a-paid-claude-ai-plan-why-do-i-have-to-pay-separately-for-api-usage-on-console)
- [Google Gemini API — Get started and create an API key](https://ai.google.dev/gemini-api/docs/get-started)
- [Google Gemini API — Function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Google Gemini API — Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
- [Google Gemini API — Pricing](https://ai.google.dev/gemini-api/docs/pricing)

### Provider integration options

- [Zod 4 — JSON Schema conversion](https://zod.dev/json-schema)
- [OpenAI API — Responses state storage and encrypted reasoning items](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Google Gemini API — OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [Google Gemini API — Thinking and thought signatures](https://ai.google.dev/gemini-api/docs/thinking)

- [Vercel AI SDK — Providers and models](https://ai-sdk.dev/docs/foundations/providers-and-models)
- [Vercel AI SDK — Choosing a provider](https://ai-sdk.dev/docs/getting-started/choosing-a-provider)
- [Vercel AI SDK — Anthropic provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic)
- [Google Gen AI JavaScript SDK — retry options](https://github.com/googleapis/js-genai/blob/main/src/types.ts)

The AI SDK is an evaluation candidate only. If selected, use direct provider packages/credentials; do not make AI Gateway mandatory. Verify current provider coverage and capabilities before adopting it.

### Project engineering references

- `reliable-ai-coding` skill provided for this project.
- `software-engineering-best-practices` SKILL.md provided as a reference when available. Do not assume its optional `references/` files are installed in the project; apply the security requirements written in the task prompts and consult current official documentation.
- `docs/DECISIONS.md` — especially DEC-005, DEC-026, DEC-028, and the multi-provider/SDK decisions added during Phase 3.
- `docs/IMPLEMENTATION_PLAN.md` — single source of truth for actual phase progress.
